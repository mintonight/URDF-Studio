import React from 'react';

import type { Language } from '@/shared/i18n';
import type { URDFViewerController } from '@/features/urdf-viewer/hooks/useURDFViewerController';

import { FilePreviewBanner, FilePreviewError } from './FilePreviewOverlay';
import { LazyViewerJointsPanel, LazyViewerPanels, LazyVisualizerPanels } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerOverlaysProps {
  activePreview?: FilePreviewState;
  activeScene: 'viewer' | 'visualizer';
  lang: Language;
  onClosePreview?: () => void;
  viewerController: URDFViewerController;
  visualizerController: ReturnType<typeof import('@/features/visualizer').useVisualizerController>;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  showToolbar?: boolean;
  setShowToolbar?: (show: boolean) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showVisualizerOptionsPanel?: boolean;
  setShowVisualizerOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  isViewerMode: boolean;
}

export function UnifiedViewerOverlays({
  activePreview,
  activeScene,
  lang,
  onClosePreview,
  viewerController,
  visualizerController,
  onUpdate,
  showToolbar,
  setShowToolbar,
  showOptionsPanel,
  setShowOptionsPanel,
  showVisualizerOptionsPanel,
  setShowVisualizerOptionsPanel,
  showJointPanel,
  setShowJointPanel,
  isViewerMode,
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

  if (activeScene === 'viewer') {
    return (
      <>
        <React.Suspense fallback={null}>
          <LazyViewerPanels
            lang={lang}
            controller={viewerController}
            onUpdate={onUpdate}
            showToolbar={showToolbar}
            setShowToolbar={setShowToolbar}
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
            />
          </React.Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <React.Suspense fallback={null}>
        <LazyVisualizerPanels
          lang={lang}
          showOptionsPanel={showVisualizerOptionsPanel}
          setShowOptionsPanel={setShowVisualizerOptionsPanel}
          controller={visualizerController}
        />
      </React.Suspense>
      {showJointPanel && isViewerMode && (
        <React.Suspense fallback={null}>
          <LazyViewerJointsPanel
            controller={viewerController}
            showJointPanel={true}
            setShowJointPanel={setShowJointPanel}
            lang={lang}
          />
        </React.Suspense>
      )}
    </>
  );
}
