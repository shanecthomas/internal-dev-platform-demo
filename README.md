# internal-dev-platform-demo

An end-to-end internal developer platform (IDP) golden path: a developer
fills out a form in **Backstage**, that request becomes a **Crossplane**
claim, and Crossplane provisions a real **Azure** resource — no tickets,
no manual cloud console work, no standing access to Azure for the
developer.

This is a portfolio project, not production platform code. It's scoped
deliberately small so the full loop — self-service request → real
provisioned infrastructure — actually works end to end, rather than being
a large half-finished platform.

## Status

- [x] **Foundation infrastructure** — ephemeral AKS cluster with OIDC
      workload identity, a scoped resource group, and a least-privilege
      Azure AD app for Crossplane. See [`terraform/foundation/`](./terraform/foundation).
- [x] **Crossplane** — `provider-family-azure`, an `XStorageAccount` XRD,
      and a Pipeline-mode Composition (`function-patch-and-transform`)
      that provisions a Storage Account into the scoped resource group.
- [x] **Backstage scaffolder template** — a form (name/location/sku) that
      renders an `XStorageAccount` manifest and applies it to the cluster
      via a custom `kubernetes:apply` scaffolder action. The action waits
      for Crossplane to confirm the resource actually provisioned (not
      just that the write was accepted) and rolls back if it doesn't. See
      [`backstage/`](./backstage) for details, including a note on why
      this is a small custom action rather than a third-party package.
- [ ] **(Stretch) GitOps fast-follow** — swap direct `kubectl apply` for
      an ArgoCD-synced flow, reusing the pattern from
      [`gitops-helm-argocd-demo`](https://github.com/shanecthomas/gitops-helm-argocd-demo).

## Why this architecture

- **AKS, not local Kind, for the control plane.** Crossplane needs Azure
  Workload Identity to authenticate without stored secrets, which requires
  a *publicly reachable* OIDC issuer. AKS exposes one out of the box; a
  local Kind cluster doesn't without extra tunneling infrastructure that
  isn't worth the complexity here.
- **One pre-scoped resource group, not per-claim resource group creation.**
  Creating a resource group is a subscription-level operation in Azure, so
  letting Crossplane do that would require subscription-wide Contributor.
  Instead, Terraform pre-creates a single resource group, and the
  Crossplane service principal's Contributor role is scoped to *only*
  that group — it cannot touch anything else in the subscription.
- **Direct `kubectl apply` before GitOps.** The goal is one working
  end-to-end loop first; ArgoCD-backed GitOps is a clean fast-follow once
  the core loop is proven, not a prerequisite for it.
- **A custom scaffolder action, not a third-party one.** There isn't
  actually a well-maintained scaffolder action that applies an arbitrary
  manifest for the current Backstage backend system — Roadie's real
  Kubernetes module only creates namespaces, and the package that happens
  to own the `kubernetes:apply` action ID is an unmaintained,
  single-commit package written for a conference talk. `backstage/`
  wraps the official `@kubernetes/client-node` library's own generic
  apply API instead. Details in
  [`backstage/plugins/scaffolder-backend-module-kubernetes-apply/README.md`](./backstage/plugins/scaffolder-backend-module-kubernetes-apply/README.md).
- **Everything is ephemeral.** The AKS cluster (and the Azure AD app/
  federated credential tied to it) are created and destroyed per working
  session via `tfup.sh` / `tfdown.sh` — see the foundation README for details.
  There's no reason to pay for a running cluster between sessions.

## Repo layout

```
internal-dev-platform-demo/
├── terraform/
│   └── foundation/       # AKS + OIDC workload identity + scoped RG
├── crossplane/           # XRD, Composition, ProviderConfig
├── backstage/            # Backstage app + xstorageaccount template +
│                         # the custom kubernetes:apply scaffolder action
└── docs/
    └── architecture.md
```

## Getting started

1. [`terraform/foundation/README.md`](./terraform/foundation/README.md) —
   prerequisites, setup, and day-to-day usage (`tfup.sh` / `tfdown.sh`)
2. [`crossplane/README.md`](./crossplane/README.md) — installing
   Crossplane and the Storage Account XRD onto the cluster from step 1
3. [`backstage/README.md`](./backstage/README.md) — running Backstage
   against that cluster and submitting the form

## Cost

The foundation's default node (`Standard_D2s_v3`) runs at roughly
**$0.05–0.08/hr** all-in. A multi-hour build session costs well under a
dollar; running `tfdown.sh` at the end of a session brings cost to $0
between sessions. See the foundation README for a full breakdown.
