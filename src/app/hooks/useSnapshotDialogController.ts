import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RootState } from '@react-three/fiber';
import type { SnapshotCaptureAction } from '@/shared/components/3d/scene/snapshotConfig';
import type { RobotFile } from '@/types';
import type { SnapshotPreviewSession } from '../components/snapshot-preview/types';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

interface UseSnapshotDialogControllerParams {
  availableFiles: RobotFile[];
  groundPlaneOffset: number;
  jointAngleState?: SnapshotPreviewSession['jointAngleState'];
  jointMotionState?: SnapshotPreviewSession['jointMotionState'];
  selectedFileFormat: RobotFile['format'] | null;
  showVisual: boolean;
  theme: SnapshotPreviewSession['theme'];
  urdfContentForViewer: string;
  viewerAssets: Record<string, string>;
  viewerCanvasStateRef: MutableRefObject<RootState | null>;
  viewerReloadKey: number;
  viewerRobot: SnapshotPreviewSession['robot'];
  viewerSourceFile: RobotFile | null;
  viewerSourceFilePath?: string;
  viewerSourceFormat?: SnapshotPreviewSession['viewerSourceFormat'];
  snapshotPreviewCaptureActionRef: MutableRefObject<SnapshotCaptureAction | null>;
  setIsSnapshotDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSnapshotPreviewSession: Dispatch<SetStateAction<SnapshotPreviewSession | null>>;
}

export function useSnapshotDialogController({
  availableFiles,
  groundPlaneOffset,
  jointAngleState,
  jointMotionState,
  selectedFileFormat,
  showVisual,
  theme,
  urdfContentForViewer,
  viewerAssets,
  viewerCanvasStateRef,
  viewerReloadKey,
  viewerRobot,
  viewerSourceFile,
  viewerSourceFilePath,
  viewerSourceFormat,
  snapshotPreviewCaptureActionRef,
  setIsSnapshotDialogOpen,
  setSnapshotPreviewSession,
}: UseSnapshotDialogControllerParams) {
  const handleCloseSnapshotDialog = useCallback(() => {
    setIsSnapshotDialogOpen(false);
    setSnapshotPreviewSession(null);
    snapshotPreviewCaptureActionRef.current = null;
  }, [setIsSnapshotDialogOpen, setSnapshotPreviewSession, snapshotPreviewCaptureActionRef]);

  const handleSnapshotPreviewCaptureActionChange = useCallback(
    (action: SnapshotCaptureAction | null) => {
      snapshotPreviewCaptureActionRef.current = action;
    },
    [snapshotPreviewCaptureActionRef],
  );

  const handleSnapshot = useCallback(async () => {
    const viewerCanvasState = viewerCanvasStateRef.current;
    let cameraSnapshot: SnapshotPreviewSession['cameraSnapshot'] = null;
    if (viewerCanvasState) {
      try {
        const { captureWorkspaceCameraSnapshot } = await import(
          '@/shared/components/3d/workspace/workspaceCameraSnapshot'
        );
        const viewportElement =
          viewerCanvasState.gl.domElement.parentElement ?? viewerCanvasState.gl.domElement;
        cameraSnapshot = captureWorkspaceCameraSnapshot(viewerCanvasState, viewportElement);
      } catch (error) {
        logRegressionError('[AppLayout] Failed to capture workspace camera snapshot:', error);
      }
    }
    const viewportAspectRatio =
      cameraSnapshot?.visibleViewport?.aspectRatio ??
      cameraSnapshot?.aspectRatio ??
      (viewerCanvasState?.size.width && viewerCanvasState.size.height
        ? viewerCanvasState.size.width / viewerCanvasState.size.height
        : 16 / 9);

    snapshotPreviewCaptureActionRef.current = null;
    setSnapshotPreviewSession({
      theme,
      cameraSnapshot,
      viewportAspectRatio,
      robotName: viewerRobot.name || 'robot',
      robot: viewerRobot,
      assets: viewerAssets,
      availableFiles,
      urdfContent: urdfContentForViewer,
      viewerSourceFormat,
      sourceFilePath: viewerSourceFilePath,
      sourceFile: viewerSourceFile,
      jointAngleState,
      jointMotionState,
      showVisual,
      isMeshPreview: selectedFileFormat === 'mesh',
      viewerReloadKey,
      groundPlaneOffset,
    });
    setIsSnapshotDialogOpen(true);
  }, [
    availableFiles,
    groundPlaneOffset,
    jointAngleState,
    jointMotionState,
    selectedFileFormat,
    setIsSnapshotDialogOpen,
    setSnapshotPreviewSession,
    showVisual,
    snapshotPreviewCaptureActionRef,
    theme,
    urdfContentForViewer,
    viewerAssets,
    viewerCanvasStateRef,
    viewerReloadKey,
    viewerRobot,
    viewerSourceFile,
    viewerSourceFilePath,
    viewerSourceFormat,
  ]);

  return {
    handleCloseSnapshotDialog,
    handleSnapshotPreviewCaptureActionChange,
    handleSnapshot,
  };
}
