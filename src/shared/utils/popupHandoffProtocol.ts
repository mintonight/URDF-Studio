export const POPUP_HANDOFF_PROTOCOL_VERSION = 1;
export const POPUP_HANDOFF_QUERY_PARAM = 'handoff';
export const POPUP_HANDOFF_STORE_DB_NAME = 'bot-world-popup-handoff';
export const POPUP_HANDOFF_STORE_NAME = 'archives';
export const POPUP_HANDOFF_STORE_VERSION = 1;
export const POPUP_HANDOFF_MAX_BYTES = 1024 * 1024 * 1024;
export const POPUP_HANDOFF_TTL_MS = 15 * 60 * 1000;

export const POPUP_HANDOFF_READY = 'botworld.handoff.ready';
export const POPUP_HANDOFF_PAYLOAD = 'botworld.handoff.payload';
export const POPUP_HANDOFF_RESULT = 'botworld.handoff.result';
// Unused handshake constants removed (OFFER/ACCEPT/REJECT).
// Protocol intentionally uses READY → PAYLOAD → RESULT.

/** Origins allowed to send handoff messages to this receiver. */
export const ALLOWED_HANDOFF_ORIGINS: ReadonlySet<string> = new Set([
  'https://botworld.d-robotics.cc',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
]);

export type PopupHandoffResultKind = 'new-tab' | 'existing-tab' | 'failed';

export type PopupHandoffRejectCode =
  | 'invalid_type'
  | 'too_large'
  | 'user_rejected'
  | 'protocol_error'
  | 'save_failed';

export interface PopupHandoffReadyMessage {
  type: typeof POPUP_HANDOFF_READY;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
  maxBytes: number;
  accepts: ['application/zip', '.zip'];
}

export interface PopupHandoffPayloadMessage {
  type: typeof POPUP_HANDOFF_PAYLOAD;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  zip: Blob | File;
}

export interface PopupHandoffResultMessage {
  type: typeof POPUP_HANDOFF_RESULT;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
  result: PopupHandoffResultKind;
}

export interface PopupHandoffArchiveRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceOrigin: string;
  createdAt: number;
  zipBlob?: Blob;
  status?: 'pending' | 'consumed';
  /** When present, this record activates a plugin tool instead of importing a ZIP */
  pluginKey?: string;
}

export function isPopupHandoffZipType(fileName: string, mimeType: string): boolean {
  const normalizedName = fileName.trim().toLowerCase();
  const normalizedMimeType = mimeType.trim().toLowerCase();

  if (normalizedName.endsWith('.zip')) {
    return true;
  }

  return (
    normalizedMimeType === 'application/zip' ||
    normalizedMimeType === 'application/x-zip-compressed'
  );
}

export function validatePopupHandoffPayload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; code: PopupHandoffRejectCode; message: string } {
  if (!isPopupHandoffZipType(input.fileName, input.mimeType)) {
    return {
      ok: false,
      code: 'invalid_type',
      message: 'Only ZIP archives are supported for popup handoff.',
    };
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return {
      ok: false,
      code: 'invalid_type',
      message: 'The ZIP archive is empty or has an invalid size.',
    };
  }

  if (input.sizeBytes > POPUP_HANDOFF_MAX_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `The ZIP archive exceeds the ${Math.round(
        POPUP_HANDOFF_MAX_BYTES / (1024 * 1024 * 1024),
      )} GB popup handoff limit.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
//  Unified URL helpers — single source of truth for reading/stripping the
//  handoff query parameter. All consumers should import from here.
// ---------------------------------------------------------------------------

/** Read the handoff ID from a full URL string. Returns null if absent. */
export function readHandoffIdFromUrl(url: string): string | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const handoffId = resolvedUrl.searchParams.get(POPUP_HANDOFF_QUERY_PARAM)?.trim() ?? '';
  return handoffId.length > 0 ? handoffId : null;
}

/** Remove the handoff query parameter from a URL string, returning the cleaned URL. */
export function stripHandoffParamFromUrl(url: string): string {
  // If the URL is already absolute (contains scheme), parse it directly
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(POPUP_HANDOFF_QUERY_PARAM);
  return resolvedUrl.toString();
}
