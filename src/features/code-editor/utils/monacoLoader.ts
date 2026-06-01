import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type * as Monaco from 'monaco-editor';

type MonacoEnvironmentGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker?: (_workerId: string, label: string) => Worker;
  };
};

const monacoGlobal = globalThis as MonacoEnvironmentGlobal;
monacoGlobal.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') {
      return new JsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new CssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

export type MonacoInstance = typeof Monaco;

let monacoLoaderPromise: Promise<MonacoInstance> | null = null;
let monacoWorkerWarmupPromise: Promise<void> | null = null;

const ensureXmlDerivedLanguage = (
  monacoInstance: MonacoInstance,
  _id: string,
  _aliases: string[],
) => {
  // CDN runtime uses Monaco's built-in XML language directly.
  // URDF/Xacro behavior is provided via editor-side completion/validation logic.
  void monacoInstance;
};

export const ensureSourceCodeEditorLanguages = (
  monacoInstance: MonacoInstance,
): MonacoInstance => {
  ensureXmlDerivedLanguage(monacoInstance, 'urdf', ['URDF']);
  ensureXmlDerivedLanguage(monacoInstance, 'xacro', ['Xacro']);
  return monacoInstance;
};

export const preloadMonacoEditor = (): Promise<MonacoInstance> => {
  if (!monacoLoaderPromise) {
    monacoLoaderPromise = loader.init()
      .then((monacoInstance) => ensureSourceCodeEditorLanguages(monacoInstance))
      .catch((error) => {
        monacoLoaderPromise = null;
        throw error;
      });
  }

  return monacoLoaderPromise;
};

export const preloadMonacoEditorWorker = (): Promise<void> => {
  if (!monacoWorkerWarmupPromise) {
    monacoWorkerWarmupPromise = preloadMonacoEditor().then(() => undefined).catch((error) => {
      monacoWorkerWarmupPromise = null;
      throw error;
    });
  }

  return monacoWorkerWarmupPromise;
};
