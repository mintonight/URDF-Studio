import { useCallback } from 'react';
import type { SnapshotCaptureAction, SnapshotCaptureOptions } from '@/shared/components/3d';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import { resolveSnapshotCaptureAction } from '../components/snapshot-preview/resolveSnapshotCaptureAction';
import type { SnapshotPreviewSession } from '../components/snapshot-preview/types';

interface SnapshotCaptureActionRef {
  current: SnapshotCaptureAction | null;
}

interface UseSnapshotCaptureRequestParams {
  liveCaptureActionRef: SnapshotCaptureActionRef;
  frozenPreviewCaptureActionRef: SnapshotCaptureActionRef;
  snapshotPreviewSession: SnapshotPreviewSession | null;
  setIsSnapshotCapturing: (isCapturing: boolean) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  snapshotFailedMessage: string;
}

export function useSnapshotCaptureRequest({
  liveCaptureActionRef,
  frozenPreviewCaptureActionRef,
  snapshotPreviewSession,
  setIsSnapshotCapturing,
  showToast,
  snapshotFailedMessage,
}: UseSnapshotCaptureRequestParams) {
  return useCallback(
    async (options: SnapshotCaptureOptions) => {
      const resolvedCaptureAction = resolveSnapshotCaptureAction({
        liveCaptureAction: liveCaptureActionRef.current,
        frozenPreviewCaptureAction: frozenPreviewCaptureActionRef.current,
        preferFrozenPreviewCapture: Boolean(snapshotPreviewSession),
      });

      if (!resolvedCaptureAction) {
        showToast(snapshotFailedMessage, 'info');
        return;
      }

      try {
        setIsSnapshotCapturing(true);
        await resolvedCaptureAction.action({
          ...options,
          cameraSnapshot:
            resolvedCaptureAction.source === 'live'
              ? (snapshotPreviewSession?.cameraSnapshot ?? null)
              : null,
        });
      } catch (error) {
        logRegressionError('Snapshot failed:', error);
        showToast(snapshotFailedMessage, 'info');
      } finally {
        setIsSnapshotCapturing(false);
      }
    },
    [
      frozenPreviewCaptureActionRef,
      liveCaptureActionRef,
      setIsSnapshotCapturing,
      showToast,
      snapshotFailedMessage,
      snapshotPreviewSession,
    ],
  );
}
