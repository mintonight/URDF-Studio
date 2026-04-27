import React, { useEffect, useMemo } from 'react';
import { AlertCircle, FileCode, LoaderCircle, Plus } from 'lucide-react';

import { DraggableWindow } from '@/shared/components';
import { useDraggableWindow } from '@/shared/hooks';
import { translations } from '@/shared/i18n';
import {
  classifyLibraryFileKind,
  isLibraryComponentAddableFile,
} from '@/shared/utils/robotFileSupport';
import type { Language } from '@/store';
import type { DocumentLoadLifecycleState, DocumentLoadState } from '@/store/assetsStore';
import type { RobotFile, RobotState, Theme } from '@/types';

const LazyUnifiedViewer = React.lazy(async () => ({
  default: (await import('./UnifiedViewer')).UnifiedViewer,
}));

interface FilePreviewWindowProps {
  file: RobotFile | null;
  previewRobot: RobotState | null;
  previewState?: { urdfContent: string; fileName: string };
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
  documentLoadState: DocumentLoadState;
  lang: Language;
  theme: Theme;
  onClose: () => void;
  onAddComponent?: (file: RobotFile) => void;
}

function normalizeAssetPath(path: string): string {
  return path.replace(/^\/+/, '');
}

function resolveAssetUrl(path: string, assets: Record<string, string>): string | null {
  const normalizedPath = normalizeAssetPath(path);
  return assets[path] ?? assets[normalizedPath] ?? assets[`/${normalizedPath}`] ?? null;
}

function resolvePreviewDocumentLoadLifecycleState(file: RobotFile): DocumentLoadLifecycleState {
  return {
    status: 'ready',
    fileName: file.name,
    format: file.format,
  };
}

export function FilePreviewWindow({
  file,
  previewRobot,
  previewState,
  assets,
  allFileContents,
  availableFiles,
  documentLoadState,
  lang,
  theme,
  onClose,
  onAddComponent,
}: FilePreviewWindowProps) {
  const t = translations[lang];
  const isOpen = Boolean(file);
  const windowState = useDraggableWindow({
    isOpen,
    defaultPosition: { x: 180, y: 120 },
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 420, height: 320 },
    centerOnMount: true,
    enableMinimize: true,
    enableMaximize: true,
    clampResizeToViewport: false,
    dragBounds: {
      allowNegativeX: true,
      minVisibleWidth: 120,
      bottomMargin: 50,
    },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const fileKind = file ? classifyLibraryFileKind(file) : null;
  const imageUrl = useMemo(() => {
    if (!file || fileKind !== 'image') {
      return null;
    }

    return resolveAssetUrl(file.name, assets);
  }, [assets, file, fileKind]);

  const previewLoadState = useMemo(() => {
    if (!file || documentLoadState.fileName !== file.name) {
      return 'idle' as const;
    }

    if (documentLoadState.status === 'loading' || documentLoadState.status === 'hydrating') {
      return 'loading' as const;
    }

    if (documentLoadState.status === 'error') {
      return 'error' as const;
    }

    return 'ready' as const;
  }, [documentLoadState.fileName, documentLoadState.status, file]);

  const previewLifecycleState = useMemo(
    () => (file ? resolvePreviewDocumentLoadLifecycleState(file) : null),
    [file],
  );

  if (!file) {
    return null;
  }

  const displayName = file.name.split('/').pop() ?? file.name;
  const canRender3dPreview = Boolean(
    previewState?.urdfContent && previewRobot && fileKind !== 'image',
  );
  const canAddComponent = Boolean(onAddComponent && isLibraryComponentAddableFile(file));
  const showLoadingState = previewLoadState === 'loading' && !canRender3dPreview && !imageUrl;
  const errorMessage =
    previewLoadState === 'error' ? (documentLoadState.error ?? t.noPreviewImage) : t.noPreviewImage;

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <FileCode className="h-4 w-4 text-system-blue" />
          <span className="max-w-[320px] truncate" title={file.name}>
            {t.filePreview}: {displayName}
          </span>
        </div>
      }
      headerActions={
        canAddComponent ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40"
            onClick={() => onAddComponent?.(file)}
            title={t.addComponent}
            aria-label={t.addComponent}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>{t.add}</span>
          </button>
        ) : null
      }
      className="z-[110] flex flex-col overflow-hidden rounded-lg border border-border-black bg-panel-bg shadow-2xl"
      headerClassName="flex h-11 items-center justify-between border-b border-border-black bg-element-bg px-3"
      showResizeHandles
      closeTitle={t.closePreview}
      maximizeTitle={t.expand}
      restoreTitle={t.collapse}
      minimizeTitle={t.minimize}
    >
      <div className="relative flex-1 min-h-0 bg-google-light-bg dark:bg-black">
        {canRender3dPreview && previewState && previewRobot && previewLifecycleState ? (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
                <LoaderCircle className="h-6 w-6 animate-spin" />
                <span className="text-sm">{t.loadingRobot}</span>
              </div>
            }
          >
            <LazyUnifiedViewer
              robot={previewRobot}
              editorRobot={previewRobot}
              mode="editor"
              onSelect={() => {}}
              onUpdate={() => {}}
              assets={assets}
              allFileContents={allFileContents}
              lang={lang}
              theme={theme}
              showVisual={true}
              showOptionsPanel={false}
              showJointPanel={false}
              availableFiles={availableFiles}
              urdfContent={previewState.urdfContent}
              sourceFilePath={file.name}
              sourceFile={file}
              selection={previewRobot.selection}
              isMeshPreview={file.format === 'mesh'}
              documentLoadState={previewLifecycleState}
              showUsageGuide={false}
            />
          </React.Suspense>
        ) : imageUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={imageUrl}
              alt={displayName}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>
        ) : showLoadingState ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <LoaderCircle className="h-6 w-6 animate-spin" />
            <span className="text-sm">{t.loadingRobot}</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-text-tertiary">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
