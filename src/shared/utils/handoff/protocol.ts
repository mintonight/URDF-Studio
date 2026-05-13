export const HANDOFF_PROTOCOL_VERSION = 1 as const;
export const HANDOFF_MAX_BYTES = 1024 * 1024 * 1024;
export const HANDOFF_DEFAULT_TTL_MS = 15 * 60 * 1000;
export const HANDOFF_QUERY_PARAM = 'handoff';

export const HANDOFF_READY_MESSAGE_TYPE = 'botworld.handoff.ready';
export const HANDOFF_OFFER_MESSAGE_TYPE = 'botworld.handoff.offer';
export const HANDOFF_ACCEPT_MESSAGE_TYPE = 'botworld.handoff.accept';
export const HANDOFF_REJECT_MESSAGE_TYPE = 'botworld.handoff.reject';
export const HANDOFF_PAYLOAD_MESSAGE_TYPE = 'botworld.handoff.payload';

export type HandoffRejectCode = 'invalid_type' | 'too_large' | 'user_rejected' | 'protocol_error';

export interface HandoffReadyMessage {
  type: typeof HANDOFF_READY_MESSAGE_TYPE;
  version: typeof HANDOFF_PROTOCOL_VERSION;
  maxBytes: number;
  accepts: ['application/zip', '.zip'];
}

export interface HandoffOfferMessage {
  type: typeof HANDOFF_OFFER_MESSAGE_TYPE;
  version: typeof HANDOFF_PROTOCOL_VERSION;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface HandoffAcceptMessage {
  type: typeof HANDOFF_ACCEPT_MESSAGE_TYPE;
  version: typeof HANDOFF_PROTOCOL_VERSION;
}

export interface HandoffRejectMessage {
  type: typeof HANDOFF_REJECT_MESSAGE_TYPE;
  version: typeof HANDOFF_PROTOCOL_VERSION;
  code: HandoffRejectCode;
  message: string;
}

export interface HandoffPayloadMessage {
  type: typeof HANDOFF_PAYLOAD_MESSAGE_TYPE;
  version: typeof HANDOFF_PROTOCOL_VERSION;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  zip: Blob | File;
}

export type HandoffIncomingMessage = HandoffOfferMessage | HandoffPayloadMessage;
export type HandoffOutgoingMessage =
  | HandoffReadyMessage
  | HandoffAcceptMessage
  | HandoffRejectMessage;

export interface HandoffStoredZipRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceOrigin: string;
  createdAt: number;
  zipBlob: Blob;
}

export function createHandoffReadyMessage(): HandoffReadyMessage {
  return {
    type: HANDOFF_READY_MESSAGE_TYPE,
    version: HANDOFF_PROTOCOL_VERSION,
    maxBytes: HANDOFF_MAX_BYTES,
    accepts: ['application/zip', '.zip'],
  };
}

export function isZipLikeHandoffFile(fileName: string, mimeType: string): boolean {
  const normalizedName = fileName.trim().toLowerCase();
  const normalizedMimeType = mimeType.trim().toLowerCase();
  return (
    normalizedName.endsWith('.zip') ||
    normalizedMimeType === 'application/zip' ||
    normalizedMimeType === 'application/x-zip-compressed'
  );
}

export function isHandoffOfferMessage(value: unknown): value is HandoffOfferMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HandoffOfferMessage>;
  return (
    candidate.type === HANDOFF_OFFER_MESSAGE_TYPE &&
    candidate.version === HANDOFF_PROTOCOL_VERSION &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.sizeBytes === 'number'
  );
}

export function isHandoffPayloadMessage(value: unknown): value is HandoffPayloadMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HandoffPayloadMessage>;
  return (
    candidate.type === HANDOFF_PAYLOAD_MESSAGE_TYPE &&
    candidate.version === HANDOFF_PROTOCOL_VERSION &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.sizeBytes === 'number' &&
    candidate.zip instanceof Blob
  );
}

export function formatHandoffBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}
