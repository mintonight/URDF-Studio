export const WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX = 6;

interface WorkspacePointerMissDragOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thresholdPx?: number;
}

export function shouldSuppressWorkspacePointerMissAfterDrag({
  startX,
  startY,
  endX,
  endY,
  thresholdPx = WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX,
}: WorkspacePointerMissDragOptions): boolean {
  const dx = endX - startX;
  const dy = endY - startY;

  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}
