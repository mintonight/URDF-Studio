import type { RefObject } from 'react';
import * as THREE from 'three';
import { URDFCollider, URDFVisual } from '@/core/parsers/urdf/loader';
import { createLoadingManager, type ColladaRootNormalizationHints } from '@/core/loaders';
import { getCollisionGeometryEntries } from '@/core/robot';
import { GeometryType } from '@/types';
import type { UrdfLink, UrdfVisual as LinkGeometry } from '@/types';
import { collisionBaseMaterial, createMatteMaterial } from './materials';
import { disposeObject3D } from './dispose';
import { SHARED_MATERIALS } from '../constants';
import {
  DEFAULT_VEC3,
  type GeometryPatchCandidate,
  sameGeometry,
  sameOrigin,
  sameVec3,
  sameVisibleFlag,
} from './robotLoaderDiff';
import {
  applyOriginToGroup,
  clearGroupChildren,
  findRobotLinkObject,
  markCollisionObject,
  markVisualObject,
  rebuildLinkMeshMapForLink,
  updateVisualMaterial,
} from './robotLoaderPatchUtils';
import { createViewerMeshLoader } from './createViewerMeshLoader';

interface PatchCategoryOptions {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  linkName: string;
  category: 'visual' | 'collision';
  geometry: LinkGeometry;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
  targetGroup?: THREE.Object3D;
}

function patchGeometryCategory({
  robotModel,
  linkObject,
  linkName,
  category,
  geometry,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
  targetGroup: explicitTargetGroup,
}: PatchCategoryOptions): void {
  const isCollision = category === 'collision';

  const groupPredicate = isCollision
    ? (child: THREE.Object3D) => (child as any).isURDFCollider
    : (child: THREE.Object3D) => (child as any).isURDFVisual;

  let targetGroup =
    explicitTargetGroup ?? (linkObject.children.find(groupPredicate) as THREE.Object3D | undefined);

  if (!targetGroup) {
    targetGroup = isCollision ? new URDFCollider() : new URDFVisual();
    linkObject.add(targetGroup);
  } else if (targetGroup.parent !== linkObject) {
    linkObject.add(targetGroup);
  }

  targetGroup.visible = isCollision ? showCollision : true;
  clearGroupChildren(targetGroup);
  applyOriginToGroup(targetGroup, geometry.origin);

  const patchToken = ((targetGroup.userData.__patchToken as number) || 0) + 1;
  targetGroup.userData.__patchToken = patchToken;

  const dims = geometry.dimensions || DEFAULT_VEC3;
  const visualColor = geometry.color || '#808080';
  const createVisualMaterial = () =>
    createMatteMaterial({
      color: visualColor,
      preserveExactColor: Boolean(geometry.color),
    });
  const addPrimitive = (mesh: THREE.Mesh) => {
    if (isCollision) {
      markCollisionObject(mesh, linkName);
    } else {
      markVisualObject(mesh, linkName, geometry.color, showVisual);
    }
    targetGroup!.add(mesh);
  };

  if (geometry.type === GeometryType.NONE) {
    rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
    robotModel.updateMatrixWorld(true);
    invalidate();
    return;
  }

  if (geometry.type === GeometryType.BOX) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    mesh.scale.set(dims.x || 0.1, dims.y || 0.1, dims.z || 0.1);
    addPrimitive(mesh);
  } else if (geometry.type === GeometryType.PLANE) {
    const material = isCollision ? collisionBaseMaterial : createVisualMaterial();
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(dims.x || 1, dims.y || 1, 1);
    addPrimitive(mesh);
  } else if (geometry.type === GeometryType.SPHERE || geometry.type === GeometryType.ELLIPSOID) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 30, 30),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    const sx = dims.x || 0.1;
    const sy = dims.y || sx;
    const sz = dims.z || sx;
    mesh.scale.set(sx, sy, sz);
    addPrimitive(mesh);
  } else if (geometry.type === GeometryType.CYLINDER) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 30),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    mesh.scale.set(dims.x || 0.05, dims.y || 0.5, dims.z || dims.x || 0.05);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    addPrimitive(mesh);
  } else if (geometry.type === GeometryType.CAPSULE) {
    const radius = Math.max(dims.x || 0.05, 1e-5);
    const totalLength = Math.max(dims.y || 0.5, radius * 2);
    const bodyLength = Math.max(totalLength - 2 * radius, 0);
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, bodyLength, 8, 16),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    mesh.rotation.set(Math.PI / 2, 0, 0);
    addPrimitive(mesh);
  } else if (geometry.type === GeometryType.MESH) {
    if (!geometry.meshPath) {
      rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
      robotModel.updateMatrixWorld(true);
      invalidate();
      return;
    }

    const urdfDir = sourceFileDir ?? '';
    const manager = createLoadingManager(assets, urdfDir);
    const meshLoader = createViewerMeshLoader(assets, manager, urdfDir, {
      colladaRootNormalizationHints,
    });

    meshLoader(geometry.meshPath, manager, (obj, err) => {
      if (!obj) return;

      if (
        (targetGroup!.userData.__patchToken as number) !== patchToken ||
        (isPatchTargetValid && !isPatchTargetValid())
      ) {
        disposeObject3D(obj, true, SHARED_MATERIALS);
        return;
      }

      if (err) {
        console.error('[URDFViewer] Failed to patch mesh geometry:', err);
      }

      if (isCollision) {
        markCollisionObject(obj, linkName);
      } else {
        markVisualObject(obj, linkName, geometry.color, showVisual);
      }

      targetGroup!.add(obj);
      rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
      robotModel.updateMatrixWorld(true);
      invalidate();
    });

    return;
  }

  rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
  robotModel.updateMatrixWorld(true);
  invalidate();
}

function getDirectCollisionGroups(linkObject: THREE.Object3D): THREE.Object3D[] {
  return linkObject.children.filter((child: any) => child.isURDFCollider) as THREE.Object3D[];
}

function patchCollisionEntriesInPlace({
  robotModel,
  linkObject,
  linkName,
  previousLinkData,
  nextLinkData,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
}: {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  linkName: string;
  previousLinkData: UrdfLink;
  nextLinkData: UrdfLink;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
}): boolean {
  const previousEntries = getCollisionGeometryEntries(previousLinkData);
  const nextEntries = getCollisionGeometryEntries(nextLinkData);
  const existingGroups = getDirectCollisionGroups(linkObject);

  if (existingGroups.length !== previousEntries.length) {
    return false;
  }

  let applied = false;
  const sharedCount = Math.min(previousEntries.length, nextEntries.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    const group = existingGroups[index];

    if (!previousEntry || !nextEntry || !group) {
      return false;
    }

    if (sameGeometry(previousEntry.geometry, nextEntry.geometry)) {
      continue;
    }

    applied = true;

    if (
      patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'collision',
        linkData: nextLinkData,
        previousGeometry: previousEntry.geometry,
        geometry: nextEntry.geometry,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: group,
      })
    ) {
      continue;
    }

    patchGeometryCategory({
      robotModel,
      linkObject,
      linkName,
      category: 'collision',
      geometry: nextEntry.geometry,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual,
      showCollision,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid,
      targetGroup: group,
    });
  }

  if (existingGroups.length > nextEntries.length) {
    existingGroups.slice(nextEntries.length).forEach((group) => {
      linkObject.remove(group);
      disposeObject3D(group, true, SHARED_MATERIALS);
    });
    applied = true;
  }

  if (nextEntries.length > existingGroups.length) {
    nextEntries.slice(existingGroups.length).forEach((entry) => {
      const targetGroup = new URDFCollider();
      linkObject.add(targetGroup);
      patchGeometryCategory({
        robotModel,
        linkObject,
        linkName,
        category: 'collision',
        geometry: entry.geometry,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
        targetGroup,
      });
    });
    applied = true;
  }

  if (!applied) {
    return true;
  }

  rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

function sameGeometryStructure(a: LinkGeometry | undefined, b: LinkGeometry | undefined): boolean {
  if (!a || !b) return a === b;
  return a.type === b.type && (a.meshPath || '') === (b.meshPath || '');
}

function getAuthoredMaterialSignature(geometry: LinkGeometry | undefined): string {
  const authoredMaterials = geometry?.authoredMaterials ?? [];
  return JSON.stringify(
    authoredMaterials.map((material) => ({
      name: String(material.name || '').trim(),
      color: String(material.color || '')
        .trim()
        .toLowerCase(),
      texture: String(material.texture || '').trim(),
    })),
  );
}

function canPatchGeometryInPlace(
  previousGeometry: LinkGeometry | undefined,
  geometry: LinkGeometry | undefined,
  category: 'visual' | 'collision',
): boolean {
  if (!previousGeometry || !geometry) return false;
  if (!sameGeometryStructure(previousGeometry, geometry)) return false;
  if (geometry.type === GeometryType.NONE) return false;

  const dimensionsChanged = !sameVec3(previousGeometry.dimensions, geometry.dimensions);
  const colorChanged = (previousGeometry.color || '') !== (geometry.color || '');
  const authoredMaterialsChanged =
    category === 'visual' &&
    getAuthoredMaterialSignature(previousGeometry) !== getAuthoredMaterialSignature(geometry);

  if (dimensionsChanged && geometry.type === GeometryType.MESH) return false;
  if (colorChanged && category === 'collision') return false;
  if (authoredMaterialsChanged) return false;

  return true;
}

function findFirstMeshInObject(object: THREE.Object3D): THREE.Mesh | null {
  let firstMesh: THREE.Mesh | null = null;

  object.traverse((child: any) => {
    if (!firstMesh && child.isMesh) {
      firstMesh = child as THREE.Mesh;
    }
  });

  return firstMesh;
}

function patchPrimitiveDimensionsInPlace(
  targetGroup: THREE.Object3D,
  geometry: LinkGeometry,
): boolean {
  const mesh = findFirstMeshInObject(targetGroup);
  if (!mesh) return false;

  const dims = geometry.dimensions || DEFAULT_VEC3;

  switch (geometry.type) {
    case GeometryType.BOX:
      mesh.scale.set(dims.x || 0.1, dims.y || 0.1, dims.z || 0.1);
      return true;
    case GeometryType.PLANE:
      mesh.scale.set(dims.x || 1, dims.y || 1, 1);
      return true;
    case GeometryType.SPHERE: {
      const radius = dims.x || 0.1;
      mesh.scale.set(radius, radius, radius);
      return true;
    }
    case GeometryType.ELLIPSOID: {
      const sx = dims.x || 0.1;
      const sy = dims.y || sx;
      const sz = dims.z || sx;
      mesh.scale.set(sx, sy, sz);
      return true;
    }
    case GeometryType.CYLINDER:
      mesh.scale.set(dims.x || 0.05, dims.y || 0.5, dims.z || dims.x || 0.05);
      mesh.rotation.set(Math.PI / 2, 0, 0);
      return true;
    case GeometryType.CAPSULE: {
      const radius = Math.max(dims.x || 0.05, 1e-5);
      const totalLength = Math.max(dims.y || 0.5, radius * 2);
      const bodyLength = Math.max(totalLength - 2 * radius, 0);
      const previousMeshGeometry = mesh.geometry;
      mesh.geometry = new THREE.CapsuleGeometry(radius, bodyLength, 8, 16);
      previousMeshGeometry?.dispose?.();
      mesh.scale.set(1, 1, 1);
      mesh.rotation.set(Math.PI / 2, 0, 0);
      return true;
    }
    default:
      return false;
  }
}

function patchGeometryGroupInPlace({
  robotModel,
  linkObject,
  category,
  linkData,
  previousGeometry,
  geometry,
  showVisual,
  showCollision,
  invalidate,
  targetGroup: explicitTargetGroup,
}: {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  category: 'visual' | 'collision';
  linkData: UrdfLink;
  previousGeometry: LinkGeometry | undefined;
  geometry: LinkGeometry | undefined;
  showVisual: boolean;
  showCollision: boolean;
  invalidate: () => void;
  targetGroup?: THREE.Object3D;
}): boolean {
  if (!previousGeometry || !geometry) return false;
  if (!canPatchGeometryInPlace(previousGeometry, geometry, category)) return false;

  const isCollision = category === 'collision';
  const groupPredicate = isCollision
    ? (child: THREE.Object3D) => (child as any).isURDFCollider
    : (child: THREE.Object3D) => (child as any).isURDFVisual;

  const targetGroup =
    explicitTargetGroup ?? (linkObject.children.find(groupPredicate) as THREE.Object3D | undefined);
  if (!targetGroup) return false;

  const originChanged = !sameOrigin(previousGeometry.origin, geometry.origin);
  const visibilityChanged = !sameVisibleFlag(previousGeometry.visible, geometry.visible);
  const dimensionsChanged = !sameVec3(previousGeometry.dimensions, geometry.dimensions);
  const colorChanged = (previousGeometry.color || '') !== (geometry.color || '');

  if (originChanged) {
    applyOriginToGroup(targetGroup, geometry.origin);
  }

  const isVisible = isCollision
    ? showCollision && linkData.visible !== false && geometry.visible !== false
    : showVisual && linkData.visible !== false && geometry.visible !== false;

  if (visibilityChanged || category === 'visual') {
    targetGroup.visible = isVisible;
    targetGroup.traverse((child: any) => {
      if (child.isMesh) {
        child.visible = isVisible;
      }
    });
  }

  if (dimensionsChanged && !patchPrimitiveDimensionsInPlace(targetGroup, geometry)) {
    return false;
  }

  if (!isCollision && colorChanged) {
    const disposedMaterials = new Set<THREE.Material>();
    targetGroup.traverse((child: any) => {
      if (child.isMesh) {
        updateVisualMaterial(child as THREE.Mesh, geometry.color, disposedMaterials);
      }
    });
  }

  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

interface ApplyGeometryPatchOptions {
  robotModel: THREE.Object3D;
  patch: GeometryPatchCandidate;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
}

export function applyGeometryPatchInPlace({
  robotModel,
  patch,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
}: ApplyGeometryPatchOptions): boolean {
  const linkObject = findRobotLinkObject(robotModel, patch.linkName);
  if (!linkObject) return false;

  if (patch.visualChanged) {
    if (
      !patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'visual',
        linkData: patch.linkData,
        previousGeometry: patch.previousLinkData.visual,
        geometry: patch.linkData.visual,
        showVisual,
        showCollision,
        invalidate,
      })
    ) {
      patchGeometryCategory({
        robotModel,
        linkObject,
        linkName: patch.linkName,
        category: 'visual',
        geometry: patch.linkData.visual,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
      });
    }
  }

  if (patch.collisionChanged || patch.collisionBodiesChanged) {
    const collisionPatched = patchCollisionEntriesInPlace({
      robotModel,
      linkObject,
      linkName: patch.linkName,
      previousLinkData: patch.previousLinkData,
      nextLinkData: patch.linkData,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual,
      showCollision,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid,
    });

    if (!collisionPatched) {
      if (
        !patchGeometryGroupInPlace({
          robotModel,
          linkObject,
          category: 'collision',
          linkData: patch.linkData,
          previousGeometry: patch.previousLinkData.collision,
          geometry: patch.linkData.collision,
          showVisual,
          showCollision,
          invalidate,
        })
      ) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: patch.linkName,
          category: 'collision',
          geometry: patch.linkData.collision,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
        });
      }
    }
  }

  return true;
}
