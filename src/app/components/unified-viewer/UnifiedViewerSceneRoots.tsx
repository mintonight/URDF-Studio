import React from 'react';
import type { Group as ThreeGroup, Object3D as ThreeObject3D } from 'three';

import type { AssemblyState, InteractionSelection, RobotState } from '@/types';
import type {
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerResourceScope,
  ViewerRobotDataResolution,
  ViewerRobotSourceFormat,
} from '@/features/urdf-viewer';

import { LazyViewerSceneConnector, LazyVisualizerScene } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerSceneRootsProps {
  shouldRenderViewerScene: boolean;
  viewerGroupRef: React.RefObject<ThreeGroup | null>;
  viewerVisible: boolean;
  viewerController: ReturnType<typeof import('@/features/urdf-viewer').useURDFViewerController>;
  activePreview?: FilePreviewState;
  viewerResourceScope: ViewerResourceScope;
  retainedRobot: ThreeObject3D | null;
  effectiveSourceFile: import('@/types').RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerRobotSourceFormat;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  viewerSceneMode: 'editor';
  selection?: InteractionSelection;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  robot: RobotState;
  focusTarget?: string | null;
  onCollisionTransformPreview?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  isMeshPreview?: boolean;
  viewerReloadKey?: number;
  sourceSceneAssemblyComponent: import('@/types').AssemblyComponent | null;
  sourceSceneAssemblyComponentTransform: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  } | null;
  showSourceSceneAssemblyComponentControls: boolean;
  onSourceSceneAssemblyComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  t: typeof import('@/shared/i18n').translations.en;
  shouldRenderVisualizerScene: boolean;
  visualizerGroupRef: React.RefObject<ThreeGroup | null>;
  visualizerVisible: boolean;
  visualizerRobot: RobotState;
  onSelect: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  visualizerRuntimeMode: import('@/types').AppMode;
  visualizerResourceScope: ViewerResourceScope;
  lang: import('@/shared/i18n').Language;
  visualizerController: ReturnType<typeof import('@/features/visualizer').useVisualizerController>;
  assemblyState?: AssemblyState | null;
  assemblyWorkspaceActive?: boolean;
  assemblySelection?: import('@/store/assemblySelectionStore').AssemblySelection;
  sourceSceneAssemblyComponentId?: string | null;
  onAssemblyTransform?: (transform: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  }) => void;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: {
      xyz: { x: number; y: number; z: number };
      rpy: { r: number; p: number; y: number };
      quatXyzw?: { x: number; y: number; z: number; w: number };
    },
  ) => void;
  onTransformPendingChange?: (pending: boolean) => void;
  isViewerMode: boolean;
}

export function UnifiedViewerSceneRoots({
  shouldRenderViewerScene,
  viewerGroupRef,
  viewerVisible,
  viewerController,
  activePreview,
  viewerResourceScope,
  retainedRobot,
  effectiveSourceFile,
  effectiveSourceFilePath,
  effectiveUrdfContent,
  effectiveSourceFormat,
  onRobotDataResolved,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  onRuntimeRobotLoaded,
  viewerSceneMode,
  selection,
  onHover,
  onMeshSelect,
  robot,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  viewerReloadKey = 0,
  sourceSceneAssemblyComponent,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls,
  onSourceSceneAssemblyComponentTransform,
  t,
  shouldRenderVisualizerScene,
  visualizerGroupRef,
  visualizerVisible,
  visualizerRobot,
  onSelect,
  onUpdate,
  visualizerRuntimeMode,
  visualizerResourceScope,
  lang,
  visualizerController,
  assemblyState,
  assemblyWorkspaceActive = false,
  assemblySelection,
  sourceSceneAssemblyComponentId = null,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  onTransformPendingChange,
  isViewerMode,
}: UnifiedViewerSceneRootsProps) {
  return (
    <>
      {shouldRenderViewerScene ? (
        <group key="viewer-scene-root" ref={viewerGroupRef} visible={viewerVisible}>
          <React.Suspense fallback={null}>
            <LazyViewerSceneConnector
              controller={viewerController}
              active={viewerVisible}
              activePreview={activePreview}
              viewerResourceScope={viewerResourceScope}
              retainedRobot={retainedRobot}
              effectiveSourceFile={effectiveSourceFile}
              effectiveSourceFilePath={effectiveSourceFilePath}
              effectiveUrdfContent={effectiveUrdfContent}
              effectiveSourceFormat={effectiveSourceFormat}
              onRobotDataResolved={onRobotDataResolved}
              onDocumentLoadEvent={onDocumentLoadEvent}
              onSceneReadyForDisplay={onSceneReadyForDisplay}
              onRuntimeRobotLoaded={onRuntimeRobotLoaded}
              mode={viewerSceneMode}
              selection={selection}
              onHover={onHover}
              onMeshSelect={onMeshSelect}
              robot={robot}
              focusTarget={focusTarget}
              onCollisionTransformPreview={onCollisionTransformPreview}
              onCollisionTransform={onCollisionTransform}
              isMeshPreview={isMeshPreview}
              viewerReloadKey={viewerReloadKey}
              sourceSceneAssemblyComponentId={sourceSceneAssemblyComponent?.id ?? null}
              sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
              showSourceSceneAssemblyComponentControls={showSourceSceneAssemblyComponentControls}
              onSourceSceneAssemblyComponentTransform={onSourceSceneAssemblyComponentTransform}
              t={t}
            />
          </React.Suspense>
        </group>
      ) : null}
      {shouldRenderVisualizerScene ? (
        <group key="visualizer-scene-root" ref={visualizerGroupRef} visible={visualizerVisible}>
          <React.Suspense fallback={null}>
            <LazyVisualizerScene
              robot={visualizerRobot}
              onSelect={onSelect}
              onUpdate={onUpdate}
              mode={visualizerRuntimeMode}
              assets={visualizerResourceScope.assets}
              lang={lang}
              controller={visualizerController}
              active={visualizerVisible}
              onDocumentLoadEvent={!isViewerMode ? onDocumentLoadEvent : undefined}
              assemblyState={assemblyState}
              assemblyWorkspaceActive={assemblyWorkspaceActive}
              assemblySelection={assemblySelection}
              sourceSceneAssemblyComponentId={sourceSceneAssemblyComponentId}
              sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
              onAssemblyTransform={onAssemblyTransform}
              onComponentTransform={onComponentTransform}
              onBridgeTransform={onBridgeTransform}
              onTransformPendingChange={onTransformPendingChange}
              onSourceSceneComponentTransform={onSourceSceneAssemblyComponentTransform}
            />
          </React.Suspense>
        </group>
      ) : null}
    </>
  );
}
