import {
  DEFAULT_LINK,
  GeometryType,
  type RobotData,
  type RobotFile,
  type RobotState,
} from '@/types';
import { parseURDF } from './urdf/parser';
import { parseMJCF } from './mjcf/mjcfParser';
import { resolveMJCFSource } from './mjcf/mjcfSourceResolver';
import { parseSDF } from './sdf/sdfParser';
import { processXacro } from './xacro/xacroParser';
import { rewriteRobotMeshPathsForSource } from './meshPathUtils';
import { syncRobotVisualColorsFromMaterials } from '@/core/robot/materials';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import { isSourceOnlyMJCFDocument } from './mjcf/mjcfXml';
import { validateMJCFImportExternalAssets } from './mjcf/mjcfImportValidation';

export interface ResolveRobotFileDataOptions {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  usdRobotData?: RobotData | null;
  mjcfExternalAssetValidation?: 'auto' | 'always' | 'never';
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
  } = {},
): RobotImportResult {
  const { sourceFilePath = file.name, resolvedUrdfContent = null } = options;

  return {
    status: 'ready',
    format: file.format,
    robotData: syncRobotVisualColorsFromMaterials(
      rewriteRobotMeshPathsForSource(robotData, sourceFilePath),
    ),
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
  assets: Record<string, string>,
): boolean {
  if (mode === 'always') {
    return true;
  }

  if (mode === 'never') {
    return false;
  }

  return Object.keys(assets).length > 0;
}

export function resolveRobotFileData(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
): RobotImportResult {
  const {
    availableFiles = [],
    assets = {},
    allFileContents = {},
    usdRobotData = null,
    mjcfExternalAssetValidation = 'auto',
  } = options;

  try {
    switch (file.format) {
      case 'urdf': {
        const resolvedUrdfSource = resolveUrdfSourceContent(file, {
          availableFiles,
          allFileContents,
        });
        const parsed = parseURDF(resolvedUrdfSource.content);
        const resolvedUrdfOptions = resolvedUrdfSource.fromContext
          ? {
              sourceFilePath: resolvedUrdfSource.sourceFilePath ?? file.name,
              resolvedUrdfContent: resolvedUrdfSource.content,
            }
          : undefined;
        return parsed
          ? createReadyImportResult(file, toRobotData(parsed), resolvedUrdfOptions)
          : createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
      }
      case 'mjcf': {
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

        if (shouldValidateMJCFExternalAssets(mjcfExternalAssetValidation, assets)) {
          const assetIssues = validateMJCFImportExternalAssets(
            resolved.sourceFile.name,
            resolved.content,
            availableFiles,
            assets,
          );
          if (assetIssues.length > 0) {
            return createErrorImportResult(
              file,
              'parse_failed',
              buildImportFailureMessage(file, assetIssues[0]?.detail),
            );
          }
        }

        const parsed = parseMJCF(resolved.content);
        return parsed
          ? createReadyImportResult(file, toRobotData(parsed))
          : createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
      }
      case 'sdf': {
        const parsed = parseSDF(file.content, {
          allFileContents,
          sourcePath: file.name,
        });
        return parsed
          ? createReadyImportResult(file, toRobotData(parsed))
          : createErrorImportResult(file, 'parse_failed', buildImportFailureMessage(file));
      }
      case 'usd':
        return usdRobotData
          ? createReadyImportResult(file, usdRobotData)
          : {
              status: 'needs_hydration',
              format: 'usd',
            };
      case 'xacro': {
        const truthFile = findStandaloneXacroTruthFile(file, availableFiles);
        if (truthFile) {
          const truthRobot = parseURDF(truthFile.content);
          if (truthRobot) {
            return createReadyImportResult(file, toRobotData(truthRobot), {
              sourceFilePath: truthFile.name,
              resolvedUrdfContent: truthFile.content,
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
        const urdfContent = processXacro(file.content, {}, fileMap, pathParts.join('/'));
        const parsed = parseURDF(urdfContent);
        if (parsed) {
          return createReadyImportResult(file, toRobotData(parsed), {
            resolvedUrdfContent: urdfContent,
          });
        }

        return createErrorImportResult(
          file,
          isSourceOnlyXacroDocument(urdfContent) ? 'source_only_fragment' : 'parse_failed',
          buildImportFailureMessage(file),
        );
      }
      case 'mesh':
        return createReadyImportResult(file, createMeshRobotData(file));
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
