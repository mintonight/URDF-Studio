import React from 'react';

const loadViewerSceneConnectorModule = () => import('./ViewerSceneConnector');
const loadViewerPanelsModule = () => import('@/features/urdf-viewer/components/URDFViewerPanels');
const loadViewerJointsPanelModule = () => import('./URDFViewerJointsPanel');
const loadVisualizerSceneModule = () => import('@/features/visualizer/components/VisualizerScene');
const loadVisualizerPanelsModule = () =>
  import('@/features/visualizer/components/VisualizerPanels');

export const LazyViewerSceneConnector = React.lazy(async () => ({
  default: (await loadViewerSceneConnectorModule()).ViewerSceneConnector,
}));

export const LazyViewerPanels = React.lazy(async () => ({
  default: (await loadViewerPanelsModule()).URDFViewerPanels,
}));

export const LazyViewerJointsPanel = React.lazy(async () => ({
  default: (await loadViewerJointsPanelModule()).URDFViewerJointsPanel,
}));

export const LazyVisualizerScene = React.lazy(async () => ({
  default: (await loadVisualizerSceneModule()).VisualizerScene,
}));

export const LazyVisualizerPanels = React.lazy(async () => ({
  default: (await loadVisualizerPanelsModule()).VisualizerPanels,
}));

export async function preloadViewerModeModules(): Promise<void> {
  await Promise.all([
    loadViewerSceneConnectorModule(),
    loadViewerPanelsModule(),
    loadViewerJointsPanelModule(),
  ]);
}

export async function preloadVisualizerModeModules(): Promise<void> {
  await Promise.all([loadVisualizerSceneModule(), loadVisualizerPanelsModule()]);
}
