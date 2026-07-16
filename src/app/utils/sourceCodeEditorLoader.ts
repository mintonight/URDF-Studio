import { preloadMonacoEditorWorker } from '@/features/code-editor';

/**
 * Monaco is part of the application's static module graph. This warmup only
 * initializes the already-loaded runtime; it must never fetch a feature entry.
 */
export const preloadSourceCodeEditorRuntime = preloadMonacoEditorWorker;
