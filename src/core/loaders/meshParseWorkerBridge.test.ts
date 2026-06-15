import assert from 'node:assert/strict';
import test from 'node:test';

import { createColladaParseWorkerPoolClient } from './colladaParseWorkerBridge.ts';
import { createMeshParseWorkerPoolClient, resolveDefaultMeshParseWorkerCount } from './meshParseWorkerBridge.ts';
import { createObjParseWorkerPoolClient } from './objParseWorkerBridge.ts';
import type { WorkerLike } from '@/core/workers/workerPoolClient.ts';

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: unknown[] = [];

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

  terminate(): void {}

  emitMessage(data: unknown): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data });
    });
  }
}

function emitMeshParseResults(workers: FakeWorker[]): void {
  workers.forEach((worker) => {
    worker.postedMessages.forEach((message) => {
      const request = message as { requestId: number; type: string };
      if (request.type === 'parse-obj') {
        worker.emitMessage({
          type: 'parse-obj-result',
          requestId: request.requestId,
          result: {
            children: [],
            materialLibraries: [],
          },
        });
        return;
      }

      if (request.type === 'parse-collada') {
        worker.emitMessage({
          type: 'parse-collada-result',
          requestId: request.requestId,
          result: {
            kind: 'object-json',
            resourcePath: '',
            sceneJson: {},
          },
        });
      }
    });
  });
}

test('resolveDefaultMeshParseWorkerCount fills available CPU while capping high-core machines', () => {
  const originalNavigator = globalThis.navigator;

  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 2 },
    });
    assert.equal(resolveDefaultMeshParseWorkerCount(), 2);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 8 },
    });
    assert.equal(resolveDefaultMeshParseWorkerCount(), 7);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 64 },
    });
    assert.equal(resolveDefaultMeshParseWorkerCount(), 12);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});

test('shared mesh parse worker pool grows to the configured budget for OBJ tasks', async () => {
  const workers: FakeWorker[] = [];
  const meshClient = createMeshParseWorkerPoolClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    },
    getWorkerCount: () => 4,
  });
  const objClient = createObjParseWorkerPoolClient({ meshClient });

  const loads = Array.from({ length: 6 }, (_, index) => objClient.load(`/mesh-${index}.obj`));

  assert.equal(workers.length, 4);
  assert.equal(
    workers.every((worker) =>
      worker.postedMessages.every(
        (message) =>
          typeof (message as { dispatchedAtEpochMs?: unknown }).dispatchedAtEpochMs === 'number',
      ),
    ),
    true,
  );
  assert.equal(meshClient.getDiagnostics().workerCount, 4);
  assert.equal(meshClient.getDiagnostics().pendingCount, 6);

  emitMeshParseResults(workers);
  await Promise.all(loads);
  assert.equal(meshClient.getDiagnostics().pendingCount, 0);
});

test('OBJ and Collada bridge clients share one mesh parse worker budget', async () => {
  const workers: FakeWorker[] = [];
  const meshClient = createMeshParseWorkerPoolClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    },
    getWorkerCount: () => 3,
  });
  const objClient = createObjParseWorkerPoolClient({ meshClient });
  const colladaClient = createColladaParseWorkerPoolClient({ meshClient });

  const loads = [
    objClient.load('/a.obj'),
    colladaClient.loadSerialized('/b.dae'),
    objClient.load('/c.obj'),
    colladaClient.loadSerialized('/d.dae'),
    objClient.load('/e.obj'),
  ];

  assert.equal(workers.length, 3);
  assert.equal(meshClient.getDiagnostics().workerCount, 3);
  assert.equal(meshClient.getDiagnostics().pendingCount, 5);

  emitMeshParseResults(workers);
  await Promise.all(loads);
  assert.equal(meshClient.getDiagnostics().pendingCount, 0);
});
