import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type { GenerateEditableRobotSourceOptions } from '@/app/utils/generateEditableRobotSource';
import type { RobotImportWorkerResponse } from '@/app/utils/robotImportWorker';
import { DEFAULT_LINK, type AssemblyState, type RobotFile, type RobotState } from '@/types';

import { disposeRobotImportWorker } from '../robotImportWorkerBridge';
import { useGeneratedRobotSource } from './useGeneratedRobotSource';
import { useDeferredWorkspaceSourceSync } from './useDeferredWorkspaceSourceSync';

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

  emitMessage(message: RobotImportWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 2,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, root };
}

function createFakeWorkerEnvironment() {
  const originalWorker = globalThis.Worker;
  const instances: FakeWorker[] = [];

  class WorkerStub extends FakeWorker {
    constructor(..._args: unknown[]) {
      super();
      instances.push(this);
    }
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: WorkerStub,
  });

  return {
    instances,
    restore() {
      disposeRobotImportWorker();
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        writable: true,
        value: originalWorker,
      });
    },
  };
}

function createRobotState(name: string): RobotState {
  const linkId = `${name}_base_link`;

  return {
    name,
    rootLinkId: linkId,
    links: {
      [linkId]: {
        ...DEFAULT_LINK,
        id: linkId,
        name: linkId,
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GeneratedHookHarnessProps {
  cacheKey: string | null;
  options: GenerateEditableRobotSourceOptions | null;
  onContent: (content: string | null) => void;
}

function GeneratedHookHarness({ cacheKey, options, onContent }: GeneratedHookHarnessProps) {
  const cacheRef = useRef(new Map<string, string>());
  const content = useGeneratedRobotSource({
    cache: cacheRef,
    cacheKey,
    options,
    scope: 'sourceSyncAsyncHooks:test',
  });

  useEffect(() => {
    onContent(content);
  }, [content, onContent]);

  return null;
}

type DeferredHookHarnessProps = Parameters<typeof useDeferredWorkspaceSourceSync>[0];

function DeferredHookHarness(props: DeferredHookHarnessProps) {
  useDeferredWorkspaceSourceSync(props);
  return null;
}

test('useGeneratedRobotSource ignores stale worker results after the request key changes', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const seenContent: Array<string | null> = [];
  let props: GeneratedHookHarnessProps = {
    cacheKey: 'robot:a',
    options: {
      format: 'urdf',
      robotState: createRobotState('robot_a'),
    },
    onContent: (content) => {
      seenContent.push(content);
    },
  };

  try {
    await act(async () => {
      root.render(React.createElement(GeneratedHookHarness, props));
    });

    const worker = workerEnv.instances[0];
    assert.ok(worker, 'expected worker to be created');
    assert.equal(worker.postedMessages.length, 1);
    const firstRequest = worker.postedMessages[0] as { requestId: number };

    props = {
      ...props,
      cacheKey: 'robot:b',
      options: {
        format: 'urdf',
        robotState: createRobotState('robot_b'),
      },
    };

    await act(async () => {
      root.render(React.createElement(GeneratedHookHarness, props));
    });

    assert.equal(worker.postedMessages.length, 2);
    const secondRequest = worker.postedMessages[1] as { requestId: number };

    await act(async () => {
      worker.emitMessage({
        type: 'generate-editable-robot-source-result',
        requestId: firstRequest.requestId,
        result: '<robot name="robot_a" />',
      });
      await Promise.resolve();
    });

    assert.notEqual(seenContent.at(-1), '<robot name="robot_a" />');

    await act(async () => {
      worker.emitMessage({
        type: 'generate-editable-robot-source-result',
        requestId: secondRequest.requestId,
        result: '<robot name="robot_b" />',
      });
      await Promise.resolve();
    });

    assert.equal(seenContent.at(-1), '<robot name="robot_b" />');
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});

test('useGeneratedRobotSource ignores late worker results after the request is cleared', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  let latestContent: string | null = 'sentinel';
  let props: GeneratedHookHarnessProps = {
    cacheKey: 'robot:a',
    options: {
      format: 'urdf',
      robotState: createRobotState('robot_a'),
    },
    onContent: (content) => {
      latestContent = content;
    },
  };

  try {
    await act(async () => {
      root.render(React.createElement(GeneratedHookHarness, props));
    });

    const worker = workerEnv.instances[0];
    assert.ok(worker, 'expected worker to be created');
    const firstRequest = worker.postedMessages[0] as { requestId: number };

    props = {
      ...props,
      cacheKey: null,
      options: null,
    };

    await act(async () => {
      root.render(React.createElement(GeneratedHookHarness, props));
    });

    assert.equal(latestContent, null);

    await act(async () => {
      worker.emitMessage({
        type: 'generate-editable-robot-source-result',
        requestId: firstRequest.requestId,
        result: '<robot name="robot_a" />',
      });
      await Promise.resolve();
    });

    assert.equal(latestContent, null);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});

test('useDeferredWorkspaceSourceSync ignores late immediate results after the workspace sync is cancelled', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const syncCalls: Array<{ fileName: string; content: string }> = [];
  const selectedFile = {
    name: 'robots/demo/robot.urdf',
    format: 'urdf',
    content: '<robot name="demo" />',
  } as const satisfies RobotFile;
  const assemblyState: AssemblyState = {
    name: 'demo_assembly',
    components: {
      demo: {
        id: 'demo',
        name: 'demo',
        sourceFile: selectedFile.name,
        robot: createRobotState('demo'),
        visible: true,
      },
    },
    bridges: {},
  };

  let props: DeferredHookHarnessProps = {
    shouldRenderAssembly: true,
    assemblyState,
    isCodeViewerOpen: true,
    selectedFile,
    availableFiles: [selectedFile],
    allFileContents: {
      [selectedFile.name]: selectedFile.content,
    },
    generatedSourceCache: new Map<string, string>(),
    syncTextFileContent: (fileName, content) => {
      syncCalls.push({ fileName, content });
    },
    setSelectedFile: () => {
      assert.fail('setSelectedFile should not run after cancellation');
    },
    setAvailableFiles: () => {
      assert.fail('setAvailableFiles should not run after cancellation');
    },
    setAllFileContents: () => {
      assert.fail('setAllFileContents should not run after cancellation');
    },
  };

  try {
    await act(async () => {
      root.render(React.createElement(DeferredHookHarness, props));
    });

    const worker = workerEnv.instances[0];
    assert.ok(worker, 'expected worker to be created');
    assert.equal(worker.postedMessages.length, 1);
    const request = worker.postedMessages[0] as { requestId: number };

    props = {
      ...props,
      shouldRenderAssembly: false,
      assemblyState: null,
    };

    await act(async () => {
      root.render(React.createElement(DeferredHookHarness, props));
    });

    await act(async () => {
      worker.emitMessage({
        type: 'generate-editable-robot-source-result',
        requestId: request.requestId,
        result: '<robot name="demo_updated" />',
      });
      await Promise.resolve();
      await wait(20);
    });

    assert.deepEqual(syncCalls, []);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});
