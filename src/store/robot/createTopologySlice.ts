/**
 * Topology slice
 *
 * Owns single-URDF topology operations: full robot-data load/reset, link &
 * joint CRUD, visibility, joint kinematics, MJCF tendon updates, tree
 * operations and the computed getters.
 *
 * Depends on the history slice's `saveToHistory` (injected via params) so it
 * writes to the SAME undo stack as every other slice — it never rebuilds its
 * own history helper.
 */
import type {
  JointQuaternion,
  RobotMjcfTendonVisualizationUpdate,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { DEFAULT_JOINT, DEFAULT_VISUAL_COLOR } from '@/types';
import {
  createAttachedChildLink,
  resolveClosedLoopDrivenJointMotion,
  resolveDefaultChildJointOrigin,
} from '@/core/robot';
import {
  syncRobotMaterialsForLinkUpdate,
  syncRobotVisualColorsFromMaterials,
} from '@/core/robot/materials';
import {
  INITIAL_ROBOT_DATA,
  MAX_ACTIVITY_LOG,
  type ApplyJointKinematicOverridesOptions,
  type RobotData,
  type RobotStoreGet,
  type RobotStoreSet,
  type UpdateOptions,
} from './robotStoreTypes';
import {
  createChangeLogEntry,
  jointMotionSolutionChangesState,
} from './robotStoreInternals';

export interface TopologySlice {
  setName: (name: string) => void;
  setRobot: (data: RobotData, options?: UpdateOptions) => void;
  resetRobot: (data?: RobotData) => void;

  addLink: (link: UrdfLink) => void;
  updateLink: (id: string, updates: Partial<UrdfLink>, options?: UpdateOptions) => void;
  deleteLink: (linkId: string) => void;
  setLinkVisibility: (id: string, visible: boolean) => void;
  setAllLinksVisibility: (visible: boolean) => void;

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

  updateMjcfTendon: (
    tendonName: string,
    updates: RobotMjcfTendonVisualizationUpdate,
    options?: UpdateOptions,
  ) => void;

  addChild: (parentLinkId: string) => { linkId: string; jointId: string };
  deleteSubtree: (linkId: string) => void;

  getJointAngles: () => Record<string, number>;
  getRootLink: () => UrdfLink | undefined;
  getLinkByName: (name: string) => UrdfLink | undefined;
  getJointByName: (name: string) => UrdfJoint | undefined;
  getChildJoints: (linkId: string) => UrdfJoint[];
  getParentJoint: (linkId: string) => UrdfJoint | undefined;
}

export interface CreateTopologySliceDeps {
  saveToHistory: (label: string) => void;
}

export function createTopologySlice(
  set: RobotStoreSet,
  get: RobotStoreGet,
  deps: CreateTopologySliceDeps,
): { slice: TopologySlice } {
  const { saveToHistory } = deps;

  const slice: TopologySlice = {
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

  return { slice };
}
