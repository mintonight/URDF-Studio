import { validateMJCFImportExternalAssets } from '@/core/parsers/mjcf/mjcfImportValidation';
import { resolveGazeboScriptMaterial } from '@/core/parsers/sdf/gazeboMaterialScripts';

export interface PackageAssetReferenceSource {
  name?: string;
  format: string;
  content: string;
}

export interface StandalonePackageAssetImportWarning {
  bundleRoots: string[];
  packageNames: string[];
}

export interface StandaloneImportAssetWarning {
  missingAssetPaths: string[];
}

export interface StandaloneImportAssetReferenceOptions {
  allFileContents?: Record<string, string>;
  sourcePath?: string;
}

const PACKAGE_ASSET_URI_PATTERN = /\b(?:package|model):\/\/([^\s"'<>]+)/g;

const PACKAGE_ROOT_BOUNDARY_SEGMENTS = new Set([
  'meshes',
  'mesh',
  'materials',
  'material',
  'textures',
  'texture',
  'urdf',
  'robot',
  'robots',
  'xacro',
  'sdf',
  'mjcf',
  'dae',
  'obj',
  'stl',
  'gltf',
  'glb',
  'launch',
  'config',
  'rviz',
  'worlds',
  'media',
  'thumbnail',
  'thumbnails',
]);

const ROOT_REFERENCE_FORMATS = new Set(['urdf', 'xacro', 'sdf']);
const GENERIC_ASSET_REFERENCE_FORMATS = new Set(['urdf', 'xacro', 'sdf', 'mjcf']);
const URDF_MESH_FILENAME_PATTERN = /<mesh\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi;
const URDF_TEXTURE_FILENAME_PATTERN = /<texture\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SDF_MESH_URI_PATTERN = /<mesh\b[^>]*>[\s\S]*?<uri>\s*([^<]+?)\s*<\/uri>[\s\S]*?<\/mesh>/gi;
const SDF_MATERIAL_SCRIPT_PATTERN =
  /<material\b[^>]*>[\s\S]*?<script\b[^>]*>([\s\S]*?)<\/script>[\s\S]*?<\/material>/gi;
const MJCF_COMPILER_MESHDIR_PATTERN = /<compiler\b[^>]*\bmeshdir\s*=\s*["']([^"']+)["'][^>]*>/i;
const MJCF_MESH_FILE_PATTERN = /<mesh\b[^>]*\bfile\s*=\s*["']([^"']+)["'][^>]*>/gi;

function sanitizeRootSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/^\.+/, '');
}

function normalizeRootSegmentIdentity(segment: string): string {
  return sanitizeRootSegment(segment)
    .replace(/ \(\d+\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeRootSegments(path: string): string[] {
  const segments = path.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];

  for (const rawSegment of segments) {
    const segment = sanitizeRootSegment(rawSegment);
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length > 0) {
        normalized.pop();
      }
      continue;
    }
    normalized.push(segment);
  }

  return normalized;
}

function inferBundleRootFromUriPath(uriPath: string): string | null {
  const segments = normalizeRootSegments(uriPath);
  if (segments.length === 0) {
    return null;
  }

  const [packageName, ...relativeSegments] = segments;
  const boundaryIndex = relativeSegments.findIndex((segment) =>
    PACKAGE_ROOT_BOUNDARY_SEGMENTS.has(segment.toLowerCase()),
  );

  const rootSegments = [
    packageName,
    ...(boundaryIndex > 0 ? relativeSegments.slice(0, boundaryIndex) : []),
  ].filter(Boolean);

  return rootSegments.length > 0 ? rootSegments.join('/') : null;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function stripExternalAssetScheme(path: string): string {
  if (path.startsWith('package://')) {
    return path.slice('package://'.length);
  }

  if (path.startsWith('model://')) {
    return path.slice('model://'.length);
  }

  return path;
}

function joinNormalizedAssetPath(basePath: string, relativePath: string): string {
  if (!basePath) {
    return relativePath;
  }

  return `${basePath.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}

function normalizeAssetReferencePath(path: string, meshDirectory = ''): string | null {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return null;
  }

  if (/^(?:blob:|data:|https?:\/\/)/i.test(trimmedPath)) {
    return null;
  }

  let normalizedPath = trimmedPath.replace(/\\/g, '/');
  const hadExternalScheme =
    normalizedPath.startsWith('package://') || normalizedPath.startsWith('model://');
  normalizedPath = stripExternalAssetScheme(normalizedPath);

  if (!hadExternalScheme && meshDirectory && !normalizedPath.startsWith('/')) {
    normalizedPath = joinNormalizedAssetPath(meshDirectory, normalizedPath);
  }

  const normalizedSegments = normalizeRootSegments(
    normalizedPath.replace(/^[A-Za-z]:\//, '').replace(/^\/+/, ''),
  );
  if (normalizedSegments.length === 0) {
    return null;
  }

  return normalizedSegments.join('/');
}

function assetPathMatchesBundleRoot(assetPath: string, bundleRoot: string): boolean {
  const normalizedAssetSegments = normalizeRootSegments(assetPath);
  const normalizedBundleSegments = normalizeRootSegments(bundleRoot);

  if (
    normalizedAssetSegments.length === 0 ||
    normalizedBundleSegments.length === 0 ||
    normalizedAssetSegments.length < normalizedBundleSegments.length
  ) {
    return false;
  }

  const normalizedBundleIdentities = normalizedBundleSegments.map(normalizeRootSegmentIdentity);

  for (
    let startIndex = 0;
    startIndex <= normalizedAssetSegments.length - normalizedBundleSegments.length;
    startIndex += 1
  ) {
    let matches = true;

    for (let segmentIndex = 0; segmentIndex < normalizedBundleSegments.length; segmentIndex += 1) {
      const assetSegment = normalizedAssetSegments[startIndex + segmentIndex] ?? '';
      const bundleSegment = normalizedBundleSegments[segmentIndex] ?? '';

      if (assetSegment === bundleSegment) {
        continue;
      }

      if (normalizeRootSegmentIdentity(assetSegment) !== normalizedBundleIdentities[segmentIndex]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function assetPathMatchesReferencePath(assetPath: string, referencePath: string): boolean {
  const normalizedAssetSegments = normalizeRootSegments(assetPath);
  const normalizedReferenceSegments = normalizeRootSegments(referencePath);

  if (
    normalizedAssetSegments.length === 0 ||
    normalizedReferenceSegments.length === 0 ||
    normalizedAssetSegments.length < normalizedReferenceSegments.length
  ) {
    return false;
  }

  const normalizedReferenceIdentities = normalizedReferenceSegments.map(
    normalizeRootSegmentIdentity,
  );

  for (
    let startIndex = 0;
    startIndex <= normalizedAssetSegments.length - normalizedReferenceSegments.length;
    startIndex += 1
  ) {
    let matches = true;

    for (
      let segmentIndex = 0;
      segmentIndex < normalizedReferenceSegments.length;
      segmentIndex += 1
    ) {
      const assetSegment = normalizedAssetSegments[startIndex + segmentIndex] ?? '';
      const referenceSegment = normalizedReferenceSegments[segmentIndex] ?? '';

      if (assetSegment === referenceSegment) {
        continue;
      }

      if (
        normalizeRootSegmentIdentity(assetSegment) !== normalizedReferenceIdentities[segmentIndex]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function commonRootPrefix(roots: readonly string[]): string | null {
  if (roots.length === 0) {
    return null;
  }

  const splitRoots = roots.map((root) => root.split('/').filter(Boolean));
  const prefix = [...splitRoots[0]];

  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const candidate = prefix.slice(0, index + 1);
    const matchesAll = splitRoots.every((segments) =>
      candidate.every((segment, segmentIndex) => segments[segmentIndex] === segment),
    );
    if (matchesAll) {
      return candidate.join('/');
    }
  }

  return null;
}

export function extractPackageAssetBundleRoots(content: string): string[] {
  const roots: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = PACKAGE_ASSET_URI_PATTERN.exec(content)) !== null) {
    const inferredRoot = inferBundleRootFromUriPath(match[1] ?? '');
    if (inferredRoot) {
      roots.push(inferredRoot);
    }
  }

  return uniqueSorted(roots);
}

export function inferCommonPackageAssetBundleRoot(
  sources: readonly PackageAssetReferenceSource[],
): string | null {
  const roots = uniqueSorted(
    sources.flatMap((source) =>
      ROOT_REFERENCE_FORMATS.has(source.format)
        ? extractPackageAssetBundleRoots(source.content)
        : [],
    ),
  );

  return commonRootPrefix(roots);
}

export function buildStandalonePackageAssetImportWarning(
  source: PackageAssetReferenceSource | null,
  assetPaths: readonly string[],
): StandalonePackageAssetImportWarning | null {
  if (!source || !ROOT_REFERENCE_FORMATS.has(source.format)) {
    return null;
  }

  const bundleRoots = extractPackageAssetBundleRoots(source.content);
  if (bundleRoots.length === 0) {
    return null;
  }

  const missingBundleRoots = bundleRoots.filter(
    (bundleRoot) =>
      !assetPaths.some((assetPath) => assetPathMatchesBundleRoot(assetPath, bundleRoot)),
  );
  if (missingBundleRoots.length === 0) {
    return null;
  }

  return {
    bundleRoots: missingBundleRoots,
    packageNames: uniqueSorted(missingBundleRoots.map((root) => root.split('/')[0] ?? root)),
  };
}

function extractAssetReferencePathsFromUrdfLikeContent(content: string): string[] {
  const references: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = URDF_MESH_FILENAME_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  while ((match = SDF_MESH_URI_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  while ((match = URDF_TEXTURE_FILENAME_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  return uniqueSorted(references);
}

function extractXmlTextValues(block: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>\\s*([^<]+?)\\s*<\\/${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(block)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      values.push(value);
    }
  }

  return uniqueSorted(values);
}

function extractSdfScriptTextureReferencePaths(
  content: string,
  { allFileContents = {}, sourcePath }: StandaloneImportAssetReferenceOptions = {},
): string[] {
  const references: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = SDF_MATERIAL_SCRIPT_PATTERN.exec(content)) !== null) {
    const scriptBlock = match[1] ?? '';
    const scriptNames = extractXmlTextValues(scriptBlock, 'name');
    const scriptUris = extractXmlTextValues(scriptBlock, 'uri');

    scriptNames.forEach((scriptName) => {
      const resolvedMaterial = resolveGazeboScriptMaterial({
        allFileContents,
        scriptName,
        scriptUris,
        sourcePath,
      });
      if (resolvedMaterial?.texture) {
        const normalizedPath = normalizeAssetReferencePath(resolvedMaterial.texture);
        if (normalizedPath) {
          references.push(normalizedPath);
        }
      }
    });
  }

  return uniqueSorted(references);
}

function extractMeshReferencePathsFromMjcfContent(content: string): string[] {
  const references: string[] = [];
  const meshDirectory = normalizeAssetReferencePath(
    content.match(MJCF_COMPILER_MESHDIR_PATTERN)?.[1] ?? '',
  );
  let match: RegExpExecArray | null;

  while ((match = MJCF_MESH_FILE_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '', meshDirectory ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  return uniqueSorted(references);
}

function extractExternalAssetWarningPathsFromMjcfContent(
  source: PackageAssetReferenceSource,
  assetPaths: readonly string[],
): string[] {
  const issues = validateMJCFImportExternalAssets(
    source.name ?? 'standalone-import.mjcf',
    source.content,
    [],
    Object.fromEntries(assetPaths.map((assetPath) => [assetPath, assetPath])),
  );

  return uniqueSorted(
    issues.filter((issue) => issue.referenceKind !== 'model').map((issue) => issue.resolvedPath),
  );
}

export function extractStandaloneImportAssetReferences(
  source: PackageAssetReferenceSource | null,
  options: StandaloneImportAssetReferenceOptions = {},
): string[] {
  if (!source || !GENERIC_ASSET_REFERENCE_FORMATS.has(source.format)) {
    return [];
  }

  if (source.format === 'mjcf') {
    return extractMeshReferencePathsFromMjcfContent(source.content);
  }

  if (source.format === 'sdf') {
    return uniqueSorted([
      ...extractAssetReferencePathsFromUrdfLikeContent(source.content),
      ...extractSdfScriptTextureReferencePaths(source.content, {
        ...options,
        sourcePath: options.sourcePath ?? source.name,
      }),
    ]);
  }

  return extractAssetReferencePathsFromUrdfLikeContent(source.content);
}

export function buildStandaloneImportAssetWarning(
  source: PackageAssetReferenceSource | null,
  assetPaths: readonly string[],
  options: StandaloneImportAssetReferenceOptions = {},
): StandaloneImportAssetWarning | null {
  const referencePaths =
    source?.format === 'mjcf'
      ? extractExternalAssetWarningPathsFromMjcfContent(source, assetPaths)
      : extractStandaloneImportAssetReferences(source, options);
  if (referencePaths.length === 0) {
    return null;
  }

  const missingAssetPaths = referencePaths.filter(
    (referencePath) =>
      !assetPaths.some((assetPath) => assetPathMatchesReferencePath(assetPath, referencePath)),
  );

  if (missingAssetPaths.length === 0) {
    return null;
  }

  return {
    missingAssetPaths,
  };
}
