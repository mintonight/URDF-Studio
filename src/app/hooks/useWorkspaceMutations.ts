import { useCallback } from 'react';
import {
  addChildToRobot,
  appendCollisionBody,
  applyDeletionPlan,
  buildDeletionPlan,
  createJoint,
  createLink,
  generateJointId,
  generateLinkId,
  getCollisionGeometryEntries,
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointOriginCompensationDetailed,
  resolveJointKey,
  resolveLinkKey,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { useAssemblyStore, useRobotStore } from '@/store';
import type { PendingCollisionTransform } from '@/store/collisionTransformStore';
import type { ViewerJointChangeContext } from '@/features/urdf-viewer/types';
import type {
  AssemblyState,
  AssemblyTransform,
  JointQuaternion,
  RobotData,
  RobotMjcfInspectionTendonSummary,
  RobotMjcfTendonVisualizationUpdate,
  UrdfJoint,
  UrdfLink,
  UrdfOrigin,
} from '@/types';
import type { UpdateCommitMode, UpdateCommitOptions } from '@/types/viewer';
import { usePendingHistoryCoordinator } from './usePendingHistoryCoordinator';
import { persistWorkspaceViewerShowVisualPreference } from './workspaceViewerDetailPreferences';
import { areAssemblyTransformsEqual } from './workspace-mutations/assemblyTransforms';
import { applyAssemblyUpdate } from './workspace-mutations/assemblyUpdate';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './workspace-mutations/collisionGeometryDiff';
import { renameComponentRobotRoot } from './workspace-mutations/renameComponentRobotRoot';
import type { MJCFRenameOperation } from '../utils/mjcfEditableSourcePatch';

interface UseWorkspaceMutationsParams {
  assemblyState: AssemblyState | null;
  robotLinks: Record<string, UrdfLink>;
  rootLinkId: string;
  setName: (name: string) => void;
  addChild: (parentId: string) => { linkId: string; jointId: string };
  deleteSubtree: (linkId: string) => void;
  updateLink: (
    id: string,
    updates: Partial<UrdfLink>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateJoint: (
    id: string,
    updates: Partial<UrdfJoint>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateMjcfTendon: (
    tendonName: string,
    updates: RobotMjcfTendonVisualizationUpdate,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  setAllLinksVisibility: (visible: boolean) => void;
  setJointAngle: (jointName: string, angle: number) => void;
  applyJointKinematicOverrides: (
    overrides: {
      angles?: Record<string, number>;
      quaternions?: Record<string, JointQuaternion>;
    },
    options?: { skipHistory?: boolean; historyLabel?: string },
  ) => void;
  updateComponentName: (
    componentId: string,
    name: string,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateComponentTransform: (
    componentId: string,
    transform: AssemblyTransform,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateComponentRobot: (
    componentId: string,
    partialRobot: Partial<RobotData>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateAssemblyTransform: (
    transform: AssemblyTransform,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  removeComponent: (id: string) => void;
  removeBridge: (id: string) => void;
  focusOn: (id: string) => void;
  patchEditableSourceAddChild?: (args: {
    sourceFileName?: string | null;
    parentLinkName: string;
    linkName: string;
    joint: UrdfJoint;
  }) => void;
  patchEditableSourceDeleteSubtree?: (args: {
    sourceFileName?: string | null;
    linkName: string;
  }) => void;
  patchEditableSourceAddCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    geometry: UrdfLink['collision'];
  }) => void;
  patchEditableSourceDeleteCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    objectIndex: number;
  }) => void;
  patchEditableSourceUpdateCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    objectIndex: number;
    geometry: UrdfLink['collision'];
  }) => void;
  patchEditableSourceUpdateJointLimit?: (args: {
    sourceFileName?: string | null;
    jointName: string;
    jointType: UrdfJoint['type'];
    limit: NonNullable<UrdfJoint['limit']>;
  }) => void;
  patchEditableSourceRenameEntities?: (args: {
    sourceFileName?: string | null;
    operations: MJCFRenameOperation[];
  }) => void;
  setSelection: (selection: {
    type: 'link' | 'joint' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
  }) => void;
  setPendingCollisionTransform: (transform: PendingCollisionTransform) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
}

interface ResolvedViewerJointChangeContext {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

function resolveViewerJointChangeContext(
  joints: Record<string, UrdfJoint>,
  jointName: string,
  angle: number,
  context?: ViewerJointChangeContext,
): ResolvedViewerJointChangeContext | null {
  if (!context) {
    return null;
  }

  const jointId = resolveJointKey(joints, jointName);
  const angles: Record<string, number> = {};
  const quaternions: Record<string, JointQuaternion> = {};

  Object.entries(context.jointAngles ?? {}).forEach(([jointNameOrId, nextAngle]) => {
    if (!Number.isFinite(nextAngle)) {
      return;
    }

    const resolvedJointId = resolveJointKey(joints, jointNameOrId);
    if (resolvedJointId) {
      angles[resolvedJointId] = nextAngle;
    }
  });

  Object.entries(context.jointQuaternions ?? {}).forEach(([jointNameOrId, quaternion]) => {
    const resolvedJointId = resolveJointKey(joints, jointNameOrId);
    if (resolvedJointId) {
      quaternions[resolvedJointId] = quaternion;
    }
  });

  if (
    jointId &&
    Number.isFinite(angle) &&
    (Object.keys(angles).length > 0 || Object.keys(quaternions).length > 0) &&
    !Object.hasOwn(angles, jointId)
  ) {
    angles[jointId] = angle;
  }

  if (Object.keys(angles).length === 0 && Object.keys(quaternions).length === 0) {
    return null;
  }

  return { angles, quaternions };
}

export function useWorkspaceMutations({
  assemblyState,
  robotLinks,
  rootLinkId,
  setName,
  addChild,
  deleteSubtree,
  updateLink,
  updateJoint,
  updateMjcfTendon,
  setAllLinksVisibility,
  setJointAngle,
  applyJointKinematicOverrides,
  updateComponentName,
  updateComponentTransform,
  updateComponentRobot,
  updateAssemblyTransform,
  removeComponent,
  removeBridge,
  focusOn,
  patchEditableSourceAddChild,
  patchEditableSourceDeleteSubtree,
  patchEditableSourceAddCollisionBody,
  patchEditableSourceDeleteCollisionBody,
  patchEditableSourceUpdateCollisionBody,
  patchEditableSourceUpdateJointLimit,
  patchEditableSourceRenameEntities,
  setSelection,
  setPendingCollisionTransform,
  clearPendingCollisionTransform,
  handleTransformPendingChange,
}: UseWorkspaceMutationsParams) {
  const createRobotSnapshot = useCallback(() => {
    const state = useRobotStore.getState();
    return structuredClone({
      name: state.name,
      links: state.links,
      joints: state.joints,
      rootLinkId: state.rootLinkId,
      materials: state.materials,
      closedLoopConstraints: state.closedLoopConstraints,
    });
  }, []);

  const createAssemblySnapshot = useCallback(() => {
    return structuredClone(useAssemblyStore.getState().assemblyState);
  }, []);
  const historyScopeKey = assemblyState ? 'assembly' : 'robot';

  const {
    commitPendingRobotHistory,
    commitPendingAssemblyHistory,
    ensurePendingRobotHistory,
    ensurePendingAssemblyHistory,
    schedulePendingRobotHistoryCommit,
    schedulePendingAssemblyHistoryCommit,
  } = usePendingHistoryCoordinator({
    scopeKey: historyScopeKey,
    createRobotSnapshot,
    createAssemblySnapshot,
  });

  const handleNameChange = useCallback(
    (name: string) => {
      if (assemblyState) {
        useAssemblyStore.getState().setAssembly({ ...assemblyState, name });
      } else {
        setName(name);
      }
    },
    [assemblyState, setName],
  );

  // Joint commit in multi-component assembly mode used to call
  // updateComponentRobot synchronously, which ran the full immer produce +
  // patch capture path and bumped `assemblyState` reference. That cascade
  // forced AppLayout/App.tsx subscribers to rerender and invalidated the
  // mergeAssembly useMemo in `useWorkspaceSourceSync`, costing a ~180ms
  // React long task on multi-component scenes.
  //
  // We now route joint-motion writes through `setComponentJointMotion` —
  // an explicit fast path on `assemblyStore` that mutates
  // `assemblyState.components[id].robot.joints[*].angle/quaternion` in
  // place. It bumps a dedicated `assemblyJointMotionRevision` field but
  // does NOT change the `assemblyState` object identity, so React
  // subscribers selecting `assemblyState` (via `useShallow`) stay quiet,
  // and the `useMemo([..., visibleAssemblyStateForViewerDisplay])` chain in
  // `useWorkspaceSourceSync` keeps its cached mergeAssembly output. Export
  // / save / AI inspection paths still see the latest angles because they
  // traverse the live `assemblyState` (or `getMergedRobotData()`, whose
  // cache also invalidates on the motion revision).
  const scheduleAssemblyComponentJointSync = useCallback(
    (componentId: string, nextJoints: Record<string, UrdfJoint>) => {
      const angles: Record<string, number> = {};
      const quaternions: Record<string, JointQuaternion> = {};
      for (const [jointId, joint] of Object.entries(nextJoints)) {
        if (typeof joint.angle === 'number' && Number.isFinite(joint.angle)) {
          angles[jointId] = joint.angle;
        }
        if (joint.quaternion) {
          quaternions[jointId] = joint.quaternion;
        }
      }
      useAssemblyStore.getState().setComponentJointMotion(componentId, angles, quaternions);
    },
    [],
  );

  const renameComponentRootWithDefaults = useCallback(
    (
      componentId: string,
      nextRootNameRaw: string,
      options?: { skipHistory?: boolean; label?: string },
    ) => {
      const latestAssembly = useAssemblyStore.getState().assemblyState;
      if (!latestAssembly) return;
      const component = latestAssembly.components[componentId];
      if (!component) return;

      const renamedRoot = renameComponentRobotRoot(component.robot, nextRootNameRaw);
      if (!renamedRoot) return;

      updateComponentRobot(
        componentId,
        { links: renamedRoot.nextLinks, joints: renamedRoot.nextJoints },
        options,
      );
      updateComponentName(componentId, renamedRoot.nextRootName, options);
      if (renamedRoot.renameOperations.length) {
        patchEditableSourceRenameEntities?.({
          sourceFileName: component.sourceFile,
          operations: renamedRoot.renameOperations,
        });
      }
    },
    [patchEditableSourceRenameEntities, updateComponentName, updateComponentRobot],
  );

  const applyUpdate = useCallback(
    (
      type: 'link' | 'joint' | 'tendon',
      id: string,
      data: UrdfLink | UrdfJoint | RobotMjcfInspectionTendonSummary,
      options: UpdateCommitOptions = {},
    ) => {
      const commitMode = options.commitMode ?? 'debounced';
      if (type === 'tendon') {
        const tendonUpdates = data as RobotMjcfInspectionTendonSummary;
        const historyKey = options.historyKey ?? `robot:tendon:${id}`;
        const historyLabel = options.historyLabel ?? 'Update tendon';

        ensurePendingRobotHistory(historyKey, historyLabel);
        updateMjcfTendon(
          id,
          {
            rgba: tendonUpdates.rgba,
            width: tendonUpdates.width,
          },
          {
            skipHistory: true,
            label: historyLabel,
          },
        );

        if (commitMode === 'immediate') {
          commitPendingRobotHistory(historyKey);
        } else if (commitMode !== 'manual') {
          schedulePendingRobotHistoryCommit(historyKey, options.debounceMs);
        }
        return;
      }

      const latestAssemblyState = useAssemblyStore.getState().assemblyState;
      const robotEntityData = data as UrdfLink | UrdfJoint;

      if (latestAssemblyState) {
        const handled = applyAssemblyUpdate({
          type,
          id,
          data: robotEntityData,
          options,
          latestAssemblyState,
          commitPendingAssemblyHistory,
          ensurePendingAssemblyHistory,
          schedulePendingAssemblyHistoryCommit,
          updateComponentRobot,
          updateComponentName,
          patchEditableSourceAddCollisionBody,
          patchEditableSourceDeleteCollisionBody,
          patchEditableSourceUpdateCollisionBody,
          patchEditableSourceUpdateJointLimit,
          patchEditableSourceRenameEntities,
        });
        if (handled) {
          return;
        }

        const bridge =
          type === 'joint'
            ? (latestAssemblyState.bridges[id] ??
              Object.values(latestAssemblyState.bridges).find(
                (candidate) =>
                  candidate.joint.id === id ||
                  candidate.name === id ||
                  candidate.joint.name === id,
              ))
            : null;
        if (type === 'joint' && bridge) {
          const jointPatch = data as Partial<UrdfJoint>;
          const nextJoint: UrdfJoint = {
            ...bridge.joint,
            ...jointPatch,
            limit: jointPatch.limit
              ? {
                  ...bridge.joint.limit,
                  ...jointPatch.limit,
                }
              : bridge.joint.limit,
          };
          const historyKey = options.historyKey ?? `assembly:bridge:${bridge.id}`;
          const historyLabel = options.historyLabel ?? 'Update bridge joint';

          ensurePendingAssemblyHistory(historyKey, historyLabel);
          useAssemblyStore.getState().updateBridge(
            bridge.id,
            { joint: nextJoint },
            {
              skipHistory: true,
              label: historyLabel,
            },
          );

          if (commitMode === 'immediate') {
            commitPendingAssemblyHistory(historyKey);
          } else if (commitMode !== 'manual') {
            schedulePendingAssemblyHistoryCommit(historyKey, options.debounceMs);
          }
          return;
        }
      }

      if (type === 'link') {
        const resolvedLinkId = resolveLinkKey(useRobotStore.getState().links, id);
        if (resolvedLinkId) {
          const currentLink = useRobotStore.getState().links[resolvedLinkId];
          const nextLink = data as UrdfLink;
          const addedCollisionPatch = currentLink
            ? findAddedCollisionGeometryPatch(currentLink, nextLink)
            : null;
          const removedCollisionObjectIndex = currentLink
            ? findRemovedCollisionGeometryObjectIndex(currentLink, nextLink)
            : null;
          const updatedCollisionPatch =
            currentLink && addedCollisionPatch === null && removedCollisionObjectIndex === null
              ? findUpdatedCollisionGeometryPatch(currentLink, nextLink)
              : null;
          const historyKey = options.historyKey ?? `robot:link:${resolvedLinkId}`;
          const historyLabel = options.historyLabel ?? 'Update link';

          ensurePendingRobotHistory(historyKey, historyLabel);
          updateLink(resolvedLinkId, data as Partial<UrdfLink>, {
            skipHistory: true,
            label: historyLabel,
          });
          if (currentLink && currentLink.name !== nextLink.name) {
            patchEditableSourceRenameEntities?.({
              operations: [
                {
                  kind: 'link',
                  currentName: currentLink.name,
                  nextName: nextLink.name,
                },
              ],
            });
          }
          if (currentLink && addedCollisionPatch) {
            patchEditableSourceAddCollisionBody?.({
              linkName: currentLink.name,
              geometry: addedCollisionPatch.geometry,
            });
          }
          if (currentLink && removedCollisionObjectIndex !== null) {
            patchEditableSourceDeleteCollisionBody?.({
              linkName: currentLink.name,
              objectIndex: removedCollisionObjectIndex,
            });
          }
          if (currentLink && updatedCollisionPatch) {
            patchEditableSourceUpdateCollisionBody?.({
              linkName: currentLink.name,
              objectIndex: updatedCollisionPatch.objectIndex,
              geometry: updatedCollisionPatch.geometry,
            });
          }

          if (commitMode === 'immediate') {
            commitPendingRobotHistory(historyKey);
          } else if (commitMode !== 'manual') {
            schedulePendingRobotHistoryCommit(historyKey, options.debounceMs);
          }
        }
      } else {
        const resolvedJointId = resolveJointKey(useRobotStore.getState().joints, id);
        if (resolvedJointId) {
          const historyKey = options.historyKey ?? `robot:joint:${resolvedJointId}`;
          const historyLabel = options.historyLabel ?? 'Update joint';
          const currentRobotState = useRobotStore.getState();
          const currentJoint = currentRobotState.joints[resolvedJointId];
          const jointUpdates = data as Partial<UrdfJoint>;

          ensurePendingRobotHistory(historyKey, historyLabel);
          updateJoint(resolvedJointId, jointUpdates, {
            skipHistory: true,
            label: historyLabel,
          });
          if (currentJoint && jointUpdates.limit) {
            patchEditableSourceUpdateJointLimit?.({
              jointName: currentJoint.name,
              jointType: jointUpdates.type ?? currentJoint.type,
              limit: jointUpdates.limit,
            });
          }
          if (
            currentJoint &&
            typeof jointUpdates.name === 'string' &&
            currentJoint.name !== jointUpdates.name
          ) {
            patchEditableSourceRenameEntities?.({
              operations: [
                {
                  kind: 'joint',
                  currentName: currentJoint.name,
                  nextName: jointUpdates.name,
                },
              ],
            });
          }

          if (currentJoint && jointUpdates.origin) {
            const compensation = resolveClosedLoopJointOriginCompensationDetailed(
              currentRobotState,
              resolvedJointId,
              jointUpdates.origin ?? currentJoint.origin,
            );

            Object.entries(compensation.origins).forEach(([jointId, origin]) => {
              updateJoint(
                jointId,
                { origin },
                {
                  skipHistory: true,
                  label: historyLabel,
                },
              );
            });

            Object.entries(compensation.quaternions).forEach(([jointId, quaternion]) => {
              updateJoint(
                jointId,
                { quaternion },
                {
                  skipHistory: true,
                  label: historyLabel,
                },
              );
            });
          }

          if (commitMode === 'immediate') {
            commitPendingRobotHistory(historyKey);
          } else if (commitMode !== 'manual') {
            schedulePendingRobotHistoryCommit(historyKey, options.debounceMs);
          }
        }
      }
    },
    [
      commitPendingAssemblyHistory,
      commitPendingRobotHistory,
      ensurePendingAssemblyHistory,
      ensurePendingRobotHistory,
      findAddedCollisionGeometryPatch,
      renameComponentRootWithDefaults,
      schedulePendingAssemblyHistoryCommit,
      schedulePendingRobotHistoryCommit,
      findRemovedCollisionGeometryObjectIndex,
      findUpdatedCollisionGeometryPatch,
      patchEditableSourceAddCollisionBody,
      patchEditableSourceDeleteCollisionBody,
      patchEditableSourceUpdateCollisionBody,
      patchEditableSourceUpdateJointLimit,
      patchEditableSourceRenameEntities,
      updateComponentRobot,
      updateJoint,
      updateLink,
      updateMjcfTendon,
    ],
  );

  const handleUpdate = useCallback(
    (
      type: 'link' | 'joint' | 'tendon',
      id: string,
      data: UrdfLink | UrdfJoint | RobotMjcfInspectionTendonSummary,
    ) => {
      applyUpdate(type, id, data, { commitMode: 'debounced' });
    },
    [applyUpdate],
  );

  const applyCollisionTransformUpdate = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      commitMode: UpdateCommitMode,
      objectIndex?: number,
    ) => {
      const latestAssemblyState = useAssemblyStore.getState().assemblyState;

      if (latestAssemblyState) {
        for (const comp of Object.values(latestAssemblyState.components)) {
          const resolvedLinkId = resolveLinkKey(comp.robot.links, linkId);
          if (!resolvedLinkId) continue;

          const link = comp.robot.links[resolvedLinkId];
          if (!link) return;

          const updatedLink = updateCollisionGeometryByObjectIndex(link, objectIndex ?? 0, {
            origin: {
              xyz: position,
              rpy: rotation,
            },
          });

          applyUpdate('link', resolvedLinkId, updatedLink, {
            historyKey: `collision-transform:${comp.id}:${resolvedLinkId}:${objectIndex ?? 0}`,
            historyLabel: 'Transform collision body',
            commitMode,
          });
          return;
        }

        return;
      }

      const latestLinks = useRobotStore.getState().links;
      const resolvedLinkId = resolveLinkKey(latestLinks, linkId);
      if (!resolvedLinkId) return;

      const link = latestLinks[resolvedLinkId];
      if (!link) return;

      const updatedLink = updateCollisionGeometryByObjectIndex(link, objectIndex ?? 0, {
        origin: {
          xyz: position,
          rpy: rotation,
        },
      });

      applyUpdate('link', resolvedLinkId, updatedLink, {
        historyKey: `collision-transform:${resolvedLinkId}:${objectIndex ?? 0}`,
        historyLabel: 'Transform collision body',
        commitMode,
      });
    },
    [applyUpdate],
  );

  const handleCollisionTransformPreview = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      const resolvedLinkId = resolveLinkKey(robotLinks, linkId) ?? linkId;
      setPendingCollisionTransform({
        linkId: resolvedLinkId,
        objectIndex: objectIndex ?? 0,
        position,
        rotation,
      });
    },
    [resolveLinkKey, robotLinks, setPendingCollisionTransform],
  );

  const handleCollisionTransform = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      clearPendingCollisionTransform();
      applyCollisionTransformUpdate(linkId, position, rotation, 'immediate', objectIndex);
    },
    [applyCollisionTransformUpdate, clearPendingCollisionTransform],
  );

  const handleCollisionTransformPendingChange = useCallback(
    (pending: boolean) => {
      handleTransformPendingChange(pending);
      if (!pending) {
        clearPendingCollisionTransform();
      }
    },
    [clearPendingCollisionTransform, handleTransformPendingChange],
  );

  const handleAssemblyTransform = useCallback(
    (transform: AssemblyTransform, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState)) {
        return;
      }

      const nextTransform = cloneAssemblyTransform(transform);
      const latestAssembly = useAssemblyStore.getState().assemblyState;
      if (!latestAssembly || areAssemblyTransformsEqual(latestAssembly.transform, nextTransform)) {
        return;
      }

      const historyKey = options.historyKey ?? 'assembly:transform';
      const historyLabel = options.historyLabel ?? 'Transform assembly';
      const commitMode = options.commitMode ?? 'immediate';

      ensurePendingAssemblyHistory(historyKey, historyLabel);
      updateAssemblyTransform(nextTransform, {
        skipHistory: true,
        label: historyLabel,
      });

      if (commitMode === 'immediate') {
        commitPendingAssemblyHistory(historyKey);
      } else if (commitMode !== 'manual') {
        schedulePendingAssemblyHistoryCommit(historyKey, options.debounceMs);
      }
    },
    [
      areAssemblyTransformsEqual,
      assemblyState,
      commitPendingAssemblyHistory,
      ensurePendingAssemblyHistory,
      schedulePendingAssemblyHistoryCommit,
      updateAssemblyTransform,
    ],
  );

  const handleComponentTransform = useCallback(
    (componentId: string, transform: AssemblyTransform, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState)) {
        return;
      }

      const latestAssembly = useAssemblyStore.getState().assemblyState;
      const latestComponent = latestAssembly?.components[componentId];
      if (!latestComponent) {
        return;
      }

      const nextTransform = cloneAssemblyTransform(transform);
      if (areAssemblyTransformsEqual(latestComponent.transform, nextTransform)) {
        return;
      }

      const historyKey = options.historyKey ?? `assembly:component:${componentId}:transform`;
      const historyLabel = options.historyLabel ?? 'Transform assembly component';
      const commitMode = options.commitMode ?? 'immediate';

      if (options.skipHistory) {
        updateComponentTransform(componentId, nextTransform, {
          skipHistory: true,
          label: historyLabel,
        });
        return;
      }

      ensurePendingAssemblyHistory(historyKey, historyLabel);
      updateComponentTransform(componentId, nextTransform, {
        skipHistory: true,
        label: historyLabel,
      });

      if (commitMode === 'immediate') {
        commitPendingAssemblyHistory(historyKey);
      } else if (commitMode !== 'manual') {
        schedulePendingAssemblyHistoryCommit(historyKey, options.debounceMs);
      }
    },
    [
      areAssemblyTransformsEqual,
      assemblyState,
      commitPendingAssemblyHistory,
      ensurePendingAssemblyHistory,
      schedulePendingAssemblyHistoryCommit,
      updateComponentTransform,
    ],
  );

  const handleBridgeTransform = useCallback(
    (bridgeId: string, origin: UrdfOrigin, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState)) {
        return;
      }

      const latestAssembly = useAssemblyStore.getState().assemblyState;
      const latestBridge = latestAssembly?.bridges[bridgeId];
      if (!latestBridge) {
        return;
      }

      const currentOrigin = latestBridge.joint.origin;
      const sameOrigin =
        currentOrigin.xyz.x === origin.xyz.x &&
        currentOrigin.xyz.y === origin.xyz.y &&
        currentOrigin.xyz.z === origin.xyz.z &&
        currentOrigin.rpy.r === origin.rpy.r &&
        currentOrigin.rpy.p === origin.rpy.p &&
        currentOrigin.rpy.y === origin.rpy.y &&
        (currentOrigin.quatXyzw?.x ?? 0) === (origin.quatXyzw?.x ?? 0) &&
        (currentOrigin.quatXyzw?.y ?? 0) === (origin.quatXyzw?.y ?? 0) &&
        (currentOrigin.quatXyzw?.z ?? 0) === (origin.quatXyzw?.z ?? 0) &&
        (currentOrigin.quatXyzw?.w ?? 1) === (origin.quatXyzw?.w ?? 1);
      if (sameOrigin) {
        return;
      }

      const historyKey = options.historyKey ?? `assembly:bridge:${bridgeId}:transform`;
      const historyLabel = options.historyLabel ?? 'Transform bridge joint';
      const commitMode = options.commitMode ?? 'immediate';

      ensurePendingAssemblyHistory(historyKey, historyLabel);
      useAssemblyStore.getState().updateBridge(
        bridgeId,
        {
          joint: {
            ...latestBridge.joint,
            origin,
          },
        },
        {
          skipHistory: true,
          label: historyLabel,
        },
      );

      if (commitMode === 'immediate') {
        commitPendingAssemblyHistory(historyKey);
      } else if (commitMode !== 'manual') {
        schedulePendingAssemblyHistoryCommit(historyKey, options.debounceMs);
      }
    },
    [
      assemblyState,
      commitPendingAssemblyHistory,
      ensurePendingAssemblyHistory,
      schedulePendingAssemblyHistoryCommit,
    ],
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      if (assemblyState) {
        commitPendingAssemblyHistory();

        for (const component of Object.values(assemblyState.components)) {
          const resolvedParentId = resolveLinkKey(component.robot.links, parentId);
          if (!resolvedParentId) continue;
          const parentLinkName = component.robot.links[resolvedParentId]?.name;

          const nextRobotState = addChildToRobot(
            {
              ...component.robot,
              selection: { type: null, id: null },
            },
            resolvedParentId,
          );
          const jointId = nextRobotState.selection.id;
          const linkId = jointId ? (nextRobotState.joints[jointId]?.childLinkId ?? null) : null;
          const newLink = linkId ? nextRobotState.links[linkId] : null;
          const newJoint = jointId ? nextRobotState.joints[jointId] : null;

          updateComponentRobot(
            component.id,
            {
              links: nextRobotState.links,
              joints: nextRobotState.joints,
            },
            {
              label: 'Add child link',
            },
          );

          if (parentLinkName && newLink && newJoint) {
            patchEditableSourceAddChild?.({
              sourceFileName: component.sourceFile,
              parentLinkName,
              linkName: newLink.name,
              joint: newJoint,
            });
          }

          if (linkId) {
            setSelection({ type: 'link', id: linkId });
            focusOn(linkId);
          } else if (jointId) {
            setSelection({ type: 'joint', id: jointId });
          }
          return;
        }
      }

      commitPendingRobotHistory();
      const parentLinkName = useRobotStore.getState().links[parentId]?.name;
      const { linkId, jointId } = addChild(parentId);
      const nextState = useRobotStore.getState();
      const newLink = nextState.links[linkId];
      const newJoint = nextState.joints[jointId];
      if (parentLinkName && newLink && newJoint) {
        patchEditableSourceAddChild?.({
          parentLinkName,
          linkName: newLink.name,
          joint: newJoint,
        });
      }
      if (linkId) {
        setSelection({ type: 'link', id: linkId });
        focusOn(linkId);
        return;
      }

      setSelection({ type: 'joint', id: jointId });
    },
    [
      addChild,
      assemblyState,
      commitPendingAssemblyHistory,
      commitPendingRobotHistory,
      focusOn,
      patchEditableSourceAddChild,
      setSelection,
      updateComponentRobot,
    ],
  );

  const handleAddCollisionBody = useCallback(
    (parentId: string) => {
      if (assemblyState) {
        commitPendingAssemblyHistory();

        for (const component of Object.values(assemblyState.components)) {
          const resolvedParentId = resolveLinkKey(component.robot.links, parentId);
          if (!resolvedParentId) continue;

          const parentLink = component.robot.links[resolvedParentId];
          if (!parentLink) continue;

          const updatedParentLink = appendCollisionBody(parentLink);
          const nextCollisionEntries = getCollisionGeometryEntries(updatedParentLink);
          const nextObjectIndex = Math.max(0, nextCollisionEntries.length - 1);
          const newCollisionGeometry = nextCollisionEntries[nextObjectIndex]?.geometry ?? null;

          updateComponentRobot(
            component.id,
            {
              links: {
                ...component.robot.links,
                [resolvedParentId]: updatedParentLink,
              },
            },
            {
              label: 'Add collision body',
            },
          );
          if (newCollisionGeometry) {
            patchEditableSourceAddCollisionBody?.({
              sourceFileName: component.sourceFile,
              linkName: parentLink.name,
              geometry: newCollisionGeometry,
            });
          }

          setSelection({
            type: 'link',
            id: resolvedParentId,
            subType: 'collision',
            objectIndex: nextObjectIndex,
          });
          focusOn(resolvedParentId);
          return;
        }
        return;
      }

      const parentLink = robotLinks[parentId];
      if (!parentLink) return;
      const updatedParentLink = appendCollisionBody(parentLink);
      const nextCollisionEntries = getCollisionGeometryEntries(updatedParentLink);
      const nextObjectIndex = Math.max(0, nextCollisionEntries.length - 1);
      const newCollisionGeometry = nextCollisionEntries[nextObjectIndex]?.geometry ?? null;
      updateLink(parentId, updatedParentLink);
      if (newCollisionGeometry) {
        patchEditableSourceAddCollisionBody?.({
          linkName: parentLink.name,
          geometry: newCollisionGeometry,
        });
      }
      setSelection({
        type: 'link',
        id: parentId,
        subType: 'collision',
        objectIndex: nextObjectIndex,
      });
      focusOn(parentId);
    },
    [
      assemblyState,
      commitPendingAssemblyHistory,
      focusOn,
      patchEditableSourceAddCollisionBody,
      robotLinks,
      setSelection,
      updateComponentRobot,
      updateLink,
    ],
  );

  const handleDelete = useCallback(
    (linkId: string) => {
      if (assemblyState) {
        for (const component of Object.values(assemblyState.components)) {
          if (!component.robot.links[linkId]) continue;
          const targetLinkName = component.robot.links[linkId]?.name;

          const plan = buildDeletionPlan(
            linkId,
            component.robot.links,
            component.robot.joints,
            component.robot.rootLinkId,
          );
          if (!plan) {
            removeComponent(component.id);
            setSelection({ type: null, id: null });
            return;
          }

          const { links: nextLinks, joints: nextJoints } = applyDeletionPlan(
            component.robot.links,
            component.robot.joints,
            plan,
          );

          updateComponentRobot(component.id, {
            links: nextLinks,
            joints: nextJoints,
          });

          if (targetLinkName) {
            patchEditableSourceDeleteSubtree?.({
              sourceFileName: component.sourceFile,
              linkName: targetLinkName,
            });
          }

          Object.values(assemblyState.bridges).forEach((bridge) => {
            const isAffectedParent =
              bridge.parentComponentId === component.id && plan.toDeleteLinks.has(bridge.parentLinkId);
            const isAffectedChild =
              bridge.childComponentId === component.id && plan.toDeleteLinks.has(bridge.childLinkId);
            if (isAffectedParent || isAffectedChild) {
              removeBridge(bridge.id);
            }
          });

          setSelection({ type: null, id: null });
          return;
        }
        return;
      }

      if (linkId === rootLinkId) return;
      const targetLinkName = robotLinks[linkId]?.name;
      deleteSubtree(linkId);
      if (targetLinkName) {
        patchEditableSourceDeleteSubtree?.({ linkName: targetLinkName });
      }
      setSelection({ type: null, id: null });
    },
    [
      assemblyState,
      deleteSubtree,
      patchEditableSourceDeleteSubtree,
      removeBridge,
      removeComponent,
      rootLinkId,
      setSelection,
      updateComponentRobot,
    ],
  );

  const handleRenameComponent = useCallback(
    (componentId: string, name: string) => {
      if (!(assemblyState)) return;
      renameComponentRootWithDefaults(componentId, name);
    },
    [assemblyState, renameComponentRootWithDefaults],
  );

  const handleSetShowVisual = useCallback(
    (target: boolean) => {
      persistWorkspaceViewerShowVisualPreference(target);
      setAllLinksVisibility(target);
    },
    [setAllLinksVisibility],
  );

  const handleJointChange = useCallback(
    (jointName: string, angle: number, context?: ViewerJointChangeContext) => {
      const latestAssemblyState = useAssemblyStore.getState().assemblyState;
      if (latestAssemblyState) {
        for (const component of Object.values(latestAssemblyState.components)) {
          const jointId = resolveJointKey(component.robot.joints, jointName);
          if (!jointId) {
            continue;
          }

          const contextMotion = resolveViewerJointChangeContext(
            component.robot.joints,
            jointName,
            angle,
            context,
          );
          if (contextMotion) {
            const nextJoints = { ...component.robot.joints };

            Object.entries(contextMotion.angles).forEach(([resolvedJointId, resolvedAngle]) => {
              const joint = nextJoints[resolvedJointId];
              if (joint) {
                nextJoints[resolvedJointId] = {
                  ...joint,
                  angle: resolvedAngle,
                };
              }
            });

            Object.entries(contextMotion.quaternions).forEach(([resolvedJointId, quaternion]) => {
              const joint = nextJoints[resolvedJointId];
              if (joint) {
                nextJoints[resolvedJointId] = {
                  ...joint,
                  quaternion,
                };
              }
            });

            scheduleAssemblyComponentJointSync(component.id, nextJoints);
            return;
          }

          const solution = resolveClosedLoopDrivenJointMotion(component.robot, jointId, angle);
          const nextJoints = { ...component.robot.joints };

          Object.entries(solution.angles).forEach(([resolvedJointId, resolvedAngle]) => {
            const joint = nextJoints[resolvedJointId];
            if (joint) {
              nextJoints[resolvedJointId] = {
                ...joint,
                angle: resolvedAngle,
              };
            }
          });

          Object.entries(solution.quaternions).forEach(([resolvedJointId, quaternion]) => {
            const joint = nextJoints[resolvedJointId];
            if (joint) {
              nextJoints[resolvedJointId] = {
                ...joint,
                quaternion,
              };
            }
          });

          scheduleAssemblyComponentJointSync(component.id, nextJoints);
          return;
        }
      }

      const contextMotion = resolveViewerJointChangeContext(
        useRobotStore.getState().joints,
        jointName,
        angle,
        context,
      );
      if (contextMotion) {
        applyJointKinematicOverrides(
          {
            angles: contextMotion.angles,
            quaternions: contextMotion.quaternions,
          },
          { skipHistory: true, historyLabel: 'Update joint angle' },
        );
        return;
      }

      setJointAngle(jointName, angle);
    },
    [applyJointKinematicOverrides, scheduleAssemblyComponentJointSync, setJointAngle],
  );

  return {
    handleNameChange,
    handleUpdate,
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleRenameComponent,
    handleSetShowVisual,
    handleJointChange,
  };
}
