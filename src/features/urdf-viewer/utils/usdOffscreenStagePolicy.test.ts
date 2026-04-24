import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldBootstrapUsdOffscreenStage,
  shouldUseUsdOffscreenStage,
} from './usdOffscreenStagePolicy.ts';

test('uses offscreen USD stage for worker-capable view and select modes by default', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps worker-capable USD loads on the offscreen stage even when focusTarget is set', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      focusTarget: 'base',
      sourceFile: {
        name: 'unitree_model/Go2/usd/go2.viewer_roundtrip.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps transform-heavy USD modes on the main-thread stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'translate',
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'measure',
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      showOrigins: true,
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      showJointAxes: true,
      workerRendererSupported: true,
    }),
    false,
  );
});

test('keeps articulated hand USD bundles on the main-thread stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'h1_2/h1_2.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
      availableFiles: [
        {
          name: 'h1_2/configuration/h1_2_base.usd',
          format: 'usd',
          content: '#usda 1.0',
        },
      ],
      workerRendererSupported: true,
    }),
    false,
  );
});

test('allows blob-backed large USDA sidecars on the offscreen worker stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'g1_description/g1_23dof.usda',
        format: 'usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/g1_23dof_physics.usda@]\n)\n',
        blobUrl: 'blob:g1-root',
      },
      availableFiles: [
        {
          name: 'g1_description/configuration/g1_23dof_physics.usda',
          format: 'usd',
          content: '#usda 1.0\n(\n  subLayers = [@g1_23dof_base.usda@]\n)\n',
          blobUrl: 'blob:g1-physics',
        },
        {
          name: 'g1_description/configuration/g1_23dof_base.usda',
          format: 'usd',
          content: '',
          blobUrl: 'blob:g1-base',
        },
      ],
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps B2 pure .usd roots on the stable main-thread path while generic USD roots stay on the worker stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: {
        name: 'B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'unitree_model/B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'demo_robot/root.usda',
        format: 'usd',
        content: '#usda 1.0',
      },
      workerRendererSupported: true,
    }),
    true,
  );
});

test('allows Unitree ROS text USDA B2 bundles on the offscreen worker stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'b2_description/urdf/b2_description.usda',
        format: 'usd',
        content: '#usda 1.0',
      },
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'b2w_description/urdf/b2w_description.usda',
        format: 'usd',
        content: '#usda 1.0',
      },
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps exported B2 roundtrip .usd roots on the stable main-thread path too', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: {
        name: 'b2_description/b2_description.usd',
        format: 'usd',
        content: '',
        blobUrl: 'blob:b2-roundtrip-root',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'unitree_model/B2/usd/b2.viewer_roundtrip.usd',
        format: 'usd',
        content: '',
        blobUrl: 'blob:b2-fixture-roundtrip',
      },
      availableFiles: [
        {
          name: 'unitree_model/B2/usd/configuration/b2_description_base.usd',
          format: 'usd',
          content: '',
        },
      ],
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'b2_description/b2_description.usd',
        format: 'usd',
        content: '',
        blobUrl: 'blob:b2-roundtrip-root',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'b2_description.usd',
        format: 'usd',
        content: '',
        blobUrl: 'blob:b2-roundtrip-flat',
      },
      workerRendererSupported: true,
    }),
    false,
  );
});

test('keeps handless pure .usd humanoid bundles on the main-thread stage too', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'h1_2_handless/h1_2_handless.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
      availableFiles: [
        {
          name: 'h1_2_handless/configuration/h1_2_handless_base.usd',
          format: 'usd',
          content: 'def PhysicsRevoluteJoint "left_shoulder_pitch_joint" {}',
        },
      ],
      workerRendererSupported: true,
    }),
    false,
  );
});

test('ignores unrelated blob-backed USDA sidecars that are outside the selected root scope', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'g1_description/g1_29dof.usda',
        format: 'usd',
        content:
          '#usda 1.0\ndef Xform "G1" (prepend references = @configuration/g1_29dof_base.usda@) {}',
        blobUrl: 'blob:g1-29-root',
      },
      availableFiles: [
        {
          name: 'g1_description/configuration/g1_29dof_base.usda',
          format: 'usd',
          content: '#usda 1.0',
          blobUrl: 'blob:g1-29-base',
        },
        {
          name: 'g1_description/configuration/g1_23dof_base.usda',
          format: 'usd',
          content: '',
          blobUrl: 'blob:g1-23-base',
        },
      ],
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps textual articulated hand USDA bundles on the main-thread stage', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'custom_hands/root.usda',
        format: 'usd',
        content: '#usda 1.0\ndef Xform "Robot" (prepend references = @config/robot_base.usda@) {}',
      },
      availableFiles: [
        {
          name: 'custom_hands/config/robot_base.usda',
          format: 'usd',
          content: 'def PhysicsRevoluteJoint "R_thumb_proximal_yaw_joint" {}',
        },
      ],
      workerRendererSupported: true,
    }),
    false,
  );
});

test('ignores unrelated hand sidecars that are not referenced by the selected USD root', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'g1_description/g1_29dof.usda',
        format: 'usd',
        content:
          '#usda 1.0\ndef Xform "G1" (prepend references = @configuration/g1_29dof_base.usda@) {}',
      },
      availableFiles: [
        {
          name: 'g1_description/configuration/g1_29dof_base.usda',
          format: 'usd',
          content: 'def PhysicsRevoluteJoint "left_shoulder_pitch_joint" {}',
        },
        {
          name: 'g1_description/configuration/g1_29dof_with_hand_base.usda',
          format: 'usd',
          content: 'def PhysicsRevoluteJoint "R_thumb_proximal_yaw_joint" {}',
        },
      ],
      workerRendererSupported: true,
    }),
    true,
  );
});

test('keeps default select-mode USD loads on the single interactive stage path', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'unitree_model/Go2/usd/go2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
});

test('keeps default B2 select-mode USD loads off the bootstrap handoff path', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      sourceFile: {
        name: 'unitree_model/B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'view',
      sourceFile: {
        name: 'unitree_model/B2/usd/b2.usd',
        format: 'usd',
        content: '',
      },
      workerRendererSupported: true,
    }),
    false,
  );
});

test('keeps explicit selection, hover, focus and non-select tools off the bootstrap handoff path', () => {
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'measure',
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      selection: { type: 'link', id: 'base' },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      hoveredSelection: { type: 'link', id: 'hip' },
      workerRendererSupported: true,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapUsdOffscreenStage({
      toolMode: 'select',
      focusTarget: 'hip_joint',
      workerRendererSupported: true,
    }),
    false,
  );
});

test('keeps normal selection, hover and focus state inside the offscreen-only USD path', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      selection: { type: 'link', id: 'base' },
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'select',
      hoveredSelection: { type: 'link', id: 'hip' },
      workerRendererSupported: true,
    }),
    true,
  );
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      focusTarget: 'hip_joint',
      workerRendererSupported: true,
    }),
    true,
  );
});

test('falls back when offscreen worker rendering is unavailable', () => {
  assert.equal(
    shouldUseUsdOffscreenStage({
      toolMode: 'view',
      workerRendererSupported: false,
    }),
    false,
  );
});
