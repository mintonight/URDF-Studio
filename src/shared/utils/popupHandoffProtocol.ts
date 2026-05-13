export const POPUP_HANDOFF_PROTOCOL_VERSION = 1;
export const POPUP_HANDOFF_QUERY_PARAM = 'handoff';
export const POPUP_HANDOFF_STORE_DB_NAME = 'urdf-studio-popup-handoff';
export const POPUP_HANDOFF_STORE_NAME = 'archives';
export const POPUP_HANDOFF_STORE_VERSION = 1;
export const POPUP_HANDOFF_MAX_BYTES = 1024 * 1024 * 1024;
export const POPUP_HANDOFF_TTL_MS = 15 * 60 * 1000;

export const POPUP_HANDOFF_READY = 'urdfstudio.handoff.ready';
export const POPUP_HANDOFF_OFFER = 'urdfstudio.handoff.offer';
export const POPUP_HANDOFF_ACCEPT = 'urdfstudio.handoff.accept';
export const POPUP_HANDOFF_REJECT = 'urdfstudio.handoff.reject';
export const POPUP_HANDOFF_PAYLOAD = 'urdfstudio.handoff.payload';
export const POPUP_HANDOFF_RESULT = 'urdfstudio.handoff.result';

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

export interface PopupHandoffOfferMessage {
  type: typeof POPUP_HANDOFF_OFFER;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PopupHandoffAcceptMessage {
  type: typeof POPUP_HANDOFF_ACCEPT;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
}

export interface PopupHandoffRejectMessage {
  type: typeof POPUP_HANDOFF_REJECT;
  version: typeof POPUP_HANDOFF_PROTOCOL_VERSION;
  code: PopupHandoffRejectCode;
  message: string;
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
  zipBlob: Blob;
  status?: 'pending' | 'consumed';
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
