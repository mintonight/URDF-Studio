import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import type { RobotFile } from '@/types';
import { validateMJCFImportExternalAssets } from './mjcfImportValidation.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function createMjcfFile(name: string, content: string): RobotFile {
  return {
    name,
    content,
    format: 'mjcf',
  };
}

test('validateMJCFImportExternalAssets accepts runtime-resolvable myosuite arm mesh paths', () => {
  const content = `
    <mujoco>
      <compiler meshdir="../../../../simhive/myo_sim" />
      <asset>
        <mesh name="body_nohand" file="../myo_sim/meshes/human_lowpoly_nohand.stl" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/envs/myo/assets/arm/myoarm_bionic_bimanual.xml',
    content,
    [createMjcfFile('myosuite/simhive/myo_sim/arm/myoarm.xml', '<mujoco><worldbody /></mujoco>')],
    {
      'myosuite/simhive/myo_sim/meshes/human_lowpoly_nohand.stl': 'blob:human-lowpoly-nohand',
    },
  );

  assert.deepEqual(issues, []);
});

test('validateMJCFImportExternalAssets accepts runtime-resolvable duplicate-prefix paths', () => {
  const content = `
    <mujoco>
      <compiler meshdir="../../../../simhive/myo_sim" />
      <asset>
        <mesh name="tabletennis_table" file="../../envs/myo/assets/tabletennis_table.obj" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/envs/myo/assets/arm/myoarm_tabletennis.xml',
    content,
    [],
    {
      'myosuite/envs/myo/assets/tabletennis_table.obj': 'blob:tabletennis-table',
    },
  );

  assert.deepEqual(issues, []);
});

test('validateMJCFImportExternalAssets accepts compiler-normalized bundle paths', () => {
  const content = `
    <mujoco>
      <compiler meshdir="../../../../simhive/myo_sim" />
      <asset>
        <mesh name="tabletennis_table" file="../../envs/myo/assets/tabletennis_table.obj" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/envs/myo/assets/arm/myoarm_tabletennis.xml',
    content,
    [],
    {
      'myosuite/envs/myo/assets/tabletennis_table.obj': 'blob:tabletennis-table',
    },
  );

  assert.deepEqual(issues, []);
});

test('validateMJCFImportExternalAssets tolerates a single duplicated path segment after compiler normalization', () => {
  const content = `
    <mujoco>
      <compiler meshdir=".." />
      <asset>
        <mesh name="meshscene" file="../myo_sim/scene/myosuite_scene_noFloor.msh" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/simhive/myo_sim/scene/myosuite_scene.xml',
    content,
    [],
    {
      'myosuite/simhive/myo_sim/scene/myosuite_scene_noFloor.msh': 'blob:scene-msh',
    },
  );

  assert.deepEqual(issues, []);
});

test('validateMJCFImportExternalAssets still reports genuinely missing external assets', () => {
  const content = `
    <mujoco>
      <asset>
        <mesh name="missing_mesh" file="../meshes/not-there.stl" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets('robots/demo/scene.xml', content, [], {});

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.referenceKind, 'mesh');
  assert.equal(issues[0]?.rawPath, '../meshes/not-there.stl');
  assert.equal(issues[0]?.resolvedPath, 'robots/meshes/not-there.stl');
});

test('validateMJCFImportExternalAssets does not rescue broken relative suffix matches', () => {
  const content = `
    <mujoco>
      <asset>
        <texture
          name="soccer_ball"
          type="cube"
          fileright="../../envs/myo/assets/leg_soccer/soccer_assets/soccer_scene/soccer_ball/right.png"
        />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/envs/myo/assets/leg_soccer/soccer_assets/soccer_scene/soccer_ball.xml',
    content,
    [],
    {
      'myosuite/envs/myo/assets/leg_soccer/soccer_assets/soccer_scene/soccer_ball/right.png':
        'blob:right-texture',
    },
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.referenceKind, 'texture');
  assert.equal(
    issues[0]?.resolvedPath,
    'myosuite/envs/myo/assets/leg_soccer/envs/myo/assets/leg_soccer/soccer_assets/soccer_scene/soccer_ball/right.png',
  );
});

test('validateMJCFImportExternalAssets does not rescue approximate filename matches', () => {
  const content = `
    <mujoco>
      <asset>
        <mesh name="ping_pong_paddle_mesh" file="Ping_Pong_Paddle.obj" />
      </asset>
      <worldbody />
    </mujoco>
  `;

  const issues = validateMJCFImportExternalAssets(
    'myosuite/envs/myo/assets/paddle.xml',
    content,
    [],
    {
      'myosuite/envs/myo/assets/paddle.obj': 'blob:paddle-obj',
    },
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.referenceKind, 'mesh');
  assert.equal(issues[0]?.resolvedPath, 'myosuite/envs/myo/assets/Ping_Pong_Paddle.obj');
});
