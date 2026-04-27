import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { resolveSelectionCommitHoverAction } from './selectionCommitHoverPolicy.ts';

test('preserves hover for committed link geometry clicks', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'base_link',
      linkId: 'base_link',
      subType: 'visual',
      targetKind: 'geometry',
      objectIndex: 2,
      highlightTarget: mesh,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: 'base_link',
        subType: 'visual',
        objectIndex: 2,
        highlightObjectId: mesh.id,
      },
    },
  );
});

test('preserves hover for collision geometry even when objectIndex metadata is absent', () => {
  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'base_link',
      linkId: 'base_link',
      subType: 'collision',
      targetKind: 'geometry',
      objectIndex: undefined,
      highlightTarget: undefined,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: 'base_link',
        subType: 'collision',
        objectIndex: 0,
        highlightObjectId: undefined,
      },
    },
  );
});

test('clears hover after committed helper selections', () => {
  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'tool_tip',
      linkId: 'tool_tip',
      subType: undefined,
      targetKind: 'helper',
      objectIndex: undefined,
      highlightTarget: undefined,
    }),
    { mode: 'clear' },
  );
});

test('clears hover after committed tendon selections', () => {
  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'tendon',
      id: 'finger_tendon',
      subType: undefined,
      targetKind: 'geometry',
      objectIndex: undefined,
      highlightTarget: undefined,
    }),
    { mode: 'clear' },
  );
});
