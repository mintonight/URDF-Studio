/**
 * Mesh Loader - Handles loading of mesh files (STL, MSH, DAE, OBJ, GLTF/GLB)
 *
 * Features:
 * - Pre-indexed asset lookup for O(1) complexity
 * - First-detection mode for automatic unit scaling
 * - Optional placeholder meshes for callers that explicitly opt in
 * - Support for STL, MSH, DAE, OBJ, GLTF/GLB formats
 */

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  buildMeshLookupCandidates,
  getSourceFileDirectory,
  resolveImportedAssetPath,
} from '@/core/parsers/meshPathUtils';
import { buildExplicitlyScaledMeshPathHints, hasExplicitMeshScaleHint } from './meshScaleHints';
import { mitigateCoplanarMaterialZFighting } from './coplanarMaterialOffset';
import { type ColladaRootNormalizationHints } from './colladaRootNormalization';
import { loadColladaScene } from './colladaParseWorkerBridge';
import { cleanFilePath } from './pathNormalization';
import {
  failFastInDev,
  logRuntimeFailure,
  normalizeRuntimeError,
} from '@/core/utils/runtimeDiagnostics';
import { MATERIAL_CONFIG } from '@/core/utils/materialFactory';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { createGeometryFromSerializedMshData, parseMshGeometryData } from './mshGeometryData';
import { cloneObjSceneWithOwnedResources, loadObjScene } from './objMaterialUtils';
import { createGeometryFromSerializedStlData } from './stlGeometryData';
import { loadSerializedStlGeometryData } from './stlParseWorkerBridge';

// ============================================================
// SHARED MATERIALS - Avoid shader recompilation for each mesh
// ============================================================
const DEFAULT_MESH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x707070, // Medium-dark grey for proper exposure in bright studio lighting
  roughness: MATERIAL_CONFIG.roughness,
  metalness: MATERIAL_CONFIG.metalness,
  envMapIntensity: MATERIAL_CONFIG.envMapIntensity,
});
const PLACEHOLDER_MATERIAL = new THREE.MeshPhongMaterial({
  color: 0xff6b6b,
  transparent: true,
  opacity: 0.7,
});

// Reusable Vector3 for size calculations (object pooling)
const _tempSize = new THREE.Vector3();
const _tempBox = new THREE.Box3();
const _tempChildBox = new THREE.Box3();

export const postProcessColladaScene = (root: THREE.Object3D): number => {
  const lightsToRemove: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  _tempBox.makeEmpty();

  root.traverse((child: THREE.Object3D) => {
    if ((child as any).isLight) {
      lightsToRemove.push(child);
      return;
    }

    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geometry = mesh.geometry;
      if (geometry) {
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }

        if (geometry.boundingBox) {
          _tempChildBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          _tempBox.union(_tempChildBox);
        }
      }

      mitigateCoplanarMaterialZFighting(mesh);
    }
  });

  for (let i = 0; i < lightsToRemove.length; i += 1) {
    lightsToRemove[i].parent?.remove(lightsToRemove[i]);
  }

  if (_tempBox.isEmpty()) {
    return 0;
  }

  _tempBox.getSize(_tempSize);
  return Math.max(_tempSize.x, _tempSize.y, _tempSize.z);
};

// ============================================================
// PERFORMANCE: Pre-indexed asset lookup for O(1) complexity
// Build once, lookup many times
// ============================================================
export interface AssetIndex {
  // Direct path -> URL mapping
  direct: Map<string, string>;
  // Lowercase path -> URL mapping (case-insensitive)
  lowercase: Map<string, string>;
  // Filename only -> URL mapping
  filename: Map<string, string>;
  // Lowercase filename -> URL mapping
  filenameLower: Map<string, string>;
  // Suffix matches (for fuzzy matching)
  suffixes: Map<string, string>;
  // All cleaned asset paths grouped by lowercase filename
  filenameCandidates: Map<string, string[]>;
  // All cleaned asset paths grouped by lowercase suffix
  suffixCandidates: Map<string, string[]>;
  // Unique cleaned asset paths for last-resort similarity matching
  cleanedPaths: string[];
}

const assetIndexCache = new WeakMap<Record<string, string>, Map<string, AssetIndex>>();

const pushUniqueCandidate = (target: string[], seen: Set<string>, value?: string) => {
  const normalized = cleanFilePath(String(value || ''));
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
};

const pushIndexedAssetPath = (target: Map<string, string[]>, key: string, value: string) => {
  if (!key || !value) {
    return;
  }

  const existing = target.get(key);
  if (!existing) {
    target.set(key, [value]);
    return;
  }

  if (!existing.includes(value)) {
    existing.push(value);
  }
};

const splitPathSegments = (value: string): string[] =>
  cleanFilePath(value).split('/').filter(Boolean);

const tokenizePathSegment = (segment: string): string[] => {
  const normalized = segment
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();

  return normalized.split(/[^a-z0-9]+/).filter(Boolean);
};

const flattenPathTokens = (segments: string[]): string[] =>
  segments.flatMap((segment) => tokenizePathSegment(segment));

const countMatchingPrefixSegments = (left: string[], right: string[]): number => {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
};

const countMatchingSuffixSegments = (left: string[], right: string[]): number => {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
};

const countLongestCommonSubpath = (left: string[], right: string[]): number => {
  let best = 0;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      let span = 0;
      while (
        leftIndex + span < left.length &&
        rightIndex + span < right.length &&
        left[leftIndex + span] === right[rightIndex + span]
      ) {
        span += 1;
      }
      if (span > best) {
        best = span;
      }
    }
  }

  return best;
};

const countSharedTokens = (left: string[], right: string[]): number => {
  const leftTokens = new Set(flattenPathTokens(left));
  const rightTokens = new Set(flattenPathTokens(right));

  let count = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      count += 1;
    }
  });

  return count;
};

const countOverlapSuffixPrefix = (
  ancestorSegments: string[],
  relativeSegments: string[],
): number => {
  const maxOverlap = Math.min(ancestorSegments.length, relativeSegments.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (ancestorSegments[ancestorSegments.length - overlap + index] !== relativeSegments[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlap;
    }
  }

  return 0;
};

function scoreAssetCandidatePath(
  candidatePath: string,
  references: string[],
  urdfDir: string,
): number {
  const candidateSegments = splitPathSegments(candidatePath);
  if (candidateSegments.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let bestReferenceScore = 0;
  for (const reference of references) {
    const referenceSegments = splitPathSegments(reference);
    if (referenceSegments.length === 0) {
      continue;
    }

    const suffixScore = countMatchingSuffixSegments(candidateSegments, referenceSegments);
    const subpathScore = countLongestCommonSubpath(candidateSegments, referenceSegments);
    const prefixScore = countMatchingPrefixSegments(candidateSegments, referenceSegments);
    const tokenScore = countSharedTokens(candidateSegments, referenceSegments);
    const score = suffixScore * 10000 + subpathScore * 1000 + prefixScore * 100 + tokenScore * 10;

    if (score > bestReferenceScore) {
      bestReferenceScore = score;
    }
  }

  const urdfSegments = splitPathSegments(urdfDir);
  const urdfScore =
    urdfSegments.length > 0
      ? countMatchingPrefixSegments(candidateSegments, urdfSegments) * 1000 +
        countSharedTokens(candidateSegments, urdfSegments) * 25
      : 0;

  return bestReferenceScore + urdfScore + candidateSegments.length;
}

function selectBestAssetMatch(
  candidatePaths: string[] | undefined,
  index: AssetIndex,
  references: string[],
  urdfDir: string,
): string | null {
  if (!candidatePaths || candidatePaths.length === 0) {
    return null;
  }

  let bestPath: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidatePath of candidatePaths) {
    const cleanedCandidate = cleanFilePath(candidatePath);
    const score = scoreAssetCandidatePath(cleanedCandidate, references, urdfDir);

    if (
      score > bestScore ||
      (score === bestScore && bestPath !== null && cleanedCandidate < bestPath)
    ) {
      bestPath = cleanedCandidate;
      bestScore = score;
    }
  }

  if (!bestPath) {
    return null;
  }

  return index.direct.get(bestPath) || index.lowercase.get(bestPath.toLowerCase()) || null;
}

function resolveImportedPackageCandidateMatch(
  packagePath: string,
  index: AssetIndex,
  urdfDir: string,
  references: string[],
  seenReferences: Set<string>,
): string | null {
  if (!packagePath) {
    return null;
  }

  const importedPackageCandidates = buildImportedPackagePathCandidates(packagePath, urdfDir);
  importedPackageCandidates.forEach((candidate) => {
    pushUniqueCandidate(references, seenReferences, candidate);
  });

  for (const candidate of importedPackageCandidates) {
    let result = index.direct.get(candidate);
    if (result) return result;

    result = index.lowercase.get(candidate.toLowerCase());
    if (result) return result;

    result = selectBestAssetMatch(
      index.suffixCandidates.get(candidate.toLowerCase()),
      index,
      references,
      urdfDir,
    );
    if (result) return result;
  }

  return null;
}

const getFilenameFromPath = (value: string): string => {
  const cleaned = cleanFilePath(value);
  const lastSlash = cleaned.lastIndexOf('/');
  return lastSlash === -1 ? cleaned : cleaned.substring(lastSlash + 1);
};

const splitFilenameStem = (filename: string): { extension: string; stemSegments: string[] } => {
  const cleaned = cleanFilePath(filename);
  const lastDot = cleaned.lastIndexOf('.');
  const extension = lastDot >= 0 ? cleaned.substring(lastDot).toLowerCase() : '';
  const stem = lastDot >= 0 ? cleaned.substring(0, lastDot) : cleaned;
  return {
    extension,
    stemSegments: stem ? [stem] : [],
  };
};

const APPROXIMATE_STEM_SUFFIX_PATTERN = /(?:[_\-.](?:visual|collision|mesh|model))+$/i;
const SUPPORTED_MESH_EXTENSIONS = new Set(['stl', 'msh', 'dae', 'obj', 'gltf', 'glb', 'vtk']);
const APPROXIMATE_EXTENSION_ALIASES: Record<string, string[]> = {
  '.mesh': ['.mesh', '.dae', '.obj', '.stl', '.gltf', '.glb'],
};

const getPathExtension = (value: string): string => {
  const cleaned = cleanFilePath(value);
  const lastSlash = cleaned.lastIndexOf('/');
  const filename = lastSlash === -1 ? cleaned : cleaned.substring(lastSlash + 1);
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot + 1).toLowerCase();
};

const getApproximateCompatibleExtensions = (extension: string): Set<string> | null => {
  if (!extension) {
    return null;
  }

  const normalized = extension.toLowerCase();
  const aliases = APPROXIMATE_EXTENSION_ALIASES[normalized];
  return new Set(aliases ?? [normalized]);
};

const buildApproximateStemVariants = (
  filename: string,
): Array<{ stemSegments: string[]; aliasStripped: boolean }> => {
  const { stemSegments } = splitFilenameStem(filename);
  const variants: Array<{ stemSegments: string[]; aliasStripped: boolean }> = [];
  const seen = new Set<string>();

  const pushVariant = (stem: string, aliasStripped: boolean) => {
    const normalized = cleanFilePath(stem);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    variants.push({
      stemSegments: [normalized],
      aliasStripped,
    });
  };

  const originalStem = stemSegments[0] ?? '';
  pushVariant(originalStem, false);

  let simplifiedStem = originalStem;
  while (simplifiedStem) {
    const strippedStem = simplifiedStem.replace(APPROXIMATE_STEM_SUFFIX_PATTERN, '');
    if (!strippedStem || strippedStem === simplifiedStem) {
      break;
    }
    pushVariant(strippedStem, true);
    simplifiedStem = strippedStem;
  }

  return variants;
};

function selectBestApproximateFilenameMatch(
  filename: string,
  index: AssetIndex,
  references: string[],
  urdfDir: string,
): string | null {
  const { extension } = splitFilenameStem(filename);
  const compatibleExtensions = getApproximateCompatibleExtensions(extension);
  const prefersVisualCandidates = extension === '.mesh';
  const requestVariants = buildApproximateStemVariants(filename)
    .map((variant) => ({
      ...variant,
      normalizedStem: cleanFilePath(variant.stemSegments[0] ?? ''),
      tokens: new Set(flattenPathTokens(variant.stemSegments)),
    }))
    .filter((variant) => variant.tokens.size > 0);

  if (requestVariants.length === 0) {
    return null;
  }

  let bestPath: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (const candidatePath of index.cleanedPaths) {
    const candidateFilename = getFilenameFromPath(candidatePath);
    const { extension: candidateExtension, stemSegments: candidateStemSegments } =
      splitFilenameStem(candidateFilename);
    const candidateStem = cleanFilePath(candidateStemSegments[0] ?? '');
    if (
      compatibleExtensions &&
      candidateExtension &&
      !compatibleExtensions.has(candidateExtension)
    ) {
      continue;
    }

    const candidateTokens = new Set(flattenPathTokens(candidateStemSegments));
    let candidateBestScore = Number.NEGATIVE_INFINITY;

    for (const requestVariant of requestVariants) {
      let tokenOverlap = 0;
      requestVariant.tokens.forEach((token) => {
        if (candidateTokens.has(token)) {
          tokenOverlap += 1;
        }
      });

      if (tokenOverlap === 0) {
        continue;
      }

      let score = scoreAssetCandidatePath(candidatePath, references, urdfDir) + tokenOverlap * 5000;
      const requestIsSubset = Array.from(requestVariant.tokens).every((token) =>
        candidateTokens.has(token),
      );
      if (requestIsSubset) {
        score += 2000;
      }
      if (requestVariant.normalizedStem && requestVariant.normalizedStem === candidateStem) {
        score += 4000;
      }
      if (requestVariant.aliasStripped) {
        score += 1000;
      }
      if (prefersVisualCandidates) {
        const candidatePathLower = candidatePath.toLowerCase();
        if (candidatePathLower.includes('/visual/')) {
          score += 1500;
        }
        if (candidatePathLower.includes('/collision/')) {
          score -= 1500;
        }
      }

      if (score > candidateBestScore) {
        candidateBestScore = score;
      }
    }

    if (candidateBestScore === Number.NEGATIVE_INFINITY) {
      continue;
    }

    if (candidateBestScore > bestScore) {
      secondBestScore = bestScore;
      bestScore = candidateBestScore;
      bestPath = candidatePath;
      continue;
    }

    if (candidateBestScore > secondBestScore) {
      secondBestScore = candidateBestScore;
    }
  }

  if (!bestPath || bestScore <= secondBestScore) {
    return null;
  }

  return index.direct.get(bestPath) || index.lowercase.get(bestPath.toLowerCase()) || null;
}

function buildImportedPackagePathCandidates(packagePath: string, urdfDir: string = ''): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedPackagePath = cleanFilePath(packagePath);
  const normalizedUrdfDir = cleanFilePath(urdfDir).replace(/\/+$/, '');

  if (!normalizedPackagePath || !normalizedUrdfDir) {
    return candidates;
  }

  const urdfSegments = normalizedUrdfDir.split('/').filter(Boolean);
  if (urdfSegments.length === 0) {
    return candidates;
  }

  const [packageName] = normalizedPackagePath.split('/');
  const packageIndex = packageName ? urdfSegments.indexOf(packageName) : -1;
  const packageSegments = normalizedPackagePath.split('/').filter(Boolean);
  const packageTailSegments = packageSegments.slice(1);
  const packageTail = packageTailSegments.join('/');

  if (packageIndex > 0) {
    pushUniqueCandidate(
      candidates,
      seen,
      `${urdfSegments.slice(0, packageIndex).join('/')}/${normalizedPackagePath}`,
    );
  }

  if (packageIndex === -1) {
    pushUniqueCandidate(candidates, seen, `${normalizedUrdfDir}/${normalizedPackagePath}`);
    pushUniqueCandidate(candidates, seen, `${urdfSegments[0]}/${normalizedPackagePath}`);

    if (packageTail) {
      for (let prefixLength = urdfSegments.length; prefixLength >= 1; prefixLength -= 1) {
        const ancestorSegments = urdfSegments.slice(0, prefixLength);
        const overlap = countOverlapSuffixPrefix(ancestorSegments, packageTailSegments);
        const ancestorPrefix = ancestorSegments
          .slice(0, ancestorSegments.length - overlap)
          .join('/');
        pushUniqueCandidate(
          candidates,
          seen,
          ancestorPrefix ? `${ancestorPrefix}/${packageTail}` : packageTail,
        );
      }
    }
  }

  return candidates;
}

function buildAssetIndexUncached(assets: Record<string, string>, urdfDir: string = ''): AssetIndex {
  const index: AssetIndex = {
    direct: new Map(),
    lowercase: new Map(),
    filename: new Map(),
    filenameLower: new Map(),
    suffixes: new Map(),
    filenameCandidates: new Map(),
    suffixCandidates: new Map(),
    cleanedPaths: [],
  };

  for (const [key, value] of Object.entries(assets)) {
    // Direct mapping
    index.direct.set(key, value);

    // Cleaned path
    const cleaned = cleanFilePath(key);
    index.direct.set(cleaned, value);
    if (!index.cleanedPaths.includes(cleaned)) {
      index.cleanedPaths.push(cleaned);
    }

    // With urdfDir prefix
    if (urdfDir) {
      index.direct.set(urdfDir + cleaned, value);
      index.direct.set(urdfDir + key, value);
    }

    // Lowercase variants
    index.lowercase.set(key.toLowerCase(), value);
    index.lowercase.set(cleaned.toLowerCase(), value);

    // Filename only
    const filename = key.split('/').pop() || key;
    index.filename.set(filename, value);
    index.filenameLower.set(filename.toLowerCase(), value);
    pushIndexedAssetPath(index.filenameCandidates, filename.toLowerCase(), cleaned);

    // Suffix matching: keep every slash-delimited suffix so that
    // visual/collision subpaths and package tails remain distinguishable.
    const cleanedSegments = cleaned.split('/').filter(Boolean);
    for (let indexOffset = 0; indexOffset < cleanedSegments.length; indexOffset += 1) {
      const suffix = cleanedSegments.slice(indexOffset).join('/').toLowerCase();
      if (!index.suffixes.has(suffix)) {
        index.suffixes.set(suffix, value);
      }
      pushIndexedAssetPath(index.suffixCandidates, suffix, cleaned);
    }
  }

  return index;
}

// Build pre-indexed asset lookup (call once during model load)
export const buildAssetIndex = (
  assets: Record<string, string>,
  urdfDir: string = '',
): AssetIndex => {
  const normalizedUrdfDir = cleanFilePath(urdfDir);
  const cachedByDirectory = assetIndexCache.get(assets);
  const cachedIndex = cachedByDirectory?.get(normalizedUrdfDir);
  if (cachedIndex) {
    return cachedIndex;
  }

  const nextIndex = buildAssetIndexUncached(assets, urdfDir);
  const nextCachedByDirectory = cachedByDirectory ?? new Map<string, AssetIndex>();
  nextCachedByDirectory.set(normalizedUrdfDir, nextIndex);
  if (!cachedByDirectory) {
    assetIndexCache.set(assets, nextCachedByDirectory);
  }

  return nextIndex;
};

// Fast O(1) asset lookup using pre-built index
export const findAssetByIndex = (
  path: string,
  index: AssetIndex,
  urdfDir: string = '',
): string | null => {
  // Strategy 0: Direct match (most common case)
  let result = index.direct.get(path);
  if (result) return result;

  const referencePaths: string[] = [];
  const seenReferencePaths = new Set<string>();
  // Clean the path (optimized version)
  let cleanPath = path.replace(/\\/g, '/');
  let packagePath = '';

  // Remove blob: prefix if present
  if (cleanPath.startsWith('blob:')) {
    const slashIdx = cleanPath.indexOf('/', 5);
    if (slashIdx !== -1) {
      cleanPath = cleanPath.substring(slashIdx + 1);
    }
  }

  // Try package-relative lookup before falling back to package-local paths.
  if (cleanPath.startsWith('package://')) {
    packagePath = cleanFilePath(cleanPath.substring(10).replace(/^\/+/, ''));
    if (packagePath) {
      pushUniqueCandidate(referencePaths, seenReferencePaths, packagePath);
      result = index.direct.get(packagePath);
      if (result) return result;

      result = index.lowercase.get(packagePath.toLowerCase());
      if (result) return result;

      result = resolveImportedPackageCandidateMatch(
        packagePath,
        index,
        urdfDir,
        referencePaths,
        seenReferencePaths,
      );
      if (result) return result;
    }

    cleanPath = packagePath;
    const slashIdx = cleanPath.indexOf('/');
    if (slashIdx !== -1) {
      cleanPath = cleanPath.substring(slashIdx + 1);
    }
  }

  // Remove leading ./
  if (cleanPath.startsWith('./')) {
    cleanPath = cleanPath.substring(2);
  }

  // Normalize path
  const normalizedPath = cleanFilePath(cleanPath);
  const resolvedPath = urdfDir
    ? resolveImportedAssetPath(cleanPath, `${urdfDir}__asset_lookup__`)
    : normalizedPath;
  pushUniqueCandidate(referencePaths, seenReferencePaths, cleanPath);
  pushUniqueCandidate(referencePaths, seenReferencePaths, normalizedPath);
  pushUniqueCandidate(referencePaths, seenReferencePaths, resolvedPath);

  if (!packagePath && normalizedPath.startsWith('/')) {
    const absolutePackagePath = normalizedPath.replace(/^\/+/, '');
    pushUniqueCandidate(referencePaths, seenReferencePaths, absolutePackagePath);
    result = resolveImportedPackageCandidateMatch(
      absolutePackagePath,
      index,
      urdfDir,
      referencePaths,
      seenReferencePaths,
    );
    if (result) return result;
  }

  // Strategy 1: Direct lookup with normalized path
  result = index.direct.get(normalizedPath);
  if (result) return result;

  // Strategy 2: With urdfDir
  if (urdfDir && resolvedPath) {
    result = index.direct.get(resolvedPath);
    if (result) return result;
  }

  // Strategy 3: Clean path
  result = index.direct.get(cleanPath);
  if (result) return result;

  // Strategy 4: Lowercase lookup
  const lowerPath = resolvedPath.toLowerCase();
  result = index.lowercase.get(lowerPath);
  if (result) return result;

  // Strategy 5: Filename only
  const lastSlash = resolvedPath.lastIndexOf('/');
  const filename = lastSlash === -1 ? resolvedPath : resolvedPath.substring(lastSlash + 1);
  result = selectBestAssetMatch(
    index.filenameCandidates.get(filename.toLowerCase()),
    index,
    referencePaths,
    urdfDir,
  );
  if (result) return result;

  // Strategy 6: Suffix match
  result = selectBestAssetMatch(
    index.suffixCandidates.get(lowerPath),
    index,
    referencePaths,
    urdfDir,
  );
  if (result) return result;

  // Strategy 7: Candidate-based lookup for imported package paths like
  // "/pkg/meshes/part.dae" when the asset library only stores "meshes/part.dae".
  for (const candidate of buildMeshLookupCandidates(path)) {
    pushUniqueCandidate(referencePaths, seenReferencePaths, candidate);
    result = index.direct.get(candidate);
    if (result) return result;

    result = index.lowercase.get(candidate.toLowerCase());
    if (result) return result;

    result = selectBestAssetMatch(
      index.suffixCandidates.get(candidate.toLowerCase()),
      index,
      referencePaths,
      urdfDir,
    );
    if (result) return result;
  }

  result = selectBestApproximateFilenameMatch(filename, index, referencePaths, urdfDir);
  if (result) return result;

  return null;
};

// Legacy function for backward compatibility (uses non-indexed lookup)
export const findAssetByPath = (
  path: string,
  assets: Record<string, string>,
  urdfDir: string = '',
): string | null => {
  const assetIndex = buildAssetIndex(assets, urdfDir);
  const result = findAssetByIndex(path, assetIndex, urdfDir);
  if (result) {
    return result;
  }

  if (Object.keys(assets).length > 0) {
    const normalizedPath = cleanFilePath(
      path
        .replace(/\\/g, '/')
        .replace(/^blob:[^/]*\//, '')
        .replace(/^package:\/\//i, '')
        .replace(/^\/+/, '')
        .replace(/^(\.\/)+/, ''),
    );
    console.error(`[MeshLoader] Asset lookup failed for: "${path}"`);
    console.error(`[MeshLoader] Search path was: "${normalizedPath}"`);
    const keys = Object.keys(assets);
    console.error(`[MeshLoader] Available assets (first 10):`, keys.slice(0, 10));
    const fn = path.split('/').pop() || '';
    const partialMatches = keys.filter((k) => k.toLowerCase().includes(fn.toLowerCase()));
    if (partialMatches.length > 0) {
      console.error(`[MeshLoader] Potential partial matches found:`, partialMatches);
    }
  }

  return null;
};

// Loading manager that resolves asset URLs from our blob storage
export const resolveManagedAssetUrl = (
  url: string,
  assetIndex: AssetIndex,
  urdfDir: string = '',
): string => {
  const isTextureUrl = /\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp)$/i.test(url);

  // Blob/data URLs are normally already resolved. Collada can sometimes build
  // malformed blob-relative paths like "blob:http://host/texture.png", so try
  // to recover the filename and remap it back through the imported asset index.
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const blobMatch = url.match(/^blob:https?:\/\/[^/]+\/(.+)$/);
    if (
      blobMatch?.[1] &&
      /\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb|vtk|bin)$/i.test(blobMatch[1])
    ) {
      const found = findAssetByIndex(blobMatch[1], assetIndex, urdfDir);
      if (found) {
        return found;
      }
    }
    return url;
  }

  const found = findAssetByIndex(url, assetIndex, urdfDir);
  if (found) {
    return found;
  }

  // Allow HTTP/HTTPS URLs to pass through (e.g. cloud storage or CDN links)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  console.error('[MeshLoader] Asset not found:', url);
  const unresolvedAssetError = new Error(
    `Asset lookup failed for "${url}" under "${urdfDir || '.'}".`,
  );

  failFastInDev('MeshLoader:resolveManagedAssetUrl', unresolvedAssetError);
  throw unresolvedAssetError;
};

export const createLoadingManager = (assets: Record<string, string>, urdfDir: string = '') => {
  const manager = new THREE.LoadingManager();
  const assetIndex = buildAssetIndex(assets, urdfDir);

  manager.setURLModifier((url: string) => resolveManagedAssetUrl(url, assetIndex, urdfDir));

  return manager;
};

// Shared placeholder geometry (created once)
const PLACEHOLDER_GEOMETRY = new THREE.BoxGeometry(0.05, 0.05, 0.05);

// Optional placeholder mesh for callers that explicitly opt into degraded rendering.
export const createPlaceholderMesh = (path: string): THREE.Object3D => {
  // Use shared geometry and material to avoid shader recompilation
  const mesh = new THREE.Mesh(PLACEHOLDER_GEOMETRY, PLACEHOLDER_MATERIAL);
  mesh.userData.isPlaceholder = true;
  mesh.userData.missingMeshPath = path;
  return mesh;
};

// ============================================================
// PERFORMANCE: First-detection mode for unit scaling
// Once we detect the scale factor, apply it to all subsequent meshes
// ============================================================
// State moved to createMeshLoader closure

// Reset unit detection (call when loading new model)
// Deprecated: State is now scoped to createMeshLoader closure
export const resetUnitDetection = () => {
  // No-op
};

export interface MeshLoaderOptions {
  assetIndex?: AssetIndex;
  allowPlaceholderMeshes?: boolean;
  explicitScaleMeshPaths?: Iterable<string>;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  yieldIfNeeded?: () => Promise<void>;
  yieldBudgetMs?: number;
}

interface CachedMeshAsset {
  createInstance: () => THREE.Object3D;
  maxDimension: number | null;
  hasDeclaredUnitScale: boolean;
  supportsAutoUnitScale: boolean;
}

const resolveMeshLoaderExtension = (
  requestedPath: string,
  resolvedAssetPath: string = '',
): string => {
  const requestedExtension = getPathExtension(requestedPath);
  if (SUPPORTED_MESH_EXTENSIONS.has(requestedExtension)) {
    return requestedExtension;
  }

  const resolvedExtension = getPathExtension(resolvedAssetPath);
  if (SUPPORTED_MESH_EXTENSIONS.has(resolvedExtension)) {
    return resolvedExtension;
  }

  return requestedExtension;
};

const cloneMaterialInstance = <TMaterial extends THREE.Material>(
  material: TMaterial,
): TMaterial => {
  const clonedMaterial = material.clone() as TMaterial;
  clonedMaterial.userData = {
    ...(material.userData ?? {}),
    ...(clonedMaterial.userData ?? {}),
  };
  return clonedMaterial;
};

const cloneMaterialsInObject = <TObject extends THREE.Object3D>(root: TObject): TObject => {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => cloneMaterialInstance(material));
      return;
    }

    if (mesh.material) {
      mesh.material = cloneMaterialInstance(mesh.material);
    }
  });

  return root;
};

const objectHasSkinnedMeshes = (root: THREE.Object3D): boolean => {
  let hasSkinnedMeshes = false;

  root.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      hasSkinnedMeshes = true;
    }
  });

  return hasSkinnedMeshes;
};

const cloneObject3DForReuse = (
  source: THREE.Object3D,
  options: { preserveSkeletons?: boolean } = {},
): THREE.Object3D => {
  const clonedRoot = options.preserveSkeletons ? cloneSkeleton(source) : source.clone(true);

  return cloneMaterialsInObject(clonedRoot);
};

/**
 * Check whether any descendant of the given root has a non-identity local
 * scale.  DAE files exported from tools like Blender may encode unit
 * conversions (e.g. inch → meter as 0.0254) in child node <matrix>
 * transforms rather than in the root <unit> element.
 */
const hasDescendantNodeScale = (root: THREE.Object3D): boolean => {
  const stack = Array.from(root.children);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      Math.abs(node.scale.x - 1) > 1e-6 ||
      Math.abs(node.scale.y - 1) > 1e-6 ||
      Math.abs(node.scale.z - 1) > 1e-6
    ) {
      return true;
    }
    for (let i = 0; i < node.children.length; i += 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
};

const applyDetectedUnitScale = (meshObject: THREE.Object3D, unitScale: number | null): void => {
  if (!unitScale || unitScale === 1) {
    return;
  }

  meshObject.scale.set(unitScale, unitScale, unitScale);
};

// Custom mesh loader callback with first-detection unit scaling
export const createMeshLoader = (
  assets: Record<string, string>,
  manager: THREE.LoadingManager,
  urdfDir: string = '',
  options: MeshLoaderOptions = {},
) => {
  // Scoped state for this loader instance
  let _detectedUnitScale: number | null = null;
  let pendingRequestCounter = 0;
  const cachedMeshAssetPromises = new Map<string, Promise<CachedMeshAsset>>();
  const assetIndex = options.assetIndex ?? buildAssetIndex(assets, urdfDir);
  const assetUrlToPath = new Map<string, string>();
  Object.entries(assets).forEach(([assetPath, assetUrl]) => {
    if (!assetUrlToPath.has(assetUrl)) {
      assetUrlToPath.set(assetUrl, cleanFilePath(assetPath));
    }
  });
  const explicitScaleHints = options.explicitScaleMeshPaths
    ? buildExplicitlyScaledMeshPathHints(options.explicitScaleMeshPaths, urdfDir)
    : null;
  const allowPlaceholderMeshes = options.allowPlaceholderMeshes === true;
  const yieldIfNeeded =
    options.yieldIfNeeded ?? createMainThreadYieldController(options.yieldBudgetMs);

  const resolveMeshFailure = (
    path: string,
    message: string,
    cause?: unknown,
  ): { error: Error; object: THREE.Object3D | null } => {
    const error = normalizeRuntimeError(cause, message);
    logRuntimeFailure('MeshLoader', new Error(`${message} (${path})`, { cause: error }));

    return {
      error,
      object: allowPlaceholderMeshes ? createPlaceholderMesh(path) : null,
    };
  };

  const loadOrCreateCachedMeshAsset = async (
    assetUrl: string,
    ext: string,
  ): Promise<CachedMeshAsset> => {
    const cacheKey = `${ext}:${assetUrl}`;
    const cachedPromise = cachedMeshAssetPromises.get(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }

    const pendingPromise = (async (): Promise<CachedMeshAsset> => {
      if (ext === 'stl') {
        const serializedGeometry = await loadSerializedStlGeometryData(assetUrl);
        const geometry = createGeometryFromSerializedStlData(serializedGeometry);
        await yieldIfNeeded();

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: serializedGeometry.maxDimension,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: true,
        };
      }

      if (ext === 'msh') {
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch legacy MSH asset: ${response.status} ${response.statusText}`,
          );
        }

        const serializedGeometry = parseMshGeometryData(await response.arrayBuffer());
        const geometry = createGeometryFromSerializedMshData(serializedGeometry);
        await yieldIfNeeded();

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: serializedGeometry.maxDimension,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: true,
        };
      }

      if (ext === 'dae') {
        const scene = await loadColladaScene(assetUrl, manager);

        await yieldIfNeeded();
        const maxDimension = postProcessColladaScene(scene);
        scene.updateMatrix();
        await yieldIfNeeded();

        // When the DAE file carries a unit conversion — either as a root
        // scale (baked by createSceneFromSerializedColladaData from the
        // <unit> element) or as a non-identity scale in any descendant node
        // (e.g. Blender exports inch→meter as a 0.0254 <matrix> transform
        // on child nodes) — the auto-unit heuristic (maxDimension > 10 →
        // ×0.001) must NOT fire, because the geometry is already at the
        // correct scale.  Applying the heuristic would override the
        // authored conversion and shrink the model by the wrong factor.
        const hasExplicitDaeUnitScale =
          Math.abs(scene.scale.x - 1) > 1e-6 ||
          Math.abs(scene.scale.y - 1) > 1e-6 ||
          Math.abs(scene.scale.z - 1) > 1e-6 ||
          hasDescendantNodeScale(scene);

        return {
          createInstance: () => cloneObject3DForReuse(scene),
          maxDimension,
          hasDeclaredUnitScale: Number.isFinite(
            (scene.userData as { colladaUnitScale?: unknown })?.colladaUnitScale,
          ),
          supportsAutoUnitScale: !hasExplicitDaeUnitScale,
        };
      }

      if (ext === 'obj') {
        const sourcePath = assetUrlToPath.get(assetUrl) ?? '';
        const objManager = new THREE.LoadingManager();
        objManager.setURLModifier((url: string) =>
          resolveManagedAssetUrl(url, assetIndex, getSourceFileDirectory(sourcePath)),
        );
        const object = await loadObjScene(assetUrl, objManager, sourcePath);
        await yieldIfNeeded();

        return {
          createInstance: () => cloneObjSceneWithOwnedResources(object),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      if (ext === 'gltf' || ext === 'glb') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader(manager);
        const gltfModel = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
          loader.load(assetUrl, resolve, undefined, reject);
        });
        const preserveSkeletons = objectHasSkinnedMeshes(gltfModel.scene);

        return {
          createInstance: () => cloneObject3DForReuse(gltfModel.scene, { preserveSkeletons }),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      if (ext === 'vtk') {
        const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
        const loader = new VTKLoader(manager);
        const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          loader.load(assetUrl, resolve, undefined, reject);
        });

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      throw new Error(`Unsupported mesh format: ${ext}`);
    })();

    cachedMeshAssetPromises.set(cacheKey, pendingPromise);

    try {
      return await pendingPromise;
    } catch (error) {
      cachedMeshAssetPromises.delete(cacheKey);
      throw error;
    }
  };

  return async (
    path: string,
    _manager: THREE.LoadingManager,
    done: (result: THREE.Object3D | null, err?: Error) => void,
  ) => {
    const pendingRequestToken = `__urdf_studio_mesh_loader__${pendingRequestCounter++}:${path}`;
    manager.itemStart(pendingRequestToken);

    try {
      const assetUrl = findAssetByIndex(path, assetIndex, urdfDir);

      if (assetUrl) {
        // Asset found, proceed with loading
      }

      if (!assetUrl) {
        const failure = resolveMeshFailure(path, 'Mesh asset could not be resolved.');
        done(failure.object, failure.error);
        return;
      }

      const resolvedAssetPath = assetUrlToPath.get(assetUrl) ?? '';
      const ext = resolveMeshLoaderExtension(path, resolvedAssetPath);
      const hasExplicitScale = hasExplicitMeshScaleHint(path, explicitScaleHints, urdfDir);

      const cachedMeshAsset = await loadOrCreateCachedMeshAsset(assetUrl, ext);
      const meshObject = cachedMeshAsset.createInstance();

      if (
        cachedMeshAsset.supportsAutoUnitScale &&
        !cachedMeshAsset.hasDeclaredUnitScale &&
        !hasExplicitScale
      ) {
        if (_detectedUnitScale !== null) {
          applyDetectedUnitScale(meshObject, _detectedUnitScale);
        } else if ((cachedMeshAsset.maxDimension ?? 0) > 10) {
          _detectedUnitScale = 0.001;
          applyDetectedUnitScale(meshObject, _detectedUnitScale);
        }
      }

      if (meshObject) {
        await yieldIfNeeded();
        if (ext !== 'dae') {
          meshObject.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              mitigateCoplanarMaterialZFighting(child as THREE.Mesh);
            }
          });
        }
        done(meshObject);
      } else {
        const failure = resolveMeshFailure(
          path,
          `Unsupported mesh format "${ext}" returned no mesh object.`,
        );
        done(failure.object, failure.error);
      }
    } catch (error) {
      const failure = resolveMeshFailure(path, 'Mesh loading failed.', error);
      done(failure.object, failure.error);
    } finally {
      manager.itemEnd(pendingRequestToken);
    }
  };
};
