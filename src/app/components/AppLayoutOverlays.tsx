import React, { lazy, Suspense } from 'react';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { loadSourceCodeEditorModule } from '@/app/utils/sourceCodeEditorLoader';
import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from '@/app/utils/overlayLoaders';
import {
  isSourceCodeDocumentReadOnly,
  type SourceCodeDocumentFlavor,
} from '@/app/utils/sourceCodeDisplay';
import type { Language } from '@/shared/i18n';
import type { BridgeJoint, InteractionSelection, Theme, UrdfJoint } from '@/types';
import type { AssemblyState } from '@/types';
import type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '@/features/property-editor';

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
  sourceCodeContent: string;
  sourceCodeDocumentFlavor: SourceCodeDocumentFlavor;
  forceSourceCodeReadOnly?: boolean;
  autoApplyEnabled?: boolean;
  onCodeChange: (newCode: string) => Promise<boolean> | boolean;
  onSourceCodeDownload?: () => void;
  onCloseCodeViewer: () => void;
  theme: Theme;
  selectedFileName?: string;
  robotName: string;
  lang: Language;
  loadingEditorLabel: string;
  isCollisionOptimizerOpen: boolean;
  loadingOptimizerLabel: string;
  collisionOptimizationSource: CollisionOptimizationSource;
  assets: Record<string, string>;
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
  sourceCodeContent,
  sourceCodeDocumentFlavor,
  forceSourceCodeReadOnly = false,
  autoApplyEnabled = true,
  onCodeChange,
  onSourceCodeDownload,
  onCloseCodeViewer,
  theme,
  selectedFileName,
  robotName,
  lang,
  loadingEditorLabel,
  isCollisionOptimizerOpen,
  loadingOptimizerLabel,
  collisionOptimizationSource,
  assets,
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
  const codeEditorFileName = selectedFileName
    ? selectedFileName.split('/').pop() || `${robotName}.urdf`
    : `${robotName}.urdf`;
  const isSourceCodeReadOnly =
    forceSourceCodeReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor);
  return (
    <>
      {isCodeViewerOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingEditorLabel} />}>
          <SourceCodeEditor
            code={sourceCodeContent}
            onCodeChange={onCodeChange}
            onClose={onCloseCodeViewer}
            theme={theme}
            fileName={codeEditorFileName}
            lang={lang}
            documentFlavor={sourceCodeDocumentFlavor}
            readOnly={isSourceCodeReadOnly}
            autoApplyEnabled={autoApplyEnabled}
            onDownload={isSourceCodeReadOnly ? undefined : onSourceCodeDownload}
          />
        </Suspense>
      )}

      {isCollisionOptimizerOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingOptimizerLabel} />}>
          <CollisionOptimizationDialog
            source={collisionOptimizationSource}
            lang={lang}
            assets={assets}
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
