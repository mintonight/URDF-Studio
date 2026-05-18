/**
 * Robot Store - Manages robot data and operations
 * Uses immer for immutable updates and includes history middleware for undo/redo
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  JointQuaternion,
  RobotClosedLoopConstraint,
  RobotInspectionContext,
  RobotMjcfTendonVisualizationUpdate,
  RobotMaterialState,
  UrdfLink,
  UrdfJoint,
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
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
  inspectionContext?: RobotInspectionContext;
}

// History state for undo/redo
interface HistoryState {
  past: RobotData[];
  future: RobotData[];
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

interface RobotActions {
  // Robot name
  setName: (name: string) => void;

  // Full robot data operations
  setRobot: (data: RobotData, options?: UpdateOptions) => void;
  resetRobot: (data?: RobotData) => void;

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
  pushHistorySnapshot: (snapshot: RobotData, label: string) => void;

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
};

// Maximum history entries
const MAX_HISTORY = 50;
const MAX_ACTIVITY_LOG = 200;
const JOINT_MOTION_EPSILON = 1e-9;

const cloneRobotData = (data: RobotData): RobotData => structuredClone(data);
const createChangeLogEntry = (label: string): ChangeLogEntry => ({
  id: `robot_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  label,
});

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
      _history: HistoryState;
      _activity: ChangeLogEntry[];
    }
>()(
  immer((set, get) => {
    const appendHistorySnapshot = (snapshot: RobotData, label: string) => {
      set((state) => {
        state._history.past = [...state._history.past, cloneRobotData(snapshot)].slice(
          -MAX_HISTORY,
        );
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
        links,
        joints,
        rootLinkId,
        materials,
        closedLoopConstraints,
        inspectionContext,
      } = get();
      appendHistorySnapshot(
        { name, links, joints, rootLinkId, materials, closedLoopConstraints, inspectionContext },
        label,
      );
    };

    return {
      // Initial state
      ...INITIAL_ROBOT_DATA,
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
          state.links = normalizedData.links;
          state.joints = normalizedData.joints;
          state.rootLinkId = normalizedData.rootLinkId;
          state.materials = normalizedData.materials;
          state.closedLoopConstraints = normalizedData.closedLoopConstraints;
          state.inspectionContext = normalizedData.inspectionContext;
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
          state.links = newData.links;
          state.joints = newData.joints;
          state.rootLinkId = newData.rootLinkId;
          state.materials = newData.materials;
          state.closedLoopConstraints = newData.closedLoopConstraints;
          state.inspectionContext = newData.inspectionContext;
          state._history = { past: [], future: [] };
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
        } = get();
        if (_history.past.length === 0) return;

        const previous = cloneRobotData(_history.past[_history.past.length - 1]);
        const currentData = cloneRobotData({
          name,
          links,
          joints,
          rootLinkId,
          materials,
          closedLoopConstraints,
          inspectionContext,
        });

        set((state) => {
          state.name = previous.name;
          state.links = previous.links;
          state.joints = previous.joints;
          state.rootLinkId = previous.rootLinkId;
          state.materials = previous.materials;
          state.closedLoopConstraints = previous.closedLoopConstraints;
          state.inspectionContext = previous.inspectionContext;
          state._history.past = state._history.past.slice(-(MAX_HISTORY + 1), -1);
          state._history.future = [currentData, ...state._history.future].slice(0, MAX_HISTORY);
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
        } = get();
        if (_history.future.length === 0) return;

        const next = cloneRobotData(_history.future[0]);
        const currentData = cloneRobotData({
          name,
          links,
          joints,
          rootLinkId,
          materials,
          closedLoopConstraints,
          inspectionContext,
        });

        set((state) => {
          state.name = next.name;
          state.links = next.links;
          state.joints = next.joints;
          state.rootLinkId = next.rootLinkId;
          state.materials = next.materials;
          state.closedLoopConstraints = next.closedLoopConstraints;
          state.inspectionContext = next.inspectionContext;
          state._history.past = [...state._history.past, currentData].slice(-MAX_HISTORY);
          state._history.future = state._history.future.slice(1, MAX_HISTORY + 1);
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
