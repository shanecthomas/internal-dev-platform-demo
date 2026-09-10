# scaffolder-backend-module-kubernetes-apply

Registers a single Backstage scaffolder action, `kubernetes:apply`, that
applies one or more Kubernetes manifests via [server-side
apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) -
the same create-or-update semantics `kubectl apply` uses.

## Why this exists instead of an existing package

This repo's own README used to describe the plan as "Roadie's
`kubernetes:apply` scaffolder action." That turned out not to exist:

- Roadie's actual, currently-maintained Kubernetes module -
  [`@backstage-community/plugin-scaffolder-backend-module-kubernetes`](https://github.com/backstage/community-plugins/tree/main/workspaces/scaffolder-backend-module-kubernetes),
  now homed under the official `backstage/community-plugins` org - only
  registers `kubernetes:create-namespace`. There's no generic "apply any
  manifest" action in it.
- The action ID `kubernetes:apply` does exist, but it belongs to a
  different, unrelated package -
  [`@muvaf/kubernetes-apply`](https://github.com/muvaf/kubernetes-apply) - a
  single-commit package with no release past `0.1.0`, written for the
  legacy Backstage backend system, whose own README says "I wrote this for
  a KubeCon talk without knowing much TypeScript. Be careful if you decide
  to use it." It has no connection to Roadie.

Neither is something to depend on here. This module is a ~100-line wrapper
around [`@kubernetes/client-node`](https://github.com/kubernetes-client/javascript)'s
`KubernetesObjectApi` - the official, actively-maintained Kubernetes JS
client's generic "apply any resource" API - which does exactly what
`kubectl apply` does under the hood (a `PATCH` with
`Content-Type: application/apply-patch+yaml`, which both creates and
updates).

## Authentication

`kubernetesApply.ts` calls `KubeConfig.loadFromDefault()`, which honors the
`KUBECONFIG` environment variable. That means the Backstage backend process
uses whatever kubeconfig it's started with - the same
`terraform/foundation/.kubeconfig` `tfup.sh` already writes each session.
There's no separate Backstage-specific credential or app-config entry to
keep in sync: start the backend with

```bash
export KUBECONFIG="$(pwd)/../../terraform/foundation/.kubeconfig"
```

(adjust the relative path to wherever you're running `yarn start` from)
before `yarn start`, same as `crossplane/apply.sh` already expects for
`kubectl`.

## Usage

```yaml
steps:
  - id: apply
    name: Apply a manifest
    action: kubernetes:apply
    input:
      manifest: |
        apiVersion: v1
        kind: ConfigMap
        metadata:
          name: example
          namespace: demo
        data:
          hello: world
```

`manifest` may contain multiple `---`-separated documents; each is applied
in order. See [`../../templates/xstorageaccount/template.yaml`](../../templates/xstorageaccount/template.yaml)
for this repo's real usage.

## What this deliberately doesn't do

- **No cluster/context selection.** There's exactly one cluster in this
  demo, so the action always applies to whatever the ambient kubeconfig's
  current context points at. A multi-cluster platform would need to accept
  a cluster reference the way `kubernetes:create-namespace` does.
- **No drift detection or diffing.** It's a thin apply, not a reconciler -
  Crossplane's own control loop is what keeps `XStorageAccount` resources
  converged after the initial apply.
- **No delete.** Tearing down a claim is a manual `kubectl delete` for now;
  see the root README's GitOps stretch goal for where that'd eventually
  live (ArgoCD pruning, rather than a scaffolder delete action).
