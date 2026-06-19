import type { Object3D as ThreeObject3D } from 'three';
import type { ViewerDocumentLoadEvent, ViewerProps } from '@/features/editor';
import type { ViewerController } from '@/features/editor';
import {
  buildViewerSceneProps,
  type ViewerSceneBaseProps,
} from '@/features/editor';
import type { ViewerResourceScope } from '@/features/editor';
import type { AssemblyState, AssemblyTransform, RobotData, RobotFile } from '@/types';
import type { AssemblySelection } from '@/store/assemblySelectionStore';

export const EMPTY_VIEWER_SELECTION = {
  type: null,
  id: null,
} satisfies NonNullable<ViewerProps['selection']>;

interface BuildUnifiedViewerScenePropsArgs {
  controller: ViewerController;
  active: boolean;
  hasActivePreview: boolean;
  modelInteractionEnabled?: boolean;
  hoveredSelection?: ViewerProps['hoveredSelection'];
  viewerResourceScope: ViewerResourceScope;
  retainedRobot?: ThreeObject3D | null;
  effectiveSourceFile: RobotFile | null | undefined;
  effectiveSourceFilePath?: string;
  effectiveUrdfContent: string;
  effectiveSourceFormat?: ViewerProps['sourceFormat'];
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  mode: 'editor';
  selection?: ViewerProps['selection'];
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onUpdate?: ViewerProps['onUpdate'];
  robot: RobotData;
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
  modelInteractionEnabled = true,
  hoveredSelection,
  viewerResourceScope,
  retainedRobot,
  effectiveSourceFile,
  effectiveSourceFilePath,
  effectiveUrdfContent,
  effectiveSourceFormat,
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
  const blocksReadOnlyModelInteraction = hasActivePreview || !modelInteractionEnabled;
  const previewBlocksInteraction = blocksReadOnlyModelInteraction || !active;
  const shouldRenderFromStructuredRobotState = !hasActivePreview;

  return buildViewerSceneProps({
    controller,
    active,
    sourceFile: effectiveSourceFile,
    availableFiles: viewerResourceScope.availableFiles,
    urdfContent: effectiveUrdfContent,
    sourceFormat: effectiveSourceFormat,
    allowUrdfXmlFallback: hasActivePreview,
    assets: viewerResourceScope.assets,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    retainedRobot,
    onRuntimeRobotLoaded,
    sourceFilePath: effectiveSourceFilePath,
    mode: hasActivePreview ? 'editor' : mode,
    selection: blocksReadOnlyModelInteraction ? EMPTY_VIEWER_SELECTION : selection,
    hoveredSelection: blocksReadOnlyModelInteraction ? undefined : hoveredSelection,
    hoverSelectionEnabled: !previewBlocksInteraction,
    onHover: previewBlocksInteraction ? undefined : onHover,
    onMeshSelect: previewBlocksInteraction ? undefined : onMeshSelect,
    onUpdate: blocksReadOnlyModelInteraction ? undefined : onUpdate,
    robotLinks: shouldRenderFromStructuredRobotState ? robot.links : undefined,
    robotJoints: shouldRenderFromStructuredRobotState ? robot.joints : undefined,
    robotData: shouldRenderFromStructuredRobotState ? robot : null,
    focusTarget: blocksReadOnlyModelInteraction ? undefined : focusTarget,
    onCollisionTransformPreview: blocksReadOnlyModelInteraction
      ? undefined
      : onCollisionTransformPreview,
    onCollisionTransform: blocksReadOnlyModelInteraction ? undefined : onCollisionTransform,
    isMeshPreview: hasActivePreview ? false : isMeshPreview,
    ikDragActive: blocksReadOnlyModelInteraction ? false : ikDragActive,
    runtimeInstanceKey: viewerReloadKey,
    assemblyState: blocksReadOnlyModelInteraction ? null : assemblyState,
    assemblySelection: blocksReadOnlyModelInteraction ? undefined : assemblySelection,
    onAssemblyTransform: blocksReadOnlyModelInteraction ? undefined : onAssemblyTransform,
    onComponentTransform: blocksReadOnlyModelInteraction ? undefined : onComponentTransform,
    onBridgeTransform: blocksReadOnlyModelInteraction ? undefined : onBridgeTransform,
    sourceSceneAssemblyComponentId: blocksReadOnlyModelInteraction
      ? null
      : sourceSceneAssemblyComponentId,
    sourceSceneAssemblyComponentTransform: blocksReadOnlyModelInteraction
      ? null
      : sourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls: blocksReadOnlyModelInteraction
      ? false
      : showSourceSceneAssemblyComponentControls,
    onSourceSceneAssemblyComponentTransform: blocksReadOnlyModelInteraction
      ? undefined
      : onSourceSceneAssemblyComponentTransform,
  });
}
