# backstage/

The developer-facing half of this repo's golden path: a form that renders
an `XStorageAccount` manifest (see
[`../crossplane/xrd/definition.yaml`](../crossplane/xrd/definition.yaml))
and applies it directly to the cluster - no ticket, no manual `kubectl`,
no standing developer access to Azure.

This is a standard app created with `@backstage/create-app` (new backend
system), plus two repo-specific additions:

| Path | What it is |
|---|---|
| [`templates/xstorageaccount/`](./templates/xstorageaccount) | The Software Template a developer actually fills out. |
| [`plugins/scaffolder-backend-module-kubernetes-apply/`](./plugins/scaffolder-backend-module-kubernetes-apply) | A small custom scaffolder action, `kubernetes:apply`, that the template's last step calls. See that plugin's README for why this is custom code instead of a dependency. |

## Prerequisites

- A cluster from [`../terraform/foundation/`](../terraform/foundation)
  with Crossplane installed per [`../crossplane/README.md`](../crossplane/README.md)
  - i.e. `tfup.sh` and `crossplane/apply.sh` have both already run this
    session, and `terraform/foundation/.kubeconfig` exists.
- Node 22 or 24, Yarn (installed automatically via Corepack the first time
  you run a `yarn` command in this directory - see `packageManager` in
  `package.json`)

## Usage

```bash
yarn install

# The kubernetes:apply action uses whatever kubeconfig the backend process
# is started with - point it at this session's cluster:
export KUBECONFIG="$(pwd)/../terraform/foundation/.kubeconfig"

yarn start
```

Then open <http://localhost:3000>, sign in as a guest, go to **Create...**,
and pick **Azure Storage Account**. Submitting the form applies an
`XStorageAccount` claim to the `demo` namespace; watch Crossplane pick it
up with:

```bash
kubectl get xstorageaccount -n demo -w
```

## Why a fixed `demo` namespace, not a form field

The `XStorageAccount` XRD is namespace-scoped, and Backstage's own service
account - not the requesting developer - is the only caller here (see the
crossplane README's notes on why this design skips the legacy Claim
indirection entirely). With no per-developer identity in the loop, a
namespace field on the form wouldn't be scoping anything real; it'd just be
a text box a submitter could put anything into. Hardcoding it keeps this
first pass to the one thing worth proving - self-service request → real
provisioned infrastructure - rather than half-building multi-tenancy that
nothing downstream enforces yet.

## What's not here (yet)

- **GitOps.** This applies directly via the Kubernetes API from the
  scaffolder action, per the root README's stated design (prove the loop
  first). Swapping in ArgoCD later - reusing the pattern from
  [`gitops-helm-argocd-demo`](https://github.com/shanecthomas/gitops-helm-argocd-demo) -
  is the noted stretch goal.
- **A real auth provider.** `app-config.yaml` still uses the `guest`
  provider from `create-app`'s default template. Fine for a single-user
  demo session; not something to keep past that.
