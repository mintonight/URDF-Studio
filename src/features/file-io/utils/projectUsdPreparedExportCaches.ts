import JSZip from 'jszip';

import type { RobotData, UsdPreparedExportCache } from '@/types';
import {
  ensureUniqueLogicalPath,
  normalizeArchivePath,
  PROJECT_USD_PREPARED_EXPORT_CACHES_FILE,
} from './projectArchive';
import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer';
import { appendProjectArchiveEntriesToZip } from './projectArchiveZip';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';

const PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX = 'workspace/usd-prepared-export-caches';

interface SerializedUsdPreparedExportMeshEntry {
  path: string;
  archivePath: string;
}

interface SerializedUsdPreparedExportCachePayload {
  stageSourcePath?: string | null;
  robotData: RobotData;
  meshFiles: SerializedUsdPreparedExportMeshEntry[];
}

interface SerializedUsdPreparedExportCacheManifestEntry {
  stageSourcePath: string;
  cacheFile: string;
}

function normalizeUsdCacheKey(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

export async function buildUsdPreparedExportCacheEntries(
  caches: Record<string, UsdPreparedExportCache>,
): Promise<Map<string, ProjectArchiveEntryData>> {
  const cacheEntries = Object.entries(caches).filter(([, cache]) => cache?.robotData);
  const archiveEntries = new Map<string, ProjectArchiveEntryData>();
  if (cacheEntries.length === 0) {
    return archiveEntries;
  }

  const manifest: SerializedUsdPreparedExportCacheManifestEntry[] = [];

  for (const [index, [cacheKey, cache]] of cacheEntries.entries()) {
    const normalizedCacheKey = normalizeUsdCacheKey(cache.stageSourcePath || cacheKey);
    if (!normalizedCacheKey) {
      continue;
    }

    const cacheFolder = `${PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX}/cache-${index + 1}`;
    const usedMeshPaths = new Set<string>();
    const meshFiles: SerializedUsdPreparedExportMeshEntry[] = [];

    for (const [meshIndex, [meshPath, meshBlob]] of Object.entries(cache.meshFiles || {}).entries()) {
      if (!(meshBlob instanceof Blob)) {
        continue;
      }

      const uniqueMeshPath = ensureUniqueLogicalPath(
        normalizeArchivePath(meshPath) || `mesh_${meshIndex + 1}.obj`,
        usedMeshPaths,
        `mesh_${meshIndex + 1}.obj`,
      );
      const archivePath = `${cacheFolder}/meshes/${uniqueMeshPath}`;
      archiveEntries.set(archivePath, meshBlob);
      meshFiles.push({
        path: meshPath,
        archivePath,
      });
    }

    const cacheFile = `${cacheFolder}/cache.json`;
    const payload: SerializedUsdPreparedExportCachePayload = {
      stageSourcePath: cache.stageSourcePath || normalizedCacheKey,
      robotData: cache.robotData,
      meshFiles,
    };

    archiveEntries.set(cacheFile, JSON.stringify(payload, null, 2));
    manifest.push({
      stageSourcePath: normalizedCacheKey,
      cacheFile,
    });
  }

  if (manifest.length > 0) {
    archiveEntries.set(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE, JSON.stringify(manifest, null, 2));
  }

  return archiveEntries;
}

export async function writeUsdPreparedExportCaches(
  zip: JSZip,
  caches: Record<string, UsdPreparedExportCache>,
): Promise<void> {
  const archiveEntries = await buildUsdPreparedExportCacheEntries(caches);
  appendProjectArchiveEntriesToZip(zip, archiveEntries);
}

export async function readUsdPreparedExportCaches(
  zip: JSZip,
): Promise<Record<string, UsdPreparedExportCache>> {
  const manifestContent = await zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE)?.async('string');
  if (!manifestContent) {
    return {};
  }

  const manifest = JSON.parse(manifestContent) as SerializedUsdPreparedExportCacheManifestEntry[];
  const caches: Record<string, UsdPreparedExportCache> = {};

  await Promise.all(manifest.map(async (entry) => {
    const payloadContent = await zip.file(entry.cacheFile)?.async('string');
    if (!payloadContent) {
      return;
    }

    const payload = JSON.parse(payloadContent) as SerializedUsdPreparedExportCachePayload;
    const meshFilesEntries = await Promise.all(
      (payload.meshFiles || []).map(async (meshEntry) => {
        const blob = await zip.file(meshEntry.archivePath)?.async('blob');
        return blob ? [meshEntry.path, blob] as const : null;
      }),
    );

    const normalizedKey = normalizeUsdCacheKey(payload.stageSourcePath || entry.stageSourcePath);
    if (!normalizedKey) {
      return;
    }

    caches[normalizedKey] = {
      stageSourcePath: payload.stageSourcePath || entry.stageSourcePath,
      robotData: payload.robotData,
      meshFiles: Object.fromEntries(
        meshFilesEntries.filter(
          (meshFilesEntry): meshFilesEntry is readonly [string, Blob] => meshFilesEntry !== null,
        ),
      ),
    };
  }));

  return caches;
}
