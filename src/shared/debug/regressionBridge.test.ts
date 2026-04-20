import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRegressionSnapshot,
  installRegressionDebugApi,
  setRegressionAppHandlers,
  setRegressionRuntimeRobot,
} from './regressionBridge';

test('getRegressionSnapshot summarizes joint-only runtime proxies without requiring traverse()', () => {
  setRegressionRuntimeRobot({
    name: 'usd-runtime-proxy',
    joints: {
      arm_joint: {
        name: 'arm_joint',
        type: 'revolute',
        jointType: 'revolute',
        angle: Math.PI / 4,
        axis: [0, 0, 1],
        limit: {
          lower: -Math.PI / 2,
          upper: Math.PI / 2,
        },
      },
    },
  });

  const snapshot = getRegressionSnapshot();

  assert.equal(snapshot.runtime?.name, 'usd-runtime-proxy');
  assert.equal(snapshot.runtime?.linkCount, 0);
  assert.equal(snapshot.runtime?.jointCount, 1);
  assert.deepEqual(snapshot.runtime?.joints, [
    {
      name: 'arm_joint',
      type: 'revolute',
      angle: Math.PI / 4,
      axis: [0, 0, 1],
      limit: {
        lower: -Math.PI / 2,
        upper: Math.PI / 2,
      },
    },
  ]);

  setRegressionRuntimeRobot(null);
});

test('regression debug API summarizes USD visual materials from stored scene snapshots', () => {
  setRegressionAppHandlers({
    getAvailableFiles: () => [
      {
        name: 'robots/demo/demo.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
    ],
    getSelectedFile: () => ({
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0',
    }),
    getUsdSceneSnapshot: () => ({
      stageSourcePath: 'robots/demo/demo.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        rootLinkPaths: ['/Robot/base_link'],
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            resolvedPrimPath: '/Robot/base_link/visuals/body',
            sectionName: 'visuals',
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/Robot/Looks/Black' },
                { start: 3, length: 3, materialId: '/Robot/Looks/DarkGray' },
              ],
            },
          },
        ],
        materials: [
          {
            materialId: '/Robot/Looks/Black',
            name: 'material_______023',
            shaderName: 'UsdPreviewSurface',
            color: [0, 0, 0],
          },
          {
            materialId: '/Robot/Looks/DarkGray',
            name: 'material_______024',
            shaderName: 'UsdPreviewSurface',
            color: [0.035, 0.035, 0.035],
          },
        ],
      },
    }),
    getDocumentLoadState: () => ({
      status: 'ready',
      fileName: 'robots/demo/demo.usd',
      format: 'usd',
      error: null,
    }),
    getRobotState: () => ({
      name: 'demo',
      rootLinkId: 'base_link',
      links: {},
      joints: {},
      selection: { type: null, id: null },
    }),
    getAssetDebugState: () => ({
      appAssetKeys: ['robots/demo/demo.usd'],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    loadRobotByName: async (fileName: string) => ({
      loaded: fileName === 'robots/demo/demo.usd',
      selectedFile: fileName,
    }),
  });

  const targetWindow = {} as Window;
  installRegressionDebugApi(targetWindow);

  const summary = targetWindow.__URDF_STUDIO_DEBUG__?.getSelectedUsdVisualMaterialSummary?.();
  assert.deepEqual(summary, {
    meshes: [
      {
        meshId: '/Robot/base_link/visuals.proto_mesh_id0',
        linkPath: '/Robot/base_link',
        overrideColor: null,
        hasOverrideMaterial: false,
        materials: [
          {
            name: 'material_______023',
            type: 'UsdPreviewSurface',
            color: '#000000',
            emissive: null,
          },
          {
            name: 'material_______024',
            type: 'UsdPreviewSurface',
            color: '#090909',
            emissive: null,
          },
        ],
      },
    ],
  });

  setRegressionAppHandlers(null);
});

test('regression debug API waits for final USD handoff runtime before resolving bootstrap loads', async () => {
  const fileName = 'robots/demo/demo.usd';
  const targetWindow = {
    __usdStageLoadDebugHistory: [],
  } as unknown as Window & {
    __usdStageLoadDebugHistory: Array<Record<string, unknown>>;
  };
  let documentLoadState = {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  } as {
    status: string;
    fileName: string | null;
    format: string | null;
    error: string | null;
  };

  setRegressionRuntimeRobot(null);
  setRegressionAppHandlers({
    getAvailableFiles: () => [
      {
        name: fileName,
        format: 'usd',
        content: '#usda 1.0',
      },
    ],
    getSelectedFile: () => ({
      name: fileName,
      format: 'usd',
      content: '#usda 1.0',
    }),
    getUsdSceneSnapshot: () => null,
    getDocumentLoadState: () => documentLoadState,
    getRobotState: () => ({
      name: 'demo',
      rootLinkId: 'base_link',
      links: {},
      joints: {},
      selection: { type: null, id: null },
    }),
    getAssetDebugState: () => ({
      appAssetKeys: [fileName],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    loadRobotByName: async (requestedFileName: string) => {
      documentLoadState = {
        status: 'loading',
        fileName: requestedFileName,
        format: 'usd',
        error: null,
      };
      targetWindow.__usdStageLoadDebugHistory.push({
        sourceFileName: requestedFileName,
        step: 'commit-worker-robot-data',
        status: 'resolved',
        timestamp: Date.now(),
        detail: {
          linkCount: 0,
          jointCount: 0,
        },
      });
      globalThis.setTimeout(() => {
        setRegressionRuntimeRobot({
          name: 'usd-runtime-proxy',
          links: {},
          joints: {},
        });
        targetWindow.__usdStageLoadDebugHistory.push({
          sourceFileName: requestedFileName,
          step: 'resolve-runtime-robot-data',
          status: 'resolved',
          timestamp: Date.now(),
          detail: {},
        });
        documentLoadState = {
          status: 'ready',
          fileName: requestedFileName,
          format: 'usd',
          error: null,
        };
      }, 20);

      return {
        loaded: true,
        selectedFile: requestedFileName,
      };
    },
  });

  installRegressionDebugApi(targetWindow);

  const result = await targetWindow.__URDF_STUDIO_DEBUG__?.loadRobotByName(fileName);

  assert.equal(result?.loaded, true);
  assert.equal(result?.snapshot.runtime?.name, 'usd-runtime-proxy');

  setRegressionRuntimeRobot(null);
  setRegressionAppHandlers(null);
});
