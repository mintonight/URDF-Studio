import {
  AssemblyState,
  BridgeJoint,
  GeometryType,
  JointType,
  RobotData,
  RobotFile,
  UsdPreparedExportCache,
  UrdfLink,
} from '@/types';
import { generateMujocoXML, generateURDF } from '@/core/parsers';
import { normalizeMeshPathForExport, resolveMeshAssetUrl } from '@/core/parsers/meshPathUtils';
import { generateBOM } from './bomGenerator';
import { prepareMjcfMeshExportAssets } from './mjcfMeshExport';
import {
  buildAssetArchivePath,
  buildLibraryArchivePath,
  chooseCanonicalLogicalPath,
  ensureUniqueLogicalPath,
  normalizeArchivePath,
  PROJECT_ALL_FILE_CONTENTS_FILE,
  PROJECT_ASSEMBLY_HISTORY_FILE,
  PROJECT_ASSET_MANIFEST_FILE,
  PROJECT_MOTOR_LIBRARY_FILE,
  PROJECT_ORIGINAL_URDF_FILE,
  PROJECT_ROBOT_HISTORY_FILE,
  PROJECT_USD_PREPARED_EXPORT_CACHES_FILE,
  PROJECT_VERSION,
} from './projectArchive';
import { buildUsdPreparedExportCacheEntries } from './projectUsdPreparedExportCaches';
import { buildProjectArchiveBlob } from './projectArchiveZip';
import { buildProjectArchiveBlobWithWorker } from './projectArchiveWorkerBridge';
import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer';
import {
  stripTransientJointMotionFromJoint,
  stripTransientJointMotionFromRobotData,
} from '@/shared/utils/robot/semanticSnapshot';
import { getVisualGeometryEntries } from '@/core/robot';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';

const AXIS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const FULL_LIMIT_EXPORT_TYPES = new Set<JointType>([JointType.REVOLUTE, JointType.PRISMATIC]);

const EFFORT_VELOCITY_LIMIT_EXPORT_TYPES = new Set<JointType>([JointType.CONTINUOUS]);
const DYNAMICS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const USP_README_EN = `# URDF Studio Project (.usp) File Format

The .usp file is a ZIP-compressed package that contains the full URDF Studio workspace state.

## Directory Structure
- project.json: Project manifest, UI state, and workspace pointers.
- components/: Self-contained assembly components.
- assets/: Packed project asset blobs and manifest.
- library/: Asset library source files and extra text content.
- history/: Undo/redo checkpoints and change logs.
- bridges/: Multi-robot assembly connection data.
- output/: Auto-generated export artifacts.
`;

const USP_README_ZH = `# URDF Studio 工程文件 (.usp) 格式说明

.usp 文件是一个 ZIP 压缩包，包含 URDF Studio 的完整工程状态。

## 目录结构
- project.json: 工程清单、UI 状态和工作区指针。
- components/: 自包含的装配组件。
- assets/: 打包后的工程素材及清单。
- library/: 素材库源文件与额外文本内容。
- history/: 撤销/重做快照与变更日志。
- bridges/: 多机器人装配连接数据。
- output/: 自动生成的导出产物。
`;

const COMPONENT_README_EN = `# URDF Studio Component Format

A component folder is a self-contained robot definition.

## Directory Structure
- model.urdf: Original robot description.
- state.json: JSON snapshot of the component's RobotData.
- meshes/: Component-specific 3D assets.
`;

const COMPONENT_README_ZH = `# URDF Studio 组件格式说明

组件文件夹是一个自包含的机器人定义。

## 目录结构
- model.urdf: 原始机器人描述文件。
- state.json: 组件 RobotData 的当前状态快照。
- meshes/: 组件专用的 3D 资源。
`;

type ProjectActivityEntry = {
  id: string;
  timestamp: string;
  label: string;
};

type ProjectHistorySnapshot<T> = {
  present: T;
  past: T[];
  future: T[];
  activity: ProjectActivityEntry[];
};

const MAX_HISTORY = 50;
const MAX_ACTIVITY_LOG = 200;

const clampHistoryEntries = <T>(entries: T[] | undefined): T[] =>
  (entries ?? []).slice(-MAX_HISTORY);
const clampFutureEntries = <T>(entries: T[] | undefined): T[] =>
  (entries ?? []).slice(0, MAX_HISTORY);

type ProjectAssetEntry = {
  logicalPath: string;
  archivePath: string;
};

type ProjectArchiveEntries = Map<string, ProjectArchiveEntryData>;

const STRICT_PROJECT_LIBRARY_SOURCE_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'mjcf',
  'xacro',
  'sdf',
]);

export type ProjectExportWarningCode =
  | 'project_mesh_asset_missing'
  | 'project_mesh_package_failed'
  | 'project_asset_pack_failed'
  | 'project_component_mesh_asset_missing'
  | 'project_component_mesh_package_failed';

export interface ProjectExportWarning {
  code: ProjectExportWarningCode;
  message: string;
  context?: Record<string, string>;
}

export type ProjectExportProgressPhase =
  | 'assets'
  | 'metadata'
  | 'components'
  | 'output'
  | 'archive';

export interface ProjectExportProgress {
  phase: ProjectExportProgressPhase;
  completed: number;
  total: number;
  label?: string;
}

export interface ExportProjectResult {
  blob: Blob;
  partial: boolean;
  warnings: ProjectExportWarning[];
}

type ProjectPhaseProgressReporter = (progress: {
  completed: number;
  total: number;
  label?: string;
}) => void;

export interface ProjectManifest {
  version: string;
  name: string;
  lastModified: string;
  ui: Record<string, never>;
  workspace?: {
    selectedFile: string | null;
  };
  assets: {
    availableFiles: { name: string; format: string }[];
    originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
    assetEntries?: ProjectAssetEntry[];
    allFileContentsFile?: string;
    motorLibraryFile?: string;
    originalUrdfContentFile?: string;
  };
  history?: {
    robotFile?: string;
    assemblyFile?: string;
  };
  assembly?: {
    name: string;
    transform?: AssemblyState['transform'];
    components: Record<
      string,
      {
        id: string;
        name: string;
        sourceFile: string;
        transform?: AssemblyState['components'][string]['transform'];
        visible: boolean;
      }
    >;
  };
}

const normalizeActivityLog = (
  activity: Array<{ id?: string; timestamp?: string; label?: string }> | undefined,
): ProjectActivityEntry[] =>
  (activity ?? []).slice(-MAX_ACTIVITY_LOG).map((entry, index) => ({
    id: entry.id ?? `activity_${index}`,
    timestamp: entry.timestamp ?? new Date(0).toISOString(),
    label: entry.label ?? 'Unknown change',
  }));

const generateBridgeXml = (bridges: Record<string, BridgeJoint>): string => {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<bridges>\n';

  Object.values(bridges).forEach((bridge) => {
    const { joint } = bridge;
    xml += `  <bridge id="${bridge.id}" name="${bridge.name}" `;
    xml += `parent_comp="${bridge.parentComponentId}" parent_link="${bridge.parentLinkId}" `;
    xml += `child_comp="${bridge.childComponentId}" child_link="${bridge.childLinkId}">\n`;
    xml += `    <joint name="${joint.name}" type="${joint.type}">\n`;
    const quatAttr = joint.origin.quatXyzw
      ? ` quat_xyzw="${joint.origin.quatXyzw.x} ${joint.origin.quatXyzw.y} ${joint.origin.quatXyzw.z} ${joint.origin.quatXyzw.w}"`
      : '';
    xml += `      <origin xyz="${joint.origin.xyz.x} ${joint.origin.xyz.y} ${joint.origin.xyz.z}" `;
    xml += `rpy="${joint.origin.rpy.r} ${joint.origin.rpy.p} ${joint.origin.rpy.y}"${quatAttr} />\n`;

    if (AXIS_EXPORT_TYPES.has(joint.type) && joint.axis) {
      xml += `      <axis xyz="${joint.axis.x} ${joint.axis.y} ${joint.axis.z}" />\n`;

      if (FULL_LIMIT_EXPORT_TYPES.has(joint.type) && joint.limit) {
        xml += `      <limit lower="${joint.limit.lower}" upper="${joint.limit.upper}" effort="${joint.limit.effort}" velocity="${joint.limit.velocity}" />\n`;
      } else if (EFFORT_VELOCITY_LIMIT_EXPORT_TYPES.has(joint.type) && joint.limit) {
        xml += `      <limit effort="${joint.limit.effort}" velocity="${joint.limit.velocity}" />\n`;
      }
    }

    if (
      DYNAMICS_EXPORT_TYPES.has(joint.type) &&
      joint.dynamics &&
      (joint.dynamics.damping !== 0 || joint.dynamics.friction !== 0)
    ) {
      xml += `      <dynamics damping="${joint.dynamics.damping}" friction="${joint.dynamics.friction}" />\n`;
    }

    if (joint.hardware?.hardwareInterface) {
      xml += '      <hardware>\n';
      xml += `        <hardwareInterface>${joint.hardware.hardwareInterface}</hardwareInterface>\n`;
      xml += '      </hardware>\n';
    }

    if (joint.mimic?.joint) {
      const mimicAttributes = [`joint="${joint.mimic.joint}"`];
      if (typeof joint.mimic.multiplier === 'number' && Number.isFinite(joint.mimic.multiplier)) {
        mimicAttributes.push(`multiplier="${joint.mimic.multiplier}"`);
      }
      if (typeof joint.mimic.offset === 'number' && Number.isFinite(joint.mimic.offset)) {
        mimicAttributes.push(`offset="${joint.mimic.offset}"`);
      }
      xml += `      <mimic ${mimicAttributes.join(' ')} />\n`;
    }

    xml += '    </joint>\n';
    xml += '  </bridge>\n';
  });

  xml += '</bridges>';
  return xml;
};

const getReferencedMeshes = (robot: RobotData): Set<string> => {
  const referencedFiles = new Set<string>();

  Object.values(robot.links).forEach((link: UrdfLink) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referencedFiles.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referencedFiles.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referencedFiles.add(body.meshPath);
      }
    });
  });

  return referencedFiles;
};

const formatProjectProgressLabel = (value: string | null | undefined): string => {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return segments.join('/');
  }

  return segments.slice(-2).join('/');
};

const joinArchivePath = (...segments: Array<string | null | undefined>): string =>
  normalizeArchivePath(
    segments.filter((segment) => typeof segment === 'string' && segment.length > 0).join('/'),
  );

const setProjectArchiveEntry = (
  archiveEntries: ProjectArchiveEntries,
  archivePath: string,
  data: ProjectArchiveEntryData,
): void => {
  archiveEntries.set(normalizeArchivePath(archivePath), data);
};

const writeReferencedMeshesToFolder = async (
  archiveEntries: ProjectArchiveEntries,
  folderPath: string,
  robot: RobotData,
  assets: Record<string, string>,
  skipMeshPaths?: ReadonlySet<string>,
  onProgress?: ProjectPhaseProgressReporter,
): Promise<ProjectExportWarning[]> => {
  const writtenPaths = new Set<string>();
  const warnings: ProjectExportWarning[] = [];
  const meshPaths = Array.from(getReferencedMeshes(robot)).filter(
    (meshPath) => !skipMeshPaths?.has(meshPath),
  );
  const totalMeshes = meshPaths.length;
  let completedMeshes = 0;

  if (totalMeshes > 0) {
    onProgress?.({
      completed: 0,
      total: totalMeshes,
      label: formatProjectProgressLabel(meshPaths[0]),
    });
  }

  await Promise.all(
    meshPaths.map(async (meshPath) => {
      const exportPath = normalizeMeshPathForExport(meshPath);
      if (!exportPath || writtenPaths.has(exportPath)) {
        completedMeshes += 1;
        onProgress?.({
          completed: completedMeshes,
          total: totalMeshes,
          label: formatProjectProgressLabel(meshPath),
        });
        return;
      }
      writtenPaths.add(exportPath);

      const blobUrl = resolveMeshAssetUrl(meshPath, assets);
      try {
        if (!blobUrl) {
          warnings.push({
            code: 'project_mesh_asset_missing',
            message: `Missing mesh asset for project export: ${meshPath}`,
            context: {
              meshPath,
              exportPath,
            },
          });
          return;
        }

        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        setProjectArchiveEntry(archiveEntries, joinArchivePath(folderPath, exportPath), blob);
      } catch (error) {
        console.error(`[ProjectExport] Failed to package mesh "${meshPath}"`, error);
        warnings.push({
          code: 'project_mesh_package_failed',
          message: `Failed to package mesh "${meshPath}": ${error instanceof Error ? error.message : String(error)}`,
          context: {
            meshPath,
            exportPath,
          },
        });
      } finally {
        completedMeshes += 1;
        onProgress?.({
          completed: completedMeshes,
          total: totalMeshes,
          label: formatProjectProgressLabel(meshPath),
        });
      }
    }),
  );

  return warnings;
};

const assertNoProjectExportWarnings = (warnings: ProjectExportWarning[]): void => {
  const [firstWarning] = warnings;
  if (!firstWarning) {
    return;
  }

  throw new Error(firstWarning.message);
};

const stripTransientAssemblyState = (state: AssemblyState | null): AssemblyState | null => {
  if (!state) return null;
  const clone = structuredClone(state);
  Object.values(clone.components).forEach((component) => {
    component.robot = stripTransientJointMotionFromRobotData(component.robot);
  });
  Object.values(clone.bridges).forEach((bridge) => {
    bridge.joint = stripTransientJointMotionFromJoint(bridge.joint) as BridgeJoint['joint'];
  });
  return clone;
};

const writeTextLibraryFiles = (
  archiveEntries: ProjectArchiveEntries,
  availableFiles: RobotFile[],
  assetMap: Record<string, string>,
  allFileContents: Record<string, string>,
): void => {
  availableFiles.forEach((file) => {
    if (file.format === 'mesh') return;
    const content = file.content || allFileContents[file.name] || '';
    if (content.length === 0) {
      const normalizedName = file.name.replace(/^\/+/, '');
      const hasBlobBackedUsdSource =
        file.format === 'usd' &&
        Boolean(file.blobUrl || assetMap[normalizedName] || assetMap[`/${normalizedName}`]);

      if (STRICT_PROJECT_LIBRARY_SOURCE_FORMATS.has(file.format) || !hasBlobBackedUsdSource) {
        throw new Error(`Missing library source content for project export: ${file.name}`);
      }
    }
    setProjectArchiveEntry(archiveEntries, buildLibraryArchivePath(file.name), content);
  });
};

const writePackedAssets = async (
  archiveEntries: ProjectArchiveEntries,
  assetMap: Record<string, string>,
  onProgress?: ProjectPhaseProgressReporter,
): Promise<{ assetEntries: ProjectAssetEntry[]; warnings: ProjectExportWarning[] }> => {
  const urlToKeys = new Map<string, string[]>();
  Object.entries(assetMap).forEach(([key, url]) => {
    if (!url) return;
    const existingKeys = urlToKeys.get(url) ?? [];
    existingKeys.push(key);
    urlToKeys.set(url, existingKeys);
  });

  const usedLogicalPaths = new Set<string>();
  const assetEntries: ProjectAssetEntry[] = [];
  const warnings: ProjectExportWarning[] = [];
  const assetJobs = Array.from(urlToKeys.entries());
  const totalAssets = assetJobs.length;
  let completedAssets = 0;

  if (totalAssets > 0) {
    onProgress?.({
      completed: 0,
      total: totalAssets,
      label: formatProjectProgressLabel(assetJobs[0]?.[1]?.[0] ?? assetJobs[0]?.[0]),
    });
  }

  await Promise.all(
    assetJobs.map(async ([url, keys], index) => {
      try {
        const fallbackName = keys.find((key) => /\.[a-z0-9]+$/i.test(key)) ?? `asset_${index}`;
        const canonicalPath = chooseCanonicalLogicalPath(keys, fallbackName);
        const logicalPath = ensureUniqueLogicalPath(canonicalPath, usedLogicalPaths, fallbackName);
        const archivePath = buildAssetArchivePath(logicalPath);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        setProjectArchiveEntry(archiveEntries, archivePath, blob);
        assetEntries.push({ logicalPath, archivePath });
      } catch (error) {
        console.error('[ProjectExport] Failed to pack asset', keys[0] ?? url, error);
        warnings.push({
          code: 'project_asset_pack_failed',
          message: `Failed to pack asset "${keys[0] ?? url}": ${error instanceof Error ? error.message : String(error)}`,
          context: {
            key: keys[0] ?? url,
          },
        });
      } finally {
        completedAssets += 1;
        onProgress?.({
          completed: completedAssets,
          total: totalAssets,
          label: formatProjectProgressLabel(keys[0] ?? url),
        });
      }
    }),
  );

  assetEntries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ASSET_MANIFEST_FILE,
    JSON.stringify(assetEntries, null, 2),
  );
  return {
    assetEntries,
    warnings,
  };
};

export interface ExportProjectParams {
  name: string;
  uiState: {
    appMode: string;
    lang: string;
  };
  assetsState: {
    availableFiles: RobotFile[];
    assets: Record<string, string>;
    allFileContents: Record<string, string>;
    motorLibrary: Record<string, unknown>;
    selectedFileName: string | null;
    originalUrdfContent: string;
    originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
    usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  };
  robotState: {
    present: RobotData;
    history: { past: RobotData[]; future: RobotData[] };
    activity: Array<{ id?: string; timestamp?: string; label?: string }>;
  };
  assemblyState: {
    present: AssemblyState | null;
    history: { past: Array<AssemblyState | null>; future: Array<AssemblyState | null> };
    activity: Array<{ id?: string; timestamp?: string; label?: string }>;
  };
  getMergedRobotData: () => RobotData | null;
  onProgress?: (progress: ProjectExportProgress) => void;
}

async function buildProjectArchiveEntries(params: ExportProjectParams): Promise<{
  archiveEntries: ProjectArchiveEntries;
  warnings: ProjectExportWarning[];
}> {
  const { name, uiState, assetsState, robotState, assemblyState, getMergedRobotData, onProgress } =
    params;

  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const archiveEntries: ProjectArchiveEntries = new Map();
  const warnings: ProjectExportWarning[] = [];
  const currentAssembly = stripTransientAssemblyState(assemblyState.present);
  const currentRobot = stripTransientJointMotionFromRobotData(robotState.present);
  const packedAssets = await writePackedAssets(
    archiveEntries,
    assetsState.assets,
    ({ completed, total, label }) => {
      emitPhaseProgress('assets', completed, total, label);
    },
  );
  warnings.push(...packedAssets.warnings);
  assertNoProjectExportWarnings(packedAssets.warnings);
  const assetEntries = packedAssets.assetEntries;

  const metadataProgressTotal = 5;
  emitPhaseProgress(
    'metadata',
    0,
    metadataProgressTotal,
    assetsState.availableFiles[0]?.name ?? PROJECT_ALL_FILE_CONTENTS_FILE,
  );
  writeTextLibraryFiles(
    archiveEntries,
    assetsState.availableFiles,
    assetsState.assets,
    assetsState.allFileContents,
  );
  emitPhaseProgress(
    'metadata',
    1,
    metadataProgressTotal,
    assetsState.availableFiles[0]?.name ?? PROJECT_ALL_FILE_CONTENTS_FILE,
  );
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ALL_FILE_CONTENTS_FILE,
    JSON.stringify(assetsState.allFileContents, null, 2),
  );
  emitPhaseProgress('metadata', 2, metadataProgressTotal, PROJECT_ALL_FILE_CONTENTS_FILE);
  const usdPreparedExportCacheEntries = await buildUsdPreparedExportCacheEntries(
    assetsState.usdPreparedExportCaches,
  );
  usdPreparedExportCacheEntries.forEach((entry, path) => {
    setProjectArchiveEntry(archiveEntries, path, entry);
  });
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_MOTOR_LIBRARY_FILE,
    JSON.stringify(assetsState.motorLibrary, null, 2),
  );
  emitPhaseProgress('metadata', 3, metadataProgressTotal, PROJECT_USD_PREPARED_EXPORT_CACHES_FILE);

  if (assetsState.originalUrdfContent) {
    setProjectArchiveEntry(
      archiveEntries,
      PROJECT_ORIGINAL_URDF_FILE,
      assetsState.originalUrdfContent,
    );
  }

  const serializedRobotHistory: ProjectHistorySnapshot<RobotData> = {
    present: currentRobot,
    past: clampHistoryEntries(robotState.history.past).map((snapshot) =>
      stripTransientJointMotionFromRobotData(snapshot),
    ),
    future: clampFutureEntries(robotState.history.future).map((snapshot) =>
      stripTransientJointMotionFromRobotData(snapshot),
    ),
    activity: normalizeActivityLog(robotState.activity),
  };
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ROBOT_HISTORY_FILE,
    JSON.stringify(serializedRobotHistory, null, 2),
  );

  const serializedAssemblyHistory: ProjectHistorySnapshot<AssemblyState | null> = {
    present: currentAssembly,
    past: clampHistoryEntries(assemblyState.history.past).map((snapshot) =>
      stripTransientAssemblyState(snapshot),
    ),
    future: clampFutureEntries(assemblyState.history.future).map((snapshot) =>
      stripTransientAssemblyState(snapshot),
    ),
    activity: normalizeActivityLog(assemblyState.activity),
  };
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ASSEMBLY_HISTORY_FILE,
    JSON.stringify(serializedAssemblyHistory, null, 2),
  );
  emitPhaseProgress('metadata', 4, metadataProgressTotal, PROJECT_ASSEMBLY_HISTORY_FILE);

  const manifest: ProjectManifest = {
    version: PROJECT_VERSION,
    name: name || 'unnamed_project',
    lastModified: new Date().toISOString(),
    ui: {},
    workspace: {
      selectedFile: assetsState.selectedFileName,
    },
    assets: {
      availableFiles: assetsState.availableFiles.map((file) => ({
        name: file.name,
        format: file.format,
      })),
      originalFileFormat: assetsState.originalFileFormat,
      assetEntries,
      allFileContentsFile: PROJECT_ALL_FILE_CONTENTS_FILE,
      motorLibraryFile: PROJECT_MOTOR_LIBRARY_FILE,
      originalUrdfContentFile: assetsState.originalUrdfContent
        ? PROJECT_ORIGINAL_URDF_FILE
        : undefined,
    },
    history: {
      robotFile: PROJECT_ROBOT_HISTORY_FILE,
      assemblyFile: PROJECT_ASSEMBLY_HISTORY_FILE,
    },
    assembly: currentAssembly
      ? {
          name: currentAssembly.name,
          transform: currentAssembly.transform,
          components: Object.fromEntries(
            Object.entries(currentAssembly.components).map(([id, component]) => [
              id,
              {
                id: component.id,
                name: component.name,
                sourceFile: component.sourceFile,
                transform: component.transform,
                visible: component.visible !== false,
              },
            ]),
          ),
        }
      : undefined,
  };

  setProjectArchiveEntry(archiveEntries, 'project.json', JSON.stringify(manifest, null, 2));
  setProjectArchiveEntry(archiveEntries, 'README.md', USP_README_EN);
  setProjectArchiveEntry(archiveEntries, 'README_ZH.md', USP_README_ZH);
  emitPhaseProgress('metadata', 5, metadataProgressTotal, 'project.json');

  if (currentAssembly) {
    const componentPlans = Object.values(currentAssembly.components).map((component) => ({
      component,
      meshPaths: Array.from(getReferencedMeshes(component.robot)),
    }));
    const totalComponentTasks = componentPlans.reduce(
      (sum, plan) => sum + 1 + plan.meshPaths.length,
      0,
    );
    const componentAssetTasks: Promise<void>[] = [];
    let completedComponentTasks = 0;

    if (totalComponentTasks > 0) {
      emitPhaseProgress(
        'components',
        0,
        totalComponentTasks,
        componentPlans[0]?.component.name ?? componentPlans[0]?.component.id ?? 'components',
      );
    }

    componentPlans.forEach(({ component, meshPaths }) => {
      const componentFolderPath = joinArchivePath('components', component.id);

      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'state.json'),
        JSON.stringify(component.robot, null, 2),
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'README.md'),
        COMPONENT_README_EN,
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'README_ZH.md'),
        COMPONENT_README_ZH,
      );

      const sourceFile = assetsState.availableFiles.find(
        (file) => file.name === component.sourceFile,
      );
      const sourceContent =
        sourceFile?.content || assetsState.allFileContents[component.sourceFile] || '';
      if (!sourceFile || sourceContent.length === 0) {
        throw new Error(
          `Missing component source content for project export: ${component.sourceFile}`,
        );
      }
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, sourceFile.name.split('/').pop() || 'model.urdf'),
        sourceContent,
      );
      completedComponentTasks += 1;
      emitPhaseProgress(
        'components',
        completedComponentTasks,
        Math.max(totalComponentTasks, 1),
        component.name || component.id,
      );

      if (meshPaths.length === 0) return;

      meshPaths.forEach((meshPath) => {
        const blobUrl = assetsState.assets[meshPath];
        if (!blobUrl) {
          warnings.push({
            code: 'project_component_mesh_asset_missing',
            message: `Missing component mesh asset "${meshPath}" for ${component.id}`,
            context: {
              componentId: component.id,
              meshPath,
            },
          });
          completedComponentTasks += 1;
          emitPhaseProgress(
            'components',
            completedComponentTasks,
            Math.max(totalComponentTasks, 1),
            meshPath,
          );
          return;
        }
        const task = fetch(blobUrl)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            return response.blob();
          })
          .then(async (blob) => {
            setProjectArchiveEntry(
              archiveEntries,
              joinArchivePath(componentFolderPath, 'meshes', meshPath.split('/').pop() || meshPath),
              blob,
            );
          })
          .catch((error) => {
            console.error(
              `[ProjectExport] Failed to package component mesh "${meshPath}" for ${component.id}`,
              error,
            );
            warnings.push({
              code: 'project_component_mesh_package_failed',
              message: `Failed to package component mesh "${meshPath}" for ${component.id}: ${error instanceof Error ? error.message : String(error)}`,
              context: {
                componentId: component.id,
                meshPath,
              },
            });
          })
          .finally(() => {
            completedComponentTasks += 1;
            emitPhaseProgress(
              'components',
              completedComponentTasks,
              Math.max(totalComponentTasks, 1),
              meshPath,
            );
          });
        componentAssetTasks.push(task);
      });
    });

    if (totalComponentTasks === 0) {
      emitPhaseProgress('components', 1, 1, 'components');
    }

    await Promise.all(componentAssetTasks);
    assertNoProjectExportWarnings(warnings);
  } else {
    const mergedRobot = currentAssembly
      ? buildExportableAssemblyRobotData(currentAssembly)
      : (getMergedRobotData() ?? robotState.present);

    if (mergedRobot) {
      const mainRobotFolderPath = joinArchivePath('components', 'main_robot');
      const totalComponentTasks = 1 + getReferencedMeshes(mergedRobot).size;
      emitPhaseProgress('components', 0, totalComponentTasks, mergedRobot.name || 'main_robot');

      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(mainRobotFolderPath, 'state.json'),
        JSON.stringify(mergedRobot, null, 2),
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(mainRobotFolderPath, 'README.md'),
        COMPONENT_README_EN,
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(mainRobotFolderPath, 'README_ZH.md'),
        COMPONENT_README_ZH,
      );
      emitPhaseProgress('components', 1, totalComponentTasks, mergedRobot.name || 'main_robot');

      const meshWarnings = await writeReferencedMeshesToFolder(
        archiveEntries,
        joinArchivePath(mainRobotFolderPath, 'meshes'),
        mergedRobot,
        assetsState.assets,
        undefined,
        ({ completed, total, label }) => {
          emitPhaseProgress('components', 1 + completed, totalComponentTasks, label);
        },
      );
      warnings.push(...meshWarnings);
      assertNoProjectExportWarnings(meshWarnings);

      assetsState.availableFiles.forEach((file) => {
        const content = file.content || assetsState.allFileContents[file.name] || '';
        if (content.length === 0) return;
        setProjectArchiveEntry(archiveEntries, joinArchivePath('components', file.name), content);
      });
    }
  }

  if (currentAssembly && Object.keys(currentAssembly.bridges).length > 0) {
    setProjectArchiveEntry(
      archiveEntries,
      'bridges/bridge.xml',
      generateBridgeXml(currentAssembly.bridges),
    );
  }

  const mergedRobot = currentAssembly
    ? buildExportableAssemblyRobotData(currentAssembly)
    : (getMergedRobotData() ?? robotState.present);
  if (mergedRobot) {
    emitPhaseProgress('output', 0, 1, mergedRobot.name);
    const robotForExport = {
      ...mergedRobot,
      selection: { type: null, id: null },
    } as RobotData & { selection: { type: null; id: null } };
    const mjcfMeshExport = await prepareMjcfMeshExportAssets({
      robot: robotForExport,
      assets: assetsState.assets,
    });
    const outputMeshCount = Array.from(getReferencedMeshes(mergedRobot)).filter(
      (meshPath) => !mjcfMeshExport.convertedSourceMeshPaths.has(meshPath),
    ).length;
    const totalOutputTasks = 4 + outputMeshCount + mjcfMeshExport.archiveFiles.size;
    let completedOutputTasks = 0;

    emitPhaseProgress('output', 0, totalOutputTasks, `${mergedRobot.name}.urdf`);

    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}.urdf`),
      generateURDF(robotForExport, false),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, `${mergedRobot.name}.urdf`);
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}_extended.urdf`),
      generateURDF(robotForExport, true),
    );
    completedOutputTasks += 1;
    emitPhaseProgress(
      'output',
      completedOutputTasks,
      totalOutputTasks,
      `${mergedRobot.name}_extended.urdf`,
    );
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}.xml`),
      generateMujocoXML(robotForExport, {
        meshdir: 'meshes/',
        meshPathOverrides: mjcfMeshExport.meshPathOverrides,
        visualMeshVariants: mjcfMeshExport.visualMeshVariants,
      }),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, `${mergedRobot.name}.xml`);
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', 'bom.csv'),
      generateBOM(robotForExport, uiState.lang as 'en' | 'zh'),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, 'bom.csv');

    const outputMeshWarnings = await writeReferencedMeshesToFolder(
      archiveEntries,
      joinArchivePath('output', 'meshes'),
      mergedRobot,
      assetsState.assets,
      mjcfMeshExport.convertedSourceMeshPaths,
      ({ completed, label }) => {
        emitPhaseProgress('output', completedOutputTasks + completed, totalOutputTasks, label);
      },
    );
    warnings.push(...outputMeshWarnings);
    assertNoProjectExportWarnings(outputMeshWarnings);
    completedOutputTasks += outputMeshCount;
    await Promise.all(
      Array.from(mjcfMeshExport.archiveFiles.entries()).map(async ([relativePath, blob]) => {
        setProjectArchiveEntry(
          archiveEntries,
          joinArchivePath('output', 'meshes', relativePath),
          blob,
        );
        completedOutputTasks += 1;
        emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, relativePath);
      }),
    );
  }

  return {
    archiveEntries,
    warnings,
  };
}

export async function exportProject(params: ExportProjectParams): Promise<ExportProjectResult> {
  const { name, onProgress } = params;
  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const { archiveEntries, warnings } = await buildProjectArchiveEntries(params);
  emitPhaseProgress('archive', 0, 100);
  const blob = await buildProjectArchiveBlob(archiveEntries, {
    onProgress: ({ completed, total, label }) => {
      emitPhaseProgress('archive', completed, total, label);
    },
  });
  emitPhaseProgress('archive', 100, 100, `${name || 'project'}.usp`);

  return {
    blob,
    partial: false,
    warnings,
  };
}

export async function exportProjectWithWorker(
  params: ExportProjectParams,
): Promise<ExportProjectResult> {
  const { name, onProgress } = params;
  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const { archiveEntries, warnings } = await buildProjectArchiveEntries(params);
  emitPhaseProgress('archive', 0, 100);
  const blob = await buildProjectArchiveBlobWithWorker(archiveEntries, {
    onProgress: ({ completed, total, label }) => {
      emitPhaseProgress('archive', completed, total, label);
    },
  });
  emitPhaseProgress('archive', 100, 100, `${name || 'project'}.usp`);

  return {
    blob,
    partial: false,
    warnings,
  };
}
