/**
 * Robot Store types & constants
 *
 * Pure type definitions, shared constants and the initial-state factory for the
 * robot store. Extracted verbatim from the former monolithic `robotStore.ts` so
 * the slice modules and the facade can share a single source of truth without
 * changing any public shape.
 */
import { setAutoFreeze } from 'immer';
import type { StateCreator } from 'zustand';
import type {
  AssemblyComponent,
  AssemblyState,
  AssemblyTransform,
  BridgeJoint,
  JointQuaternion,
  RenderableBounds,
  RobotClosedLoopConstraint,
  RobotData as SharedRobotData,
  RobotFile,
  RobotInspectionContext,
  RobotMjcfTendonVisualizationUpdate,
  RobotMaterialState,
  UrdfLink,
  UrdfJoint,
} from '@/types';
import { DEFAULT_VISUAL_COLOR } from '@/types';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { createAttachedChildLink } from '@/core/robot';
import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';

export const INITIAL_LINK_ID = 'base_link';

export const createInitialRootLink = (): UrdfLink => {
  const link = createAttachedChildLink({
    id: INITIAL_LINK_ID,
    name: 'base_link',
  });

  return {
    ...link,
    visual: {
      ...link.visual,
      color: DEFAULT_VISUAL_COLOR,
    },
  };
};

// Robot data without selection (selection is in selectionStore)
export interface RobotData {
  name: string;
  version?: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  components?: Record<string, AssemblyComponent>;
  bridges?: Record<string, BridgeJoint>;
  workspaceTransform?: AssemblyTransform;
  activeComponentId?: string | null;
  /**
   * Compatibility view for code paths that still consume the old assembly
   * object shape. Canonical component data lives on `components`,
   * `bridges`, and `workspaceTransform`.
   */
  assemblyState?: AssemblyState | null;
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
  inspectionContext?: RobotInspectionContext;
}

export type RobotSnapshot = RobotData;

// History state for undo/redo
export interface HistoryState {
  past: RobotSnapshot[];
  future: RobotSnapshot[];
}

export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  label: string;
}

export interface UpdateOptions {
  skipHistory?: boolean;
  label?: string;
  resetHistory?: boolean;
}

export interface ApplyJointKinematicOverridesOptions {
  skipHistory?: boolean;
  historyLabel?: string;
}

export interface AssemblyContext {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  preResolvedImportResult?: RobotImportResult | null;
  preResolvedRobotData?: SharedRobotData | null;
  queueAutoGround?: boolean;
  preparedComponent?: {
    componentId: string;
    displayName: string;
    robotData: SharedRobotData;
    renderableBounds?: RenderableBounds | null;
  } | null;
}

export interface RobotActions {
  // Robot name
  setName: (name: string) => void;

  // Full robot data operations
  setRobot: (data: RobotData, options?: UpdateOptions) => void;
  resetRobot: (data?: RobotData) => void;

  // Component workspace operations
  setAssembly: (state: AssemblyState | null) => void;
  initAssembly: (name?: string) => void;
  exitAssembly: () => void;
  consumePendingAutoGroundComponentIds: (componentIds: Iterable<string>) => void;
  clearPendingAutoGroundComponentIds: () => void;
  addComponent: (file: RobotFile, context?: AssemblyContext) => AssemblyComponent | null;
  removeComponent: (id: string) => void;
  renameComponentSourceFolder: (fromPath: string, toPath: string, options?: UpdateOptions) => void;
  updateComponentName: (id: string, name: string, options?: UpdateOptions) => void;
  updateComponentTransform: (
    id: string,
    transform: AssemblyTransform,
    options?: UpdateOptions,
  ) => void;
  updateComponentRobot: (id: string, robot: Partial<SharedRobotData>, options?: UpdateOptions) => void;
  setComponentJointMotion: (
    componentId: string,
    angles: Record<string, number>,
    quaternions: Record<string, JointQuaternion>,
  ) => void;
  flushPendingAssemblyJointMotion: (options?: UpdateOptions) => boolean;
  toggleComponentVisibility: (id: string, visible?: boolean) => void;
  updateAssemblyTransform: (transform: AssemblyTransform, options?: UpdateOptions) => void;
  addBridge: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: Partial<UrdfJoint>;
  }) => BridgeJoint;
  removeBridge: (id: string) => void;
  updateBridge: (id: string, updates: Partial<BridgeJoint>, options?: UpdateOptions) => void;
  getMergedRobotData: () => SharedRobotData | null;

  // Link operations
  addLink: (link: UrdfLink) => void;
  updateLink: (id: string, updates: Partial<UrdfLink>, options?: UpdateOptions) => void;
  deleteLink: (linkId: string) => void;
  setLinkVisibility: (id: string, visible: boolean) => void;
  setAllLinksVisibility: (visible: boolean) => void;

  // Joint operations
  addJoint: (joint: UrdfJoint) => void;
  updateJoint: (id: string, updates: Partial<UrdfJoint>, options?: UpdateOptions) => void;
  deleteJoint: (jointId: string) => void;
  setJointAngle: (jointName: string, angle: number) => void;
  applyJointKinematicOverrides: (
    overrides: {
      angles?: Record<string, number>;
      quaternions?: Record<string, JointQuaternion>;
    },
    options?: ApplyJointKinematicOverridesOptions,
  ) => void;

  // MJCF inspection/visualization operations
  updateMjcfTendon: (
    tendonName: string,
    updates: RobotMjcfTendonVisualizationUpdate,
    options?: UpdateOptions,
  ) => void;

  // Tree operations
  addChild: (parentLinkId: string) => { linkId: string; jointId: string };
  deleteSubtree: (linkId: string) => void;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  pushHistorySnapshot: (snapshot: RobotData | AssemblyState | null, label: string) => void;

  // Computed values
  getJointAngles: () => Record<string, number>;
  getRootLink: () => UrdfLink | undefined;
  getLinkByName: (name: string) => UrdfLink | undefined;
  getJointByName: (name: string) => UrdfJoint | undefined;
  getChildJoints: (linkId: string) => UrdfJoint[];
  getParentJoint: (linkId: string) => UrdfJoint | undefined;
}

/**
 * The full robot store state shape (data + actions + internal bookkeeping).
 * Shared by the facade `create<RobotStoreState>()` call and by every slice
 * factory so they all operate against the same `set`/`get` types.
 */
export type RobotStoreState = RobotData &
  RobotActions & {
    assemblyRevision: number;
    assemblyJointMotionRevision: number;
    pendingAutoGroundComponentIds: string[];
    _history: HistoryState;
    _activity: ChangeLogEntry[];
  };

/**
 * `set`/`get` types as produced by the immer middleware inside the facade.
 * Derived from zustand's StateCreator so slice factories receive the exact same
 * references the facade's `immer((set, get) => ...)` hands out.
 */
type RobotStoreCreator = StateCreator<RobotStoreState, [['zustand/immer', never]], []>;
export type RobotStoreSet = Parameters<RobotStoreCreator>[0];
export type RobotStoreGet = Parameters<RobotStoreCreator>[1];

// Initial robot data
export const INITIAL_ROBOT_DATA: RobotData = {
  name: 'my_robot',
  links: {
    [INITIAL_LINK_ID]: createInitialRootLink(),
  },
  joints: {},
  rootLinkId: INITIAL_LINK_ID,
  components: {},
  bridges: {},
  workspaceTransform: cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM),
  activeComponentId: null,
  assemblyState: null,
};

// Maximum history entries
export const MAX_HISTORY = 50;
export const MAX_ACTIVITY_LOG = 200;
export const JOINT_MOTION_EPSILON = 1e-9;

// Keep Immer drafts mutable for the component joint-motion fast path. The
// canonical mutations still run through zustand/immer; only hot drag commits
// intentionally update nested joint angle fields in place before a flush.
//
// This is a module-level side effect that must run exactly once before the
// store is created. The facade imports this module, which guarantees the call
// executes ahead of `create()`.
setAutoFreeze(false);
