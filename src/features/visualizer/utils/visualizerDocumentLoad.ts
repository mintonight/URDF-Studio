export interface VisualizerDocumentLoadEvent {
  status: 'loading' | 'ready';
  phase: 'preparing-scene' | 'streaming-meshes' | 'ready';
  message: null;
  progressMode: 'indeterminate' | 'count' | 'percent';
  progressPercent: number | null;
  loadedCount: number | null;
  totalCount: number | null;
  error: null;
}

export function buildVisualizerDocumentLoadEvent({
  resolvedCount,
  totalCount,
}: {
  resolvedCount: number;
  totalCount: number;
}): VisualizerDocumentLoadEvent {
  const safeTotalCount = Number.isFinite(totalCount) ? Math.max(0, Math.round(totalCount)) : 0;
  const safeResolvedCount = Number.isFinite(resolvedCount)
    ? Math.max(0, Math.round(resolvedCount))
    : 0;

  if (safeTotalCount <= 0) {
    return {
      status: 'ready',
      phase: 'ready',
      message: null,
      progressMode: 'percent',
      progressPercent: 100,
      loadedCount: null,
      totalCount: null,
      error: null,
    };
  }

  if (safeResolvedCount >= safeTotalCount) {
    return {
      status: 'ready',
      phase: 'ready',
      message: null,
      progressMode: 'percent',
      progressPercent: 100,
      loadedCount: safeTotalCount,
      totalCount: safeTotalCount,
      error: null,
    };
  }

  return {
    status: 'loading',
    phase: safeResolvedCount === 0 ? 'preparing-scene' : 'streaming-meshes',
    message: null,
    progressMode: safeResolvedCount === 0 ? 'indeterminate' : 'count',
    progressPercent: null,
    loadedCount: safeResolvedCount,
    totalCount: safeTotalCount,
    error: null,
  };
}
