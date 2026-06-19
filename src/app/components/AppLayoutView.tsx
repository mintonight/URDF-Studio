import { AppLayoutViewContent } from './app_layout_view_sections';
import type { AppLayoutViewProps } from './app_layout_view_types';

export function AppLayoutView(props: AppLayoutViewProps) {
  const hasDisplayableViewerRobot = Object.keys(props.viewerRobot.links ?? {}).length > 1;
  const shouldSuppressDocumentLoadingOverlay =
    props.shouldRenderAssembly ||
    Boolean(props.assemblyComponentPreparationOverlay) ||
    (hasDisplayableViewerRobot &&
      props.documentLoadState.status === 'loading' &&
      props.documentLoadState.fileName === props.selectedFile?.name);

  return (
    <AppLayoutViewContent
      {...props}
      shouldSuppressDocumentLoadingOverlay={shouldSuppressDocumentLoadingOverlay}
    />
  );
}
