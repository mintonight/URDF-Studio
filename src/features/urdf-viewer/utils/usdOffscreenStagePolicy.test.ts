import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldBootstrapUsdOffscreenStage,
  shouldUseUsdOffscreenStage,
} from './usdOffscreenStagePolicy.ts';

function usdFile(name: string, content = '#usda 1.0', blobUrl?: string) {
  return {
    name,
    format: 'usd' as const,
    content,
    ...(blobUrl ? { blobUrl } : {}),
  };
}

test('keeps the final USD viewer on the main-thread stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: usdFile('go2_description/urdf/go2_description.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('unitree_model/Go2/usd/go2.viewer_roundtrip.usd', ''),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('demo_robot/root.usda'),
      workerRendererSupported: false,
    }),
    false,
  );
});

test('keeps text USDA roots on the direct main viewer path to avoid duplicate stage rendering', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: usdFile('go2_description/urdf/go2_description.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('g1_description/g1_23dof.usda'),
      availableFiles: [
        usdFile(
          'g1_description/configuration/g1_23dof_physics.usda',
          '#usda 1.0\n(\n  subLayers = [@g1_23dof_base.usda@]\n)\n',
        ),
        usdFile('g1_description/configuration/g1_23dof_base.usda', ''),
      ],
      workerRendererSupported: true,
    }),
    false,
  );
});

test('allows non-USDA USD family roots to bootstrap when a real payload is available', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('unitree_model/Go2/usd/go2.viewer_roundtrip.usd', '', 'blob:go2-usd'),
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('robot/model.usdc', '', 'blob:model-usdc'),
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: usdFile('robot/package.usdz', ''),
      assets: {
        'robot/package.usdz': 'blob:package-usdz',
      },
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps USD family files on the direct main viewer path when no payload can be preloaded', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('unitree_model/Go2/usd/go2.viewer_roundtrip.usd', ''),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('robot/model.usdc', ''),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('robot/model.usdc', 'PXR-USDC binary bytes stored as text'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('robot/package.usdz', ''),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('robot/package.usdz', 'PK zipped bytes stored as text'),
      workerRendererSupported: true,
    }),
    false,
  );
});

test('does not bootstrap offscreen when the visible main viewer state must stay authoritative', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'measure',
      sourceFile: usdFile('demo_robot/root.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      selection: { type: 'link', id: 'base' },
      sourceFile: usdFile('demo_robot/root.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      hoveredSelection: { type: 'link', id: 'hip' },
      sourceFile: usdFile('demo_robot/root.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'view',
      focusTarget: 'hip_joint',
      sourceFile: usdFile('demo_robot/root.usda'),
      workerRendererSupported: true,
    }),
    false,
  );
});

test('skips offscreen bootstrap for unsupported worker USD bundles', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile('h1_2/h1_2.usd'),
      availableFiles: [usdFile('h1_2/configuration/h1_2_base.usd')],
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile(
        'custom_hands/root.usda',
        '#usda 1.0\ndef Xform "Robot" (prepend references = @config/robot_base.usda@) {}',
      ),
      availableFiles: [
        usdFile(
          'custom_hands/config/robot_base.usda',
          'def PhysicsRevoluteJoint "R_thumb_proximal_yaw_joint" {}',
        ),
      ],
      workerRendererSupported: true,
    }),
    false,
  );
});

test('ignores unrelated sidecars when deciding whether bootstrap is safe', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: usdFile(
        'g1_description/g1_29dof.usd',
        '#usda 1.0\ndef Xform "G1" (prepend references = @configuration/g1_29dof_base.usda@) {}',
      ),
      availableFiles: [
        usdFile('g1_description/configuration/g1_29dof_base.usda'),
        usdFile(
          'g1_description/configuration/g1_29dof_with_hand_base.usda',
          'def PhysicsRevoluteJoint "R_thumb_proximal_yaw_joint" {}',
        ),
      ],
      workerRendererSupported: true,
    }),
    true,
  );
});
