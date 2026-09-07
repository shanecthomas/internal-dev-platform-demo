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
- [ ] **Backstage scaffolder template** — a form (name/location/sku) that
      renders a Crossplane claim and applies it directly to the cluster
      via Roadie's `kubernetes:apply` scaffolder action.
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
- **Everything is ephemeral.** The AKS cluster (and the Azure AD app/
  federated credential tied to it) are created and destroyed per working
  session via `tfup.sh` / `tfdown.sh` — see the foundation README for details.
  There's no reason to pay for a running cluster between sessions.

## Repo layout

```
internal-dev-platform-demo/
├── terraform/
│   └── foundation/       # AKS + OIDC workload identity + scoped RG
├── crossplane/           # XRD, Composition, ProviderConfig (in progress)
├── backstage/            # scaffolder template + skeleton (in progress)
└── docs/
    └── architecture.md
```

## Getting started

See [`terraform/foundation/README.md`](./terraform/foundation/README.md)
for prerequisites, setup, and day-to-day usage (`tfup.sh` / `tfdown.sh`).

## Cost

The foundation's default node (`Standard_D2s_v3`) runs at roughly
**$0.05–0.08/hr** all-in. A multi-hour build session costs well under a
dollar; running `tfdown.sh` at the end of a session brings cost to $0
between sessions. See the foundation README for a full breakdown.
