import { applyPatches } from 'immer';

import type { AssemblyState } from '@/types';

import type {
  AssemblyHistoryEntry,
  AssemblyHistoryPatchEntry,
  AssemblyHistorySnapshotEntry,
  AssemblyHistoryState,
} from './types.ts';

function cloneAssemblySnapshot(snapshot: AssemblyState | null): AssemblyState | null {
  return snapshot ? structuredClone(snapshot) : null;
}

function isAssemblyHistoryPatchEntry(
  entry: AssemblyHistoryEntry,
): entry is AssemblyHistoryPatchEntry {
  return Boolean(entry && typeof entry === 'object' && 'kind' in entry && entry.kind === 'patch');
}

function isAssemblyHistorySnapshotEntry(
  entry: AssemblyHistoryEntry,
): entry is AssemblyHistorySnapshotEntry {
  return Boolean(
    entry && typeof entry === 'object' && 'kind' in entry && entry.kind === 'snapshot',
  );
}

function applyAssemblyHistoryEntry(
  currentState: AssemblyState | null,
  entry: AssemblyHistoryEntry,
  direction: 'undo' | 'redo',
): AssemblyState | null {
  if (isAssemblyHistoryPatchEntry(entry)) {
    return applyPatches(
      currentState,
      direction === 'undo' ? entry.undoPatches : entry.redoPatches,
    ) as AssemblyState | null;
  }

  if (isAssemblyHistorySnapshotEntry(entry)) {
    return cloneAssemblySnapshot(entry.snapshot);
  }

  return cloneAssemblySnapshot(entry);
}

export function materializeAssemblyHistorySnapshots(
  history: AssemblyHistoryState,
  present: AssemblyState | null,
): {
  past: Array<AssemblyState | null>;
  future: Array<AssemblyState | null>;
} {
  let cursor = cloneAssemblySnapshot(present);
  const past: Array<AssemblyState | null> = [];
  for (let index = history.past.length - 1; index >= 0; index -= 1) {
    cursor = applyAssemblyHistoryEntry(cursor, history.past[index], 'undo');
    past.unshift(cloneAssemblySnapshot(cursor));
  }

  cursor = cloneAssemblySnapshot(present);
  const future: Array<AssemblyState | null> = [];
  for (const entry of history.future) {
    cursor = applyAssemblyHistoryEntry(cursor, entry, 'redo');
    future.push(cloneAssemblySnapshot(cursor));
  }

  return { past, future };
}
