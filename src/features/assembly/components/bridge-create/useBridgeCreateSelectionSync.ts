import { useCallback, useEffect, useRef } from 'react';
import { useAssemblySelectionStore } from '@/store/assemblySelectionStore';
import { useSelectionStore } from '@/store/selectionStore';
import type { AssemblyState, BridgeJoint } from '@/types';
import {
  resolveBridgePickAssignment,
  resolveAssemblySelection,
  type BridgePickTarget,
} from '../../utils/bridgeSelection';

interface UseBridgeCreateSelectionSyncOptions {
  assemblyState: AssemblyState;
  parentCompId: string;
  childCompId: string;
  childLinkId: string;
  handleClose: () => void;
  isOpen: boolean;
  onPreviewChange?: (bridge: BridgeJoint | null) => void;
  pickTarget: BridgePickTarget;
  setChildCompId: (value: string) => void;
  setChildLinkId: (value: string) => void;
  setParentCompId: (value: string) => void;
  setParentLinkId: (value: string) => void;
  setPickTarget: (value: BridgePickTarget) => void;
}

export function useBridgeCreateSelectionSync({
  assemblyState,
  parentCompId,
  childCompId,
  childLinkId,
  handleClose,
  isOpen,
  onPreviewChange,
  pickTarget,
  setChildCompId,
  setChildLinkId,
  setParentCompId,
  setParentLinkId,
  setPickTarget,
}: UseBridgeCreateSelectionSyncOptions) {
  const selection = useSelectionStore((state) => state.selection);
  const setInteractionGuard = useSelectionStore((state) => state.setInteractionGuard);
  const clearInteractionSelection = useSelectionStore((state) => state.clearSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const clearAssemblySelection = useAssemblySelectionStore((state) => state.clearSelection);
  const lastAppliedSelectionRef = useRef<string | null>(null);
  const ignoredInitialSelectionSignatureRef = useRef<string | null>(null);

  const resetSelectionSyncState = useCallback(() => {
    lastAppliedSelectionRef.current = null;
    ignoredInitialSelectionSignatureRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetSelectionSyncState();
      setInteractionGuard(null);
      onPreviewChange?.(null);
      return undefined;
    }

    // Bridge picking should always begin from a clean interaction state.
    // Reusing a stale pre-open link selection can silently auto-fill a side,
    // flip the active pick target, and make hover/selection appear broken.
    const currentSelection = useSelectionStore.getState().selection;
    ignoredInitialSelectionSignatureRef.current =
      currentSelection.type && currentSelection.id
        ? `${currentSelection.type}:${currentSelection.id}:${currentSelection.subType ?? ''}:${currentSelection.objectIndex ?? ''}`
        : null;
    clearAssemblySelection();
    clearInteractionSelection();
    clearHover();
    lastAppliedSelectionRef.current = null;
  }, [
    clearAssemblySelection,
    clearHover,
    clearInteractionSelection,
    isOpen,
    onPreviewChange,
    resetSelectionSyncState,
    setInteractionGuard,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    setInteractionGuard((nextSelection) => {
      if (!nextSelection.id || !nextSelection.type) {
        return true;
      }

      const resolvedSelection = resolveAssemblySelection(assemblyState, nextSelection);
      if (!resolvedSelection) {
        return false;
      }

      return Boolean(
        resolveBridgePickAssignment({
          selectedComponentId: resolvedSelection.componentId,
          parentComponentId: parentCompId,
          childComponentId: childCompId,
          preferredTarget: pickTarget,
        }),
      );
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      setInteractionGuard(null);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    assemblyState,
    childCompId,
    handleClose,
    isOpen,
    parentCompId,
    pickTarget,
    setInteractionGuard,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const resolvedSelection = resolveAssemblySelection(assemblyState, selection);
    if (!resolvedSelection) {
      return;
    }

    const assignmentTarget = resolveBridgePickAssignment({
      selectedComponentId: resolvedSelection.componentId,
      parentComponentId: parentCompId,
      childComponentId: childCompId,
      preferredTarget: pickTarget,
    });
    if (!assignmentTarget) {
      return;
    }

    const selectionSignature = `${assignmentTarget}:${selection.type}:${selection.id}:${selection.subType ?? ''}:${selection.objectIndex ?? ''}`;
    const initialSelectionSignature = ignoredInitialSelectionSignatureRef.current;
    if (
      initialSelectionSignature &&
      initialSelectionSignature ===
        `${selection.type}:${selection.id}:${selection.subType ?? ''}:${selection.objectIndex ?? ''}`
    ) {
      ignoredInitialSelectionSignatureRef.current = null;
      return;
    }

    if (lastAppliedSelectionRef.current === selectionSignature) {
      return;
    }

    lastAppliedSelectionRef.current = selectionSignature;

    if (assignmentTarget === 'parent') {
      setParentCompId(resolvedSelection.componentId);
      setParentLinkId(resolvedSelection.linkId);
      if (!childCompId || !childLinkId) {
        setPickTarget('child');
      }
      return;
    }

    setChildCompId(resolvedSelection.componentId);
    setChildLinkId(resolvedSelection.linkId);
    if (!parentCompId) {
      setPickTarget('parent');
    }
  }, [
    assemblyState,
    childCompId,
    childLinkId,
    isOpen,
    parentCompId,
    pickTarget,
    selection,
    setChildCompId,
    setChildLinkId,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
  ]);

  return { resetSelectionSyncState };
}
