import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { PatchStrategy } from '@kubernetes/client-node';
import { createKubernetesApplyAction } from './kubernetesApply';

// Every test that opts into waitForReadyTimeoutSeconds passes this no-op
// `wait` so the action's internal polling loop doesn't actually sleep -
// the loop still runs its full attempt count, it just does so instantly.
const noWait = () => Promise.resolve();

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

  it('waits for a manifest to become Ready before completing, when asked to', async () => {
    const applied = {
      kind: 'XStorageAccount',
      metadata: { name: 'my-test-storage', namespace: 'demo' },
    };
    const patch = jest.fn().mockResolvedValue(applied);
    const read = jest
      .fn()
      .mockResolvedValueOnce({
        status: { conditions: [{ type: 'Ready', status: 'False' }] },
      })
      .mockResolvedValueOnce({
        status: { conditions: [{ type: 'Ready', status: 'True' }] },
      });
    const del = jest.fn();
    const action = createKubernetesApplyAction(
      () => ({ patch, read, delete: del } as any),
      noWait,
    );
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
        waitForReadyTimeoutSeconds: 30,
      },
    });

    await action.handler(ctx);

    expect(read).toHaveBeenCalledTimes(2);
    expect(del).not.toHaveBeenCalled();
  });

  it('rolls back everything applied in this step if it never becomes Ready', async () => {
    const applied = {
      kind: 'XStorageAccount',
      metadata: { name: 'my-test-storage', namespace: 'demo' },
    };
    const patch = jest.fn().mockResolvedValue(applied);
    const read = jest.fn().mockResolvedValue({
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            reason: 'ReconcileError',
            message: '409 Conflict: storage account name already taken',
          },
        ],
      },
    });
    const del = jest.fn().mockResolvedValue(undefined);
    const action = createKubernetesApplyAction(
      () => ({ patch, read, delete: del } as any),
      noWait,
    );
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
        waitForReadyTimeoutSeconds: 6,
      },
    });

    await expect(action.handler(ctx)).rejects.toThrow(/Timed out/);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(applied);
  });

  it('rolls back already-applied manifests if a later one in the same step fails to apply', async () => {
    const first = { kind: 'ConfigMap', metadata: { name: 'a', namespace: 'demo' } };
    const patch = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('403 Forbidden'));
    const del = jest.fn().mockResolvedValue(undefined);
    const action = createKubernetesApplyAction(
      () => ({ patch, delete: del } as any),
      noWait,
    );
    const ctx = createMockActionContext({
      input: {
        manifest: [
          'apiVersion: v1',
          'kind: ConfigMap',
          'metadata:',
          '  name: a',
          '  namespace: demo',
          '---',
          'apiVersion: v1',
          'kind: ConfigMap',
          'metadata:',
          '  name: b',
          '  namespace: demo',
        ].join('\n'),
        waitForReadyTimeoutSeconds: 30,
      },
    });

    await expect(action.handler(ctx)).rejects.toThrow(
      /Failed to apply ConfigMap\/b.*403 Forbidden/,
    );
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(first);
  });

  it('surfaces the original failure even if the rollback delete itself fails', async () => {
    const applied = {
      kind: 'XStorageAccount',
      metadata: { name: 'my-test-storage', namespace: 'demo' },
    };
    const patch = jest.fn().mockResolvedValue(applied);
    const read = jest.fn().mockResolvedValue({
      status: { conditions: [{ type: 'Ready', status: 'False' }] },
    });
    const del = jest.fn().mockRejectedValue(new Error('delete also failed'));
    const action = createKubernetesApplyAction(
      () => ({ patch, read, delete: del } as any),
      noWait,
    );
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
        waitForReadyTimeoutSeconds: 3,
      },
    });

    await expect(action.handler(ctx)).rejects.toThrow(/Timed out/);
  });
});
