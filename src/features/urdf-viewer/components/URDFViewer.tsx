import { lazy, memo, Suspense, useCallback } from 'react';
import { translations } from '@/shared/i18n';
import { useEffectiveTheme, useResolvedTheme } from '@/shared/hooks';
import { useUIStore } from '@/store';
import { useSelectionStore } from '@/store/selectionStore';
import type { URDFViewerProps } from '../types';
import { useURDFViewerController } from '../hooks/useURDFViewerController';
import { buildURDFViewerSceneProps } from '../utils/viewerSceneProps';
import { resolveStandaloneViewerHoverSelectionWiring } from '../utils/standaloneHoverSelectionWiring';
import { resolveDefaultViewerToolMode } from '../utils/scopedToolMode';
import {
  resolvePreferredViewerRobotSourceFormat,
  resolveViewerRobotSourceFormat,
} from '../utils/sourceFormat';
import { URDFViewerCanvas } from './URDFViewerCanvas';
import { URDFViewerScene } from './URDFViewerScene';

const LazyURDFViewerPanels = lazy(async () => ({
  default: (await import('./URDFViewerPanels')).URDFViewerPanels,
}));

export const URDFViewer = memo(function URDFViewer({
  urdfContent,
  assets,
  sourceFile,
  sourceFormat,
  availableFiles = [],
  onRobotDataResolved,
  onDocumentLoadEvent,
  onJointChange,
  syncJointChangesToApp = false,
  jointAngleState,
  jointMotionState,
  lang,
  theme,
  mode = 'editor',
  onSelect,
  onMeshSelect,
  onHover,
  onUpdate,
  selection,
  hoveredSelection,
  robotLinks,
  robotJoints,
  ikRobotState,
  sourceFilePath,
  focusTarget,
  showVisual,
  setShowVisual,
  snapshotAction,
  isMeshPreview = false,
  onCollisionTransformPreview,
  onCollisionTransform,
  showToolbar = true,
  setShowToolbar,
  showOptionsPanel = true,
  setShowOptionsPanel,
  showJointPanel = true,
  setShowJointPanel,
  onTransformPendingChange,
  groundPlaneOffset: propGroundPlaneOffset,
}: URDFViewerProps) {
  const t = translations[lang];
  const storeGroundPlaneOffset = useUIStore((state) => state.groundPlaneOffset);
  const setStoreGroundPlaneOffset = useUIStore((state) => state.setGroundPlaneOffset);
  const viewerSourceFormat = resolvePreferredViewerRobotSourceFormat(
    sourceFormat,
    sourceFile?.format,
  );
  const { shouldSubscribeToStoreHoveredSelection, hoverSelectionEnabled } =
    resolveStandaloneViewerHoverSelectionWiring({
      hoveredSelection,
      sourceFormat: viewerSourceFormat,
      isMeshPreview,
    });
  const storeHoveredSelection = useSelectionStore(
    useCallback(
      (state) => (shouldSubscribeToStoreHoveredSelection ? state.hoveredSelection : undefined),
      [shouldSubscribeToStoreHoveredSelection],
    ),
  );
  const groundPlaneOffset = propGroundPlaneOffset ?? storeGroundPlaneOffset;
  const resolvedHoveredSelection = hoveredSelection ?? storeHoveredSelection;
  const resolvedSourceFormat = resolveViewerRobotSourceFormat(urdfContent, viewerSourceFormat);
  const inheritedTheme = useEffectiveTheme();
  const explicitTheme = useResolvedTheme(theme ?? 'system');
  const resolvedTheme = theme ? explicitTheme : inheritedTheme;
  const defaultToolMode = resolveDefaultViewerToolMode(viewerSourceFormat);
  const toolModeScopeKey = sourceFile
    ? `${sourceFile.format}:${sourceFile.name}`
    : sourceFilePath
      ? `inline:${sourceFilePath}`
      : 'inline:urdf-viewer';
  const controller = useURDFViewerController({
    onJointChange,
    syncJointChangesToApp,
    showJointPanel,
    jointAngleState,
    jointMotionState,
    onSelect,
    onMeshSelect,
    onHover,
    selection,
    showVisual,
    setShowVisual,
    onTransformPendingChange,
    groundPlaneOffset,
    setGroundPlaneOffset: setStoreGroundPlaneOffset,
    groundPlaneOffsetReadOnly: propGroundPlaneOffset !== undefined,
    defaultToolMode,
    toolModeScopeKey,
    closedLoopRobotState: ikRobotState ?? null,
  });
  const sceneProps = buildURDFViewerSceneProps({
    resolvedTheme,
    controller,
    sourceFile,
    sourceFormat,
    availableFiles,
    urdfContent,
    assets,
    onRobotDataResolved,
    onDocumentLoadEvent,
    sourceFilePath,
    groundPlaneOffset,
    mode,
    selection,
    hoveredSelection: resolvedHoveredSelection,
    hoverSelectionEnabled,
    onHover,
    onMeshSelect,
    robotLinks,
    robotJoints,
    focusTarget,
    onCollisionTransformPreview,
    onCollisionTransform,
    isMeshPreview,
  });

  return (
    <div
      ref={controller.containerRef}
      className="flex-1 relative h-full min-w-0 bg-google-light-bg dark:bg-google-dark-bg"
      onMouseMove={controller.handleMouseMove}
      onMouseUp={controller.handleMouseUp}
    >
      <Suspense fallback={null}>
        <LazyURDFViewerPanels
          lang={lang}
          controller={controller}
          isMjcfSource={resolvedSourceFormat === 'mjcf'}
          onUpdate={onUpdate}
          showToolbar={showToolbar}
          setShowToolbar={setShowToolbar}
          showOptionsPanel={showOptionsPanel}
          setShowOptionsPanel={setShowOptionsPanel}
          showJointPanel={showJointPanel}
          setShowJointPanel={setShowJointPanel}
        />
      </Suspense>

      <URDFViewerCanvas
        lang={lang}
        resolvedTheme={resolvedTheme}
        groundOffset={groundPlaneOffset}
        snapshotAction={snapshotAction}
        robotName={controller.robot?.name || 'robot'}
        orbitEnabled={!controller.isDragging}
        onOrbitStart={() => {
          controller.isOrbitDragging.current = true;
        }}
        onOrbitEnd={() => {
          controller.isOrbitDragging.current = false;
        }}
        onPointerMissed={controller.handlePointerMissed}
        contextLostMessage={t.webglContextRestoring}
      >
        <URDFViewerScene {...sceneProps} t={t} />
      </URDFViewerCanvas>
    </div>
  );
});

export default URDFViewer;
