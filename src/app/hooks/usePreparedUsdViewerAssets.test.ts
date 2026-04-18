import assert from 'node:assert/strict';
import test from 'node:test';

import type { RobotFile } from '@/types';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import { buildPreparedUsdViewerAssetDescriptors } from './usePreparedUsdViewerAssets.ts';

function createUsdFile(name: string): RobotFile {
  return {
    name,
    format: 'usd',
    content: '',
  };
}

test('buildPreparedUsdViewerAssetDescriptors includes explicit USD source files outside assembly mode', () => {
  const sourceFile = createUsdFile('unitree_model/B2/usd/b2.viewer_roundtrip.usd');
  const meshBlob = new Blob(['obj-data'], { type: 'text/plain' });

  const descriptors = buildPreparedUsdViewerAssetDescriptors({
    assemblyState: null,
    availableFiles: [sourceFile],
    additionalSourceFiles: [sourceFile],
    getUsdPreparedExportCache: (path) =>
      path === sourceFile.name
        ? {
            meshFiles: {
              FR_calf_visual_0_section_0: meshBlob,
              'FR_calf_visual_0_section_0.obj': meshBlob,
            },
          }
        : null,
  });

  assert.deepEqual(descriptors, [
    {
      assetPath: resolveImportedAssetPath('FR_calf_visual_0_section_0', sourceFile.name),
      blob: meshBlob,
      cacheKey: `${sourceFile.name}::FR_calf_visual_0_section_0`,
    },
    {
      assetPath: resolveImportedAssetPath('FR_calf_visual_0_section_0.obj', sourceFile.name),
      blob: meshBlob,
      cacheKey: `${sourceFile.name}::FR_calf_visual_0_section_0.obj`,
    },
  ]);
});
