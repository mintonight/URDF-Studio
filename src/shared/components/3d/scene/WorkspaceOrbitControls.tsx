import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';
import {
  DEFAULT_WORKSPACE_ORBIT_CLIPPING,
  syncWorkspacePerspectiveClipPlanes,
} from './workspaceOrbitClipping';
import { resolveWorkspaceOrbitPanSpeed } from './workspaceOrbitPan';
import {
  applyWorkspaceCameraSnapshot,
  type WorkspaceCameraSnapshot,
} from '../workspace/workspaceCameraSnapshot';

const WORKSPACE_ORBIT_CONTROL_TUNING = {
  dampingFactor: 0.08,
  rotateSpeed: 0.85,
  panSpeed: 0.9,
  zoomSpeed: 1.15,
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
  zoomToCursor = WORKSPACE_ORBIT_CONTROL_TUNING.zoomToCursor,
  minDistance = WORKSPACE_ORBIT_CONTROL_TUNING.minDistance,
  maxDistance,
  initialCameraSnapshot = null,
}: WorkspaceOrbitControlsProps) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const clipSceneBoundsRef = useRef<THREE.Box3 | null | undefined>(undefined);
  const panSceneBoundsRef = useRef<THREE.Box3 | null | undefined>(undefined);

  const refreshSceneBounds = useCallback(() => {
    clipSceneBoundsRef.current = computeVisibleMeshBounds(scene, {
      includeGroundPlaneHelpers: true,
    });
    panSceneBoundsRef.current = computeVisibleMeshBounds(scene);
  }, [scene]);

  useEffect(() => {
    refreshSceneBounds();
  }, [refreshSceneBounds]);

  useEffect(() => {
    if (!controlsRef.current) {
      return;
    }

    applyWorkspaceCameraSnapshot(camera, controlsRef.current, initialCameraSnapshot);
  }, [camera, initialCameraSnapshot]);

  useFrame(() => {
    if (!controlsRef.current) {
      return;
    }

    if (clipSceneBoundsRef.current === undefined || panSceneBoundsRef.current === undefined) {
      refreshSceneBounds();
    }

    // `zoomToCursor` can place the camera very close to one surface while the
    // orbit target remains deeper in the model. Keep the near plane
    // conservative so dense robot geometry does not clip away while zooming.
    syncWorkspacePerspectiveClipPlanes(camera, controlsRef.current, {
      minDistance,
      sceneBounds: clipSceneBoundsRef.current,
    });

    const resolvedPanSpeed = resolveWorkspaceOrbitPanSpeed({
      basePanSpeed: panSpeed,
      camera,
      target: controlsRef.current.target,
      sceneBounds: panSceneBoundsRef.current,
      minDistance,
    });
    if (Math.abs(controlsRef.current.panSpeed - resolvedPanSpeed) > 1e-4) {
      controlsRef.current.panSpeed = resolvedPanSpeed;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      enableDamping={enableDamping}
      dampingFactor={dampingFactor}
      rotateSpeed={rotateSpeed}
      panSpeed={panSpeed}
      zoomSpeed={zoomSpeed}
      zoomToCursor={zoomToCursor}
      minDistance={minDistance}
      maxDistance={maxDistance}
      onStart={() => {
        refreshSceneBounds();
        onStart?.();
      }}
      onEnd={onEnd}
    />
  );
}
