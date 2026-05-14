import {
  claimPendingPopupHandoffArchive,
  cleanupExpiredPopupHandoffArchives,
  deletePopupHandoffArchive,
  getPendingHandoffArchives,
  getPopupHandoffArchive,
  putPopupHandoffArchive,
  updatePopupHandoffArchiveStatus,
} from '../../shared/utils/popupHandoffArchiveStore.ts';
import type { PopupHandoffArchiveRecord } from '../../shared/utils/popupHandoffProtocol.ts';

export interface SavePendingHandoffImportParams {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceOrigin: string;
  zipBlob?: Blob;
  createdAt?: number;
  status?: 'pending' | 'consumed';
  pluginKey?: string;
}

export async function savePendingHandoffImport(
  params: SavePendingHandoffImportParams,
): Promise<PopupHandoffArchiveRecord> {
  const id = await putPopupHandoffArchive({
    fileName: params.fileName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    sourceOrigin: params.sourceOrigin,
    zipBlob: params.zipBlob,
    status: params.status,
    pluginKey: params.pluginKey,
  });
  return {
    id,
    fileName: params.fileName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    sourceOrigin: params.sourceOrigin,
    createdAt: params.createdAt ?? Date.now(),
    zipBlob: params.zipBlob,
    status: params.status,
    pluginKey: params.pluginKey,
  };
}

export async function readPendingHandoffImport(
  id: string,
): Promise<PopupHandoffArchiveRecord | null> {
  return await getPopupHandoffArchive(id);
}

export async function deletePendingHandoffImport(id: string): Promise<void> {
  await deletePopupHandoffArchive(id);
}

export async function pruneExpiredPendingHandoffImports(): Promise<number> {
  return await cleanupExpiredPopupHandoffArchives();
}

export async function updatePendingHandoffStatus(
  id: string,
  status: 'pending' | 'consumed',
): Promise<void> {
  return await updatePopupHandoffArchiveStatus(id, status);
}

export async function readAllPendingHandoffImports(): Promise<PopupHandoffArchiveRecord[]> {
  return await getPendingHandoffArchives();
}

export async function claimPendingHandoffImport(
  id: string,
): Promise<PopupHandoffArchiveRecord | null> {
  return await claimPendingPopupHandoffArchive(id);
}
