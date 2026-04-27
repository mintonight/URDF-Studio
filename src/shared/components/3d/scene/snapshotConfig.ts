import { SNAPSHOT_MIN_LONG_EDGE } from './snapshotResolution';
import type { WorkspaceCameraSnapshot } from '../workspace/workspaceCameraSnapshot';

export const SNAPSHOT_MAX_LONG_EDGE_INPUT = 16384;
export const SNAPSHOT_LONG_EDGE_INPUT_STEP = 64;

export const SNAPSHOT_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type SnapshotImageFormat = (typeof SNAPSHOT_IMAGE_FORMATS)[number];

export const SNAPSHOT_IMAGE_QUALITY_MIN = 60;
export const SNAPSHOT_IMAGE_QUALITY_MAX = 100;
export const SNAPSHOT_IMAGE_QUALITY_STEP = 1;
export const SNAPSHOT_DEFAULT_IMAGE_QUALITY = 96;

export const SNAPSHOT_DETAIL_LEVELS = ['viewport', 'high', 'ultra'] as const;
export type SnapshotDetailLevel = (typeof SNAPSHOT_DETAIL_LEVELS)[number];

export const SNAPSHOT_ENVIRONMENT_PRESETS = ['viewport', 'studio', 'city', 'contrast'] as const;
export type SnapshotEnvironmentPreset = (typeof SNAPSHOT_ENVIRONMENT_PRESETS)[number];

export const SNAPSHOT_SHADOW_STYLES = ['soft', 'balanced', 'crisp'] as const;
export type SnapshotShadowStyle = (typeof SNAPSHOT_SHADOW_STYLES)[number];

export const SNAPSHOT_GROUND_STYLES = ['shadow', 'contact', 'reflective'] as const;
export type SnapshotGroundStyle = (typeof SNAPSHOT_GROUND_STYLES)[number];

export const SNAPSHOT_DOF_MODES = ['off', 'subtle', 'hero'] as const;
export type SnapshotDofMode = (typeof SNAPSHOT_DOF_MODES)[number];

export const SNAPSHOT_BACKGROUND_STYLES = [
  'studio',
  'viewport',
  'sky',
  'dark',
  'transparent',
] as const;
export type SnapshotBackgroundStyle = (typeof SNAPSHOT_BACKGROUND_STYLES)[number];

export interface SnapshotCaptureOptions {
  longEdgePx: number;
  imageFormat: SnapshotImageFormat;
  imageQuality: number;
  detailLevel: SnapshotDetailLevel;
  environmentPreset: SnapshotEnvironmentPreset;
  shadowStyle: SnapshotShadowStyle;
  groundStyle: SnapshotGroundStyle;
  dofMode: SnapshotDofMode;
  backgroundStyle: SnapshotBackgroundStyle;
  hideGrid: boolean;
  cameraSnapshot?: WorkspaceCameraSnapshot | null;
}

export type SnapshotCaptureAction = (options?: Partial<SnapshotCaptureOptions>) => Promise<void>;
export interface SnapshotPreviewResult {
  blob: Blob;
  width: number;
  height: number;
  options: SnapshotCaptureOptions;
}

export type SnapshotPreviewAction = (
  options?: Partial<SnapshotCaptureOptions>,
) => Promise<SnapshotPreviewResult>;

export const DEFAULT_SNAPSHOT_CAPTURE_OPTIONS: SnapshotCaptureOptions = {
  longEdgePx: SNAPSHOT_MIN_LONG_EDGE,
  imageFormat: 'png',
  imageQuality: SNAPSHOT_DEFAULT_IMAGE_QUALITY,
  detailLevel: 'high',
  environmentPreset: 'city',
  shadowStyle: 'balanced',
  groundStyle: 'shadow',
  dofMode: 'off',
  backgroundStyle: 'studio',
  hideGrid: false,
};

export const SNAPSHOT_DETAIL_SHADOW_MAP_SIZE: Record<SnapshotDetailLevel, number | null> = {
  viewport: null,
  high: 2048,
  ultra: 4096,
};

export const SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE: Record<SnapshotDetailLevel, number> = {
  viewport: 1,
  high: 2,
  ultra: 4,
};

function clampPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

export function normalizeSnapshotLongEdgePx(value: number) {
  return Math.min(
    SNAPSHOT_MAX_LONG_EDGE_INPUT,
    Math.max(512, clampPositiveInteger(value, SNAPSHOT_MIN_LONG_EDGE)),
  );
}

export function normalizeSnapshotImageQuality(value: number | null | undefined) {
  const fallback = SNAPSHOT_DEFAULT_IMAGE_QUALITY;
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    SNAPSHOT_IMAGE_QUALITY_MAX,
    Math.max(SNAPSHOT_IMAGE_QUALITY_MIN, clampPositiveInteger(value, fallback)),
  );
}

export function normalizeSnapshotCaptureOptions(
  options?: Partial<SnapshotCaptureOptions> | null,
): SnapshotCaptureOptions {
  const longEdgePx = normalizeSnapshotLongEdgePx(
    options?.longEdgePx ?? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.longEdgePx,
  );

  const imageFormat = SNAPSHOT_IMAGE_FORMATS.includes(options?.imageFormat as SnapshotImageFormat)
    ? (options?.imageFormat as SnapshotImageFormat)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageFormat;
  const imageQuality = normalizeSnapshotImageQuality(options?.imageQuality);

  const detailLevel = SNAPSHOT_DETAIL_LEVELS.includes(options?.detailLevel as SnapshotDetailLevel)
    ? (options?.detailLevel as SnapshotDetailLevel)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.detailLevel;

  const environmentPreset = SNAPSHOT_ENVIRONMENT_PRESETS.includes(
    options?.environmentPreset as SnapshotEnvironmentPreset,
  )
    ? (options?.environmentPreset as SnapshotEnvironmentPreset)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.environmentPreset;

  const shadowStyle = SNAPSHOT_SHADOW_STYLES.includes(options?.shadowStyle as SnapshotShadowStyle)
    ? (options?.shadowStyle as SnapshotShadowStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.shadowStyle;

  const groundStyle = SNAPSHOT_GROUND_STYLES.includes(options?.groundStyle as SnapshotGroundStyle)
    ? (options?.groundStyle as SnapshotGroundStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.groundStyle;

  const requestedBackgroundStyle = SNAPSHOT_BACKGROUND_STYLES.includes(
    options?.backgroundStyle as SnapshotBackgroundStyle,
  )
    ? (options?.backgroundStyle as SnapshotBackgroundStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle;
  const backgroundStyle =
    imageFormat === 'jpeg' && requestedBackgroundStyle === 'transparent'
      ? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle
      : requestedBackgroundStyle;
  const requestedDofMode = SNAPSHOT_DOF_MODES.includes(options?.dofMode as SnapshotDofMode)
    ? (options?.dofMode as SnapshotDofMode)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.dofMode;
  const dofMode = backgroundStyle === 'transparent' ? 'off' : requestedDofMode;

  return {
    longEdgePx,
    imageFormat,
    imageQuality,
    detailLevel,
    environmentPreset,
    shadowStyle,
    groundStyle,
    dofMode,
    backgroundStyle,
    hideGrid: options?.hideGrid ?? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.hideGrid,
    cameraSnapshot: options?.cameraSnapshot ?? null,
  };
}

export function getSnapshotFileExtension(format: SnapshotImageFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

export function getSnapshotMimeType(format: SnapshotImageFormat) {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}
