import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  shouldBlockBackgroundInteractionForGizmoHit,
  shouldPreserveSelectionForGizmoPointerDown,
} from './raycast.ts';

function createGizmoHit(axis: string | null): THREE.Object3D {
  const controls = new THREE.Group() as THREE.Group & {
    axis: string | null;
    dragging: boolean;
    isTransformControlsGizmo?: boolean;
  };
  controls.isTransformControlsGizmo = true;
  controls.axis = axis;
  controls.dragging = false;

  const hitObject = new THREE.Mesh();
  controls.add(hitObject);
  return hitObject;
}

test('shouldBlockBackgroundInteractionForGizmoHit blocks hover only for visible gizmo handles', () => {
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createGizmoHit('X')), true);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(createGizmoHit(null)), false);
  assert.equal(shouldBlockBackgroundInteractionForGizmoHit(new THREE.Mesh()), false);
});

test('shouldPreserveSelectionForGizmoPointerDown preserves selection only for visible gizmo handles', () => {
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createGizmoHit('X')), true);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(createGizmoHit(null)), false);
  assert.equal(shouldPreserveSelectionForGizmoPointerDown(new THREE.Mesh()), false);
});
