import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type { GenerateEditableRobotSourceOptions } from '@/app/utils/generateEditableRobotSource';
import type { RobotImportWorkerResponse } from '@/app/utils/robotImportWorker';
import {
  DEFAULT_LINK,
  GeometryType,
  type AssemblyState,
  type RobotFile,
  type RobotState,
} from '@/types';

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

test('useDeferredWorkspaceSourceSync preserves URDF mesh paths for component sources', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const syncCalls: Array<{ fileName: string; content: string }> = [];
  const selectedFile = {
    name: 'pr2_description/urdf/pr2_simplified.urdf',
    format: 'urdf',
    content: '<robot name="pr2" />',
  } as const satisfies RobotFile;
  const componentRobot: RobotState = {
    name: 'pr2',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'pr2_description/meshes/base_v0/base.stl',
        },
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };
  const assemblyState: AssemblyState = {
    name: 'pr2_assembly',
    components: {
      pr2: {
        id: 'pr2',
        name: 'pr2',
        sourceFile: selectedFile.name,
        robot: componentRobot,
        visible: true,
      },
    },
    bridges: {},
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(DeferredHookHarness, {
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
            assert.fail('immediate sync should use syncTextFileContent for the selected file');
          },
          setAvailableFiles: () => {
            assert.fail('immediate sync should use syncTextFileContent for available files');
          },
          setAllFileContents: () => {
            assert.fail('immediate sync should use syncTextFileContent for cached file content');
          },
        }),
      );
    });

    const worker = workerEnv.instances[0];
    assert.ok(worker, 'expected worker to be created');
    assert.equal(worker.postedMessages.length, 1);
    const request = worker.postedMessages[0] as {
      requestId: number;
      type: string;
      options: GenerateEditableRobotSourceOptions;
    };
    assert.equal(request.type, 'generate-editable-robot-source');
    assert.equal(request.options.format, 'urdf');
    assert.equal(request.options.preserveMeshPaths, true);
    assert.equal(
      request.options.robotState.links.base_link?.visual.meshPath,
      'pr2_description/meshes/base_v0/base.stl',
    );

    await act(async () => {
      worker.emitMessage({
        type: 'generate-editable-robot-source-result',
        requestId: request.requestId,
        result: '<robot name="pr2" />',
      });
      await Promise.resolve();
    });

    assert.deepEqual(syncCalls, [
      {
        fileName: selectedFile.name,
        content: '<robot name="pr2" />',
      },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});

test('useDeferredWorkspaceSourceSync does not overwrite SDF component sources', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const selectedFile = {
    name: 'arm_part/model.sdf',
    format: 'sdf',
    content: `<sdf version="1.7">
  <model name="arm_part">
    <link name="link">
      <visual name="visual">
        <geometry><mesh><uri>model://arm_part/meshes/arm.dae</uri></mesh></geometry>
        <material>
          <script>
            <uri>model://arm_part/materials/scripts</uri>
            <name>ArmPart/Diffuse</name>
          </script>
        </material>
      </visual>
    </link>
  </model>
</sdf>`,
  } as const satisfies RobotFile;
  const assemblyState: AssemblyState = {
    name: 'demo_assembly',
    components: {
      arm_part_1: {
        id: 'arm_part_1',
        name: 'arm_part_1',
        sourceFile: selectedFile.name,
        robot: createRobotState('arm_part_1'),
        visible: true,
      },
    },
    bridges: {},
  };
  const allFileContents = {
    [selectedFile.name]: selectedFile.content,
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(DeferredHookHarness, {
          shouldRenderAssembly: true,
          assemblyState,
          isCodeViewerOpen: false,
          selectedFile,
          availableFiles: [selectedFile],
          allFileContents,
          generatedSourceCache: new Map<string, string>(),
          syncTextFileContent: () => {
            assert.fail('SDF component sources should not be synced through generated output');
          },
          setSelectedFile: () => {
            assert.fail('selected SDF file should not be overwritten');
          },
          setAvailableFiles: () => {
            assert.fail('available SDF file should not be overwritten');
          },
          setAllFileContents: () => {
            assert.fail('SDF text cache should not be overwritten');
          },
        }),
      );
      await wait(30);
    });

    assert.equal(workerEnv.instances.length, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});

test('useDeferredWorkspaceSourceSync skips source files shared by multiple components', async () => {
  // Regression: importing two instances of the same robot (e.g. several KUKA
  // kr16) yields two assembly components that share one imported source file but
  // hold differently namespaced robot data. Generating each instance's editable
  // source and writing it back into the single shared library slot used to
  // ping-pong between instances every render and trip React's "Maximum update
  // depth exceeded", blanking the whole app. The shared source file must be left
  // untouched (no generation, no write-back).
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const selectedFile = {
    name: 'kuka_kr16_support/urdf/kr16_2.urdf',
    format: 'urdf',
    content: '<robot name="kuka_kr16_2" />',
  } as const satisfies RobotFile;
  const assemblyState: AssemblyState = {
    name: 'kuka_assembly',
    components: {
      kuka_kr16_2: {
        id: 'kuka_kr16_2',
        name: 'kuka_kr16_2',
        sourceFile: selectedFile.name,
        robot: createRobotState('kuka_kr16_2'),
        visible: true,
      },
      kuka_kr16_2_1: {
        id: 'kuka_kr16_2_1',
        name: 'kuka_kr16_2_1',
        sourceFile: selectedFile.name,
        robot: createRobotState('kuka_kr16_2_1'),
        visible: true,
      },
    },
    bridges: {},
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(DeferredHookHarness, {
          shouldRenderAssembly: true,
          assemblyState,
          isCodeViewerOpen: false,
          selectedFile,
          availableFiles: [selectedFile],
          allFileContents: {
            [selectedFile.name]: selectedFile.content,
          },
          generatedSourceCache: new Map<string, string>(),
          syncTextFileContent: () => {
            assert.fail('source files shared by multiple components should not be synced');
          },
          setSelectedFile: () => {
            assert.fail('shared component source file should not be overwritten');
          },
          setAvailableFiles: () => {
            assert.fail('shared component source file should not be overwritten');
          },
          setAllFileContents: () => {
            assert.fail('shared component source file should not be overwritten');
          },
        }),
      );
      await wait(30);
    });

    assert.equal(workerEnv.instances.length, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});

test('useDeferredWorkspaceSourceSync does not overwrite MJCF component sources', async () => {
  const { dom, root } = createComponentRoot();
  const workerEnv = createFakeWorkerEnvironment();
  const selectedFile = {
    name: 'unitree_go2/go2.xml',
    format: 'mjcf',
    content: '<mujoco model="go2"><worldbody><body name="base" /></worldbody></mujoco>',
  } as const satisfies RobotFile;
  const assemblyState: AssemblyState = {
    name: 'demo_assembly',
    components: {
      go2_1: {
        id: 'go2_1',
        name: 'go2_1',
        sourceFile: selectedFile.name,
        robot: createRobotState('go2_1'),
        visible: true,
      },
    },
    bridges: {},
  };
  const allFileContents = {
    [selectedFile.name]: selectedFile.content,
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(DeferredHookHarness, {
          shouldRenderAssembly: true,
          assemblyState,
          isCodeViewerOpen: false,
          selectedFile,
          availableFiles: [selectedFile],
          allFileContents,
          generatedSourceCache: new Map<string, string>(),
          syncTextFileContent: () => {
            assert.fail('MJCF component sources should not be synced through generated output');
          },
          setSelectedFile: () => {
            assert.fail('selected MJCF file should not be overwritten');
          },
          setAvailableFiles: () => {
            assert.fail('available MJCF file should not be overwritten');
          },
          setAllFileContents: () => {
            assert.fail('MJCF text cache should not be overwritten');
          },
        }),
      );
      await wait(30);
    });

    assert.equal(workerEnv.instances.length, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
    workerEnv.restore();
    dom.window.close();
  }
});
