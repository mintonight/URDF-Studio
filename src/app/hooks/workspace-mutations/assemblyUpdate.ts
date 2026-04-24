import type { AssemblyState, RobotData, UrdfJoint, UrdfLink } from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import { resolveJointKey, resolveLinkKey } from '@/core/robot';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './collisionGeometryDiff';
import { renameComponentRobotRoot } from './renameComponentRobotRoot';

interface AssemblyUpdateParams {
  type: 'link' | 'joint';
  id: string;
  data: UrdfLink | UrdfJoint;
  options: UpdateCommitOptions;
  latestAssemblyState: AssemblyState | null;
  commitPendingAssemblyHistory: (key?: string) => void;
  ensurePendingAssemblyHistory: (key: string, label: string) => void;
  schedulePendingAssemblyHistoryCommit: (key: string, debounceMs?: number) => void;
  updateComponentRobot: (
    componentId: string,
    partialRobot: Partial<RobotData>,
    options?: AssemblyStoreUpdateOptions,
  ) => void;
  updateComponentName: (
    componentId: string,
    name: string,
    options?: AssemblyStoreUpdateOptions,
  ) => void;
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
    operations: { kind: 'link' | 'joint'; currentName: string; nextName: string }[];
  }) => void;
}

interface AssemblyStoreUpdateOptions {
  skipHistory?: boolean;
  label?: string;
}

export function applyAssemblyUpdate(params: AssemblyUpdateParams): boolean {
  const { latestAssemblyState } = params;
  if (!latestAssemblyState) {
    return false;
  }

  for (const comp of Object.values(latestAssemblyState.components)) {
    if (params.type === 'link') {
      const resolvedLinkId = resolveLinkKey(comp.robot.links, params.id);
      if (!resolvedLinkId) continue;

      const currentLink = comp.robot.links[resolvedLinkId];
      const nextLink = params.data as UrdfLink;
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
      const historyKey =
        params.options.historyKey ?? `assembly:component:${comp.id}:link:${resolvedLinkId}`;
      const historyLabel = params.options.historyLabel ?? 'Update assembly component';
      const isRootLink = resolvedLinkId === comp.robot.rootLinkId;

      if (isRootLink && currentLink && currentLink.name !== nextLink.name) {
        const requestedRootName = nextLink.name.trim() || currentLink.name;
        if (requestedRootName === currentLink.name) {
          params.ensurePendingAssemblyHistory(historyKey, historyLabel);
          params.updateComponentRobot(
            comp.id,
            {
              links: {
                ...comp.robot.links,
                [resolvedLinkId]: {
                  ...nextLink,
                  name: currentLink.name,
                },
              },
            },
            {
              skipHistory: true,
              label: historyLabel,
            },
          );

          if (params.options.commitMode === 'immediate') {
            params.commitPendingAssemblyHistory(historyKey);
          } else if (params.options.commitMode !== 'manual') {
            params.schedulePendingAssemblyHistoryCommit(historyKey, params.options.debounceMs);
          }
          return true;
        }

        const renamedRoot = renameComponentRobotRoot(comp.robot, requestedRootName);
        if (!renamedRoot) {
          return false;
        }
        params.ensurePendingAssemblyHistory(historyKey, historyLabel);
        params.updateComponentRobot(
          comp.id,
          {
            links: {
              ...renamedRoot.nextLinks,
              [resolvedLinkId]: {
                ...renamedRoot.nextLinks[resolvedLinkId],
                ...nextLink,
                name: renamedRoot.nextRootName,
              },
            },
            joints: renamedRoot.nextJoints,
          },
          {
            skipHistory: true,
            label: historyLabel,
          },
        );
        params.updateComponentName(comp.id, renamedRoot.nextRootName, {
          skipHistory: true,
          label: historyLabel,
        });
        if (renamedRoot.renameOperations.length > 0) {
          params.patchEditableSourceRenameEntities?.({
            sourceFileName: comp.sourceFile,
            operations: renamedRoot.renameOperations,
          });
        }

        if (params.options.commitMode === 'immediate') {
          params.commitPendingAssemblyHistory(historyKey);
        } else if (params.options.commitMode !== 'manual') {
          params.schedulePendingAssemblyHistoryCommit(historyKey, params.options.debounceMs);
        }
        return true;
      }

      params.ensurePendingAssemblyHistory(historyKey, historyLabel);
      params.updateComponentRobot(
        comp.id,
        {
          links: { ...comp.robot.links, [resolvedLinkId]: nextLink },
        },
        {
          skipHistory: true,
          label: historyLabel,
        },
      );

      if (currentLink && currentLink.name !== nextLink.name) {
        params.patchEditableSourceRenameEntities?.({
          sourceFileName: comp.sourceFile,
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
        params.patchEditableSourceAddCollisionBody?.({
          sourceFileName: comp.sourceFile,
          linkName: currentLink.name,
          geometry: addedCollisionPatch.geometry,
        });
      }
      if (currentLink && removedCollisionObjectIndex !== null) {
        params.patchEditableSourceDeleteCollisionBody?.({
          sourceFileName: comp.sourceFile,
          linkName: currentLink.name,
          objectIndex: removedCollisionObjectIndex,
        });
      }
      if (currentLink && updatedCollisionPatch) {
        params.patchEditableSourceUpdateCollisionBody?.({
          sourceFileName: comp.sourceFile,
          linkName: currentLink.name,
          objectIndex: updatedCollisionPatch.objectIndex,
          geometry: updatedCollisionPatch.geometry,
        });
      }

      if (params.options.commitMode === 'immediate') {
        params.commitPendingAssemblyHistory(historyKey);
      } else if (params.options.commitMode !== 'manual') {
        params.schedulePendingAssemblyHistoryCommit(historyKey, params.options.debounceMs);
      }
      return true;
    }

    if (params.type === 'joint') {
      const resolvedJointId = resolveJointKey(comp.robot.joints, params.id);
      if (!resolvedJointId) continue;

      const historyKey =
        params.options.historyKey ?? `assembly:component:${comp.id}:joint:${resolvedJointId}`;
      const historyLabel = params.options.historyLabel ?? 'Update assembly component';

      params.ensurePendingAssemblyHistory(historyKey, historyLabel);
      params.updateComponentRobot(
        comp.id,
        {
          joints: { ...comp.robot.joints, [resolvedJointId]: params.data as UrdfJoint },
        },
        {
          skipHistory: true,
          label: historyLabel,
        },
      );

      const currentJoint = comp.robot.joints[resolvedJointId];
      const nextJoint = params.data as UrdfJoint;
      if (currentJoint && nextJoint.limit) {
        params.patchEditableSourceUpdateJointLimit?.({
          sourceFileName: comp.sourceFile,
          jointName: currentJoint.name,
          jointType: nextJoint.type,
          limit: nextJoint.limit,
        });
      }
      if (currentJoint && currentJoint.name !== (params.data as UrdfJoint).name) {
        params.patchEditableSourceRenameEntities?.({
          sourceFileName: comp.sourceFile,
          operations: [
            {
              kind: 'joint',
              currentName: currentJoint.name,
              nextName: nextJoint.name,
            },
          ],
        });
      }

      if (params.options.commitMode === 'immediate') {
        params.commitPendingAssemblyHistory(historyKey);
      } else if (params.options.commitMode !== 'manual') {
        params.schedulePendingAssemblyHistoryCommit(historyKey, params.options.debounceMs);
      }
      return true;
    }
  }

  return false;
}
