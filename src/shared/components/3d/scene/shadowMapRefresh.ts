import type * as THREE from 'three';

export function requestShadowMapRefresh(
  renderer: Pick<THREE.WebGLRenderer, 'shadowMap'> | null | undefined,
): boolean {
  const shadowMap = renderer?.shadowMap;
  if (!shadowMap?.enabled) {
    return false;
  }

  shadowMap.needsUpdate = true;
  return true;
}
