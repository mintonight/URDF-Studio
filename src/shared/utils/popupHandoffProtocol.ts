/**
 * Handoff Protocol — shared between BOT World (sender) and receivers (URDF Studio, Motion Studio).
 * Must stay in sync across all three projects:
 *   BOT-World/src/shared/utils/popupHandoffProtocol.ts
 *   URDF-Studio/src/shared/utils/popupHandoffProtocol.ts
 *   MotionStudioUI-BluePrint/src/shared/utils/popupHandoffProtocol.ts
 *
 * Protocol v2: assetId-based direct download (no ZIP, no popup, no IndexedDB).
 * BOT-World passes assetId + origin via URL params; Studio downloads files directly from BOT-World API.
 */

// ---------------------------------------------------------------------------
//  Origin whitelist — shared across all apps
// ---------------------------------------------------------------------------

/**
 * Origin patterns allowed for handoff communication.
 * Loaded from VITE_HANDOFF_ORIGINS env (comma-separated, supports `*` wildcard).
 * Falls back to localhost-only defaults when env is unset.
 */
const handoffOriginsEnv = (
  import.meta as ImportMeta & { env?: { VITE_HANDOFF_ORIGINS?: string } }
).env?.VITE_HANDOFF_ORIGINS;

export const ALLOWED_HANDOFF_ORIGINS: ReadonlyArray<string> = (
  handoffOriginsEnv || 'http://localhost:*,http://127.0.0.1:*'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

interface ParsedHandoffOrigin {
  hostname: string;
  port: string;
  protocol: string;
}

interface ParsedHandoffOriginPattern extends ParsedHandoffOrigin {
  hostnamePattern: string;
  portPattern: string;
}

function parseHandoffOrigin(value: string): ParsedHandoffOrigin | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    if (url.pathname && url.pathname !== '/') {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return {
      hostname: url.hostname.toLowerCase(),
      port: url.port,
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

function parseHandoffOriginPattern(pattern: string): ParsedHandoffOriginPattern | null {
  const match = pattern.match(/^(https?):\/\/(\[[^\]]+\]|[^/?#@:]+)(?::(\*|\d+))?$/i);
  if (!match) {
    return null;
  }

  return {
    hostname: match[2].toLowerCase(),
    hostnamePattern: match[2].toLowerCase(),
    port: match[3] ?? '',
    portPattern: match[3] ?? '',
    protocol: `${match[1].toLowerCase()}:`,
  };
}

function wildcardPatternMatches(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '[^.]*') + '$', 'i');
  return regex.test(value);
}

function handoffOriginMatchesPattern(
  origin: ParsedHandoffOrigin,
  pattern: ParsedHandoffOriginPattern,
): boolean {
  if (origin.protocol !== pattern.protocol) {
    return false;
  }

  if (
    pattern.hostnamePattern.includes('*')
      ? !wildcardPatternMatches(origin.hostname, pattern.hostnamePattern)
      : origin.hostname !== pattern.hostname
  ) {
    return false;
  }

  return pattern.portPattern === '*' || origin.port === pattern.portPattern;
}

export function normalizeHandoffOrigin(origin: string): string | null {
  const parsed = parseHandoffOrigin(origin);
  if (!parsed) {
    return null;
  }

  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${port}`;
}

/** Check whether an origin matches any allowed pattern (with `*` wildcard support). */
export function isAllowedHandoffOrigin(origin: string): boolean {
  const parsedOrigin = parseHandoffOrigin(origin);
  if (!parsedOrigin) {
    return false;
  }

  return ALLOWED_HANDOFF_ORIGINS.some((pattern) => {
    const parsedPattern = parseHandoffOriginPattern(pattern);
    return parsedPattern ? handoffOriginMatchesPattern(parsedOrigin, parsedPattern) : false;
  });
}

// ---------------------------------------------------------------------------
//  Asset import via URL params
// ---------------------------------------------------------------------------

export const IMPORT_QUERY_PARAM = 'import';
export const FROM_QUERY_PARAM = 'from';
export const IMPORT_PROTOCOL_VERSION = 2;
export const POPUP_HANDOFF_QUERY_PARAM = 'handoff';

export interface AssetImportParams {
  assetId: string;
  fromOrigin: string;
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
  pluginKey?: string;
}

/** Read asset import parameters from a full URL string. Returns null if absent. */
export function readImportParamsFromUrl(url: string): AssetImportParams | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const assetId = resolvedUrl.searchParams.get(IMPORT_QUERY_PARAM)?.trim() ?? '';
  const fromOrigin = resolvedUrl.searchParams.get(FROM_QUERY_PARAM)?.trim() ?? '';
  if (!assetId || !fromOrigin) return null;
  return { assetId, fromOrigin };
}

/** Remove asset import query parameters from a URL string, returning the cleaned URL. */
export function stripImportParamsFromUrl(url: string): string {
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(IMPORT_QUERY_PARAM);
  resolvedUrl.searchParams.delete(FROM_QUERY_PARAM);
  resolvedUrl.searchParams.delete('jwt');
  return resolvedUrl.toString();
}

/** Read the legacy popup handoff ID from a URL string. Returns null if absent. */
export function readHandoffIdFromUrl(url: string): string | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const handoffId = resolvedUrl.searchParams.get(POPUP_HANDOFF_QUERY_PARAM)?.trim() ?? '';
  return handoffId.length > 0 ? handoffId : null;
}

/** Remove the legacy popup handoff query parameter from a URL string. */
export function stripHandoffParamFromUrl(url: string): string {
  const resolvedUrl = new URL(url, 'http://localhost');
  resolvedUrl.searchParams.delete(POPUP_HANDOFF_QUERY_PARAM);
  return resolvedUrl.toString();
}

// ---------------------------------------------------------------------------
//  BroadcastChannel — existing-tab detection for import delegation
// ---------------------------------------------------------------------------

export const HANDOFF_BROADCAST_CHANNEL = 'botworld-handoff';

export type HandoffBroadcastMessage =
  | { type: 'import-request'; assetId: string; fromOrigin: string }
  | { type: 'import-accepted'; assetId: string };

/** How long a new tab waits for an existing tab to claim the import (ms). */
export const HANDOFF_BROADCAST_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------------------
//  Plugin activation via URL params (unchanged from v1)
// ---------------------------------------------------------------------------

export const PLUGIN_QUERY_PARAM = 'plugin';

/** Read the plugin key from a full URL string. Returns null if absent. */
export function readPluginKeyFromUrl(url: string): string | null {
  const resolvedUrl = new URL(url, 'http://localhost');
  const pluginKey = resolvedUrl.searchParams.get(PLUGIN_QUERY_PARAM)?.trim() ?? '';
  return pluginKey.length > 0 ? pluginKey : null;
}

/** Remove the plugin query parameter from a URL string, returning the cleaned URL. */
export function stripPluginParamFromUrl(url: string): string {
  const resolvedUrl = new URL(url);
  resolvedUrl.searchParams.delete(PLUGIN_QUERY_PARAM);
  return resolvedUrl.toString();
}
