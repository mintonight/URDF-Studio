import { useCallback, useEffect, useRef } from 'react';
import { registerPendingHistoryFlusher } from '@/app/utils/pendingHistory';
import { useAssemblyStore, useRobotStore } from '@/store';
import type { AssemblyState, RobotData } from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

const PROPERTY_HISTORY_COMMIT_DELAY_MS = 220;

interface PendingHistoryEntry<T> {
  key: string;
  label: string;
  snapshot: T;
  timeoutId: number | null;
}

interface UsePendingHistoryCoordinatorParams {
  sidebarTab: string;
  createRobotSnapshot: () => RobotData;
  createAssemblySnapshot: () => AssemblyState | null;
}

export function usePendingHistoryCoordinator({
  sidebarTab,
  createRobotSnapshot,
  createAssemblySnapshot,
}: UsePendingHistoryCoordinatorParams) {
  const pendingRobotHistoryRef = useRef<PendingHistoryEntry<RobotData> | null>(null);
  const pendingAssemblyHistoryRef = useRef<PendingHistoryEntry<AssemblyState | null> | null>(null);

  const clearPendingHistoryTimer = useCallback((entry: PendingHistoryEntry<unknown> | null) => {
    if (!entry || entry.timeoutId === null) return;
    window.clearTimeout(entry.timeoutId);
    entry.timeoutId = null;
  }, []);

  const snapshotsMatch = useCallback((before: unknown, after: unknown) => {
    return JSON.stringify(before) === JSON.stringify(after);
  }, []);

  const commitPendingRobotHistory = useCallback(
    (expectedKey?: string) => {
      const pending = pendingRobotHistoryRef.current;
      if (!pending || (expectedKey && pending.key !== expectedKey)) return;

      clearPendingHistoryTimer(pending);
      pendingRobotHistoryRef.current = null;

      const currentSnapshot = createRobotSnapshot();
      if (snapshotsMatch(pending.snapshot, currentSnapshot)) return;

      useRobotStore.getState().pushHistorySnapshot(pending.snapshot, pending.label);
    },
    [clearPendingHistoryTimer, createRobotSnapshot, snapshotsMatch],
  );

  const commitPendingAssemblyHistory = useCallback(
    (expectedKey?: string) => {
      const pending = pendingAssemblyHistoryRef.current;
      if (!pending || (expectedKey && pending.key !== expectedKey)) return;

      clearPendingHistoryTimer(pending);
      pendingAssemblyHistoryRef.current = null;

      const currentSnapshot = createAssemblySnapshot();
      if (snapshotsMatch(pending.snapshot, currentSnapshot)) return;

      useAssemblyStore.getState().pushHistorySnapshot(pending.snapshot, pending.label);
    },
    [clearPendingHistoryTimer, createAssemblySnapshot, snapshotsMatch],
  );

  const ensurePendingRobotHistory = useCallback(
    (key: string, label: string) => {
      const pending = pendingRobotHistoryRef.current;
      if (pending?.key === key) {
        pending.label = label;
        clearPendingHistoryTimer(pending);
        return;
      }

      commitPendingRobotHistory();
      pendingRobotHistoryRef.current = {
        key,
        label,
        snapshot: createRobotSnapshot(),
        timeoutId: null,
      };
    },
    [clearPendingHistoryTimer, commitPendingRobotHistory, createRobotSnapshot],
  );

  const ensurePendingAssemblyHistory = useCallback(
    (key: string, label: string) => {
      const pending = pendingAssemblyHistoryRef.current;
      if (pending?.key === key) {
        pending.label = label;
        clearPendingHistoryTimer(pending);
        return;
      }

      commitPendingAssemblyHistory();
      pendingAssemblyHistoryRef.current = {
        key,
        label,
        snapshot: createAssemblySnapshot(),
        timeoutId: null,
      };
    },
    [clearPendingHistoryTimer, commitPendingAssemblyHistory, createAssemblySnapshot],
  );

  const schedulePendingRobotHistoryCommit = useCallback(
    (key: string, delayMs = PROPERTY_HISTORY_COMMIT_DELAY_MS) => {
      const pending = pendingRobotHistoryRef.current;
      if (!pending || pending.key !== key) return;

      clearPendingHistoryTimer(pending);
      pending.timeoutId = window.setTimeout(() => {
        commitPendingRobotHistory(key);
      }, delayMs);
    },
    [clearPendingHistoryTimer, commitPendingRobotHistory],
  );

  const schedulePendingAssemblyHistoryCommit = useCallback(
    (key: string, delayMs = PROPERTY_HISTORY_COMMIT_DELAY_MS) => {
      const pending = pendingAssemblyHistoryRef.current;
      if (!pending || pending.key !== key) return;

      clearPendingHistoryTimer(pending);
      pending.timeoutId = window.setTimeout(() => {
        commitPendingAssemblyHistory(key);
      }, delayMs);
    },
    [clearPendingHistoryTimer, commitPendingAssemblyHistory],
  );

  useEffect(() => {
    const flushPendingHistory = () => {
      commitPendingRobotHistory();
      commitPendingAssemblyHistory();
    };

    registerPendingHistoryFlusher(flushPendingHistory);
    return () => {
      flushPendingHistory();
      registerPendingHistoryFlusher(null);
    };
  }, [commitPendingAssemblyHistory, commitPendingRobotHistory]);

  useEffect(() => {
    commitPendingRobotHistory();
    commitPendingAssemblyHistory();
  }, [sidebarTab, commitPendingAssemblyHistory, commitPendingRobotHistory]);

  return {
    commitPendingRobotHistory,
    commitPendingAssemblyHistory,
    ensurePendingRobotHistory,
    ensurePendingAssemblyHistory,
    schedulePendingRobotHistoryCommit,
    schedulePendingAssemblyHistoryCommit,
  };
}
