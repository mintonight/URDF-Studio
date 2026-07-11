/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Monaco ships its ESM internals without per-entry type declarations. The source
// editor intentionally imports the trimmed `edcore.main` entry (see
// src/features/code-editor/utils/monacoLoader.ts) to drop the unused language
// services. Alias its types to the package's public API surface; the imported
// namespace is only handed to `loader.config({ monaco })`, never dot-accessed
// for the language-service members edcore.main omits at runtime.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor';
}

// opencascade.js ships only JS (no type declarations). The WASM kernel is a
// large auto-generated surface accessed through the `oc` handle; callers use
// `any`-typed local bindings in the STEP worker.
declare module 'opencascade.js' {
  const initOpenCascade: () => Promise<unknown>;
  export { initOpenCascade };
}
declare module 'opencascade.js/dist/opencascade.wasm.js' {
  const factory: (config: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}
declare module 'opencascade.js/dist/opencascade.wasm.wasm?url' {
  const url: string;
  export default url;
}
