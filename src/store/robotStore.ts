/**
 * Robot Store - Manages robot data and operations
 * Uses immer for immutable updates and includes history middleware for undo/redo
 *
 * This file is the facade / composition root. The implementation is split into
 * focused slices under `./robot/`:
 *   - robotStoreTypes      types, constants, INITIAL_ROBOT_DATA, setAutoFreeze(false)
 *   - robotStoreInternals  stateless pure helpers
 *   - createHistorySlice   undo/redo + shared saveToHistory/appendHistorySnapshot
 *   - createAssemblySlice  component/bridge/joint-motion + merged-data cache closure
 *   - createTopologySlice  single-URDF link/joint CRUD + tree ops + getters
 *
 * The public API is unchanged: `useRobotStore`, the 9 selector hooks below and
 * `type RobotData`. Importing this module triggers `setAutoFreeze(false)` once
 * (via robotStoreTypes) before the single `create()` call.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  INITIAL_ROBOT_DATA,
  type RobotStoreState,
} from './robot/robotStoreTypes';
import { createHistorySlice } from './robot/createHistorySlice';
import { createAssemblySlice } from './robot/createAssemblySlice';
import { createTopologySlice } from './robot/createTopologySlice';

export type { RobotData } from './robot/robotStoreTypes';

export const useRobotStore = create<RobotStoreState>()(
  immer((set, get) => {
    // Single immer-created `set`/`get` shared by every slice factory below.
    const history = createHistorySlice(set, get);
    const assembly = createAssemblySlice(set, get, {
      appendHistorySnapshot: history.appendHistorySnapshot,
    });
    const topology = createTopologySlice(set, get, {
      saveToHistory: history.saveToHistory,
    });

    return {
      // Initial state
      ...INITIAL_ROBOT_DATA,
      ...history.slice,
      ...assembly.slice,
      ...topology.slice,
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
