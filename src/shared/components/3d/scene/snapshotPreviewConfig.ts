import { normalizeSnapshotCaptureOptions, type SnapshotCaptureOptions } from './snapshotConfig';

const SNAPSHOT_PREVIEW_LONG_EDGE = 800;

export function resolveSnapshotPreviewCaptureOptions(
  options?: Partial<SnapshotCaptureOptions> | null,
): SnapshotCaptureOptions {
  const normalized = normalizeSnapshotCaptureOptions(options);

  return {
    ...normalized,
    longEdgePx: SNAPSHOT_PREVIEW_LONG_EDGE,
    detailLevel: normalized.detailLevel === 'ultra' ? 'high' : normalized.detailLevel,
  };
}
