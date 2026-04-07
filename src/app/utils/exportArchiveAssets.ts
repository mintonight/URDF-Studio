import JSZip from 'jszip';

import { findAssetByPath } from '@/core/loaders';
import {
  normalizeMeshPathForExport,
  normalizeTexturePathForExport,
} from '@/core/parsers/meshPathUtils';
import { collectGeometryTexturePaths, getVisualGeometryEntries } from '@/core/robot';
import { compressSTLBlob } from '@/core/stl-compressor';
import { GeometryType, type RobotState, type UrdfLink } from '@/types';

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

function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

export function collectRobotAssetReferences(robot: RobotState): {
  meshPaths: Set<string>;
  texturePaths: Set<string>;
} {
  const meshPaths = new Set<string>();
  const texturePaths = new Set<string>();

  Object.values(robot.links).forEach((link: UrdfLink) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        meshPaths.add(entry.geometry.meshPath);
      }
      collectGeometryTexturePaths(entry.geometry).forEach((texturePath) => {
        texturePaths.add(texturePath);
      });
    });
    if (link.collision && link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      meshPaths.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        meshPaths.add(body.meshPath);
      }
    });
  });

  Object.values(robot.materials || {}).forEach((material) => {
    if (material.texture) {
      texturePaths.add(material.texture);
    }
  });

  return {
    meshPaths,
    texturePaths,
  };
}

export async function addRobotAssetsToZip({
  robot,
  zip,
  assets,
  compressOptions,
  extraMeshFiles,
  skipMeshPaths,
  onProgress,
}: AddRobotAssetsToZipOptions): Promise<AddRobotAssetsToZipResult> {
  const meshFolder = zip.folder('meshes');
  const textureFolder = zip.folder('textures');
  const { meshPaths, texturePaths } = collectRobotAssetReferences(robot);

  const tasks: Array<{ currentFile: string; run: () => Promise<void> }> = [];
  const exportedMeshPaths = new Set<string>();
  const exportedTexturePaths = new Set<string>();
  const failedAssets: RobotAssetPackagingFailure[] = [];

  meshPaths.forEach((meshPath) => {
    const exportPath = normalizeMeshPathForExport(meshPath);
    if (skipMeshPaths?.has(meshPath) || (exportPath && skipMeshPaths?.has(exportPath))) {
      return;
    }

    if (!exportPath || exportedMeshPaths.has(exportPath)) {
      return;
    }
    exportedMeshPaths.add(exportPath);

    const inlineMeshBlob = extraMeshFiles?.get(meshPath);
    if (inlineMeshBlob) {
      tasks.push({
        currentFile: exportPath,
        run: async () => {
          if (compressOptions?.compressSTL && /\.stl$/i.test(exportPath)) {
            const filename = exportPath.split('/').pop() ?? exportPath;
            const result = await compressSTLBlob(inlineMeshBlob, filename, {
              quality: compressOptions.stlQuality,
            });
            meshFolder?.file(exportPath, await result.blob.arrayBuffer());
            return;
          }

          meshFolder?.file(exportPath, await inlineMeshBlob.arrayBuffer());
        },
      });
      return;
    }

    const assetUrl = findAssetByPath(meshPath, assets);
    if (!assetUrl) {
      console.error(`[Export] Mesh asset not found for: ${meshPath}`);
      failedAssets.push({
        code: 'mesh_asset_missing',
        assetType: 'mesh',
        sourcePath: meshPath,
        exportPath,
        message: `Mesh asset not found: ${meshPath}`,
      });
      return;
    }

    tasks.push({
      currentFile: exportPath,
      run: async () => {
        try {
          const response = await fetch(assetUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          if (compressOptions?.compressSTL && /\.stl$/i.test(exportPath)) {
            const filename = exportPath.split('/').pop() ?? exportPath;
            const result = await compressSTLBlob(blob, filename, {
              quality: compressOptions.stlQuality,
            });
            meshFolder?.file(exportPath, await result.blob.arrayBuffer());
            return;
          }

          meshFolder?.file(exportPath, await blob.arrayBuffer());
        } catch (error: unknown) {
          console.error(`Failed to load mesh ${meshPath}`, error);
          failedAssets.push({
            code: 'mesh_fetch_failed',
            assetType: 'mesh',
            sourcePath: meshPath,
            exportPath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  });

  texturePaths.forEach((texturePath) => {
    const exportPath = normalizeTexturePathForExport(texturePath);
    if (!exportPath || isExternalAssetPath(exportPath) || exportedTexturePaths.has(exportPath)) {
      return;
    }
    exportedTexturePaths.add(exportPath);

    const assetUrl = findAssetByPath(texturePath, assets);
    if (!assetUrl) {
      console.error(`[Export] Texture asset not found for: ${texturePath}`);
      failedAssets.push({
        code: 'texture_asset_missing',
        assetType: 'texture',
        sourcePath: texturePath,
        exportPath,
        message: `Texture asset not found: ${texturePath}`,
      });
      return;
    }

    tasks.push({
      currentFile: exportPath,
      run: async () => {
        try {
          const response = await fetch(assetUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          textureFolder?.file(exportPath, await blob.arrayBuffer());
        } catch (error: unknown) {
          console.error(`Failed to load texture ${texturePath}`, error);
          failedAssets.push({
            code: 'texture_fetch_failed',
            assetType: 'texture',
            sourcePath: texturePath,
            exportPath,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  });

  const total = tasks.length;
  if (total === 0) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedAssets,
    };
  }

  onProgress?.({
    completed: 0,
    total,
    currentFile: '',
  });

  let completed = 0;
  await Promise.all(
    tasks.map(async (task) => {
      await task.run();
      completed += 1;
      onProgress?.({
        completed,
        total,
        currentFile: task.currentFile,
      });
    }),
  );

  return {
    totalTasks: total,
    completedTasks: completed,
    failedAssets,
  };
}
