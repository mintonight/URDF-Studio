import type { Object3D as ThreeObject3D } from 'three';
import type { AssemblyState, RobotFile } from '@/types';
import type { AssemblyTransform } from '@/types';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import type { ViewerController } from '../hooks/useViewerController';
import type { ToolMode, ViewerProps, ViewerDocumentLoadEvent, ViewerSceneMode } from '../types';
import type { ViewerRobotDataResolution } from './viewerRobotData';

interface BuildViewerScenePropsArgs {
  resolvedTheme?: 'light' | 'dark';
  controller: ViewerController;
  active?: boolean;
  sourceFile?: RobotFile | null;
  sourceFormat?: ViewerProps['sourceFormat'];
  allowUrdfXmlFallback?: boolean;
  availableFiles: RobotFile[];
  urdfContent: string;
  assets: Record<string, string>;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onSceneReadyForDisplay?: () => void;
  retainedRobot?: ThreeObject3D | null;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  sourceFilePath?: string;
  groundPlaneOffset?: number;
  mode: ViewerSceneMode;
  selection?: ViewerProps['selection'];
  hoveredSelection?: ViewerProps['hoveredSelection'];
  hoverSelectionEnabled?: boolean;
  onHover?: ViewerProps['onHover'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onUpdate?: ViewerProps['onUpdate'];
  robotLinks?: ViewerProps['robotLinks'];
  robotJoints?: ViewerProps['robotJoints'];
  focusTarget?: ViewerProps['focusTarget'];
  onCollisionTransformPreview?: ViewerProps['onCollisionTransformPreview'];
  onCollisionTransform?: ViewerProps['onCollisionTransform'];
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  runtimeInstanceKey?: number;
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

export interface ViewerSceneBaseProps extends BuildViewerScenePropsArgs {
  toolMode: ToolMode;
}

export function buildViewerSceneProps({
  resolvedTheme,
  controller,
  active = true,
  sourceFile,
  sourceFormat,
  allowUrdfXmlFallback = true,
  availableFiles,
  urdfContent,
  assets,
  onRobotDataResolved,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  retainedRobot,
  onRuntimeRobotLoaded,
  sourceFilePath,
  groundPlaneOffset = controller.groundPlaneOffset,
  mode,
  selection,
  hoveredSelection,
  hoverSelectionEnabled = true,
  onMeshSelect,
  onUpdate,
  robotLinks,
  robotJoints,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  runtimeInstanceKey = 0,
  assemblyState,
  assemblySelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  sourceSceneAssemblyComponentId,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls = false,
  onSourceSceneAssemblyComponentTransform,
}: BuildViewerScenePropsArgs): ViewerSceneBaseProps {
  return {
    resolvedTheme,
    controller,
    active,
    sourceFile,
    sourceFormat,
    allowUrdfXmlFallback,
    availableFiles,
    urdfContent,
    assets,
    onRobotDataResolved,
    onDocumentLoadEvent,
    onSceneReadyForDisplay,
    retainedRobot,
    onRuntimeRobotLoaded,
    sourceFilePath,
    groundPlaneOffset,
    mode,
    selection,
    hoveredSelection,
    hoverSelectionEnabled,
    onHover: hoverSelectionEnabled ? controller.handleHoverWrapper : undefined,
    onMeshSelect,
    onUpdate,
    robotLinks,
    robotJoints,
    focusTarget,
    onCollisionTransformPreview,
    onCollisionTransform,
    isMeshPreview,
    ikDragActive,
    runtimeInstanceKey,
    assemblyState,
    assemblySelection,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    sourceSceneAssemblyComponentId,
    sourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls,
    onSourceSceneAssemblyComponentTransform,
    toolMode: controller.toolMode,
  };
}
