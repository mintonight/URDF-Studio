/**
 * Selection Store - Manages selection state for robot elements
 * Handles link/joint selection and hover state for synchronized highlighting
 */
import { create } from 'zustand';
import type { InteractionSelection } from '@/types';

// Selection type matching RobotState['selection'] plus hover-only helper overlays.
export type Selection = InteractionSelection;

export type SelectionGuard = (selection: Selection) => boolean;

interface SelectionState {
  // Current selection
  selection: Selection;
  interactionGuard: SelectionGuard | null;
  setInteractionGuard: (guard: SelectionGuard | null) => void;
  isInteractionAllowed: (selection: Selection) => boolean;
  setSelection: (selection: Selection) => void;
  selectLink: (id: string, subType?: 'visual' | 'collision', objectIndex?: number) => void;
  selectJoint: (id: string) => void;
  clearSelection: () => void;

  // Hover state for synchronized highlighting across components
  hoveredSelection: Selection;
  deferredHoveredSelection: Selection;
  hoverFrozen: boolean;
  interactionHoverFrozen: boolean;
  hoverBlockCount: number;
  setHoverFrozen: (frozen: boolean) => void;
  beginHoverBlock: () => void;
  endHoverBlock: () => void;
  setHoveredSelection: (selection: Selection) => void;
  hoverLink: (id: string) => void;
  hoverJoint: (id: string) => void;
  clearHover: () => void;

  // Transient emphasis for auto-jumped tree rows
  attentionSelection: Selection;
  setAttentionSelection: (selection: Selection) => void;
  pulseSelection: (selection: Selection, durationMs?: number) => void;
  clearAttentionSelection: () => void;

  // Focus target for camera focusing
  focusTarget: string | null;
  setFocusTarget: (id: string | null) => void;
  focusOn: (id: string) => void;
}

const emptySelection: Selection = { type: null, id: null };

function isSelectionEmpty(selection: Selection): boolean {
  return !selection.type || !selection.id;
}

function normalizeSelection(selection: Selection): Selection {
  return isSelectionEmpty(selection) ? emptySelection : selection;
}

function hasOwnSelectionField<T extends keyof Selection>(selection: Selection, field: T): boolean {
  return Object.prototype.hasOwnProperty.call(selection, field);
}

function matchesStoredSelection(selection: Selection, target: Selection): boolean {
  if (
    !matchesSelection(selection, target, {
      ignoreObjectIndex: false,
      ignoreHelperKind: false,
      ignoreHighlightObjectId: false,
    })
  ) {
    return false;
  }

  if (
    hasOwnSelectionField(selection, 'objectIndex') !== hasOwnSelectionField(target, 'objectIndex')
  ) {
    return false;
  }

  if (
    hasOwnSelectionField(selection, 'highlightObjectId') !==
    hasOwnSelectionField(target, 'highlightObjectId')
  ) {
    return false;
  }

  return true;
}

function isSelectionAllowed(selection: Selection, guard: SelectionGuard | null): boolean {
  return isSelectionEmpty(selection) || !guard || guard(selection);
}

function sanitizeSelection(selection: Selection, guard: SelectionGuard | null): Selection {
  const normalizedSelection = normalizeSelection(selection);
  return isSelectionAllowed(normalizedSelection, guard) ? normalizedSelection : emptySelection;
}

function resolveHoverStateUpdate(
  state: Pick<
    SelectionState,
    | 'hoverFrozen'
    | 'hoverBlockCount'
    | 'hoveredSelection'
    | 'deferredHoveredSelection'
    | 'interactionGuard'
  >,
  selection: Selection,
) {
  const nextSelection = sanitizeSelection(selection, state.interactionGuard);

  if (state.hoverBlockCount > 0) {
    return matchesSelection(state.deferredHoveredSelection, emptySelection, {
      ignoreHelperKind: false,
      ignoreHighlightObjectId: false,
    })
      ? state
      : state;
  }

  if (state.hoverFrozen) {
    return matchesSelection(state.deferredHoveredSelection, nextSelection, {
      ignoreHelperKind: false,
      ignoreHighlightObjectId: false,
    })
      ? state
      : { deferredHoveredSelection: nextSelection };
  }

  return matchesSelection(state.hoveredSelection, nextSelection, {
    ignoreHelperKind: false,
    ignoreHighlightObjectId: false,
  })
    ? state
    : { hoveredSelection: nextSelection };
}

function resolveHoverFreezeState(
  state: Pick<
    SelectionState,
    | 'hoverFrozen'
    | 'interactionHoverFrozen'
    | 'hoverBlockCount'
    | 'hoveredSelection'
    | 'deferredHoveredSelection'
    | 'interactionGuard'
  >,
  interactionHoverFrozen: boolean,
  hoverBlockCount: number,
) {
  const clampedHoverBlockCount = Math.max(0, hoverBlockCount);
  const nextHoverFrozen = interactionHoverFrozen || clampedHoverBlockCount > 0;
  const sanitizedHoveredSelection = sanitizeSelection(
    state.hoveredSelection,
    state.interactionGuard,
  );

  if (clampedHoverBlockCount > 0) {
    const nextDeferredHoveredSelection = state.interactionHoverFrozen
      ? emptySelection
      : sanitizedHoveredSelection;

    return state.interactionHoverFrozen === interactionHoverFrozen &&
      state.hoverBlockCount === clampedHoverBlockCount &&
      state.hoverFrozen === nextHoverFrozen &&
      matchesSelection(state.hoveredSelection, emptySelection, {
        ignoreHelperKind: false,
        ignoreHighlightObjectId: false,
      }) &&
      matchesSelection(state.deferredHoveredSelection, nextDeferredHoveredSelection, {
        ignoreHelperKind: false,
        ignoreHighlightObjectId: false,
      })
      ? state
      : {
          interactionHoverFrozen,
          hoverBlockCount: clampedHoverBlockCount,
          hoverFrozen: nextHoverFrozen,
          hoveredSelection: emptySelection,
          deferredHoveredSelection: nextDeferredHoveredSelection,
        };
  }

  if (interactionHoverFrozen) {
    const nextDeferredHoveredSelection = state.hoverFrozen
      ? state.deferredHoveredSelection
      : sanitizeSelection(state.hoveredSelection, state.interactionGuard);

    return state.interactionHoverFrozen === interactionHoverFrozen &&
      state.hoverBlockCount === clampedHoverBlockCount &&
      state.hoverFrozen === nextHoverFrozen &&
      matchesSelection(state.hoveredSelection, emptySelection, {
        ignoreHelperKind: false,
        ignoreHighlightObjectId: false,
      }) &&
      matchesSelection(state.deferredHoveredSelection, nextDeferredHoveredSelection, {
        ignoreHelperKind: false,
        ignoreHighlightObjectId: false,
      })
      ? state
      : {
          interactionHoverFrozen,
          hoverBlockCount: clampedHoverBlockCount,
          hoverFrozen: nextHoverFrozen,
          hoveredSelection: emptySelection,
          deferredHoveredSelection: nextDeferredHoveredSelection,
        };
  }

  const nextHoveredSelection = state.hoverFrozen
    ? sanitizeSelection(state.deferredHoveredSelection, state.interactionGuard)
    : sanitizedHoveredSelection;

  return state.interactionHoverFrozen === interactionHoverFrozen &&
    state.hoverBlockCount === clampedHoverBlockCount &&
    state.hoverFrozen === nextHoverFrozen &&
    matchesSelection(state.hoveredSelection, nextHoveredSelection, {
      ignoreHelperKind: false,
      ignoreHighlightObjectId: false,
    }) &&
    matchesSelection(state.deferredHoveredSelection, emptySelection, {
      ignoreHelperKind: false,
      ignoreHighlightObjectId: false,
    })
    ? state
    : {
        interactionHoverFrozen,
        hoverBlockCount: clampedHoverBlockCount,
        hoverFrozen: nextHoverFrozen,
        hoveredSelection: nextHoveredSelection,
        deferredHoveredSelection: emptySelection,
      };
}

export function matchesSelection(
  selection: Selection,
  target: Selection,
  options: {
    ignoreSubType?: boolean;
    ignoreObjectIndex?: boolean;
    ignoreHelperKind?: boolean;
    ignoreHighlightObjectId?: boolean;
  } = {},
): boolean {
  const ignoreHelperKind = options.ignoreHelperKind ?? true;
  const ignoreHighlightObjectId = options.ignoreHighlightObjectId ?? true;

  if (selection.type !== target.type || selection.id !== target.id) {
    return false;
  }

  if (!options.ignoreSubType && selection.subType !== target.subType) {
    return false;
  }

  if (!options.ignoreObjectIndex && (selection.objectIndex ?? 0) !== (target.objectIndex ?? 0)) {
    return false;
  }

  if (!ignoreHelperKind && selection.helperKind !== target.helperKind) {
    return false;
  }

  if (
    !ignoreHighlightObjectId &&
    (selection.highlightObjectId ?? null) !== (target.highlightObjectId ?? null)
  ) {
    return false;
  }

  return true;
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  // Current selection
  selection: emptySelection,
  interactionGuard: null,
  setInteractionGuard: (guard) =>
    set((state) => {
      const nextHoveredSelection = sanitizeSelection(state.hoveredSelection, guard);
      const nextDeferredHoveredSelection = sanitizeSelection(state.deferredHoveredSelection, guard);

      return state.interactionGuard === guard &&
        matchesSelection(state.hoveredSelection, nextHoveredSelection, {
          ignoreHelperKind: false,
          ignoreHighlightObjectId: false,
        }) &&
        matchesSelection(state.deferredHoveredSelection, nextDeferredHoveredSelection, {
          ignoreHelperKind: false,
          ignoreHighlightObjectId: false,
        })
        ? state
        : {
            interactionGuard: guard,
            hoveredSelection: nextHoveredSelection,
            deferredHoveredSelection: nextDeferredHoveredSelection,
          };
    }),
  isInteractionAllowed: (selection) => isSelectionAllowed(selection, get().interactionGuard),
  setSelection: (selection) =>
    set((state) => {
      const nextSelection = normalizeSelection(selection);
      if (
        (!isSelectionEmpty(nextSelection) &&
          !isSelectionAllowed(nextSelection, state.interactionGuard)) ||
        matchesStoredSelection(state.selection, nextSelection)
      ) {
        return state;
      }

      return { selection: nextSelection };
    }),
  selectLink: (id, subType, objectIndex) =>
    set((state) => {
      const selection = { type: 'link' as const, id, subType, objectIndex };
      if (
        !isSelectionAllowed(selection, state.interactionGuard) ||
        matchesStoredSelection(state.selection, selection)
      ) {
        return state;
      }

      return { selection };
    }),
  selectJoint: (id) =>
    set((state) => {
      const selection = { type: 'joint' as const, id };
      if (
        !isSelectionAllowed(selection, state.interactionGuard) ||
        matchesStoredSelection(state.selection, selection)
      ) {
        return state;
      }

      return { selection };
    }),
  clearSelection: () => set({ selection: emptySelection }),

  // Hover state
  hoveredSelection: emptySelection,
  deferredHoveredSelection: emptySelection,
  hoverFrozen: false,
  interactionHoverFrozen: false,
  hoverBlockCount: 0,
  setHoverFrozen: (frozen) =>
    set((state) => resolveHoverFreezeState(state, frozen, state.hoverBlockCount)),
  beginHoverBlock: () =>
    set((state) =>
      resolveHoverFreezeState(state, state.interactionHoverFrozen, state.hoverBlockCount + 1),
    ),
  endHoverBlock: () =>
    set((state) =>
      resolveHoverFreezeState(state, state.interactionHoverFrozen, state.hoverBlockCount - 1),
    ),
  setHoveredSelection: (selection) => set((state) => resolveHoverStateUpdate(state, selection)),
  hoverLink: (id) => set((state) => resolveHoverStateUpdate(state, { type: 'link', id })),
  hoverJoint: (id) => set((state) => resolveHoverStateUpdate(state, { type: 'joint', id })),
  clearHover: () =>
    set((state) =>
      state.hoverFrozen
        ? matchesSelection(state.deferredHoveredSelection, emptySelection, {
            ignoreHelperKind: false,
            ignoreHighlightObjectId: false,
          })
          ? state
          : { deferredHoveredSelection: emptySelection }
        : matchesSelection(state.hoveredSelection, emptySelection, {
              ignoreHelperKind: false,
              ignoreHighlightObjectId: false,
            })
          ? state
          : { hoveredSelection: emptySelection },
    ),

  // Transient emphasis
  attentionSelection: emptySelection,
  setAttentionSelection: (selection) => set({ attentionSelection: normalizeSelection(selection) }),
  pulseSelection: (() => {
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
    return (selection: Selection, durationMs = 2600) => {
      if (pendingTimeout !== null) clearTimeout(pendingTimeout);

      if (!selection.type || !selection.id) {
        pendingTimeout = null;
        set({ attentionSelection: emptySelection });
        return;
      }

      set({ attentionSelection: selection });
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        set({ attentionSelection: emptySelection });
      }, durationMs);
    };
  })(),
  clearAttentionSelection: () => set({ attentionSelection: emptySelection }),

  // Focus target
  focusTarget: null,
  setFocusTarget: (id) => set({ focusTarget: id }),
  focusOn: (() => {
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
    let pendingRefocusTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleFocusReset = () => {
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        set({ focusTarget: null });
      }, 1500);
      pendingTimeout.unref?.();
    };

    return (id: string) => {
      if (pendingTimeout !== null) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
      if (pendingRefocusTimeout !== null) {
        clearTimeout(pendingRefocusTimeout);
        pendingRefocusTimeout = null;
      }

      if (get().focusTarget === id) {
        set({ focusTarget: null });
        pendingRefocusTimeout = setTimeout(() => {
          pendingRefocusTimeout = null;
          set({ focusTarget: id });
          scheduleFocusReset();
        }, 0);
        pendingRefocusTimeout.unref?.();
        return;
      }

      set({ focusTarget: id });
      scheduleFocusReset();
    };
  })(),
}));

function hasSelectionEntry(entries: Record<string, { name?: string }>, identity: string): boolean {
  if (identity in entries) {
    return true;
  }

  return Object.values(entries).some((entry) => entry.name === identity);
}

// Helper to check if selection exists in data
export function validateSelection(
  selection: Selection,
  links: Record<string, { name?: string }>,
  joints: Record<string, { name?: string }>,
  inspectionContext?: {
    mjcf?: {
      tendons?: Array<{
        name: string;
      }>;
    };
  } | null,
): boolean {
  if (!selection.id || !selection.type) return true; // Empty selection is valid

  if (selection.type === 'link') {
    return hasSelectionEntry(links, selection.id);
  }
  if (selection.type === 'joint') {
    return hasSelectionEntry(joints, selection.id);
  }

  return Boolean(inspectionContext?.mjcf?.tendons?.some((tendon) => tendon.name === selection.id));
}
