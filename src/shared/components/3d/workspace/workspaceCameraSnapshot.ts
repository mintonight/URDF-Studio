import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';

export interface WorkspaceCameraSnapshot {
  kind: 'perspective';
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  up: { x: number; y: number; z: number };
  zoom: number;
  target: { x: number; y: number; z: number };
  aspectRatio: number;
  fov: number;
  near: number;
  far: number;
}

interface OrbitControlsLike {
  target: THREE.Vector3;
  update?: () => void;
}

function vectorToObject(vector: THREE.Vector3) {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function quaternionToObject(quaternion: THREE.Quaternion) {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function isPerspectiveCamera(camera: THREE.Camera): camera is THREE.PerspectiveCamera {
  return camera instanceof THREE.PerspectiveCamera;
}

export function captureWorkspaceCameraSnapshot(
  state: Pick<RootState, 'camera' | 'controls' | 'size' | 'get'>,
): WorkspaceCameraSnapshot | null {
  const resolvedState = typeof state.get === 'function' ? state.get() : state;

  if (!isPerspectiveCamera(resolvedState.camera)) {
    return null;
  }

  const controls = resolvedState.controls as unknown as OrbitControlsLike | undefined;
  const target = controls?.target ?? new THREE.Vector3(0, 0, 0);
  const aspectRatio =
    resolvedState.size.width > 0 && resolvedState.size.height > 0
      ? resolvedState.size.width / resolvedState.size.height
      : 1;

  return {
    kind: 'perspective',
    position: vectorToObject(resolvedState.camera.position),
    quaternion: quaternionToObject(resolvedState.camera.quaternion),
    up: vectorToObject(resolvedState.camera.up),
    zoom: resolvedState.camera.zoom,
    target: vectorToObject(target),
    aspectRatio,
    fov: resolvedState.camera.fov,
    near: resolvedState.camera.near,
    far: resolvedState.camera.far,
  };
}

export function applyWorkspaceCameraSnapshot(
  camera: THREE.Camera,
  controls: OrbitControlsLike | null | undefined,
  snapshot: WorkspaceCameraSnapshot | null | undefined,
) {
  if (!snapshot || !isPerspectiveCamera(camera)) {
    return;
  }

  camera.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  camera.quaternion
    .set(snapshot.quaternion.x, snapshot.quaternion.y, snapshot.quaternion.z, snapshot.quaternion.w)
    .normalize();
  camera.up.set(snapshot.up.x, snapshot.up.y, snapshot.up.z);
  camera.zoom = snapshot.zoom;
  camera.aspect = snapshot.aspectRatio;
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  if (controls) {
    controls.target.set(snapshot.target.x, snapshot.target.y, snapshot.target.z);
    controls.update?.();
  }
}

export function resolveSnapshotPreviewSurfaceSize(aspectRatio: number) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const targetLongEdge = 960;

  if (safeAspectRatio >= 1) {
    return {
      width: targetLongEdge,
      height: Math.max(1, Math.round(targetLongEdge / safeAspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(targetLongEdge * safeAspectRatio)),
    height: targetLongEdge,
  };
}
