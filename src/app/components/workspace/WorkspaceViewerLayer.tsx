import { lazy, Suspense, type ComponentProps, type CSSProperties } from 'react';

import { ConnectedDocumentLoadingOverlay } from '../ConnectedDocumentLoadingOverlay';
import { ImportPreparationOverlay } from '../ImportPreparationOverlay';
import type { Language } from '@/shared/i18n';

const UnifiedViewer = lazy(() =>
  import('../UnifiedViewer').then((module) => ({ default: module.UnifiedViewer })),
);

type UnifiedViewerProps = ComponentProps<(typeof import('../UnifiedViewer'))['UnifiedViewer']>;

interface WorkspaceImportPreparationOverlay {
  label: string;
  detail?: string;
  progress?: number | null;
  statusLabel?: string | null;
  stageLabel?: string | null;
}

interface WorkspaceViewerLayerProps {
  className: string;
  style?: CSSProperties;
  viewerProps: UnifiedViewerProps;
  documentLoadingOverlayLang: Language;
  documentLoadingOverlayTargetFileName: string | null;
  importPreparationOverlay?: WorkspaceImportPreparationOverlay | null;
}

export function WorkspaceViewerLayer({
  className,
  style,
  viewerProps,
  documentLoadingOverlayLang,
  documentLoadingOverlayTargetFileName,
  importPreparationOverlay = null,
}: WorkspaceViewerLayerProps) {
  return (
    <div className={className} style={style}>
      <Suspense
        fallback={
          <div className="flex-1 h-full bg-google-light-bg dark:bg-app-bg animate-pulse" />
        }
      >
        <UnifiedViewer {...viewerProps} />
      </Suspense>
      <ConnectedDocumentLoadingOverlay
        lang={documentLoadingOverlayLang}
        targetFileName={documentLoadingOverlayTargetFileName}
      />
      {importPreparationOverlay ? (
        <ImportPreparationOverlay
          label={importPreparationOverlay.label}
          detail={importPreparationOverlay.detail}
          progress={importPreparationOverlay.progress}
          statusLabel={importPreparationOverlay.statusLabel}
          stageLabel={importPreparationOverlay.stageLabel}
          placement="viewer-corner"
        />
      ) : null}
    </div>
  );
}
