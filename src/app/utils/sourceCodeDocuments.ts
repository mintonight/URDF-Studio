import type { RobotFile } from '@/types';
import type { SourceCodeDocumentFlavor } from './sourceCodeDisplay';
import { detectImportFormat } from './import-preparation/formatDetection.ts';
import { isSourceCodeDocumentReadOnly } from './sourceCodeDisplay.ts';

type SourceFileFormat = RobotFile['format'] | null;

interface SourceTextFileEntry {
  path: string;
  content: string;
  format: SourceFileFormat;
}

export interface SourceCodeDocumentChangeTarget {
  name: string;
  format: SourceFileFormat;
  content?: string;
  persistContent?: boolean;
}

export interface SourceCodeDocumentDescriptor {
  id: string;
  fileName: string;
  tabLabel?: string;
  filePath: string | null;
  content: string;
  documentFlavor: SourceCodeDocumentFlavor;
  readOnly: boolean;
  validationEnabled?: boolean;
  changeTarget?: SourceCodeDocumentChangeTarget;
}

interface BuildSourceCodeDocumentsParams {
  activeSourceFile: RobotFile | null;
  sourceCodeContent: string;
  sourceCodeDocumentFlavor: SourceCodeDocumentFlavor;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  forceReadOnly?: boolean;
}

const XACRO_INCLUDE_REGEX =
  /<xacro:include\s+filename=["']([^"']+)["']\s*(?:\/>|>\s*<\/xacro:include>)/g;
const MJCF_INCLUDE_REGEX = /<include\s+file=["']([^"']+)["'][^>]*\/?>/g;
const SOURCE_ROOT_PATTERNS: Partial<Record<SourceCodeDocumentFlavor, RegExp>> = {
  urdf: /<robot\b/i,
  xacro: /<robot\b/i,
  sdf: /<sdf\b/i,
  mjcf: /<mujoco\b/i,
  'equivalent-mjcf': /<mujoco\b/i,
  usd: /#usda\b/i,
};

function normalizeSourcePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function getSourceBasePath(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex);
}

function getSourceFileName(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

function buildSourceFileIndex(
  availableFiles: RobotFile[],
  allFileContents: Record<string, string>,
): Map<string, SourceTextFileEntry> {
  const index = new Map<string, SourceTextFileEntry>();

  availableFiles.forEach((file) => {
    if (file.format === 'mesh' || file.format === 'asset') {
      return;
    }

    const normalizedPath = normalizeSourcePath(file.name);
    index.set(normalizedPath, {
      path: file.name,
      content: file.content,
      format: file.format,
    });
  });

  Object.entries(allFileContents).forEach(([path, content]) => {
    if (typeof content !== 'string') {
      return;
    }

    const normalizedPath = normalizeSourcePath(path);
    const existingEntry = index.get(normalizedPath);
    index.set(normalizedPath, {
      path,
      content,
      format: existingEntry?.format ?? detectImportFormat(content, path),
    });
  });

  return index;
}

function extractIncludeReferences(format: SourceFileFormat, content: string): string[] {
  if (format === 'xacro') {
    return Array.from(content.matchAll(XACRO_INCLUDE_REGEX), (match) => match[1]?.trim()).filter(
      (value): value is string => Boolean(value),
    );
  }

  if (format === 'mjcf') {
    return Array.from(content.matchAll(MJCF_INCLUDE_REGEX), (match) => match[1]?.trim()).filter(
      (value): value is string => Boolean(value),
    );
  }

  return [];
}

function resolveXacroReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  const normalizedKeys = Array.from(fileIndex.keys());
  const packageReferenceMatch = trimmedReference.match(/^\$\(find\s+([^)]+)\)(?:\/(.*))?$/);
  if (packageReferenceMatch) {
    const packageName = packageReferenceMatch[1]?.trim();
    const relativePath = normalizeSourcePath(packageReferenceMatch[2] ?? '');
    const searchPattern = normalizeSourcePath(
      relativePath ? `${packageName}/${relativePath}` : packageName,
    );

    return (
      normalizedKeys.find(
        (candidate) => candidate === searchPattern || candidate.endsWith(`/${searchPattern}`),
      ) ?? null
    );
  }

  const normalizedReference = normalizeSourcePath(trimmedReference);
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  const fuzzyMatch = normalizedKeys.find(
    (candidate) =>
      candidate === normalizedReference || candidate.endsWith(`/${normalizedReference}`),
  );
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  const fileName = getSourceFileName(normalizedReference);
  if (!fileName || !fileName.includes('.')) {
    return null;
  }

  return (
    normalizedKeys.find(
      (candidate) => candidate === fileName || candidate.endsWith(`/${fileName}`),
    ) ?? null
  );
}

function resolveMjcfReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const normalizedReference = normalizeSourcePath(reference.trim());
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  return null;
}

function resolveIncludedFilePath(
  parentFormat: SourceFileFormat,
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  if (parentFormat === 'xacro') {
    return resolveXacroReference(reference, fileIndex, basePath);
  }

  if (parentFormat === 'mjcf') {
    return resolveMjcfReference(reference, fileIndex, basePath);
  }

  return null;
}

function resolveRelatedDocumentFlavor(
  entry: SourceTextFileEntry,
  fallbackFormat: SourceFileFormat,
): SourceCodeDocumentFlavor {
  if (entry.format === 'urdf') {
    return 'urdf';
  }
  if (entry.format === 'xacro') {
    return 'xacro';
  }
  if (entry.format === 'sdf') {
    return 'sdf';
  }
  if (entry.format === 'usd') {
    return 'usd';
  }
  if (entry.format === 'mjcf') {
    return 'mjcf';
  }

  return fallbackFormat === 'mjcf' ? 'mjcf' : 'xacro';
}

function resolveGeneratedDocumentFormat(
  documentFlavor: SourceCodeDocumentFlavor,
): SourceFileFormat {
  switch (documentFlavor) {
    case 'urdf':
      return 'urdf';
    case 'xacro':
      return 'xacro';
    case 'sdf':
      return 'sdf';
    case 'mjcf':
      return 'mjcf';
    default:
      return null;
  }
}

function shouldEnableValidationForDocument(
  documentFlavor: SourceCodeDocumentFlavor,
  content: string,
  isPrimaryDocument: boolean,
): boolean | undefined {
  if (isPrimaryDocument) {
    return undefined;
  }

  const rootPattern = SOURCE_ROOT_PATTERNS[documentFlavor];
  if (!rootPattern) {
    return false;
  }

  return rootPattern.test(content);
}

function buildDisplayNames(filePaths: string[]): Map<string, string> {
  const segmentsByPath = new Map(
    filePaths.map((filePath) => [
      filePath,
      normalizeSourcePath(filePath).split('/').filter(Boolean),
    ]),
  );
  const baseNameCounts = new Map<string, number>();

  filePaths.forEach((filePath) => {
    const baseName = getSourceFileName(filePath);
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) ?? 0) + 1);
  });

  const displayNames = new Map<string, string>();

  filePaths.forEach((filePath) => {
    const baseName = getSourceFileName(filePath);
    if ((baseNameCounts.get(baseName) ?? 0) <= 1) {
      displayNames.set(filePath, baseName);
      return;
    }

    const currentSegments = segmentsByPath.get(filePath) ?? [baseName];
    let nextLabel = baseName;
    for (let segmentCount = 2; segmentCount <= currentSegments.length; segmentCount += 1) {
      const candidate = currentSegments.slice(-segmentCount).join('/');
      const collision = filePaths.some((otherFilePath) => {
        if (otherFilePath === filePath) {
          return false;
        }
        const otherSegments = segmentsByPath.get(otherFilePath) ?? [
          getSourceFileName(otherFilePath),
        ];
        return otherSegments.slice(-segmentCount).join('/') === candidate;
      });
      if (!collision) {
        nextLabel = candidate;
        break;
      }
    }

    displayNames.set(filePath, nextLabel);
  });

  return displayNames;
}

function collectRelatedSourceEntries(
  rootFile: RobotFile,
  rootContent: string,
  fileIndex: Map<string, SourceTextFileEntry>,
): SourceTextFileEntry[] {
  const visitedPaths = new Set<string>([normalizeSourcePath(rootFile.name)]);
  const relatedEntries: SourceTextFileEntry[] = [];

  const visitEntry = (entryPath: string, entryContent: string, entryFormat: SourceFileFormat) => {
    const includeReferences = extractIncludeReferences(entryFormat, entryContent);
    if (includeReferences.length === 0) {
      return;
    }

    const basePath = getSourceBasePath(entryPath);
    includeReferences.forEach((reference) => {
      const resolvedPath = resolveIncludedFilePath(entryFormat, reference, fileIndex, basePath);
      if (!resolvedPath || visitedPaths.has(resolvedPath)) {
        return;
      }

      const relatedEntry = fileIndex.get(resolvedPath);
      if (!relatedEntry) {
        return;
      }

      visitedPaths.add(resolvedPath);
      relatedEntries.push(relatedEntry);
      visitEntry(relatedEntry.path, relatedEntry.content, relatedEntry.format ?? entryFormat);
    });
  };

  visitEntry(rootFile.name, rootContent, rootFile.format);
  return relatedEntries;
}

export function buildSourceCodeDocuments({
  activeSourceFile,
  sourceCodeContent,
  sourceCodeDocumentFlavor,
  availableFiles,
  allFileContents,
  forceReadOnly = false,
}: BuildSourceCodeDocumentsParams): SourceCodeDocumentDescriptor[] {
  if (!activeSourceFile) {
    const generatedDocumentFormat = resolveGeneratedDocumentFormat(sourceCodeDocumentFlavor);
    const isReadOnly = forceReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor);
    return [
      {
        id: 'source:robot',
        fileName: 'robot.urdf',
        tabLabel: 'robot.urdf',
        filePath: null,
        content: sourceCodeContent,
        documentFlavor: sourceCodeDocumentFlavor,
        readOnly: isReadOnly,
        changeTarget:
          !isReadOnly && generatedDocumentFormat
            ? {
                name: 'robot.urdf',
                format: generatedDocumentFormat,
                content: sourceCodeContent,
                persistContent: false,
              }
            : undefined,
      },
    ];
  }

  const primaryDocumentPath = activeSourceFile.name;
  const primaryDocuments: SourceCodeDocumentDescriptor[] = [
    {
      id: `source:${primaryDocumentPath}`,
      fileName: getSourceFileName(primaryDocumentPath),
      tabLabel: getSourceFileName(primaryDocumentPath),
      filePath: primaryDocumentPath,
      content: sourceCodeContent,
      documentFlavor: sourceCodeDocumentFlavor,
      readOnly: forceReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor),
      changeTarget: {
        name: activeSourceFile.name,
        format: activeSourceFile.format,
      },
    },
  ];

  const canCollectRelatedSources =
    (activeSourceFile.format === 'xacro' || activeSourceFile.format === 'mjcf') &&
    (activeSourceFile.format !== 'mjcf' || sourceCodeContent === activeSourceFile.content);

  if (!canCollectRelatedSources) {
    return primaryDocuments;
  }

  const sourceFileIndex = buildSourceFileIndex(availableFiles, allFileContents);
  const relatedEntries = collectRelatedSourceEntries(
    activeSourceFile,
    activeSourceFile.content,
    sourceFileIndex,
  );

  if (relatedEntries.length === 0) {
    return primaryDocuments;
  }

  const displayNames = buildDisplayNames([
    primaryDocumentPath,
    ...relatedEntries.map((entry) => entry.path),
  ]);

  primaryDocuments[0] = {
    ...primaryDocuments[0],
    tabLabel: displayNames.get(primaryDocumentPath) ?? primaryDocuments[0].fileName,
  };

  const relatedDocuments = relatedEntries.map<SourceCodeDocumentDescriptor>((entry) => {
    const documentFlavor = resolveRelatedDocumentFlavor(entry, activeSourceFile.format);
    return {
      id: `source:${entry.path}`,
      fileName: getSourceFileName(entry.path),
      tabLabel: displayNames.get(entry.path) ?? getSourceFileName(entry.path),
      filePath: entry.path,
      content: entry.content,
      documentFlavor,
      readOnly: forceReadOnly || isSourceCodeDocumentReadOnly(documentFlavor),
      validationEnabled: shouldEnableValidationForDocument(documentFlavor, entry.content, false),
      changeTarget: {
        name: entry.path,
        format: entry.format,
      },
    };
  });

  return [...primaryDocuments, ...relatedDocuments];
}
