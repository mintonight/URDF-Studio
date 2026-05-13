export const EXTERNAL_IMPORT_HANDOFF_PROTOCOL_VERSION = 1;
export const EXTERNAL_IMPORT_HANDOFF_QUERY_PARAM = 'handoff';
export const EXTERNAL_IMPORT_HANDOFF_MAX_BYTES = 1024 * 1024 * 1024;

const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
]);

export type ExternalImportHandoffReadyMessage = {
  type: 'botworld.handoff.ready';
  version: 1;
  maxBytes: number;
  accepts: ['application/zip', '.zip'];
};

export type ExternalImportHandoffOfferMessage = {
  type: 'botworld.handoff.offer';
  version: 1;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ExternalImportHandoffAcceptMessage = {
  type: 'botworld.handoff.accept';
  version: 1;
};

export type ExternalImportHandoffRejectCode =
  | 'invalid_type'
  | 'invalid_size'
  | 'too_large'
  | 'protocol_error'
  | 'user_rejected'
  | 'storage_unavailable';

export type ExternalImportHandoffRejectMessage = {
  type: 'botworld.handoff.reject';
  version: 1;
  code: ExternalImportHandoffRejectCode;
  message: string;
};

export type ExternalImportHandoffPayloadMessage = {
  type: 'botworld.handoff.payload';
  version: 1;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  zip: Blob;
};

export function createExternalImportHandoffReadyMessage(): ExternalImportHandoffReadyMessage {
  return {
    type: 'botworld.handoff.ready',
    version: EXTERNAL_IMPORT_HANDOFF_PROTOCOL_VERSION,
    maxBytes: EXTERNAL_IMPORT_HANDOFF_MAX_BYTES,
    accepts: ['application/zip', '.zip'],
  };
}

export function createExternalImportHandoffAcceptMessage(): ExternalImportHandoffAcceptMessage {
  return {
    type: 'botworld.handoff.accept',
    version: EXTERNAL_IMPORT_HANDOFF_PROTOCOL_VERSION,
  };
}

export function createExternalImportHandoffRejectMessage(
  code: ExternalImportHandoffRejectCode,
  message: string,
): ExternalImportHandoffRejectMessage {
  return {
    type: 'botworld.handoff.reject',
    version: EXTERNAL_IMPORT_HANDOFF_PROTOCOL_VERSION,
    code,
    message,
  };
}

export function isZipDescriptor(fileName: string, mimeType: string | null | undefined): boolean {
  const normalizedName = fileName.trim().toLowerCase();
  const normalizedMimeType = String(mimeType || '')
    .trim()
    .toLowerCase();

  return normalizedName.endsWith('.zip') || ZIP_MIME_TYPES.has(normalizedMimeType);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidVersion(value: unknown): value is 1 {
  return value === EXTERNAL_IMPORT_HANDOFF_PROTOCOL_VERSION;
}

function normalizeFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSizeBytes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function normalizeMimeType(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseExternalImportHandoffOfferMessage(
  value: unknown,
): ExternalImportHandoffOfferMessage | null {
  if (!isRecordLike(value)) return null;
  if (value.type !== 'botworld.handoff.offer' || !isValidVersion(value.version)) return null;

  const fileName = normalizeFileName(value.fileName);
  const sizeBytes = normalizeSizeBytes(value.sizeBytes);
  if (!fileName || sizeBytes == null) return null;

  return {
    type: 'botworld.handoff.offer',
    version: 1,
    fileName,
    mimeType: normalizeMimeType(value.mimeType),
    sizeBytes,
  };
}

export function parseExternalImportHandoffPayloadMessage(
  value: unknown,
): ExternalImportHandoffPayloadMessage | null {
  if (!isRecordLike(value)) return null;
  if (value.type !== 'botworld.handoff.payload' || !isValidVersion(value.version)) return null;

  const fileName = normalizeFileName(value.fileName);
  const sizeBytes = normalizeSizeBytes(value.sizeBytes);
  if (!fileName || sizeBytes == null) return null;
  if (!(value.zip instanceof Blob)) return null;

  return {
    type: 'botworld.handoff.payload',
    version: 1,
    fileName,
    mimeType: normalizeMimeType(value.mimeType),
    sizeBytes,
    zip: value.zip,
  };
}

export function stripExternalImportHandoffQueryParam(
  input: string,
  paramName = EXTERNAL_IMPORT_HANDOFF_QUERY_PARAM,
): string {
  const url = new URL(input, 'https://urdf-studio.local');
  url.searchParams.delete(paramName);
  return `${url.pathname}${url.search}${url.hash}`;
}
