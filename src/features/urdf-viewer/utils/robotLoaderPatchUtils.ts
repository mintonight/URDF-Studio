import type { RefObject } from 'react';
import * as THREE from 'three';
import { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { disposeObject3D, disposeMaterial } from './dispose';
import {
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  createMatteMaterial,
} from './materials';
import { SHARED_MATERIALS } from '../constants';
import { DEFAULT_RPY, DEFAULT_VEC3 } from './robotLoaderDiff';
import { syncMjcfTendonVisualMeshMap } from './mjcfTendonVisualMeshMap';
import type { UrdfJoint, UrdfVisual as LinkGeometry } from '@/types';

function normalizeVisualColorOverride(color: string | undefined): string | undefined {
  const trimmed = color?.trim();
  return trimmed ? trimmed : undefined;
}

export function applyOriginToGroup(
  group: THREE.Object3D,
  origin: LinkGeometry['origin'] | undefined,
): void {
  const xyz = origin?.xyz || DEFAULT_VEC3;
  const rpy = origin?.rpy || DEFAULT_RPY;

  group.position.set(xyz.x, xyz.y, xyz.z);
  group.rotation.set(0, 0, 0);
  group.quaternion.setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
}

export function applyOriginToJoint(
  joint: RuntimeURDFJoint,
  origin: UrdfJoint['origin'] | undefined,
): void {
  const xyz = origin?.xyz || DEFAULT_VEC3;
  const rpy = origin?.rpy || DEFAULT_RPY;

  joint.position.set(xyz.x, xyz.y, xyz.z);
  joint.rotation.set(0, 0, 0);
  joint.quaternion.setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
}

export function clearGroupChildren(group: THREE.Object3D): void {
  while (group.children.length > 0) {
    disposeObject3D(group.children[0], true, SHARED_MATERIALS);
  }
}

export function disposeReplacedMaterials(
  material: THREE.Material | THREE.Material[] | undefined,
  disposedMaterials: Set<THREE.Material>,
  disposeTextures: boolean,
): void {
  if (!material) return;

  const mats = Array.isArray(material) ? material : [material];
  for (const mat of mats) {
    if (!mat || disposedMaterials.has(mat) || SHARED_MATERIALS.has(mat)) continue;
    disposeMaterial(mat, disposeTextures, SHARED_MATERIALS);
    disposedMaterials.add(mat);
  }
}

export function disposeTempMaterialMap(materials: Map<string, THREE.Material>): void {
  materials.forEach((material) => {
    if (!SHARED_MATERIALS.has(material)) {
      disposeMaterial(material, true, SHARED_MATERIALS);
    }
  });
}

export function findRobotLinkObject(
  robotModel: THREE.Object3D,
  linkName: string,
): THREE.Object3D | null {
  const links = (robotModel as any).links as Record<string, THREE.Object3D> | undefined;
  if (links?.[linkName]) return links[linkName];

  let found: THREE.Object3D | null = null;
  robotModel.traverse((child: any) => {
    if (!found && child.isURDFLink && child.name === linkName) {
      found = child;
    }
  });

  return found;
}

export function updateVisualMaterial(
  mesh: THREE.Mesh,
  color: string | undefined,
  disposedMaterials: Set<THREE.Material>,
): void {
  const colorOverride = normalizeVisualColorOverride(color);
  if (!colorOverride) {
    return;
  }
  const parsedColorOverride = parseThreeColorWithOpacity(colorOverride);
  if (!parsedColorOverride) {
    return;
  }

  const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
  const overrideOpacity = parsedColorOverride.opacity;

  const update = (mat: THREE.Material): THREE.Material => {
    const map = (mat as any).map || null;
    const effectiveOpacity = overrideOpacity ?? mat.opacity ?? 1;
    const next = createMatteMaterial({
      color: parsedColorOverride.color,
      opacity: effectiveOpacity,
      transparent: mat.transparent || effectiveOpacity < 1,
      side: mat.side,
      map,
      name: mat.name,
      preserveExactColor: true,
    });
    next.userData.urdfColorApplied = true;
    next.userData.urdfColor = parsedColorOverride.color.clone();
    return next;
  };

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((mat) => update(mat));
  } else if (mesh.material) {
    mesh.material = update(mesh.material);
  }

  disposeReplacedMaterials(previousMaterial, disposedMaterials, false);
}

export function markVisualObject(
  obj: THREE.Object3D,
  linkName: string,
  color: string | undefined,
  showVisual: boolean,
): void {
  const colorOverride = normalizeVisualColorOverride(color);
  const disposedMaterials = new Set<THREE.Material>();

  obj.traverse((child: any) => {
    if (!child.isMesh) return;
    child.userData.parentLinkName = linkName;
    child.userData.isVisualMesh = true;
    child.visible = showVisual;
    if (colorOverride) {
      updateVisualMaterial(child, colorOverride, disposedMaterials);
    }
  });
}

export function markCollisionObject(obj: THREE.Object3D, linkName: string): void {
  const disposedMaterials = new Set<THREE.Material>();

  obj.traverse((child: any) => {
    if (!child.isMesh) return;

    const previousMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
    child.userData.parentLinkName = linkName;
    child.userData.isCollisionMesh = true;
    child.userData.isCollision = true;
    child.userData.isVisual = false;
    child.userData.isVisualMesh = false;
    child.material = collisionBaseMaterial;
    child.renderOrder = COLLISION_OVERLAY_RENDER_ORDER;

    disposeReplacedMaterials(previousMaterial, disposedMaterials, true);
  });
}

export function rebuildLinkMeshMapForLink(
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>,
  linkObject: THREE.Object3D,
  linkName: string,
): void {
  const visualKey = `${linkName}:visual`;
  const collisionKey = `${linkName}:collision`;
  const visualMeshes: THREE.Mesh[] = [];
  const collisionMeshes: THREE.Mesh[] = [];

  const collectGroupMeshes = (group: THREE.Object3D, kind: 'visual' | 'collision') => {
    group.traverse((child: any) => {
      if (!child.isMesh) return;
      if (child.userData?.isGizmo || String(child.name || '').startsWith('__')) return;

      child.userData.parentLinkName = linkName;

      if (kind === 'collision') {
        child.userData.isCollisionMesh = true;
        child.userData.isVisualMesh = false;
        collisionMeshes.push(child as THREE.Mesh);
      } else {
        child.userData.isVisualMesh = true;
        child.userData.isCollisionMesh = false;
        visualMeshes.push(child as THREE.Mesh);
      }
    });
  };

  linkObject.children.forEach((child: any) => {
    if (child.userData?.isGizmo || String(child.name || '').startsWith('__')) return;

    if (child.isURDFCollider) {
      collectGroupMeshes(child, 'collision');
      return;
    }

    if (child.isURDFVisual) {
      collectGroupMeshes(child, 'visual');
      return;
    }

    if (child.isMesh) {
      child.userData.parentLinkName = linkName;
      child.userData.isVisualMesh = true;
      child.userData.isCollisionMesh = false;
      visualMeshes.push(child as THREE.Mesh);
    }
  });

  linkMeshMapRef.current.delete(visualKey);
  linkMeshMapRef.current.delete(collisionKey);
  if (visualMeshes.length > 0) linkMeshMapRef.current.set(visualKey, visualMeshes);
  if (collisionMeshes.length > 0) linkMeshMapRef.current.set(collisionKey, collisionMeshes);

  let robotRoot: THREE.Object3D = linkObject;
  while (robotRoot.parent) {
    robotRoot = robotRoot.parent;
  }

  syncMjcfTendonVisualMeshMap(linkMeshMapRef.current, robotRoot, linkName);
}
