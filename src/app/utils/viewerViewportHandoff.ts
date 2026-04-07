import type { DocumentLoadLifecycleState } from '@/store/assetsStore';

interface ViewerViewportHandoffInput {
  isViewerMode: boolean;
  isPreviewing: boolean;
  visualizerMounted: boolean;
  activeFileName: string | null;
  documentLoadState: DocumentLoadLifecycleState;
}

interface ViewerViewportHandoffStartInput extends ViewerViewportHandoffInput {
  wasViewerMode: boolean;
  viewerSceneReady: boolean;
  hasPendingHandoffForScope: boolean;
}

export function isViewerDocumentLoadingForScope(
  activeFileName: string | null,
  documentLoadState: DocumentLoadLifecycleState,
): boolean {
  if (!(documentLoadState.status === 'loading' || documentLoadState.status === 'hydrating')) {
    return false;
  }

  // Import pipelines can surface different path forms for the same file
  // (for example `folder/file.urdf` vs `file.urdf`) across async boundaries.
  // For viewport handoff we only need to know that the active viewer document
  // is loading, so treat basename-equivalent paths as the same scope.
  if (!activeFileName || !documentLoadState.fileName) {
    return true;
  }

  if (documentLoadState.fileName === activeFileName) {
    return true;
  }

  const activeBaseName = activeFileName.replace(/\\/g, '/').split('/').pop();
  const loadingBaseName = documentLoadState.fileName.replace(/\\/g, '/').split('/').pop();
  return Boolean(activeBaseName && loadingBaseName && activeBaseName === loadingBaseName);
}

export function shouldStartViewerViewportHandoff({
  wasViewerMode,
  isViewerMode,
  isPreviewing,
  visualizerMounted,
  activeFileName,
  documentLoadState,
  viewerSceneReady,
  hasPendingHandoffForScope,
}: ViewerViewportHandoffStartInput): boolean {
  if (!isViewerMode || isPreviewing || !visualizerMounted) {
    return false;
  }

  // Entering viewer mode should always begin with a visual handoff so we do
  // not expose the first unpainted viewer frame as a white flash.
  if (!wasViewerMode) {
    return true;
  }

  if (!isViewerDocumentLoadingForScope(activeFileName, documentLoadState)) {
    return false;
  }

  return viewerSceneReady && !hasPendingHandoffForScope;
}

export function shouldContinueViewerViewportHandoff({
  isViewerMode,
  isPreviewing,
  visualizerMounted,
  activeFileName,
  documentLoadState,
}: ViewerViewportHandoffInput): boolean {
  return (
    isViewerMode &&
    !isPreviewing &&
    visualizerMounted &&
    isViewerDocumentLoadingForScope(activeFileName, documentLoadState)
  );
}

interface ViewerViewportHandoffContinuationInput {
  startHandoff: boolean;
  continueHandoff: boolean;
  hasPendingHandoffForScope: boolean;
}

export function shouldKeepExistingViewerViewportHandoff({
  startHandoff,
  continueHandoff,
  hasPendingHandoffForScope,
}: ViewerViewportHandoffContinuationInput): boolean {
  if (startHandoff) {
    return true;
  }

  return continueHandoff && hasPendingHandoffForScope;
}
