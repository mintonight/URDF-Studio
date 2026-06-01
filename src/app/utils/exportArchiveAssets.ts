import JSZip from 'jszip';

import type { RobotState } from '@/types';

import type {
  PreparedExportArchiveAssetFile,
  PrepareExportArchiveAssetsProgress,
} from './exportArchiveAssetsWorker.ts';
import { prepareExportArchiveAssetsWithWorker } from './exportArchiveAssetsWorkerBridge.ts';

export { collectRobotAssetReferences } from './exportArchiveAssetReferences.ts';

interface CompressOptions {
  compressSTL: boolean;
  stlQuality: number;
}

interface AddRobotAssetsToZipOptions {
  robot: RobotState;
  zip: JSZip;
  assets: Record<string, string>;
  compressOptions?: CompressOptions;
  extraMeshFiles?: Map<string, Blob>;
  skipMeshPaths?: ReadonlySet<string>;
  onProgress?: (progress: { completed: number; total: number; currentFile: string }) => void;
}

export type RobotAssetPackagingFailureCode =
  | 'mesh_asset_missing'
  | 'mesh_fetch_failed'
  | 'texture_asset_missing'
  | 'texture_fetch_failed';

export interface RobotAssetPackagingFailure {
  code: RobotAssetPackagingFailureCode;
  assetType: 'mesh' | 'texture';
  sourcePath: string;
  exportPath: string;
  message: string;
}

export interface AddRobotAssetsToZipResult {
  totalTasks: number;
  completedTasks: number;
  failedAssets: RobotAssetPackagingFailure[];
}

function addPreparedAssetFilesToZip(
  zip: JSZip,
  files: readonly PreparedExportArchiveAssetFile[],
): void {
  const folders: Record<PreparedExportArchiveAssetFile['folder'], JSZip | null> = {
    meshes: zip.folder('meshes'),
    textures: zip.folder('textures'),
  };

  files.forEach((file) => {
    folders[file.folder]?.file(file.exportPath, file.bytes);
  });
}

function createWorkerProgressForwarder(
  onProgress: AddRobotAssetsToZipOptions['onProgress'],
): ((progress: PrepareExportArchiveAssetsProgress) => void) | undefined {
  if (!onProgress) {
    return undefined;
  }

  return ({ completed, total, currentFile, stage }) => {
    if (stage && stage !== 'complete') {
      return;
    }

    onProgress({
      completed,
      total,
      currentFile,
    });
  };
}

export async function addRobotAssetsToZip(
  options: AddRobotAssetsToZipOptions,
): Promise<AddRobotAssetsToZipResult> {
  const result = await prepareExportArchiveAssetsWithWorker({
    robot: options.robot,
    assets: options.assets,
    compressOptions: options.compressOptions,
    extraMeshFiles: options.extraMeshFiles,
    skipMeshPaths: options.skipMeshPaths,
    onProgress: createWorkerProgressForwarder(options.onProgress),
  });

  addPreparedAssetFilesToZip(options.zip, result.files);

  return {
    totalTasks: result.totalTasks,
    completedTasks: result.completedTasks,
    failedAssets: result.failedAssets,
  };
}
