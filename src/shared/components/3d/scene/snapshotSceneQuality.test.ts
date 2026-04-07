import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { applySnapshotSceneVisibility } from './snapshotSceneQuality.ts';

test('applySnapshotSceneVisibility keeps visual content while hiding snapshot-excluded helpers', () => {
  const scene = new THREE.Scene();
  const visualMesh = new THREE.Object3D();
  const collisionMesh = new THREE.Object3D();
  const helper = new THREE.Object3D();
  const selectableHelper = new THREE.Object3D();
  const groundShadowPlane = new THREE.Object3D();
  const snapshotContactShadows = new THREE.Object3D();
  const grid = new THREE.Object3D();

  collisionMesh.userData.isCollisionMesh = true;
  helper.userData.isHelper = true;
  selectableHelper.userData.isSelectableHelper = true;
  groundShadowPlane.name = 'GroundShadowPlane';
  groundShadowPlane.userData.isHelper = true;
  snapshotContactShadows.name = 'SnapshotContactShadows';
  snapshotContactShadows.userData.isHelper = true;
  grid.name = 'ReferenceGrid';
  grid.userData.isHelper = true;

  scene.add(
    visualMesh,
    collisionMesh,
    helper,
    selectableHelper,
    groundShadowPlane,
    snapshotContactShadows,
    grid,
  );

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: false });

  assert.equal(visualMesh.visible, true);
  assert.equal(collisionMesh.visible, false);
  assert.equal(helper.visible, false);
  assert.equal(selectableHelper.visible, false);
  assert.equal(groundShadowPlane.visible, true);
  assert.equal(snapshotContactShadows.visible, true);
  assert.equal(grid.visible, true);

  restore();

  assert.equal(collisionMesh.visible, true);
  assert.equal(helper.visible, true);
  assert.equal(selectableHelper.visible, true);
  assert.equal(groundShadowPlane.visible, true);
  assert.equal(snapshotContactShadows.visible, true);
  assert.equal(grid.visible, true);
});

test('applySnapshotSceneVisibility hides the grid when requested', () => {
  const scene = new THREE.Scene();
  const grid = new THREE.Object3D();
  grid.name = 'ReferenceGrid';
  grid.userData.isHelper = true;
  scene.add(grid);

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: true });
  assert.equal(grid.visible, false);

  restore();
  assert.equal(grid.visible, true);
});

test('applySnapshotSceneVisibility hides known runtime helper names and viewer helper objects', () => {
  const scene = new THREE.Scene();
  const namedHelper = new THREE.Object3D();
  namedHelper.name = '__origin_axes__';
  const viewerHelper = new THREE.Object3D();
  viewerHelper.userData.viewerHelperKind = 'center-of-mass';

  scene.add(namedHelper, viewerHelper);

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: false });

  assert.equal(namedHelper.visible, false);
  assert.equal(viewerHelper.visible, false);

  restore();

  assert.equal(namedHelper.visible, true);
  assert.equal(viewerHelper.visible, true);
});
