let sourceCodeEditorModulePromise: Promise<typeof import('@/features/code-editor')> | null = null;
let sourceCodeEditorRuntimePromise: Promise<
  [typeof import('@monaco-editor/react'), typeof import('@/features/code-editor')]
> | null = null;

export const loadSourceCodeEditorModule = () => {
  if (!sourceCodeEditorModulePromise) {
    sourceCodeEditorModulePromise = import('@/features/code-editor');
  }

  return sourceCodeEditorModulePromise;
};

export const loadSourceCodeEditorRuntime = () => {
  if (!sourceCodeEditorRuntimePromise) {
    sourceCodeEditorRuntimePromise = Promise.all([
      import('@monaco-editor/react'),
      import('@/features/code-editor'),
    ]);
  }

  return sourceCodeEditorRuntimePromise;
};

export const preloadSourceCodeEditor = () => loadSourceCodeEditorModule();

export const preloadSourceCodeEditorRuntime = async () => {
  await loadSourceCodeEditorRuntime();
};
