import { useCallback } from 'react';
import {
  addChildToRobot,
  appendCollisionBody,
  createJoint,
  createLink,
  generateJointId,
  generateLinkId,
  getCollisionGeometryEntries,
  resolveClosedLoopJointOriginCompensationDetailed,
  resolveJointKey,
  resolveLinkKey,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { useAssemblyStore, useRobotStore } from '@/store';
import type { PendingCollisionTransform } from '@/store/collisionTransformStore';
import type {
  AssemblyState,
  AssemblyTransform,
  RobotData,
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
  sidebarTab: string;
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
  setAllLinksVisibility: (visible: boolean) => void;
  setJointAngle: (jointName: string, angle: number) => void;
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

export function useWorkspaceMutations({
  sidebarTab,
  assemblyState,
  robotLinks,
  rootLinkId,
  setName,
  addChild,
  deleteSubtree,
  updateLink,
  updateJoint,
  setAllLinksVisibility,
  setJointAngle,
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

  const {
    commitPendingRobotHistory,
    commitPendingAssemblyHistory,
    ensurePendingRobotHistory,
    ensurePendingAssemblyHistory,
    schedulePendingRobotHistoryCommit,
    schedulePendingAssemblyHistoryCommit,
  } = usePendingHistoryCoordinator({
    sidebarTab,
    createRobotSnapshot,
    createAssemblySnapshot,
  });

  const handleNameChange = useCallback(
    (name: string) => {
      if (assemblyState && sidebarTab === 'workspace') {
        useAssemblyStore.getState().setAssembly({ ...assemblyState, name });
      } else {
        setName(name);
      }
    },
    [assemblyState, setName, sidebarTab],
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
      type: 'link' | 'joint',
      id: string,
      data: UrdfLink | UrdfJoint,
      options: UpdateCommitOptions = {},
    ) => {
      const commitMode = options.commitMode ?? 'debounced';
      const latestAssemblyState =
        sidebarTab === 'workspace' ? useAssemblyStore.getState().assemblyState : null;

      if (latestAssemblyState) {
        const handled = applyAssemblyUpdate({
          type,
          id,
          data,
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

        if (type === 'joint' && latestAssemblyState.bridges[id]) {
          const historyKey = options.historyKey ?? `assembly:bridge:${id}`;
          const historyLabel = options.historyLabel ?? 'Update bridge joint';

          ensurePendingAssemblyHistory(historyKey, historyLabel);
          useAssemblyStore.getState().updateBridge(
            id,
            { joint: data as UrdfJoint },
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
      sidebarTab,
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
    ],
  );

  const handleUpdate = useCallback(
    (type: 'link' | 'joint', id: string, data: UrdfLink | UrdfJoint) => {
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
      const latestAssemblyState =
        sidebarTab === 'workspace' ? useAssemblyStore.getState().assemblyState : null;

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
    [applyUpdate, sidebarTab],
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
      if (!(assemblyState && sidebarTab === 'workspace')) {
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
      sidebarTab,
      updateAssemblyTransform,
    ],
  );

  const handleComponentTransform = useCallback(
    (componentId: string, transform: AssemblyTransform, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState && sidebarTab === 'workspace')) {
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
      sidebarTab,
      updateComponentTransform,
    ],
  );

  const handleBridgeTransform = useCallback(
    (bridgeId: string, origin: UrdfOrigin, options: UpdateCommitOptions = {}) => {
      if (!(assemblyState && sidebarTab === 'workspace')) {
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
      sidebarTab,
    ],
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      if (assemblyState && sidebarTab === 'workspace') {
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
      sidebarTab,
      updateComponentRobot,
    ],
  );

  const handleAddCollisionBody = useCallback(
    (parentId: string) => {
      if (assemblyState && sidebarTab === 'workspace') {
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
      sidebarTab,
      updateComponentRobot,
      updateLink,
    ],
  );

  const handleDelete = useCallback(
    (linkId: string) => {
      if (assemblyState && sidebarTab === 'workspace') {
        for (const component of Object.values(assemblyState.components)) {
          if (!component.robot.links[linkId]) continue;
          const targetLinkName = component.robot.links[linkId]?.name;

          if (linkId === component.robot.rootLinkId) {
            removeComponent(component.id);
            setSelection({ type: null, id: null });
            return;
          }

          const toDeleteLinks = new Set<string>();
          const toDeleteJoints = new Set<string>();
          const collect = (currentLinkId: string) => {
            if (toDeleteLinks.has(currentLinkId)) return;
            toDeleteLinks.add(currentLinkId);

            Object.values(component.robot.joints).forEach((joint) => {
              if (joint.parentLinkId === currentLinkId) {
                toDeleteJoints.add(joint.id);
                collect(joint.childLinkId);
              }
              if (joint.childLinkId === currentLinkId) {
                toDeleteJoints.add(joint.id);
              }
            });
          };
          collect(linkId);

          const nextLinks: Record<string, UrdfLink> = {};
          Object.entries(component.robot.links).forEach(([id, currentLink]) => {
            if (!toDeleteLinks.has(id)) {
              nextLinks[id] = currentLink;
            }
          });

          const nextJoints: Record<string, UrdfJoint> = {};
          Object.entries(component.robot.joints).forEach(([id, joint]) => {
            if (!toDeleteJoints.has(id)) {
              nextJoints[id] = joint;
            }
          });

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
              bridge.parentComponentId === component.id && toDeleteLinks.has(bridge.parentLinkId);
            const isAffectedChild =
              bridge.childComponentId === component.id && toDeleteLinks.has(bridge.childLinkId);
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
      sidebarTab,
      updateComponentRobot,
    ],
  );

  const handleRenameComponent = useCallback(
    (componentId: string, name: string) => {
      if (!(assemblyState && sidebarTab === 'workspace')) return;
      renameComponentRootWithDefaults(componentId, name);
    },
    [assemblyState, renameComponentRootWithDefaults, sidebarTab],
  );

  const handleSetShowVisual = useCallback(
    (target: boolean) => {
      persistWorkspaceViewerShowVisualPreference(target);
      setAllLinksVisibility(target);
    },
    [setAllLinksVisibility],
  );

  const handleJointChange = useCallback(
    (jointName: string, angle: number) => {
      setJointAngle(jointName, angle);
    },
    [setJointAngle],
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
