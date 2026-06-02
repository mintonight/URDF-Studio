import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  DEFAULT_WORKSPACE_ORBIT_CLIPPING,
  syncWorkspacePerspectiveClipPlanes,
} from './workspaceOrbitClipping';
import {
  resolveWorkspaceOrbitPanSpeed,
  resolveWorkspaceOrbitZoomSpeed,
} from './workspaceOrbitPan';
import { useSceneBoundsCache } from './useSceneBoundsCache';
import {
  applyWorkspaceCameraSnapshot,
  type WorkspaceCameraSnapshot,
} from '../workspace/workspaceCameraSnapshot';

const WORKSPACE_ORBIT_CONTROL_TUNING = {
  dampingFactor: 0.08,
  rotateSpeed: 0.85,
  panSpeed: 0.9,
  // Calmer baseline wheel-zoom, closer to large 3D software (Blender / Maya).
  // OrbitControls dollies by Math.pow(0.95, zoomSpeed) per notch, so 0.8 ≈ 3.5%
  // per notch vs the previous 1.15 ≈ 5.9%. Users can further tune via the
  // Navigation sensitivity slider (zoomSensitivity multiplier).
  zoomSpeed: 0.8,
  zoomToCursor: true,
  enableDamping: true,
  ...DEFAULT_WORKSPACE_ORBIT_CLIPPING,
} as const;

export interface WorkspaceOrbitControlsProps {
  enabled?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  panSpeed?: number;
  zoomSpeed?: number;
  /** User-facing navigation sensitivity multipliers (1 = 100% = base tuning). */
  zoomSensitivity?: number;
  rotateSensitivity?: number;
  panSensitivity?: number;
  zoomToCursor?: boolean;
  minDistance?: number;
  maxDistance?: number;
  initialCameraSnapshot?: WorkspaceCameraSnapshot | null;
}

export function WorkspaceOrbitControls({
  enabled = true,
  onStart,
  onEnd,
  enableDamping = WORKSPACE_ORBIT_CONTROL_TUNING.enableDamping,
  dampingFactor = WORKSPACE_ORBIT_CONTROL_TUNING.dampingFactor,
  rotateSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.rotateSpeed,
  panSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.panSpeed,
  zoomSpeed = WORKSPACE_ORBIT_CONTROL_TUNING.zoomSpeed,
  zoomSensitivity = 1,
  rotateSensitivity = 1,
  panSensitivity = 1,
  zoomToCursor = WORKSPACE_ORBIT_CONTROL_TUNING.zoomToCursor,
  minDistance = WORKSPACE_ORBIT_CONTROL_TUNING.minDistance,
  maxDistance,
  initialCameraSnapshot = null,
}: WorkspaceOrbitControlsProps) {
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { getClipBounds, getPanBounds, invalidate: invalidateSceneBounds } = useSceneBoundsCache();

  // Fold the user sensitivity multiplier into the base tuning so the adaptive
  // pan/zoom resolvers and the OrbitControls props all share one effective
  // speed. Rotate has no distance-based resolver, so it is applied directly.
  const effectiveRotateSpeed = rotateSpeed * rotateSensitivity;
  const effectivePanSpeed = panSpeed * panSensitivity;
  const effectiveZoomSpeed = zoomSpeed * zoomSensitivity;

  useEffect(() => {
    if (!controlsRef.current) {
      return;
    }

    applyWorkspaceCameraSnapshot(camera, controlsRef.current, initialCameraSnapshot);
  }, [camera, initialCameraSnapshot]);

  // Sync clip planes + pan/zoom speed on every controls 'change' event
  // (rotate / pan / zoom / damping ticks / programmatic controls.update())
  // instead of every demanded frame. The clip planes also need a one-shot
  // sync at mount so the very first rendered frame uses correct near/far
  // (otherwise dense robot geometry can clip away until the user moves the
  // camera).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const syncControls = () => {
      const clipBounds = getClipBounds();
      const panBounds = getPanBounds();

      // `zoomToCursor` can place the camera very close to one surface while
      // the orbit target remains deeper in the model. Keep the near plane
      // conservative so dense robot geometry does not clip away while
      // zooming.
      syncWorkspacePerspectiveClipPlanes(camera, controls, {
        minDistance,
        sceneBounds: clipBounds,
      });

      const resolvedPanSpeed = resolveWorkspaceOrbitPanSpeed({
        basePanSpeed: effectivePanSpeed,
        camera,
        target: controls.target,
        sceneBounds: panBounds,
        minDistance,
      });
      if (Math.abs(controls.panSpeed - resolvedPanSpeed) > 1e-4) {
        controls.panSpeed = resolvedPanSpeed;
      }

      const resolvedZoomSpeed = resolveWorkspaceOrbitZoomSpeed({
        baseZoomSpeed: effectiveZoomSpeed,
        camera,
        target: controls.target,
        sceneBounds: panBounds,
        minDistance,
      });
      if (Math.abs(controls.zoomSpeed - resolvedZoomSpeed) > 1e-4) {
        controls.zoomSpeed = resolvedZoomSpeed;
      }
    };

    // One-shot sync at mount + whenever any of the tuning inputs change so
    // the very first frame already has correct near/far + speed scaling.
    syncControls();

    controls.addEventListener('change', syncControls);
    return () => {
      controls.removeEventListener('change', syncControls);
    };
  }, [camera, getClipBounds, getPanBounds, minDistance, effectivePanSpeed, effectiveZoomSpeed]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      enableDamping={enableDamping}
      dampingFactor={dampingFactor}
      rotateSpeed={effectiveRotateSpeed}
      panSpeed={effectivePanSpeed}
      zoomSpeed={effectiveZoomSpeed}
      zoomToCursor={zoomToCursor}
      minDistance={minDistance}
      maxDistance={maxDistance}
      onStart={() => {
        // Refresh bounds before a user interaction so any drift since the
        // last compute (e.g. programmatic joint motion that did not mutate
        // the scene tree) is rebuilt before pan/zoom tuning is evaluated.
        invalidateSceneBounds();
        onStart?.();
      }}
      onEnd={onEnd}
    />
  );
}
