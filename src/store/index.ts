/**
 * Store - Zustand state management
 * Central export for all stores
 */

// UI Store - app mode, theme, language, view options, panels, etc.
export { useUIStore } from './uiStore';
export type {
  Language,
  ViewConfig,
  ViewOptions,
  PanelsState,
  SidebarState,
  GlobalFontSize,
  CodeEditorFontFamily,
  RotationDisplayMode,
  MassInertiaChangeBehavior,
} from './uiStore';

// Selection Store - link/joint selection and hover state
export { useSelectionStore, validateSelection } from './selectionStore';
export type { Selection } from './selectionStore';

// Assets Store - mesh/texture resources, robot files, motor library
export { useAssetsStore } from './assetsStore';

// Robot Store - robot data and operations with undo/redo
export {
  useRobotStore,
  useRobotName,
  useRobotLinks,
  useRobotJoints,
  useRootLinkId,
  useCanUndo,
  useCanRedo,
} from './robotStore';
export type { RobotData } from './robotStore';

// Assembly Store - multi-URDF assembly
export { useAssemblyStore, useAssemblyCanUndo, useAssemblyCanRedo } from './assemblyStore';

// Assembly selection store - component/assembly transform targets in workspace mode
export { useAssemblySelectionStore, ASSEMBLY_SELECTION_ID } from './assemblySelectionStore';

// Collision transform store - transient drag state for collision gizmos
export { useCollisionTransformStore } from './collisionTransformStore';
export type { PendingCollisionTransform } from './collisionTransformStore';

// Joint interaction preview store - transient drag/preview overlay for panels/editors
export {
  useJointInteractionPreviewStore,
  EMPTY_JOINT_INTERACTION_PREVIEW,
  hasJointInteractionPreview,
} from './jointInteractionPreviewStore';
export type {
  JointInteractionPreviewMatch,
  JointInteractionPreviewSource,
  JointInteractionPreviewSnapshot,
} from './jointInteractionPreviewStore';

// History helper (for custom stores that need undo/redo)
export { createHistoryManager } from './historyMiddleware';
export type { HistoryState, HistoryActions, HistoryOptions } from './historyMiddleware';
