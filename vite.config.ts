import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const appPackageVersion =
  JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version ?? '0.0.0';

const threeRoot = path.resolve(__dirname, 'node_modules/three');
const threeModuleEntry = path.resolve(threeRoot, 'build/three.module.js');
const threeExamplesDir = path.resolve(threeRoot, 'examples/jsm');

function buildConfigurationFileIndex(rootDirs: string[]): Map<string, string> {
  const fileIndex = new Map<string, string>();

  const visitDirectory = (currentDir: string) => {
    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        visitDirectory(fullPath);
        return;
      }

      if (!entry.isFile()) return;
      if (!/\.(usd|usda|usdc)$/i.test(entry.name)) return;
      if (!fullPath.includes(`${path.sep}configuration${path.sep}`)) return;
      if (fileIndex.has(entry.name)) return;

      fileIndex.set(entry.name, fullPath);
    });
  };

  rootDirs.forEach((rootDir) => visitDirectory(rootDir));
  return fileIndex;
}

function resolveUsdConfigurationRootDirs(): string[] {
  const candidateDirs = [
    path.resolve(__dirname, 'public/unitree_model'),
    path.resolve(__dirname, 'public/Robots'),
  ];

  return candidateDirs.filter((dirPath) => fs.existsSync(dirPath));
}

function createUsdConfigurationProxyPlugin() {
  const configurationFileIndex = buildConfigurationFileIndex(resolveUsdConfigurationRootDirs());

  return {
    name: 'usd-configuration-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = String(request.url || '');
        const urlMatch = requestUrl.match(/^\/configuration\/([^/?#]+)$/);
        if (!urlMatch) {
          next();
          return;
        }

        const fileName = decodeURIComponent(urlMatch[1] || '');
        const filePath = configurationFileIndex.get(fileName);
        if (!filePath) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(filePath).pipe(response);
      });
    },
    generateBundle(this: import('rollup').PluginContext) {
      configurationFileIndex.forEach((filePath, fileName) => {
        this.emitFile({
          type: 'asset',
          fileName: `configuration/${fileName}`,
          source: fs.readFileSync(filePath),
        });
      });
    },
  };
}

function isMonacoReactChunkModule(normalizedId: string): boolean {
  return normalizedId.includes('/@monaco-editor/react/');
}

function isMonacoLanguageChunkModule(normalizedId: string): boolean {
  return (
    normalizedId.includes('/monaco-editor/esm/vs/basic-languages/') ||
    normalizedId.includes('/monaco-editor/esm/vs/language/')
  );
}

function isMonacoCoreChunkModule(normalizedId: string): boolean {
  return (
    normalizedId.includes('/monaco-editor/esm/') &&
    !isMonacoLanguageChunkModule(normalizedId) &&
    !isMonacoReactChunkModule(normalizedId) &&
    normalizedId.includes('/monaco-editor/esm/vs/')
  );
}

function isCodeEditorRuntimeChunkModule(normalizedId: string): boolean {
  return normalizedId.includes('/src/features/code-editor/utils/monacoLoader.ts');
}

const INITIAL_HTML_MODULE_PRELOAD_BLOCKLIST = [
  'feature-file-io-',
  'export-vendor-',
  'feature-editor-runtime-',
  'feature-urdf-viewer-runtime-',
  'ViewerSceneConnector-',
  'ViewerJointsPanel-',
];

function shouldSkipInitialHtmlModulePreload(dependency: string): boolean {
  return INITIAL_HTML_MODULE_PRELOAD_BLOCKLIST.some((token) => dependency.includes(token));
}

const GENERATED_ARTIFACT_WATCH_IGNORE_ROOTS = [
  path.resolve(__dirname, '.omx'),
  path.resolve(__dirname, 'tmp'),
  path.resolve(__dirname, '.tmp'),
  path.resolve(__dirname, 'output'),
  path.resolve(__dirname, 'dist'),
  path.resolve(__dirname, 'log'),
  path.resolve(__dirname, 'test'),
].map((entryPath) => entryPath.replace(/\\/g, '/'));

const GENERATED_ARTIFACT_WATCH_IGNORE_SEGMENTS = ['/.git/', '/.svn/', '/.hg/'];
const ISOLATED_DOCUMENT_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
} as const;

// Vite crawls HTML entrypoints to discover dependency optimizer inputs.
// This repository intentionally keeps many fixture/example HTML files under
// tmp/, .tmp/, and test/, so constrain discovery to the actual app entry.
const OPTIMIZE_DEPS_ENTRY_FILES = ['index.html', 'handoff.html'];

const OPTIMIZE_DEPS_INCLUDE = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'zustand/react/shallow',
  'lucide-react',
  'zustand',
  '@monaco-editor/react',
  'jszip',
  'zustand/middleware/immer',
  'zustand/middleware',
  'immer',
  'three/examples/jsm/loaders/GLTFLoader.js',
  'three/examples/jsm/utils/SkeletonUtils.js',
  'three/examples/jsm/loaders/VTKLoader.js',
  'three/examples/jsm/loaders/STLLoader.js',
  'three/examples/jsm/geometries/ConvexGeometry.js',
  'three/examples/jsm/loaders/ColladaLoader.js',
  'three/examples/jsm/loaders/OBJLoader.js',
  'three/addons/exporters/OBJExporter.js',
  'three/examples/jsm/environments/RoomEnvironment.js',
  'three-stdlib',
  'linkedom',
  'html2canvas',
  'jspdf',
  'three/examples/jsm/postprocessing/EffectComposer.js',
  'three/examples/jsm/postprocessing/RenderPass.js',
  'three/examples/jsm/postprocessing/BokehPass.js',
  'three/addons/loaders/GLTFLoader.js',
];

function shouldIgnoreWatchPath(watchPath: string): boolean {
  const normalizedPath = watchPath.replace(/\\/g, '/');

  return (
    GENERATED_ARTIFACT_WATCH_IGNORE_ROOTS.some(
      (rootPath) => normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`),
    ) ||
    GENERATED_ARTIFACT_WATCH_IGNORE_SEGMENTS.some((segment) => normalizedPath.includes(segment))
  );
}

function shouldApplyIsolatedDocumentHeaders(requestUrl: string): boolean {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  return pathname !== '/handoff.html';
}

function applyIsolatedDocumentHeaders(response: import('node:http').ServerResponse): void {
  Object.entries(ISOLATED_DOCUMENT_HEADERS).forEach(([headerName, headerValue]) => {
    response.setHeader(headerName, headerValue);
  });
}

function createConditionalIsolationHeadersPlugin() {
  const installHeaderMiddleware = (middlewareStack: {
    use: (handler: (req: any, res: any, next: () => void) => void) => void;
  }): void => {
    middlewareStack.use((request, response, next) => {
      if (shouldApplyIsolatedDocumentHeaders(String(request.url || '/'))) {
        applyIsolatedDocumentHeaders(response);
      }
      next();
    });
  };

  return {
    name: 'conditional-isolation-headers',
    configureServer(server: import('vite').ViteDevServer) {
      installHeaderMiddleware(server.middlewares);
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      installHeaderMiddleware(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      strictPort: false,
      host: '127.0.0.1',
      // Verification artifacts are intentionally written into tmp/ by repo policy.
      // Ignore generated directories so exports, screenshots, logs, and pid files
      // do not trigger full-page reloads and wipe imported workspace state.
      // Root-level test fixtures contain vendored repositories large enough to
      // exhaust OS watcher limits, so filter them explicitly by absolute path.
      watch: {
        ignored: shouldIgnoreWatchPath,
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      modulePreload: {
        resolveDependencies(_filename, deps, context) {
          if (context.hostType !== 'html') {
            return deps;
          }

          return deps.filter((dependency) => !shouldSkipInitialHtmlModulePreload(dependency));
        },
      },
      rollupOptions: {
        input: [path.resolve(__dirname, 'index.html'), path.resolve(__dirname, 'handoff.html')],
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');

            if (normalizedId.includes('/src/features/property-editor/')) {
              return 'feature-property-editor';
            }

            if (isCodeEditorRuntimeChunkModule(normalizedId)) {
              return 'feature-code-editor-runtime';
            }

            if (normalizedId.includes('/src/features/code-editor/')) {
              return 'feature-code-editor';
            }

            if (normalizedId.includes('/src/features/ai-assistant/')) {
              return 'feature-ai-assistant';
            }

            if (normalizedId.includes('/src/features/file-io/')) {
              return 'feature-file-io';
            }

            if (normalizedId.includes('/src/features/assembly/')) {
              return 'feature-assembly';
            }

            if (normalizedId.includes('/src/features/robot-tree/')) {
              return 'feature-robot-tree';
            }

            if (normalizedId.includes('/src/core/parsers/')) {
              return 'core-parsers';
            }

            if (!normalizedId.includes('/node_modules/')) return;

            if (normalizedId.includes('/@react-three/drei/')) {
              return 'drei-vendor';
            }

            if (normalizedId.includes('/@react-three/fiber/')) {
              return 'r3f-vendor';
            }

            if (
              normalizedId.includes('/three/examples/') ||
              normalizedId.includes('/three-stdlib/')
            ) {
              return 'three-addons';
            }

            if (normalizedId.includes('/three/')) {
              return 'three-core';
            }

            if (isMonacoReactChunkModule(normalizedId)) {
              return 'editor-monaco-react';
            }

            if (isMonacoLanguageChunkModule(normalizedId)) {
              return 'editor-monaco-language';
            }

            if (isMonacoCoreChunkModule(normalizedId)) {
              return 'editor-monaco-core';
            }

            if (
              normalizedId.includes('/react-syntax-highlighter/') ||
              normalizedId.includes('/react-simple-code-editor/') ||
              normalizedId.includes('/prismjs/')
            ) {
              return 'code-vendor';
            }

            if (normalizedId.includes('/jspdf/') || normalizedId.includes('/jszip/')) {
              return 'export-vendor';
            }

            if (normalizedId.includes('/lucide-react/')) {
              return 'icon-vendor';
            }

            if (normalizedId.includes('/zustand/') || normalizedId.includes('/immer/')) {
              return 'state-vendor';
            }

            if (
              normalizedId.includes('/react/') ||
              normalizedId.includes('/react-dom/') ||
              normalizedId.includes('/scheduler/')
            ) {
              return 'react-vendor';
            }
          },
        },
      },
    },
    worker: {
      format: 'es',
    },
    plugins: [
      react(),
      tailwindcss(),
      createUsdConfigurationProxyPlugin(),
      createConditionalIsolationHeadersPlugin(),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appPackageVersion),
      'process.env.API_KEY': JSON.stringify(env.OPENAI_API_KEY || env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.OPENAI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.OPENAI_BASE_URL': JSON.stringify(env.OPENAI_BASE_URL),
      'process.env.OPENAI_MODEL': JSON.stringify(env.OPENAI_MODEL),
    },
    optimizeDeps: {
      entries: OPTIMIZE_DEPS_ENTRY_FILES,
      // Keep the dependency optimizer on the same Three.js entry that the
      // application source and R3F use, otherwise optimized deps can pull in
      // a second copy from a different workspace path.
      include: OPTIMIZE_DEPS_INCLUDE,
    },
    resolve: {
      dedupe: ['three', '@react-three/fiber', '@react-three/drei'],
      alias: [
        {
          find: '@',
          replacement: path.resolve(__dirname, './src'),
        },
        {
          find: /^three$/,
          replacement: threeModuleEntry,
        },
        {
          find: /^three\/addons\//,
          replacement: `${threeExamplesDir}/`,
        },
        {
          find: /^three\/examples\/jsm\//,
          replacement: `${threeExamplesDir}/`,
        },
      ],
    },
  };
});
