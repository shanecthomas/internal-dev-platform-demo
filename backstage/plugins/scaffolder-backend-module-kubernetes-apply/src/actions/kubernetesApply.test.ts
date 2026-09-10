import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { PatchStrategy } from '@kubernetes/client-node';
import { createKubernetesApplyAction } from './kubernetesApply';

describe('kubernetes:apply', () => {
  it('applies a single manifest via server-side apply', async () => {
    const patch = jest.fn().mockResolvedValue({
      kind: 'XStorageAccount',
      metadata: { name: 'my-test-storage', namespace: 'demo' },
    });
    const action = createKubernetesApplyAction(() => ({ patch } as any));
    const ctx = createMockActionContext({
      input: {
        manifest: [
          'apiVersion: storage.idp-demo.io/v1alpha1',
          'kind: XStorageAccount',
          'metadata:',
          '  name: my-test-storage',
          '  namespace: demo',
          'spec:',
          '  name: mytestation123',
        ].join('\n'),
      },
    });

    await action.handler(ctx);

    expect(patch).toHaveBeenCalledTimes(1);
    const [spec, , , fieldManager, force, strategy] = patch.mock.calls[0];
    expect(spec).toMatchObject({
      kind: 'XStorageAccount',
      metadata: { name: 'my-test-storage', namespace: 'demo' },
    });
    expect(fieldManager).toBe('backstage-scaffolder');
    expect(force).toBe(true);
    expect(strategy).toBe(PatchStrategy.ServerSideApply);
  });

  it('applies every document in a multi-document manifest', async () => {
    const patch = jest.fn().mockResolvedValue({});
    const action = createKubernetesApplyAction(() => ({ patch } as any));
    const ctx = createMockActionContext({
      input: {
        manifest: [
          'apiVersion: v1',
          'kind: Namespace',
          'metadata:',
          '  name: demo',
          '---',
          'apiVersion: storage.idp-demo.io/v1alpha1',
          'kind: XStorageAccount',
          'metadata:',
          '  name: my-test-storage',
          '  namespace: demo',
          'spec:',
          '  name: mytestation123',
        ].join('\n'),
      },
    });

    await action.handler(ctx);

    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('rejects a manifest missing required fields', async () => {
    const patch = jest.fn();
    const action = createKubernetesApplyAction(() => ({ patch } as any));
    const ctx = createMockActionContext({
      input: { manifest: 'kind: XStorageAccount\n' },
    });

    await expect(action.handler(ctx)).rejects.toThrow(/missing apiVersion/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('wraps a cluster error with which manifest failed', async () => {
    const patch = jest.fn().mockRejectedValue(new Error('403 Forbidden'));
    const action = createKubernetesApplyAction(() => ({ patch } as any));
    const ctx = createMockActionContext({
      input: {
        manifest: [
          'apiVersion: storage.idp-demo.io/v1alpha1',
          'kind: XStorageAccount',
          'metadata:',
          '  name: my-test-storage',
        ].join('\n'),
      },
    });

    await expect(action.handler(ctx)).rejects.toThrow(
      /Failed to apply XStorageAccount\/my-test-storage.*403 Forbidden/,
    );
  });
});
