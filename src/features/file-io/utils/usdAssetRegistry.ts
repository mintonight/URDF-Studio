import * as THREE from 'three';

import {
  buildMeshLookupCandidates,
  normalizeMeshPathForExport,
} from '@/core/parsers/meshPathUtils';
import { registerManagedTextureHandlers } from '@/core/loaders/textureLoaderHandlers';

export type UsdAssetRegistry = {
  direct: Map<string, string>;
  lowercase: Map<string, string>;
  filenameLower: Map<string, string>;
};

const registerUsdAssetAliases = (registry: UsdAssetRegistry, key: string, url: string) => {
  for (const candidate of buildMeshLookupCandidates(key)) {
    registry.direct.set(candidate, url);
    registry.lowercase.set(candidate.toLowerCase(), url);

    const filename = candidate.split('/').pop();
    if (filename) {
      registry.filenameLower.set(filename.toLowerCase(), url);
    }
  }
};

export const createUsdAssetRegistry = (
  assets: Record<string, string>,
  extraMeshFiles?: Map<string, Blob>,
): { registry: UsdAssetRegistry; tempObjectUrls: string[] } => {
  const registry: UsdAssetRegistry = {
    direct: new Map(),
    lowercase: new Map(),
    filenameLower: new Map(),
  };
  const tempObjectUrls: string[] = [];

  Object.entries(assets).forEach(([key, url]) => {
    registerUsdAssetAliases(registry, key, url);
  });

  extraMeshFiles?.forEach((blob, key) => {
    const objectUrl = URL.createObjectURL(blob);
    tempObjectUrls.push(objectUrl);
    registerUsdAssetAliases(registry, key, objectUrl);

    const exportPath = normalizeMeshPathForExport(key);
    if (exportPath) {
      registerUsdAssetAliases(registry, exportPath, objectUrl);
    }
  });

  return { registry, tempObjectUrls };
};

export const resolveUsdAssetUrl = (path: string, registry: UsdAssetRegistry): string | null => {
  if (!path) return null;
  if (/^(?:blob:|data:|https?:\/\/)/i.test(path)) {
    return path;
  }

  for (const candidate of buildMeshLookupCandidates(path)) {
    const directMatch = registry.direct.get(candidate);
    if (directMatch) return directMatch;

    const lowerMatch = registry.lowercase.get(candidate.toLowerCase());
    if (lowerMatch) return lowerMatch;
  }

  const lowerPath = path.toLowerCase();
  for (const [candidate, url] of registry.lowercase.entries()) {
    if (candidate.endsWith(lowerPath)) {
      return url;
    }
  }

  const filename = lowerPath.split('/').pop();
  if (filename) {
    const filenameMatch = registry.filenameLower.get(filename);
    if (filenameMatch) return filenameMatch;
  }

  return null;
};

export const createUsdTextureLoadingManager = (registry: UsdAssetRegistry): THREE.LoadingManager => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => resolveUsdAssetUrl(url, registry) ?? url);
  registerManagedTextureHandlers(manager);
  return manager;
};
