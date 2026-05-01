import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_UNITREE_MODEL_ENTRIES,
  findUnregisteredTopLevelUnitreeUsdEntrypoints,
  hasExpectedB2NormalDiagnostics,
  hasSceneBindingCoverage,
} from '../../../scripts/regression/validate_unitree_selected_browser.mjs';

test('registered Unitree model entries cover all top-level USD entrypoints', async () => {
  const missing = await findUnregisteredTopLevelUnitreeUsdEntrypoints();

  assert.deepEqual(missing, []);
});

test('B2 normal diagnostics require at least one repair and no reported post-repair low-dot meshes', () => {
  const b2Result = {
    selectedFileName: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
    selectedUsdNormalDiagnostics: {
      meshes: [
        {
          meshId: '/b2_description/FR_calf/visuals.proto_mesh_id0',
          resolvedPrimPath: '/b2_description/FR_calf/visuals/calf/mesh',
          normalDiagnostics: {
            normalRepairCount: 4,
            postRepairLowDotCount: 0,
          },
        },
        {
          meshId: '/b2/leg',
          normalDiagnostics: {
            normalRepairCount: 0,
            postRepairLowDotCount: 0,
          },
        },
      ],
    },
  };

  assert.equal(hasExpectedB2NormalDiagnostics(b2Result), true);
});

test('B2 normal diagnostics fail when no reported mesh has a positive repair count', () => {
  const b2Result = {
    selectedFileName: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
    selectedUsdSceneSummary: {
      meshes: [
        {
          normalDiagnostics: {
            normalRepairCount: 0,
            postRepairLowDotCount: 0,
          },
        },
      ],
    },
  };

  assert.equal(hasExpectedB2NormalDiagnostics(b2Result), false);
});

test('B2 normal diagnostics fail when a reported mesh retains low-dot normals after repair', () => {
  const b2Result = {
    selectedFileName: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
    selectedUsdSceneSummary: {
      meshes: [
        {
          normalDiagnostics: {
            normalRepairCount: 2,
            postRepairLowDotCount: 1,
          },
        },
      ],
    },
  };

  assert.equal(hasExpectedB2NormalDiagnostics(b2Result), false);
});

test('B2 normal diagnostics fail when reported post-repair low-dot count is not numeric zero', () => {
  const b2Result = {
    selectedFileName: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
    selectedUsdSceneSummary: {
      meshes: [
        {
          normalDiagnostics: {
            normalRepairCount: 2,
            postRepairLowDotCount: null,
          },
        },
      ],
    },
  };

  assert.equal(hasExpectedB2NormalDiagnostics(b2Result), false);
});

test('B2 normal diagnostics fail when the repaired mesh omits post-repair low-dot count', () => {
  const b2Result = {
    selectedFileName: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
    selectedUsdNormalDiagnostics: {
      meshes: [
        {
          normalDiagnostics: {
            normalRepairCount: 2,
          },
        },
      ],
    },
  };

  assert.equal(hasExpectedB2NormalDiagnostics(b2Result), false);
});

test('non-B2 models do not require B2 normal diagnostics', () => {
  const result = {
    selectedFileName: 'unitree_model/Go2/usd/go2.viewer_roundtrip.usd',
  };

  assert.equal(hasExpectedB2NormalDiagnostics(result), true);
});

test('registered Unitree entries remain explicit model keys', () => {
  assert.deepEqual(BUILTIN_UNITREE_MODEL_ENTRIES.map((entry) => entry.modelKey), [
    'Go2',
    'Go2W',
    'B2',
    'H1',
    'H1-2',
    'H1-2-Handless',
    'G1-23DoF',
    'G1-29DoF',
  ]);
});

test('scene binding coverage accepts worker-prepared mesh cache without runtime transforms', () => {
  assert.equal(
    hasSceneBindingCoverage({
      selectedFileName: 'unitree_model/Go2/usd/go2.viewer_roundtrip.usd',
      assetDebugState: {
        preparedUsdCacheKeysByFile: {
          'unitree_model/Go2/usd/go2.viewer_roundtrip.usd': ['base_visual_0.obj'],
        },
      },
      selectedUsdSceneSummary: {
        available: true,
        fileName: 'unitree_model/Go2/usd/go2.viewer_roundtrip.usd',
        baseLink: {
          found: true,
          visualDescriptorCount: 1,
          bindingSummary: {
            descriptorCount: 1,
            withDescriptorMaterialId: 0,
            withGeometryMaterialId: 0,
            withGeomSubsetSections: 1,
            withoutAnyMaterialBinding: 0,
          },
          bounds: {
            size: [0.45, 0.18, 0.19],
          },
          transform: null,
          runtimeLinkTransform: null,
          runtimeVisualMeshTransforms: [],
        },
      },
    }),
    true,
  );
});
