import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  WorkspaceCanvas,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  SnapshotExportLook,
  useWorkspaceCanvasTheme,
} from '@/shared/components/3d';
import { translations, type Language } from '@/shared/i18n';
import { useViewerController } from '@/features/editor';
import { resolveDefaultViewerToolMode } from '@/features/editor';
import { buildUnifiedViewerResourceScopes } from '@/app/utils/unifiedViewerResourceScopes';
import { ViewerSceneConnector } from '../unified-viewer/ViewerSceneConnector';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { subscribeRobotGroundPlaneInvalidation } from '@/store/robotGroundPlaneInvalidation';

import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './types';

interface SnapshotPreviewRendererProps {
  isOpen: boolean;
  lang: Language;
  session: SnapshotPreviewSession | null;
  options: SnapshotCaptureOptions;
  onStateChange: (state: SnapshotDialogPreviewState) => void;
  onCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
  className?: string;
}

const SNAPSHOT_PREVIEW_BACKGROUND: Record<
  Exclude<SnapshotCaptureOptions['backgroundStyle'], 'viewport'>,
  { light: string; dark: string }
> = {
  studio: { light: '#f7f9fc', dark: '#dfe7f1' },
  sky: { light: '#dbeafe', dark: '#dbeafe' },
  dark: { light: '#111827', dark: '#111827' },
  transparent: { light: '#f8fafc', dark: '#111827' },
};

function resolvePreviewBackground(backgroundStyle: SnapshotCaptureOptions['backgroundStyle']) {
  return backgroundStyle === 'viewport'
    ? WORKSPACE_CANVAS_BACKGROUND
    : SNAPSHOT_PREVIEW_BACKGROUND[backgroundStyle];
}

function SnapshotPreviewLook({
  options,
  session,
}: {
  options: SnapshotCaptureOptions;
  session: SnapshotPreviewSession;
}) {
  const snapshotRenderActive = useSnapshotRenderActive();

  if (snapshotRenderActive) {
    return null;
  }

  return (
    <SnapshotExportLook
      options={options}
      theme={session.theme}
      groundOffset={session.groundPlaneOffset}
    />
  );
}

export function SnapshotPreviewRenderer({
  isOpen,
  lang,
  session,
  options,
  onStateChange,
  onCaptureActionChange,
  className = 'relative h-full w-full',
}: SnapshotPreviewRendererProps) {
  const t = translations[lang];
  const previousViewerResourceScopeRef = useRef<
    ReturnType<typeof buildUnifiedViewerResourceScopes>['viewerResourceScope'] | null
  >(null);
  const effectiveTheme = useWorkspaceCanvasTheme(session?.theme ?? 'light');
  const previewBackground = useMemo(
    () => resolvePreviewBackground(options.backgroundStyle),
    [options.backgroundStyle],
  );
  const previewEnvironment = options.environmentPreset === 'viewport' ? 'studio' : 'none';
  const emitState = useCallback(
    (status: SnapshotDialogPreviewState['status']) => {
      onStateChange({
        status,
        imageUrl: null,
        aspectRatio: session?.viewportAspectRatio ?? 16 / 9,
      });
    },
    [onStateChange, session?.viewportAspectRatio],
  );
  const handleCaptureActionChange = useCallback(
    (action: SnapshotCaptureAction | null) => {
      onCaptureActionChange?.(action);
      if (action) {
        emitState('ready');
      }
    },
    [emitState, onCaptureActionChange],
  );

  const controller = useViewerController({
    active: false,
    showJointPanel: false,
    jointAngleState: session?.jointAngleState,
    jointMotionState: session?.jointMotionState,
    showVisual: session?.showVisual ?? true,
    groundPlaneOffset: session?.groundPlaneOffset ?? 0,
    groundPlaneOffsetReadOnly: true,
    defaultToolMode: resolveDefaultViewerToolMode(session?.sourceFile?.format),
    toolModeScopeKey: session?.sourceFile?.name
      ? `snapshot-preview:${session.sourceFile.name}`
      : 'snapshot-preview:inline',
  });

  const viewerResourceScope = useMemo(() => {
    const next = buildUnifiedViewerResourceScopes({
      activePreview: undefined,
      urdfContent: session?.urdfContent ?? '',
      sourceFilePath: session?.sourceFilePath,
      sourceFile: session?.sourceFile,
      assets: session?.assets ?? {},
      availableFiles: session?.availableFiles ?? [],
      viewerRobotLinks: session?.robot.links,
      viewerRobotMaterials: session?.robot.materials,
      previousViewerResourceScope: previousViewerResourceScopeRef.current,
    });
    previousViewerResourceScopeRef.current = next.viewerResourceScope;
    return next.viewerResourceScope;
  }, [
    session?.assets,
    session?.availableFiles,
    session?.robot.links,
    session?.robot.materials,
    session?.sourceFile,
    session?.sourceFilePath,
    session?.urdfContent,
  ]);

  useEffect(() => {
    if (!isOpen || !session) {
      onCaptureActionChange?.(null);
      onStateChange({
        status: 'idle',
        imageUrl: null,
        aspectRatio: session?.viewportAspectRatio ?? 16 / 9,
      });
      return;
    }

    emitState('loading');
  }, [emitState, isOpen, onCaptureActionChange, onStateChange, session]);

  if (!isOpen || !session) {
    return null;
  }

  return (
    <div className={className} data-testid="snapshot-preview-canvas">
      <WorkspaceCanvas
        theme={session.theme}
        lang={lang}
        className="relative h-full w-full"
        robotName={session.robotName}
        onSnapshotActionChange={handleCaptureActionChange}
        renderKey={`snapshot-preview:${session.viewerReloadKey}`}
        environment={previewEnvironment}
        environmentIntensity={STUDIO_ENVIRONMENT_INTENSITY.viewer[effectiveTheme]}
        background={previewBackground}
        cameraFollowPrimary
        showWorldOriginAxes={false}
        showUsageGuide={false}
        showGroundPlane={!options.hideGrid}
        groundOffset={session.groundPlaneOffset}
        subscribeGroundPlaneInvalidation={subscribeRobotGroundPlaneInvalidation}
        initialCameraSnapshot={session.cameraSnapshot}
        orbitControlsProps={{
          enabled: true,
        }}
        contextLostMessage={t.webglContextRestoring}
      >
        <SnapshotPreviewLook options={options} session={session} />
        <group visible>
          <React.Suspense fallback={null}>
            <ViewerSceneConnector
              controller={controller}
              active={false}
              viewerResourceScope={viewerResourceScope}
              effectiveSourceFile={session.sourceFile}
              effectiveSourceFilePath={session.sourceFilePath}
              effectiveUrdfContent={session.urdfContent}
              effectiveSourceFormat={session.viewerSourceFormat}
              mode="editor"
              robot={session.robot}
              isMeshPreview={session.isMeshPreview}
              viewerReloadKey={session.viewerReloadKey}
              t={t}
            />
          </React.Suspense>
        </group>
      </WorkspaceCanvas>
    </div>
  );
}
