import React from 'react';

import type {
  AssemblyState,
  InteractionSelection,
  RobotFile,
  RobotState,
  UrdfOrigin,
} from '@/types';
import type {
  ViewerController,
  ViewerDocumentLoadEvent,
  ViewerHelperKind,
  ViewerRobotDataResolution,
  ViewerRobotSourceFormat,
  ViewerResourceScope,
} from '@/features/editor';
import { ViewerScene } from '@/features/editor';
import { useSelectionStore } from '@/store/selectionStore';
import type { AssemblySelection } from '@/store/assemblySelectionStore';

import { buildUnifiedViewerSceneProps } from '@/app/utils/unifiedViewerSceneProps';
import type { FilePreviewState } from './types';

interface ViewerSceneConnectorProps {
  controller: ViewerController;
  active: boolean;
  activePreview?: FilePreviewState;
  viewerResourceScope: ViewerResourceScope;
  retainedRobot?: import('three').Object3D | null;
  effectiveSourceFile: RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerRobotSourceFormat;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: import('three').Object3D) => void;
  mode: 'editor';
  selection?: {
    type: InteractionSelection['type'];
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: ViewerHelperKind;
  };
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
  ikDragActive?: boolean;
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
  sourceSceneAssemblyComponentId?: string | null;
  sourceSceneAssemblyComponentTransform?: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  } | null;
  showSourceSceneAssemblyComponentControls?: boolean;
  onSourceSceneAssemblyComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  t: typeof import('@/shared/i18n').translations.en;
}

export const ViewerSceneConnector = React.memo(function ViewerSceneConnector({
  controller,
  active,
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
  mode,
  selection,
  onHover,
  onMeshSelect,
  onUpdate,
  robot,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  viewerReloadKey = 0,
  assemblyState = null,
  assemblySelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  sourceSceneAssemblyComponentId = null,
  sourceSceneAssemblyComponentTransform = null,
  showSourceSceneAssemblyComponentControls = false,
  onSourceSceneAssemblyComponentTransform,
  t,
}: ViewerSceneConnectorProps) {
  const shouldSubscribeToHoveredSelection = effectiveSourceFile?.format === 'usd' && !isMeshPreview;
  const hoveredSelection = useSelectionStore(
    React.useCallback(
      (state) => (shouldSubscribeToHoveredSelection ? state.hoveredSelection : undefined),
      [shouldSubscribeToHoveredSelection],
    ),
  );
  const sceneProps = buildUnifiedViewerSceneProps({
    controller,
    active,
    hasActivePreview: Boolean(activePreview),
    hoveredSelection,
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
    mode,
    selection,
    onHover,
    onMeshSelect,
    onUpdate,
    robot,
    focusTarget,
    onCollisionTransformPreview,
    onCollisionTransform,
    isMeshPreview,
    ikDragActive,
    viewerReloadKey,
    assemblyState,
    assemblySelection,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    sourceSceneAssemblyComponentId,
    sourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls,
    onSourceSceneAssemblyComponentTransform,
  });

  return <ViewerScene {...sceneProps} t={t} />;
});
