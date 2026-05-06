import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { matchesSelection, useSelectionStore } from '@/store/selectionStore';
import { BRIDGE_PREVIEW_ID } from '@/shared/utils/assembly/bridgePreviewId';
import { resolveAssemblyRootComponentSelection } from '@/shared/utils/assembly/transformSelection';
import type { AssemblyState, InteractionSelection } from '@/types';

interface UseWorkspaceViewerSelectionBridgeOptions {
  assemblyState: AssemblyState | null;
  canSelectAssemblyRootComponent: boolean;
  clearAssemblySelection: () => void;
  handleSelect: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
  ) => void;
  handleSelectGeometry: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
  ) => void;
  handleTransformPendingChange: (pending: boolean) => void;
  handleViewerMeshSelect: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  handleViewerSelect: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
  ) => void;
  selectComponent: (componentId: string) => void;
  setWorkspaceTransformPending: Dispatch<SetStateAction<boolean>>;
}

export function useWorkspaceViewerSelectionBridge({
  assemblyState,
  canSelectAssemblyRootComponent,
  clearAssemblySelection,
  handleSelect,
  handleSelectGeometry,
  handleTransformPendingChange,
  handleViewerMeshSelect,
  handleViewerSelect,
  selectComponent,
  setWorkspaceTransformPending,
}: UseWorkspaceViewerSelectionBridgeOptions) {
  const handleWorkspaceTransformPendingChange = useCallback(
    (pending: boolean) => {
      handleTransformPendingChange(pending);
      setWorkspaceTransformPending((current) => (current === pending ? current : pending));
    },
    [handleTransformPendingChange, setWorkspaceTransformPending],
  );

  const trySelectAssemblyRootComponent = useCallback(
    (
      nextSelection: {
        type: Exclude<InteractionSelection['type'], null>;
        id: string;
        subType?: 'visual' | 'collision';
        objectIndex?: number;
      },
      applySelection: () => void,
    ) => {
      if (nextSelection.type === 'tendon' || !canSelectAssemblyRootComponent || !assemblyState) {
        return false;
      }

      const resolvedRootSelection = resolveAssemblyRootComponentSelection(
        assemblyState,
        nextSelection,
      );
      if (!resolvedRootSelection) {
        return false;
      }

      applySelection();

      const currentSelection = useSelectionStore.getState().selection;
      if (matchesSelection(currentSelection, nextSelection)) {
        selectComponent(resolvedRootSelection.componentId);
      }

      return true;
    },
    [assemblyState, canSelectAssemblyRootComponent, selectComponent],
  );

  const handleViewerSelectWithBridgePreview = useCallback(
    (...args: Parameters<typeof handleViewerSelect>) => {
      const [type, id, subType] = args;
      if (type === 'joint' && id === BRIDGE_PREVIEW_ID) {
        return;
      }

      if (
        type !== 'tendon' &&
        trySelectAssemblyRootComponent({ type, id, subType }, () => handleViewerSelect(...args))
      ) {
        return;
      }

      clearAssemblySelection();
      handleViewerSelect(...args);
    },
    [clearAssemblySelection, handleViewerSelect, trySelectAssemblyRootComponent],
  );

  const handleSelectWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleSelect>) => {
      const [type, id, subType] = args;
      if (trySelectAssemblyRootComponent({ type, id, subType }, () => handleSelect(...args))) {
        return;
      }

      clearAssemblySelection();
      handleSelect(...args);
    },
    [clearAssemblySelection, handleSelect, trySelectAssemblyRootComponent],
  );

  const handleSelectGeometryWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleSelectGeometry>) => {
      clearAssemblySelection();
      handleSelectGeometry(...args);
    },
    [clearAssemblySelection, handleSelectGeometry],
  );

  const handleViewerMeshSelectWithAssemblyClear = useCallback(
    (...args: Parameters<typeof handleViewerMeshSelect>) => {
      const [linkId, _jointId, objectIndex, objectType] = args;
      if (
        trySelectAssemblyRootComponent(
          {
            type: 'link',
            id: linkId,
            subType: objectType,
            objectIndex,
          },
          () => handleViewerMeshSelect(...args),
        )
      ) {
        return;
      }

      clearAssemblySelection();
      handleViewerMeshSelect(...args);
    },
    [clearAssemblySelection, handleViewerMeshSelect, trySelectAssemblyRootComponent],
  );

  return {
    handleSelectGeometryWithAssemblyClear,
    handleSelectWithAssemblyClear,
    handleViewerMeshSelectWithAssemblyClear,
    handleViewerSelectWithBridgePreview,
    handleWorkspaceTransformPendingChange,
  };
}
