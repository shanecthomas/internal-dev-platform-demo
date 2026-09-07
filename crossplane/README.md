# crossplane/

Turns the AKS cluster from `terraform/foundation/` into a working
Crossplane control plane that can provision a real Azure Storage Account
from a Kubernetes claim - no stored secrets, no standing developer access
to Azure.

## Prerequisites

```
cd ../terraform/foundation && ./tfup.sh
export KUBECONFIG="$(pwd)/.kubeconfig"
cd ../../crossplane && ./apply.sh
```

## What gets installed, and why

| File | What it does |
|---|---|
| `install/01-workload-identity.yaml` | `ImageConfig` + `DeploymentRuntimeConfig`. Wires Azure Workload Identity onto every Azure-family provider pod (both the one we install explicitly and `provider-family-azure`, which gets auto-installed as its dependency) by matching on image name rather than setting a `runtimeConfigRef` per-provider. Pins the generated ServiceAccount's name to `provider-family-azure` because that's the exact subject Terraform's federated identity credential already trusts. |
| `install/02-providers.yaml` | The `Provider` CR for `provider-azure-storage`, and the `Function` CR for `function-patch-and-transform` (used by the Composition's pipeline). |
| `install/03-provider-config.yaml` | `ClusterProviderConfig` with `credentials.source: OIDCTokenFile` - exchanges the token Kubernetes projects into the pod (because of the workload-identity ServiceAccount) for an Azure AD token. No client secret exists anywhere in this chain. |
| `xrd/definition.yaml` | The `XStorageAccount` XRD - v2-native (`apiextensions.crossplane.io/v2`, `scope: Namespaced`), no Claim indirection, since Backstage's own service account is the only caller and never needs the Claim's cross-namespace proxy trick. Schema: `name` (pattern-validated against real Azure storage account naming rules), `location`, `sku`. `resourceGroupName` is deliberately not a field here. |
| `xrd/composition.yaml` | Pipeline-mode `Composition` (via `function-patch-and-transform`) that turns an `XStorageAccount` into a real `storage.azure.m.upbound.io` `Account` (the namespaced API group - required since our XR is namespaced), landing it in the one pre-scoped resource group from Terraform - hardcoded in this file, not passed through from the XR's spec. |

## Why the resource group is hardcoded, not a claim field

Creating a resource group is a subscription-level operation in Azure.
Exposing `resourceGroupName` on the claim (or worse, letting Crossplane
create one per claim) would mean the Crossplane service principal needs
subscription-wide Contributor, not just Contributor on one pre-scoped
group. Fixing the resource group in the Composition means the blast
radius stays exactly what Terraform scoped it to, regardless of what a
future Backstage form passes through - a compromised or buggy claim can
never provision (or delete) anything outside that one group.
