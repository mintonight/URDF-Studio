import React from 'react';
import type { AppMode, RobotState, Theme } from '@/types';
import { translations, type Language } from '@/shared/i18n';
import type { SnapshotCaptureAction } from '@/shared/components/3d/scene/snapshotConfig';
import type { ViewerHelperKind } from '@/features/urdf-viewer';
import { useVisualizerController } from '../hooks';
import { VisualizerCanvas } from './VisualizerCanvas';
import { VisualizerPanels } from './VisualizerPanels';
import { VisualizerScene } from './VisualizerScene';

interface VisualizerProps {
  robot: RobotState;
  onSelect: (
    type: 'link' | 'joint',
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: AppMode;
  assets: Record<string, string>;
  lang: Language;
  theme: Theme;
  os?: 'mac' | 'win';
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
}

export const Visualizer = React.memo(
  ({
    robot,
    onSelect,
    onUpdate,
    mode,
    assets,
    lang,
    theme,
    showVisual,
    setShowVisual,
    snapshotAction,
    showOptionsPanel = true,
    setShowOptionsPanel,
  }: VisualizerProps) => {
    const controller = useVisualizerController({
      robot,
      onUpdate,
      mode,
      propShowVisual: showVisual,
      propSetShowVisual: setShowVisual,
    });

    const t = translations[lang];

    return (
      <div
        ref={controller.panel.containerRef}
        className="relative h-full w-full"
        onMouseMove={controller.panel.handleMouseMove}
        onMouseUp={controller.panel.handleMouseUp}
        onMouseLeave={controller.panel.handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <VisualizerPanels
          lang={lang}
          showOptionsPanel={showOptionsPanel}
          setShowOptionsPanel={setShowOptionsPanel}
          controller={controller}
        />

        <VisualizerCanvas
          theme={theme}
          snapshotAction={snapshotAction}
          sceneRef={controller.sceneRef}
          robotName={robot.name || 'robot'}
          onPointerMissed={controller.clearSelection}
        >
          <VisualizerScene
            robot={robot}
            onSelect={onSelect}
            onUpdate={onUpdate}
            mode={mode}
            assets={assets}
            lang={lang}
            controller={controller}
          />
        </VisualizerCanvas>
      </div>
    );
  },
);
