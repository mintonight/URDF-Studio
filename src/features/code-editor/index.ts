/**
 * Code Editor Feature Module
 * Provides URDF/XML code editing and viewing capabilities
 */

// Components
export { SourceCodeEditor } from './components/SourceCodeEditor';

// Types
export type { SourceCodeDocumentFlavor, SourceCodeEditorLanguageId } from './types';
export type { SourceCodeEditorProps } from './components/SourceCodeEditor';

// App-facing runtime helpers
export { preloadMonacoEditor, preloadMonacoEditorWorker } from './utils/monacoLoader';
