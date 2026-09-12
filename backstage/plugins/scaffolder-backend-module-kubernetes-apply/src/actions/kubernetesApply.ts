import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import {
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  KubernetesObject,
} from '@kubernetes/client-node';
import yaml from 'yaml';
import { examples } from './kubernetesApply.examples';

const FIELD_MANAGER = 'backstage-scaffolder';

// How often we re-check a resource's Ready condition while waiting. Kept
// small relative to realistic timeouts (tens of seconds to a couple
// minutes) so the actual wait doesn't overshoot the requested timeout by
// much - see the maxAttempts comment in waitForReady for the tradeoff this
// makes against a strict wall-clock deadline.
const READY_POLL_INTERVAL_MS = 3_000;

type ActionLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

// client.read() (unlike patch/create/delete) requires metadata.name at the
// type level, not just at runtime - its signature is
// read<T>(spec: { apiVersion; kind; metadata: { name: string; namespace?: string } }).
// KubernetesObject itself leaves metadata (and therefore name) optional, so
// once we've validated a parsed document has a name, we carry that
// guarantee forward in the type instead of casting past the checker at
// each call site.
type NamedKubernetesObject = KubernetesObject & {
  metadata: { name: string; namespace?: string };
};

/**
 * Builds the KubernetesObjectApi client this action uses. Broken out as its
 * own function so tests can substitute a fake without touching real
 * kubeconfig loading.
 */
function defaultClientFactory(): KubernetesObjectApi {
  const kubeConfig = new KubeConfig();
  // Honors the KUBECONFIG env var (falling back to ~/.kube/config) - the
  // same kubeconfig terraform/foundation/tfup.sh writes each session.
  // There's deliberately no separate Backstage-specific credential: this
  // repo already treats that kubeconfig as the one way to reach the
  // cluster, and duplicating it into app-config.yaml would just be another
  // secret to keep in sync (and out of git).
  kubeConfig.loadFromDefault();
  return KubernetesObjectApi.makeApiClient(kubeConfig);
}

function defaultWait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describe(spec: KubernetesObject): string {
  const namespace = spec.metadata?.namespace;
  return `${spec.kind}/${spec.metadata?.name}${
    namespace ? ` (namespace: ${namespace})` : ''
  }`;
}

/**
 * Reads a `status.conditions[].type === type` entry off an arbitrary
 * Kubernetes object. This is the standard Kubernetes "Conditions" pattern -
 * Crossplane XRs (and most CRDs) all report status this way - so watching
 * for it works generically, without this action needing to know anything
 * XStorageAccount-specific.
 */
function findCondition(
  obj: KubernetesObject,
  type: string,
): { status?: string; reason?: string; message?: string } | undefined {
  const conditions = (
    obj as { status?: { conditions?: Array<Record<string, string>> } }
  ).status?.conditions;
  return conditions?.find(condition => condition.type === type);
}

/**
 * Polls `specs` until every one of them reports `Ready: "True"`, or gives
 * up and throws once `timeoutSeconds` worth of attempts have passed.
 *
 * This is attempt-count-based (timeoutSeconds / READY_POLL_INTERVAL_MS
 * rounds), not a strict wall-clock deadline - simpler to reason about and
 * to test, at the cost of running a little long if the reads themselves are
 * slow. Fine for this action's scale (checking one or two resources).
 *
 * Deliberately does NOT try to detect "this will never succeed" early from
 * a condition's reason/message (e.g. spotting a 409 and failing fast).
 * Providers like provider-upjet-azure reuse the same reason
 * (`ReconcileError`) for both permanent and transient failures, so that
 * would be a guess dressed up as a signal - a real risk of giving up on a
 * resource that would have converged on the next retry. A timeout is a
 * blunter but honest instrument.
 */
async function waitForReady(
  client: KubernetesObjectApi,
  specs: NamedKubernetesObject[],
  timeoutSeconds: number,
  logger: ActionLogger,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  const maxAttempts = Math.max(
    1,
    Math.ceil((timeoutSeconds * 1000) / READY_POLL_INTERVAL_MS),
  );
  const pending = new Map(specs.map(spec => [describe(spec), spec]));

  for (let attempt = 1; attempt <= maxAttempts && pending.size > 0; attempt++) {
    for (const [key, spec] of pending) {
      const current = await client.read(spec);
      const ready = findCondition(current, 'Ready');
      if (ready?.status === 'True') {
        logger.info(`${key} is Ready`);
        pending.delete(key);
      }
    }

    if (pending.size === 0) {
      return;
    }

    if (attempt < maxAttempts) {
      await wait(READY_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out after ~${timeoutSeconds}s waiting for Ready: ${[
      ...pending.keys(),
    ].join(', ')}`,
  );
}

/**
 * `kubernetes:apply` - applies one or more Kubernetes manifests to whatever
 * cluster the ambient kubeconfig points at, using server-side apply (the
 * same create-or-update semantics `kubectl apply` uses).
 *
 * This exists because no well-maintained, generally-available scaffolder
 * action currently does this for the new backend system: Roadie's actual
 * Kubernetes module (`@backstage-community/plugin-scaffolder-backend-module-kubernetes`)
 * only creates namespaces, and the other public package that claims the
 * `kubernetes:apply` action id is a single-commit, unreleased-beyond-0.1.0
 * package written for a conference talk. `@kubernetes/client-node`'s
 * `KubernetesObjectApi`, by contrast, is the official, actively-maintained
 * Kubernetes JS client's generic apply-any-resource API, so this action is
 * a thin wrapper around it.
 *
 * `waitForReadyTimeoutSeconds` is opt-in on top of that base behavior: a
 * bare `kubectl apply` (and this action, by default) only confirms the API
 * server accepted the write, not that whatever's reconciling it actually
 * succeeded. Setting this input makes the action poll for a Ready
 * condition and, if it's never reached, delete everything this step
 * applied and fail the task - so a request that can't actually be
 * satisfied doesn't get reported as a false-positive success, and doesn't
 * leave a broken resource behind either.
 *
 * @public
 */
export function createKubernetesApplyAction(
  clientFactory: () => KubernetesObjectApi = defaultClientFactory,
  wait: (ms: number) => Promise<void> = defaultWait,
) {
  return createTemplateAction({
    id: 'kubernetes:apply',
    description:
      'Applies one or more Kubernetes manifests via server-side apply (kubectl-apply semantics), using the kubeconfig the Backstage backend process is running with.',
    examples,
    schema: {
      input: {
        manifest: z =>
          z
            .string()
            .describe(
              'YAML manifest to apply. May contain multiple "---"-separated documents.',
            ),
        waitForReadyTimeoutSeconds: z =>
          z
            .number()
            .optional()
            .describe(
              'If set, after applying, poll every manifest for a `Ready` status condition (the standard Kubernetes/Crossplane convention) for up to this many seconds. If any manifest never reports Ready in time, every manifest applied in this step is deleted and the step fails - so a request that cannot actually be satisfied is reported as a failure, not a false-positive success, and does not leave a broken resource behind. Omit for the original apply-and-return-immediately behavior, e.g. for a manifest with no meaningful Ready condition.',
            ),
      },
    },
    async handler(ctx) {
      const { manifest, waitForReadyTimeoutSeconds } = ctx.input;

      const rawDocuments = yaml
        .parseAllDocuments(manifest)
        .map(doc => doc.toJS() as KubernetesObject | null)
        .filter((doc): doc is KubernetesObject => Boolean(doc));

      if (rawDocuments.length === 0) {
        throw new Error(
          'No Kubernetes manifests found in the `manifest` input - is it empty?',
        );
      }

      const documents: NamedKubernetesObject[] = rawDocuments.map(doc => {
        if (!doc.apiVersion || !doc.kind || !doc.metadata?.name) {
          throw new Error(
            `Manifest is missing apiVersion, kind, or metadata.name: ${yaml.stringify(
              doc,
            )}`,
          );
        }
        return doc as NamedKubernetesObject;
      });

      const client = clientFactory();
      const applied: NamedKubernetesObject[] = [];

      // Best-effort: deletes everything this step applied so far, then
      // (always) throws `cause`. A delete failure is logged and swallowed
      // rather than thrown, so it can't mask the real failure - but it does
      // mean rollback isn't guaranteed; see the plugin README for the
      // manual-cleanup note this implies.
      const rollback = async (cause: Error): Promise<never> => {
        if (applied.length > 0) {
          ctx.logger.warn(
            `Rolling back ${applied.length} resource(s) applied in this step because it failed: ${cause.message}`,
          );
          for (const spec of applied) {
            try {
              await client.delete(spec);
              ctx.logger.info(`Deleted ${describe(spec)}`);
            } catch (deleteError) {
              const deleteMessage =
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError);
              ctx.logger.warn(
                `Failed to roll back ${describe(
                  spec,
                )}: ${deleteMessage} - it may need manual cleanup.`,
              );
            }
          }
        }
        throw cause;
      };

      for (const spec of documents) {
        ctx.logger.info(`Applying ${describe(spec)}`);
        try {
          const result = await client.patch(
            spec,
            undefined /* pretty */,
            undefined /* dryRun */,
            FIELD_MANAGER,
            true /* force */,
            PatchStrategy.ServerSideApply,
          );
          ctx.logger.info(`Applied ${describe(result)}`);
          applied.push(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const applyError = new Error(
            `Failed to apply ${describe(spec)}: ${message}`,
          );
          if (waitForReadyTimeoutSeconds) {
            await rollback(applyError);
          }
          throw applyError;
        }
      }

      if (!waitForReadyTimeoutSeconds) {
        return;
      }

      try {
        await waitForReady(
          client,
          applied,
          waitForReadyTimeoutSeconds,
          ctx.logger,
          wait,
        );
      } catch (error) {
        const waitError =
          error instanceof Error ? error : new Error(String(error));
        await rollback(waitError);
      }
    },
  });
}
