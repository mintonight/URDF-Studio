import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { DEFAULT_LINK } from '@/types/constants';
import { useAssemblyStore } from '@/store';
import type {
  AssemblyState,
  RobotData,
  RobotFile,
  UsdPreparedExportCache,
  UsdSceneSnapshot,
} from '@/types';
import type { ViewerRobotDataResolution } from '@/features/editor';

import {
  resolveUsdAssemblySeedRobotData,
  useWorkspaceModeTransitions,
} from './useWorkspaceModeTransitions.ts';

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
  Object.defineProperty(globalThis, 'XMLSerializer', {
    configurable: true,
    writable: true,
    value: dom.window.XMLSerializer,
  });

  return dom;
}

function renderWorkspaceModeTransitionsHook(
  options: Partial<Parameters<typeof useWorkspaceModeTransitions>[0]> = {},
) {
  let hookValue: ReturnType<typeof useWorkspaceModeTransitions> | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  const activeFile =
    options.previewFile ?? options.selectedFile ?? createUrdfFile('robots/new.urdf');
  const robotData = createRobotData('new');

  function Probe() {
    hookValue = useWorkspaceModeTransitions({
      previewFile: activeFile,
      selectedFile: null,
      availableFiles: [activeFile],
      allFileContents: {},
      assets: {},
      getUsdPreparedExportCache: () => null,
      robotName: robotData.name,
      robotLinks: robotData.links,
      robotJoints: robotData.joints,
      rootLinkId: robotData.rootLinkId,
      robotMaterials: robotData.materials,
      closedLoopConstraints: robotData.closedLoopConstraints,
      setRobot: () => {},
      setSelection: () => {},
      showToast: () => {},
      t: {
        generateWorkspaceUrdfDisconnected: 'disconnected',
        generateWorkspaceUrdfUnavailable: 'unavailable',
        generateWorkspaceUrdfSuccess: 'success',
        addedComponent: 'added',
      },
      handleClosePreview: () => {},
      prepareAssemblyComponentForInsert: () => new Promise(() => {}),
      activateInsertedAssemblyComponent: () => {},
      addComponent: useAssemblyStore.getState().addComponent,
      initAssembly: useAssemblyStore.getState().initAssembly,
      onLoadRobot: () => {},
      pendingUsdAssemblyFileRef: { current: null },
      proModeRoundtripSessionRef: { current: null },
      ...options,
    });
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });

  assert.ok(hookValue, 'hook should render');

  return {
    hook: hookValue,
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function resetAssemblyStore() {
  useAssemblyStore.setState({
    assemblyState: null,
    assemblyRevision: 0,
    pendingAutoGroundComponentIds: [],
    _history: { past: [], future: [] },
    _activity: [],
  });
}

function createUrdfFile(name: string): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

function createSingleComponentAssembly(sourceFile: string): AssemblyState {
  return {
    name: 'assembly',
    components: {
      comp_old: {
        id: 'comp_old',
        name: 'old',
        sourceFile,
        robot: createRobotData('old'),
        visible: true,
      },
    },
    bridges: {},
  };
}

function createUsdFile(name = 'unitree_model/Go2W/usd/go2w.usd'): RobotFile {
  return {
    name,
    format: 'usd',
    content: '',
  };
}

function createRobotData(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
  };
}

function createPreparedCache(fileName: string, robotData: RobotData): UsdPreparedExportCache {
  return {
    stageSourcePath: fileName,
    robotData,
    meshFiles: {},
  };
}

test('resolveUsdAssemblySeedRobotData prefers prepared export cache for usd assembly seeding', () => {
  const activeFile = createUsdFile();
  const cachedRobotData = createRobotData('cached-go2w');

  const result = resolveUsdAssemblySeedRobotData({
    activeFile,
    selectedFile: activeFile,
    currentRobotData: createRobotData('live-go2w'),
    getUsdPreparedExportCache: (fileName) => {
      assert.equal(fileName, activeFile.name);
      return createPreparedCache(fileName, cachedRobotData);
    },
    getCurrentSceneSnapshot: () => {
      assert.fail('scene snapshot fallback should not run when prepared cache already exists');
    },
    prepareExportCacheFromSnapshot: () => {
      assert.fail('prepared cache rebuild should not run when prepared cache already exists');
    },
  });

  assert.equal(result.preResolvedRobotData, cachedRobotData);
  assert.equal(result.preparedCache, null);
  assert.equal(result.requiresRobotReload, false);
});

test('resolveUsdAssemblySeedRobotData reuses currently loaded usd robot data when cache is missing', () => {
  const activeFile = createUsdFile();
  const liveRobotData = createRobotData('live-go2w');
  let snapshotCalls = 0;

  const result = resolveUsdAssemblySeedRobotData({
    activeFile,
    selectedFile: activeFile,
    currentRobotData: liveRobotData,
    getUsdPreparedExportCache: () => null,
    getCurrentSceneSnapshot: () => {
      snapshotCalls += 1;
      return null;
    },
    prepareExportCacheFromSnapshot: () => {
      assert.fail(
        'prepared cache rebuild should not run when current usd robot data is already usable',
      );
    },
  });

  assert.equal(result.preResolvedRobotData, liveRobotData);
  assert.equal(result.preparedCache, null);
  assert.equal(result.requiresRobotReload, false);
  assert.equal(snapshotCalls, 0);
});

test('resolveUsdAssemblySeedRobotData rebuilds prepared cache from the current usd scene snapshot as a fallback', () => {
  const activeFile = createUsdFile();
  const snapshot = {
    stageSourcePath: activeFile.name,
  } satisfies UsdSceneSnapshot;
  const preparedCache = {
    ...createPreparedCache(activeFile.name, createRobotData('snapshot-go2w')),
    resolution: {
      robotData: createRobotData('snapshot-go2w'),
      stageSourcePath: activeFile.name,
      linkIdByPath: {},
      linkPathById: {},
      jointPathById: {},
      childLinkPathByJointId: {},
      parentLinkPathByJointId: {},
    } satisfies ViewerRobotDataResolution,
  };
  let snapshotRequest: { stageSourcePath?: string | null } | null = null;
  let preparedFromSnapshot: UsdSceneSnapshot | null = null;

  const result = resolveUsdAssemblySeedRobotData({
    activeFile,
    selectedFile: createUsdFile('unitree_model/Go2/usd/go2.usd'),
    currentRobotData: null,
    getUsdPreparedExportCache: () => null,
    getCurrentSceneSnapshot: (request) => {
      snapshotRequest = request;
      return snapshot;
    },
    prepareExportCacheFromSnapshot: (sceneSnapshot, options = {}) => {
      preparedFromSnapshot = sceneSnapshot;
      assert.equal(options.fileName, activeFile.name);
      return preparedCache;
    },
  });

  assert.deepEqual(snapshotRequest, { stageSourcePath: activeFile.name });
  assert.equal(preparedFromSnapshot, snapshot);
  assert.equal(result.preResolvedRobotData, preparedCache.robotData);
  assert.equal(result.preparedCache, preparedCache);
  assert.equal(result.requiresRobotReload, false);
});

test('resolveUsdAssemblySeedRobotData requests a fresh usd load when no usable seed data exists', () => {
  const activeFile = createUsdFile();

  const result = resolveUsdAssemblySeedRobotData({
    activeFile,
    selectedFile: createUsdFile('unitree_model/Go2/usd/go2.usd'),
    currentRobotData: {
      name: 'invalid-live',
      rootLinkId: '',
      links: {},
      joints: {},
    },
    getUsdPreparedExportCache: () => ({
      robotData: {
        name: 'invalid-cache',
        rootLinkId: '',
        links: {},
        joints: {},
      },
    }),
    getCurrentSceneSnapshot: () => null,
    prepareExportCacheFromSnapshot: () => {
      assert.fail('prepared cache rebuild should not run when no snapshot is available');
    },
  });

  assert.equal(result.preResolvedRobotData, null);
  assert.equal(result.preparedCache, null);
  assert.equal(result.requiresRobotReload, true);
});

test('handleSwitchTreeEditorToProMode appends the active preview file instead of resetting an existing assembly', () => {
  const dom = installDomEnvironment();
  resetAssemblyStore();
  useAssemblyStore.setState({
    assemblyState: createSingleComponentAssembly('robots/old.urdf'),
    assemblyRevision: 1,
  });

  const nextFile = createUrdfFile('robots/new.urdf');
  const rendered = renderWorkspaceModeTransitionsHook({
    previewFile: nextFile,
    selectedFile: createUrdfFile('robots/selected.urdf'),
  });

  try {
    flushSync(() => {
      rendered.hook.handleSwitchTreeEditorToProMode();
    });

    const assemblyState = useAssemblyStore.getState().assemblyState;
    assert.ok(assemblyState, 'assembly should stay initialized while new component prepares');
    const components = Object.values(assemblyState.components);
    assert.equal(components.length, 2);
    assert.ok(components.some((component) => component.sourceFile === 'robots/old.urdf'));
    assert.ok(components.some((component) => component.sourceFile === nextFile.name));
  } finally {
    rendered.cleanup();
    dom.window.close();
    resetAssemblyStore();
  }
});
