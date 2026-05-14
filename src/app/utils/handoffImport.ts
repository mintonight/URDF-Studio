import { useAssetsStore } from '@/store';
import type { PopupHandoffArchiveRecord } from '@/shared/utils/popupHandoffProtocol';
import {
  readHandoffIdFromUrl,
  stripHandoffParamFromUrl,
} from '@/shared/utils/popupHandoffProtocol';

export { readHandoffIdFromUrl, stripHandoffParamFromUrl };

export interface HandoffImportSnapshot {
  availableFileCount: number;
  assetCount: number;
  allFileContentCount: number;
  selectedFileName: string | null;
  originalUrdfContentLength: number;
}

export function captureHandoffImportSnapshot(): HandoffImportSnapshot {
  const assetsState = useAssetsStore.getState();
  return {
    availableFileCount: assetsState.availableFiles.length,
    assetCount: Object.keys(assetsState.assets).length,
    allFileContentCount: Object.keys(assetsState.allFileContents).length,
    selectedFileName: assetsState.selectedFile?.name ?? null,
    originalUrdfContentLength: assetsState.originalUrdfContent.length,
  };
}

export function didHandoffImportLikelySucceed(
  before: HandoffImportSnapshot,
  after: HandoffImportSnapshot,
): boolean {
  return (
    after.availableFileCount > before.availableFileCount ||
    after.assetCount > before.assetCount ||
    after.allFileContentCount > before.allFileContentCount ||
    after.selectedFileName !== before.selectedFileName ||
    after.originalUrdfContentLength > before.originalUrdfContentLength
  );
}

export function buildFileFromHandoffRecord(record: PopupHandoffArchiveRecord): File {
  return new File([record.zipBlob], record.fileName, {
    type: record.mimeType || 'application/zip',
    lastModified: record.createdAt,
  });
}
