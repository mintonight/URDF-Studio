/**
 * Assembly slice
 *
 * Owns the component / bridge / component-robot / joint-motion actions plus the
 * `assemblyRevision`, `assemblyJointMotionRevision` and
 * `pendingAutoGroundComponentIds` bookkeeping.
 *
 * CRITICAL: the merged-data cache (`cachedAssemblyState` /
 * `cachedAssemblyJointMotionRevision` / `cachedMergedRobotData`), the
 * `pendingJointMotionByComponentId` map and the `applyAssemblyMutation` helper
 * all live inside THIS single factory closure. They must stay together — the
 * cache, the pending map and every action that reads/writes them share one
 * lexical closure. Splitting them apart would create divergent caches / pending
 * maps and break the hot joint-motion fast path.
 */
import type {
  AssemblyComponent,
  AssemblyState,
  AssemblyTransform,
  BridgeJoint,
  JointQuaternion,
  RobotData as SharedRobotData,
  RobotFile,
  UrdfJoint,
} from '@/types';
import { DEFAULT_JOINT, JointType } from '@/types';
import { resolveRobotFileData } from '@/core/parsers';
import {
  buildAssemblyComponentIdentity,
  buildDefaultAssemblyComponentPlacementTransform,
  mergeAssembly,
  prepareAssemblyRobotData,
  resolveAssemblyComponentBaseName,
} from '@/core/robot';
import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';
import { resolveAlignedAssemblyComponentTransformForBridge } from '@/core/robot/assemblyBridgeAlignment';
import { syncRobotMaterialsForLinkUpdate } from '@/core/robot/materials';
import { failFastInDev } from '@/core/utils/runtimeDiagnostics';
import {
  type AssemblyContext,
  type RobotData,
  type RobotStoreGet,
  type RobotStoreSet,
  type UpdateOptions,
} from './robotStoreTypes';
import {
  appendPendingAutoGroundComponentId,
  assertStructuralBridgeCanBeApplied,
  buildAssemblyBridgeId,
  buildAssemblyComponentImportError,
  cloneAssemblySnapshot,
  createRobotSnapshotFromState,
  isSameOrNestedAssemblySourcePath,
  normalizeAssemblySourcePath,
  removePendingAutoGroundComponentIds,
  replaceAssemblySourcePathPrefix,
  shouldRecomputeBridgeAlignedChildTransform,
  syncWorkspaceFieldsFromAssemblyDraft,
} from './robotStoreInternals';

export interface AssemblySlice {
  assemblyRevision: number;
  assemblyJointMotionRevision: number;
  pendingAutoGroundComponentIds: string[];

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
  updateComponentRobot: (
    id: string,
    robot: Partial<SharedRobotData>,
    options?: UpdateOptions,
  ) => void;
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
}

export interface CreateAssemblySliceDeps {
  appendHistorySnapshot: (snapshot: RobotData | AssemblyState | null, label: string) => void;
}

export function createAssemblySlice(
  set: RobotStoreSet,
  get: RobotStoreGet,
  deps: CreateAssemblySliceDeps,
): { slice: AssemblySlice } {
  const { appendHistorySnapshot } = deps;

  let cachedAssemblyState: AssemblyState | null | undefined;
  let cachedAssemblyJointMotionRevision = -1;
  let cachedMergedRobotData: SharedRobotData | null = null;
  interface PendingJointMotionEntry {
    originalAngles: Map<string, number | undefined>;
    originalQuaternions: Map<string, JointQuaternion | undefined>;
  }
  let pendingJointMotionByComponentId = new Map<string, PendingJointMotionEntry>();

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

  const slice: AssemblySlice = {
    assemblyRevision: 0,
    assemblyJointMotionRevision: 0,
    pendingAutoGroundComponentIds: [],

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
      const resolvedIdentity = identity;

      const component: AssemblyComponent = {
        id: resolvedIdentity.componentId,
        name: resolvedIdentity.displayName,
        sourceFile: file.name,
        robot: namespacedRobot,
        renderableBounds: preparedComponent?.renderableBounds ?? undefined,
        // ponytail: recompute placement against the live assemblyState at commit
        // time. The worker's preparedComponent.suggestedTransform is derived from
        // a stale snapshot of existing components (captured when the add began,
        // before any concurrent in-flight adds commit), so trusting it makes two
        // rapid "加载到工作空间" clicks stack both components at the same offset.
        // buildDefaultAssemblyComponentPlacementTransform is the same function the
        // worker used; calling it here with fresh existingComponents + the
        // worker-resolved renderableBounds gives identical placement for a single
        // add and correct, non-overlapping placement under concurrent adds.
        transform: buildDefaultAssemblyComponentPlacementTransform({
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
        nextDraft.components[resolvedIdentity.componentId] = component;
        return draft ? undefined : nextDraft;
      });

      if (didAddComponent && queueAutoGround) {
        set((storeState) => {
          appendPendingAutoGroundComponentId(
            storeState.pendingAutoGroundComponentIds,
            resolvedIdentity.componentId,
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
  };

  return { slice };
}
