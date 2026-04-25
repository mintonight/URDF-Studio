import { buildAssetIndex, findAssetByIndex } from '@/core/loaders';
import { mergeTextMeshSidecarAssets } from '@/core/loaders/textMeshAssetContext';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import { collectGeometryTexturePaths, getVisualGeometryEntries } from '@/core/robot';
import { GeometryType, type RobotFile, type RobotMaterialState, type UrdfLink } from '@/types';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';

import {
  inferUsdBundleVirtualDirectory,
  isUsdPathWithinBundleDirectory,
} from './usdPreloadSources';

const KNOWN_BUNDLE_SEGMENTS = new Set([
  'urdf',
  'xml',
  'usd',
  'mjcf',
  'xacro',
  'meshes',
  'mesh',
  'materials',
  'material',
  'textures',
  'texture',
  'assets',
]);

const DUPLICATE_FOLDER_SUFFIX_PATTERN = /^(.*?)(?: \((\d+)\))?$/;

function normalizeBundleSegment(segment: string): string {
  const normalized = String(segment || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return '';
  }

  return normalized.match(DUPLICATE_FOLDER_SUFFIX_PATTERN)?.[1] ?? normalized;
}

function isKnownBundleSegment(segment: string): boolean {
  return KNOWN_BUNDLE_SEGMENTS.has(normalizeBundleSegment(segment));
}

function normalizePath(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function normalizeDirectory(path: string | null | undefined): string {
  const normalized = normalizePath(path).replace(/\/?$/, '');
  return normalized ? `${normalized}/` : '';
}

function collapsePathSegments(path: string | null | undefined): string {
  const segments = String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/');
  const stack: string[] = [];

  segments.forEach((segment) => {
    if (!segment || segment === '.') {
      return;
    }

    if (segment === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      return;
    }

    stack.push(segment);
  });

  return stack.join('/');
}

function getParentDirectory(path: string | null | undefined): string {
  const normalized = normalizePath(path);
  if (!normalized) {
    return '';
  }

  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? `${normalized.slice(0, lastSlash + 1)}` : '';
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  if (!directory) return false;
  const normalizedPath = normalizePath(path);
  const normalizedDirectory = normalizeDirectory(directory);
  return normalizedPath.startsWith(normalizedDirectory);
}

function resolveMjcfScopedPath(path: string, currentFilePath: string): string {
  const trimmedPath = String(path || '').trim();
  if (!trimmedPath) {
    return '';
  }

  if (/^(?:blob:|https?:\/\/|data:)/i.test(trimmedPath)) {
    return trimmedPath;
  }

  if (/^(?:package|model):\/\//i.test(trimmedPath)) {
    return normalizePath(resolveImportedAssetPath(trimmedPath, currentFilePath));
  }

  const normalizedPath = trimmedPath.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '');
  if (normalizedPath.startsWith('/') || normalizedPath.includes(':')) {
    return normalizePath(resolveImportedAssetPath(trimmedPath, currentFilePath));
  }

  return collapsePathSegments(`${getParentDirectory(currentFilePath)}${normalizedPath}`);
}

function inferGenericBundleDirectory(sourceFilePath: string | null | undefined): string {
  const normalizedPath = normalizePath(sourceFilePath);
  if (!normalizedPath) {
    return '';
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  const markerIndex = segments.findIndex((segment) => isKnownBundleSegment(segment));
  if (markerIndex > 0) {
    return normalizeDirectory(segments.slice(0, markerIndex).join('/'));
  }

  if (markerIndex === 0) {
    return '';
  }

  return normalizeDirectory(segments.slice(0, -1).join('/'));
}

function isTopLevelKnownBundleSource(path: string): boolean {
  const segments = normalizePath(path).split('/').filter(Boolean);
  return segments.length > 1 && isKnownBundleSegment(segments[0] || '');
}

function collectTopLevelKnownAssetDirectories(assets: Record<string, string>): Set<string> {
  const directories = new Set<string>();

  Object.keys(assets).forEach((assetPath) => {
    const [topLevelSegment] = normalizePath(assetPath).split('/');
    if (!topLevelSegment || !isKnownBundleSegment(topLevelSegment)) {
      return;
    }

    directories.add(normalizeDirectory(topLevelSegment));
  });

  return directories;
}

function collectReferencedMeshPaths(robotLinks?: Record<string, UrdfLink>): Set<string> {
  const referencedPaths = new Set<string>();

  if (!robotLinks) {
    return referencedPaths;
  }

  Object.values(robotLinks).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referencedPaths.add(entry.geometry.meshPath);
      }
    });

    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referencedPaths.add(link.collision.meshPath);
    }

    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referencedPaths.add(body.meshPath);
      }
    });
  });

  return referencedPaths;
}

function collectReferencedTexturePaths(
  robotLinks?: Record<string, UrdfLink>,
  robotMaterials?: Record<string, RobotMaterialState>,
): Set<string> {
  const referencedPaths = new Set<string>();

  if (robotLinks) {
    Object.values(robotLinks).forEach((link) => {
      getVisualGeometryEntries(link).forEach((entry) => {
        collectGeometryTexturePaths(entry.geometry).forEach((texturePath) => {
          referencedPaths.add(texturePath);
        });
      });
    });
  }

  Object.values(robotMaterials || {}).forEach((material) => {
    const texturePath = String(material.texture || '').trim();
    if (texturePath) {
      referencedPaths.add(texturePath);
    }
  });

  return referencedPaths;
}

type MjcfAssetFileRef = {
  tag: 'mesh' | 'texture' | 'hfield';
  file: string;
};

type MjcfCompilerAssetDirectories = {
  assetdir: string;
  meshdir: string;
  texturedir: string;
};

const MJCF_COMPILER_TAG_PATTERN = /<compiler\b[^>]*>/gi;
const MJCF_INCLUDE_TAG_PATTERN = /<include\b[^>]*\bfile\s*=\s*(['"])(.*?)\1/gi;
const MJCF_MESH_FILE_TAG_PATTERN = /<mesh\b[^>]*\bfile\s*=\s*(['"])(.*?)\1/gi;
const MJCF_TEXTURE_FILE_TAG_PATTERN = /<texture\b[^>]*\bfile\s*=\s*(['"])(.*?)\1/gi;
const MJCF_HFIELD_FILE_TAG_PATTERN = /<hfield\b[^>]*\bfile\s*=\s*(['"])(.*?)\1/gi;

function extractTagAttributeValue(tagSource: string, attributeName: string): string | null {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  const match = pattern.exec(tagSource);
  const value = match?.[2]?.trim();
  return value != null ? value : null;
}

function extractMjcfCompilerAssetDirectories(content: string): MjcfCompilerAssetDirectories {
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;

  let match: RegExpExecArray | null;
  while ((match = MJCF_COMPILER_TAG_PATTERN.exec(content))) {
    const compilerTag = match[0];
    const nextAssetdir = extractTagAttributeValue(compilerTag, 'assetdir');
    if (nextAssetdir !== null) {
      assetdir = nextAssetdir;
    }

    const nextMeshdir = extractTagAttributeValue(compilerTag, 'meshdir');
    if (nextMeshdir !== null) {
      meshdir = nextMeshdir;
    }

    const nextTexturedir = extractTagAttributeValue(compilerTag, 'texturedir');
    if (nextTexturedir !== null) {
      texturedir = nextTexturedir;
    }
  }

  return {
    assetdir,
    meshdir: meshdir ?? assetdir,
    texturedir: texturedir ?? assetdir,
  };
}

function extractMjcfIncludePaths(content: string): string[] {
  const includePaths: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = MJCF_INCLUDE_TAG_PATTERN.exec(content))) {
    const includePath = match[2]?.trim();
    if (includePath) {
      includePaths.push(includePath);
    }
  }

  return includePaths;
}

function extractMjcfAssetFileRefs(content: string): MjcfAssetFileRef[] {
  const refs: MjcfAssetFileRef[] = [];
  const patterns: Array<{ tag: MjcfAssetFileRef['tag']; pattern: RegExp }> = [
    { tag: 'mesh', pattern: MJCF_MESH_FILE_TAG_PATTERN },
    { tag: 'texture', pattern: MJCF_TEXTURE_FILE_TAG_PATTERN },
    { tag: 'hfield', pattern: MJCF_HFIELD_FILE_TAG_PATTERN },
  ];

  patterns.forEach(({ tag, pattern }) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const file = match[2]?.trim();
      if (file) {
        refs.push({ tag, file });
      }
    }
  });

  return refs;
}

function applyMjcfAssetDirectory(
  ref: MjcfAssetFileRef,
  compilerDirs: MjcfCompilerAssetDirectories,
): string {
  const trimmedFile = ref.file.trim();
  if (!trimmedFile) {
    return '';
  }

  const compilerDirectory =
    ref.tag === 'mesh'
      ? compilerDirs.meshdir
      : ref.tag === 'texture'
        ? compilerDirs.texturedir
        : compilerDirs.assetdir;

  if (!compilerDirectory || trimmedFile.startsWith('/') || trimmedFile.includes(':')) {
    return trimmedFile;
  }

  const normalizedDirectory = compilerDirectory.endsWith('/')
    ? compilerDirectory
    : `${compilerDirectory}/`;

  return `${normalizedDirectory}${trimmedFile}`;
}

function collectMjcfReferencedScope(options: {
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  sourceFile: Pick<RobotFile, 'name' | 'format' | 'content'>;
}): {
  directAssetKeys: Set<string>;
  relevantDirectories: Set<string>;
} {
  const { assets, availableFiles, sourceFile } = options;
  const directAssetKeys = new Set<string>();
  const relevantDirectories = new Set<string>();
  const fileIndex = new Map<string, RobotFile>();
  const assetKeysByUrl = buildAssetKeysByUrl(assets);
  const pendingFiles: RobotFile[] = [];
  const visitedFiles = new Set<string>();

  availableFiles.forEach((file) => {
    const normalizedName = normalizePath(file.name);
    if (normalizedName) {
      fileIndex.set(normalizedName, file);
    }
  });

  const normalizedSourceName = normalizePath(sourceFile.name);
  if (normalizedSourceName && !fileIndex.has(normalizedSourceName)) {
    fileIndex.set(normalizedSourceName, sourceFile as RobotFile);
  }

  pendingFiles.push(sourceFile as RobotFile);

  while (pendingFiles.length > 0) {
    const currentFile = pendingFiles.pop();
    if (!currentFile) {
      continue;
    }

    const currentFilePath = normalizePath(currentFile.name);
    if (!currentFilePath || visitedFiles.has(currentFilePath)) {
      continue;
    }

    visitedFiles.add(currentFilePath);
    const currentFileDirectory = getParentDirectory(currentFilePath);
    if (currentFileDirectory) {
      relevantDirectories.add(currentFileDirectory);
    }

    const currentContent = currentFile.content || '';
    if (!currentContent) {
      continue;
    }

    const compilerDirs = extractMjcfCompilerAssetDirectories(currentContent);
    const currentAssetIndex = buildAssetIndex(assets, currentFileDirectory);

    extractMjcfAssetFileRefs(currentContent).forEach((ref) => {
      const compilerScopedPath = applyMjcfAssetDirectory(ref, compilerDirs);
      const resolvedAssetPath = resolveMjcfScopedPath(
        compilerScopedPath || ref.file,
        currentFilePath,
      );
      if (!resolvedAssetPath) {
        return;
      }

      collectMatchingAssetKeys(resolvedAssetPath, assets, currentFilePath).forEach((assetKey) => {
        directAssetKeys.add(assetKey);
        const assetDirectory = getParentDirectory(assetKey);
        if (assetDirectory) {
          relevantDirectories.add(assetDirectory);
        }
      });

      const resolvedAssetUrl = findAssetByIndex(
        resolvedAssetPath,
        currentAssetIndex,
        currentFileDirectory,
      );
      if (resolvedAssetUrl) {
        (assetKeysByUrl.get(resolvedAssetUrl) || []).forEach((assetKey) => {
          directAssetKeys.add(assetKey);
          const assetDirectory = getParentDirectory(assetKey);
          if (assetDirectory) {
            relevantDirectories.add(assetDirectory);
          }
        });
      }
    });

    extractMjcfIncludePaths(currentContent).forEach((includePath) => {
      const resolvedIncludePath = resolveMjcfScopedPath(includePath, currentFilePath);
      if (!resolvedIncludePath) {
        return;
      }

      const includedFile = fileIndex.get(resolvedIncludePath);
      if (includedFile) {
        pendingFiles.push(includedFile);
      }
    });
  }

  return { directAssetKeys, relevantDirectories };
}

export function buildViewerRobotLinksScopeSignature(
  robotLinks?: Record<string, UrdfLink>,
  robotMaterials?: Record<string, RobotMaterialState>,
): string {
  const meshSignature = Array.from(collectReferencedMeshPaths(robotLinks))
    .sort((left, right) => left.localeCompare(right))
    .join('\n');
  const textureSignature = Array.from(collectReferencedTexturePaths(robotLinks, robotMaterials))
    .sort((left, right) => left.localeCompare(right))
    .join('\n');

  return `${meshSignature}\n---\n${textureSignature}`;
}

function collectMatchingAssetKeys(
  meshPath: string,
  assets: Record<string, string>,
  sourceFilePath?: string | null,
): Set<string> {
  const matches = new Set<string>();
  const candidatePool = new Set<string>();
  const normalizedMeshPath = normalizePath(meshPath);
  if (normalizedMeshPath) {
    candidatePool.add(normalizedMeshPath);
  }

  const resolvedPath = resolveImportedAssetPath(meshPath, sourceFilePath);
  if (resolvedPath) {
    candidatePool.add(normalizePath(resolvedPath));
  }

  const normalizedCandidates = Array.from(candidatePool)
    .map((candidate) => normalizePath(candidate).toLowerCase())
    .filter(Boolean);

  Object.keys(assets).forEach((assetPath) => {
    const normalizedAssetPath = normalizePath(assetPath);
    if (!normalizedAssetPath) {
      return;
    }

    const assetPathLower = normalizedAssetPath.toLowerCase();
    const matched = normalizedCandidates.includes(assetPathLower);

    if (matched) {
      matches.add(normalizedAssetPath);
    }
  });

  return matches;
}

function buildAssetKeysByUrl(assets: Record<string, string>): Map<string, string[]> {
  const keysByUrl = new Map<string, string[]>();

  Object.entries(assets).forEach(([assetPath, assetUrl]) => {
    const normalizedAssetPath = normalizePath(assetPath);
    if (!normalizedAssetPath) {
      return;
    }

    const existing = keysByUrl.get(assetUrl);
    if (existing) {
      existing.push(normalizedAssetPath);
      return;
    }

    keysByUrl.set(assetUrl, [normalizedAssetPath]);
  });

  return keysByUrl;
}

function buildScopedAssets(options: {
  assets: Record<string, string>;
  allFileContents?: Record<string, string>;
  availableFiles: RobotFile[];
  sourceFile?: Pick<RobotFile, 'name' | 'format' | 'content'> | null;
  sourceFilePath?: string | null;
  robotLinks?: Record<string, UrdfLink>;
  robotMaterials?: Record<string, RobotMaterialState>;
}): Record<string, string> {
  const {
    assets,
    allFileContents = {},
    availableFiles,
    sourceFile,
    sourceFilePath,
    robotLinks,
    robotMaterials,
  } = options;
  const normalizedSourcePath = normalizePath(sourceFilePath || sourceFile?.name);
  const isUsdSource = sourceFile?.format === 'usd';
  const bundleDirectory = isUsdSource
    ? normalizeDirectory(inferUsdBundleVirtualDirectory(sourceFile?.name || '').replace(/^\/+/, ''))
    : inferGenericBundleDirectory(normalizedSourcePath);
  const shouldIncludeTopLevelKnownAssetDirectories =
    !isUsdSource && isTopLevelKnownBundleSource(normalizedSourcePath);

  const relevantDirectories = new Set<string>();
  if (bundleDirectory) {
    relevantDirectories.add(bundleDirectory);
  }
  if (shouldIncludeTopLevelKnownAssetDirectories) {
    collectTopLevelKnownAssetDirectories(assets).forEach((directory) => {
      relevantDirectories.add(directory);
    });
  }

  const directAssetKeys = new Set<string>();
  const referencedMeshPaths = collectReferencedMeshPaths(robotLinks);
  const referencedTexturePaths = collectReferencedTexturePaths(robotLinks, robotMaterials);
  const sourceDirectory = getParentDirectory(normalizedSourcePath);
  const assetIndex = buildAssetIndex(assets, sourceDirectory);
  const assetKeysByUrl = buildAssetKeysByUrl(assets);

  if (sourceFile?.format === 'mesh' && normalizedSourcePath) {
    referencedMeshPaths.add(normalizedSourcePath);
  }

  if (sourceFile?.format === 'mjcf') {
    const mjcfScope = collectMjcfReferencedScope({
      assets,
      availableFiles,
      sourceFile,
    });

    mjcfScope.directAssetKeys.forEach((assetKey) => {
      directAssetKeys.add(assetKey);
    });

    mjcfScope.relevantDirectories.forEach((directory) => {
      relevantDirectories.add(directory);
    });
  }

  referencedMeshPaths.forEach((meshPath) => {
    collectMatchingAssetKeys(meshPath, assets, normalizedSourcePath).forEach((assetKey) => {
      directAssetKeys.add(assetKey);
      const assetDirectory = getParentDirectory(assetKey);
      if (assetDirectory) {
        relevantDirectories.add(assetDirectory);
      }
    });

    const resolvedAssetUrl = findAssetByIndex(meshPath, assetIndex, sourceDirectory);
    if (resolvedAssetUrl) {
      (assetKeysByUrl.get(resolvedAssetUrl) || []).forEach((assetKey) => {
        directAssetKeys.add(assetKey);
        const assetDirectory = getParentDirectory(assetKey);
        if (assetDirectory) {
          relevantDirectories.add(assetDirectory);
        }
      });
    }

    const resolvedMeshPath = resolveImportedAssetPath(meshPath, normalizedSourcePath);
    const meshDirectory = getParentDirectory(resolvedMeshPath || meshPath);
    if (meshDirectory) {
      relevantDirectories.add(meshDirectory);
    }
  });

  referencedTexturePaths.forEach((texturePath) => {
    collectMatchingAssetKeys(texturePath, assets, normalizedSourcePath).forEach((assetKey) => {
      directAssetKeys.add(assetKey);
      const assetDirectory = getParentDirectory(assetKey);
      if (assetDirectory) {
        relevantDirectories.add(assetDirectory);
      }
    });

    const resolvedAssetUrl = findAssetByIndex(texturePath, assetIndex, sourceDirectory);
    if (resolvedAssetUrl) {
      (assetKeysByUrl.get(resolvedAssetUrl) || []).forEach((assetKey) => {
        directAssetKeys.add(assetKey);
        const assetDirectory = getParentDirectory(assetKey);
        if (assetDirectory) {
          relevantDirectories.add(assetDirectory);
        }
      });
    }
  });

  const scopedEntries = Object.entries(assets).filter(([assetPath]) => {
    const normalizedAssetPath = normalizePath(assetPath);
    if (!normalizedAssetPath) {
      return false;
    }

    if (directAssetKeys.has(normalizedAssetPath)) {
      return true;
    }

    for (const directory of relevantDirectories) {
      if (isPathInsideDirectory(normalizedAssetPath, directory)) {
        return true;
      }
    }

    return false;
  });

  const scopedTextAssetContents = Object.fromEntries(
    Object.entries(allFileContents).flatMap(([assetPath, content]) => {
      if (typeof content !== 'string' || content.length === 0) {
        return [];
      }

      const normalizedAssetPath = normalizePath(assetPath);
      if (!normalizedAssetPath) {
        return [];
      }

      if (directAssetKeys.has(normalizedAssetPath)) {
        return [[normalizedAssetPath, content] as const];
      }

      for (const directory of relevantDirectories) {
        if (isPathInsideDirectory(normalizedAssetPath, directory)) {
          return [[normalizedAssetPath, content] as const];
        }
      }

      return [];
    }),
  );

  return mergeTextMeshSidecarAssets(Object.fromEntries(scopedEntries), scopedTextAssetContents);
}

function buildScopedAvailableFiles(options: {
  availableFiles: RobotFile[];
  sourceFile?: Pick<RobotFile, 'name' | 'format' | 'content' | 'blobUrl'> | null;
}): RobotFile[] {
  const { availableFiles, sourceFile } = options;
  if (sourceFile?.format !== 'usd') {
    return [];
  }

  const bundleDirectory = inferUsdBundleVirtualDirectory(sourceFile.name);
  const scopedFiles = availableFiles.filter(
    (file) =>
      !isAssetLibraryOnlyFormat(file.format) &&
      isUsdPathWithinBundleDirectory(file.name, bundleDirectory),
  );

  if (!scopedFiles.some((file) => file.name === sourceFile.name)) {
    scopedFiles.unshift(sourceFile as RobotFile);
  }

  return scopedFiles;
}

function buildAssetsSignature(assets: Record<string, string>): string {
  return Object.entries(assets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, url]) => `${path}\u0000${url}`)
    .join('\n');
}

function buildAvailableFilesSignature(files: RobotFile[]): string {
  return files
    .map(
      (file) => `${file.name}\u0000${file.format}\u0000${file.blobUrl || ''}\u0000${file.content}`,
    )
    .join('\n');
}

export interface ViewerResourceScope {
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  signature: string;
}

export function createStableViewerResourceScope(
  previous: ViewerResourceScope | null,
  options: {
    assets: Record<string, string>;
    allFileContents?: Record<string, string>;
    availableFiles: RobotFile[];
    sourceFile?: Pick<RobotFile, 'name' | 'format' | 'content' | 'blobUrl'> | null;
    sourceFilePath?: string | null;
    robotLinks?: Record<string, UrdfLink>;
    robotMaterials?: Record<string, RobotMaterialState>;
  },
): ViewerResourceScope {
  const scopedAssets = buildScopedAssets(options);
  const scopedAvailableFiles = buildScopedAvailableFiles(options);
  const signature = [
    buildAssetsSignature(scopedAssets),
    buildAvailableFilesSignature(scopedAvailableFiles),
  ].join('\n---\n');

  if (previous && previous.signature === signature) {
    return previous;
  }

  return {
    assets: scopedAssets,
    availableFiles: scopedAvailableFiles,
    signature,
  };
}
