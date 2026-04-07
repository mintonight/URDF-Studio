import { buildAssetIndex } from '@/core/loaders/meshLoader';
import type { RobotFile } from '@/types';
import { parseCompilerSettings, parseMJCFXmlDocument } from './mjcfUtils';

export type MJCFImportExternalAssetKind = 'mesh' | 'texture' | 'hfield' | 'model';

export interface MJCFImportExternalAssetIssue {
  kind: 'missing_external_asset';
  referenceKind: MJCFImportExternalAssetKind;
  attributeName: string;
  rawPath: string;
  resolvedPath: string;
  sourceFilePath: string;
  elementName: string | null;
  detail: string;
}

const TEXTURE_FILE_ATTRIBUTES = [
  'file',
  'fileback',
  'filedown',
  'filefront',
  'fileleft',
  'fileright',
  'fileup',
] as const;

function normalizeLookupPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) {
    return '';
  }

  const isAbsolute = normalized.startsWith('/');
  const segments = normalized.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
        continue;
      }

      if (!isAbsolute) {
        resolved.push(segment);
      }
      continue;
    }

    resolved.push(segment);
  }

  if (resolved.length === 0) {
    return isAbsolute ? '/' : '';
  }

  return `${isAbsolute ? '/' : ''}${resolved.join('/')}`;
}

function getDirectoryPath(filePath: string): string {
  const normalized = normalizeLookupPath(filePath);
  if (!normalized) {
    return '';
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return normalized.startsWith('/') ? '/' : '';
  }

  return normalized.slice(0, lastSlash);
}

function joinLookupPath(basePath: string, relativePath: string): string {
  if (!basePath) {
    return normalizeLookupPath(relativePath);
  }

  if (!relativePath) {
    return normalizeLookupPath(basePath);
  }

  return normalizeLookupPath(`${basePath}/${relativePath}`);
}

function applyAssetDirectory(filePath: string, directory: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes(':')) {
    return normalizeLookupPath(trimmed);
  }

  const normalizedDirectory = normalizeLookupPath(directory);
  if (!normalizedDirectory) {
    return normalizeLookupPath(trimmed);
  }

  const normalizedTrimmed = normalizeLookupPath(trimmed);
  if (
    normalizedTrimmed === normalizedDirectory ||
    normalizedTrimmed.startsWith(`${normalizedDirectory}/`)
  ) {
    return normalizedTrimmed;
  }

  return normalizeLookupPath(`${normalizedDirectory}/${trimmed}`);
}

function resolveAssetReferencePath(
  sourceFilePath: string,
  rawPath: string,
  compilerDirectory: string,
): string {
  const compilerScopedPath = applyAssetDirectory(rawPath, compilerDirectory);
  if (
    !compilerScopedPath ||
    compilerScopedPath.startsWith('/') ||
    compilerScopedPath.includes(':')
  ) {
    return compilerScopedPath;
  }

  return joinLookupPath(getDirectoryPath(sourceFilePath), compilerScopedPath);
}

function buildKnownAssetLookup(
  availableFiles: RobotFile[],
  assets: Record<string, string>,
): Record<string, string> {
  const knownAssets: Record<string, string> = {};

  availableFiles.forEach((file) => {
    const normalized = normalizeLookupPath(file.name);
    if (normalized) {
      knownAssets[normalized] = normalized;
    }
  });

  Object.keys(assets).forEach((assetPath) => {
    const normalized = normalizeLookupPath(assetPath);
    if (normalized) {
      knownAssets[normalized] = normalized;
    }
  });

  return knownAssets;
}

function buildAdjacentDuplicateCollapsedVariants(assetPath: string): string[] {
  const normalizedPath = normalizeLookupPath(assetPath);
  if (!normalizedPath) {
    return [];
  }

  const hasLeadingSlash = normalizedPath.startsWith('/');
  const segments = normalizedPath.split('/').filter(Boolean);
  const variants: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index] !== segments[index - 1]) {
      continue;
    }

    const nextSegments = [...segments];
    nextSegments.splice(index, 1);
    const variant = `${hasLeadingSlash ? '/' : ''}${nextSegments.join('/')}`;
    if (variant && variant !== normalizedPath && !variants.includes(variant)) {
      variants.push(variant);
    }
  }

  return variants;
}

function hasExactAssetPathMatch(
  assetIndex: ReturnType<typeof buildAssetIndex>,
  assetPath: string,
): boolean {
  return assetIndex.direct.has(assetPath) || assetIndex.lowercase.has(assetPath.toLowerCase());
}

function hasValidatedAssetMatch(
  assetIndex: ReturnType<typeof buildAssetIndex>,
  assetPath: string,
): boolean {
  const normalizedPath = normalizeLookupPath(assetPath);
  if (!normalizedPath) {
    return false;
  }

  const candidatePaths = [
    normalizedPath,
    normalizedPath.replace(/^\/+/, ''),
    ...buildAdjacentDuplicateCollapsedVariants(normalizedPath),
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

  return candidatePaths.some(
    (candidatePath) =>
      hasExactAssetPathMatch(assetIndex, candidatePath) ||
      (candidatePath.startsWith('/') &&
        hasExactAssetPathMatch(assetIndex, candidatePath.replace(/^\/+/, ''))),
  );
}

function collectDirectChildElements(parent: Element, tagName: string): Element[] {
  const normalizedTagName = tagName.toLowerCase();
  return Array.from(parent.children).filter(
    (child) => child.tagName.toLowerCase() === normalizedTagName,
  );
}

function collectMissingAssetIssue(
  issues: MJCFImportExternalAssetIssue[],
  assetIndex: ReturnType<typeof buildAssetIndex>,
  options: {
    sourceFilePath: string;
    referenceKind: MJCFImportExternalAssetKind;
    attributeName: string;
    rawPath: string | null;
    compilerDirectory: string;
    elementName: string | null;
  },
): void {
  const rawPath = options.rawPath?.trim();
  if (!rawPath) {
    return;
  }

  const resolvedPath = resolveAssetReferencePath(
    options.sourceFilePath,
    rawPath,
    options.compilerDirectory,
  );
  if (!resolvedPath) {
    return;
  }

  if (hasValidatedAssetMatch(assetIndex, resolvedPath)) {
    return;
  }

  const label = options.elementName
    ? `${options.referenceKind} "${options.elementName}"`
    : `${options.referenceKind} asset`;
  issues.push({
    kind: 'missing_external_asset',
    referenceKind: options.referenceKind,
    attributeName: options.attributeName,
    rawPath,
    resolvedPath,
    sourceFilePath: options.sourceFilePath,
    elementName: options.elementName,
    detail: `Referenced MJCF ${label} file "${resolvedPath}" could not be resolved from "${options.sourceFilePath}".`,
  });
}

export function validateMJCFImportExternalAssets(
  sourceFilePath: string,
  content: string,
  availableFiles: RobotFile[],
  assets: Record<string, string>,
): MJCFImportExternalAssetIssue[] {
  const { doc } = parseMJCFXmlDocument(content);
  if (!doc) {
    return [];
  }

  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return [];
  }

  const settings = parseCompilerSettings(doc);
  const assetIndex = buildAssetIndex(buildKnownAssetLookup(availableFiles, assets));
  const issues: MJCFImportExternalAssetIssue[] = [];
  const assetSections = collectDirectChildElements(mujocoEl, 'asset');

  assetSections.forEach((assetEl) => {
    collectDirectChildElements(assetEl, 'mesh').forEach((meshEl) => {
      collectMissingAssetIssue(issues, assetIndex, {
        sourceFilePath,
        referenceKind: 'mesh',
        attributeName: 'file',
        rawPath: meshEl.getAttribute('file'),
        compilerDirectory: settings.meshdir,
        elementName: meshEl.getAttribute('name'),
      });
    });

    collectDirectChildElements(assetEl, 'texture').forEach((textureEl) => {
      TEXTURE_FILE_ATTRIBUTES.forEach((attributeName) => {
        collectMissingAssetIssue(issues, assetIndex, {
          sourceFilePath,
          referenceKind: 'texture',
          attributeName,
          rawPath: textureEl.getAttribute(attributeName),
          compilerDirectory: settings.texturedir,
          elementName: textureEl.getAttribute('name'),
        });
      });
    });

    collectDirectChildElements(assetEl, 'hfield').forEach((hfieldEl) => {
      collectMissingAssetIssue(issues, assetIndex, {
        sourceFilePath,
        referenceKind: 'hfield',
        attributeName: 'file',
        rawPath: hfieldEl.getAttribute('file'),
        compilerDirectory: settings.assetdir,
        elementName: hfieldEl.getAttribute('name'),
      });
    });

    collectDirectChildElements(assetEl, 'model').forEach((modelEl) => {
      collectMissingAssetIssue(issues, assetIndex, {
        sourceFilePath,
        referenceKind: 'model',
        attributeName: 'file',
        rawPath: modelEl.getAttribute('file'),
        compilerDirectory: settings.assetdir,
        elementName: modelEl.getAttribute('name'),
      });
    });
  });

  return issues;
}
