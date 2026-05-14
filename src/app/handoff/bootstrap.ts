import type { PopupHandoffArchiveRecord } from '../../shared/utils/popupHandoffProtocol.ts';
import {
  readHandoffIdFromUrl,
  stripHandoffParamFromUrl,
} from '../../shared/utils/popupHandoffProtocol.ts';

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
  claimRecord: (handoffId: string) => Promise<PopupHandoffArchiveRecord | null>;
  deleteRecord: (handoffId: string) => Promise<void>;
  importArchive: (files: readonly File[]) => Promise<ImportArchiveResult>;
  replaceUrl: (nextUrl: string) => void;
}

function buildAttemptedSessionKey(handoffId: string): string {
  return `urdf-studio-handoff-attempted:${handoffId}`;
}

export { readHandoffIdFromUrl, stripHandoffParamFromUrl };

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

  const nextUrl = stripHandoffParamFromUrl(options.currentUrl);
  const attemptedKey = buildAttemptedSessionKey(handoffId);
  const attemptedAlready = options.sessionStorage?.getItem(attemptedKey) === '1';

  if (attemptedAlready) {
    options.replaceUrl(nextUrl);
    return { status: 'already-attempted', handoffId };
  }

  options.sessionStorage?.setItem(attemptedKey, '1');

  try {
    // Atomically claim the record: read + mark consumed in a single transaction.
    // Returns null if already consumed or missing — eliminates race with polling path.
    const record = await options.claimRecord(handoffId);
    if (!record) {
      options.replaceUrl(nextUrl);
      return { status: 'already-attempted', handoffId };
    }

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
