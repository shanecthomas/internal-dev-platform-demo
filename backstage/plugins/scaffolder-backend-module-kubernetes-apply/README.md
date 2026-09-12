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

## Waiting for readiness, and rolling back on failure

A bare `kubectl apply` - and this action, by default - only confirms the
API server accepted the write. It says nothing about whether whatever
reconciles that object afterwards (Crossplane, in this repo's case)
actually succeeded. That gap is real: applying an `XStorageAccount` whose
name collides with someone else's Azure Storage Account (names are
globally unique across all of Azure) apply cleanly - `SYNCED: True` - and
then sit at `READY: False` forever while the provider retries a request
Azure will never accept. Left alone, the scaffolder task reports
"Completed" immediately, which is a false positive.

Setting `waitForReadyTimeoutSeconds` on a step closes that gap: after
applying, the action polls every manifest it just applied for a `Ready`
status condition (the standard Kubernetes/Crossplane convention - no
XStorageAccount-specific knowledge required) until it's `True`, up to the
given number of seconds. If any manifest never gets there in time - or if
a later manifest in the same step fails to apply at all - every manifest
this step applied is deleted, and the step fails with a real error
instead of a silent false-positive success.

This is deliberately timeout-based rather than trying to detect "this will
never succeed" early from a condition's `reason`/`message` (e.g. spotting
a 409 and failing fast). Providers like `provider-upjet-azure` reuse the
same reason (`ReconcileError`) for both permanent and transient failures,
so short-circuiting on it would risk giving up on a resource that would
have converged on the next retry. A timeout is blunter, but honest.

Rollback is best-effort: a delete failure during rollback is logged as a
warning rather than thrown, so it can't mask the original failure - but it
also means rollback isn't guaranteed to leave the cluster clean. Omit
`waitForReadyTimeoutSeconds` for the original apply-and-return-immediately
behavior, e.g. for a manifest with no meaningful `Ready` condition (a
plain `ConfigMap`, say).

## What this deliberately doesn't do

- **No cluster/context selection.** There's exactly one cluster in this
  demo, so the action always applies to whatever the ambient kubeconfig's
  current context points at. A multi-cluster platform would need to accept
  a cluster reference the way `kubernetes:create-namespace` does.
- **No drift detection or diffing after the wait completes.** Once a
  manifest reports Ready, this action is done with it - Crossplane's own
  control loop is what keeps `XStorageAccount` resources converged from
  that point on.
- **No delete outside of rollback.** Tearing down a claim that's already
  Ready is a manual `kubectl delete` for now; see the root README's
  GitOps stretch goal for where that'd eventually live (ArgoCD pruning,
  rather than a scaffolder delete action).
