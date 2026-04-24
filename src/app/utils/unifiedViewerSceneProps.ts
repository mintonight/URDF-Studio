import type { Object3D as ThreeObject3D } from 'three';
import {
  buildViewerSceneProps,
  type ViewerController,
  type ViewerProps,
  type ViewerSceneBaseProps,
  type ViewerDocumentLoadEvent,
  type ViewerResourceScope,
  type ViewerRobotDataResolution,
} from '@/features/editor';
import type { AssemblyState, AssemblyTransform, RobotFile, RobotState } from '@/types';
import type { AssemblySelection } from '@/store/assemblySelectionStore';

export const EMPTY_VIEWER_SELECTION = {
  type: null,
  id: null,
} satisfies NonNullable<ViewerProps['selection']>;

interface BuildUnifiedViewerScenePropsArgs {
  controller: ViewerController;
  active: boolean;
  hasActivePreview: boolean;
  hoveredSelection?: ViewerProps['hoveredSelection'];
  viewerResourceScope: ViewerResourceScope;
  retainedRobot?: ThreeObject3D | null;
  effectiveSourceFile: RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerProps['sourceFormat'];
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  mode: 'editor';
  selection?: ViewerProps['selection'];
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onUpdate?: ViewerProps['onUpdate'];
  robot: RobotState;
  focusTarget?: string | null;
  onCollisionTransformPreview?: ViewerProps['onCollisionTransformPreview'];
  onCollisionTransform?: ViewerProps['onCollisionTransform'];
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  viewerReloadKey?: number;
  assemblyState?: AssemblyState | null;
  assemblySelection?: AssemblySelection;
  onAssemblyTransform?: ViewerProps['onAssemblyTransform'];
  onComponentTransform?: ViewerProps['onComponentTransform'];
  onBridgeTransform?: ViewerProps['onBridgeTransform'];
  sourceSceneAssemblyComponentId?: string | null;
  sourceSceneAssemblyComponentTransform?: AssemblyTransform | null;
  showSourceSceneAssemblyComponentControls?: boolean;
  onSourceSceneAssemblyComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
  ) => void;
}

export function buildUnifiedViewerSceneProps({
  controller,
  active,
  hasActivePreview,
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
  isMeshPreview = false,
  ikDragActive = false,
  viewerReloadKey = 0,
  assemblyState,
  assemblySelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  sourceSceneAssemblyComponentId,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls = false,
  onSourceSceneAssemblyComponentTransform,
}: BuildUnifiedViewerScenePropsArgs): ViewerSceneBaseProps {
  const previewBlocksInteraction = hasActivePreview || !active;

  return buildViewerSceneProps({
    controller,
    active,
    sourceFile: effectiveSourceFile,
    availableFiles: viewerResourceScope.availableFiles,
    urdfContent: effectiveUrdfContent,
    sourceFormat: effectiveSourceFormat,
    allowUrdfXmlFallback: hasActivePreview,
    assets: viewerResourceScope.assets,
    onRobotDataResolved,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    retainedRobot,
    onRuntimeRobotLoaded,
    sourceFilePath: effectiveSourceFilePath,
    mode: hasActivePreview ? 'editor' : mode,
    selection: hasActivePreview ? EMPTY_VIEWER_SELECTION : selection,
    hoveredSelection: hasActivePreview ? undefined : hoveredSelection,
    hoverSelectionEnabled: !previewBlocksInteraction,
    onHover: previewBlocksInteraction ? undefined : onHover,
    onMeshSelect: previewBlocksInteraction ? undefined : onMeshSelect,
    onUpdate: hasActivePreview ? undefined : onUpdate,
    robotLinks: hasActivePreview ? undefined : robot.links,
    robotJoints: hasActivePreview ? undefined : robot.joints,
    focusTarget: hasActivePreview ? undefined : focusTarget,
    onCollisionTransformPreview: hasActivePreview ? undefined : onCollisionTransformPreview,
    onCollisionTransform: hasActivePreview ? undefined : onCollisionTransform,
    isMeshPreview: hasActivePreview ? false : isMeshPreview,
    ikDragActive: hasActivePreview ? false : ikDragActive,
    runtimeInstanceKey: viewerReloadKey,
    assemblyState: hasActivePreview ? null : assemblyState,
    assemblySelection: hasActivePreview ? undefined : assemblySelection,
    onAssemblyTransform: hasActivePreview ? undefined : onAssemblyTransform,
    onComponentTransform: hasActivePreview ? undefined : onComponentTransform,
    onBridgeTransform: hasActivePreview ? undefined : onBridgeTransform,
    sourceSceneAssemblyComponentId: hasActivePreview ? null : sourceSceneAssemblyComponentId,
    sourceSceneAssemblyComponentTransform: hasActivePreview
      ? null
      : sourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls: hasActivePreview
      ? false
      : showSourceSceneAssemblyComponentControls,
    onSourceSceneAssemblyComponentTransform: hasActivePreview
      ? undefined
      : onSourceSceneAssemblyComponentTransform,
  });
}
