import JSZip from 'jszip';
import type { AssetFile } from '../types';
import {
  AssemblyState,
  BridgeJoint,
  JointType,
  type JointHardwareInterface,
  MotorSpec,
  RobotData,
  RobotFile,
  UsdPreparedExportCache,
  UrdfJoint,
} from '@/types';
import { translations, type Language } from '@/shared/i18n';
import {
  buildLibraryArchivePath,
  PROJECT_ALL_FILE_CONTENTS_FILE,
  PROJECT_ASSEMBLY_HISTORY_FILE,
  PROJECT_ASSET_MANIFEST_FILE,
  PROJECT_MOTOR_LIBRARY_FILE,
  PROJECT_ORIGINAL_URDF_FILE,
  PROJECT_ROBOT_HISTORY_FILE,
} from './projectArchive';
import type { ProjectManifest } from './projectExport';
import { readUsdPreparedExportCaches } from './projectUsdPreparedExportCaches';

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

export interface ImportedProjectLibraryFile extends Omit<RobotFile, 'blobUrl'> {
  blobPath?: string | null;
}

export interface ImportedProjectArchiveData {
  manifest: ProjectManifest;
  assetFiles: AssetFile[];
  availableFiles: ImportedProjectLibraryFile[];
  allFileContents: Record<string, string>;
  motorLibrary: Record<string, MotorSpec[]>;
  selectedFileName: string | null;
  originalUrdfContent: string;
  originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
  usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  robotState: RobotData | null;
  robotHistory: { past: RobotData[]; future: RobotData[] };
  robotActivity: ProjectActivityEntry[];
  assemblyState: AssemblyState | null;
  assemblyHistory: { past: Array<AssemblyState | null>; future: Array<AssemblyState | null> };
  assemblyActivity: ProjectActivityEntry[];
}

export interface ImportResult {
  manifest: ProjectManifest;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  motorLibrary: Record<string, MotorSpec[]>;
  selectedFileName: string | null;
  originalUrdfContent: string;
  originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
  usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  robotState: RobotData | null;
  robotHistory: { past: RobotData[]; future: RobotData[] };
  robotActivity: ProjectActivityEntry[];
  assemblyState: AssemblyState | null;
  assemblyHistory: { past: Array<AssemblyState | null>; future: Array<AssemblyState | null> };
  assemblyActivity: ProjectActivityEntry[];
}

const normalizeActivity = (
  activity: Array<{ id?: string; timestamp?: string; label?: string }> | undefined,
): ProjectActivityEntry[] =>
  (activity ?? []).slice(-MAX_ACTIVITY_LOG).map((entry, index) => ({
    id: entry.id ?? `activity_${index}`,
    timestamp: entry.timestamp ?? new Date(0).toISOString(),
    label: entry.label ?? 'Unknown change',
  }));

function getRequiredArchiveEntry(zip: JSZip, path: string, label: string): JSZip.JSZipObject {
  const entry = zip.file(path);
  if (!entry) {
    throw new Error(`Invalid project file: missing required ${label} at "${path}"`);
  }
  return entry;
}

function createPackedProjectAssetUrls(assetFiles: readonly AssetFile[]): Record<string, string> {
  const assets: Record<string, string> = {};

  assetFiles.forEach(({ name, blob }) => {
    const normalizedPath = name.replace(/\\/g, '/').replace(/^\/+/, '');
    assets[normalizedPath] = URL.createObjectURL(blob);
  });

  return assets;
}

async function readRequiredArchiveText(zip: JSZip, path: string, label: string): Promise<string> {
  const content = await getRequiredArchiveEntry(zip, path, label).async('string');
  if (!content) {
    throw new Error(`Invalid project file: required ${label} at "${path}" is empty`);
  }
  return content;
}

async function readOptionalArchiveText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) {
    return null;
  }

  return await entry.async('string');
}

async function loadRequiredJsonRecord<T>(zip: JSZip, path: string, label: string): Promise<T> {
  const content = await readRequiredArchiveText(zip, path, label);

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(`Invalid project file: failed to parse ${label} at "${path}"`, {
      cause: error,
    });
  }
}

const parseBridgeXml = (xmlContent: string): Record<string, BridgeJoint> => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
  const bridgeNodes = xmlDoc.getElementsByTagName('bridge');
  const bridges: Record<string, BridgeJoint> = {};

  Array.from(bridgeNodes).forEach((node) => {
    const id = node.getAttribute('id') || `bridge_${Date.now()}_${Math.random()}`;
    const name = node.getAttribute('name') || 'unnamed_bridge';
    const parentComponentId = node.getAttribute('parent_comp') || '';
    const parentLinkId = node.getAttribute('parent_link') || '';
    const childComponentId = node.getAttribute('child_comp') || '';
    const childLinkId = node.getAttribute('child_link') || '';

    const jointNode = node.getElementsByTagName('joint')[0];
    if (!jointNode) return;

    const jointName = jointNode.getAttribute('name') || 'joint';
    const jointType = (jointNode.getAttribute('type') as JointType) || JointType.FIXED;

    const originNode = jointNode.getElementsByTagName('origin')[0];
    const xyz = originNode?.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 0];
    const rpy = originNode?.getAttribute('rpy')?.split(' ').map(Number) || [0, 0, 0];
    const quatXyzw = originNode?.getAttribute('quat_xyzw')?.split(' ').map(Number);

    const axisNode = jointNode.getElementsByTagName('axis')[0];
    const axisXyz = axisNode?.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 1];

    const limitNode = jointNode.getElementsByTagName('limit')[0];
    const limit = {
      lower: Number(limitNode?.getAttribute('lower') || 0),
      upper: Number(limitNode?.getAttribute('upper') || 0),
      effort: Number(limitNode?.getAttribute('effort') || 0),
      velocity: Number(limitNode?.getAttribute('velocity') || 0),
    };

    const dynamicsNode = jointNode.getElementsByTagName('dynamics')[0];
    const dynamics = {
      damping: Number(dynamicsNode?.getAttribute('damping') || 0),
      friction: Number(dynamicsNode?.getAttribute('friction') || 0),
    };
    const hardwareNode = jointNode.getElementsByTagName('hardware')[0];
    const hardwareInterface = hardwareNode?.getElementsByTagName('hardwareInterface')[0]
      ?.textContent as JointHardwareInterface | null;

    const joint: UrdfJoint = {
      id,
      name: jointName,
      type: jointType,
      parentLinkId,
      childLinkId,
      origin: {
        xyz: { x: xyz[0], y: xyz[1], z: xyz[2] },
        rpy: { r: rpy[0], p: rpy[1], y: rpy[2] },
        ...(quatXyzw?.length === 4
          ? {
              quatXyzw: {
                x: quatXyzw[0],
                y: quatXyzw[1],
                z: quatXyzw[2],
                w: quatXyzw[3],
              },
            }
          : {}),
      },
      axis: { x: axisXyz[0], y: axisXyz[1], z: axisXyz[2] },
      limit,
      dynamics,
      hardware: {
        armature: 0,
        motorType: 'None',
        motorId: '',
        motorDirection: 1,
        ...(hardwareInterface ? { hardwareInterface } : {}),
      },
    };

    bridges[id] = {
      id,
      name,
      parentComponentId,
      parentLinkId,
      childComponentId,
      childLinkId,
      joint,
    };
  });

  return bridges;
};

const loadPackedAssetFiles = async (
  zip: JSZip,
  manifest: ProjectManifest,
): Promise<AssetFile[]> => {
  const assetEntriesFromManifest =
    manifest.assets.assetEntries ??
    (await loadRequiredJsonRecord<Array<{ logicalPath: string; archivePath: string }>>(
      zip,
      PROJECT_ASSET_MANIFEST_FILE,
      'asset manifest',
    ));
  if (!assetEntriesFromManifest || assetEntriesFromManifest.length === 0) {
    return [];
  }

  const assetFiles: AssetFile[] = [];
  await Promise.all(
    assetEntriesFromManifest.map(async (entry) => {
      const blob = await getRequiredArchiveEntry(
        zip,
        entry.archivePath,
        `packed asset "${entry.logicalPath}"`,
      ).async('blob');
      assetFiles.push({ name: entry.logicalPath, blob });
    }),
  );

  return assetFiles;
};

const loadHistoryFile = async <T>(
  zip: JSZip,
  path: string | undefined,
): Promise<ProjectHistorySnapshot<T> | null> => {
  if (!path) return null;
  return await loadRequiredJsonRecord<ProjectHistorySnapshot<T>>(zip, path, 'history snapshot');
};

const loadLibraryFiles = async (
  zip: JSZip,
  manifest: ProjectManifest,
  assetPaths: ReadonlySet<string>,
): Promise<ImportedProjectLibraryFile[]> => {
  const availableFiles: ImportedProjectLibraryFile[] = [];

  for (const fileInfo of manifest.assets.availableFiles ?? []) {
    let content = '';

    if (fileInfo.format !== 'mesh') {
      const archivePath = buildLibraryArchivePath(fileInfo.name);
      content =
        fileInfo.format === 'usd'
          ? // Binary USD sources are restored from packed assets, so the library
            // placeholder may intentionally be empty.
            await getRequiredArchiveEntry(
              zip,
              archivePath,
              `library source file "${fileInfo.name}"`,
            ).async('string')
          : await readRequiredArchiveText(
              zip,
              archivePath,
              `library source file "${fileInfo.name}"`,
            );
    }

    availableFiles.push({
      name: fileInfo.name,
      content,
      format: fileInfo.format as RobotFile['format'],
      blobPath: assetPaths.has(fileInfo.name) ? fileInfo.name : null,
    });
  }

  return availableFiles;
};

function revokeImportedAssetUrls(assets: Record<string, string>): void {
  Array.from(new Set(Object.values(assets))).forEach((url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
}

export function hydrateImportedProjectResult(
  archiveData: ImportedProjectArchiveData,
): ImportResult {
  let assets: Record<string, string> = {};

  try {
    assets = createPackedProjectAssetUrls(archiveData.assetFiles);

    return {
      manifest: archiveData.manifest,
      assets,
      availableFiles: archiveData.availableFiles.map((file) => {
        const { blobPath, ...rest } = file;
        return {
          ...rest,
          ...(blobPath ? { blobUrl: assets[blobPath] } : {}),
        };
      }),
      allFileContents: archiveData.allFileContents,
      motorLibrary: archiveData.motorLibrary,
      selectedFileName: archiveData.selectedFileName,
      originalUrdfContent: archiveData.originalUrdfContent,
      originalFileFormat: archiveData.originalFileFormat,
      usdPreparedExportCaches: archiveData.usdPreparedExportCaches,
      robotState: archiveData.robotState,
      robotHistory: archiveData.robotHistory,
      robotActivity: archiveData.robotActivity,
      assemblyState: archiveData.assemblyState,
      assemblyHistory: archiveData.assemblyHistory,
      assemblyActivity: archiveData.assemblyActivity,
    };
  } catch (error) {
    revokeImportedAssetUrls(assets);
    throw error;
  }
}

export async function readImportedProjectArchive(
  file: File | Blob | ArrayBuffer | Uint8Array,
  lang: Language = 'en',
): Promise<ImportedProjectArchiveData> {
  const t = translations[lang];
  const zip = await JSZip.loadAsync(file);

  const manifestContent = await zip.file('project.json')?.async('string');
  if (!manifestContent) {
    throw new Error(t.projectImportMissingProjectJson);
  }

  const manifest = JSON.parse(manifestContent) as ProjectManifest;
  const assetFiles = await loadPackedAssetFiles(zip, manifest);
  const assetPaths = new Set(assetFiles.map((assetFile) => assetFile.name));
  const availableFiles = await loadLibraryFiles(zip, manifest, assetPaths);
  const usdPreparedExportCaches = await readUsdPreparedExportCaches(zip);

  const allFileContents = await loadRequiredJsonRecord<Record<string, string>>(
    zip,
    manifest.assets.allFileContentsFile ?? PROJECT_ALL_FILE_CONTENTS_FILE,
    'all file contents record',
  );

  const motorLibrary = await loadRequiredJsonRecord<Record<string, MotorSpec[]>>(
    zip,
    manifest.assets.motorLibraryFile ?? PROJECT_MOTOR_LIBRARY_FILE,
    'motor library',
  );

  const originalUrdfContent = manifest.assets.originalUrdfContentFile
    ? await readRequiredArchiveText(
        zip,
        manifest.assets.originalUrdfContentFile,
        'original URDF source',
      )
    : ((await readOptionalArchiveText(zip, PROJECT_ORIGINAL_URDF_FILE)) ?? '');

  const robotHistoryFile = manifest.history?.robotFile ?? PROJECT_ROBOT_HISTORY_FILE;
  const robotHistorySnapshot = await loadHistoryFile<RobotData>(zip, robotHistoryFile);

  const assemblyHistoryFile = manifest.history?.assemblyFile ?? PROJECT_ASSEMBLY_HISTORY_FILE;
  const assemblyHistorySnapshot = await loadHistoryFile<AssemblyState | null>(
    zip,
    assemblyHistoryFile,
  );

  const assemblyState = assemblyHistorySnapshot?.present ?? null;
  const firstAssemblyComponent = assemblyState
    ? (Object.values(assemblyState.components)[0]?.robot ?? null)
    : null;
  const robotState = robotHistorySnapshot?.present ?? firstAssemblyComponent;

  return {
    manifest,
    assetFiles,
    availableFiles,
    allFileContents,
    motorLibrary,
    selectedFileName: manifest.workspace?.selectedFile ?? null,
    originalUrdfContent,
    originalFileFormat: manifest.assets.originalFileFormat ?? null,
    usdPreparedExportCaches,
    robotState,
    robotHistory: {
      past: clampHistoryEntries(robotHistorySnapshot?.past),
      future: clampFutureEntries(robotHistorySnapshot?.future),
    },
    robotActivity: normalizeActivity(robotHistorySnapshot?.activity),
    assemblyState,
    assemblyHistory: {
      past: clampHistoryEntries(assemblyHistorySnapshot?.past),
      future: clampFutureEntries(assemblyHistorySnapshot?.future),
    },
    assemblyActivity: normalizeActivity(assemblyHistorySnapshot?.activity),
  };
}

export async function importProject(file: File, lang: Language = 'en'): Promise<ImportResult> {
  return hydrateImportedProjectResult(await readImportedProjectArchive(file, lang));
}
