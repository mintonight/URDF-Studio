import type { Object3D as ThreeObject3D } from 'three';
import type { RobotFile } from '@/types';
import type { AssemblyTransform } from '@/types';
import type { URDFViewerController } from '../hooks/useURDFViewerController';
import type { ToolMode, URDFViewerProps, ViewerDocumentLoadEvent, ViewerSceneMode } from '../types';
import type { ViewerRobotDataResolution } from './viewerRobotData';

interface BuildURDFViewerScenePropsArgs {
  resolvedTheme?: 'light' | 'dark';
  controller: URDFViewerController;
  active?: boolean;
  sourceFile?: RobotFile | null;
  sourceFormat?: URDFViewerProps['sourceFormat'];
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
  selection?: URDFViewerProps['selection'];
  hoveredSelection?: URDFViewerProps['hoveredSelection'];
  hoverSelectionEnabled?: boolean;
  onHover?: URDFViewerProps['onHover'];
  onMeshSelect?: URDFViewerProps['onMeshSelect'];
  robotLinks?: URDFViewerProps['robotLinks'];
  robotJoints?: URDFViewerProps['robotJoints'];
  focusTarget?: URDFViewerProps['focusTarget'];
  onCollisionTransformPreview?: URDFViewerProps['onCollisionTransformPreview'];
  onCollisionTransform?: URDFViewerProps['onCollisionTransform'];
  isMeshPreview?: boolean;
  runtimeInstanceKey?: number;
  sourceSceneAssemblyComponentId?: string | null;
  sourceSceneAssemblyComponentTransform?: AssemblyTransform | null;
  showSourceSceneAssemblyComponentControls?: boolean;
  onSourceSceneAssemblyComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
  ) => void;
}

export interface URDFViewerSceneBaseProps extends BuildURDFViewerScenePropsArgs {
  toolMode: ToolMode;
}

export function buildURDFViewerSceneProps({
  resolvedTheme,
  controller,
  active = true,
  sourceFile,
  sourceFormat,
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
  onHover,
  onMeshSelect,
  robotLinks,
  robotJoints,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  runtimeInstanceKey = 0,
  sourceSceneAssemblyComponentId,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls = false,
  onSourceSceneAssemblyComponentTransform,
}: BuildURDFViewerScenePropsArgs): URDFViewerSceneBaseProps {
  return {
    resolvedTheme,
    controller,
    active,
    sourceFile,
    sourceFormat,
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
    onHover,
    onMeshSelect,
    robotLinks,
    robotJoints,
    focusTarget,
    onCollisionTransformPreview,
    onCollisionTransform,
    isMeshPreview,
    runtimeInstanceKey,
    sourceSceneAssemblyComponentId,
    sourceSceneAssemblyComponentTransform,
    showSourceSceneAssemblyComponentControls,
    onSourceSceneAssemblyComponentTransform,
    toolMode: controller.toolMode,
  };
}
