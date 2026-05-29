import * as THREE from 'three';

import type { UrdfVisual, UrdfVisualMaterial, UrdfVisualMeshMaterialGroup } from '@/types';
import { getGeometryMeshMaterialGroupsForMesh } from '@/core/robot/visualMeshMaterialGroups';
import { getGeometryAuthoredMaterials } from '@/core/robot/visualMaterials';
import { createMatteMaterial } from './materialFactory';
import { isProtectedMaterial } from './three/materialProtection';
import { colorRgbaTupleToOpacity, parseThreeColorWithOpacity } from './color.ts';

export type MeshFaceSelectionScope = 'face' | 'island';

const FACE_ISLAND_NORMAL_DOT_THRESHOLD = Math.cos((18 * Math.PI) / 180);

interface FaceIslandTopology {
  normals: THREE.Vector3[];
  adjacency: number[][];
}

const faceIslandTopologyCache = new WeakMap<THREE.BufferGeometry, FaceIslandTopology>();

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

function getGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }

  const positionAttribute = geometry.getAttribute('position');
  return positionAttribute ? Math.floor(positionAttribute.count / 3) : 0;
}

function getTriangleVertexKey(
  geometry: THREE.BufferGeometry,
  vertexIndex: number,
  position: THREE.Vector3,
): string {
  if (geometry.index) {
    return `i:${vertexIndex}`;
  }

  return `p:${position.x.toFixed(6)},${position.y.toFixed(6)},${position.z.toFixed(6)}`;
}

function buildFaceIslandTopology(geometry: THREE.BufferGeometry): FaceIslandTopology {
  const cached = faceIslandTopologyCache.get(geometry);
  if (cached) {
    return cached;
  }

  const triangleCount = getGeometryTriangleCount(geometry);
  const positionAttribute = geometry.getAttribute('position');
  const indexAttribute = geometry.index;
  const normals = Array.from({ length: triangleCount }, () => new THREE.Vector3(0, 0, 1));
  const adjacency = Array.from({ length: triangleCount }, () => [] as number[]);

  if (!positionAttribute || triangleCount === 0) {
    const emptyTopology = { normals, adjacency };
    faceIslandTopologyCache.set(geometry, emptyTopology);
    return emptyTopology;
  }

  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const edgeToFaces = new Map<string, number[]>();

  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    const baseIndex = faceIndex * 3;
    const vertexIndexes = [
      indexAttribute ? indexAttribute.getX(baseIndex) : baseIndex,
      indexAttribute ? indexAttribute.getX(baseIndex + 1) : baseIndex + 1,
      indexAttribute ? indexAttribute.getX(baseIndex + 2) : baseIndex + 2,
    ];

    vertexA.fromBufferAttribute(positionAttribute, vertexIndexes[0]!);
    vertexB.fromBufferAttribute(positionAttribute, vertexIndexes[1]!);
    vertexC.fromBufferAttribute(positionAttribute, vertexIndexes[2]!);

    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    normals[faceIndex].crossVectors(edgeAB, edgeAC).normalize();

    const vertexKeys = [
      getTriangleVertexKey(geometry, vertexIndexes[0]!, vertexA),
      getTriangleVertexKey(geometry, vertexIndexes[1]!, vertexB),
      getTriangleVertexKey(geometry, vertexIndexes[2]!, vertexC),
    ];

    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const leftKey = vertexKeys[edgeIndex]!;
      const rightKey = vertexKeys[(edgeIndex + 1) % 3]!;
      const edgeKey = leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
      const faces = edgeToFaces.get(edgeKey) ?? [];
      faces.push(faceIndex);
      edgeToFaces.set(edgeKey, faces);
    }
  }

  edgeToFaces.forEach((faces) => {
    if (faces.length < 2) {
      return;
    }

    for (let index = 0; index < faces.length; index += 1) {
      const faceIndex = faces[index]!;
      const neighbors = adjacency[faceIndex]!;
      for (let neighborIndex = 0; neighborIndex < faces.length; neighborIndex += 1) {
        if (neighborIndex === index) {
          continue;
        }

        const neighborFace = faces[neighborIndex]!;
        if (!neighbors.includes(neighborFace)) {
          neighbors.push(neighborFace);
        }
      }
    }
  });

  const topology = { normals, adjacency };
  faceIslandTopologyCache.set(geometry, topology);
  return topology;
}

export function resolveMeshFaceSelection(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  scope: MeshFaceSelectionScope,
): number[] {
  const triangleCount = getGeometryTriangleCount(geometry);
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangleCount) {
    return [];
  }

  if (scope === 'face') {
    return [faceIndex];
  }

  const topology = buildFaceIslandTopology(geometry);
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];

  while (queue.length > 0) {
    const currentFace = queue.shift()!;
    const currentNormal = topology.normals[currentFace]!;

    topology.adjacency[currentFace]?.forEach((neighborFace) => {
      if (visited.has(neighborFace)) {
        return;
      }

      const neighborNormal = topology.normals[neighborFace]!;
      if (currentNormal.dot(neighborNormal) < FACE_ISLAND_NORMAL_DOT_THRESHOLD) {
        return;
      }

      visited.add(neighborFace);
      queue.push(neighborFace);
    });
  }

  return Array.from(visited).sort((left, right) => left - right);
}

function resolveTextureLoader(manager?: THREE.LoadingManager): THREE.TextureLoader | null {
  return manager ? new THREE.TextureLoader(manager) : new THREE.TextureLoader();
}

function createPaletteMaterial(
  template: THREE.Material,
  descriptor: UrdfVisualMaterial | undefined,
  textureLoader: THREE.TextureLoader | null,
  textureCache: Map<string, THREE.Texture>,
  slotIndex: number,
): THREE.Material {
  const nextMaterial =
    typeof template.clone === 'function'
      ? template.clone()
      : createMatteMaterial({
          color: '#ffffff',
          preserveExactColor: true,
          name: `paint_slot_${slotIndex}`,
        });
  const parsedColor = parseThreeColorWithOpacity(descriptor?.color);
  const parsedEmissive = parseThreeColorWithOpacity(descriptor?.emissive);
  const texturePath = normalizeMaterialValue(descriptor?.texture);
  const opacityOverride =
    normalizeUnitIntervalValue(descriptor?.opacity) ??
    colorRgbaTupleToOpacity(descriptor?.colorRgba);
  const roughnessOverride = normalizeUnitIntervalValue(descriptor?.roughness);
  const metalnessOverride = normalizeUnitIntervalValue(descriptor?.metalness);
  const emissiveIntensityOverride = normalizeNonNegativeValue(descriptor?.emissiveIntensity);
  const effectiveOpacity = opacityOverride ?? parsedColor?.opacity;

  if (descriptor?.name?.trim()) {
    nextMaterial.name = descriptor.name.trim();
  } else if (!nextMaterial.name) {
    nextMaterial.name = `paint_slot_${slotIndex}`;
  }

  if (parsedColor && (nextMaterial as THREE.MeshStandardMaterial).color?.isColor) {
    (nextMaterial as THREE.MeshStandardMaterial).color.copy(parsedColor.color);
    if (slotIndex > 0) {
      (nextMaterial as THREE.MeshStandardMaterial).map = null;
    }
  }

  if (effectiveOpacity != null) {
    nextMaterial.opacity = effectiveOpacity;
    nextMaterial.transparent = nextMaterial.transparent || effectiveOpacity < 1;
  }

  if (roughnessOverride !== undefined && 'roughness' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).roughness = roughnessOverride;
  }

  if (metalnessOverride !== undefined && 'metalness' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).metalness = metalnessOverride;
  }

  if (parsedEmissive && 'emissive' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).emissive.copy(parsedEmissive.color);
  }

  if (emissiveIntensityOverride !== undefined && 'emissiveIntensity' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).emissiveIntensity = emissiveIntensityOverride;
  }

  if (texturePath && 'map' in nextMaterial && textureLoader) {
    const cachedTexture = textureCache.get(texturePath);
    if (cachedTexture) {
      (nextMaterial as THREE.MeshStandardMaterial).map = cachedTexture;
    } else {
      textureLoader.load(
        texturePath,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          textureCache.set(texturePath, texture);
          (nextMaterial as THREE.MeshStandardMaterial).map = texture;
          if (!parsedColor && (nextMaterial as THREE.MeshStandardMaterial).color?.isColor) {
            (nextMaterial as THREE.MeshStandardMaterial).color.set('#ffffff');
          }
          nextMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
          console.error('[MeshMaterialGroups] Failed to load palette texture.', {
            texturePath,
            error,
          });
        },
      );
    }
  } else if (slotIndex > 0 && parsedColor && 'map' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).map = null;
  }

  // Mesh palette edits are authoritative for this slot material.
  nextMaterial.needsUpdate = true;
  return nextMaterial;
}

export function resolveRuntimeMeshRootWithinVisual(mesh: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D = mesh;

  while (current.parent && !(current.parent as any).isURDFVisual) {
    current = current.parent;
  }

  return current;
}

export function resolveRuntimeMeshMaterialGroupKey(
  mesh: THREE.Object3D,
  root: THREE.Object3D = resolveRuntimeMeshRootWithinVisual(mesh),
): string {
  const tokens: string[] = [];
  let current: THREE.Object3D | null = mesh;

  while (current && current !== root) {
    const parent: THREE.Object3D | null = current.parent;
    if (!parent) {
      break;
    }

    const childIndex = parent.children.indexOf(current);
    const name = current.name?.trim();
    tokens.push(name ? `${childIndex}:${name}` : String(childIndex));
    current = parent;
  }

  return tokens.reverse().join('/') || '0';
}

export function applyVisualMeshMaterialGroupsToObject(
  object: THREE.Object3D,
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups'>,
  options: {
    manager?: THREE.LoadingManager;
  } = {},
): void {
  const authoredMaterials = getGeometryAuthoredMaterials(geometry);
  const textureLoader = resolveTextureLoader(options.manager);
  const textureCache = new Map<string, THREE.Texture>();
  const replacedMaterials = new Set<THREE.Material>();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry) || !mesh.material) {
      return;
    }

    const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, object);
    const meshGroups = getGeometryMeshMaterialGroupsForMesh(geometry, meshKey);
    const currentMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const templateMaterial =
      currentMaterial ??
      createMatteMaterial({
        color: '#ffffff',
        preserveExactColor: true,
        name: 'paint_slot_0',
      });

    if (meshGroups.length === 0) {
      const nextBaseMaterial = createPaletteMaterial(
        templateMaterial,
        authoredMaterials[0],
        textureLoader,
        textureCache,
        0,
      );
      const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
      mesh.geometry.clearGroups();
      mesh.material = nextBaseMaterial;
      (Array.isArray(previousMaterial)
        ? previousMaterial
        : previousMaterial
          ? [previousMaterial]
          : []
      ).forEach((material) => replacedMaterials.add(material));
      return;
    }

    const maxMaterialIndex = meshGroups.reduce(
      (currentMax, group) => Math.max(currentMax, group.materialIndex),
      0,
    );
    const nextMaterials = Array.from({ length: maxMaterialIndex + 1 }, (_, materialIndex) =>
      createPaletteMaterial(
        templateMaterial,
        authoredMaterials[materialIndex],
        textureLoader,
        textureCache,
        materialIndex,
      ),
    );
    const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
    mesh.geometry.clearGroups();
    meshGroups.forEach((group) => {
      mesh.geometry.addGroup(group.start, group.count, group.materialIndex);
    });
    mesh.material = nextMaterials;
    (Array.isArray(previousMaterial)
      ? previousMaterial
      : previousMaterial
        ? [previousMaterial]
        : []
    ).forEach((material) => replacedMaterials.add(material));
  });

  replacedMaterials.forEach((material) => {
    if (isProtectedMaterial(material)) {
      return;
    }

    material.dispose();
  });
}

export function getBufferGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
  return getGeometryTriangleCount(geometry);
}
