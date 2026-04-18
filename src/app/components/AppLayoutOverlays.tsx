import React, { lazy, Suspense } from 'react';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { loadSourceCodeEditorModule } from '@/app/utils/sourceCodeEditorLoader';
import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from '@/app/utils/overlayLoaders';
import type { Language } from '@/shared/i18n';
import type { BridgeJoint, InteractionSelection, Theme, UrdfJoint } from '@/types';
import type { AssemblyState } from '@/types';
import type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '@/features/property-editor';
import type { SourceCodeEditorDocument } from '@/features/code-editor';

const SourceCodeEditor = lazy(() =>
  loadSourceCodeEditorModule().then((module) => ({ default: module.SourceCodeEditor })),
);

const CollisionOptimizationDialog = lazy(() =>
  loadCollisionOptimizationDialogModule().then((module) => ({
    default: module.CollisionOptimizationDialog,
  })),
);

const BridgeCreateModal = lazy(() =>
  loadBridgeCreateModalModule().then((module) => ({ default: module.BridgeCreateModal })),
);

interface AppLayoutOverlaysProps {
  isCodeViewerOpen: boolean;
  sourceCodeDocuments: SourceCodeEditorDocument[];
  autoApplyEnabled?: boolean;
  onCloseCodeViewer: () => void;
  theme: Theme;
  lang: Language;
  loadingEditorLabel: string;
  isCollisionOptimizerOpen: boolean;
  loadingOptimizerLabel: string;
  collisionOptimizationSource: CollisionOptimizationSource;
  assets: Record<string, string>;
  sourceFilePath?: string;
  selection: InteractionSelection;
  onCloseCollisionOptimizer: () => void;
  onSelectCollisionTarget: (target: CollisionTargetRef) => void;
  onApplyCollisionOptimization: (operations: CollisionOptimizationOperation[]) => void;
  assemblyState: AssemblyState | null;
  shouldRenderBridgeModal: boolean;
  loadingBridgeDialogLabel: string;
  isBridgeModalOpen: boolean;
  onCloseBridgeModal: () => void;
  onPreviewBridgeChange: (bridge: BridgeJoint | null) => void;
  onCreateBridge: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: Partial<UrdfJoint>;
  }) => unknown;
}

export function AppLayoutOverlays({
  isCodeViewerOpen,
  sourceCodeDocuments,
  autoApplyEnabled = true,
  onCloseCodeViewer,
  theme,
  lang,
  loadingEditorLabel,
  isCollisionOptimizerOpen,
  loadingOptimizerLabel,
  collisionOptimizationSource,
  assets,
  sourceFilePath,
  selection,
  onCloseCollisionOptimizer,
  onSelectCollisionTarget,
  onApplyCollisionOptimization,
  assemblyState,
  shouldRenderBridgeModal,
  loadingBridgeDialogLabel,
  isBridgeModalOpen,
  onCloseBridgeModal,
  onPreviewBridgeChange,
  onCreateBridge,
}: AppLayoutOverlaysProps) {
  return (
    <>
      {isCodeViewerOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingEditorLabel} />}>
          <SourceCodeEditor
            documents={sourceCodeDocuments}
            onClose={onCloseCodeViewer}
            theme={theme}
            lang={lang}
            autoApplyEnabled={autoApplyEnabled}
          />
        </Suspense>
      )}

      {isCollisionOptimizerOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingOptimizerLabel} />}>
          <CollisionOptimizationDialog
            source={collisionOptimizationSource}
            lang={lang}
            assets={assets}
            sourceFilePath={sourceFilePath}
            selection={selection}
            onClose={onCloseCollisionOptimizer}
            onSelectTarget={onSelectCollisionTarget}
            onApply={onApplyCollisionOptimization}
          />
        </Suspense>
      )}

      {assemblyState && shouldRenderBridgeModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingBridgeDialogLabel} />}>
          <BridgeCreateModal
            isOpen={isBridgeModalOpen}
            onClose={onCloseBridgeModal}
            onPreviewChange={onPreviewBridgeChange}
            onCreate={onCreateBridge}
            assemblyState={assemblyState}
            lang={lang}
          />
        </Suspense>
      )}
    </>
  );
}
