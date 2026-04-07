import test from 'node:test';
import assert from 'node:assert/strict';

import type { ProjectImportWorkerResponse } from './projectImportWorker.ts';
import { createProjectImportWorkerClient } from './projectImportWorkerBridge.ts';

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

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(message: ProjectImportWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }
}

test('project import worker client hydrates blob-backed library files on successful responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createProjectImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const projectFile = new File(['project-archive'], 'demo.usp', {
    type: 'application/octet-stream',
  });
  const resultPromise = client.import(projectFile, 'en');

  for (let attempt = 0; attempt < 10 && fakeWorker.postedMessages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number; file: File };
  assert.equal(postedRequest.file.name, 'demo.usp');

  fakeWorker.emitMessage({
    type: 'import-project-result',
    requestId: postedRequest.requestId,
    result: {
      manifest: {
        version: '1.0',
        name: 'demo_project',
        lastModified: '2026-04-05T00:00:00.000Z',
        ui: {},
        workspace: {
          selectedFile: 'robots/demo.usd',
        },
        assets: {
          availableFiles: [
            {
              name: 'robots/demo.usd',
              format: 'usd',
            },
          ],
          originalFileFormat: 'usd',
          assetEntries: [],
        },
      },
      assetFiles: [
        {
          name: 'robots/demo.usd',
          blob: new Blob(['USD-BYTES'], { type: 'application/octet-stream' }),
        },
      ],
      availableFiles: [
        {
          name: 'robots/demo.usd',
          format: 'usd',
          content: '',
          blobPath: 'robots/demo.usd',
        },
      ],
      allFileContents: {},
      motorLibrary: {},
      selectedFileName: 'robots/demo.usd',
      originalUrdfContent: '',
      originalFileFormat: 'usd',
      usdPreparedExportCaches: {},
      robotState: null,
      robotHistory: {
        past: [],
        future: [],
      },
      robotActivity: [],
      assemblyState: null,
      assemblyHistory: {
        past: [],
        future: [],
      },
      assemblyActivity: [],
    },
  });

  const result = await resultPromise;
  assert.match(result.assets['robots/demo.usd'] ?? '', /^blob:/);
  assert.match(result.availableFiles[0]?.blobUrl ?? '', /^blob:/);
});

test('project import worker client rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const client = createProjectImportWorkerClient();
    await assert.rejects(
      client.import(new File(['project'], 'demo.usp'), 'en'),
      /Web Worker is not available in this environment/i,
    );
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});
