import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type RootState, useThree } from '@react-three/fiber';
import { Environment, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';

import type { Theme } from '@/types';
import { translations, type Language } from '@/shared/i18n';
import { attachContextMenuBlocker } from '@/shared/utils';

import { UsageGuide } from '../UsageGuide';
import { WorldOriginAxes } from '../helpers';
import { SnapshotRenderStateProvider } from '../scene/SnapshotRenderContext';
import {
  AdaptiveGroundPlane,
  CanvasResizeSync,
  NeutralStudioEnvironment,
  SceneLighting,
  SnapshotManager,
  type SnapshotCaptureAction,
  useAdaptiveInteractionQuality,
  WorkspaceCanvasInteractionStateProvider,
  WorkspaceOrbitControls,
  WORKSPACE_CANVAS_BACKGROUND,
  WORKSPACE_DEFAULT_CAMERA_FOV,
  WORKSPACE_DEFAULT_CAMERA_POSITION,
  WORKSPACE_DEFAULT_CAMERA_UP,
} from '../scene';
import type { WorkspaceOrbitControlsProps } from '../scene/WorkspaceOrbitControls';
import {
  resolveWorkspaceCanvasEnvironmentIntensity,
  type WorkspaceCanvasEnvironmentIntensityByTheme,
  useWorkspaceCanvasTheme,
} from './workspaceCanvasConfig';
import { WorkspaceCanvasErrorBoundary } from './WorkspaceCanvasErrorBoundary';
import { WorkspaceCanvasErrorNotice } from './WorkspaceCanvasErrorNotice';
import {
  getWorkspaceCanvasErrorDetail,
  probeWorkspaceCanvasWebglSupport,
  type WorkspaceCanvasWebglSupportState,
} from './workspaceCanvasWebgl';
import { cleanupWorkspaceCanvasRenderer } from './workspaceCanvasRendererCleanup';

interface WorkspaceCanvasProps {
  theme: Theme;
  lang?: Language;
  robotName?: string;
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement>;
  sceneRef?: React.RefObject<THREE.Scene | null>;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  children: React.ReactNode;
  overlays?: React.ReactNode;
  onPointerMissed?: () => void;
  onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>;
  onCreated?: (state: RootState) => void;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  environment?: 'hdr' | 'studio' | 'none';
  environmentIntensity?: number;
  environmentIntensityByTheme?: WorkspaceCanvasEnvironmentIntensityByTheme;
  groundOffset?: number;
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
  cameraFollowPrimary?: boolean;
  orbitControlsProps?: Partial<WorkspaceOrbitControlsProps>;
  controlLayerKey?: string;
  background?: {
    light: string;
    dark: string;
  };
  contextLostMessage?: string;
  showWorldOriginAxes?: boolean;
  showUsageGuide?: boolean;
  renderKey?: string;
}

function CanvasRenderKeyInvalidator({ renderKey }: { renderKey: string }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [invalidate, renderKey]);

  return null;
}

export const WorkspaceCanvas = ({
  theme,
  lang,
  robotName = 'robot',
  className = 'relative w-full h-full',
  containerRef,
  sceneRef,
  snapshotAction,
  children,
  overlays,
  onPointerMissed,
  onPointerDownCapture,
  onCreated,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  environment = 'none',
  environmentIntensity = 0.36,
  environmentIntensityByTheme,
  groundOffset = 0,
  toneMapping = THREE.ACESFilmicToneMapping,
  toneMappingExposure,
  cameraFollowPrimary = false,
  orbitControlsProps,
  controlLayerKey = 'default',
  background = WORKSPACE_CANVAS_BACKGROUND,
  contextLostMessage,
  showWorldOriginAxes = true,
  showUsageGuide = true,
  renderKey = 'default',
}: WorkspaceCanvasProps) => {
  const effectiveTheme = useWorkspaceCanvasTheme(theme);
  const t = translations[lang ?? 'en'];
  const [contextLost, setContextLost] = useState(false);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [canvasFailure, setCanvasFailure] = useState<{
    kind: 'unsupported' | 'initialization' | 'runtime';
    detail?: string;
  } | null>(null);
  const [webglSupport, setWebglSupport] = useState<WorkspaceCanvasWebglSupportState | null>(null);
  const [snapshotRenderActive, setSnapshotRenderActive] = useState(false);
  const contextMenuCleanupRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const canvasReadyRef = useRef(false);
  const contextLossInFlightRef = useRef(false);
  const { dpr, isInteracting, beginInteraction, endInteraction, pulseInteraction } =
    useAdaptiveInteractionQuality();

  // Render content changes should only invalidate the current frame. Only a real WebGL context
  // loss should force a full canvas/renderer rebuild.
  const canvasResetKey = useMemo(() => `context:${contextEpoch}`, [contextEpoch]);
  const failureResetKey = useMemo(() => `${renderKey}:${contextEpoch}`, [renderKey, contextEpoch]);
  const activeBackgroundColor = effectiveTheme === 'light' ? background.light : background.dark;

  const resolvedEnvironmentIntensity = useMemo(
    () =>
      resolveWorkspaceCanvasEnvironmentIntensity({
        effectiveTheme,
        environmentIntensity,
        environmentIntensityByTheme,
      }),
    [effectiveTheme, environmentIntensity, environmentIntensityByTheme],
  );

  const finalOrbitControlsProps = useMemo<Partial<WorkspaceOrbitControlsProps>>(
    () => ({
      enableDamping: false,
      ...orbitControlsProps,
      onStart: () => {
        beginInteraction();
        orbitControlsProps?.onStart?.();
      },
      onEnd: () => {
        endInteraction();
        orbitControlsProps?.onEnd?.();
      },
    }),
    [beginInteraction, endInteraction, orbitControlsProps],
  );
  const canvasCamera = useMemo(
    () => ({
      position: WORKSPACE_DEFAULT_CAMERA_POSITION,
      up: WORKSPACE_DEFAULT_CAMERA_UP,
      fov: WORKSPACE_DEFAULT_CAMERA_FOV,
    }),
    [],
  );
  const canvasGl = useMemo(
    () => ({
      antialias: true,
      alpha: true,
      toneMapping,
      toneMappingExposure: toneMappingExposure ?? (environment === 'hdr' ? 1.0 : 1.1),
      powerPreference: 'high-performance' as const,
      failIfMajorPerformanceCaveat: false,
    }),
    [environment, toneMapping, toneMappingExposure],
  );

  useEffect(() => {
    canvasReadyRef.current = false;
  }, [canvasResetKey]);

  useEffect(() => {
    setCanvasFailure(null);
  }, [failureResetKey]);

  useEffect(() => {
    setWebglSupport(probeWorkspaceCanvasWebglSupport());
  }, []);

  const handleCreated = useCallback(
    (state: RootState) => {
      if (rendererRef.current && rendererRef.current !== state.gl) {
        cleanupWorkspaceCanvasRenderer(rendererRef.current, contextMenuCleanupRef.current);
        contextMenuCleanupRef.current = null;
        rendererRef.current = null;
      }

      canvasReadyRef.current = true;
      setCanvasFailure(null);
      setContextLost(false);
      contextLossInFlightRef.current = false;
      rendererRef.current = state.gl;

      if (sceneRef) {
        sceneRef.current = state.scene;
      }

      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        (window as Window & { scene?: THREE.Scene; THREE?: typeof THREE }).scene = state.scene;
        (window as Window & { scene?: THREE.Scene; THREE?: typeof THREE }).THREE = THREE;
      }

      const canvas = state.gl.domElement;
      const surfaceEventTarget = canvas.parentElement ?? canvas;

      contextMenuCleanupRef.current?.();
      const cleanupCanvasBlocker = attachContextMenuBlocker(canvas);
      const cleanupSurfaceBlocker =
        surfaceEventTarget === canvas ? () => {} : attachContextMenuBlocker(surfaceEventTarget);
      contextMenuCleanupRef.current = () => {
        cleanupSurfaceBlocker();
        cleanupCanvasBlocker();
      };

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        setContextLost(true);
        if (!contextLossInFlightRef.current) {
          contextLossInFlightRef.current = true;
          // Force a full renderer rebuild. This is intentionally explicit and user-visible:
          // we keep the overlay until the new canvas finishes creating.
          setContextEpoch((value) => value + 1);
        }
      };

      const handleContextRestored = () => {
        // If the browser restored the context without us remounting, schedule a redraw.
        // In practice, the epoch-based remount above is the more reliable recovery path.
        setContextLost(false);
        contextLossInFlightRef.current = false;
        state.invalidate();
      };

      canvas.addEventListener('webglcontextlost', handleContextLost, false);
      canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

      (
        canvas as HTMLCanvasElement & {
          __workspaceCanvasCleanup?: () => void;
        }
      ).__workspaceCanvasCleanup = () => {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        contextMenuCleanupRef.current?.();
        contextMenuCleanupRef.current = null;
      };

      onCreated?.(state);
    },
    [onCreated, sceneRef],
  );

  const handleCanvasError = useCallback((error: unknown) => {
    const kind = canvasReadyRef.current ? 'runtime' : 'initialization';
    const detail = getWorkspaceCanvasErrorDetail(error);

    console.error(
      kind === 'runtime'
        ? '[WorkspaceCanvas] Unexpected error inside the 3D canvas.'
        : '[WorkspaceCanvas] Failed to initialize the 3D canvas.',
      error,
    );

    setCanvasFailure({ kind, detail });
  }, []);

  useEffect(() => {
    return () => {
      cleanupWorkspaceCanvasRenderer(rendererRef.current, contextMenuCleanupRef.current);
      contextMenuCleanupRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  const handlePointerDownCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      beginInteraction();
      onPointerDownCapture?.(event);
    },
    [beginInteraction, onPointerDownCapture],
  );

  const handleMouseMove = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.buttons !== 0) {
        beginInteraction();
      }
      onMouseMove?.(event);
    },
    [beginInteraction, onMouseMove],
  );

  const handleMouseUp = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      endInteraction();
      onMouseUp?.(event);
    },
    [endInteraction, onMouseUp],
  );

  const handleMouseLeave = useCallback<React.MouseEventHandler<HTMLDivElement>>(
    (event) => {
      endInteraction(0);
      onMouseLeave?.(event);
    },
    [endInteraction, onMouseLeave],
  );

  const activeCanvasFailure = canvasFailure
    ? canvasFailure
    : webglSupport && !webglSupport.supported
      ? {
          kind: 'unsupported' as const,
          detail: webglSupport.detail,
        }
      : null;
  const shouldRenderCanvas = webglSupport?.supported === true && !activeCanvasFailure;
  const canvasErrorTitle =
    activeCanvasFailure?.kind === 'runtime' ? t.webglRuntimeErrorTitle : t.webglUnsupportedTitle;
  const canvasErrorMessage =
    activeCanvasFailure?.kind === 'runtime'
      ? t.webglRuntimeErrorMessage
      : t.webglUnsupportedMessage;
  const canvasErrorDetail = import.meta.env.DEV ? activeCanvasFailure?.detail : undefined;
  const canvasErrorNotice = (
    <WorkspaceCanvasErrorNotice
      title={canvasErrorTitle}
      message={canvasErrorMessage}
      detail={canvasErrorDetail}
    />
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        touchAction: 'none',
        userSelect: 'none',
        backgroundColor: activeBackgroundColor,
      }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={() => endInteraction()}
      onPointerLeave={() => endInteraction(0)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheelCapture={() => pulseInteraction()}
      onContextMenuCapture={(event) => event.preventDefault()}
    >
      {overlays}
      {activeCanvasFailure ? (
        canvasErrorNotice
      ) : shouldRenderCanvas ? (
        <WorkspaceCanvasErrorBoundary
          fallback={canvasErrorNotice}
          onError={handleCanvasError}
          resetKey={failureResetKey}
        >
          <Canvas
            key={canvasResetKey}
            dpr={dpr}
            shadows
            frameloop="demand"
            camera={canvasCamera}
            gl={canvasGl}
            onCreated={handleCreated}
            onPointerMissed={onPointerMissed}
            translate="no"
          >
            <WorkspaceCanvasInteractionStateProvider isInteracting={isInteracting}>
              <SnapshotRenderStateProvider
                value={{
                  snapshotRenderActive,
                  setSnapshotRenderActive,
                }}
              >
                <CanvasRenderKeyInvalidator renderKey={renderKey} />
                <CanvasResizeSync />
                <color attach="background" args={[activeBackgroundColor]} />
                <Suspense fallback={null}>
                  {environment === 'hdr' && (
                    <Environment
                      files="/potsdamer_platz_1k.hdr"
                      environmentIntensity={effectiveTheme === 'light' ? 0.8 : 1.0}
                    />
                  )}
                  {environment === 'studio' && (
                    <NeutralStudioEnvironment intensity={resolvedEnvironmentIntensity} />
                  )}
                </Suspense>
                <SceneLighting
                  theme={effectiveTheme}
                  cameraFollowPrimary={cameraFollowPrimary}
                  enableShadows={cameraFollowPrimary ? true : !isInteracting}
                />
                <SnapshotManager
                  actionRef={snapshotAction}
                  robotName={robotName}
                  theme={effectiveTheme}
                  groundOffset={groundOffset}
                />
                <Suspense fallback={null}>{children}</Suspense>
                <AdaptiveGroundPlane
                  theme={effectiveTheme}
                  groundOffset={groundOffset}
                  showShadow
                />
                {showWorldOriginAxes && !snapshotRenderActive && <WorldOriginAxes />}
                <WorkspaceOrbitControls
                  key={`orbit-${controlLayerKey}`}
                  {...finalOrbitControlsProps}
                />
                {!snapshotRenderActive && (
                  <GizmoHelper
                    key={`gizmo-${controlLayerKey}`}
                    alignment="bottom-right"
                    margin={[68, 68]}
                  >
                    <GizmoViewport
                      axisColors={['#ef4444', '#22c55e', '#3b82f6']}
                      labelColor={effectiveTheme === 'light' ? '#0f172a' : 'white'}
                      axisHeadScale={0.9}
                      scale={34}
                    />
                  </GizmoHelper>
                )}
              </SnapshotRenderStateProvider>
            </WorkspaceCanvasInteractionStateProvider>
          </Canvas>
        </WorkspaceCanvasErrorBoundary>
      ) : null}

      {lang && showUsageGuide && shouldRenderCanvas ? <UsageGuide lang={lang} /> : null}

      {shouldRenderCanvas && contextLost && contextLostMessage && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border-black bg-panel-bg p-6 text-center shadow-xl">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-system-blue border-t-transparent" />
            <p className="text-text-secondary">{contextLostMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
};
