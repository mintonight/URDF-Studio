import { lazy } from 'react';

export const loadAIInspectionConnectorModule = () => import('./ai/AIInspectionConnector');
export const loadAIConversationConnectorModule = () => import('./ai/AIConversationConnector');
export const loadExportDialogConnectorModule = () => import('./export/ExportDialogConnector');
export const loadDisconnectedWorkspaceUrdfExportDialogModule = () =>
  import('@/features/file-io');
export const loadExportProgressDialogModule = () => import('@/features/file-io');
export const loadSettingsModalModule = () => import('./SettingsModal');

export const AIInspectionConnector = lazy(() =>
  loadAIInspectionConnectorModule().then((module) => ({
    default: module.AIInspectionConnector,
  })),
);

export const AIConversationConnector = lazy(() =>
  loadAIConversationConnectorModule().then((module) => ({
    default: module.AIConversationConnector,
  })),
);

export const DisconnectedWorkspaceUrdfExportDialog = lazy(() =>
  loadDisconnectedWorkspaceUrdfExportDialogModule().then((module) => ({
    default: module.DisconnectedWorkspaceUrdfExportDialog,
  })),
);

export const ExportProgressDialog = lazy(() =>
  loadExportProgressDialogModule().then((module) => ({
    default: module.ExportProgressDialog,
  })),
);

export const ExportDialogConnector = lazy(() =>
  loadExportDialogConnectorModule().then((module) => ({
    default: module.ExportDialogConnector,
  })),
);

export const SettingsModal = lazy(() =>
  loadSettingsModalModule().then((module) => ({ default: module.SettingsModal })),
);
