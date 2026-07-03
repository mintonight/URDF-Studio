import { useCallback } from 'react';
import {
  addChildToRobot,
  appendCollisionBody,
  applyDeletionPlan,
  buildDeletionPlan,
  getCollisionGeometryEntries,
  normalizeJointLimitOrder,
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointOriginCompensationDetailed,
  resolveJointKey,
  resolveLinkKey,
} from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { useRobotStore } from '@/store';
import type { ViewerJointChangeContext } from '@/features/editor';
import type {
  AssemblyTransform,
  RobotMjcfInspectionTendonSummary,
  UrdfJoint,
  UrdfLink,
  UrdfOrigin,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import { usePendingHistoryCoordinator } from './usePendingHistoryCoordinator';
import type { UseWorkspaceMutationsParams } from './useWorkspaceMutationsTypes';
import { persistWorkspaceViewerShowVisualPreference } from './workspaceViewerDetailPreferences';
import { areAssemblyTransformsEqual } from './workspace-mutations/assemblyTransforms';
import { applyAssemblyUpdate } from './workspace-mutations/assemblyUpdate';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './workspace-mutations/collisionGeometryDiff';
import {
  applyJointMotionToJoints,
  resolveViewerJointChangeContext,
  syncAssemblyComponentJointMotion,
} from './workspace-mutations/jointMotion';
import { renameComponentRobotRoot } from './workspace-mutations/renameComponentRobotRoot';
import { useCollisionTransformHandlers } from './workspace-mutations/useCollisionTransformHandlers';

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
  patchEditableSourceRobotName,
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
    return structuredClone(useRobotStore.getState().assemblyState ?? null);
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
        useRobotStore.getState().setAssembly({ ...assemblyState, name });
      } else {
        setName(name);
        patchEditableSourceRobotName?.({ name });
      }
    },
    [assemblyState, patchEditableSourceRobotName, setName],
  );

  const scheduleAssemblyComponentJointSync = useCallback(
    syncAssemblyComponentJointMotion,
    [],
  );

  const renameComponentRootWithDefaults = useCallback(
    (
      componentId: string,
      nextRootNameRaw: string,
      options?: { skipHistory?: boolean; label?: string },
    ) => {
      const latestAssembly = useRobotStore.getState().assemblyState;
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

      const latestAssemblyState = useRobotStore.getState().assemblyState;
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
          const mergedLimit = jointPatch.limit
            ? normalizeJointLimitOrder({
                ...(bridge.joint.limit ?? jointPatch.limit),
                ...jointPatch.limit,
              })
            : bridge.joint.limit;
          const nextJoint: UrdfJoint = {
            ...bridge.joint,
            ...jointPatch,
            limit: mergedLimit,
          };
          const historyKey = options.historyKey ?? `assembly:bridge:${bridge.id}`;
          const historyLabel = options.historyLabel ?? 'Update bridge joint';

          ensurePendingAssemblyHistory(historyKey, historyLabel);
          useRobotStore.getState().updateBridge(
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
          const rawJointUpdates = data as Partial<UrdfJoint>;
          const jointUpdates =
            currentJoint && rawJointUpdates.limit
              ? {
                  ...rawJointUpdates,
                  limit: normalizeJointLimitOrder({
                    ...(currentJoint.limit ?? rawJointUpdates.limit),
                    ...rawJointUpdates.limit,
                  }),
                }
              : rawJointUpdates;

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
      data: unknown,
    ) => {
      applyUpdate(type, id, data as UrdfLink | UrdfJoint | RobotMjcfInspectionTendonSummary, {
        commitMode: 'debounced',
      });
    },
    [applyUpdate],
  );

  const {
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
  } = useCollisionTransformHandlers({
    robotLinks,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange,
    applyUpdate,
  });

  const handleAssemblyTransform = useCallback(
    (transform: AssemblyTransform, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState)) {
        return;
      }

      const nextTransform = cloneAssemblyTransform(transform);
      const latestAssembly = useRobotStore.getState().assemblyState;
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

      const latestAssembly = useRobotStore.getState().assemblyState;
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

      const latestAssembly = useRobotStore.getState().assemblyState;
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
      useRobotStore.getState().updateBridge(
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
      const latestAssemblyState = useRobotStore.getState().assemblyState;
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
            scheduleAssemblyComponentJointSync(
              component.id,
              applyJointMotionToJoints(component.robot.joints, contextMotion),
            );
            return;
          }

          const solution = resolveClosedLoopDrivenJointMotion(component.robot, jointId, angle);
          scheduleAssemblyComponentJointSync(
            component.id,
            applyJointMotionToJoints(component.robot.joints, solution),
          );
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
