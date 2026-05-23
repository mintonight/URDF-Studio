/**
 * Assembly Store - Manages multi-URDF assembly state
 * Components + Bridges, with merge for rendering/export
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  setAutoFreeze,
  type Patch,
} from 'immer';
import type {
  AssemblyState,
  AssemblyComponent,
  AssemblyTransform,
  BridgeJoint,
  JointQuaternion,
  RenderableBounds,
  RobotClosedLoopConstraint,
  RobotData,
  RobotFile,
  UrdfLink,
  UrdfJoint,
} from '@/types';
import { DEFAULT_JOINT, JointType } from '@/types';
import { describeRobotImportFailure, resolveRobotFileData } from '@/core/parsers';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { syncRobotMaterialsForLinkUpdate } from '@/core/robot/materials';
import { mergeAssembly } from '@/core/robot/assemblyMerger';
import {
  buildAssemblyComponentIdentity,
  prepareAssemblyRobotData,
} from '@/core/robot/assemblyComponentPreparation';
import { buildDefaultAssemblyComponentPlacementTransform } from '@/core/robot/assemblyPlacement';
import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';
import {
  resolveAlignedAssemblyComponentTransformForBridge,
  resolveAssemblyComponentLinkId,
} from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import { failFastInDev } from '@/core/utils/runtimeDiagnostics';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';

interface AssemblyContext {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
  preResolvedImportResult?: RobotImportResult | null;
  preResolvedRobotData?: RobotData | null;
  queueAutoGround?: boolean;
  preparedComponent?: {
    componentId: string;
    displayName: string;
    robotData: RobotData;
    renderableBounds?: RenderableBounds | null;
    suggestedTransform?: AssemblyTransform | null;
  } | null;
}

interface UpdateOptions {
  skipHistory?: boolean;
  label?: string;
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

enablePatches();
// Disable immer's auto-freeze so the joint-motion fast path
// (`setComponentJointMotion`) can in-place mutate
// `assemblyState.components[id].robot.joints[*].angle/quaternion` without
// triggering a full immer produce cycle and the resulting React subscriber
// cascade on multi-component drag commit. Auto-freeze is a development-mode
// safety net (mutations outside an immer recipe would throw); we trade it
// for the perf win on the hot drag-commit path. All canonical mutations
// still go through `produceWithPatches` for history correctness.
setAutoFreeze(false);

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

function buildAssemblyComponentImportError(
  file: RobotFile,
  importResult: Exclude<RobotImportResult, { status: 'ready' }>,
): Error {
  const detail = describeRobotImportFailure(importResult);
  return new Error(`Failed to add assembly component from "${file.name}". ${detail}`);
}

interface AssemblyActions {
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
  updateComponentRobot: (id: string, robot: Partial<RobotData>, options?: UpdateOptions) => void;
  /**
   * Joint-motion fast path: in-place mutates the existing
   * `assemblyState.components[componentId].robot.joints[*].angle/quaternion`
   * WITHOUT swapping the `assemblyState` reference. This is intentionally
   * non-zustand-canonical: it bypasses immer and the React subscriber
   * notification for `assemblyState` so commit-time joint-angle writes from
   * direct-drag IK don't cascade into a sidebar rerender + `mergeAssembly`
   * full rebuild (~180ms long task on multi-component scenes). Bumps the
   * dedicated `assemblyJointMotionRevision` counter for the few consumers
   * that need to observe motion changes (currently: assemblyStore merger
   * cache). Subscribers selecting `assemblyState` (via `useShallow`) will
   * NOT fire because the reference is unchanged.
   *
   * Call `flushPendingAssemblyJointMotion(label?)` BEFORE any code path
   * that depends on either (a) `assemblyState` reference changing
   * (history/undo/redo), (b) recording immer patches for the angle change.
   * The current `getMergedRobotData()` cache, viewer paths, and export
   * paths all read joint angles by structural traversal of the live
   * `assemblyState` object, so the in-place mutation is visible to them
   * without an explicit flush.
   */
  setComponentJointMotion: (
    componentId: string,
    angles: Record<string, number>,
    quaternions: Record<string, JointQuaternion>,
  ) => void;
  /**
   * Convert any pending in-place joint motion writes from
   * `setComponentJointMotion` into a real immer mutation so that
   * `assemblyState` gets a new reference (and React subscribers see the
   * change) and history/undo can record patches. No-op if there's no
   * pending motion.
   */
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

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  pushHistorySnapshot: (snapshot: AssemblySnapshot, label: string) => void;

  getMergedRobotData: () => RobotData | null;
}

type AssemblySnapshot = AssemblyState | null;

type AssemblyHistoryPatchEntry = {
  kind: 'patch';
  redoPatches: Patch[];
  undoPatches: Patch[];
};

type AssemblyHistorySnapshotEntry = {
  kind: 'snapshot';
  snapshot: AssemblySnapshot;
};

type AssemblyHistoryEntry =
  | AssemblySnapshot
  | AssemblyHistoryPatchEntry
  | AssemblyHistorySnapshotEntry;

type AssemblyMutationRecipe = (draft: AssemblyState | null) => AssemblyState | null | void;

interface AssemblyHistoryState {
  past: AssemblyHistoryEntry[];
  future: AssemblyHistoryEntry[];
}

interface ChangeLogEntry {
  id: string;
  timestamp: string;
  label: string;
}

const MAX_HISTORY = 50;
const MAX_ACTIVITY_LOG = 200;

const cloneAssemblySnapshot = (snapshot: AssemblySnapshot): AssemblySnapshot =>
  snapshot ? structuredClone(snapshot) : null;
const createChangeLogEntry = (label: string): ChangeLogEntry => ({
  id: `assembly_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  label,
});

const buildAssemblyBridgeId = (): string =>
  `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function createAssemblyHistorySnapshotEntry(
  snapshot: AssemblySnapshot,
): AssemblyHistorySnapshotEntry {
  return {
    kind: 'snapshot',
    snapshot: cloneAssemblySnapshot(snapshot),
  };
}

function createAssemblyHistoryPatchEntry(
  redoPatches: Patch[],
  undoPatches: Patch[],
): AssemblyHistoryPatchEntry {
  return {
    kind: 'patch',
    redoPatches: structuredClone(redoPatches),
    undoPatches: structuredClone(undoPatches),
  };
}

function isAssemblyHistoryPatchEntry(
  entry: AssemblyHistoryEntry,
): entry is AssemblyHistoryPatchEntry {
  return Boolean(entry && typeof entry === 'object' && 'kind' in entry && entry.kind === 'patch');
}

function isAssemblyHistorySnapshotEntry(
  entry: AssemblyHistoryEntry,
): entry is AssemblyHistorySnapshotEntry {
  return Boolean(
    entry && typeof entry === 'object' && 'kind' in entry && entry.kind === 'snapshot',
  );
}

function cloneAssemblyHistoryEntry(entry: AssemblyHistoryEntry): AssemblyHistoryEntry {
  if (isAssemblyHistoryPatchEntry(entry)) {
    return createAssemblyHistoryPatchEntry(entry.redoPatches, entry.undoPatches);
  }

  if (isAssemblyHistorySnapshotEntry(entry)) {
    return createAssemblyHistorySnapshotEntry(entry.snapshot);
  }

  return cloneAssemblySnapshot(entry);
}

function applyAssemblyHistoryEntry(
  currentState: AssemblySnapshot,
  entry: AssemblyHistoryEntry,
  direction: 'undo' | 'redo',
): AssemblySnapshot {
  if (isAssemblyHistoryPatchEntry(entry)) {
    return applyPatches(
      currentState,
      direction === 'undo' ? entry.undoPatches : entry.redoPatches,
    ) as AssemblySnapshot;
  }

  if (isAssemblyHistorySnapshotEntry(entry)) {
    return cloneAssemblySnapshot(entry.snapshot);
  }

  return cloneAssemblySnapshot(entry);
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

export const useAssemblyStore = create<
  {
    assemblyState: AssemblyState | null;
    assemblyRevision: number;
    /**
     * Revision counter bumped when {@link AssemblyActions.setComponentJointMotion}
     * writes joint angle/quaternion in-place onto `assemblyState`. Stays
     * decoupled from `assemblyRevision` so the hot drag-commit path doesn't
     * cascade into source-code regeneration / viewer reload triggers that key
     * off the canonical revision. Bumped via zustand `set` so that consumers
     * which intentionally want motion-aware updates can subscribe to this
     * field — subscribers that only select `assemblyState` will not fire
     * because the reference is unchanged.
     */
    assemblyJointMotionRevision: number;
    pendingAutoGroundComponentIds: string[];
    _history: AssemblyHistoryState;
    _activity: ChangeLogEntry[];
  } & AssemblyActions
>()(
  immer((set, get) => {
    let cachedAssemblyState: AssemblyState | null | undefined;
    let cachedAssemblyJointMotionRevision = -1;
    let cachedMergedRobotData: RobotData | null = null;
    // Tracks pending in-place joint-motion writes per component so that
    // `flushPendingAssemblyJointMotion` can construct a real immer patch:
    // we remember the ORIGINAL angle/quaternion (before in-place mutation)
    // so produceWithPatches can see a meaningful diff. Without this, the
    // immer recipe would draft FROM the already-mutated live state and emit
    // no patches at all.
    interface PendingJointMotionEntry {
      originalAngles: Map<string, number | undefined>;
      originalQuaternions: Map<string, JointQuaternion | undefined>;
    }
    let pendingJointMotionByComponentId = new Map<string, PendingJointMotionEntry>();
    const appendHistoryEntry = (entry: AssemblyHistoryEntry, label: string) => {
      set((state) => {
        state._history.past = [...state._history.past, cloneAssemblyHistoryEntry(entry)].slice(
          -MAX_HISTORY,
        );
        state._history.future = [];
        state._activity = [...state._activity, createChangeLogEntry(label)].slice(
          -MAX_ACTIVITY_LOG,
        );
      });
    };
    const appendHistorySnapshot = (snapshot: AssemblySnapshot, label: string) => {
      appendHistoryEntry(createAssemblyHistorySnapshotEntry(snapshot), label);
    };

    const applyAssemblyMutation = (
      label: string,
      recipe: AssemblyMutationRecipe,
      options?: { skipHistory?: boolean },
    ): boolean => {
      const currentAssemblyState = get().assemblyState;
      const [nextAssemblyState, redoPatches, undoPatches] = produceWithPatches(
        currentAssemblyState,
        recipe,
      );

      if (redoPatches.length === 0) {
        return false;
      }

      const historyEntry = createAssemblyHistoryPatchEntry(redoPatches, undoPatches);
      set((state) => {
        state.assemblyState = nextAssemblyState;
        if (!options?.skipHistory) {
          state._history.past = [...state._history.past, historyEntry].slice(-MAX_HISTORY);
          state._history.future = [];
          state._activity = [...state._activity, createChangeLogEntry(label)].slice(
            -MAX_ACTIVITY_LOG,
          );
        }
        state.assemblyRevision += 1;
      });
      return true;
    };

    return {
      assemblyState: null,
      assemblyRevision: 0,
      assemblyJointMotionRevision: 0,
      pendingAutoGroundComponentIds: [],
      _history: { past: [], future: [] },
      _activity: [],

      setAssembly: (state) => {
        applyAssemblyMutation('Load assembly state', () => cloneAssemblySnapshot(state));
        set((storeState) => {
          storeState.pendingAutoGroundComponentIds = [];
        });
      },

      initAssembly: (name = 'assembly') => {
        applyAssemblyMutation('Initialize assembly', () => ({
          name,
          transform: cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM),
          components: {},
          bridges: {},
        }));
        set((storeState) => {
          storeState.pendingAutoGroundComponentIds = [];
        });
      },

      exitAssembly: () => {
        applyAssemblyMutation('Exit assembly', () => null);
        set((storeState) => {
          storeState.pendingAutoGroundComponentIds = [];
        });
      },

      consumePendingAutoGroundComponentIds: (componentIds) => {
        set((storeState) => {
          removePendingAutoGroundComponentIds(
            storeState.pendingAutoGroundComponentIds,
            componentIds,
          );
        });
      },

      clearPendingAutoGroundComponentIds: () => {
        set((storeState) => {
          storeState.pendingAutoGroundComponentIds = [];
        });
      },

      addComponent: (file, context = {}) => {
        const state = get().assemblyState;
        const preparedComponent = context.preparedComponent;
        const queueAutoGround = context.queueAutoGround ?? true;
        const existingComponentIds = state ? Object.keys(state.components) : [];
        const existingComponentNames = state
          ? Object.values(state.components).map((component) => component.name)
          : [];
        const canUsePreparedComponent =
          Boolean(preparedComponent) &&
          !existingComponentIds.includes(preparedComponent.componentId) &&
          !existingComponentNames.includes(preparedComponent.displayName);
        const identity =
          canUsePreparedComponent && preparedComponent
            ? {
                componentId: preparedComponent.componentId,
                displayName: preparedComponent.displayName,
              }
            : buildAssemblyComponentIdentity({
                fileName: file.name,
                existingComponentIds,
                existingComponentNames,
              });

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
            failFastInDev('AssemblyStore:addComponent', importError);
            throw importError;
          }

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
                existingComponents: Object.values(state?.components ?? {}),
              }),
          visible: true,
        };

        const didAddComponent = applyAssemblyMutation('Add assembly component', (draft) => {
          const nextDraft = draft ?? {
            name: 'assembly',
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
        applyAssemblyMutation('Remove assembly component', (draft) => {
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
        set((storeState) => {
          removePendingAutoGroundComponentIds(storeState.pendingAutoGroundComponentIds, [id]);
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
          options?.label ?? 'Rename assembly component sources',
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
          options?.label ?? 'Rename assembly component',
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
          options?.label ?? 'Transform assembly component',
          (draft) => {
            const component = draft?.components[id];
            if (component) {
              component.transform = cloneAssemblyTransform(transform);
            }
          },
          { skipHistory: options?.skipHistory },
        );
        set((storeState) => {
          removePendingAutoGroundComponentIds(storeState.pendingAutoGroundComponentIds, [id]);
        });
      },

      updateComponentRobot: (id, robotUpdates, options) => {
        applyAssemblyMutation(
          options?.label ?? 'Update assembly component',
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
          if (!joint || !Number.isFinite(angle)) {
            continue;
          }
          if (joint.angle === angle) {
            continue;
          }
          if (!pending.originalAngles.has(jointId)) {
            pending.originalAngles.set(jointId, joint.angle);
          }
          // Intentional in-place mutation: we want zustand subscribers reading
          // `assemblyState` to NOT be notified, while the next `getMergedRobotData()`
          // call still sees the new angle through structural traversal.
          (joint as { angle?: number }).angle = angle;
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
          (joint as { quaternion?: JointQuaternion }).quaternion = {
            x: quaternion.x,
            y: quaternion.y,
            z: quaternion.z,
            w: quaternion.w,
          };
          mutated = true;
        }

        if (!mutated) {
          return;
        }

        pendingJointMotionByComponentId.set(id, pending);

        // Bumping the dedicated motion revision via `set` triggers consumers
        // that intentionally subscribed to motion changes (currently none in
        // React-land). Critically, this does NOT change `assemblyState`'s
        // reference, so the `useShallow((s) => ({ assemblyState }))`-style
        // subscribers across AppLayout / App.tsx remain quiet — that's the
        // entire point of this fast path.
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

        const liveState = get().assemblyState;
        if (!liveState) {
          return false;
        }

        // We can't naively run produceWithPatches against the already-mutated
        // live state — immer would draft from the latest values and emit no
        // patches. We capture the LATEST values now, temporarily revert the
        // in-place mutations on the live state, then let immer's recipe
        // re-apply the latest values via the draft. produceWithPatches now
        // sees a real diff and emits patches suitable for history/undo.
        type LatestJointMotion = {
          angles: Map<string, number | undefined>;
          quaternions: Map<string, JointQuaternion | undefined>;
        };
        const latestByComponent = new Map<string, LatestJointMotion>();

        for (const [componentId, entry] of pendingByComponent.entries()) {
          const component = liveState.components[componentId];
          if (!component) continue;
          const latest: LatestJointMotion = {
            angles: new Map(),
            quaternions: new Map(),
          };
          // Snapshot latest values + revert to originals.
          for (const [jointId, originalAngle] of entry.originalAngles.entries()) {
            const joint = component.robot.joints[jointId];
            if (!joint) continue;
            latest.angles.set(jointId, joint.angle);
            if (originalAngle === undefined) {
              delete (joint as { angle?: number }).angle;
            } else {
              (joint as { angle?: number }).angle = originalAngle;
            }
          }
          for (const [jointId, originalQuaternion] of entry.originalQuaternions.entries()) {
            const joint = component.robot.joints[jointId];
            if (!joint) continue;
            latest.quaternions.set(jointId, joint.quaternion);
            if (originalQuaternion === undefined) {
              delete (joint as { quaternion?: JointQuaternion }).quaternion;
            } else {
              (joint as { quaternion?: JointQuaternion }).quaternion = {
                x: originalQuaternion.x,
                y: originalQuaternion.y,
                z: originalQuaternion.z,
                w: originalQuaternion.w,
              };
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
                  delete (draftJoint as { angle?: number }).angle;
                } else {
                  draftJoint.angle = nextAngle;
                }
              }
              for (const [jointId, nextQuaternion] of latest.quaternions.entries()) {
                const draftJoint = draftComponent.robot.joints[jointId];
                if (!draftJoint) continue;
                if (nextQuaternion === undefined) {
                  delete (draftJoint as { quaternion?: JointQuaternion }).quaternion;
                } else {
                  draftJoint.quaternion = {
                    x: nextQuaternion.x,
                    y: nextQuaternion.y,
                    z: nextQuaternion.z,
                    w: nextQuaternion.w,
                  };
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
          options?.label ?? 'Transform assembly',
          (draft) => {
            if (!draft) {
              return;
            }

            draft.transform = cloneAssemblyTransform(transform);
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
            name: 'assembly',
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
        set((storeState) => {
          removePendingAutoGroundComponentIds(storeState.pendingAutoGroundComponentIds, [
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
            if (bridge) {
              const shouldRealignChild = shouldRecomputeBridgeAlignedChildTransform(
                bridge,
                updates,
              );
              const nextBridge: BridgeJoint = {
                ...bridge,
                ...updates,
                name: updates.name ?? updates.joint?.name ?? bridge.name,
                parentLinkId:
                  updates.joint?.parentLinkId ?? updates.parentLinkId ?? bridge.parentLinkId,
                childLinkId:
                  updates.joint?.childLinkId ?? updates.childLinkId ?? bridge.childLinkId,
                joint: {
                  ...bridge.joint,
                  ...(updates.joint ?? {}),
                  name: updates.name ?? updates.joint?.name ?? bridge.joint.name,
                  parentLinkId:
                    updates.joint?.parentLinkId ??
                    updates.parentLinkId ??
                    bridge.joint.parentLinkId,
                  childLinkId:
                    updates.joint?.childLinkId ?? updates.childLinkId ?? bridge.joint.childLinkId,
                },
              };

              assertStructuralBridgeCanBeApplied(draft, nextBridge, {
                ignoreBridgeId: bridge.id,
              });

              Object.assign(bridge, nextBridge);

              if (shouldRealignChild) {
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
            }
          },
          { skipHistory: options?.skipHistory },
        );
        if (shouldRealignChild && nextChildComponentId) {
          set((storeState) => {
            removePendingAutoGroundComponentIds(storeState.pendingAutoGroundComponentIds, [
              nextChildComponentId,
            ]);
          });
        }
      },

      undo: () => {
        const { _history, assemblyState } = get();
        if (_history.past.length === 0) return;

        const previousEntry = _history.past[_history.past.length - 1];
        const previous = applyAssemblyHistoryEntry(assemblyState, previousEntry, 'undo');
        const futureEntry = isAssemblyHistoryPatchEntry(previousEntry)
          ? cloneAssemblyHistoryEntry(previousEntry)
          : createAssemblyHistorySnapshotEntry(assemblyState);

        set((state) => {
          state.assemblyState = previous;
          state._history.past = state._history.past.slice(-(MAX_HISTORY + 1), -1);
          state._history.future = [futureEntry, ...state._history.future].slice(0, MAX_HISTORY);
          state.assemblyRevision += 1;
        });
      },

      redo: () => {
        const { _history, assemblyState } = get();
        if (_history.future.length === 0) return;

        const nextEntry = _history.future[0];
        const next = applyAssemblyHistoryEntry(assemblyState, nextEntry, 'redo');
        const pastEntry = isAssemblyHistoryPatchEntry(nextEntry)
          ? cloneAssemblyHistoryEntry(nextEntry)
          : createAssemblyHistorySnapshotEntry(assemblyState);

        set((state) => {
          state.assemblyState = next;
          state._history.past = [...state._history.past, pastEntry].slice(-MAX_HISTORY);
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

      getMergedRobotData: () => {
        const { assemblyState, assemblyJointMotionRevision } = get();
        // Cache hit requires BOTH the canonical assemblyState reference AND
        // the joint-motion revision to match. In-place joint-motion writes
        // bump the revision (without changing the reference), which forces a
        // recompute — necessary because the cached `RobotData` carries
        // structural joint copies whose `angle/quaternion` we DO mutate in
        // place via `setComponentJointMotion`. (Whether the cached merge sees
        // the new angle depends on whether `mergeAssembly` copies joints by
        // reference; today it does for non-bridge joints, but caching only by
        // reference would silently lie about angles on export.)
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

        // Filter visible components
        const visibleComponents: Record<string, AssemblyComponent> = {};
        const visibleCompIds = new Set<string>();
        Object.entries(assemblyState.components).forEach(([id, comp]) => {
          if (comp.visible !== false) {
            visibleComponents[id] = comp;
            visibleCompIds.add(id);
          }
        });

        if (Object.keys(visibleComponents).length === 0) {
          cachedAssemblyState = assemblyState;
          cachedAssemblyJointMotionRevision = assemblyJointMotionRevision;
          cachedMergedRobotData = null;
          return null;
        }

        // Filter bridges that connect visible components
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
    };
  }),
);

export const useAssemblyCanUndo = () => useAssemblyStore((state) => state._history.past.length > 0);
export const useAssemblyCanRedo = () =>
  useAssemblyStore((state) => state._history.future.length > 0);
