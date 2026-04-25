import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { getSourceFileDirectory, resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import type { UrdfVisualMaterial } from '@/types';

export interface ObjMaterialMetadata {
  color?: string;
  texture?: string;
}

export type TextAssetContentLookup = ReadonlyMap<string, string>;
const TEXTURE_DIRECTIVE_PATTERN = /^([ \t]*(?:map_[^\s]+|bump|disp|decal|refl)\b[ \t]*)(.*)$/i;
const MATERIAL_TEXTURE_PROPERTIES = [
  'map',
  'lightMap',
  'bumpMap',
  'normalMap',
  'specularMap',
  'envMap',
  'alphaMap',
  'aoMap',
  'displacementMap',
  'emissiveMap',
  'gradientMap',
  'metalnessMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularColorMap',
  'specularIntensityMap',
] as const;

function normalizeLookupPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim().replace(/^\/+/, '').split('?')[0];
}

function rgbaUnitChannelToHex(value: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
  return byte.toString(16).padStart(2, '0');
}

function parseMtlColorHex(mtlText: string): string | undefined {
  const match = mtlText.match(
    /^[ \t]*K[da][ \t]+([0-9eE.+-]+)[ \t]+([0-9eE.+-]+)[ \t]+([0-9eE.+-]+)/m,
  );
  if (!match) {
    return undefined;
  }

  const channels = match.slice(1, 4).map((value) => Number.parseFloat(value));
  if (!channels.every((value) => Number.isFinite(value))) {
    return undefined;
  }

  return `#${channels.map(rgbaUnitChannelToHex).join('')}`;
}

function parseMtlTexturePath(line: string): string | null {
  const tokens = line.trim().split(/\s+/).slice(1);
  if (tokens.length === 0) {
    return null;
  }

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]?.trim();
    if (!token || token.startsWith('-')) {
      continue;
    }
    return token;
  }

  return null;
}

function findBestLookupPath(
  assetPath: string,
  textAssetContentLookup: TextAssetContentLookup,
): string | null {
  const normalizedAssetPath = normalizeLookupPath(assetPath);
  if (!normalizedAssetPath) {
    return null;
  }

  if (textAssetContentLookup.has(normalizedAssetPath)) {
    return normalizedAssetPath;
  }

  const basename = normalizedAssetPath.split('/').pop()?.toLowerCase() || '';
  if (!basename) {
    return null;
  }

  const packagePrefix = normalizedAssetPath.split('/')[0]?.toLowerCase() || '';
  const candidates = Array.from(textAssetContentLookup.keys()).filter((candidatePath) => {
    const candidateBasename = candidatePath.split('/').pop()?.toLowerCase() || '';
    return candidateBasename === basename;
  });

  if (candidates.length === 0) {
    return null;
  }

  const samePackageCandidate = candidates.find((candidatePath) => {
    const candidatePrefix = candidatePath.split('/')[0]?.toLowerCase() || '';
    return packagePrefix && candidatePrefix === packagePrefix;
  });

  return samePackageCandidate ?? candidates[0] ?? null;
}

function resolveMtlTextureRequestUrl(
  texturePath: string,
  materialFilePath: string,
  manager: THREE.LoadingManager,
): string {
  const resolvedTexturePath = resolveImportedAssetPath(texturePath, materialFilePath);
  return manager.resolveURL(resolvedTexturePath || texturePath);
}

export function rewriteMtlTextureReferencesForManager(
  materialText: string,
  materialFilePath: string,
  manager: THREE.LoadingManager,
): string {
  return materialText
    .split(/\r?\n/)
    .map((line) => {
      const directiveMatch = line.match(TEXTURE_DIRECTIVE_PATTERN);
      if (!directiveMatch) {
        return line;
      }

      const texturePath = parseMtlTexturePath(line);
      if (!texturePath) {
        return line;
      }

      const value = directiveMatch[2] ?? '';
      const textureStart = value.lastIndexOf(texturePath);
      if (textureStart < 0) {
        return line;
      }

      const resolvedRequestUrl = resolveMtlTextureRequestUrl(
        texturePath,
        materialFilePath,
        manager,
      );

      return `${directiveMatch[1]}${value.slice(0, textureStart)}${resolvedRequestUrl}${value.slice(
        textureStart + texturePath.length,
      )}`;
    })
    .join('\n');
}

function parseMtlTextureReference(mtlText: string): string | undefined {
  const lines = mtlText.split(/\r?\n/);
  for (const line of lines) {
    if (!/^[ \t]*(?:map_|bump|disp)[A-Za-z0-9_ \t-]*/.test(line)) {
      continue;
    }

    const texturePath = parseMtlTexturePath(line);
    if (texturePath) {
      return texturePath;
    }
  }

  return undefined;
}

export function parseObjMaterialLibraries(objText: string): string[] {
  const materialLibraries: string[] = [];
  const seenLibraries = new Set<string>();
  const matches = objText.matchAll(/^[ \t]*mtllib[ \t]+(.+)$/gim);
  for (const match of matches) {
    const rawValue = String(match[1] || '').trim();
    if (!rawValue) {
      continue;
    }

    for (const materialLibrary of rawValue.split(/\s+/)) {
      const normalizedMaterialLibrary = materialLibrary.trim();
      if (!normalizedMaterialLibrary || seenLibraries.has(normalizedMaterialLibrary)) {
        continue;
      }

      seenLibraries.add(normalizedMaterialLibrary);
      materialLibraries.push(normalizedMaterialLibrary);
    }
  }

  return materialLibraries;
}

export function createTextAssetContentLookup(
  allFileContents: Record<string, string>,
): TextAssetContentLookup {
  const lookup = new Map<string, string>();

  for (const [filePath, content] of Object.entries(allFileContents)) {
    if (typeof content !== 'string' || content.length === 0) {
      continue;
    }

    const normalizedPath = normalizeLookupPath(filePath);
    if (!normalizedPath) {
      continue;
    }

    lookup.set(normalizedPath, content);
  }

  return lookup;
}

function findTextAssetContent(
  assetPath: string,
  textAssetContentLookup: TextAssetContentLookup,
): string | null {
  const resolvedAssetPath = findBestLookupPath(assetPath, textAssetContentLookup);
  if (!resolvedAssetPath) {
    return null;
  }

  return textAssetContentLookup.get(resolvedAssetPath) ?? null;
}

function findTextAssetEntry(
  assetPath: string,
  textAssetContentLookup: TextAssetContentLookup,
): { path: string; content: string } | null {
  const resolvedAssetPath = findBestLookupPath(assetPath, textAssetContentLookup);
  if (!resolvedAssetPath) {
    return null;
  }

  const content = textAssetContentLookup.get(resolvedAssetPath);
  if (!content) {
    return null;
  }

  return {
    path: resolvedAssetPath,
    content,
  };
}

function parseMtlAuthoredMaterials(
  mtlText: string,
  materialFilePath: string,
  textAssetContentLookup: TextAssetContentLookup,
): UrdfVisualMaterial[] {
  const materials: UrdfVisualMaterial[] = [];
  let currentMaterial: UrdfVisualMaterial | null = null;

  const flushMaterial = () => {
    if (!currentMaterial) {
      return;
    }

    if (currentMaterial.name || currentMaterial.color || currentMaterial.texture) {
      materials.push(currentMaterial);
    }
  };

  mtlText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const newMaterialMatch = trimmed.match(/^newmtl\s+(.+)$/i);
    if (newMaterialMatch) {
      flushMaterial();
      currentMaterial = {
        ...(newMaterialMatch[1]?.trim() ? { name: newMaterialMatch[1].trim() } : {}),
      };
      return;
    }

    if (!currentMaterial) {
      return;
    }

    const diffuseMatch = trimmed.match(/^Kd\s+(.+)$/i);
    if (diffuseMatch) {
      const color = parseMtlColorHex(`Kd ${diffuseMatch[1]}`);
      if (color) {
        currentMaterial.color = color;
      }
      return;
    }

    const ambientMatch = trimmed.match(/^Ka\s+(.+)$/i);
    if (ambientMatch && !currentMaterial.color) {
      const color = parseMtlColorHex(`Ka ${ambientMatch[1]}`);
      if (color) {
        currentMaterial.color = color;
      }
      return;
    }

    if (!/^[ \t]*(?:map_|bump|disp)[A-Za-z0-9_ \t-]*/.test(line) || currentMaterial.texture) {
      return;
    }

    const rawTexturePath = parseMtlTexturePath(line);
    if (!rawTexturePath) {
      return;
    }

    const resolvedTextureCandidate = resolveImportedAssetPath(rawTexturePath, materialFilePath);
    const resolvedTexturePath =
      findBestLookupPath(resolvedTextureCandidate || rawTexturePath, textAssetContentLookup) ||
      findBestLookupPath(rawTexturePath, textAssetContentLookup) ||
      normalizeLookupPath(resolvedTextureCandidate || rawTexturePath);
    if (resolvedTexturePath) {
      currentMaterial.texture = resolvedTexturePath;
    }
  });

  flushMaterial();
  return materials;
}

export function deriveObjAuthoredMaterialsFromLookup(
  meshPath: string,
  textAssetContentLookup: TextAssetContentLookup,
): UrdfVisualMaterial[] {
  const normalizedMeshPath = normalizeLookupPath(meshPath);
  if (!normalizedMeshPath) {
    return [];
  }

  const meshEntry = findTextAssetEntry(normalizedMeshPath, textAssetContentLookup);
  if (!meshEntry) {
    return [];
  }

  const authoredMaterials: UrdfVisualMaterial[] = [];
  for (const materialLibrary of parseObjMaterialLibraries(meshEntry.content)) {
    const resolvedMaterialCandidate = resolveImportedAssetPath(materialLibrary, meshEntry.path);
    const materialEntry =
      findTextAssetEntry(resolvedMaterialCandidate || materialLibrary, textAssetContentLookup) ||
      findTextAssetEntry(materialLibrary, textAssetContentLookup);
    if (!materialEntry) {
      continue;
    }

    authoredMaterials.push(
      ...parseMtlAuthoredMaterials(
        materialEntry.content,
        materialEntry.path,
        textAssetContentLookup,
      ),
    );
  }

  return authoredMaterials;
}

export function deriveObjMaterialMetadataFromLookup(
  meshPath: string,
  textAssetContentLookup: TextAssetContentLookup,
): ObjMaterialMetadata | null {
  const [primaryMaterial] = deriveObjAuthoredMaterialsFromLookup(meshPath, textAssetContentLookup);
  if (primaryMaterial) {
    return {
      ...(primaryMaterial.color ? { color: primaryMaterial.color } : {}),
      ...(primaryMaterial.texture ? { texture: primaryMaterial.texture } : {}),
    };
  }

  return null;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch text asset: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function loadObjMaterialCreator(
  objText: string,
  manager: THREE.LoadingManager,
  sourcePath?: string | null,
): Promise<ReturnType<MTLLoader['parse']> | null> {
  const rewrittenMaterialTexts: string[] = [];

  for (const materialLibrary of parseObjMaterialLibraries(objText)) {
    const resolvedMaterialPath = sourcePath
      ? resolveImportedAssetPath(materialLibrary, sourcePath)
      : normalizeLookupPath(materialLibrary);
    try {
      const materialRequestUrl = manager.resolveURL(resolvedMaterialPath || materialLibrary);
      const materialText = await fetchText(materialRequestUrl);
      const rewrittenMaterialText = rewriteMtlTextureReferencesForManager(
        materialText,
        resolvedMaterialPath || materialLibrary,
        manager,
      );
      rewrittenMaterialTexts.push(rewrittenMaterialText);
    } catch {
      // Treat referenced material libraries as optional. Missing MTLs (or missing
      // texture sidecars inside them) should not prevent bare OBJ geometry from loading.
      continue;
    }
  }

  if (rewrittenMaterialTexts.length === 0) {
    return null;
  }

  const materials = new MTLLoader(manager).parse(rewrittenMaterialTexts.join('\n\n'), '');
  materials.preload();
  return materials;
}

export async function loadObjScene(
  assetUrl: string,
  manager: THREE.LoadingManager,
  sourcePath?: string | null,
): Promise<THREE.Group> {
  const requestUrl = manager.resolveURL(assetUrl);
  const objText = await fetchText(requestUrl);
  const loader = new OBJLoader(manager);
  const materials = await loadObjMaterialCreator(objText, manager, sourcePath);
  if (materials) {
    loader.setMaterials(materials);
  }

  return loader.parse(objText);
}

function cloneTextureWithOwnedInstance<TValue>(value: TValue): TValue {
  if (!(value instanceof THREE.Texture)) {
    return value;
  }

  const clonedTexture = value.clone();
  clonedTexture.needsUpdate = true;
  return clonedTexture as TValue;
}

function cloneMaterialWithOwnedTextures<TMaterial extends THREE.Material>(
  material: TMaterial,
): TMaterial {
  const clonedMaterial = material.clone() as TMaterial;
  clonedMaterial.userData = {
    ...(material.userData ?? {}),
    ...(clonedMaterial.userData ?? {}),
  };

  MATERIAL_TEXTURE_PROPERTIES.forEach((property) => {
    const texture = (material as Record<string, unknown>)[property];
    if (texture instanceof THREE.Texture) {
      (clonedMaterial as Record<string, unknown>)[property] =
        cloneTextureWithOwnedInstance(texture);
    }
  });

  return clonedMaterial;
}

export function cloneObjSceneWithOwnedResources<TObject extends THREE.Object3D>(
  source: TObject,
): TObject {
  const clonedRoot = source.clone(true) as TObject;

  clonedRoot.traverse((child) => {
    const renderable = child as THREE.Mesh | THREE.LineSegments | THREE.Points;
    if (!renderable.geometry || !('material' in renderable)) {
      return;
    }

    renderable.geometry = renderable.geometry.clone();

    if (Array.isArray(renderable.material)) {
      renderable.material = renderable.material.map((material) =>
        cloneMaterialWithOwnedTextures(material),
      );
      return;
    }

    if (renderable.material) {
      renderable.material = cloneMaterialWithOwnedTextures(renderable.material);
    }
  });

  return clonedRoot;
}
