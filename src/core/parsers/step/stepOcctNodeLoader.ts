/**
 * Load bundled OpenCascade.js WASM inside Node unit tests.
 *
 * The dist glue is ESM (`export default`), but the Emscripten payload still
 * expects a Node/CommonJS environment. This helper strips the ESM export and
 * evaluates the glue under a CJS-compatible vm context.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createContext, Script } from 'node:vm';
import { fileURLToPath } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../node_modules/opencascade.js/dist',
);

let cached: Promise<any> | null = null;

export async function loadOcctForNode(): Promise<any> {
  if (!cached) {
    cached = (async () => {
      const wasmJsPath = path.join(DIST_DIR, 'opencascade.wasm.js');
      const wasmBinPath = path.join(DIST_DIR, 'opencascade.wasm.wasm');
      let src = readFileSync(wasmJsPath, 'utf8');
      src = src.replace(/export default opencascade;\s*$/, 'module.exports = opencascade;');

      const require = createRequire(import.meta.url);
      const module = { exports: {} as any };
      const sandbox: Record<string, unknown> = {
        module,
        exports: module.exports,
        require,
        __dirname: path.dirname(wasmJsPath),
        __filename: wasmJsPath,
        process,
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        WebAssembly,
        TextDecoder,
        TextEncoder,
        performance,
        atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      };
      const context = createContext(sandbox);
      new Script(src, { filename: wasmJsPath }).runInContext(context);
      const factory = module.exports as (opts: Record<string, unknown>) => Promise<any>;
      return factory({
        locateFile(name: string) {
          if (name.endsWith('.wasm')) return wasmBinPath;
          return name;
        },
      });
    })();
  }
  return cached;
}
