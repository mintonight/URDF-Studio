import { memo, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { Theme } from '@/types';
import type { SnapshotCaptureAction } from '@/shared/components/3d/scene/snapshotConfig';
import { STUDIO_ENVIRONMENT_INTENSITY } from '@/shared/components/3d';
import { WorkspaceCanvas } from '@/shared/components/3d';

interface VisualizerCanvasProps {
  theme: Theme;
  snapshotAction?: RefObject<SnapshotCaptureAction | null>;
  sceneRef?: RefObject<THREE.Scene | null>;
  robotName?: string;
  onPointerMissed?: () => void;
  children: ReactNode;
}

export const VisualizerCanvas = memo(function VisualizerCanvas({
  theme,
  snapshotAction,
  sceneRef,
  robotName = 'robot',
  onPointerMissed,
  children,
}: VisualizerCanvasProps) {
  return (
    <WorkspaceCanvas
      theme={theme}
      className="h-full w-full"
      sceneRef={sceneRef}
      snapshotAction={snapshotAction}
      robotName={robotName}
      onPointerMissed={onPointerMissed}
      environment="studio"
      environmentIntensityByTheme={STUDIO_ENVIRONMENT_INTENSITY.workspace}
      toneMappingExposure={1.2}
    >
      {children}
    </WorkspaceCanvas>
  );
});
