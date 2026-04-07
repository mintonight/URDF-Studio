/**
 * Mesh path utilities for robust export.
 *
 * Handles common path formats from imported URDF/MJCF/Xacro files:
 * - package://<pkg>/meshes/part.stl
 * - ../meshes/part.stl
 * - /meshes/part.stl
 * - windows\\path\\part.stl
 */

import { GeometryType, type RobotData, type RobotState, type UrdfLink } from '@/types';

const normalizeRelativePath = (path: string): string => {
  const segments = path.split('/');
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return stack.join('/');
};

const stripPackagePrefix = (path: string): string => {
  const scheme = path.startsWith('package://')
    ? 'package://'
    : path.startsWith('model://')
      ? 'model://'
      : null;
  if (!scheme) return path;
  const withoutScheme = path.slice(scheme.length);
  const slashIndex = withoutScheme.indexOf('/');
  return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
};

const stripBlobPrefix = (path: string): string => {
  if (!path.startsWith('blob:')) return path;
  const slashIndex = path.indexOf('/', 5);
  return slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
};

const stripExternalPrefix = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('data:')) return path;
  return stripPackagePrefix(stripBlobPrefix(path));
};

const normalizePackageAssetPath = (path: string): string | null => {
  const scheme = path.startsWith('package://')
    ? 'package://'
    : path.startsWith('model://')
      ? 'model://'
      : null;
  if (!scheme) return null;

  const withoutScheme = path.slice(scheme.length).replace(/\\/g, '/');
  const slashIndex = withoutScheme.indexOf('/');
  const packageName = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;
  const relativePath = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : '';
  const normalizedRelativePath = normalizeRelativePath(
    relativePath
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, '')
      .replace(/^(\.\/)+/, ''),
  );

  if (!packageName) return normalizedRelativePath || null;
  if (!normalizedRelativePath) return packageName;

  return `${packageName}/${normalizedRelativePath}`;
};

/**
 * Directory of the source robot file, always with forward slashes and a trailing slash.
 */
export const getSourceFileDirectory = (sourceFilePath?: string | null): string => {
  const normalized = (sourceFilePath ?? '').trim().replace(/\\/g, '/');
  if (!normalized) return '';

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return '';

  return normalized.slice(0, lastSlash + 1);
};

/**
 * Resolve an imported asset path against the directory of its source robot file.
 * This turns relative paths like "meshes/leg.dae" into stable library paths like
 * "go1/meshes/leg.dae", which avoids collisions between different robot packages.
 */
export const resolveImportedAssetPath = (
  assetPath: string,
  sourceFilePath?: string | null,
): string => {
  const raw = (assetPath || '').trim();
  if (!raw) return '';

  if (/^(?:blob:|https?:\/\/|data:)/i.test(raw)) {
    return raw;
  }

  const packageAssetPath = normalizePackageAssetPath(raw);
  if (packageAssetPath) {
    return packageAssetPath;
  }

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripExternalPrefix(normalized);
  normalized = normalized.replace(/^[A-Za-z]:\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');

  const sourceDir = getSourceFileDirectory(sourceFilePath);
  if (!normalized) return raw;
  if (!sourceDir) return normalizeRelativePath(normalized);
  if (normalized.startsWith(sourceDir)) return normalizeRelativePath(normalized);

  return normalizeRelativePath(`${sourceDir}${normalized}`);
};

type RobotWithLinks = RobotData | RobotState;

function rewriteMeshGeometryForSource<T extends UrdfLink['visual'] | UrdfLink['collision']>(
  geometry: T,
  sourceFilePath?: string | null,
): T {
  if (!geometry || geometry.type !== GeometryType.MESH || !geometry.meshPath) {
    return geometry;
  }

  const resolvedPath = resolveImportedAssetPath(geometry.meshPath, sourceFilePath);
  if (!resolvedPath || resolvedPath === geometry.meshPath) {
    return geometry;
  }

  return {
    ...geometry,
    meshPath: resolvedPath,
  };
}

/**
 * Rewrite mesh paths in parsed robot data to stable library-relative paths.
 */
export const rewriteRobotMeshPathsForSource = <T extends RobotWithLinks>(
  robot: T,
  sourceFilePath?: string | null,
): T => {
  if (!sourceFilePath) return robot;

  let linksChanged = false;
  const nextLinks: Record<string, UrdfLink> = {};

  Object.entries(robot.links).forEach(([linkId, link]) => {
    const nextVisual = rewriteMeshGeometryForSource(link.visual, sourceFilePath);
    let nextVisualBodies = link.visualBodies;
    const nextCollision = rewriteMeshGeometryForSource(link.collision, sourceFilePath);
    let nextCollisionBodies = link.collisionBodies;

    if (link.visualBodies?.length) {
      const rewrittenBodies = link.visualBodies.map((body) =>
        rewriteMeshGeometryForSource(body, sourceFilePath),
      );

      const bodiesChanged = rewrittenBodies.some(
        (body, index) => body !== link.visualBodies?.[index],
      );
      if (bodiesChanged) {
        nextVisualBodies = rewrittenBodies;
      }
    }

    if (link.collisionBodies?.length) {
      const rewrittenBodies = link.collisionBodies.map((body) =>
        rewriteMeshGeometryForSource(body, sourceFilePath),
      );

      const bodiesChanged = rewrittenBodies.some(
        (body, index) => body !== link.collisionBodies?.[index],
      );
      if (bodiesChanged) {
        nextCollisionBodies = rewrittenBodies;
      }
    }

    const linkChanged =
      nextVisual !== link.visual ||
      nextVisualBodies !== link.visualBodies ||
      nextCollision !== link.collision ||
      nextCollisionBodies !== link.collisionBodies;

    if (linkChanged) {
      linksChanged = true;
      nextLinks[linkId] = {
        ...link,
        visual: nextVisual,
        visualBodies: nextVisualBodies,
        collision: nextCollision,
        collisionBodies: nextCollisionBodies,
      };
      return;
    }

    nextLinks[linkId] = link;
  });

  if (!linksChanged) return robot;

  return {
    ...robot,
    links: nextLinks,
  };
};

/**
 * Convert any mesh path into a stable export path relative to zip "meshes/" folder.
 */
export const normalizeMeshPathForExport = (meshPath: string): string => {
  const raw = (meshPath || '').trim();
  if (!raw) return '';

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripBlobPrefix(normalized);
  normalized = stripPackagePrefix(normalized);

  // Drop Windows drive prefix (e.g. C:/)
  normalized = normalized.replace(/^[A-Za-z]:\//, '');

  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');
  normalized = normalizeRelativePath(normalized);

  const lower = normalized.toLowerCase();
  const meshDirIndex = lower.indexOf('/meshes/');
  if (meshDirIndex >= 0) {
    normalized = normalized.slice(meshDirIndex + '/meshes/'.length);
  } else if (lower.startsWith('meshes/')) {
    normalized = normalized.slice('meshes/'.length);
  } else if (lower.startsWith('mesh/')) {
    normalized = normalized.slice('mesh/'.length);
  } else {
    const segments = normalized.split('/');
    const packageAssetRoots = new Set([
      'dae',
      'obj',
      'stl',
      'gltf',
      'glb',
      'texture',
      'textures',
      'material',
      'materials',
    ]);

    // Imported ROS packages are often rewritten to "pkg_name/dae/part.dae".
    // Strip the package root here because the URDF export already prepends
    // "package://<export-name>/meshes/" on top of the stored mesh path.
    if (segments.length >= 3 && packageAssetRoots.has(segments[1].toLowerCase())) {
      normalized = segments.slice(1).join('/');
    }
  }

  normalized = normalizeRelativePath(normalized);

  if (!normalized) {
    const fallback = raw.split(/[\\/]/).pop() || '';
    return fallback;
  }

  return normalized;
};

/**
 * Convert any texture path into a stable export path relative to zip "textures/" folder.
 */
export const normalizeTexturePathForExport = (texturePath: string): string => {
  const raw = (texturePath || '').trim();
  if (!raw) return '';
  if (/^(?:blob:|https?:\/\/|data:)/i.test(raw)) {
    return raw;
  }

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripBlobPrefix(normalized);
  normalized = stripPackagePrefix(normalized);

  normalized = normalized.replace(/^[A-Za-z]:\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');
  normalized = normalizeRelativePath(normalized);

  const lower = normalized.toLowerCase();
  const textureDirIndex = lower.indexOf('/textures/');
  if (textureDirIndex >= 0) {
    return normalized.slice(textureDirIndex + '/textures/'.length);
  }

  if (lower.startsWith('textures/')) {
    return normalized.slice('textures/'.length);
  }

  if (lower.startsWith('texture/')) {
    return normalized.slice('texture/'.length);
  }

  const segments = normalized.split('/');
  const packageTextureRoots = new Set([
    'texture',
    'textures',
    'material',
    'materials',
    'image',
    'images',
  ]);

  if (segments.length >= 3 && packageTextureRoots.has(segments[1].toLowerCase())) {
    return segments.slice(2).join('/');
  }

  return normalized;
};

interface RewriteUrdfAssetPathsForExportOptions {
  exportRobotName: string;
  useRelativePaths?: boolean;
}

function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

function buildUrdfMeshExportFilename(
  meshPath: string,
  { exportRobotName, useRelativePaths = false }: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (isExternalAssetPath(meshPath)) {
    return meshPath;
  }

  const normalizedPath = normalizeMeshPathForExport(meshPath) || meshPath.replace(/\\/g, '/');
  return useRelativePaths
    ? `meshes/${normalizedPath}`
    : `package://${exportRobotName}/meshes/${normalizedPath}`;
}

function buildUrdfTextureExportFilename(
  texturePath: string,
  { exportRobotName, useRelativePaths = false }: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (isExternalAssetPath(texturePath)) {
    return texturePath;
  }

  const normalizedPath =
    normalizeTexturePathForExport(texturePath) || texturePath.replace(/\\/g, '/');
  return useRelativePaths
    ? `textures/${normalizedPath}`
    : `package://${exportRobotName}/textures/${normalizedPath}`;
}

function rewriteXmlTagFilenameAttribute(
  xml: string,
  tagName: 'mesh' | 'texture',
  rewritePath: (path: string) => string,
): string {
  const tagPattern = new RegExp(
    `(<${tagName}\\b[^>]*\\bfilename\\s*=\\s*)(["'])([^"']*)(\\2)`,
    'gi',
  );

  return xml.replace(
    tagPattern,
    (_match, prefix, quote, filename, closingQuote) =>
      `${prefix}${quote}${rewritePath(filename)}${closingQuote}`,
  );
}

/**
 * Rewrite raw URDF mesh/texture asset filenames for zip export while preserving
 * the original document structure, including multi-material mesh visuals.
 */
export function rewriteUrdfAssetPathsForExport(
  urdfContent: string,
  options: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (!urdfContent.trim()) {
    return urdfContent;
  }

  const withRewrittenMeshes = rewriteXmlTagFilenameAttribute(urdfContent, 'mesh', (meshPath) =>
    buildUrdfMeshExportFilename(meshPath, options),
  );

  return rewriteXmlTagFilenameAttribute(withRewrittenMeshes, 'texture', (texturePath) =>
    buildUrdfTextureExportFilename(texturePath, options),
  );
}

const pushUnique = (values: string[], seen: Set<string>, value?: string) => {
  if (!value) return;
  const v = value.trim();
  if (!v) return;
  if (seen.has(v)) return;
  seen.add(v);
  values.push(v);
};

/**
 * Build candidate keys for mesh lookup in assets map.
 */
export const buildMeshLookupCandidates = (meshPath: string): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const raw = (meshPath || '').trim();
  const slashNormalized = raw.replace(/\\/g, '/');
  const strippedPackage = stripPackagePrefix(slashNormalized);
  const strippedBlob = stripBlobPrefix(slashNormalized);
  const strippedBoth = stripPackagePrefix(strippedBlob);
  const relative = normalizeRelativePath(strippedBoth.replace(/^\/+/, '').replace(/^(\.\/)+/, ''));
  const exportRelative = normalizeMeshPathForExport(meshPath);
  const filename = (exportRelative || relative || slashNormalized).split('/').pop() || '';

  pushUnique(candidates, seen, raw);
  pushUnique(candidates, seen, slashNormalized);
  pushUnique(candidates, seen, strippedPackage);
  pushUnique(candidates, seen, strippedBlob);
  pushUnique(candidates, seen, strippedBoth);
  pushUnique(candidates, seen, relative);
  pushUnique(candidates, seen, exportRelative);

  pushUnique(candidates, seen, filename);

  if (exportRelative) {
    pushUnique(candidates, seen, `meshes/${exportRelative}`);
    pushUnique(candidates, seen, `/meshes/${exportRelative}`);
  }

  if (filename) {
    pushUnique(candidates, seen, `meshes/${filename}`);
    pushUnique(candidates, seen, `/meshes/${filename}`);
  }

  return candidates;
};

/**
 * Resolve mesh blob URL from assets map using robust matching.
 */
export const resolveMeshAssetUrl = (
  meshPath: string,
  assets: Record<string, string>,
): string | null => {
  const candidates = buildMeshLookupCandidates(meshPath);
  if (candidates.length === 0) return null;

  // 1) Fast exact match
  for (const candidate of candidates) {
    const exact = assets[candidate];
    if (exact) return exact;
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase());

  // 2) Case-insensitive exact match
  for (const [key, value] of Object.entries(assets)) {
    if (lowerCandidates.includes(key.toLowerCase())) {
      return value;
    }
  }

  // 3) Suffix-based fuzzy match (handles nested paths and aliases)
  for (const [key, value] of Object.entries(assets)) {
    const keyLower = key.toLowerCase();
    for (const candidate of lowerCandidates) {
      if (keyLower.endsWith(candidate) || candidate.endsWith(keyLower)) {
        return value;
      }
    }
  }

  return null;
};
