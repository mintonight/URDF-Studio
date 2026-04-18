import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  applyWorkspaceCameraSnapshot,
  captureWorkspaceCameraSnapshot,
  resolveSnapshotPreviewSurfaceSize,
} from './workspaceCameraSnapshot';

test('captureWorkspaceCameraSnapshot reads the current camera and orbit target', () => {
  const camera = new THREE.PerspectiveCamera(52, 2, 0.1, 500);
  camera.position.set(4, 5, 6);
  camera.up.set(0, 1, 0);
  camera.zoom = 1.5;
  camera.lookAt(new THREE.Vector3(1, 2, 3));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const snapshot = captureWorkspaceCameraSnapshot({
    camera,
    controls: {
      target: new THREE.Vector3(1, 2, 3),
    },
    size: {
      width: 1200,
      height: 600,
    },
  } as any);

  assert.ok(snapshot, 'expected a workspace camera snapshot');
  assert.equal(snapshot?.aspectRatio, 2);
  assert.deepEqual(snapshot?.target, { x: 1, y: 2, z: 3 });
  assert.deepEqual(snapshot?.position, { x: 4, y: 5, z: 6 });
  assert.equal(snapshot?.zoom, 1.5);
  assert.equal(snapshot?.kind, 'perspective');
  assert.equal(snapshot?.fov, 52);
});

test('captureWorkspaceCameraSnapshot reads the live controls target from the current R3F store state', () => {
  const camera = new THREE.PerspectiveCamera(52, 2, 0.1, 500);
  camera.position.set(4, 5, 6);
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(1, 2, 3));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const liveControls = {
    target: new THREE.Vector3(1, 2, 3),
  };
  const staleCreatedState = {
    camera,
    controls: null,
    size: {
      width: 1200,
      height: 600,
    },
    get: () => ({
      camera,
      controls: liveControls,
      size: {
        width: 1200,
        height: 600,
      },
    }),
  };

  const snapshot = captureWorkspaceCameraSnapshot(staleCreatedState as any);

  assert.ok(snapshot, 'expected a workspace camera snapshot');
  assert.deepEqual(snapshot?.target, { x: 1, y: 2, z: 3 });
});

test('applyWorkspaceCameraSnapshot restores camera transform and orbit target', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  let controlsUpdated = false;
  const controls = {
    target: new THREE.Vector3(),
    update: () => {
      controlsUpdated = true;
    },
  };

  applyWorkspaceCameraSnapshot(camera, controls as any, {
    kind: 'perspective',
    position: { x: -3, y: 1.5, z: 9 },
    quaternion: { x: 0.05, y: 0.35, z: -0.1, w: 0.93 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1.25,
    target: { x: 2, y: -1, z: 0.5 },
    aspectRatio: 1.6,
    fov: 48,
    near: 0.25,
    far: 420,
  });

  assert.equal(camera.position.x, -3);
  assert.equal(camera.position.y, 1.5);
  assert.equal(camera.position.z, 9);
  assert.equal(camera.zoom, 1.25);
  assert.equal(camera.aspect, 1.6);
  assert.equal(camera.fov, 48);
  assert.equal(camera.near, 0.25);
  assert.equal(camera.far, 420);
  assert.ok(
    camera.quaternion.angleTo(new THREE.Quaternion(0.05, 0.35, -0.1, 0.93).normalize()) < 1e-6,
  );
  assert.deepEqual(controls.target.toArray(), [2, -1, 0.5]);
  assert.equal(controlsUpdated, true);
});

test('resolveSnapshotPreviewSurfaceSize preserves the frozen viewport aspect ratio', () => {
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(2), { width: 960, height: 480 });
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(0.5), { width: 480, height: 960 });
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(0), { width: 960, height: 960 });
});
