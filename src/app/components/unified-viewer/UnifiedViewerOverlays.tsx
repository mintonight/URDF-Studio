import React from 'react';

import type { Language } from '@/shared/i18n';
import type { ViewerController } from '@/features/editor';

import { FilePreviewBanner, FilePreviewError } from './FilePreviewOverlay';
import { LazyViewerJointsPanel, LazyViewerPanels } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerOverlaysProps {
  activePreview?: FilePreviewState;
  lang: Language;
  onClosePreview?: () => void;
  viewerController: ViewerController;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
}

export function UnifiedViewerOverlays({
  activePreview,
  lang,
  onClosePreview,
  viewerController,
  onUpdate,
  showOptionsPanel,
  setShowOptionsPanel,
  showJointPanel,
  setShowJointPanel,
}: UnifiedViewerOverlaysProps) {
  if (activePreview) {
    return (
      <>
        <FilePreviewBanner
          fileName={activePreview.fileName}
          onClose={() => onClosePreview?.()}
          lang={lang}
        />
        {!activePreview.urdfContent && <FilePreviewError lang={lang} />}
      </>
    );
  }

  return (
    <>
      <React.Suspense fallback={null}>
        <LazyViewerPanels
          lang={lang}
          controller={viewerController}
          onUpdate={onUpdate}
          showOptionsPanel={showOptionsPanel}
          setShowOptionsPanel={setShowOptionsPanel}
          showJointPanel={false}
          preferEdgeDockedOptionsPanel={true}
        />
      </React.Suspense>
      {showJointPanel && (
        <React.Suspense fallback={null}>
          <LazyViewerJointsPanel
            controller={viewerController}
            showJointPanel={true}
            setShowJointPanel={setShowJointPanel}
            lang={lang}
            onUpdate={onUpdate}
          />
        </React.Suspense>
      )}
    </>
  );
}
