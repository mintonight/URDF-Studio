import {
  resolveRobotFileData,
  isStandaloneXacroEntry,
  type RobotImportResult,
} from '@/core/parsers/importRobotFile';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import {
  MJCF_SOURCE_FILE_SCOPE_ATTR,
  resolveMJCFSource,
} from '@/core/parsers/mjcf/mjcfSourceResolver';
import { parseMJCFXmlDocument } from '@/core/parsers/mjcf/mjcfUtils';
import { isAssetFile } from '@/features/file-io/utils/formatDetection';
import {
  createImportPathCollisionMap,
  remapImportedPath,
} from '@/features/file-io/utils/libraryImportPathCollisions';
import { isMotorLibraryDataFilePath } from '@/shared/data/motorLibrary';
import { isAssetLibraryOnlyFormat, isVisibleLibraryEntry } from '@/shared/utils/robotFileSupport';
import { pickPreferredImportFile } from '@/app/hooks/importPreferredFile';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';
import {
  peekPreResolvedRobotImport,
  primePreResolvedRobotImports,
} from './preResolvedRobotImportCache.ts';
import { normalizeLooseImportBundleRoot } from './import-preparation/bundleRootNormalization.ts';
import {
  processWithConcurrency,
  resolveImportPreparationConcurrency,
} from './import-preparation/concurrency.ts';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { detectImportFormat } from './import-preparation/formatDetection.ts';
import {
  createImportedUsdFile,
  createImportedUsdFileFromLooseFile,
  isUsdFamilyPath,
} from './import-preparation/usdFiles.ts';
import { pickFastPreparedPreferredFile } from './import-preparation/fastPreferredFile.ts';
import {
  createImportProgressEmitter,
  mapImportProgressToPercentRange,
} from './import-preparation/progress.ts';
import {
  determineCriticalDeferredAssetNames,
  collectRobotAssetPaths,
} from './import-preparation/criticalDeferredAssets.ts';
import {
  createVisibleImportedAssetFile,
  isAuxiliaryTextImportPath,
  isImportableDefinitionPath,
  shouldAlwaysLoadAuxiliaryImportPath,
  shouldLoadAuxiliaryImportText,
  shouldMirrorTextMeshAssetContent,
} from './import-preparation/pathClassification.ts';
import {
  isSupportedArchiveImportFile,
  withArchiveImportSession,
  type ArchiveImportEntry,
  type ArchiveImportSession,
} from './archiveImport.ts';
import { GeometryType, type RobotData, type RobotFile, type UrdfLink } from '@/types';

export interface PreparedImportBlobFile {
  name: string;
  blob: Blob;
}

export interface PreparedDeferredImportAssetFile {
  name: string;
  sourcePath: string;
  sourceArchiveImportPath?: string;
}

export interface PreparedImportLibraryFile {
  path: string;
  content: string;
}

export interface PreparedImportTextFile {
  path: string;
  content: string;
}

export interface PreResolvedImportEntry {
  fileName: string;
  format: RobotFile['format'];
  contentSignature: string;
  result: RobotImportResult;
}

export interface PreparedImportPayload {
  robotFiles: RobotFile[];
  assetFiles: PreparedImportBlobFile[];
  deferredAssetFiles: PreparedDeferredImportAssetFile[];
  usdSourceFiles: PreparedImportBlobFile[];
  libraryFiles: PreparedImportLibraryFile[];
  textFiles: PreparedImportTextFile[];
  preferredFileName: string | null;
  preResolvedImports: PreResolvedImportEntry[];
}

export interface PrepareImportPayloadArgs {
  files: readonly ImportPreparationFileInput[];
  existingPaths: readonly string[];
  preResolvePreferredImport?: boolean;
  onProgress?: (progress: PrepareImportProgress) => void;
}

export type PrepareImportProgressPhase =
  | 'reading-archive'
  | 'extracting-files'
  | 'finalizing-import';

export interface PrepareImportProgress {
  phase: PrepareImportProgressPhase;
  progressPercent: number | null;
  processedEntries: number;
  totalEntries: number;
  processedBytes: number;
  totalBytes: number;
}

export interface ImportPreparationFileDescriptor {
  file: File;
  relativePath?: string;
}

export type ImportPreparationFileInput = File | ImportPreparationFileDescriptor;

export interface PrepareImportWorkerRequest {
  type: 'prepare-import';
  requestId: number;
  files: ImportPreparationFileDescriptor[];
  existingPaths: string[];
  preResolvePreferredImport?: boolean;
}

export interface HydrateDeferredImportAssetsWorkerRequest {
  type: 'hydrate-deferred-import-assets';
  requestId: number;
  archiveFile: File;
  assetFiles: PreparedDeferredImportAssetFile[];
}

export interface PrepareImportWorkerResponse {
  type: 'prepare-import-result' | 'prepare-import-error' | 'prepare-import-progress';
  requestId: number;
  payload?: PreparedImportPayload;
  error?: string;
  progress?: PrepareImportProgress;
}

export interface HydrateDeferredImportAssetsWorkerResponse {
  type:
    | 'hydrate-deferred-import-assets-result'
    | 'hydrate-deferred-import-assets-error'
    | 'hydrate-deferred-import-assets-progress';
  requestId: number;
  assetFiles?: PreparedImportBlobFile[];
  error?: string;
  progress?: PrepareImportProgress;
}

export type ImportPreparationWorkerResponse =
  | PrepareImportWorkerResponse
  | HydrateDeferredImportAssetsWorkerResponse;

export type ImportPreparationWorkerRequest =
  | PrepareImportWorkerRequest
  | HydrateDeferredImportAssetsWorkerRequest;

interface CollectedImportPayload {
  robotFiles: RobotFile[];
  assetFiles: PreparedImportBlobFile[];
  deferredAssetFiles: PreparedDeferredImportAssetFile[];
  usdSourceFiles: PreparedImportBlobFile[];
  libraryFiles: PreparedImportLibraryFile[];
  textFiles: PreparedImportTextFile[];
}

function createEmptyCollectedImportPayload(): CollectedImportPayload {
  return {
    robotFiles: [],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
  };
}

function appendCollectedImportPayload(
  target: CollectedImportPayload,
  next: CollectedImportPayload,
): void {
  target.robotFiles.push(...next.robotFiles);
  target.assetFiles.push(...next.assetFiles);
  target.deferredAssetFiles.push(...next.deferredAssetFiles);
  target.usdSourceFiles.push(...next.usdSourceFiles);
  target.libraryFiles.push(...next.libraryFiles);
  target.textFiles.push(...next.textFiles);
}

function createEmptyPreparedImportPayload(): PreparedImportPayload {
  return {
    robotFiles: [],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
    preferredFileName: null,
    preResolvedImports: [],
  };
}

const MAX_EAGER_TEXT_MESH_ASSET_BYTES = 8 * 1024 * 1024;

export { detectImportFormat };

function shouldSkipImportPath(path: string): boolean {
  const pathParts = path.split('/');
  return pathParts.some((part) => part.startsWith('.'));
}

function resolveImportInputFile(input: ImportPreparationFileInput): File {
  return input instanceof File ? input : input.file;
}

function resolveImportInputPath(input: ImportPreparationFileInput): string {
  if (!(input instanceof File) && input.relativePath) {
    return input.relativePath;
  }

  const file = resolveImportInputFile(input);
  return file.webkitRelativePath || file.name;
}

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function normalizeResolvedImportAssetPath(
  assetPath: string,
  sourceFilePath?: string | null,
): string {
  return normalizeImportPath(resolveImportedAssetPath(assetPath, sourceFilePath));
}

function parseObjMaterialLibraryPaths(meshPath: string, content: string): string[] {
  const materialLibraryPaths = new Set<string>();
  const matches = content.matchAll(/^[ \t]*mtllib[ \t]+(.+)$/gim);

  for (const match of matches) {
    const rawValue = String(match[1] || '').trim();
    if (!rawValue) {
      continue;
    }

    const resolvedPath = normalizeResolvedImportAssetPath(rawValue, meshPath);
    if (!resolvedPath) {
      continue;
    }

    materialLibraryPaths.add(resolvedPath);
  }

  return [...materialLibraryPaths];
}

type MjcfScopedCompilerDirectories = {
  meshdir: string;
  hasDirectoryOverride: boolean;
};

function buildMjcfCompilerDirectoryMap(
  robotFiles: readonly RobotFile[],
): Map<string, MjcfScopedCompilerDirectories> {
  const compilerDirectoriesBySource = new Map<string, MjcfScopedCompilerDirectories>();

  robotFiles.forEach((file) => {
    if (file.format !== 'mjcf') {
      return;
    }

    const { doc } = parseMJCFXmlDocument(file.content);
    if (!doc) {
      return;
    }

    let assetdir = '';
    let meshdir: string | null = null;
    let hasDirectoryOverride = false;

    doc.querySelectorAll('compiler').forEach((compilerEl) => {
      const rawAssetdir = compilerEl.getAttribute('assetdir');
      if (rawAssetdir !== null) {
        assetdir = rawAssetdir;
        hasDirectoryOverride = true;
      }

      const rawMeshdir = compilerEl.getAttribute('meshdir');
      if (rawMeshdir !== null) {
        meshdir = rawMeshdir;
        hasDirectoryOverride = true;
      }
    });

    compilerDirectoriesBySource.set(file.name, {
      meshdir: meshdir ?? assetdir,
      hasDirectoryOverride,
    });
  });

  return compilerDirectoriesBySource;
}

function applyMjcfMeshDirectory(filePath: string, directory: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes(':')) {
    return trimmed;
  }

  const normalizedDirectory = normalizeImportPath(directory);
  if (!normalizedDirectory) {
    return trimmed;
  }

  return `${normalizedDirectory}/${trimmed}`;
}

function resolveMjcfScopedSourceFilePath(element: Element, fallbackSourcePath: string): string {
  let currentElement: Element | null = element;
  while (currentElement) {
    const sourceFilePath = currentElement.getAttribute(MJCF_SOURCE_FILE_SCOPE_ATTR)?.trim();
    if (sourceFilePath) {
      return sourceFilePath;
    }
    currentElement = currentElement.parentElement;
  }

  return fallbackSourcePath;
}

function collectReferencedTextMeshPathsFromResolvedMjcfSource(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  const resolvedSource = resolveMJCFSource(preferredFile, [...robotFiles]);
  if (resolvedSource.issues.length > 0) {
    return new Set<string>();
  }

  const { doc } = parseMJCFXmlDocument(resolvedSource.validationContent);
  if (!doc) {
    return new Set<string>();
  }

  const compilerDirectoriesBySource = buildMjcfCompilerDirectoryMap(robotFiles);
  let currentAssetdir = '';
  let currentMeshdir: string | null = null;
  const referencedTextMeshPaths = new Set<string>();

  Array.from(doc.querySelectorAll('*')).forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'compiler') {
      const rawAssetdir = element.getAttribute('assetdir');
      if (rawAssetdir !== null) {
        currentAssetdir = rawAssetdir;
      }

      const rawMeshdir = element.getAttribute('meshdir');
      if (rawMeshdir !== null) {
        currentMeshdir = rawMeshdir;
      }
      return;
    }

    if (tagName !== 'mesh' || element.parentElement?.tagName.toLowerCase() !== 'asset') {
      return;
    }

    const rawMeshPath = element.getAttribute('file')?.trim();
    if (!rawMeshPath) {
      return;
    }

    const sourceFilePath = resolveMjcfScopedSourceFilePath(element, preferredFile.name);
    const scopedCompilerDirectories = compilerDirectoriesBySource.get(sourceFilePath);
    const compilerMeshdir = scopedCompilerDirectories?.hasDirectoryOverride
      ? scopedCompilerDirectories.meshdir
      : (currentMeshdir ?? currentAssetdir);
    const resolvedPath = normalizeResolvedImportAssetPath(
      applyMjcfMeshDirectory(rawMeshPath, compilerMeshdir),
      sourceFilePath,
    );

    if (resolvedPath && shouldMirrorTextMeshAssetContent(resolvedPath.toLowerCase())) {
      referencedTextMeshPaths.add(resolvedPath);
    }
  });

  return referencedTextMeshPaths;
}

function canParseXmlDocumentStrict(content: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    return doc.querySelector('parsererror') === null;
  } catch {
    return false;
  }
}

function collectReferencedTextMeshPathsFromResolvedSdfImport(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  if (!canParseXmlDocumentStrict(preferredFile.content)) {
    return new Set<string>();
  }

  return collectReferencedTextMeshPathsFromResolvedImport(preferredFile, robotFiles);
}

function collectReferencedTextMeshPathsFromResolvedImport(
  preferredFile: RobotFile,
  robotFiles: readonly RobotFile[],
): Set<string> {
  const referencedTextMeshPaths = new Set<string>();
  const importResult =
    peekPreResolvedRobotImport(preferredFile) ??
    resolveRobotFileData(preferredFile, {
      availableFiles: [...robotFiles],
      allFileContents: Object.fromEntries(
        robotFiles
          .filter((file) => typeof file.content === 'string' && file.content.length > 0)
          .map((file) => [file.name, file.content]),
      ),
    });

  if (importResult.status !== 'ready') {
    return referencedTextMeshPaths;
  }

  primePreResolvedRobotImports([
    {
      fileName: preferredFile.name,
      format: preferredFile.format,
      contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
      result: importResult,
    },
  ]);

  collectRobotAssetPaths(importResult.robotData).forEach((assetPath) => {
    const normalizedPath = normalizeImportPath(assetPath);
    if (normalizedPath && shouldMirrorTextMeshAssetContent(normalizedPath.toLowerCase())) {
      referencedTextMeshPaths.add(normalizedPath);
    }
  });

  return referencedTextMeshPaths;
}

function collectReferencedTextMeshPathsForPreferredImport(
  robotFiles: readonly RobotFile[],
  preResolvePreferredImport: boolean,
): Set<string> {
  const visibleRobotFiles = robotFiles.filter(isVisibleLibraryEntry);
  const preferredFile =
    preResolvePreferredImport !== false
      ? pickPreferredImportFile(visibleRobotFiles, [...robotFiles])
      : pickFastPreparedPreferredFile([...visibleRobotFiles], [...robotFiles]);
  if (!preferredFile || (preferredFile.format !== 'mjcf' && preferredFile.format !== 'sdf')) {
    return new Set<string>();
  }

  const referencedTextMeshPaths = new Set<string>();

  if (preferredFile.format === 'mjcf') {
    try {
      const resolvedTextMeshPaths = collectReferencedTextMeshPathsFromResolvedMjcfSource(
        preferredFile,
        robotFiles,
      );
      resolvedTextMeshPaths.forEach((path) => referencedTextMeshPaths.add(path));
    } catch (error) {
      scheduleFailFastInDev(
        'importPreparation:collectReferencedTextMeshPathsForPreferredImport',
        new Error(
          `Failed to scan resolved MJCF source "${preferredFile.name}" while collecting text-mesh dependencies.`,
          { cause: error },
        ),
        'error',
      );
    }

    return referencedTextMeshPaths;
  }

  try {
    const resolvedTextMeshPaths = collectReferencedTextMeshPathsFromResolvedSdfImport(
      preferredFile,
      robotFiles,
    );
    resolvedTextMeshPaths.forEach((path) => referencedTextMeshPaths.add(path));
  } catch (error) {
    scheduleFailFastInDev(
      'importPreparation:collectReferencedTextMeshPathsForPreferredImport',
      new Error(
        `Failed to resolve import "${preferredFile.name}" while collecting text-mesh dependencies.`,
        { cause: error },
      ),
      'error',
    );
  }

  return referencedTextMeshPaths;
}
function collectReferencedObjMaterialPaths(
  textFiles: readonly PreparedImportTextFile[],
): Set<string> {
  const materialPaths = new Set<string>();

  textFiles.forEach((file) => {
    if (!file.path.toLowerCase().endsWith('.obj')) {
      return;
    }

    parseObjMaterialLibraryPaths(file.path, file.content).forEach((materialPath) => {
      if (materialPath.toLowerCase().endsWith('.mtl')) {
        materialPaths.add(materialPath);
      }
    });
  });

  return materialPaths;
}

function appendPreparedImportTextFileIfMissing(
  target: PreparedImportTextFile[],
  nextFile: PreparedImportTextFile,
): void {
  const normalizedNextPath = normalizeImportPath(nextFile.path);
  if (target.some((file) => normalizeImportPath(file.path) === normalizedNextPath)) {
    return;
  }

  target.push(nextFile);
}

function appendPreparedImportTextFilesIfMissing(
  target: PreparedImportTextFile[],
  nextFiles: readonly PreparedImportTextFile[],
): void {
  nextFiles.forEach((file) => appendPreparedImportTextFileIfMissing(target, file));
}

function appendPreparedImportBlobFileIfMissing(
  target: PreparedImportBlobFile[],
  nextFile: PreparedImportBlobFile,
): void {
  const normalizedNextPath = normalizeImportPath(nextFile.name);
  if (target.some((file) => normalizeImportPath(file.name) === normalizedNextPath)) {
    return;
  }

  target.push(nextFile);
}

function renameCollectedImportPayload(
  payload: CollectedImportPayload,
  existingPaths: readonly string[],
  options: {
    preResolvePreferredImport?: boolean;
  } = {},
): PreparedImportPayload {
  const importedPaths = [
    ...payload.robotFiles.map((file) => file.name),
    ...payload.assetFiles.map((file) => file.name),
    ...payload.deferredAssetFiles.map((file) => file.name),
    ...payload.libraryFiles.map((file) => file.path),
    ...payload.textFiles.map((file) => file.path),
  ];
  const pathCollisionMap = createImportPathCollisionMap(importedPaths, existingPaths);

  const renamedPayload = {
    robotFiles: payload.robotFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    assetFiles: payload.assetFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    deferredAssetFiles: payload.deferredAssetFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    usdSourceFiles: payload.usdSourceFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    libraryFiles: payload.libraryFiles.map((file) => ({
      ...file,
      path: remapImportedPath(file.path, pathCollisionMap),
    })),
    textFiles: payload.textFiles.map((file) => ({
      ...file,
      path: remapImportedPath(file.path, pathCollisionMap),
    })),
  };
  const shouldPreResolvePreferredImport = options.preResolvePreferredImport !== false;
  const importTextFileContents = shouldPreResolvePreferredImport
    ? Object.fromEntries(renamedPayload.textFiles.map((file) => [file.path, file.content]))
    : {};
  const visibleRobotFiles = renamedPayload.robotFiles.filter(isVisibleLibraryEntry);
  const standaloneRootXacro =
    shouldPreResolvePreferredImport &&
    visibleRobotFiles.length > 0 &&
    visibleRobotFiles.every(
      (file) => file.format === 'xacro' || isAssetLibraryOnlyFormat(file.format),
    )
      ? (visibleRobotFiles.find(
          (file) => file.format === 'xacro' && isStandaloneXacroEntry(file),
        ) ?? null)
      : null;
  const preferredFile = shouldPreResolvePreferredImport
    ? (standaloneRootXacro ?? pickPreferredImportFile(visibleRobotFiles, renamedPayload.robotFiles))
    : pickFastPreparedPreferredFile(visibleRobotFiles, renamedPayload.robotFiles);
  const cachedPreferredImportResult =
    shouldPreResolvePreferredImport && preferredFile
      ? peekPreResolvedRobotImport(preferredFile)
      : null;
  const preferredImportResult =
    cachedPreferredImportResult ??
    (shouldPreResolvePreferredImport && preferredFile
      ? preferredFile.format === 'xacro' || preferredFile.format === 'sdf'
        ? resolveRobotFileData(preferredFile, {
            availableFiles: renamedPayload.robotFiles,
            allFileContents: importTextFileContents,
          })
        : resolveRobotFileData(preferredFile, {
            availableFiles: renamedPayload.robotFiles,
          })
      : null);

  const preResolvedImports =
    shouldPreResolvePreferredImport && preferredFile && preferredImportResult
      ? [
          {
            fileName: preferredFile.name,
            format: preferredFile.format,
            contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
            result: preferredImportResult,
          },
        ]
      : [];

  return {
    ...renamedPayload,
    preferredFileName: preferredFile?.name ?? null,
    preResolvedImports,
  };
}

async function collectImportPayloadFromArchiveSession(
  archiveSession: ArchiveImportSession,
  options: {
    preResolvePreferredImport?: boolean;
    sourceArchiveImportPath?: string;
  } = {},
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<CollectedImportPayload> {
  const payload = createEmptyCollectedImportPayload();
  const emitProgress = createImportProgressEmitter(onProgress);
  emitProgress({
    phase: 'reading-archive',
    progressPercent: 0,
    processedEntries: 0,
    totalEntries: 0,
    processedBytes: 0,
    totalBytes: 0,
  });

  const processableEntries = archiveSession.entries.filter(
    (entry) => !shouldSkipImportPath(entry.path),
  );
  const auxiliaryTextEntries: ArchiveImportEntry[] = [];
  const mirroredTextMeshAssetEntries: ArchiveImportEntry[] = [];
  const usdEntries: ArchiveImportEntry[] = [];
  const definitionEntries: ArchiveImportEntry[] = [];
  const libraryEntries: ArchiveImportEntry[] = [];

  const totalEntries = processableEntries.length;
  const totalBytes = processableEntries.reduce((sum, current) => sum + current.size, 0);
  let processedEntries = 0;
  let processedBytes = 0;
  const reportExtractionProgress = () => {
    emitProgress({
      phase: 'extracting-files',
      progressPercent: totalEntries > 0 ? (processedEntries / totalEntries) * 100 : 100,
      processedEntries,
      totalEntries,
      processedBytes,
      totalBytes,
    });
  };

  reportExtractionProgress();

  processableEntries.forEach((entry) => {
    const { path, size } = entry;
    const lowerPath = path.toLowerCase();

    if (isUsdFamilyPath(path)) {
      usdEntries.push(entry);
    } else if (isImportableDefinitionPath(lowerPath)) {
      definitionEntries.push(entry);
    } else if (isMotorLibraryDataFilePath(path)) {
      libraryEntries.push(entry);
    } else if (isAuxiliaryTextImportPath(lowerPath)) {
      auxiliaryTextEntries.push(entry);
    } else if (isAssetFile(path)) {
      payload.deferredAssetFiles.push({
        name: path,
        sourcePath: path,
        sourceArchiveImportPath: options.sourceArchiveImportPath,
      });
      if (shouldMirrorTextMeshAssetContent(lowerPath) && size <= MAX_EAGER_TEXT_MESH_ASSET_BYTES) {
        mirroredTextMeshAssetEntries.push(entry);
      }
      const visibleAssetFile = createVisibleImportedAssetFile(path);
      if (visibleAssetFile) {
        payload.robotFiles.push(visibleAssetFile);
      }
    }
    processedEntries += 1;
    processedBytes += size;
    reportExtractionProgress();
  });

  const concurrency = resolveImportPreparationConcurrency();

  const extractedUsdEntries = await archiveSession.extractEntries(
    usdEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedUsdEntries, concurrency, async ({ path, file }) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    payload.robotFiles.push(createImportedUsdFile(path, bytes));
    payload.usdSourceFiles.push({ name: path, blob: new Blob([bytes]) });
  });

  const extractedDefinitionEntries = await archiveSession.extractEntries(
    definitionEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedDefinitionEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    const format = detectImportFormat(content, path);
    if (format) {
      payload.robotFiles.push({ name: path, content, format });
    }
  });

  const extractedLibraryEntries = await archiveSession.extractEntries(
    libraryEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedLibraryEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    payload.libraryFiles.push({ path, content });
  });

  const referencedTextMeshPaths = collectReferencedTextMeshPathsForPreferredImport(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );

  const auxiliaryTextEntriesToLoad = auxiliaryTextEntries.filter((entry) => {
    const lowerPath = entry.path.toLowerCase();
    return (
      shouldLoadAuxiliaryImportText(payload.robotFiles) ||
      shouldAlwaysLoadAuxiliaryImportPath(lowerPath)
    );
  });

  if (auxiliaryTextEntriesToLoad.length > 0) {
    const extractedAuxiliaryTextEntries = await archiveSession.extractEntries(
      auxiliaryTextEntriesToLoad.map((entry) => entry.path),
    );
    await processWithConcurrency(
      extractedAuxiliaryTextEntries,
      concurrency,
      async ({ path, file }) => {
        const content = await file.text();
        appendPreparedImportTextFileIfMissing(payload.textFiles, { path, content });
      },
    );
  }

  if (referencedTextMeshPaths.size > 0 && mirroredTextMeshAssetEntries.length > 0) {
    const targetedMirroredTextMeshEntries = mirroredTextMeshAssetEntries.filter((entry) =>
      referencedTextMeshPaths.has(normalizeImportPath(entry.path)),
    );

    if (targetedMirroredTextMeshEntries.length > 0) {
      const extractedMirroredTextMeshEntries = await archiveSession.extractEntries(
        targetedMirroredTextMeshEntries.map((entry) => entry.path),
      );
      const importedMjcfMeshTextFiles: PreparedImportTextFile[] = [];

      await processWithConcurrency(
        extractedMirroredTextMeshEntries,
        concurrency,
        async ({ path, file }) => {
          importedMjcfMeshTextFiles.push({ path, content: await file.text() });
        },
      );

      appendPreparedImportTextFilesIfMissing(payload.textFiles, importedMjcfMeshTextFiles);

      const referencedObjMaterialPaths =
        collectReferencedObjMaterialPaths(importedMjcfMeshTextFiles);
      if (referencedObjMaterialPaths.size > 0 && auxiliaryTextEntries.length > 0) {
        const targetedAuxiliaryTextEntries = auxiliaryTextEntries.filter((entry) =>
          referencedObjMaterialPaths.has(normalizeImportPath(entry.path)),
        );

        if (targetedAuxiliaryTextEntries.length > 0) {
          const extractedAuxiliaryTextEntries = await archiveSession.extractEntries(
            targetedAuxiliaryTextEntries.map((entry) => entry.path),
          );
          await processWithConcurrency(
            extractedAuxiliaryTextEntries,
            concurrency,
            async ({ path, file }) => {
              appendPreparedImportTextFileIfMissing(payload.textFiles, {
                path,
                content: await file.text(),
              });
              appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
                name: path,
                blob: file,
              });
            },
          );
        }
      }
    }
  }

  emitProgress({
    phase: 'finalizing-import',
    progressPercent: 100,
    processedEntries: totalEntries,
    totalEntries,
    processedBytes: totalBytes,
    totalBytes,
  });

  return payload;
}

async function hydrateDeferredImportAssetsFromArchiveSession(
  archiveSession: ArchiveImportSession,
  assetFiles: readonly PreparedDeferredImportAssetFile[],
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<PreparedImportBlobFile[]> {
  const emitProgress = createImportProgressEmitter(onProgress);
  emitProgress({
    phase: 'reading-archive',
    progressPercent: 0,
    processedEntries: 0,
    totalEntries: assetFiles.length,
    processedBytes: 0,
    totalBytes: 0,
  });

  const totalEntries = assetFiles.length;
  if (assetFiles.length === 0) {
    emitProgress({
      phase: 'finalizing-import',
      progressPercent: 100,
      processedEntries: 0,
      totalEntries: 0,
      processedBytes: 0,
      totalBytes: 0,
    });
    return [];
  }

  const assetFileLookup = new Map(assetFiles.map((file) => [file.sourcePath, file] as const));
  const extractedAssetFiles = await archiveSession.extractEntries(
    assetFiles.map((file) => file.sourcePath),
    ({ processedEntries, processedBytes, totalBytes }) => {
      emitProgress({
        phase: 'extracting-files',
        progressPercent: totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 100,
        processedEntries,
        totalEntries,
        processedBytes,
        totalBytes,
      });
    },
  );
  const hydratedAssetFiles: PreparedImportBlobFile[] = [];

  await processWithConcurrency(
    extractedAssetFiles,
    resolveImportPreparationConcurrency(),
    async ({ path, file }) => {
      const assetFile = assetFileLookup.get(path);
      if (!assetFile) {
        throw new Error(`Missing deferred asset "${path}" in archive.`);
      }

      hydratedAssetFiles.push({
        name: assetFile.name,
        blob: file,
      });
    },
  );

  emitProgress({
    phase: 'finalizing-import',
    progressPercent: 100,
    processedEntries: extractedAssetFiles.length,
    totalEntries,
    processedBytes: extractedAssetFiles.reduce((sum, current) => sum + current.size, 0),
    totalBytes: extractedAssetFiles.reduce((sum, current) => sum + current.size, 0),
  });

  return hydratedAssetFiles.sort((left, right) => left.name.localeCompare(right.name));
}

export async function hydrateDeferredImportAssets(
  archiveFile: File,
  assetFiles: readonly PreparedDeferredImportAssetFile[],
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<PreparedImportBlobFile[]> {
  return withArchiveImportSession(archiveFile, async (archiveSession) =>
    hydrateDeferredImportAssetsFromArchiveSession(archiveSession, assetFiles, onProgress),
  );
}

async function collectImportPayloadFromLooseFiles(
  files: readonly ImportPreparationFileInput[],
  options: {
    preResolvePreferredImport?: boolean;
  } = {},
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<CollectedImportPayload> {
  const payload = createEmptyCollectedImportPayload();
  const emitProgress = createImportProgressEmitter(onProgress);
  const auxiliaryTextFiles: Array<{ path: string; file: File }> = [];
  const mirroredTextMeshFiles: Array<{ path: string; file: File }> = [];
  const totalEntries = files.length;
  const totalBytes = files.reduce((sum, input) => sum + resolveImportInputFile(input).size, 0);
  let processedEntries = 0;
  let processedBytes = 0;
  const reportExtractionProgress = () => {
    emitProgress({
      phase: 'extracting-files',
      progressPercent: totalEntries > 0 ? (processedEntries / totalEntries) * 100 : 100,
      processedEntries,
      totalEntries,
      processedBytes,
      totalBytes,
    });
  };

  reportExtractionProgress();

  await processWithConcurrency(files, resolveImportPreparationConcurrency(), async (input) => {
    const file = resolveImportInputFile(input);
    const path = resolveImportInputPath(input);
    const lowerPath = path.toLowerCase();

    if (shouldSkipImportPath(path)) {
      processedEntries += 1;
      processedBytes += file.size;
      reportExtractionProgress();
      return;
    }

    if (isSupportedArchiveImportFile(path)) {
      const archivePayload = await withArchiveImportSession(file, (archiveSession) =>
        collectImportPayloadFromArchiveSession(archiveSession, {
          preResolvePreferredImport: options.preResolvePreferredImport,
          sourceArchiveImportPath: normalizeImportPath(path),
        }),
      );
      appendCollectedImportPayload(payload, archivePayload);
    } else if (isUsdFamilyPath(path)) {
      payload.robotFiles.push(await createImportedUsdFileFromLooseFile(path, file));
      payload.usdSourceFiles.push({ name: path, blob: file });
    } else if (isImportableDefinitionPath(lowerPath)) {
      const content = await file.text();
      const format = detectImportFormat(content, file.name);
      if (format) {
        payload.robotFiles.push({ name: path, content, format });
      }
    } else if (isMotorLibraryDataFilePath(path)) {
      const content = await file.text();
      payload.libraryFiles.push({ path, content });
    } else if (isAuxiliaryTextImportPath(lowerPath)) {
      auxiliaryTextFiles.push({ path, file });
    } else if (isAssetFile(path)) {
      if (
        shouldMirrorTextMeshAssetContent(lowerPath) &&
        file.size <= MAX_EAGER_TEXT_MESH_ASSET_BYTES
      ) {
        mirroredTextMeshFiles.push({ path, file });
      }
      payload.assetFiles.push({ name: path, blob: file });
      const visibleAssetFile = createVisibleImportedAssetFile(path);
      if (visibleAssetFile) {
        payload.robotFiles.push(visibleAssetFile);
      }
    }

    processedEntries += 1;
    processedBytes += file.size;
    reportExtractionProgress();
  });

  const auxiliaryTextFilesToLoad = auxiliaryTextFiles.filter(({ path }) => {
    const lowerPath = path.toLowerCase();
    return (
      shouldLoadAuxiliaryImportText(payload.robotFiles) ||
      shouldAlwaysLoadAuxiliaryImportPath(lowerPath)
    );
  });

  if (auxiliaryTextFilesToLoad.length > 0) {
    await processWithConcurrency(
      auxiliaryTextFilesToLoad,
      resolveImportPreparationConcurrency(),
      async ({ path, file }) => {
        appendPreparedImportTextFileIfMissing(payload.textFiles, {
          path,
          content: await file.text(),
        });
      },
    );
  }

  const referencedTextMeshPaths = collectReferencedTextMeshPathsForPreferredImport(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );

  if (referencedTextMeshPaths.size > 0 && mirroredTextMeshFiles.length > 0) {
    const targetedMirroredTextMeshFiles = mirroredTextMeshFiles.filter(({ path }) =>
      referencedTextMeshPaths.has(normalizeImportPath(path)),
    );

    if (targetedMirroredTextMeshFiles.length > 0) {
      const importedMjcfMeshTextFiles: PreparedImportTextFile[] = [];

      await processWithConcurrency(
        targetedMirroredTextMeshFiles,
        resolveImportPreparationConcurrency(),
        async ({ path, file }) => {
          importedMjcfMeshTextFiles.push({ path, content: await file.text() });
        },
      );

      appendPreparedImportTextFilesIfMissing(payload.textFiles, importedMjcfMeshTextFiles);

      const referencedObjMaterialPaths =
        collectReferencedObjMaterialPaths(importedMjcfMeshTextFiles);
      if (referencedObjMaterialPaths.size > 0 && auxiliaryTextFiles.length > 0) {
        const targetedAuxiliaryTextFiles = auxiliaryTextFiles.filter(({ path }) =>
          referencedObjMaterialPaths.has(normalizeImportPath(path)),
        );

        if (targetedAuxiliaryTextFiles.length > 0) {
          await processWithConcurrency(
            targetedAuxiliaryTextFiles,
            resolveImportPreparationConcurrency(),
            async ({ path, file }) => {
              appendPreparedImportTextFileIfMissing(payload.textFiles, {
                path,
                content: await file.text(),
              });
              appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
                name: path,
                blob: file,
              });
            },
          );
        }
      }
    }
  }

  emitProgress({
    phase: 'finalizing-import',
    progressPercent: 100,
    processedEntries: totalEntries,
    totalEntries,
    processedBytes: totalBytes,
    totalBytes,
  });

  return payload;
}

function sortCollectedImportPayload(payload: CollectedImportPayload): CollectedImportPayload {
  return {
    robotFiles: [...payload.robotFiles].sort((left, right) => left.name.localeCompare(right.name)),
    assetFiles: [...payload.assetFiles].sort((left, right) => left.name.localeCompare(right.name)),
    deferredAssetFiles: [...payload.deferredAssetFiles].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    usdSourceFiles: [...payload.usdSourceFiles].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    libraryFiles: [...payload.libraryFiles].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    textFiles: [...payload.textFiles].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function prepareImportPayload({
  files,
  existingPaths,
  preResolvePreferredImport = true,
  onProgress,
}: PrepareImportPayloadArgs): Promise<PreparedImportPayload> {
  const firstFile = files[0] ? resolveImportInputFile(files[0]) : null;
  const isSingleArchiveImport =
    files.length === 1 && firstFile ? isSupportedArchiveImportFile(firstFile.name) : false;
  if (isSingleArchiveImport) {
    return withArchiveImportSession(firstFile, async (archiveSession) => {
      const collectedPayload = await collectImportPayloadFromArchiveSession(
        archiveSession,
        {
          preResolvePreferredImport,
        },
        onProgress
          ? (progress) => onProgress(mapImportProgressToPercentRange(progress, 0, 72))
          : undefined,
      );
      const sortedCollectedPayload = sortCollectedImportPayload(collectedPayload);

      if (
        sortedCollectedPayload.robotFiles.length === 0 &&
        sortedCollectedPayload.libraryFiles.length === 0
      ) {
        return createEmptyPreparedImportPayload();
      }

      const preparedPayload = renameCollectedImportPayload(
        normalizeLooseImportBundleRoot(sortedCollectedPayload),
        existingPaths,
        {
          preResolvePreferredImport,
        },
      );

      if (preparedPayload.deferredAssetFiles.length === 0) {
        return preparedPayload;
      }

      const preferredFile = preparedPayload.preferredFileName
        ? (preparedPayload.robotFiles.find(
            (file) => file.name === preparedPayload.preferredFileName,
          ) ?? null)
        : null;
      const preparedTextFileContents = Object.fromEntries(
        preparedPayload.textFiles.map((file) => [file.path, file.content]),
      );
      const preResolvedPreferredImport =
        preferredFile == null
          ? null
          : (preparedPayload.preResolvedImports.find(
              (entry) => entry.fileName === preferredFile.name,
            ) ?? null);
      const preferredImportResult =
        preResolvedPreferredImport?.result ??
        (preferredFile && preferredFile.format !== 'usd'
          ? resolveRobotFileData(preferredFile, {
              availableFiles: preparedPayload.robotFiles,
              allFileContents: preparedTextFileContents,
            })
          : null);
      const criticalDeferredAssetNames = determineCriticalDeferredAssetNames(
        preferredFile,
        preferredImportResult,
        preparedPayload.deferredAssetFiles,
        preparedPayload.robotFiles,
        preparedTextFileContents,
      );

      if (criticalDeferredAssetNames.size === 0) {
        return preparedPayload;
      }

      const immediateDeferredAssetFiles = preparedPayload.deferredAssetFiles.filter((file) =>
        criticalDeferredAssetNames.has(file.name),
      );
      const remainingDeferredAssetFiles = preparedPayload.deferredAssetFiles.filter(
        (file) => !criticalDeferredAssetNames.has(file.name),
      );
      const criticalAssetFiles = await hydrateDeferredImportAssetsFromArchiveSession(
        archiveSession,
        immediateDeferredAssetFiles,
        onProgress
          ? (progress) => onProgress(mapImportProgressToPercentRange(progress, 72, 92))
          : undefined,
      );

      return {
        ...preparedPayload,
        assetFiles: [...preparedPayload.assetFiles, ...criticalAssetFiles],
        deferredAssetFiles: remainingDeferredAssetFiles,
      };
    });
  }

  const collectedPayload = await collectImportPayloadFromLooseFiles(
    files,
    {
      preResolvePreferredImport,
    },
    onProgress,
  );
  const sortedCollectedPayload = sortCollectedImportPayload(collectedPayload);

  if (
    sortedCollectedPayload.robotFiles.length === 0 &&
    sortedCollectedPayload.libraryFiles.length === 0
  ) {
    return createEmptyPreparedImportPayload();
  }

  return renameCollectedImportPayload(
    normalizeLooseImportBundleRoot(sortedCollectedPayload),
    existingPaths,
    {
      preResolvePreferredImport,
    },
  );
}
