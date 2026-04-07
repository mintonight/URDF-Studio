import { memo, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { Language } from '@/shared/i18n';
import { STUDIO_ENVIRONMENT_INTENSITY, type SnapshotCaptureAction } from '@/shared/components/3d';
import { WorkspaceCanvas } from '@/shared/components/3d';

interface URDFViewerCanvasProps {
  lang: Language;
  resolvedTheme?: 'light' | 'dark';
  groundOffset?: number;
  snapshotAction?: RefObject<SnapshotCaptureAction | null>;
  robotName?: string;
  orbitEnabled: boolean;
  onOrbitStart?: () => void;
  onOrbitEnd?: () => void;
  onPointerMissed?: () => void;
  contextLostMessage: string;
  showUsageGuide?: boolean;
  children: ReactNode;
}

export const URDFViewerCanvas = memo(function URDFViewerCanvas({
  lang,
  resolvedTheme = 'light',
  groundOffset = 0,
  snapshotAction,
  robotName = 'robot',
  orbitEnabled,
  onOrbitStart,
  onOrbitEnd,
  onPointerMissed,
  contextLostMessage,
  showUsageGuide = true,
  children,
}: URDFViewerCanvasProps) {
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
      contextLostMessage={contextLostMessage}
      showUsageGuide={showUsageGuide}
    >
      {children}
    </WorkspaceCanvas>
  );
});
