import type { PopupHandoffArchiveRecord } from '../../shared/utils/popupHandoffProtocol.ts';
import { POPUP_HANDOFF_QUERY_PARAM } from '../../shared/utils/popupHandoffProtocol.ts';

export type ImportArchiveResult = {
  status: 'completed' | 'skipped' | 'failed';
};

export type ConsumeHandoffImportResult =
  | { status: 'idle' }
  | { status: 'missing'; handoffId: string }
  | { status: 'already-attempted'; handoffId: string }
  | { status: 'completed'; handoffId: string }
  | { status: 'skipped'; handoffId: string }
  | { status: 'failed'; handoffId: string; error?: unknown };

export interface ConsumeHandoffImportOptions {
  currentUrl: string;
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  logger?: Pick<Console, 'error' | 'warn'>;
  loadRecord: (handoffId: string) => Promise<PopupHandoffArchiveRecord | null>;
  deleteRecord: (handoffId: string) => Promise<void>;
  importArchive: (files: readonly File[]) => Promise<ImportArchiveResult>;
  replaceUrl: (nextUrl: string) => void;
}

function buildAttemptedSessionKey(handoffId: string): string {
  return `urdf-studio-handoff-attempted:${handoffId}`;
}

export function readHandoffIdFromUrl(currentUrl: string): string | null {
  const url = new URL(currentUrl);
  const handoffId = url.searchParams.get(POPUP_HANDOFF_QUERY_PARAM)?.trim() ?? '';
  return handoffId ? handoffId : null;
}

export function buildUrlWithoutHandoffParam(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete(POPUP_HANDOFF_QUERY_PARAM);
  return url.toString();
}

export function createFileFromPendingHandoffRecord(record: PopupHandoffArchiveRecord): File {
  return new File([record.zipBlob], record.fileName, {
    type: record.mimeType || 'application/zip',
    lastModified: record.createdAt,
  });
}

export async function consumeHandoffImportFromUrl(
  options: ConsumeHandoffImportOptions,
): Promise<ConsumeHandoffImportResult> {
  const handoffId = readHandoffIdFromUrl(options.currentUrl);
  if (!handoffId) {
    return { status: 'idle' };
  }

  const nextUrl = buildUrlWithoutHandoffParam(options.currentUrl);
  const attemptedKey = buildAttemptedSessionKey(handoffId);
  const attemptedAlready = options.sessionStorage?.getItem(attemptedKey) === '1';

  if (attemptedAlready) {
    options.replaceUrl(nextUrl);
    return { status: 'already-attempted', handoffId };
  }

  options.sessionStorage?.setItem(attemptedKey, '1');

  try {
    const record = await options.loadRecord(handoffId);
    if (!record) {
      options.replaceUrl(nextUrl);
      return { status: 'missing', handoffId };
    }

    // Already consumed by the background polling path (Path B) — skip to avoid duplicate import
    if (record.status === 'consumed') {
      options.replaceUrl(nextUrl);
      return { status: 'already-attempted', handoffId };
    }

    // Extract file data into memory, then delete the IndexedDB record BEFORE importing.
    // This prevents the background polling loop (Path B) in the same tab from discovering
    // the same pending record and importing it a second time while our import is still running.
    const file = createFileFromPendingHandoffRecord(record);
    await options.deleteRecord(handoffId);

    const importResult = await options.importArchive([file]);

    options.replaceUrl(nextUrl);

    if (importResult.status === 'failed') {
      return { status: 'failed', handoffId };
    }
    if (importResult.status === 'skipped') {
      return { status: 'skipped', handoffId };
    }
    return { status: 'completed', handoffId };
  } catch (error) {
    options.logger?.error?.('Failed to consume handoff import from URL:', error);
    options.replaceUrl(nextUrl);
    return { status: 'failed', handoffId, error };
  }
}
