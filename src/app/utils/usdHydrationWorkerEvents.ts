import type { UsdOffscreenViewerWorkerResponse } from '@/features/urdf-viewer/utils/usdOffscreenViewerProtocol';
import type { ViewerDocumentLoadEvent } from '@/features/urdf-viewer/types';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';

interface HandleUsdHydrationWorkerEventOptions {
  commitHydrationLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
}

export function handleUsdHydrationWorkerEvent(
  event: UsdOffscreenViewerWorkerResponse,
  options: HandleUsdHydrationWorkerEventOptions = {},
): void {
  if (event.type === 'document-load') {
    options.commitHydrationLoadEvent?.(event.event);
    return;
  }

  if (event.type === 'load-debug') {
    recordUsdStageLoadDebug(event.entry);
  }
}
