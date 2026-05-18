import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkerPoolClient,
  resolveDefaultWorkerCount,
  type WorkerLike,
} from './workerPoolClient.ts';

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: unknown[] = [];
  public terminated = false;

  addEventListener(type: string, handler: WorkerEventHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data });
    });
  }
}

test('createWorkerPoolClient grows workers lazily under concurrent pressure', async () => {
  const workers: FakeWorker[] = [];
  const client = createWorkerPoolClient<
    { requestId: number; type: 'ok'; result: string },
    string
  >({
    label: 'Lazy pool',
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    },
    poolSize: 3,
    getRequestId: (response) => response.requestId,
    isError: () => false,
    getError: () => '',
    getResult: (response) => response.result,
  });

  assert.equal(workers.length, 0);
  const first = client.dispatch({ type: 'work' });
  assert.equal(workers.length, 1);
  const second = client.dispatch({ type: 'work' });
  assert.equal(workers.length, 2);
  const third = client.dispatch({ type: 'work' });
  assert.equal(workers.length, 3);
  const fourth = client.dispatch({ type: 'work' });
  assert.equal(workers.length, 3);

  workers.forEach((worker, index) => {
    worker.postedMessages.forEach((message) => {
      const requestId = (message as { requestId: number }).requestId;
      worker.emitMessage({
        type: 'ok',
        requestId,
        result: `worker-${index}`,
      });
    });
  });

  assert.deepEqual(await Promise.all([first, second, third, fourth]), [
    'worker-0',
    'worker-1',
    'worker-2',
    'worker-0',
  ]);
});

test('resolveDefaultWorkerCount leaves one logical core for the main thread', () => {
  const originalNavigator = globalThis.navigator;

  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 8 },
    });
    assert.equal(resolveDefaultWorkerCount(), 7);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 64 },
    });
    assert.equal(resolveDefaultWorkerCount(), 10);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});
