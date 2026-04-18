import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  WorkspaceCanvas,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotPreviewAction,
  useWorkspaceCanvasTheme,
} from '@/shared/components/3d';
import { translations, type Language } from '@/shared/i18n';
import { useViewerController, resolveDefaultViewerToolMode } from '@/features/editor';
import { buildUnifiedViewerResourceScopes } from '@/app/utils/unifiedViewerResourceScopes';
import { resolveSnapshotPreviewSurfaceSize } from '@/shared/components/3d';
import { ViewerSceneConnector } from '../unified-viewer/ViewerSceneConnector';
import { toSnapshotPreviewActionState } from './previewActionState';

import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './types';

interface SnapshotPreviewRendererProps {
  isOpen: boolean;
  lang: Language;
  session: SnapshotPreviewSession | null;
  options: SnapshotCaptureOptions;
  onStateChange: (state: SnapshotDialogPreviewState) => void;
  onCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
}

export function SnapshotPreviewRenderer({
  isOpen,
  lang,
  session,
  options,
  onStateChange,
  onCaptureActionChange,
}: SnapshotPreviewRendererProps) {
  const t = translations[lang];
  const previousViewerResourceScopeRef = useRef<
    ReturnType<typeof buildUnifiedViewerResourceScopes>['viewerResourceScope'] | null
  >(null);
  const previewRequestIdRef = useRef(0);
  const previewTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewInFlightRef = useRef(false);
  const queuedPreviewRef = useRef<{
    requestId: number;
    options: SnapshotCaptureOptions;
    aspectRatio: number;
  } | null>(null);
  const [previewAction, setPreviewAction] = useState<SnapshotPreviewAction | null>(null);
  const effectiveTheme = useWorkspaceCanvasTheme(session?.theme ?? 'light');
  const surfaceSize = useMemo(
    () => resolveSnapshotPreviewSurfaceSize(session?.viewportAspectRatio ?? 16 / 9),
    [session?.viewportAspectRatio],
  );
  const handlePreviewActionChange = useCallback((nextAction: SnapshotPreviewAction | null) => {
    setPreviewAction(toSnapshotPreviewActionState(nextAction));
  }, []);

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
    return () => {
      previewRequestIdRef.current += 1;
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      queuedPreviewRef.current = null;
      previewInFlightRef.current = false;
    };
  }, []);

  const executePreviewRequest = useCallback(
    (requestId: number, nextOptions: SnapshotCaptureOptions, aspectRatio: number) => {
      if (!previewAction) {
        return;
      }

      if (previewInFlightRef.current) {
        queuedPreviewRef.current = {
          requestId,
          options: nextOptions,
          aspectRatio,
        };
        return;
      }

      previewInFlightRef.current = true;
      previewAction(nextOptions)
        .then((result) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }

          const nextUrl = URL.createObjectURL(result.blob);
          const previousUrl = previewUrlRef.current;
          previewUrlRef.current = nextUrl;
          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }
          onStateChange({
            status: 'ready',
            imageUrl: nextUrl,
            aspectRatio: result.width / Math.max(1, result.height),
          });
        })
        .catch((error) => {
          console.error('[SnapshotPreviewRenderer] Failed to refresh preview.', error);
          if (requestId !== previewRequestIdRef.current) {
            return;
          }
          onStateChange({
            status: 'error',
            imageUrl: previewUrlRef.current,
            aspectRatio,
          });
        })
        .finally(() => {
          previewInFlightRef.current = false;
          const queuedPreview = queuedPreviewRef.current;
          if (!queuedPreview) {
            return;
          }

          queuedPreviewRef.current = null;
          if (queuedPreview.requestId === previewRequestIdRef.current) {
            executePreviewRequest(
              queuedPreview.requestId,
              queuedPreview.options,
              queuedPreview.aspectRatio,
            );
          }
        });
    },
    [onStateChange, previewAction],
  );

  useEffect(() => {
    if (!isOpen || !session) {
      previewRequestIdRef.current += 1;
      queuedPreviewRef.current = null;
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      onStateChange({
        status: 'idle',
        imageUrl: null,
        aspectRatio: session?.viewportAspectRatio ?? 16 / 9,
      });
      return;
    }

    if (!previewAction) {
      return;
    }

    const nextRequestId = ++previewRequestIdRef.current;
    const previousImageUrl = previewUrlRef.current;
    onStateChange({
      status: previousImageUrl ? 'refreshing' : 'loading',
      imageUrl: previousImageUrl,
      aspectRatio: session.viewportAspectRatio,
    });

    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
    }

    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      executePreviewRequest(nextRequestId, options, session.viewportAspectRatio);
    }, 300);
  }, [executePreviewRequest, isOpen, onStateChange, options, previewAction, session]);

  if (!isOpen || !session) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-[-20000px] top-0 z-[-1] overflow-hidden opacity-0"
      style={{ width: surfaceSize.width, height: surfaceSize.height }}
    >
      <WorkspaceCanvas
        theme={session.theme}
        lang={lang}
        className="relative h-full w-full"
        robotName={session.robotName}
        onSnapshotActionChange={onCaptureActionChange}
        onPreviewActionChange={handlePreviewActionChange}
        renderKey={`snapshot-preview:${session.viewerReloadKey}`}
        environment="studio"
        environmentIntensity={STUDIO_ENVIRONMENT_INTENSITY.viewer[effectiveTheme]}
        background={WORKSPACE_CANVAS_BACKGROUND}
        cameraFollowPrimary
        showWorldOriginAxes={false}
        showUsageGuide={false}
        groundOffset={session.groundPlaneOffset}
        initialCameraSnapshot={session.cameraSnapshot}
        orbitControlsProps={{
          enabled: false,
        }}
        contextLostMessage={t.webglContextRestoring}
      >
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
