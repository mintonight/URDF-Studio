import type React from 'react';
import type { CSSProperties } from 'react';
import type { RootState } from '@react-three/fiber';

import type { AppLayoutOverlays } from './AppLayoutOverlays';
import type { Header } from './Header';
import type { IkToolPanel } from './IkToolPanel';
import type { ImportPreparationOverlay } from './ImportPreparationOverlay';
import type { WorkspaceSidebars } from './workspace/WorkspaceSidebars';
import type { WorkspaceViewerLayer } from './workspace/WorkspaceViewerLayer';
import type { SnapshotPreviewSession } from './snapshot-preview/types';
import type { AppLayoutProps } from '../appLayoutTypes';
import type { ToolMode } from '@/features/editor';
import type {
  SnapshotCaptureAction,
  SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { Language, TranslationKeys } from '@/shared/i18n';
import type { RobotFile } from '@/types';

type HeaderProps = React.ComponentProps<typeof Header>;
type IkToolPanelProps = React.ComponentProps<typeof IkToolPanel>;
type ImportPreparationOverlayProps = React.ComponentProps<typeof ImportPreparationOverlay>;
type WorkspaceViewerLayerProps = React.ComponentProps<typeof WorkspaceViewerLayer>;
type ViewerProps = WorkspaceViewerLayerProps['viewerProps'];
type WorkspaceSidebarsProps = React.ComponentProps<typeof WorkspaceSidebars>;
type TreeEditorProps = WorkspaceSidebarsProps['treeEditorProps'];
type FilePreviewWindowProps = WorkspaceSidebarsProps['filePreviewWindowProps'];
type PropertyEditorProps = WorkspaceSidebarsProps['propertyEditorProps'];
type AppLayoutOverlaysProps = React.ComponentProps<typeof AppLayoutOverlays>;

interface WorkspaceLayoutClassNames {
  root: string;
  viewerLayer: string;
  leftSidebarLayer: string;
  rightSidebarLayer: string;
}

interface PropertyEditorSelectionContextView {
  robot: PropertyEditorProps['robot'];
  selectedClosedLoopBridge: unknown;
}

interface AppLayoutDragHandlers {
  onDragEnter: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
}

export interface AppLayoutViewProps {
  importInputRef: AppLayoutProps['importInputRef'];
  importFolderInputRef: AppLayoutProps['importFolderInputRef'];
  onOpenExport: AppLayoutProps['onOpenExport'];
  onExportProject: AppLayoutProps['onExportProject'];
  onOpenSettings: AppLayoutProps['onOpenSettings'];
  headerQuickAction: AppLayoutProps['headerQuickAction'];
  headerSecondaryAction: AppLayoutProps['headerSecondaryAction'];
  viewConfig: AppLayoutProps['viewConfig'];
  setViewConfig: AppLayoutProps['setViewConfig'];
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: AppLayoutProps['setIsCodeViewerOpen'];
  dragHandlers: AppLayoutDragHandlers;
  isFileDragActive: boolean;
  t: TranslationKeys;
  lang: Language;
  theme: ViewerProps['theme'];
  toolboxItems: HeaderProps['toolboxItems'];
  handleOpenCodeViewer: HeaderProps['onOpenCodeViewer'];
  handlePrefetchCodeViewer: HeaderProps['onPrefetchCodeViewer'];
  handleSnapshot: HeaderProps['onSnapshot'];
  isIkToolPanelOpen: boolean;
  ikLinkOptions: IkToolPanelProps['linkOptions'];
  selectedIkLinkId: IkToolPanelProps['selectedLinkId'];
  selectedIkLinkLabel: IkToolPanelProps['selectedLinkLabel'];
  currentIkLinkLabel: IkToolPanelProps['currentLinkLabel'];
  ikToolSelectionStatus: IkToolPanelProps['selectionStatus'];
  onSelectIkLink: IkToolPanelProps['onSelectLink'];
  onIkToolClose: () => void;
  workspaceLayoutClassNames: WorkspaceLayoutClassNames;
  workspaceOverlaySafeAreaStyle: CSSProperties | undefined;
  workspaceOverlayGizmoMargin: ViewerProps['gizmoMargin'];
  viewerRobot: ViewerProps['robot'];
  editorRobot: ViewerProps['editorRobot'];
  mergedAppMode: ViewerProps['mode'];
  handleViewerSelectWithBridgePreview: ViewerProps['onSelect'];
  handleViewerMeshSelectWithAssemblyClear: ViewerProps['onMeshSelect'];
  handleHover: ViewerProps['onHover'] & PropertyEditorProps['onHover'];
  handleUpdate: ViewerProps['onUpdate'] & TreeEditorProps['onUpdate'] & PropertyEditorProps['onUpdate'];
  viewerAssets: ViewerProps['assets'];
  allFileContents: ViewerProps['allFileContents'];
  showVisual: TreeEditorProps['showVisual'];
  handleSetShowVisual: TreeEditorProps['setShowVisual'];
  handleSetDetailOptionsPanelVisibility: ViewerProps['setShowOptionsPanel'];
  snapshotActionRef: React.RefObject<SnapshotCaptureAction | null>;
  viewerCanvasStateRef: React.MutableRefObject<RootState | null>;
  availableFiles: ViewerProps['availableFiles'];
  urdfContentForViewer: ViewerProps['urdfContent'];
  viewerSourceFormat: ViewerProps['viewerSourceFormat'];
  viewerSourceFilePath: ViewerProps['sourceFilePath'];
  viewerSourceFile: ViewerProps['sourceFile'];
  viewerDocumentLifecycleCallbacks: Pick<
    ViewerProps,
    'onDocumentLoadEvent' | 'onRuntimeRobotLoaded' | 'onRuntimeSceneReadyForDisplay'
  >;
  jointAngleState: ViewerProps['jointAngleState'];
  jointMotionState: ViewerProps['jointMotionState'];
  handleJointChange: ViewerProps['onJointChange'];
  selection: AppLayoutOverlaysProps['selection'];
  focusTarget: ViewerProps['focusTarget'];
  selectedFile: RobotFile | null;
  handleWorkspaceTransformPendingChange: ViewerProps['onTransformPendingChange'];
  handleCollisionTransformPreview: ViewerProps['onCollisionTransformPreview'];
  handleCollisionTransform: ViewerProps['onCollisionTransform'];
  normalizedAssemblyState: AppLayoutOverlaysProps['assemblyState'];
  shouldRenderAssembly: boolean;
  assemblySelection: ViewerProps['assemblySelection'];
  sourceSceneAssemblyComponentId: ViewerProps['sourceSceneAssemblyComponentId'];
  handleAssemblyTransform: ViewerProps['onAssemblyTransform'];
  handleComponentTransform: ViewerProps['onComponentTransform'];
  handleBridgeTransform: ViewerProps['onBridgeTransform'];
  ikDragActive: ViewerProps['ikDragActive'];
  pendingViewerToolMode: ToolMode | null;
  setPendingViewerToolMode: React.Dispatch<React.SetStateAction<ToolMode | null>>;
  viewerReloadKey: ViewerProps['viewerReloadKey'];
  documentLoadLifecycleState: ViewerProps['documentLoadState'];
  documentLoadState: FilePreviewWindowProps['documentLoadState'];
  importPreparationOverlay: WorkspaceViewerLayerProps['importPreparationOverlay'];
  assemblyComponentPreparationOverlay: ImportPreparationOverlayProps | null;
  previewContextRobot: TreeEditorProps['robot'];
  handleSelectWithAssemblyClear: TreeEditorProps['onSelect'] & PropertyEditorProps['onSelect'];
  handleSelectGeometryWithAssemblyClear: TreeEditorProps['onSelectGeometry'] &
    PropertyEditorProps['onSelectGeometry'];
  handleFocus: TreeEditorProps['onFocus'];
  handleAddChild: TreeEditorProps['onAddChild'];
  handleAddCollisionBody: TreeEditorProps['onAddCollisionBody'];
  handleDelete: TreeEditorProps['onDelete'];
  handleNameChange: TreeEditorProps['onNameChange'];
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  handlePreviewFileWithFeedback: TreeEditorProps['onLoadRobot'];
  handleRequestLoadRobot: TreeEditorProps['onRequestLoadRobot'];
  handleAddComponent: TreeEditorProps['onAddComponent'];
  handleDeleteLibraryFile: TreeEditorProps['onDeleteLibraryFile'];
  handleDeleteLibraryFolder: TreeEditorProps['onDeleteLibraryFolder'];
  handleRenameLibraryFolder: TreeEditorProps['onRenameLibraryFolder'];
  handleDeleteAllLibraryFiles: TreeEditorProps['onDeleteAllLibraryFiles'];
  handleExportLibraryFile: TreeEditorProps['onExportLibraryFile'];
  handleCreateBridge: TreeEditorProps['onCreateBridge'];
  removeComponent: TreeEditorProps['onRemoveComponent'];
  removeBridge: TreeEditorProps['onRemoveBridge'];
  handleRenameComponent: TreeEditorProps['onRenameComponent'];
  handleSwitchTreeEditorToProMode: TreeEditorProps['onSwitchToProMode'];
  handleRequestSwitchTreeEditorToStructure: TreeEditorProps['onRequestSwitchToStructure'];
  isPreviewingWorkspaceSource: boolean;
  handleJointPreview: TreeEditorProps['onJointAnglePreview'];
  previewFile: FilePreviewWindowProps['file'];
  previewRobot: FilePreviewWindowProps['previewRobot'];
  filePreview: FilePreviewWindowProps['previewState'];
  handleClosePreview: FilePreviewWindowProps['onClose'];
  propertyEditorSelectionContext: PropertyEditorSelectionContextView;
  handleUploadAsset: PropertyEditorProps['onUploadAsset'];
  motorLibrary: PropertyEditorProps['motorLibrary'];
  sourceCodeEditorDocuments: AppLayoutOverlaysProps['sourceCodeDocuments'];
  sourceCodeAutoApply: AppLayoutOverlaysProps['autoApplyEnabled'];
  isCollisionOptimizerOpen: boolean;
  setIsCollisionOptimizerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collisionOptimizationSource: AppLayoutOverlaysProps['collisionOptimizationSource'];
  handlePreviewCollisionOptimizationTarget: AppLayoutOverlaysProps['onSelectCollisionTarget'];
  handleApplyCollisionOptimization: AppLayoutOverlaysProps['onApplyCollisionOptimization'];
  shouldRenderBridgeModal: AppLayoutOverlaysProps['shouldRenderBridgeModal'];
  isBridgeModalOpen: AppLayoutOverlaysProps['isBridgeModalOpen'];
  handleCloseBridgeModal: AppLayoutOverlaysProps['onCloseBridgeModal'];
  handleCreateBridgeCommit: AppLayoutOverlaysProps['onCreateBridge'];
  handleBridgePreviewChange: AppLayoutOverlaysProps['onPreviewBridgeChange'];
  isSnapshotDialogOpen: boolean;
  isSnapshotCapturing: boolean;
  snapshotPreviewSession: SnapshotPreviewSession | null;
  handleSnapshotPreviewCaptureActionChange: (action: SnapshotCaptureAction | null) => void;
  handleCloseSnapshotDialog: () => void;
  handleCaptureSnapshot: (options: SnapshotCaptureOptions) => Promise<void>;
}
