interface ViewerDocumentLifecycleCallbacks<TEvent, TRobot> {
  onDocumentLoadEvent?: (event: TEvent) => void;
  onRuntimeRobotLoaded?: (robot: TRobot) => void;
  onRuntimeSceneReadyForDisplay?: () => void;
}

export function resolveViewerDocumentLifecycleCallbacks<TEvent, TRobot>({
  shouldRenderAssembly,
  callbacks,
}: {
  shouldRenderAssembly: boolean;
  callbacks: ViewerDocumentLifecycleCallbacks<TEvent, TRobot>;
}): ViewerDocumentLifecycleCallbacks<TEvent, TRobot> {
  if (shouldRenderAssembly) {
    return {};
  }

  return callbacks;
}
