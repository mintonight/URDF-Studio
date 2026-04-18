import { memo, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { Language } from '@/shared/i18n';
import { STUDIO_ENVIRONMENT_INTENSITY, type SnapshotCaptureAction } from '@/shared/components/3d';
import { WorkspaceCanvas } from '@/shared/components/3d';

interface ViewerCanvasProps {
  lang: Language;
  resolvedTheme?: 'light' | 'dark';
  groundOffset?: number;
  snapshotAction?: RefObject<SnapshotCaptureAction | null>;
  robotName?: string;
  orbitEnabled: boolean;
  onOrbitStart?: () => void;
  onOrbitEnd?: () => void;
  onPointerMissed?: () => void;
  showUsageGuide?: boolean;
  children: ReactNode;
}

export const ViewerCanvas = memo(function ViewerCanvas({
  lang,
  resolvedTheme = 'light',
  groundOffset = 0,
  snapshotAction,
  robotName = 'robot',
  orbitEnabled,
  onOrbitStart,
  onOrbitEnd,
  onPointerMissed,
  showUsageGuide = true,
  children,
}: ViewerCanvasProps) {
  return (
    <WorkspaceCanvas
      theme={resolvedTheme}
      lang={lang}
      className="relative h-full w-full"
      snapshotAction={snapshotAction}
      robotName={robotName}
      onPointerMissed={onPointerMissed}
      environment="studio"
      environmentIntensityByTheme={STUDIO_ENVIRONMENT_INTENSITY.viewer}
      groundOffset={groundOffset}
      toneMapping={THREE.NeutralToneMapping}
      toneMappingExposure={1.0}
      cameraFollowPrimary
      orbitControlsProps={{
        enabled: orbitEnabled,
        onStart: onOrbitStart,
        onEnd: onOrbitEnd,
      }}
      showUsageGuide={showUsageGuide}
    >
      {children}
    </WorkspaceCanvas>
  );
});
