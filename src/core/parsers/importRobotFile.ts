import {
  DEFAULT_LINK,
  GeometryType,
  type RobotData,
  type RobotFile,
  type RobotState,
} from '@/types';
import { parseURDF } from './urdf/parser';
import { parseMJCF } from './mjcf/mjcfParser';
import { syncMjcfMeshTextMaterialColors } from './mjcf/mjcfMeshTextColorSync';
import { resolveMJCFSource } from './mjcf/mjcfSourceResolver';
import { parseSDF } from './sdf/sdfParser';
import { syncRobotMeshTextMaterialMetadata } from './meshTextMaterialSync';
import { processXacro } from './xacro/xacroParser';
import { rewriteRobotMeshPathsForSource } from './meshPathUtils';
import { syncRobotVisualColorsFromMaterials } from '@/core/robot/materials';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import { isSourceOnlyMJCFDocument } from './mjcf/mjcfXml';
import { inspectMJCFImportExternalAssets } from './mjcf/mjcfImportValidation';

export interface ResolveRobotFileDataOptions {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  usdRobotData?: RobotData | null;
  mjcfExternalAssetValidation?: 'auto' | 'always' | 'never';
}

export interface RobotImportProgress {
  progressPercent: number;
  message?: string | null;
}

export type RobotImportErrorReason = 'parse_failed' | 'unsupported_format' | 'source_only_fragment';

export type RobotImportResult =
  | {
      status: 'ready';
      format: RobotFile['format'];
      robotData: RobotData;
      resolvedUrdfContent: string | null;
      resolvedUrdfSourceFilePath: string | null;
    }
  | {
      status: 'needs_hydration';
      format: 'usd';
    }
  | {
      status: 'error';
      format: RobotFile['format'];
      reason: RobotImportErrorReason;
      message?: string;
    };

type RobotImportProgressReporter = (progress: RobotImportProgress) => void;

const ROBOT_IMPORT_FAILURE_MESSAGE_PREFIX = /^Failed to import [A-Z0-9_+-]+ file "[^"]+"\.\s*/i;

function emitRobotImportProgress(
  reportProgress: RobotImportProgressReporter | undefined,
  progressPercent: number,
  message?: string | null,
): void {
  if (!reportProgress) {
    return;
  }

  reportProgress({
    progressPercent: Math.max(0, Math.min(100, Math.round(progressPercent))),
    message: message ?? null,
  });
}

function toRobotData(robot: RobotState | RobotData): RobotData {
  return {
    name: robot.name,
    links: robot.links,
    joints: robot.joints,
    rootLinkId: robot.rootLinkId,
    materials: robot.materials,
    closedLoopConstraints: robot.closedLoopConstraints,
  };
}

export function createUsdPlaceholderRobotData(file: RobotFile): RobotData {
  const robotName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') || 'usd_scene';
  const linkId = 'usd_scene_root';

  return {
    name: robotName,
    links: {
      [linkId]: {
        ...DEFAULT_LINK,
        id: linkId,
        name: 'usd_scene_root',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
  };
}

function createMeshRobotData(file: RobotFile): RobotData {
  const meshName =
    file.name
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') ?? 'mesh';
  const linkId = 'base_link';
  const previewColor = isImageAssetPath(file.name) ? '#ffffff' : '#808080';

  return {
    name: meshName,
    links: {
      [linkId]: {
        id: linkId,
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: previewColor,
          meshPath: file.name,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1.0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
        },
      },
    },
    joints: {},
    rootLinkId: linkId,
  };
}

function createReadyImportResult(
  file: RobotFile,
  robotData: RobotData,
  options: {
    sourceFilePath?: string;
    resolvedUrdfContent?: string | null;
    allFileContents?: Record<string, string>;
    assetPaths?: Iterable<string>;
  } = {},
): RobotImportResult {
  const {
    sourceFilePath = file.name,
    resolvedUrdfContent = null,
    allFileContents = {},
    assetPaths = [],
  } = options;
  const rewrittenRobotData = rewriteRobotMeshPathsForSource(robotData, sourceFilePath);
  const meshTextMaterialSyncedRobotData =
    file.format === 'mjcf'
      ? rewrittenRobotData
      : syncRobotMeshTextMaterialMetadata(rewrittenRobotData, {
          allFileContents,
          assetPaths,
        });
  const mjcfMeshColorSyncedRobotData =
    file.format === 'mjcf'
      ? syncMjcfMeshTextMaterialColors(rewrittenRobotData, allFileContents)
      : meshTextMaterialSyncedRobotData;

  return {
    status: 'ready',
    format: file.format,
    robotData: syncRobotVisualColorsFromMaterials(mjcfMeshColorSyncedRobotData),
    resolvedUrdfContent,
    resolvedUrdfSourceFilePath: resolvedUrdfContent ? sourceFilePath : null,
  };
}

function buildImportFailureMessage(file: RobotFile, detail?: string | null): string {
  const baseMessage = `Failed to import ${file.format.toUpperCase()} file "${file.name}".`;
  const trimmedDetail = detail?.trim();
  if (!trimmedDetail) {
    return baseMessage;
  }

  return `${baseMessage} ${trimmedDetail}`;
}

function createErrorImportResult(
  file: RobotFile,
  reason: RobotImportErrorReason,
  message?: string,
): RobotImportResult {
  return {
    status: 'error',
    format: file.format,
    reason,
    message,
  };
}

export function describeRobotImportFailure(
  importResult: Exclude<RobotImportResult, { status: 'ready' }>,
): string {
  if (importResult.status === 'needs_hydration') {
    return 'USD scene data is not hydrated yet.';
  }

  const normalizedMessage = importResult.message
    ?.trim()
    .replace(ROBOT_IMPORT_FAILURE_MESSAGE_PREFIX, '');
  if (normalizedMessage) {
    return normalizedMessage;
  }

  if (importResult.reason === 'unsupported_format') {
    return `Unsupported format "${importResult.format}".`;
  }

  if (importResult.reason === 'source_only_fragment') {
    return 'The selected source file is only a fragment and cannot be assembled as a standalone component.';
  }

  return 'Source parsing failed.';
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function normalizeSourceLookupPath(filePath: string): string {
  return normalizeFilePath(filePath).trim().replace(/^\/+/, '').split('?')[0];
}

function getFileName(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

function hasSourceContent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTextMeshMaterialInputs(allFileContents: Record<string, string>): boolean {
  for (const assetPath in allFileContents) {
    if (!Object.prototype.hasOwnProperty.call(allFileContents, assetPath)) {
      continue;
    }

    const lowerPath = assetPath.toLowerCase();
    if (lowerPath.endsWith('.dae') || lowerPath.endsWith('.obj')) {
      return true;
    }
  }

  return false;
}

function buildMeshTextMaterialAssetPaths(options: {
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
}): Set<string> {
  const paths = new Set<string>();

  Object.keys(options.allFileContents).forEach((assetPath) => {
    paths.add(assetPath);
  });

  Object.keys(options.assets).forEach((assetPath) => {
    if (isImageAssetPath(assetPath)) {
      paths.add(assetPath);
    }
  });

  options.availableFiles.forEach((file) => {
    if (isImageAssetPath(file.name)) {
      paths.add(file.name);
    }
  });

  return paths;
}

function findContextFileContent(
  file: RobotFile,
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'allFileContents'>,
): { content: string; sourceFilePath: string } | null {
  const normalizedTargetPath = normalizeSourceLookupPath(file.name);
  if (!normalizedTargetPath) {
    return null;
  }

  for (const [path, content] of Object.entries(options.allFileContents ?? {})) {
    if (hasSourceContent(content) && normalizeSourceLookupPath(path) === normalizedTargetPath) {
      return {
        content,
        sourceFilePath: path,
      };
    }
  }

  for (const candidate of options.availableFiles ?? []) {
    if (
      candidate.format === file.format &&
      hasSourceContent(candidate.content) &&
      normalizeSourceLookupPath(candidate.name) === normalizedTargetPath
    ) {
      return {
        content: candidate.content,
        sourceFilePath: candidate.name,
      };
    }
  }

  return null;
}

function resolveUrdfSourceContent(
  file: RobotFile,
  options: Pick<ResolveRobotFileDataOptions, 'availableFiles' | 'allFileContents'>,
): { content: string; sourceFilePath: string | null; fromContext: boolean } {
  if (hasSourceContent(file.content)) {
    return {
      content: file.content,
      sourceFilePath: null,
      fromContext: false,
    };
  }

  const contextMatch = findContextFileContent(file, options);
  if (contextMatch) {
    return {
      content: contextMatch.content,
      sourceFilePath: contextMatch.sourceFilePath,
      fromContext: true,
    };
  }

  return {
    content: file.content,
    sourceFilePath: null,
    fromContext: false,
  };
}

export function isStandaloneXacroEntry(file: RobotFile): boolean {
  const lowerName = getFileName(file.name).toLowerCase();
  return lowerName === 'robot.xacro' || lowerName.endsWith('.urdf.xacro');
}

export function findStandaloneXacroTruthFile(
  file: RobotFile,
  availableFiles: RobotFile[],
): RobotFile | null {
  if (!isStandaloneXacroEntry(file)) {
    return null;
  }

  const normalizedFileName = normalizeFilePath(file.name);
  const pathParts = normalizedFileName.split('/');
  if (pathParts.length < 3) {
    return null;
  }

  const packageDir = pathParts.slice(0, -2).join('/');
  const packageName = pathParts[pathParts.length - 3] || '';
  const urdfDir = `${packageDir}/urdf/`;

  const candidateTruthFiles = availableFiles.filter((candidate) => {
    if (candidate.format !== 'urdf') {
      return false;
    }

    return normalizeFilePath(candidate.name).startsWith(urdfDir);
  });

  if (candidateTruthFiles.length === 0) {
    return null;
  }

  const preferredFileNames = [
    `${packageName}.urdf`,
    `${packageName.replace(/_description$/i, '')}.urdf`,
    `${getFileName(normalizedFileName).replace(/\.xacro$/i, '')}.urdf`,
  ];

  for (const preferredFileName of preferredFileNames) {
    const match = candidateTruthFiles.find(
      (candidate) => getFileName(candidate.name) === preferredFileName,
    );
    if (match) {
      return match;
    }
  }

  return candidateTruthFiles.length === 1 ? candidateTruthFiles[0] : null;
}

export function isSourceOnlyXacroDocument(urdfContent: string): boolean {
  return /<robot\b/i.test(urdfContent) && !/<link\b/i.test(urdfContent);
}

function shouldValidateMJCFExternalAssets(
  mode: ResolveRobotFileDataOptions['mjcfExternalAssetValidation'],
  resolvedAssetCount: number,
): boolean {
  if (mode === 'always') {
    return true;
  }

  if (mode === 'never') {
    return false;
  }

  return resolvedAssetCount > 0;
}

export function resolveRobotFileData(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
  reportProgress?: RobotImportProgressReporter,
): RobotImportResult {
  const {
    availableFiles = [],
    assets = {},
    allFileContents = {},
    usdRobotData = null,
    mjcfExternalAssetValidation = 'auto',
  } = options;
  const meshTextMaterialAssetPaths = hasTextMeshMaterialInputs(allFileContents)
    ? buildMeshTextMaterialAssetPaths({
        availableFiles,
        assets,
        allFileContents,
      })
    : null;

  try {
    switch (file.format) {
      case 'urdf': {
        emitRobotImportProgress(reportProgress, 15, 'Resolving URDF source');
        const resolvedUrdfSource = resolveUrdfSourceContent(file, {
          availableFiles,
          allFileContents,
        });
        emitRobotImportProgress(reportProgress, 70, 'Parsing URDF');
        const parsed = parseURDF(resolvedUrdfSource.content);
        const resolvedUrdfOptions = resolvedUrdfSource.fromContext
          ? {
              sourceFilePath: resolvedUrdfSource.sourceFilePath ?? file.name,
              resolvedUrdfContent: resolvedUrdfSource.content,
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            }
          : {
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            };
        if (!parsed) {
          return createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
        }

        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
        return createReadyImportResult(file, toRobotData(parsed), resolvedUrdfOptions);
      }
      case 'mjcf': {
        emitRobotImportProgress(reportProgress, 10, 'Resolving MJCF source');
        const resolved = resolveMJCFSource(file, availableFiles);
        if (resolved.issues.length > 0) {
          return createErrorImportResult(
            file,
            'parse_failed',
            buildImportFailureMessage(file, resolved.issues[0]?.detail),
          );
        }

        if (isSourceOnlyMJCFDocument(resolved.content)) {
          return createErrorImportResult(file, 'source_only_fragment');
        }

        emitRobotImportProgress(reportProgress, 45, 'Checking MJCF external assets');
        if (mjcfExternalAssetValidation !== 'never') {
          const assetValidation = inspectMJCFImportExternalAssets(
            resolved.sourceFile.name,
            resolved.content,
            availableFiles,
            assets,
          );
          if (
            shouldValidateMJCFExternalAssets(
              mjcfExternalAssetValidation,
              assetValidation.resolvedAssetCount,
            ) &&
            assetValidation.issues.length > 0
          ) {
            return createErrorImportResult(
              file,
              'parse_failed',
              buildImportFailureMessage(file, assetValidation.issues[0]?.detail),
            );
          }
        }

        emitRobotImportProgress(reportProgress, 80, 'Parsing MJCF');
        const parsed = parseMJCF(resolved.content);
        if (!parsed) {
          return createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
        }

        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
        return createReadyImportResult(file, toRobotData(parsed), {
          sourceFilePath: resolved.sourceFile.name,
          allFileContents,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      }
      case 'sdf': {
        emitRobotImportProgress(reportProgress, 15, 'Resolving SDF context');
        emitRobotImportProgress(reportProgress, 80, 'Parsing SDF');
        const parsed = parseSDF(file.content, {
          allFileContents,
          availableFiles,
          sourcePath: file.name,
        });
        if (!parsed) {
          return createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
        }

        emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
        return createReadyImportResult(file, toRobotData(parsed), {
          allFileContents,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      }
      case 'usd':
        emitRobotImportProgress(
          reportProgress,
          35,
          usdRobotData ? 'Reusing prepared USD robot data' : 'Preparing USD document',
        );
        emitRobotImportProgress(
          reportProgress,
          100,
          usdRobotData ? 'Handing off prepared USD document' : 'Waiting for USD hydration',
        );
        return usdRobotData
          ? createReadyImportResult(file, usdRobotData, {
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            })
          : {
              status: 'needs_hydration',
              format: 'usd',
            };
      case 'xacro': {
        emitRobotImportProgress(reportProgress, 15, 'Resolving Xacro support files');
        const truthFile = findStandaloneXacroTruthFile(file, availableFiles);
        if (truthFile) {
          emitRobotImportProgress(reportProgress, 45, 'Checking companion URDF');
          const truthRobot = parseURDF(truthFile.content);
          if (truthRobot) {
            emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
            return createReadyImportResult(file, toRobotData(truthRobot), {
              sourceFilePath: truthFile.name,
              resolvedUrdfContent: truthFile.content,
              allFileContents,
              ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
            });
          }
        }

        const fileMap: Record<string, string> = {};
        availableFiles.forEach((candidate) => {
          fileMap[candidate.name] = candidate.content;
        });
        Object.entries(allFileContents).forEach(([path, content]) => {
          if (typeof content === 'string') {
            fileMap[path] = content;
          }
        });
        Object.entries(assets).forEach(([path, content]) => {
          if (typeof content === 'string') {
            fileMap[path] = content;
          }
        });
        const pathParts = file.name.split('/');
        pathParts.pop();
        emitRobotImportProgress(reportProgress, 55, 'Expanding Xacro');
        const urdfContent = processXacro(file.content, {}, fileMap, pathParts.join('/'));
        emitRobotImportProgress(reportProgress, 80, 'Parsing generated URDF');
        const parsed = parseURDF(urdfContent);
        if (parsed) {
          emitRobotImportProgress(reportProgress, 100, 'Finalizing robot document');
          return createReadyImportResult(file, toRobotData(parsed), {
            resolvedUrdfContent: urdfContent,
            allFileContents,
            ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
          });
        }

        return createErrorImportResult(
          file,
          isSourceOnlyXacroDocument(urdfContent) ? 'source_only_fragment' : 'parse_failed',
          buildImportFailureMessage(file),
        );
      }
      case 'mesh':
        emitRobotImportProgress(reportProgress, 100, 'Preparing mesh preview');
        return createReadyImportResult(file, createMeshRobotData(file), {
          allFileContents,
          ...(meshTextMaterialAssetPaths ? { assetPaths: meshTextMaterialAssetPaths } : {}),
        });
      case 'asset':
        return createErrorImportResult(
          file,
          'unsupported_format',
          buildImportFailureMessage(file, 'Generic asset files are stored in the library only.'),
        );
      default:
        return createErrorImportResult(
          file,
          'unsupported_format',
          buildImportFailureMessage(file, 'Unsupported robot file format.'),
        );
    }
  } catch (error) {
    console.error(`[importRobotFile] Failed to resolve robot file "${file.name}":`, error);
    return createErrorImportResult(
      file,
      'parse_failed',
      buildImportFailureMessage(
        file,
        error instanceof Error ? error.message : 'Unexpected import error.',
      ),
    );
  }
}
