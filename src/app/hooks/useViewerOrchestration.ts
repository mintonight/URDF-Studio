import { useCallback, type RefObject } from 'react';
import { useSelectionStore, useUIStore } from '@/store';
import type { DetailLinkTab, InteractionSelection, RobotState } from '@/types';
import type { ViewerHelperKind } from '@/features/urdf-viewer/types';

const EMPTY_SELECTION: InteractionSelection = { type: null, id: null };

function resolveDetailLinkTabAfterViewerMeshSelect(
  objectType: 'visual' | 'collision',
): DetailLinkTab {
  return objectType;
}

function resolveDetailLinkTabAfterGeometrySelection(
  subType: 'visual' | 'collision',
): DetailLinkTab {
  return subType;
}

interface UseViewerOrchestrationOptions {
  setSelection: (selection: RobotState['selection']) => void;
  pulseSelection: (selection: RobotState['selection'], durationMs?: number) => void;
  setHoveredSelection: (selection: InteractionSelection) => void;
  focusOn: (id: string) => void;
  transformPendingRef: RefObject<boolean>;
}

export function useViewerOrchestration({
  setSelection,
  pulseSelection,
  setHoveredSelection,
  focusOn,
  transformPendingRef,
}: UseViewerOrchestrationOptions) {
  const isInteractionAllowed = useCallback(
    (selection: RobotState['selection']) =>
      useSelectionStore.getState().isInteractionAllowed(selection),
    [],
  );
  const ensureCollisionVisible = useCallback(() => {
    const uiState = useUIStore.getState();
    if (!uiState.viewOptions.showCollision) {
      uiState.setViewOption('showCollision', true);
    }
  }, []);

  const applyHelperSelectionUiState = useCallback((helperKind?: ViewerHelperKind) => {
    if (!helperKind) {
      return;
    }

    const uiState = useUIStore.getState();

    if (helperKind === 'center-of-mass' || helperKind === 'inertia') {
      if (uiState.detailLinkTab !== 'physics') {
        uiState.setDetailLinkTab('physics');
      }
      uiState.setPanelSection('property_editor_link_inertial', false);
      return;
    }

    if (helperKind === 'origin-axes') {
      if (uiState.detailLinkTab !== 'visual') {
        uiState.setDetailLinkTab('visual');
      }
      uiState.setPanelSection('property_editor_link_frame', false);
      return;
    }

    if (helperKind === 'joint-axis') {
      uiState.setPanelSection('kinematics', false);
    }
  }, []);

  const preserveCollisionObjectIndex = useCallback((selection: RobotState['selection']) => {
    if (
      selection.type !== 'link' ||
      selection.subType !== 'collision' ||
      selection.objectIndex !== undefined
    ) {
      return selection;
    }

    const currentSelection = useSelectionStore.getState().selection;
    if (
      currentSelection.type === 'link' &&
      currentSelection.id === selection.id &&
      currentSelection.subType === 'collision' &&
      currentSelection.objectIndex !== undefined
    ) {
      return {
        ...selection,
        objectIndex: currentSelection.objectIndex,
      };
    }

    return selection;
  }, []);

  const preserveHoveredHighlightObject = useCallback((selection: RobotState['selection']) => {
    if (selection.type !== 'link' || !selection.id || !selection.subType) {
      return selection;
    }

    const hoveredSelection = useSelectionStore.getState().hoveredSelection;
    if (
      hoveredSelection.type !== 'link' ||
      hoveredSelection.id !== selection.id ||
      hoveredSelection.subType !== selection.subType ||
      hoveredSelection.objectIndex !== selection.objectIndex ||
      hoveredSelection.highlightObjectId === undefined
    ) {
      return selection;
    }

    return {
      ...selection,
      highlightObjectId: hoveredSelection.highlightObjectId,
    };
  }, []);

  const handleSelect = useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
    ) => {
      if (transformPendingRef.current) return;
      const nextSelection = preserveCollisionObjectIndex({ type, id, subType });
      if (!isInteractionAllowed(nextSelection)) {
        return;
      }

      if (nextSelection.type === 'link' && nextSelection.subType === 'collision') {
        ensureCollisionVisible();
      }
      setSelection(nextSelection);
    },
    [
      ensureCollisionVisible,
      isInteractionAllowed,
      preserveCollisionObjectIndex,
      setSelection,
      transformPendingRef,
    ],
  );

  const handleSelectGeometry = useCallback(
    (
      linkId: string,
      subType: 'visual' | 'collision',
      objectIndex = 0,
      suppressPulse = false,
      suppressAutoReveal = false,
    ) => {
      if (transformPendingRef.current) return;
      const nextSelection = { type: 'link' as const, id: linkId, subType, objectIndex };
      if (!isInteractionAllowed(nextSelection)) {
        return;
      }

      if (subType === 'collision' && !suppressAutoReveal) {
        ensureCollisionVisible();
      }
      setSelection(nextSelection);
      if (!suppressPulse) {
        pulseSelection(nextSelection);
      }
      const uiState = useUIStore.getState();
      const nextTab = resolveDetailLinkTabAfterGeometrySelection(subType);
      if (uiState.detailLinkTab !== nextTab) {
        uiState.setDetailLinkTab(nextTab);
      }
    },
    [
      ensureCollisionVisible,
      isInteractionAllowed,
      pulseSelection,
      setSelection,
      transformPendingRef,
    ],
  );

  const handleViewerSelect = useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
      helperKind?: ViewerHelperKind,
    ) => {
      if (transformPendingRef.current) return;
      if (!id) {
        setSelection(EMPTY_SELECTION);
        setHoveredSelection(EMPTY_SELECTION);
        pulseSelection(EMPTY_SELECTION);
        return;
      }

      const baseSelection = helperKind
        ? ({ type, id, subType, helperKind } as const)
        : ({ type, id, subType } as const);
      const nextSelection = preserveCollisionObjectIndex(baseSelection);
      if (!isInteractionAllowed(nextSelection)) {
        return;
      }

      if (nextSelection.type === 'link' && nextSelection.subType === 'collision') {
        ensureCollisionVisible();
      }
      setSelection(nextSelection);
      if (helperKind) {
        setHoveredSelection({ type: null, id: null });
        applyHelperSelectionUiState(helperKind);
      }
      pulseSelection(nextSelection);
    },
    [
      applyHelperSelectionUiState,
      ensureCollisionVisible,
      preserveCollisionObjectIndex,
      pulseSelection,
      isInteractionAllowed,
      setHoveredSelection,
      setSelection,
      transformPendingRef,
    ],
  );

  const handleViewerMeshSelect = useCallback(
    (
      linkId: string,
      _jointId: string | null,
      objectIndex: number,
      objectType: 'visual' | 'collision',
    ) => {
      if (transformPendingRef.current) return;
      const nextSelection = preserveHoveredHighlightObject({
        type: 'link' as const,
        id: linkId,
        subType: objectType,
        objectIndex,
      });
      if (!isInteractionAllowed(nextSelection)) {
        return;
      }

      if (objectType === 'collision') {
        ensureCollisionVisible();
      }
      setSelection(nextSelection);
      const uiState = useUIStore.getState();
      const nextTab = resolveDetailLinkTabAfterViewerMeshSelect(objectType);
      if (uiState.detailLinkTab !== nextTab) {
        uiState.setDetailLinkTab(nextTab);
      }
      pulseSelection(nextSelection);
    },
    [
      ensureCollisionVisible,
      isInteractionAllowed,
      pulseSelection,
      preserveHoveredHighlightObject,
      setSelection,
      transformPendingRef,
    ],
  );

  const handleTransformPendingChange = useCallback(
    (pending: boolean) => {
      transformPendingRef.current = pending;
    },
    [transformPendingRef],
  );

  const handleHover = useCallback(
    (
      type: InteractionSelection['type'],
      id: string | null,
      subType?: 'visual' | 'collision',
      objectIndex?: number,
      helperKind?: ViewerHelperKind,
      highlightObjectId?: number,
    ) => {
      const current = useSelectionStore.getState().hoveredSelection;
      const selected = useSelectionStore.getState().selection;

      if (
        selected.type === 'link' &&
        selected.id &&
        type === 'link' &&
        id === selected.id &&
        current.type === 'link' &&
        current.id === selected.id
      ) {
        return;
      }

      if (
        current.type === type &&
        current.id === id &&
        current.subType === subType &&
        (current.objectIndex ?? 0) === (objectIndex ?? 0) &&
        current.helperKind === helperKind &&
        (current.highlightObjectId ?? null) === (highlightObjectId ?? null)
      ) {
        return;
      }

      const nextSelection = { type, id, subType, objectIndex, helperKind, highlightObjectId };
      if (!isInteractionAllowed(nextSelection)) {
        setHoveredSelection({ type: null, id: null });
        return;
      }

      setHoveredSelection(nextSelection);
    },
    [isInteractionAllowed, setHoveredSelection],
  );

  const handleFocus = useCallback(
    (id: string) => {
      focusOn(id);
    },
    [focusOn],
  );

  return {
    handleSelect,
    handleSelectGeometry,
    handleViewerSelect,
    handleViewerMeshSelect,
    handleTransformPendingChange,
    handleHover,
    handleFocus,
  };
}
