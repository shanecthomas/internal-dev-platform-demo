# terraform

Ephemeral AKS cluster + Azure AD workload identity plumbing for the
Backstage + Crossplane demo. This is *control-plane* infrastructure —
somewhere for Crossplane to run and a passwordless way for it to talk to
Azure. It is separate from whatever Crossplane provisions on request
(Storage Accounts, which land in a dedicated, tightly-scoped resource
group — see [Security notes](#security-notes) below).

## What this creates

- A small AKS cluster with `oidc_issuer_enabled` and
  `workload_identity_enabled` set, so pods can request Azure AD tokens
  without any stored client secret
- A dedicated Azure AD application + federated identity credential,
  trusting tokens issued for the Crossplane provider's ServiceAccount
- One resource group (`idp-demo-workloads-rg` by default) that the
  Crossplane service principal has Contributor on — and **only** that
  resource group, not the subscription

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli),
  [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.7
- An Azure subscription you can authenticate to interactively (`az login`)
- `kubectl`, if you want to interact with the cluster directly rather than
  only through Backstage later

### A note on `az login` and Security Defaults

If your tenant has **Microsoft Entra Security Defaults** enabled, `az
login` can fail with error `530035` ("blocked by security defaults"),
specifically for the Azure CLI's own first-party app. Security Defaults
is an all-or-nothing tenant setting — there's no way to carve out a
scoped exception for just the CLI without a Microsoft Entra ID P1 license
and Conditional Access. For a single-user personal/demo subscription, the
pragmatic fix is:

1. Register an MFA method for yourself at
   [mysignins.microsoft.com/security-info](https://mysignins.microsoft.com/security-info)
   (not the admin center — admins can't add interactive methods to their
   *own* account from there; this is a known, deliberate Microsoft
   restriction, not a bug)
2. Disable Security Defaults: Microsoft Entra ID > Properties > Manage
   security defaults > Disabled
3. Retry `az login`

You'll be trading "MFA mandatory via one flag" for "MFA available,
self-enforced" — a reasonable trade on a single-user tenant, less so on a
real org's tenant.

## Usage

```bash
export TF_VAR_subscription_id=<your-sub-id>
./tfup.sh
```

`tfup.sh` runs `terraform init` → `plan` (saved to `tfplan`) → a 60-second
pause to review before applying → `apply`, then captures the outputs
you'll need for the Crossplane `ProviderConfig` into `.session-outputs.env`
and writes a kubeconfig to `.kubeconfig` (mode 600). **Any failure at any
step — including a failed output read after a successful apply — triggers
an automatic teardown**, so a bad run doesn't leave an orphaned, billable
cluster behind.

```bash
export KUBECONFIG="$(pwd)/.kubeconfig"
kubectl get nodes   # sanity check
```

Then install Crossplane onto the cluster:

```bash
../../crossplane/apply.sh
```

See [`../../crossplane/README.md`](../../crossplane/README.md) for what
that installs and why.

When you're done for the session:

```bash
./tfdown.sh
```

Neither script hardcodes your subscription ID — if `TF_VAR_subscription_id`
isn't set, both will prompt for it interactively.

## Outputs

| Output | Used for |
|---|---|
| `crossplane_client_id` | Crossplane `ProviderConfig` — Azure AD app client ID |
| `tenant_id` | Crossplane `ProviderConfig` — Azure AD tenant ID |
| `oidc_issuer_url` | Debugging federation issues; not usually needed manually |
| `workload_resource_group_name` | The one resource group Crossplane can provision into |
| `kube_config_raw` | Written to `.kubeconfig` by `tfup.sh` — sensitive, never commit |
| `subscription_id` | Crossplane `ProviderConfig` — Azure subscription ID |

## Security notes

- **No stored secrets.** Both Terraform's own auth (`az login` session)
  and Crossplane's auth (workload identity federation) are OIDC-based —
  there is no client secret anywhere in this configuration.
- **Least-privilege by construction, not by convention.** The Crossplane
  service principal's Contributor role is scoped to a single resource
  group's ARM ID, not the subscription. Even if the Crossplane
  Composition were compromised or misconfigured, its blast radius is
  capped at that one resource group.
- **`.gitignore` matters here more than usual.** `terraform.tfstate`
  contains the `kube_config_raw` output in plaintext. The repo's
  `.gitignore` excludes Terraform state, `tfplan`, and the `tfup.sh`
  session artifacts (`.kubeconfig`, `.session-outputs.env`) — don't
  remove those entries.

## Teardown

```bash
./tfdown.sh
```

Run this after each working session. There's no reason to leave a
running AKS cluster up between sessions — see the cost breakdown below.

## Cost

The default node (`Standard_D2s_v3`, 2 vCPU / 8GiB) runs at roughly
**$0.05–0.08/hr all-in** (VM + OS disk + incidentals) in most US regions.
AKS's control plane itself is free on the default (non-SLA) tier. For
reference:

- A 2-hour build session: well under $1
- Left running by accident overnight (10 hrs): still under $1

This is not a project where cost is a real constraint — the discipline of
running `tfdown.sh` matters more than the dollar amount.
