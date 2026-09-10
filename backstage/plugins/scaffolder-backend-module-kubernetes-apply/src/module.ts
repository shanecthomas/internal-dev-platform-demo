import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createKubernetesApplyAction } from './actions';

/**
 * Registers `kubernetes:apply` with the scaffolder.
 *
 * @public
 */
export const kubernetesApplyModule = createBackendModule({
  moduleId: 'kubernetes-apply',
  pluginId: 'scaffolder',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(createKubernetesApplyAction());
      },
    });
  },
});
