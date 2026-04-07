export type UnifiedViewerActiveScene = 'viewer' | 'visualizer';

interface UnifiedViewerWorkspaceLeaveOptions {
  activeScene: UnifiedViewerActiveScene;
  clearHover: () => void;
  handleViewerMouseUp: () => void;
  handleVisualizerMouseUp: () => void;
}

export function handleUnifiedViewerWorkspaceLeave({
  activeScene,
  clearHover,
  handleViewerMouseUp,
  handleVisualizerMouseUp,
}: UnifiedViewerWorkspaceLeaveOptions): void {
  if (activeScene === 'viewer') {
    handleViewerMouseUp();
    clearHover();
    return;
  }

  handleVisualizerMouseUp();
  clearHover();
}
