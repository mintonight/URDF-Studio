import * as THREE from 'three';

import { createMatteMaterial } from '@/core/utils/materialFactory';

const COLLISION_OVERLAY_COLOR = 0xa855f7;
const COLLISION_OVERLAY_OPACITY = 0.35;
const COLLISION_OVERLAY_POLYGON_OFFSET_FACTOR = -1.0;
const COLLISION_OVERLAY_POLYGON_OFFSET_UNITS = -4.0;

export const COLLISION_OVERLAY_RENDER_ORDER = 999;

export function configureCollisionOverlayMaterial<T extends THREE.Material>(material: T): T {
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = COLLISION_OVERLAY_POLYGON_OFFSET_FACTOR;
  material.polygonOffsetUnits = COLLISION_OVERLAY_POLYGON_OFFSET_UNITS;
  material.userData.isCollisionMaterial = true;
  return material;
}

export function createCollisionOverlayMaterial(name: string): THREE.MeshStandardMaterial {
  return configureCollisionOverlayMaterial(
    createMatteMaterial({
      color: COLLISION_OVERLAY_COLOR,
      opacity: COLLISION_OVERLAY_OPACITY,
      transparent: true,
      name,
    }),
  );
}

export const collisionBaseMaterial = configureCollisionOverlayMaterial(
  new THREE.MeshStandardMaterial({
    color: COLLISION_OVERLAY_COLOR,
    transparent: true,
    opacity: COLLISION_OVERLAY_OPACITY,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    polygonOffset: true,
    polygonOffsetFactor: COLLISION_OVERLAY_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: COLLISION_OVERLAY_POLYGON_OFFSET_UNITS,
  }),
);

collisionBaseMaterial.userData.isSharedMaterial = true;
