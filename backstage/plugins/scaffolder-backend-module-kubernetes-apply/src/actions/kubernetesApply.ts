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

function describe(spec: KubernetesObject): string {
  const namespace = spec.metadata?.namespace;
  return `${spec.kind}/${spec.metadata?.name}${
    namespace ? ` (namespace: ${namespace})` : ''
  }`;
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
 * @public
 */
export function createKubernetesApplyAction(
  clientFactory: () => KubernetesObjectApi = defaultClientFactory,
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
      },
    },
    async handler(ctx) {
      const { manifest } = ctx.input;

      const documents = yaml
        .parseAllDocuments(manifest)
        .map(doc => doc.toJS() as KubernetesObject | null)
        .filter((doc): doc is KubernetesObject => Boolean(doc));

      if (documents.length === 0) {
        throw new Error(
          'No Kubernetes manifests found in the `manifest` input - is it empty?',
        );
      }

      for (const doc of documents) {
        if (!doc.apiVersion || !doc.kind || !doc.metadata?.name) {
          throw new Error(
            `Manifest is missing apiVersion, kind, or metadata.name: ${yaml.stringify(
              doc,
            )}`,
          );
        }
      }

      const client = clientFactory();

      for (const spec of documents) {
        ctx.logger.info(`Applying ${describe(spec)}`);
        try {
          const applied = await client.patch(
            spec,
            undefined /* pretty */,
            undefined /* dryRun */,
            FIELD_MANAGER,
            true /* force */,
            PatchStrategy.ServerSideApply,
          );
          ctx.logger.info(`Applied ${describe(applied)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to apply ${describe(spec)}: ${message}`);
        }
      }
    },
  });
}
