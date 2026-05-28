/**
 * Robot Store - Manages robot data and operations
 * Uses immer for immutable updates and includes history middleware for undo/redo
 */
import { create } from 'zustand';
import { setAutoFreeze } from 'immer';
import { immer } from 'zustand/middleware/immer';
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
import { DEFAULT_JOINT, DEFAULT_VISUAL_COLOR, JointType } from '@/types';
import { describeRobotImportFailure, resolveRobotFileData } from '@/core/parsers';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import {
  buildAssemblyComponentIdentity,
  buildDefaultAssemblyComponentPlacementTransform,
  createAttachedChildLink,
  mergeAssembly,
  prepareAssemblyRobotData,
  resolveAssemblyComponentBaseName,
  resolveClosedLoopDrivenJointMotion,
  resolveDefaultChildJointOrigin,
} from '@/core/robot';
import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';
import {
  resolveAlignedAssemblyComponentTransformForBridge,
  resolveAssemblyComponentLinkId,
} from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import {
  syncRobotMaterialsForLinkUpdate,
  syncRobotVisualColorsFromMaterials,
} from '@/core/robot/materials';
import { failFastInDev } from '@/core/utils/runtimeDiagnostics';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';

const INITIAL_LINK_ID = 'base_link';
const createInitialRootLink = (): UrdfLink => {
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

type RobotSnapshot = RobotData;

// History state for undo/redo
interface HistoryState {
  past: RobotSnapshot[];
  future: RobotSnapshot[];
}

interface ChangeLogEntry {
  id: string;
  timestamp: string;
  label: string;
}

interface UpdateOptions {
  skipHistory?: boolean;
  label?: string;
  resetHistory?: boolean;
}

interface ApplyJointKinematicOverridesOptions {
  skipHistory?: boolean;
  historyLabel?: string;
}

interface AssemblyContext {
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
    suggestedTransform?: AssemblyTransform | null;
  } | null;
}

interface RobotActions {
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

// Initial robot data
const INITIAL_ROBOT_DATA: RobotData = {
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
const MAX_HISTORY = 50;
const MAX_ACTIVITY_LOG = 200;
const JOINT_MOTION_EPSILON = 1e-9;

// Keep Immer drafts mutable for the component joint-motion fast path. The
// canonical mutations still run through zustand/immer; only hot drag commits
// intentionally update nested joint angle fields in place before a flush.
setAutoFreeze(false);

const cloneRobotData = (data: RobotData): RobotData => structuredClone(normalizeRobotData(data));
const createChangeLogEntry = (label: string): ChangeLogEntry => ({
  id: `robot_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  label,
});

function normalizeAssemblySourcePath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function isSameOrNestedAssemblySourcePath(path: string, basePath: string): boolean {
  const normalizedPath = normalizeAssemblySourcePath(path);
  return normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`);
}

function replaceAssemblySourcePathPrefix(path: string, fromPath: string, toPath: string): string {
  const normalizedPath = normalizeAssemblySourcePath(path);
  if (normalizedPath === fromPath) {
    return toPath;
  }

  if (normalizedPath.startsWith(`${fromPath}/`)) {
    return `${toPath}/${normalizedPath.slice(fromPath.length + 1)}`;
  }

  return normalizedPath;
}

function cloneAssemblySnapshot(snapshot: AssemblyState | null | undefined): AssemblyState | null {
  return snapshot ? structuredClone(snapshot) : null;
}

function buildAssemblyBridgeId(): string {
  return `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildAssemblyComponentImportError(
  file: RobotFile,
  importResult: Exclude<RobotImportResult, { status: 'ready' }>,
): Error {
  const detail = describeRobotImportFailure(importResult);
  return new Error(`Failed to add assembly component from "${file.name}". ${detail}`);
}

function normalizeRobotData(data: RobotData): RobotData {
  const assemblyState = cloneAssemblySnapshot(data.assemblyState);
  const components = structuredClone(data.components ?? assemblyState?.components ?? {});
  const bridges = structuredClone(data.bridges ?? assemblyState?.bridges ?? {});
  const workspaceTransform = cloneAssemblyTransform(
    data.workspaceTransform ?? assemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );
  if (assemblyState) {
    assemblyState.components = components;
    assemblyState.bridges = bridges;
    assemblyState.transform = workspaceTransform;
  }
  const normalizedAssemblyState =
    assemblyState ??
    (Object.keys(components).length > 0
      ? {
          name: data.name || 'assembly',
          transform: workspaceTransform,
          components,
          bridges,
        }
      : null);

  return {
    ...data,
    components,
    bridges,
    workspaceTransform,
    activeComponentId: data.activeComponentId ?? null,
    assemblyState: normalizedAssemblyState,
  };
}

function createRobotSnapshotFromState(state: RobotData): RobotSnapshot {
  return cloneRobotData({
    name: state.name,
    version: state.version,
    links: state.links,
    joints: state.joints,
    rootLinkId: state.rootLinkId,
    components: state.components,
    bridges: state.bridges,
    workspaceTransform: state.workspaceTransform,
    activeComponentId: state.activeComponentId,
    assemblyState: state.assemblyState,
    materials: state.materials,
    closedLoopConstraints: state.closedLoopConstraints,
    inspectionContext: state.inspectionContext,
  });
}

function isAssemblySnapshot(value: RobotData | AssemblyState | null): value is AssemblyState | null {
  if (value === null) {
    return true;
  }

  return (
    typeof value === 'object' &&
    'components' in value &&
    'bridges' in value &&
    !('links' in value)
  );
}

function buildRobotSnapshotForAssemblySnapshot(
  currentState: RobotData,
  snapshot: AssemblyState | null,
): RobotSnapshot {
  const currentSnapshot = createRobotSnapshotFromState(currentState);
  const nextAssemblyState = cloneAssemblySnapshot(snapshot);
  currentSnapshot.assemblyState = nextAssemblyState;
  currentSnapshot.components = structuredClone(nextAssemblyState?.components ?? {});
  currentSnapshot.bridges = structuredClone(nextAssemblyState?.bridges ?? {});
  currentSnapshot.workspaceTransform = cloneAssemblyTransform(
    nextAssemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );
  if (nextAssemblyState) {
    currentSnapshot.name = nextAssemblyState.name || currentSnapshot.name;
  }
  return currentSnapshot;
}

function shouldProjectAssemblyToTopLevel(assemblyState: AssemblyState | null | undefined): boolean {
  if (!assemblyState) {
    return false;
  }

  return (
    Object.keys(assemblyState.components).length > 1 ||
    Object.keys(assemblyState.bridges).length > 0
  );
}

function syncWorkspaceFieldsFromAssemblyDraft(
  state: RobotData,
  assemblyState: AssemblyState | null,
): void {
  state.assemblyState = assemblyState;
  state.components = assemblyState?.components ?? {};
  state.bridges = assemblyState?.bridges ?? {};
  state.workspaceTransform = cloneAssemblyTransform(
    assemblyState?.transform ?? IDENTITY_ASSEMBLY_TRANSFORM,
  );
  state.activeComponentId =
    state.activeComponentId && state.components[state.activeComponentId]
      ? state.activeComponentId
      : (Object.keys(state.components)[0] ?? null);

  if (!shouldProjectAssemblyToTopLevel(assemblyState)) {
    return;
  }

  const mergedRobot = mergeAssembly(assemblyState);
  state.name = assemblyState.name || mergedRobot.name || state.name;
  state.links = mergedRobot.links;
  state.joints = mergedRobot.joints;
  state.rootLinkId = mergedRobot.rootLinkId;
  state.materials = mergedRobot.materials;
  state.closedLoopConstraints = mergedRobot.closedLoopConstraints;
  state.inspectionContext = mergedRobot.inspectionContext;
}

function appendPendingAutoGroundComponentId(
  pendingComponentIds: string[],
  componentId: string,
): void {
  if (!pendingComponentIds.includes(componentId)) {
    pendingComponentIds.push(componentId);
  }
}

function removePendingAutoGroundComponentIds(
  pendingComponentIds: string[],
  componentIds: Iterable<string>,
): void {
  const pendingComponentIdSet = new Set(componentIds);
  if (pendingComponentIdSet.size === 0) {
    return;
  }

  for (let index = pendingComponentIds.length - 1; index >= 0; index -= 1) {
    if (pendingComponentIdSet.has(pendingComponentIds[index])) {
      pendingComponentIds.splice(index, 1);
    }
  }
}

function shouldRecomputeBridgeAlignedChildTransform(
  currentBridge: BridgeJoint,
  updates: Partial<BridgeJoint>,
): boolean {
  if (
    Object.prototype.hasOwnProperty.call(updates, 'parentComponentId') ||
    Object.prototype.hasOwnProperty.call(updates, 'parentLinkId') ||
    Object.prototype.hasOwnProperty.call(updates, 'childComponentId') ||
    Object.prototype.hasOwnProperty.call(updates, 'childLinkId')
  ) {
    return true;
  }

  const nextJoint = updates.joint;
  if (!nextJoint) {
    return false;
  }

  return (
    nextJoint.parentLinkId !== currentBridge.joint.parentLinkId ||
    nextJoint.childLinkId !== currentBridge.joint.childLinkId ||
    nextJoint.origin?.xyz?.x !== currentBridge.joint.origin?.xyz?.x ||
    nextJoint.origin?.xyz?.y !== currentBridge.joint.origin?.xyz?.y ||
    nextJoint.origin?.xyz?.z !== currentBridge.joint.origin?.xyz?.z ||
    nextJoint.origin?.rpy?.r !== currentBridge.joint.origin?.rpy?.r ||
    nextJoint.origin?.rpy?.p !== currentBridge.joint.origin?.rpy?.p ||
    nextJoint.origin?.rpy?.y !== currentBridge.joint.origin?.rpy?.y
  );
}

function assertStructuralBridgeCanBeApplied(
  assembly: AssemblyState,
  bridge: BridgeJoint,
  options?: { ignoreBridgeId?: string },
): void {
  const parentComponent = assembly.components[bridge.parentComponentId];
  if (!parentComponent) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent component "${bridge.parentComponentId}" does not exist.`,
    );
  }

  const childComponent = assembly.components[bridge.childComponentId];
  if (!childComponent) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child component "${bridge.childComponentId}" does not exist.`,
    );
  }

  if (bridge.parentComponentId === bridge.childComponentId) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent and child component are both "${bridge.parentComponentId}".`,
    );
  }

  if (!resolveAssemblyComponentLinkId(parentComponent, bridge.parentLinkId)) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because parent link "${bridge.parentLinkId}" does not exist on component "${bridge.parentComponentId}".`,
    );
  }

  if (!resolveAssemblyComponentLinkId(childComponent, bridge.childLinkId)) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child link "${bridge.childLinkId}" does not exist on component "${bridge.childComponentId}".`,
    );
  }

  const conflictingIncomingBridgeIds = Object.values(assembly.bridges)
    .filter((existingBridge) => existingBridge.id !== options?.ignoreBridgeId)
    .filter((existingBridge) => existingBridge.childComponentId === bridge.childComponentId)
    .filter((existingBridge) =>
      Boolean(resolveAssemblyComponentLinkId(childComponent, existingBridge.childLinkId)),
    )
    .map((existingBridge) => existingBridge.id);

  if (conflictingIncomingBridgeIds.length > 0) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because child component "${bridge.childComponentId}" already has an incoming bridge: ${conflictingIncomingBridgeIds.join(', ')}.`,
    );
  }

  if (
    wouldBridgeCreateUnsupportedAssemblyCycle(
      Object.values(assembly.bridges),
      bridge,
      bridge.joint.type,
      options,
    )
  ) {
    throw new Error(
      `Cannot apply bridge "${bridge.id}" because it would close a cycle with joint type "${bridge.joint.type}". Only fixed cyclic bridges can be converted into closed-loop constraints.`,
    );
  }
}

function jointQuaternionValuesEqual(
  left: JointQuaternion | undefined,
  right: JointQuaternion,
): boolean {
  if (!left) {
    return false;
  }

  return (
    Math.abs(left.x - right.x) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.y - right.y) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.z - right.z) <= JOINT_MOTION_EPSILON &&
    Math.abs(left.w - right.w) <= JOINT_MOTION_EPSILON
  );
}

function jointMotionSolutionChangesState(
  robot: Pick<RobotData, 'joints'>,
  solution: {
    angles: Record<string, number>;
    quaternions: Record<string, JointQuaternion>;
  },
): boolean {
  for (const [jointId, angle] of Object.entries(solution.angles)) {
    const joint = robot.joints[jointId];
    if (!joint) {
      continue;
    }

    if (
      joint.angle === undefined ||
      Math.abs(joint.angle - angle) > JOINT_MOTION_EPSILON
    ) {
      return true;
    }
  }

  for (const [jointId, quaternion] of Object.entries(solution.quaternions)) {
    const joint = robot.joints[jointId];
    if (!joint) {
      continue;
    }

    if (!jointQuaternionValuesEqual(joint.quaternion, quaternion)) {
      return true;
    }
  }

  return false;
}

export const useRobotStore = create<
  RobotData &
    RobotActions & {
      assemblyRevision: number;
      assemblyJointMotionRevision: number;
      pendingAutoGroundComponentIds: string[];
      _history: HistoryState;
      _activity: ChangeLogEntry[];
    }
>()(
  immer((set, get) => {
    let cachedAssemblyState: AssemblyState | null | undefined;
    let cachedAssemblyJointMotionRevision = -1;
    let cachedMergedRobotData: SharedRobotData | null = null;
    interface PendingJointMotionEntry {
      originalAngles: Map<string, number | undefined>;
      originalQuaternions: Map<string, JointQuaternion | undefined>;
    }
    let pendingJointMotionByComponentId = new Map<string, PendingJointMotionEntry>();

    const appendHistorySnapshot = (snapshot: RobotData | AssemblyState | null, label: string) => {
      set((state) => {
        const robotSnapshot = isAssemblySnapshot(snapshot)
          ? buildRobotSnapshotForAssemblySnapshot(state, snapshot)
          : cloneRobotData(snapshot);
        state._history.past = [...state._history.past, robotSnapshot].slice(-MAX_HISTORY);
        state._history.future = [];
        state._activity = [...state._activity, createChangeLogEntry(label)].slice(
          -MAX_ACTIVITY_LOG,
        );
      });
    };

    // Helper to save current state to history
    const saveToHistory = (label: string) => {
      const {
        name,
        version,
        links,
        joints,
        rootLinkId,
        materials,
        closedLoopConstraints,
        inspectionContext,
        components,
        bridges,
        workspaceTransform,
        activeComponentId,
        assemblyState,
      } = get();
      appendHistorySnapshot(
        {
          name,
          version,
          links,
          joints,
          rootLinkId,
          components,
          bridges,
          workspaceTransform,
          activeComponentId,
          assemblyState,
          materials,
          closedLoopConstraints,
          inspectionContext,
        },
        label,
      );
    };

    const applyAssemblyMutation = (
      label: string,
      recipe: (draft: AssemblyState | null) => AssemblyState | null | void,
      options?: { skipHistory?: boolean },
    ): boolean => {
      const currentState = get();
      const draftAssemblyState = cloneAssemblySnapshot(currentState.assemblyState);
      const recipeResult = recipe(draftAssemblyState);
      const nextAssemblyState =
        recipeResult === undefined ? draftAssemblyState : (recipeResult as AssemblyState | null);

      if (JSON.stringify(currentState.assemblyState ?? null) === JSON.stringify(nextAssemblyState)) {
        return false;
      }

      if (!options?.skipHistory) {
        appendHistorySnapshot(createRobotSnapshotFromState(currentState), label);
      }

      set((state) => {
        syncWorkspaceFieldsFromAssemblyDraft(state, nextAssemblyState);
        state.assemblyRevision += 1;
      });
      return true;
    };

    return {
      // Initial state
      ...INITIAL_ROBOT_DATA,
      assemblyRevision: 0,
      assemblyJointMotionRevision: 0,
      pendingAutoGroundComponentIds: [],
      _history: { past: [], future: [] },
      _activity: [],

      // Robot name
      setName: (name) => {
        saveToHistory('Rename robot');
        set((state) => {
          state.name = name;
        });
      },

      // Full robot data
      setRobot: (data, options) => {
        const normalizedData = syncRobotVisualColorsFromMaterials(data);
        const shouldResetHistory = options?.resetHistory === true;
        const historyLabel = options?.label ?? 'Load robot state';

        if (!options?.skipHistory && !shouldResetHistory) {
          saveToHistory(historyLabel);
        }

        set((state) => {
          state.name = normalizedData.name;
          state.version = normalizedData.version;
          state.links = normalizedData.links;
          state.joints = normalizedData.joints;
          state.rootLinkId = normalizedData.rootLinkId;
          state.components = normalizedData.components;
          state.bridges = normalizedData.bridges;
          state.workspaceTransform = normalizedData.workspaceTransform;
          state.activeComponentId = normalizedData.activeComponentId;
          state.assemblyState = normalizedData.assemblyState;
          state.materials = normalizedData.materials;
          state.closedLoopConstraints = normalizedData.closedLoopConstraints;
          state.inspectionContext = normalizedData.inspectionContext;
          state.assemblyRevision += 1;
          if (shouldResetHistory) {
            state._history = { past: [], future: [] };
            state._activity = [...state._activity, createChangeLogEntry(historyLabel)].slice(
              -MAX_ACTIVITY_LOG,
            );
          }
        });
      },

      resetRobot: (data) => {
        const newData = syncRobotVisualColorsFromMaterials(data || INITIAL_ROBOT_DATA);
        set((state) => {
          state.name = newData.name;
          state.version = newData.version;
          state.links = newData.links;
          state.joints = newData.joints;
          state.rootLinkId = newData.rootLinkId;
          state.components = newData.components;
          state.bridges = newData.bridges;
          state.workspaceTransform = newData.workspaceTransform;
          state.activeComponentId = newData.activeComponentId;
          state.assemblyState = newData.assemblyState;
          state.materials = newData.materials;
          state.closedLoopConstraints = newData.closedLoopConstraints;
          state.inspectionContext = newData.inspectionContext;
          state._history = { past: [], future: [] };
          state.assemblyRevision += 1;
          state.pendingAutoGroundComponentIds = [];
        });
      },

      setAssembly: (assemblyState) => {
        applyAssemblyMutation('Load component workspace', () => cloneAssemblySnapshot(assemblyState));
        set((state) => {
          state.pendingAutoGroundComponentIds = [];
        });
      },

      initAssembly: (name = 'assembly') => {
        applyAssemblyMutation('Initialize component workspace', () => ({
          name,
          transform: cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM),
          components: {},
          bridges: {},
        }));
        set((state) => {
          state.pendingAutoGroundComponentIds = [];
        });
      },

      exitAssembly: () => {
        applyAssemblyMutation('Clear component workspace', () => null);
        set((state) => {
          state.pendingAutoGroundComponentIds = [];
        });
      },

      consumePendingAutoGroundComponentIds: (componentIds) => {
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, componentIds);
        });
      },

      clearPendingAutoGroundComponentIds: () => {
        set((state) => {
          state.pendingAutoGroundComponentIds = [];
        });
      },

      addComponent: (file, context = {}) => {
        const state = get();
        const assemblyState = state.assemblyState;
        const preparedComponent = context.preparedComponent;
        const queueAutoGround = context.queueAutoGround ?? true;
        const existingComponentIds = Object.keys(assemblyState?.components ?? {});
        const existingComponentNames = Object.values(assemblyState?.components ?? {}).map(
          (component) => component.name,
        );
        const canUsePreparedComponent =
          Boolean(preparedComponent) &&
          !existingComponentIds.includes(preparedComponent!.componentId) &&
          !existingComponentNames.includes(preparedComponent!.displayName);
        let identity =
          canUsePreparedComponent && preparedComponent
            ? {
                componentId: preparedComponent.componentId,
                displayName: preparedComponent.displayName,
              }
            : null;

        const namespacedRobot = (() => {
          if (canUsePreparedComponent && preparedComponent) {
            return preparedComponent.robotData;
          }

          const importResult =
            context.preResolvedImportResult?.status === 'ready' &&
            context.preResolvedImportResult.format === file.format
              ? context.preResolvedImportResult
              : resolveRobotFileData(file, {
                  availableFiles: context.availableFiles,
                  assets: context.assets,
                  allFileContents: context.allFileContents,
                  usdRobotData: context.preResolvedRobotData ?? null,
                });

          if (importResult.status !== 'ready') {
            const importError = buildAssemblyComponentImportError(file, importResult);
            failFastInDev('RobotStore:addComponent', importError);
            throw importError;
          }

          identity = buildAssemblyComponentIdentity({
            fileName: file.name,
            baseName: resolveAssemblyComponentBaseName(file, importResult.robotData.name),
            existingComponentIds,
            existingComponentNames,
          });

          return prepareAssemblyRobotData(importResult.robotData, {
            componentId: identity.componentId,
            rootName: identity.displayName,
            sourceFilePath: file.name,
            sourceFormat: file.format,
          });
        })();

        if (!namespacedRobot) {
          return null;
        }
        if (!identity) {
          return null;
        }

        const component: AssemblyComponent = {
          id: identity.componentId,
          name: identity.displayName,
          sourceFile: file.name,
          robot: namespacedRobot,
          renderableBounds: preparedComponent?.renderableBounds ?? undefined,
          transform: preparedComponent?.suggestedTransform
            ? cloneAssemblyTransform(preparedComponent.suggestedTransform)
            : buildDefaultAssemblyComponentPlacementTransform({
                robot: namespacedRobot,
                renderableBounds: preparedComponent?.renderableBounds ?? null,
                existingComponents: Object.values(assemblyState?.components ?? {}),
              }),
          visible: true,
        };

        const didAddComponent = applyAssemblyMutation('Add component', (draft) => {
          const nextDraft = draft ?? {
            name: state.name || 'workspace',
            transform: cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM),
            components: {},
            bridges: {},
          };
          nextDraft.components[identity.componentId] = component;
          return draft ? undefined : nextDraft;
        });

        if (didAddComponent && queueAutoGround) {
          set((storeState) => {
            appendPendingAutoGroundComponentId(
              storeState.pendingAutoGroundComponentIds,
              identity.componentId,
            );
          });
        }

        return component;
      },

      removeComponent: (id) => {
        applyAssemblyMutation('Remove component', (draft) => {
          if (!draft) {
            return;
          }

          delete draft.components[id];
          Object.keys(draft.bridges).forEach((bridgeId) => {
            const bridge = draft.bridges[bridgeId];
            if (bridge.parentComponentId === id || bridge.childComponentId === id) {
              delete draft.bridges[bridgeId];
            }
          });
        });
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [id]);
        });
      },

      renameComponentSourceFolder: (fromPath, toPath, options) => {
        const normalizedFromPath = normalizeAssemblySourcePath(fromPath);
        const normalizedToPath = normalizeAssemblySourcePath(toPath);

        if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === normalizedToPath) {
          return;
        }

        const currentAssembly = get().assemblyState;
        if (!currentAssembly) {
          return;
        }

        const hasMatchingComponent = Object.values(currentAssembly.components).some((component) =>
          isSameOrNestedAssemblySourcePath(component.sourceFile, normalizedFromPath),
        );

        if (!hasMatchingComponent) {
          return;
        }

        applyAssemblyMutation(
          options?.label ?? 'Rename component sources',
          (draft) => {
            const components = draft?.components;
            if (!components) return;

            Object.values(components).forEach((component) => {
              if (isSameOrNestedAssemblySourcePath(component.sourceFile, normalizedFromPath)) {
                component.sourceFile = replaceAssemblySourcePathPrefix(
                  component.sourceFile,
                  normalizedFromPath,
                  normalizedToPath,
                );
              }
            });
          },
          { skipHistory: options?.skipHistory },
        );
      },

      updateComponentName: (id, name, options) => {
        applyAssemblyMutation(
          options?.label ?? 'Rename component',
          (draft) => {
            const component = draft?.components[id];
            if (component) {
              component.name = name;
            }
          },
          { skipHistory: options?.skipHistory },
        );
      },

      updateComponentTransform: (id, transform, options) => {
        applyAssemblyMutation(
          options?.label ?? 'Transform component',
          (draft) => {
            const component = draft?.components[id];
            if (component) {
              component.transform = cloneAssemblyTransform(transform);
            }
          },
          { skipHistory: options?.skipHistory },
        );
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [id]);
        });
      },

      updateComponentRobot: (id, robotUpdates, options) => {
        applyAssemblyMutation(
          options?.label ?? 'Update component',
          (draft) => {
            const component = draft?.components[id];
            if (!component) {
              return;
            }

            const hasExplicitMaterials = Object.prototype.hasOwnProperty.call(
              robotUpdates,
              'materials',
            );
            let nextMaterials = hasExplicitMaterials
              ? robotUpdates.materials
              : component.robot.materials;

            if (!hasExplicitMaterials && robotUpdates.links) {
              Object.entries(robotUpdates.links).forEach(([linkId, nextLink]) => {
                const previousLink = component.robot.links[linkId];
                if (previousLink === nextLink) {
                  return;
                }

                nextMaterials = syncRobotMaterialsForLinkUpdate(
                  nextMaterials,
                  nextLink,
                  previousLink,
                );
              });
            }

            Object.assign(component.robot, robotUpdates);

            if (!hasExplicitMaterials && nextMaterials !== component.robot.materials) {
              component.robot.materials = nextMaterials;
            }
          },
          { skipHistory: options?.skipHistory },
        );
      },

      setComponentJointMotion: (id, angles, quaternions) => {
        const currentAssemblyState = get().assemblyState;
        const component = currentAssemblyState?.components[id];
        if (!component) {
          return;
        }

        const pending = pendingJointMotionByComponentId.get(id) ?? {
          originalAngles: new Map<string, number | undefined>(),
          originalQuaternions: new Map<string, JointQuaternion | undefined>(),
        };

        let mutated = false;
        for (const [jointId, angle] of Object.entries(angles)) {
          const joint = component.robot.joints[jointId];
          if (!joint || !Number.isFinite(angle) || joint.angle === angle) {
            continue;
          }
          if (!pending.originalAngles.has(jointId)) {
            pending.originalAngles.set(jointId, joint.angle);
          }
          joint.angle = angle;
          mutated = true;
        }

        for (const [jointId, quaternion] of Object.entries(quaternions)) {
          const joint = component.robot.joints[jointId];
          if (!joint || !quaternion) {
            continue;
          }
          const previous = joint.quaternion;
          if (
            previous &&
            previous.x === quaternion.x &&
            previous.y === quaternion.y &&
            previous.z === quaternion.z &&
            previous.w === quaternion.w
          ) {
            continue;
          }
          if (!pending.originalQuaternions.has(jointId)) {
            pending.originalQuaternions.set(jointId, previous);
          }
          joint.quaternion = { ...quaternion };
          mutated = true;
        }

        if (!mutated) {
          return;
        }

        pendingJointMotionByComponentId.set(id, pending);
        set((state) => {
          state.assemblyJointMotionRevision += 1;
        });
      },

      flushPendingAssemblyJointMotion: (options) => {
        if (pendingJointMotionByComponentId.size === 0) {
          return false;
        }

        const pendingByComponent = pendingJointMotionByComponentId;
        pendingJointMotionByComponentId = new Map();
        const liveAssembly = get().assemblyState;
        if (!liveAssembly) {
          return false;
        }

        const latestByComponent = new Map<
          string,
          {
            angles: Map<string, number | undefined>;
            quaternions: Map<string, JointQuaternion | undefined>;
          }
        >();

        for (const [componentId, entry] of pendingByComponent.entries()) {
          const component = liveAssembly.components[componentId];
          if (!component) continue;
          const latest = {
            angles: new Map<string, number | undefined>(),
            quaternions: new Map<string, JointQuaternion | undefined>(),
          };

          for (const [jointId, originalAngle] of entry.originalAngles.entries()) {
            const joint = component.robot.joints[jointId];
            if (!joint) continue;
            latest.angles.set(jointId, joint.angle);
            if (originalAngle === undefined) {
              delete joint.angle;
            } else {
              joint.angle = originalAngle;
            }
          }

          for (const [jointId, originalQuaternion] of entry.originalQuaternions.entries()) {
            const joint = component.robot.joints[jointId];
            if (!joint) continue;
            latest.quaternions.set(jointId, joint.quaternion);
            if (originalQuaternion === undefined) {
              delete joint.quaternion;
            } else {
              joint.quaternion = { ...originalQuaternion };
            }
          }

          latestByComponent.set(componentId, latest);
        }

        return applyAssemblyMutation(
          options?.label ?? 'Commit joint motion',
          (draft) => {
            if (!draft) {
              return;
            }

            for (const [componentId, latest] of latestByComponent.entries()) {
              const draftComponent = draft.components[componentId];
              if (!draftComponent) continue;
              for (const [jointId, nextAngle] of latest.angles.entries()) {
                const draftJoint = draftComponent.robot.joints[jointId];
                if (!draftJoint) continue;
                if (nextAngle === undefined) {
                  delete draftJoint.angle;
                } else {
                  draftJoint.angle = nextAngle;
                }
              }
              for (const [jointId, nextQuaternion] of latest.quaternions.entries()) {
                const draftJoint = draftComponent.robot.joints[jointId];
                if (!draftJoint) continue;
                if (nextQuaternion === undefined) {
                  delete draftJoint.quaternion;
                } else {
                  draftJoint.quaternion = { ...nextQuaternion };
                }
              }
            }
          },
          { skipHistory: options?.skipHistory },
        );
      },

      toggleComponentVisibility: (id, visible) => {
        applyAssemblyMutation('Toggle component visibility', (draft) => {
          const component = draft?.components[id];
          if (component) {
            component.visible = visible !== undefined ? visible : !component.visible;
          }
        });
      },

      updateAssemblyTransform: (transform, options) => {
        applyAssemblyMutation(
          options?.label ?? 'Transform workspace',
          (draft) => {
            if (draft) {
              draft.transform = cloneAssemblyTransform(transform);
            }
          },
          { skipHistory: options?.skipHistory },
        );
      },

      addBridge: (params) => {
        const id = buildAssemblyBridgeId();
        const fullJoint: UrdfJoint = {
          ...DEFAULT_JOINT,
          id,
          name: params.name,
          type: params.joint.type ?? JointType.FIXED,
          parentLinkId: params.parentLinkId,
          childLinkId: params.childLinkId,
          origin: params.joint.origin ?? {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          axis: params.joint.axis ?? { x: 0, y: 0, z: 1 },
          limit: params.joint.limit ?? DEFAULT_JOINT.limit,
          dynamics: params.joint.dynamics ?? DEFAULT_JOINT.dynamics,
          hardware: params.joint.hardware ?? DEFAULT_JOINT.hardware,
        };

        const bridge: BridgeJoint = {
          id,
          name: params.name,
          parentComponentId: params.parentComponentId,
          parentLinkId: params.parentLinkId,
          childComponentId: params.childComponentId,
          childLinkId: params.childLinkId,
          joint: fullJoint,
        };

        applyAssemblyMutation('Add bridge joint', (draft) => {
          const nextDraft = draft ?? {
            name: get().name || 'workspace',
            transform: cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM),
            components: {},
            bridges: {},
          };
          assertStructuralBridgeCanBeApplied(nextDraft, bridge);
          nextDraft.bridges[id] = bridge;
          const alignedTransform = resolveAlignedAssemblyComponentTransformForBridge(
            nextDraft,
            bridge,
          );
          if (alignedTransform) {
            const childComponent = nextDraft.components[bridge.childComponentId];
            if (childComponent) {
              childComponent.transform = alignedTransform;
            }
          }
          return draft ? undefined : nextDraft;
        });
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [
            params.childComponentId,
          ]);
        });

        return bridge;
      },

      removeBridge: (id) => {
        applyAssemblyMutation('Remove bridge joint', (draft) => {
          if (draft?.bridges[id]) {
            delete draft.bridges[id];
          }
        });
      },

      updateBridge: (id, updates, options) => {
        const currentBridge = get().assemblyState?.bridges[id] as BridgeJoint | undefined;
        const shouldRealignChild = currentBridge
          ? shouldRecomputeBridgeAlignedChildTransform(currentBridge, updates)
          : false;
        const nextChildComponentId =
          updates.childComponentId ?? currentBridge?.childComponentId ?? null;

        applyAssemblyMutation(
          options?.label ?? 'Update bridge joint',
          (draft) => {
            const bridge = draft?.bridges[id];
            if (!bridge || !draft) {
              return;
            }

            const nextBridge: BridgeJoint = {
              ...bridge,
              ...updates,
              name: updates.name ?? updates.joint?.name ?? bridge.name,
              parentLinkId: updates.joint?.parentLinkId ?? updates.parentLinkId ?? bridge.parentLinkId,
              childLinkId: updates.joint?.childLinkId ?? updates.childLinkId ?? bridge.childLinkId,
              joint: {
                ...bridge.joint,
                ...(updates.joint ?? {}),
                name: updates.name ?? updates.joint?.name ?? bridge.joint.name,
                parentLinkId:
                  updates.joint?.parentLinkId ?? updates.parentLinkId ?? bridge.joint.parentLinkId,
                childLinkId:
                  updates.joint?.childLinkId ?? updates.childLinkId ?? bridge.joint.childLinkId,
              },
            };

            assertStructuralBridgeCanBeApplied(draft, nextBridge, {
              ignoreBridgeId: bridge.id,
            });

            Object.assign(bridge, nextBridge);

            if (shouldRecomputeBridgeAlignedChildTransform(bridge, updates)) {
              const alignedTransform = resolveAlignedAssemblyComponentTransformForBridge(
                draft,
                bridge,
              );
              if (alignedTransform) {
                const childComponent = draft.components[bridge.childComponentId];
                if (childComponent) {
                  childComponent.transform = alignedTransform;
                }
              }
            }
          },
          { skipHistory: options?.skipHistory },
        );

        if (shouldRealignChild && nextChildComponentId) {
          set((state) => {
            removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [
              nextChildComponentId,
            ]);
          });
        }
      },

      getMergedRobotData: () => {
        const { assemblyState, assemblyJointMotionRevision } = get();
        if (
          assemblyState === cachedAssemblyState &&
          assemblyJointMotionRevision === cachedAssemblyJointMotionRevision
        ) {
          return cachedMergedRobotData;
        }

        if (!assemblyState || Object.keys(assemblyState.components).length === 0) {
          cachedAssemblyState = assemblyState;
          cachedAssemblyJointMotionRevision = assemblyJointMotionRevision;
          cachedMergedRobotData = null;
          return null;
        }

        const visibleComponents: Record<string, AssemblyComponent> = {};
        const visibleCompIds = new Set<string>();
        Object.entries(assemblyState.components).forEach(([id, component]) => {
          if (component.visible !== false) {
            visibleComponents[id] = component;
            visibleCompIds.add(id);
          }
        });

        if (Object.keys(visibleComponents).length === 0) {
          cachedAssemblyState = assemblyState;
          cachedAssemblyJointMotionRevision = assemblyJointMotionRevision;
          cachedMergedRobotData = null;
          return null;
        }

        const visibleBridges: Record<string, BridgeJoint> = {};
        Object.entries(assemblyState.bridges).forEach(([id, bridge]) => {
          if (
            visibleCompIds.has(bridge.parentComponentId) &&
            visibleCompIds.has(bridge.childComponentId)
          ) {
            visibleBridges[id] = bridge;
          }
        });

        cachedAssemblyState = assemblyState;
        cachedAssemblyJointMotionRevision = assemblyJointMotionRevision;
        cachedMergedRobotData = mergeAssembly({
          ...assemblyState,
          components: visibleComponents,
          bridges: visibleBridges,
        });

        return cachedMergedRobotData;
      },

      // Link operations
      addLink: (link) => {
        saveToHistory('Add link');
        set((state) => {
          state.links[link.id] = link;
        });
      },

      updateLink: (id, updates, options) => {
        if (!options?.skipHistory) {
          saveToHistory(options?.label ?? 'Update link');
        }
        set((state) => {
          const currentLink = state.links[id];
          if (currentLink) {
            const nextLink = { ...currentLink, ...updates };
            state.links[id] = nextLink;

            const nextMaterials = syncRobotMaterialsForLinkUpdate(
              state.materials,
              nextLink,
              currentLink,
            );

            if (nextMaterials !== state.materials) {
              state.materials = nextMaterials;
            }
          }
        });
      },

      deleteLink: (linkId) => {
        if (linkId === get().rootLinkId) return; // Cannot delete root
        saveToHistory('Delete link');
        set((state) => {
          delete state.links[linkId];
          // Also delete joints connected to this link
          Object.keys(state.joints).forEach((jId) => {
            const joint = state.joints[jId];
            if (joint.parentLinkId === linkId || joint.childLinkId === linkId) {
              delete state.joints[jId];
            }
          });
        });
      },

      setLinkVisibility: (id, visible) => {
        saveToHistory('Toggle link visibility');
        set((state) => {
          if (state.links[id]) {
            state.links[id].visible = visible;
          }
        });
      },

      setAllLinksVisibility: (visible) => {
        saveToHistory('Toggle all link visibility');
        set((state) => {
          Object.keys(state.links).forEach((id) => {
            state.links[id].visible = visible;
          });
        });
      },

      // Joint operations
      addJoint: (joint) => {
        saveToHistory('Add joint');
        set((state) => {
          state.joints[joint.id] = joint;
        });
      },

      updateJoint: (id, updates, options) => {
        if (!options?.skipHistory) {
          saveToHistory(options?.label ?? 'Update joint');
        }
        set((state) => {
          if (state.joints[id]) {
            Object.assign(state.joints[id], updates);
          }
        });
      },

      deleteJoint: (jointId) => {
        saveToHistory('Delete joint');
        set((state) => {
          delete state.joints[jointId];
        });
      },

      setJointAngle: (jointName, angle) => {
        const state = get();
        const jointId = state.joints[jointName]
          ? jointName
          : Object.entries(state.joints).find(([, j]) => j.name === jointName)?.[0];
        if (!jointId) return;

        const solution = resolveClosedLoopDrivenJointMotion(state, jointId, angle);
        if (!jointMotionSolutionChangesState(state, solution)) {
          return;
        }

        // Don't save to history for joint angle changes (too frequent)
        set((state) => {
          Object.entries(solution.angles).forEach(([compensatedJointId, compensatedAngle]) => {
            if (state.joints[compensatedJointId]) {
              state.joints[compensatedJointId].angle = compensatedAngle;
            }
          });
          Object.entries(solution.quaternions).forEach(
            ([compensatedJointId, compensatedQuaternion]) => {
              if (state.joints[compensatedJointId]) {
                state.joints[compensatedJointId].quaternion = compensatedQuaternion;
              }
            },
          );
        });
      },

      applyJointKinematicOverrides: (overrides, options) => {
        const nextAngles = overrides.angles ?? {};
        const nextQuaternions = overrides.quaternions ?? {};
        if (Object.keys(nextAngles).length === 0 && Object.keys(nextQuaternions).length === 0) {
          return;
        }

        if (!options?.skipHistory) {
          saveToHistory(options?.historyLabel ?? 'Update joint motion');
        }

        set((state) => {
          Object.entries(nextAngles).forEach(([jointId, angle]) => {
            if (state.joints[jointId]) {
              state.joints[jointId].angle = angle;
            }
          });

          Object.entries(nextQuaternions).forEach(([jointId, quaternion]) => {
            if (state.joints[jointId]) {
              state.joints[jointId].quaternion = quaternion;
            }
          });
        });
      },

      updateMjcfTendon: (tendonName, updates, options) => {
        const currentTendon = get().inspectionContext?.mjcf?.tendons.find(
          (tendon) => tendon.name === tendonName,
        );
        if (!currentTendon) {
          return;
        }

        if (!options?.skipHistory) {
          saveToHistory(options?.label ?? 'Update tendon');
        }

        set((state) => {
          const tendon = state.inspectionContext?.mjcf?.tendons.find(
            (entry) => entry.name === tendonName,
          );
          if (!tendon) {
            return;
          }

          if (typeof updates.width === 'number' && Number.isFinite(updates.width)) {
            tendon.width = updates.width;
          }

          if (updates.rgba) {
            tendon.rgba = [...updates.rgba] as [number, number, number, number];
          }
        });
      },

      // Tree operations
      addChild: (parentLinkId) => {
        const state = get();
        const newLinkId = `link_${Date.now()}`;
        const newJointId = `joint_${Date.now()}`;

        // Calculate offset for new child
        const siblings = Object.values(state.joints).filter((j) => j.parentLinkId === parentLinkId);
        const yOffset = siblings.length * 0.5;
        const parentLink = state.links[parentLinkId];

        const newLink: UrdfLink = createAttachedChildLink({
          id: newLinkId,
          name: `link_${Object.keys(state.links).length + 1}`,
        });
        newLink.visual = {
          ...newLink.visual,
          color: DEFAULT_VISUAL_COLOR,
        };

        const newJoint: UrdfJoint = {
          ...DEFAULT_JOINT,
          id: newJointId,
          name: `joint_${Object.keys(state.joints).length + 1}`,
          parentLinkId,
          childLinkId: newLinkId,
          origin: resolveDefaultChildJointOrigin(parentLink, yOffset),
        };

        saveToHistory('Add child subtree');
        set((state) => {
          state.links[newLinkId] = newLink;
          state.joints[newJointId] = newJoint;
        });

        return { linkId: newLinkId, jointId: newJointId };
      },

      deleteSubtree: (linkId) => {
        const state = get();
        if (linkId === state.rootLinkId) return;

        const toDeleteLinks = new Set<string>();
        const toDeleteJoints = new Set<string>();

        // Recursively collect links and joints to delete
        const collect = (lId: string, visited: Set<string>) => {
          if (visited.has(lId)) return;
          visited.add(lId);

          toDeleteLinks.add(lId);
          Object.values(state.joints).forEach((j) => {
            if (j.parentLinkId === lId) {
              toDeleteJoints.add(j.id);
              collect(j.childLinkId, visited);
            }
            if (j.childLinkId === lId) {
              toDeleteJoints.add(j.id);
            }
          });
        };

        collect(linkId, new Set<string>());

        saveToHistory('Delete subtree');
        set((state) => {
          toDeleteLinks.forEach((id) => delete state.links[id]);
          toDeleteJoints.forEach((id) => delete state.joints[id]);
        });
      },

      // History operations
      undo: () => {
        const {
          _history,
          name,
          links,
          joints,
          rootLinkId,
          materials,
          closedLoopConstraints,
          inspectionContext,
          components,
          bridges,
          workspaceTransform,
          activeComponentId,
          assemblyState,
        } = get();
        if (_history.past.length === 0) return;

        const previous = cloneRobotData(_history.past[_history.past.length - 1]);
        const currentData = cloneRobotData({
          name,
          links,
          joints,
          rootLinkId,
          components,
          bridges,
          workspaceTransform,
          activeComponentId,
          assemblyState,
          materials,
          closedLoopConstraints,
          inspectionContext,
        });

        set((state) => {
          state.name = previous.name;
          state.version = previous.version;
          state.links = previous.links;
          state.joints = previous.joints;
          state.rootLinkId = previous.rootLinkId;
          state.components = previous.components;
          state.bridges = previous.bridges;
          state.workspaceTransform = previous.workspaceTransform;
          state.activeComponentId = previous.activeComponentId;
          state.assemblyState = previous.assemblyState;
          state.materials = previous.materials;
          state.closedLoopConstraints = previous.closedLoopConstraints;
          state.inspectionContext = previous.inspectionContext;
          state._history.past = state._history.past.slice(-(MAX_HISTORY + 1), -1);
          state._history.future = [currentData, ...state._history.future].slice(0, MAX_HISTORY);
          state.assemblyRevision += 1;
        });
      },

      redo: () => {
        const {
          _history,
          name,
          links,
          joints,
          rootLinkId,
          materials,
          closedLoopConstraints,
          inspectionContext,
          components,
          bridges,
          workspaceTransform,
          activeComponentId,
          assemblyState,
        } = get();
        if (_history.future.length === 0) return;

        const next = cloneRobotData(_history.future[0]);
        const currentData = cloneRobotData({
          name,
          links,
          joints,
          rootLinkId,
          components,
          bridges,
          workspaceTransform,
          activeComponentId,
          assemblyState,
          materials,
          closedLoopConstraints,
          inspectionContext,
        });

        set((state) => {
          state.name = next.name;
          state.version = next.version;
          state.links = next.links;
          state.joints = next.joints;
          state.rootLinkId = next.rootLinkId;
          state.components = next.components;
          state.bridges = next.bridges;
          state.workspaceTransform = next.workspaceTransform;
          state.activeComponentId = next.activeComponentId;
          state.assemblyState = next.assemblyState;
          state.materials = next.materials;
          state.closedLoopConstraints = next.closedLoopConstraints;
          state.inspectionContext = next.inspectionContext;
          state._history.past = [...state._history.past, currentData].slice(-MAX_HISTORY);
          state._history.future = state._history.future.slice(1, MAX_HISTORY + 1);
          state.assemblyRevision += 1;
        });
      },

      canUndo: () => get()._history.past.length > 0,
      canRedo: () => get()._history.future.length > 0,

      clearHistory: () => {
        set((state) => {
          state._history = { past: [], future: [] };
        });
      },

      pushHistorySnapshot: (snapshot, label) => {
        appendHistorySnapshot(snapshot, label);
      },

      // Computed values
      getJointAngles: () => {
        const angles: Record<string, number> = {};
        Object.values(get().joints).forEach((joint) => {
          if (joint.angle !== undefined) {
            angles[joint.name] = joint.angle;
          }
        });
        return angles;
      },

      getRootLink: () => {
        const state = get();
        return state.links[state.rootLinkId];
      },

      getLinkByName: (name) => {
        return Object.values(get().links).find((l) => l.name === name);
      },

      getJointByName: (name) => {
        return Object.values(get().joints).find((j) => j.name === name);
      },

      getChildJoints: (linkId) => {
        return Object.values(get().joints).filter((j) => j.parentLinkId === linkId);
      },

      getParentJoint: (linkId) => {
        return Object.values(get().joints).find((j) => j.childLinkId === linkId);
      },
    };
  }),
);

// Selector hooks for common patterns
export const useRobotName = () => useRobotStore((state) => state.name);
export const useRobotLinks = () => useRobotStore((state) => state.links);
export const useRobotJoints = () => useRobotStore((state) => state.joints);
export const useRootLinkId = () => useRobotStore((state) => state.rootLinkId);
export const useCanUndo = () => useRobotStore((state) => state._history.past.length > 0);
export const useCanRedo = () => useRobotStore((state) => state._history.future.length > 0);
export const useAssemblyCanUndo = () => useRobotStore((state) => state._history.past.length > 0);
export const useAssemblyCanRedo = () =>
  useRobotStore((state) => state._history.future.length > 0);
