import * as THREE from 'three';

const MAX_SHADOW_TRIANGLE_COUNT = 60000;

export function getVisualMeshTriangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) {
    return 0;
  }

  const index = geometry.getIndex();
  if (index) {
    return index.count / 3;
  }

  const position = geometry.getAttribute('position');
  if (!position) {
    return 0;
  }

  return position.count / 3;
}

export function shouldVisualMeshParticipateInShadows(mesh: THREE.Mesh): boolean {
  return getVisualMeshTriangleCount(mesh) <= MAX_SHADOW_TRIANGLE_COUNT;
}

export function applyVisualMeshShadowPolicy(mesh: THREE.Mesh): boolean {
  const shouldParticipate = shouldVisualMeshParticipateInShadows(mesh);
  const changed =
    mesh.castShadow !== shouldParticipate || mesh.receiveShadow !== shouldParticipate;
  mesh.castShadow = shouldParticipate;
  mesh.receiveShadow = shouldParticipate;
  return changed;
}

export function applyVisualMeshShadowPolicyToObject(root: THREE.Object3D): number {
  let changedMeshCount = 0;

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    if (applyVisualMeshShadowPolicy(child as THREE.Mesh)) {
      changedMeshCount += 1;
    }
  });

  return changedMeshCount;
}
