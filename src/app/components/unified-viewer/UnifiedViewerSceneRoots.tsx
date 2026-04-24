import React from 'react';
import type { Group as ThreeGroup, Object3D as ThreeObject3D } from 'three';

import type { AssemblyState, InteractionSelection, RobotState, UrdfOrigin } from '@/types';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import type {
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerResourceScope,
  ViewerRobotDataResolution,
  ViewerRobotSourceFormat,
} from '@/features/editor';

import { LazyViewerSceneConnector } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerSceneRootsProps {
  shouldRenderViewerScene: boolean;
  viewerGroupRef: React.RefObject<ThreeGroup | null>;
  viewerVisible: boolean;
  viewerController: ReturnType<typeof import('@/features/editor').useViewerController>;
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
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
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
  assemblyState?: AssemblyState | null;
  assemblySelection?: AssemblySelection;
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
  onBridgeTransform?: (bridgeId: string, origin: UrdfOrigin) => void;
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
  ikDragActive: boolean;
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
  onUpdate,
  robot,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  viewerReloadKey = 0,
  assemblyState = null,
  assemblySelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  sourceSceneAssemblyComponent,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls,
  onSourceSceneAssemblyComponentTransform,
  t,
  ikDragActive,
}: UnifiedViewerSceneRootsProps) {
  return shouldRenderViewerScene ? (
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
          onUpdate={onUpdate}
          robot={robot}
          focusTarget={focusTarget}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransform={onCollisionTransform}
          isMeshPreview={isMeshPreview}
          ikDragActive={ikDragActive}
          viewerReloadKey={viewerReloadKey}
          assemblyState={assemblyState}
          assemblySelection={assemblySelection}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          sourceSceneAssemblyComponentId={sourceSceneAssemblyComponent?.id ?? null}
          sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
          showSourceSceneAssemblyComponentControls={showSourceSceneAssemblyComponentControls}
          onSourceSceneAssemblyComponentTransform={onSourceSceneAssemblyComponentTransform}
          t={t}
        />
      </React.Suspense>
    </group>
  ) : null;
}
