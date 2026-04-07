import * as THREE from 'three';
import { GeometryType, type UrdfLink } from '@/types';

import {
  collisionBaseMaterial,
  enhanceMaterials,
  resolveCollisionRenderOrder,
  syncCollisionBaseMaterialPriority,
} from './materials';
import { disposeReplacedMaterials } from './robotLoaderPatchUtils';
import { applyURDFMaterials, type URDFMaterialInfo } from './urdfMaterials';
import { applyVisualMeshShadowPolicy } from '@/core/utils/visualMeshShadowPolicy';

export interface SyncLoadedRobotSceneOptions {
  robot: THREE.Object3D;
  sourceFormat: 'urdf' | 'mjcf';
  showCollision: boolean;
  showVisual: boolean;
  showMjcfWorldLink?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  urdfMaterials?: Map<string, URDFMaterialInfo> | null;
  robotLinks?: Record<string, UrdfLink>;
}

export interface SyncLoadedRobotSceneResult {
  changed: boolean;
  linkMeshMap: Map<string, THREE.Mesh[]>;
}

function meshNeedsMaterialUpgrade(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  return materials.some((material) => {
    if (!material) return false;
    if ((material as any).userData?.isCollisionMaterial) return false;
    if ((material as any).userData?.isSharedMaterial) return false;
    if (!(material instanceof THREE.MeshStandardMaterial)) return true;

    const materialWithPbrState = material as THREE.MeshStandardMaterial & {
      envMapIntensity?: number;
      emissiveMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      bumpMap?: THREE.Texture | null;
    };
    const originalRoughness = Number(material.userData?.originalRoughness);
    const originalMetalness = Number(material.userData?.originalMetalness);
    const originalEnvMapIntensity = Number(material.userData?.originalEnvMapIntensity);
    const currentEnvMapIntensity = Number.isFinite(materialWithPbrState.envMapIntensity)
      ? Number(materialWithPbrState.envMapIntensity)
      : 1;

    if (
      !Number.isFinite(originalRoughness) ||
      !Number.isFinite(originalMetalness) ||
      !Number.isFinite(originalEnvMapIntensity)
    ) {
      return true;
    }

    if (Math.abs(material.roughness - originalRoughness) > 1e-6) {
      return true;
    }

    if (Math.abs(material.metalness - originalMetalness) > 1e-6) {
      return true;
    }

    if (Math.abs(currentEnvMapIntensity - originalEnvMapIntensity) > 1e-6) {
      return true;
    }

    if (
      materialWithPbrState.emissiveMap ||
      materialWithPbrState.roughnessMap ||
      materialWithPbrState.metalnessMap ||
      materialWithPbrState.normalMap ||
      materialWithPbrState.aoMap ||
      materialWithPbrState.bumpMap
    ) {
      return true;
    }

    if (material.emissive?.getHex() !== 0x000000) {
      return true;
    }

    if (material.userData?.urdfColorApplied === true && material.toneMapped !== false) {
      return true;
    }

    if (material.userData?.usesVertexColors === true && material.toneMapped !== false) {
      return true;
    }

    return false;
  });
}

function pushMesh(map: Map<string, THREE.Mesh[]>, key: string, mesh: THREE.Mesh): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(mesh);
    return;
  }

  map.set(key, [mesh]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGeomSuffixOrder(candidate: string, parentLinkId: string, parentName: string): number {
  const patterns = [
    new RegExp(`^${escapeRegExp(parentLinkId)}_geom_(\\d+)$`),
    new RegExp(`^${escapeRegExp(parentName)}_geom_(\\d+)$`),
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (!match) {
      continue;
    }

    const numeric = Number(match[1]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function resolveRobotLinkDataByRuntimeName(
  robotLinks: Record<string, UrdfLink> | undefined,
  runtimeLinkName: string,
): UrdfLink | null {
  if (!robotLinks) {
    return null;
  }

  return (
    robotLinks[runtimeLinkName] ??
    Object.values(robotLinks).find((link) => link.name === runtimeLinkName) ??
    null
  );
}

function resolveSemanticLinkIdForRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf',
  robotLinks: Record<string, UrdfLink> | undefined,
  runtimeLinkName: string,
): string {
  if (sourceFormat !== 'mjcf') {
    return runtimeLinkName;
  }

  return resolveRobotLinkDataByRuntimeName(robotLinks, runtimeLinkName)?.id ?? runtimeLinkName;
}

function hasVisualGeometry(link: UrdfLink | null | undefined): boolean {
  return Boolean(link && link.visual.type !== GeometryType.NONE);
}

function shouldHideMjcfWorldRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf',
  showMjcfWorldLink: boolean,
  runtimeLinkName: string | undefined,
): boolean {
  return sourceFormat === 'mjcf' && !showMjcfWorldLink && runtimeLinkName === 'world';
}

function buildMjcfVisualOwnershipByRuntimeLink(
  robotLinks: Record<string, UrdfLink> | undefined,
): Map<string, string[]> {
  const ownership = new Map<string, string[]>();
  if (!robotLinks) {
    return ownership;
  }

  const linkEntries = Object.values(robotLinks);
  for (let index = 0; index < linkEntries.length; index += 1) {
    const parentLink = linkEntries[index];
    const runtimeLinkName = parentLink.name || parentLink.id;
    if (!runtimeLinkName) {
      continue;
    }

    const semanticOwners: string[] = [];
    if (hasVisualGeometry(parentLink)) {
      semanticOwners.push(parentLink.id);
    }

    const attachmentLinks = linkEntries
      .filter((candidate) => {
        if (candidate.id === parentLink.id || !hasVisualGeometry(candidate)) {
          return false;
        }

        return (
          getGeomSuffixOrder(candidate.id, parentLink.id, parentLink.name) !==
            Number.POSITIVE_INFINITY ||
          getGeomSuffixOrder(candidate.name, parentLink.id, parentLink.name) !==
            Number.POSITIVE_INFINITY
        );
      })
      .sort((left, right) => {
        const leftOrder = Math.min(
          getGeomSuffixOrder(left.id, parentLink.id, parentLink.name),
          getGeomSuffixOrder(left.name, parentLink.id, parentLink.name),
        );
        const rightOrder = Math.min(
          getGeomSuffixOrder(right.id, parentLink.id, parentLink.name),
          getGeomSuffixOrder(right.name, parentLink.id, parentLink.name),
        );

        return leftOrder - rightOrder;
      })
      .map((candidate) => candidate.id);

    if (attachmentLinks.length > 0) {
      semanticOwners.push(...attachmentLinks);
    }

    if (semanticOwners.length > 0) {
      ownership.set(runtimeLinkName, semanticOwners);
    }
  }

  return ownership;
}

function findDirectChildUnderParent(
  node: THREE.Object3D,
  parent: THREE.Object3D,
): THREE.Object3D | null {
  let current: THREE.Object3D | null = node;
  while (current?.parent && current.parent !== parent) {
    current = current.parent;
  }

  return current?.parent === parent ? current : null;
}

export function syncLoadedRobotScene({
  robot,
  sourceFormat,
  showCollision,
  showVisual,
  showMjcfWorldLink = true,
  showCollisionAlwaysOnTop = true,
  urdfMaterials,
  robotLinks: robotLinkData,
}: SyncLoadedRobotSceneOptions): SyncLoadedRobotSceneResult {
  const linkMeshMap = new Map<string, THREE.Mesh[]>();
  let changed = false;
  const disposedMaterials = new Set<THREE.Material>();
  const robotLinks = (robot as any).links as Record<string, THREE.Object3D> | undefined;
  const mjcfVisualOwnershipByRuntimeLink =
    sourceFormat === 'mjcf'
      ? buildMjcfVisualOwnershipByRuntimeLink(robotLinkData)
      : new Map<string, string[]>();
  const visualBodyIndexByRuntimeLink = new Map<string, number>();
  const visualOwnerByGeometryRoot = new WeakMap<THREE.Object3D, string>();
  const previousCollisionDepthTest = collisionBaseMaterial.depthTest;
  const previousCollisionDepthWrite = collisionBaseMaterial.depthWrite;

  syncCollisionBaseMaterialPriority(showCollisionAlwaysOnTop);
  if (
    previousCollisionDepthTest !== collisionBaseMaterial.depthTest ||
    previousCollisionDepthWrite !== collisionBaseMaterial.depthWrite
  ) {
    changed = true;
  }

  const isLinkNode = (object: THREE.Object3D): boolean =>
    Boolean((object as any).isURDFLink || robotLinks?.[object.name]);

  const processCollisionMesh = (mesh: THREE.Mesh, parentLink: THREE.Object3D | null) => {
    if (mesh.userData?.isCollisionMesh !== true || mesh.userData?.isVisualMesh !== false) {
      changed = true;
    }

    mesh.userData.isCollisionMesh = true;
    mesh.userData.isCollision = true;
    mesh.userData.isVisual = false;
    mesh.userData.isVisualMesh = false;

    if (mesh.material !== collisionBaseMaterial) {
      changed = true;
      const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
      mesh.material = collisionBaseMaterial;
      disposeReplacedMaterials(previousMaterial, disposedMaterials, true);
    }

    const collisionRenderOrder = resolveCollisionRenderOrder(showCollisionAlwaysOnTop);
    if (mesh.renderOrder !== collisionRenderOrder) {
      changed = true;
      mesh.renderOrder = collisionRenderOrder;
    }

    if (parentLink) {
      const semanticLinkName = resolveSemanticLinkIdForRuntimeLink(
        sourceFormat,
        robotLinkData,
        parentLink.name,
      );

      if (
        mesh.userData?.parentLinkName !== semanticLinkName ||
        mesh.userData?.runtimeParentLinkName !== parentLink.name
      ) {
        changed = true;
      }
      mesh.userData.parentLinkName = semanticLinkName;
      mesh.userData.runtimeParentLinkName = parentLink.name;
      pushMesh(linkMeshMap, `${semanticLinkName}:collision`, mesh);
    }
  };

  const processVisualMesh = (mesh: THREE.Mesh, parentLink: THREE.Object3D) => {
    const shouldUpgradeVisualMaterial = meshNeedsMaterialUpgrade(mesh);
    const geometryRoot = findDirectChildUnderParent(mesh, parentLink) ?? mesh;
    let semanticLinkName = visualOwnerByGeometryRoot.get(geometryRoot);

    if (!semanticLinkName) {
      const visualBodyIndex = visualBodyIndexByRuntimeLink.get(parentLink.name) ?? 0;
      visualBodyIndexByRuntimeLink.set(parentLink.name, visualBodyIndex + 1);
      const visualOwners = mjcfVisualOwnershipByRuntimeLink.get(parentLink.name);
      semanticLinkName =
        visualOwners?.[visualBodyIndex] ??
        resolveRobotLinkDataByRuntimeName(robotLinkData, parentLink.name)?.id ??
        parentLink.name;
      visualOwnerByGeometryRoot.set(geometryRoot, semanticLinkName);
    }

    const isVisible =
      showVisual &&
      !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, parentLink.name);

    if (sourceFormat === 'urdf' && urdfMaterials && shouldUpgradeVisualMaterial) {
      applyURDFMaterials(mesh, urdfMaterials);
    }

    if (shouldUpgradeVisualMaterial) {
      enhanceMaterials(mesh);
      changed = true;
    }

    if (applyVisualMeshShadowPolicy(mesh)) {
      changed = true;
    }

    if (
      mesh.userData?.parentLinkName !== semanticLinkName ||
      mesh.userData?.isVisualMesh !== true ||
      mesh.userData?.isCollisionMesh === true ||
      mesh.visible !== isVisible
    ) {
      changed = true;
    }

    mesh.userData.parentLinkName = semanticLinkName;
    mesh.userData.runtimeParentLinkName = parentLink.name;
    mesh.userData.isVisualMesh = true;
    mesh.userData.isCollisionMesh = false;
    mesh.visible = isVisible;

    pushMesh(linkMeshMap, `${semanticLinkName}:visual`, mesh);
  };

  const walkNode = (
    node: THREE.Object3D,
    parentLink: THREE.Object3D | null,
    insideCollider: boolean,
  ) => {
    const nextParentLink = isLinkNode(node) ? node : parentLink;
    const nodeIsCollider = Boolean((node as any).isURDFCollider);
    const nextInsideCollider = insideCollider || nodeIsCollider;

    if (nodeIsCollider) {
      const colliderVisible =
        showCollision &&
        !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, nextParentLink?.name);

      if (node.visible !== colliderVisible) {
        changed = true;
      }
      node.visible = colliderVisible;

      if (nextParentLink) {
        const semanticLinkName = resolveSemanticLinkIdForRuntimeLink(
          sourceFormat,
          robotLinkData,
          nextParentLink.name,
        );

        if (
          node.userData?.parentLinkName !== semanticLinkName ||
          node.userData?.runtimeParentLinkName !== nextParentLink.name
        ) {
          changed = true;
        }
        node.userData.parentLinkName = semanticLinkName;
        node.userData.runtimeParentLinkName = nextParentLink.name;
      }

      if (!colliderVisible) {
        return;
      }
    }

    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      if (nextInsideCollider) {
        processCollisionMesh(mesh, nextParentLink);
      } else if (nextParentLink) {
        processVisualMesh(mesh, nextParentLink);
      }
    }

    for (let index = 0; index < node.children.length; index += 1) {
      walkNode(node.children[index], nextParentLink, nextInsideCollider);
    }
  };

  walkNode(robot, null, false);

  return { changed, linkMeshMap };
}
