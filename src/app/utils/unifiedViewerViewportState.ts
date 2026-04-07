import type { DocumentLoadLifecycleState } from '@/store/assetsStore';
import {
  shouldKeepExistingViewerViewportHandoff,
  shouldContinueViewerViewportHandoff,
  shouldStartViewerViewportHandoff,
  isViewerDocumentLoadingForScope,
} from './viewerViewportHandoff';
import { resolveUnifiedViewerSceneMode } from './unifiedViewerSceneMode';
import type { UnifiedViewerMode, UnifiedViewerMountState } from './unifiedViewerMountState';

interface ResolveUnifiedViewerViewportStateArgs {
  mode: UnifiedViewerMode;
  isViewerMode: boolean;
  isPreviewing: boolean;
  mountState: UnifiedViewerMountState;
  previousIsViewerMode: boolean;
  viewerSceneReady: boolean;
  activeViewportFileName: string | null;
  viewerReloadKey: number;
  pendingViewerLoadScopeKey: string | null;
  releasedViewerLoadScopeKey: string | null;
  documentLoadState: DocumentLoadLifecycleState;
  shouldUseVisualizerViewportHandoff?: boolean;
}

export interface UnifiedViewerViewportState {
  activeViewerDocumentStillLoading: boolean;
  viewerLoadScopeKey: string;
  hasPendingViewerHandoffForScope: boolean;
  hasUnreleasedViewerLoadScope: boolean;
  visualizerAvailableForViewportHandoff: boolean;
  startViewerViewportHandoff: boolean;
  continueViewerViewportHandoff: boolean;
  keepExistingViewerViewportHandoff: boolean;
  displayVisualizerWhileViewerLoads: boolean;
  keepViewerMountedDuringHandoff: boolean;
  viewerVisible: boolean;
  visualizerVisible: boolean;
  shouldRenderViewerScene: boolean;
  shouldRenderVisualizerScene: boolean;
  activeScene: 'viewer' | 'visualizer';
  useViewerCanvasPresentation: boolean;
  visualizerRuntimeMode: UnifiedViewerMode;
}

export function resolveUnifiedViewerViewportState({
  mode,
  isViewerMode,
  isPreviewing,
  mountState,
  previousIsViewerMode,
  viewerSceneReady,
  activeViewportFileName,
  viewerReloadKey,
  pendingViewerLoadScopeKey,
  releasedViewerLoadScopeKey,
  documentLoadState,
  shouldUseVisualizerViewportHandoff = false,
}: ResolveUnifiedViewerViewportStateArgs): UnifiedViewerViewportState {
  const activeViewerDocumentStillLoading =
    isViewerMode &&
    !isPreviewing &&
    isViewerDocumentLoadingForScope(activeViewportFileName, documentLoadState);
  const viewerLoadScopeKey = activeViewportFileName
    ? `${activeViewportFileName}:${viewerReloadKey}`
    : `viewer-reload:${viewerReloadKey}`;
  const hasPendingViewerHandoffForScope = pendingViewerLoadScopeKey === viewerLoadScopeKey;
  const hasUnreleasedViewerLoadScope = releasedViewerLoadScopeKey !== viewerLoadScopeKey;
  const visualizerAvailableForViewportHandoff =
    mountState.visualizerMounted ||
    activeViewerDocumentStillLoading ||
    hasUnreleasedViewerLoadScope;
  const shouldManageVisualizerViewportHandoff = shouldUseVisualizerViewportHandoff;
  const startViewerViewportHandoff =
    shouldManageVisualizerViewportHandoff &&
    shouldStartViewerViewportHandoff({
      wasViewerMode: previousIsViewerMode,
      isViewerMode,
      isPreviewing,
      visualizerMounted: visualizerAvailableForViewportHandoff,
      viewerSceneReady,
      hasPendingHandoffForScope: hasPendingViewerHandoffForScope,
      activeFileName: activeViewportFileName,
      documentLoadState,
    });
  const continueViewerViewportHandoff =
    shouldManageVisualizerViewportHandoff &&
    shouldContinueViewerViewportHandoff({
      isViewerMode,
      isPreviewing,
      visualizerMounted: visualizerAvailableForViewportHandoff,
      activeFileName: activeViewportFileName,
      documentLoadState,
    });
  const keepExistingViewerViewportHandoff = shouldKeepExistingViewerViewportHandoff({
    startHandoff: startViewerViewportHandoff,
    continueHandoff: continueViewerViewportHandoff,
    hasPendingHandoffForScope: hasPendingViewerHandoffForScope,
  });
  const displayVisualizerWhileViewerLoads =
    isViewerMode &&
    !isPreviewing &&
    shouldUseVisualizerViewportHandoff &&
    visualizerAvailableForViewportHandoff &&
    (hasUnreleasedViewerLoadScope ||
      keepExistingViewerViewportHandoff ||
      (hasPendingViewerHandoffForScope && !viewerSceneReady));
  const keepViewerMountedDuringHandoff = displayVisualizerWhileViewerLoads;
  const viewerVisible = isViewerMode && !displayVisualizerWhileViewerLoads;
  const visualizerVisible = !isViewerMode || displayVisualizerWhileViewerLoads;
  const shouldRenderViewerScene =
    mountState.viewerMounted || viewerVisible || keepViewerMountedDuringHandoff;
  const shouldRenderVisualizerScene = mountState.visualizerMounted || visualizerVisible;
  const activeScene = viewerVisible ? 'viewer' : 'visualizer';
  const useViewerCanvasPresentation = viewerVisible || displayVisualizerWhileViewerLoads;
  const visualizerRuntimeMode: UnifiedViewerMode = displayVisualizerWhileViewerLoads
    ? resolveUnifiedViewerSceneMode(mode)
    : mode;

  return {
    activeViewerDocumentStillLoading,
    viewerLoadScopeKey,
    hasPendingViewerHandoffForScope,
    hasUnreleasedViewerLoadScope,
    visualizerAvailableForViewportHandoff,
    startViewerViewportHandoff,
    continueViewerViewportHandoff,
    keepExistingViewerViewportHandoff,
    displayVisualizerWhileViewerLoads,
    keepViewerMountedDuringHandoff,
    viewerVisible,
    visualizerVisible,
    shouldRenderViewerScene,
    shouldRenderVisualizerScene,
    activeScene,
    useViewerCanvasPresentation,
    visualizerRuntimeMode,
  };
}
