import type { SnapshotCaptureAction } from '@/shared/components/3d';

interface ResolveSnapshotCaptureActionOptions {
  liveCaptureAction: SnapshotCaptureAction | null;
  frozenPreviewCaptureAction: SnapshotCaptureAction | null;
  preferFrozenPreviewCapture: boolean;
}

export function resolveSnapshotCaptureAction({
  liveCaptureAction,
  frozenPreviewCaptureAction,
  preferFrozenPreviewCapture,
}: ResolveSnapshotCaptureActionOptions): SnapshotCaptureAction | null {
  return preferFrozenPreviewCapture ? frozenPreviewCaptureAction : liveCaptureAction;
}
