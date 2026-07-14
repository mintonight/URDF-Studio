import React, { lazy, Suspense } from 'react';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { SourceCodeEditorErrorBoundary } from './SourceCodeEditorErrorBoundary';
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
import { SourceCodeEditor, type SourceCodeEditorDocument } from '@/features/code-editor';

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
  isCollisionOptimizerOpen: boolean;
  loadingOptimizerLabel: string;
  collisionOptimizationSource: CollisionOptimizationSource;
  assets: Record<string, string>;
  sourceFilePath?: string;
  selection: InteractionSelection;
  onCloseCollisionOptimizer: () => void;
  onSelectCollisionTarget: (target: CollisionTargetRef) => void;
  onApplyCollisionOptimization: (
    operations: CollisionOptimizationOperation[],
  ) => void | Promise<void>;
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
        <SourceCodeEditorErrorBoundary lang={lang} onClose={onCloseCodeViewer}>
          <SourceCodeEditor
            documents={sourceCodeDocuments}
            onClose={onCloseCodeViewer}
            theme={theme}
            lang={lang}
            autoApplyEnabled={autoApplyEnabled}
          />
        </SourceCodeEditorErrorBoundary>
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
            lang={lang}
          />
        </Suspense>
      )}
    </>
  );
}
