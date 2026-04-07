import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeTexturePathForExport,
  resolveImportedAssetPath,
  rewriteUrdfAssetPathsForExport,
} from './meshPathUtils';

test('resolveImportedAssetPath keeps package assets rooted at the package name', () => {
  assert.equal(
    resolveImportedAssetPath(
      'package://scout_description/meshes/wheel.dae',
      'scout_description/urdf/scout_mini.urdf',
    ),
    'scout_description/meshes/wheel.dae',
  );
});

test('resolveImportedAssetPath keeps sdf model assets rooted at the model name', () => {
  assert.equal(
    resolveImportedAssetPath('model://bus_stop/meshes/base_link.dae', 'bus_stop/model.sdf'),
    'bus_stop/meshes/base_link.dae',
  );
});

test('resolveImportedAssetPath still resolves relative mesh paths against the source directory', () => {
  assert.equal(
    resolveImportedAssetPath('meshes/wheel.dae', 'scout_description/urdf/scout_mini.urdf'),
    'scout_description/urdf/meshes/wheel.dae',
  );
});

test('resolveImportedAssetPath preserves deep parent traversal for myosuite-style MJCF asset paths', () => {
  assert.equal(
    resolveImportedAssetPath(
      '../../../../simhive/myo_sim/../myo_sim/meshes/humerus.stl',
      'myosuite-main/myosuite/envs/myo/assets/hand/myohand_pen.xml',
    ),
    'myosuite-main/myosuite/simhive/myo_sim/meshes/humerus.stl',
  );
});

test('normalizeTexturePathForExport strips package texture roots for zipped exports', () => {
  assert.equal(
    normalizeTexturePathForExport('package://go2_description/textures/body/coat.png'),
    'body/coat.png',
  );
});

test('normalizeTexturePathForExport keeps nested relative texture folders stable', () => {
  assert.equal(
    normalizeTexturePathForExport('./textures/pbr/base_color.png'),
    'pbr/base_color.png',
  );
});

test('rewriteUrdfAssetPathsForExport preserves go2 multi-material visuals while rewriting asset roots', () => {
  const source = fs.readFileSync(
    'test/unitree_ros/robots/go2_description/urdf/go2_description.urdf',
    'utf8',
  );

  const rewritten = rewriteUrdfAssetPathsForExport(source, {
    exportRobotName: 'go2_description',
  });

  assert.match(rewritten, /<mesh filename="package:\/\/go2_description\/meshes\/dae\/base\.dae"/);

  const baseVisual = rewritten.match(/<link name="base">[\s\S]*?<visual>([\s\S]*?)<\/visual>/);
  assert.ok(baseVisual);
  assert.equal((baseVisual[1].match(/<material\b/g) || []).length, 5);
});
