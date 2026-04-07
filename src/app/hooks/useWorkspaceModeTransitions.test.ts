import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK } from '@/types/constants';
import type { RobotData, RobotFile, UsdPreparedExportCache, UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData';

import { resolveUsdAssemblySeedRobotData } from './useWorkspaceModeTransitions.ts';

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
