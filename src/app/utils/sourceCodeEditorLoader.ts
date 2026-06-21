let sourceCodeEditorModulePromise: Promise<typeof import('@/features/code-editor')> | null = null;
let sourceCodeEditorRuntimePromise: Promise<
  [typeof import('@monaco-editor/react'), typeof import('@/features/code-editor')]
> | null = null;

export const loadSourceCodeEditorModule = () => {
  if (!sourceCodeEditorModulePromise) {
    // Reset the cache on failure so a transient chunk/network error during an
    // idle prewarm does not poison a later user-initiated open with the same
    // rejected promise (mirrors monacoLoader's loader.init reset).
    sourceCodeEditorModulePromise = import('@/features/code-editor').catch((error) => {
      sourceCodeEditorModulePromise = null;
      throw error;
    });
  }

  return sourceCodeEditorModulePromise;
};

export const loadSourceCodeEditorRuntime = () => {
  if (!sourceCodeEditorRuntimePromise) {
    sourceCodeEditorRuntimePromise = Promise.all([
      import('@monaco-editor/react'),
      import('@/features/code-editor'),
    ]).catch((error) => {
      sourceCodeEditorRuntimePromise = null;
      throw error;
    });
  }

  return sourceCodeEditorRuntimePromise;
};

export const preloadSourceCodeEditor = () => loadSourceCodeEditorModule();

export const preloadSourceCodeEditorRuntime = async () => {
  await loadSourceCodeEditorRuntime();
};
