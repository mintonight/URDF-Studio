import React from 'react';
import * as THREE from 'three';
import type { Language, translations } from '@/shared/i18n';
import type { SnapshotCaptureAction } from '@/shared/components/3d';
import type {
  AssemblyTransform,
  InteractionHelperKind,
  InteractionSelection,
  JointQuaternion,
  LoadingProgressMode,
  RobotFile,
  RobotState,
  Theme,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import type { ViewerRobotDataResolution } from './utils/viewerRobotData';
import type {
  MeasureAnchorMode,
  MeasureGroup,
  MeasureMeasurement,
  MeasureObjectType,
  MeasureSlot,
  MeasureState,
  MeasureTarget,
} from './utils/measurements';
import type { MeasureSelectionLike } from './utils/measureTargetResolvers';

export type ToolMode =
  | 'select'
  | 'translate'
  | 'rotate'
  | 'universal'
  | 'view'
  | 'face'
  | 'measure';
export type ViewerSceneMode = 'editor';
export type ViewerHelperKind = InteractionHelperKind;
export type ViewerInteractiveLayer =
  | 'ik-handle'
  | 'visual'
  | 'collision'
  | 'origin-axes'
  | 'joint-axis'
  | 'center-of-mass'
  | 'inertia';
export type ViewerRobotSourceFormat = 'auto' | 'urdf' | 'mjcf' | 'sdf' | 'xacro';
export type RobotLoadingPhase =
  | 'preparing-scene'
  | 'streaming-meshes'
  | 'finalizing-scene'
  | 'ready';
export type UsdLoadingPhase =
  | 'checking-path'
  | 'preloading-dependencies'
  | 'initializing-renderer'
  | 'streaming-meshes'
  | 'applying-stage-fixes'
  | 'resolving-metadata'
  | 'finalizing-scene'
  | 'ready';

export interface UsdLoadingProgress {
  phase: UsdLoadingPhase;
  message?: string | null;
  progressMode?: LoadingProgressMode | null;
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
}

export type ViewerLoadingPhase = RobotLoadingPhase | UsdLoadingPhase;
export interface ViewerDocumentLoadEvent {
  status: 'loading' | 'ready' | 'error';
  phase?: ViewerLoadingPhase | null;
  message?: string | null;
  progressMode?: LoadingProgressMode | null;
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
  error?: string | null;
}

export type UsdLoadingPhaseLabels = Record<Exclude<UsdLoadingPhase, 'ready'>, string>;
export type {
  MeasureAnchorMode,
  MeasureGroup,
  MeasureMeasurement,
  MeasureObjectType,
  MeasureSlot,
  MeasureState,
  MeasureTarget,
};
export type MeasureTargetResolver = (
  selection?: MeasureSelectionLike,
  fallbackSelection?: MeasureSelectionLike,
  anchorMode?: MeasureAnchorMode,
) => MeasureTarget | null;

export interface ViewerRuntimeStageBridge {
  onRobotResolved?: (robot: any | null) => void;
  onSelectionChange?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onActiveJointChange?: (jointName: string | null) => void;
  onJointAnglesChange?: (jointAngles: Record<string, number>) => void;
}

export interface ViewerJointMotionStateValue {
  angle?: number;
  quaternion?: JointQuaternion;
}

export interface URDFViewerProps {
  urdfContent: string;
  assets: Record<string, string>;
  sourceFile?: RobotFile | null;
  sourceFormat?: ViewerRobotSourceFormat;
  availableFiles?: RobotFile[];
  sourceFilePath?: string;
  onRobotDataResolved?: (result: ViewerRobotDataResolution) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onJointChange?: (jointName: string, angle: number) => void;
  syncJointChangesToApp?: boolean;
  jointAngleState?: Record<string, number>;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  lang: Language;
  mode?: ViewerSceneMode;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  theme: Theme;
  selection?: InteractionSelection;
  hoveredSelection?: InteractionSelection;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  ikRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  focusTarget?: string | null;
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  showToolbar?: boolean;
  setShowToolbar?: (show: boolean) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  onCollisionTransformPreview?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  /** True when previewing a standalone mesh asset from the library (STL/DAE/OBJ/GLB). */
  isMeshPreview?: boolean;
  /** Notify parent when collision transform has a pending confirm/cancel state */
  onTransformPendingChange?: (pending: boolean) => void;
  /** Visual ground alignment offset applied after load. */
  groundPlaneOffset?: number;
}

export interface RobotModelProps {
  urdfContent: string;
  assets: Record<string, string>;
  sourceFormat?: ViewerRobotSourceFormat;
  reloadToken?: number;
  initialRobot?: THREE.Object3D | null;
  sourceFilePath?: string;
  onRobotLoaded?: (robot: any) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  showCollision?: boolean;
  showVisual?: boolean;
  showIkHandles?: boolean;
  showIkHandlesAlwaysOnTop?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
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
  onJointChange?: (name: string, angle: number) => void;
  onJointChangeCommit?: (name: string, angle: number) => void;
  initialJointAngles?: Record<string, number>;
  registerSceneRefresh?: (refreshScene: (() => void) | null) => void;
  setIsDragging?: (dragging: boolean) => void;
  onIkPreviewKinematicOverrides?: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  onClearIkPreviewKinematicOverrides?: () => void;
  setActiveJoint?: (jointName: string | null) => void;
  justSelectedRef?: React.RefObject<boolean>;
  t: (typeof translations)['en'];
  mode?: ViewerSceneMode;
  showInertia?: boolean;
  showInertiaOverlay?: boolean;
  showCenterOfMass?: boolean;
  showCoMOverlay?: boolean;
  centerOfMassSize?: number;
  showOrigins?: boolean;
  showOriginsOverlay?: boolean;
  originSize?: number;
  showMjcfSites?: boolean;
  showJointAxes?: boolean;
  showJointAxesOverlay?: boolean;
  jointAxisSize?: number;
  modelOpacity?: number;
  ikRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  focusTarget?: string | null;
  transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
  toolMode?: ToolMode;
  onCollisionTransformPreview?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransformEnd?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  isOrbitDragging?: React.RefObject<boolean>;
  onTransformPending?: (pending: boolean) => void;
  isSelectionLockedRef?: React.RefObject<boolean>;
  selection?: URDFViewerProps['selection'];
  hoverSelectionEnabled?: boolean;
  hoveredSelection?: URDFViewerProps['hoveredSelection'];
  interactionLayerPriority?: ViewerInteractiveLayer[];
  isMeshPreview?: boolean;
  groundPlaneOffset?: number;
  active?: boolean;
  sourceSceneAssemblyComponentId?: string | null;
  sourceSceneAssemblyComponentTransform?: AssemblyTransform | null;
  showSourceSceneAssemblyComponentControls?: boolean;
  onSourceSceneAssemblyComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
  ) => void;
}

export interface CollisionTransformControlsProps {
  robot: THREE.Object3D | null;
  robotVersion?: number;
  selection: URDFViewerProps['selection'];
  transformMode: 'select' | 'translate' | 'rotate' | 'universal';
  setIsDragging: (dragging: boolean) => void;
  onTransformChange?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onTransformEnd?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  robotLinks?: Record<string, UrdfLink>;
  onTransformPending?: (pending: boolean) => void;
}

// Re-exported from shared layer
export type { JointControlItemProps } from '@/shared/components/Panel/JointControlItem';

export interface ViewerToolbarProps {
  activeMode: ToolMode;
  setMode: (mode: ToolMode) => void;
  onClose?: () => void;
  lang?: Language;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface MeasureToolProps {
  active: boolean;
  robot: THREE.Object3D | null;
  robotLinks?: Record<string, UrdfLink>;
  measureState: MeasureState;
  setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
  measureAnchorMode: MeasureAnchorMode;
  showDecomposition: boolean;
  deleteTooltip?: string;
  measureTargetResolverRef?: React.RefObject<MeasureTargetResolver | null>;
}

export interface JointInteractionProps {
  joint: any;
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onInteractionLockChange?: (locked: boolean) => void;
}
