import * as THREE from 'three';

export const DEFAULT_WORKSPACE_ORBIT_CLIPPING = {
  minDistance: 0.002,
  // Keep the perspective depth range tighter so dense shells do not start
  // z-fighting and leaking bright internals at medium/far zoom levels.
  // Paired with renderer-level logarithmicDepthBuffer, a 0.01 minimum near
  // caps the near/far ratio at ~2000 so closely-stacked MJCF inner geoms
  // (e.g. apptronik_apollo battery_mount inside torso_link shell) stay stable.
  nearFactor: 0.01,
  minNear: 0.01,
  maxNear: 0.25,
  farFactor: 140,
  minFar: 20,
  maxFar: 6000,
} as const;

export interface WorkspaceOrbitClippingOptions {
  minDistance?: number;
  nearFactor?: number;
  minNear?: number;
  maxNear?: number;
  farFactor?: number;
  minFar?: number;
  maxFar?: number;
  sceneBounds?: THREE.Box3 | null;
}

type OrbitTargetLike = {
  target: THREE.Vector3;
};

function getMaxDistanceFromTargetToBounds(
  target: THREE.Vector3,
  bounds: THREE.Box3,
): number | null {
  if (bounds.isEmpty()) {
    return null;
  }

  const corners: [number, number, number][] = [
    [bounds.min.x, bounds.min.y, bounds.min.z],
    [bounds.min.x, bounds.min.y, bounds.max.z],
    [bounds.min.x, bounds.max.y, bounds.min.z],
    [bounds.min.x, bounds.max.y, bounds.max.z],
    [bounds.max.x, bounds.min.y, bounds.min.z],
    [bounds.max.x, bounds.min.y, bounds.max.z],
    [bounds.max.x, bounds.max.y, bounds.min.z],
    [bounds.max.x, bounds.max.y, bounds.max.z],
  ];

  let maxDistance = 0;
  for (const [x, y, z] of corners) {
    const distance = target.distanceTo(_corner.set(x, y, z));
    if (!Number.isFinite(distance)) {
      return null;
    }
    maxDistance = Math.max(maxDistance, distance);
  }

  return maxDistance;
}

const _corner = new THREE.Vector3();

export function syncWorkspacePerspectiveClipPlanes(
  camera: THREE.Camera,
  controls: OrbitTargetLike,
  options: WorkspaceOrbitClippingOptions = {},
): boolean {
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    return false;
  }

  const config = {
    ...DEFAULT_WORKSPACE_ORBIT_CLIPPING,
    ...options,
  };

  const distance = Math.max(
    camera.position.distanceTo(controls.target),
    config.minDistance,
  );
  const nextNear = THREE.MathUtils.clamp(
    distance * config.nearFactor,
    config.minNear,
    config.maxNear,
  );
  const distanceBasedFar = Math.max(
    nextNear + 10,
    THREE.MathUtils.clamp(
      distance * config.farFactor,
      config.minFar,
      config.maxFar,
    ),
  );
  const targetDistanceToSceneBounds = config.sceneBounds
    ? getMaxDistanceFromTargetToBounds(controls.target, config.sceneBounds)
    : null;
  const boundsLimitedFar = targetDistanceToSceneBounds === null
    ? null
    : Math.max(
      nextNear + 10,
      THREE.MathUtils.clamp(
        distance + targetDistanceToSceneBounds + Math.max(2, targetDistanceToSceneBounds * 0.08),
        config.minFar,
        config.maxFar,
      ),
    );
  const nextFar = boundsLimitedFar === null
    ? distanceBasedFar
    : Math.min(distanceBasedFar, boundsLimitedFar);

  if (
    Math.abs(camera.near - nextNear) < 1e-5
    && Math.abs(camera.far - nextFar) < 1e-2
  ) {
    return false;
  }

  camera.near = nextNear;
  camera.far = nextFar;
  camera.updateProjectionMatrix();
  return true;
}
