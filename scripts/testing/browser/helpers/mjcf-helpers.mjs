#!/usr/bin/env node

/**
 * Shared helpers for MuJoCo menagerie browser tests.
 * Wraps e2e browser-helpers with MJCF-specific import convenience.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import {
  ensureDir, collectFiles,
} from '../../../e2e/helpers/browser-helpers.mjs';

// Re-export all format-agnostic helpers
export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
  createSession, waitForReady, getTopology, getAssemblyState, getRuntimeTransforms,
  store, writeReport,
} from './base-helpers.mjs';

const MENAGERIE = path.resolve('test/mujoco_menagerie-main');

// ── Import ───────────────────────────────────────────────────────────

async function zipDir(dir) {
  const zip = new JSZip();
  for (const f of await collectFiles(dir)) zip.file(path.relative(dir, f), await fs.readFile(f));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

export async function importModel(page, modelDir, fileName, timeoutMs = 60_000) {
  const dir = path.isAbsolute(modelDir) ? modelDir : path.join(MENAGERIE, modelDir);
  const zip = await zipDir(dir);
  const tmp = path.resolve(`tmp/regression/_${Date.now()}.zip`);
  await ensureDir(path.dirname(tmp));
  await fs.writeFile(tmp, zip);
  const input = await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
  await input.uploadFile(tmp);
  await page.waitForFunction(
    (fn) => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.selectedFile?.name === fn,
    { timeout: timeoutMs }, fileName,
  );
  try { await fs.unlink(tmp); } catch {}
}
