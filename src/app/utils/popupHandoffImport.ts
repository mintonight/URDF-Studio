import type { PopupHandoffArchiveRecord } from '../../shared/utils/popupHandoffProtocol.ts';
import {
  POPUP_HANDOFF_QUERY_PARAM,
  readHandoffIdFromUrl,
  stripHandoffParamFromUrl,
} from '../../shared/utils/popupHandoffProtocol.ts';

export interface PopupHandoffImportStateSnapshot {
  availableFileCount: number;
  assetCount: number;
  selectedFileName: string | null;
}

export type PopupHandoffImportResolution =
  | {
      status: 'noop';
      handoffId: null;
    }
  | {
      status: 'missing' | 'unavailable';
      handoffId: string;
    }
  | {
      status: 'ready';
      handoffId: string;
      file: File;
      sourceOrigin: string;
    };

export function readPopupHandoffId(search: string): string | null {
  // Delegate to the unified URL helper; reconstruct a full URL from the search string
  const fakeUrl = search.startsWith('?')
    ? `http://localhost${search}`
    : `http://localhost?${search}`;
  return readHandoffIdFromUrl(fakeUrl);
}

export function buildPopupHandoffImportStateSnapshot(input: {
  availableFiles: ArrayLike<unknown>;
  assets: Record<string, unknown>;
  selectedFile: { name: string } | null;
}): PopupHandoffImportStateSnapshot {
  return {
    availableFileCount: input.availableFiles.length,
    assetCount: Object.keys(input.assets).length,
    selectedFileName: input.selectedFile?.name ?? null,
  };
}

export function didPopupHandoffImportChangeState(
  before: PopupHandoffImportStateSnapshot,
  after: PopupHandoffImportStateSnapshot,
): boolean {
  return (
    after.availableFileCount > before.availableFileCount ||
    after.assetCount > before.assetCount ||
    after.selectedFileName !== before.selectedFileName
  );
}

export function stripPopupHandoffQueryParam(urlLike: string): string {
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(urlLike);
  const fullUrl = isAbsoluteUrl ? urlLike : `http://localhost${urlLike}`;
  const cleanedUrl = stripHandoffParamFromUrl(fullUrl);

  if (isAbsoluteUrl) {
    return cleanedUrl;
  }

  const parsedCleanedUrl = new URL(cleanedUrl);
  return `${parsedCleanedUrl.pathname}${parsedCleanedUrl.search}${parsedCleanedUrl.hash}`;
}

export async function resolvePopupHandoffImport(
  search: string,
  options: {
    readArchive: (handoffId: string) => Promise<PopupHandoffArchiveRecord | null>;
    cleanupExpired: () => Promise<unknown>;
  },
): Promise<PopupHandoffImportResolution> {
  const handoffId = readPopupHandoffId(search);
  if (!handoffId) {
    return {
      status: 'noop',
      handoffId: null,
    };
  }

  await options.cleanupExpired();

  const archive = await options.readArchive(handoffId);
  if (!archive) {
    return {
      status: 'missing',
      handoffId,
    };
  }

  try {
    const file = new File([archive.zipBlob], archive.fileName, {
      type: archive.mimeType,
      lastModified: archive.createdAt,
    });

    return {
      status: 'ready',
      handoffId,
      file,
      sourceOrigin: archive.sourceOrigin,
    };
  } catch {
    return {
      status: 'unavailable',
      handoffId,
    };
  }
}
