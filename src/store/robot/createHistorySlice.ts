/**
 * History slice
 *
 * Owns undo/redo, the `_history`/`_activity` bookkeeping and the shared history
 * helpers (`appendHistorySnapshot` / `saveToHistory`). The two helpers are
 * returned to the composition root so the assembly and topology slices reuse
 * the EXACT same closure references — never rebuilt copies — keeping the undo
 * stack and activity log single-sourced.
 */
import type { AssemblyState } from '@/types';
import {
  MAX_ACTIVITY_LOG,
  MAX_HISTORY,
  type RobotData,
  type RobotStoreGet,
  type RobotStoreSet,
} from './robotStoreTypes';
import {
  buildRobotSnapshotForAssemblySnapshot,
  cloneRobotData,
  createChangeLogEntry,
  isAssemblySnapshot,
} from './robotStoreInternals';

export interface HistorySlice {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  pushHistorySnapshot: (snapshot: RobotData | AssemblyState | null, label: string) => void;
  _history: { past: RobotData[]; future: RobotData[] };
  _activity: ReturnType<typeof createChangeLogEntry>[];
}

export interface CreateHistorySliceResult {
  slice: HistorySlice;
  appendHistorySnapshot: (snapshot: RobotData | AssemblyState | null, label: string) => void;
  saveToHistory: (label: string) => void;
}

export function createHistorySlice(
  set: RobotStoreSet,
  get: RobotStoreGet,
): CreateHistorySliceResult {
  const appendHistorySnapshot = (snapshot: RobotData | AssemblyState | null, label: string) => {
    const robotSnapshot = isAssemblySnapshot(snapshot)
      ? buildRobotSnapshotForAssemblySnapshot(get(), snapshot)
      : cloneRobotData(snapshot);

    set((state) => {
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

  const slice: HistorySlice = {
    _history: { past: [], future: [] },
    _activity: [],

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
  };

  return { slice, appendHistorySnapshot, saveToHistory };
}
