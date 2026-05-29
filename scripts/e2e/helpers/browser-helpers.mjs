#!/usr/bin/env node

/**
 * Format-agnostic browser/e2e infrastructure for URDF Studio regression tests.
 *
 * Responsibilities:
 *   - Site lifecycle: reuse a running dev/preview server or auto-start one.
 *   - Browser lifecycle: launch Puppeteer + open an instrumented page.
 *   - File upload: single file or whole directory into the app's <input type=file>.
 *   - Small fs utilities: ensureDir / writeJsonAtomic / collectFiles.
 *
 * This module is the shared foundation imported by
 * scripts/testing/browser/helpers/*.mjs (base/urdf/mjcf/sdf/usd/xacro).
 *
 * Implementations are consolidated from the self-contained committed regression
 * scripts (run_menagerie_browser_regression.mjs, run_unitree_browser_regression.mjs,
 * run_shadow_hand_hover_regression.mjs) so behaviour matches the existing harness.
 *
 * The app only exposes window.__URDF_STUDIO_DEBUG__ when the URL carries
 * ?regressionDebug=1 (see CLAUDE.md). createSession() in base-helpers.mjs appends
 * that flag; the helpers here also tolerate its absence by waiting for the API.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_SITE_URL = 'http://127.0.0.1:4173';
export const DEFAULT_SITE_TIMEOUT_MS = 120_000;
export const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;

const DEFAULT_START_COMMAND = (host, port) => `npm run dev -- --host ${host} --port ${port}`;
const DEFAULT_EXECUTABLE_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function fail(message) {
  throw new Error(message);
}

// ── fs utilities ─────────────────────────────────────────────────────

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Atomic JSON write (temp file + rename) so partial reports never appear. */
export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

/** Recursively list files under rootDir, sorted deterministically. */
export async function collectFiles(rootDir) {
  const entries = [];
  async function visit(currentDir) {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (dirent.isFile()) entries.push(fullPath);
    }
  }
  await visit(rootDir);
  return entries;
}

// ── Site lifecycle ───────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store' });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isSiteReachable(siteUrl, timeoutMs) {
  try {
    const response = await fetchWithTimeout(siteUrl, Math.min(timeoutMs, 10_000));
    return response.ok;
  } catch {
    return false;
  }
}

function createLogBuffer(limit = 200) {
  const lines = [];
  return {
    push(line) {
      if (typeof line !== 'string' || line.length === 0) return;
      lines.push(line);
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    toString() {
      return lines.join('\n');
    },
  };
}

function spawnSiteProcess(command, cwd) {
  const logs = createLogBuffer();
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk).trimEnd()));

  return {
    child,
    logs,
    async stop() {
      if (child.exitCode != null || child.signalCode != null) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        return;
      }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (child.exitCode != null || child.signalCode != null) return;
        await delay(100);
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Reuse a reachable site, or auto-start one with the dev/preview command.
 * @param {string} siteUrl
 * @param {{ siteTimeoutMs?: number, timeoutMs?: number, noStart?: boolean, headed?: boolean, startCommand?: string|null }} [options]
 * @returns {Promise<{ startedByScript: boolean, siteUrl: string, stop: () => Promise<void> }>}
 */
export async function ensureSite(siteUrl, options = {}) {
  const siteTimeoutMs = options.siteTimeoutMs ?? DEFAULT_SITE_TIMEOUT_MS;

  if (await isSiteReachable(siteUrl, siteTimeoutMs)) {
    return { startedByScript: false, siteUrl, stop: async () => {} };
  }

  if (options.noStart) {
    fail(`Site is not reachable at ${siteUrl} and noStart was set.`);
  }

  const parsedUrl = new URL(siteUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  const command = options.startCommand ?? DEFAULT_START_COMMAND(host, port);
  const siteProcess = spawnSiteProcess(command, process.cwd());
  const deadline = Date.now() + siteTimeoutMs;

  try {
    while (Date.now() < deadline) {
      if (await isSiteReachable(siteUrl, 5_000)) {
        return { startedByScript: true, siteUrl, stop: siteProcess.stop };
      }
      if (siteProcess.child.exitCode != null) {
        fail(
          `Site start command exited early: ${command}\n` +
            `Last logs:\n${siteProcess.logs.toString() || '(no logs captured)'}`,
        );
      }
      await delay(500);
    }
    fail(
      `Timed out waiting for site ${siteUrl} after starting: ${command}\n` +
        `Last logs:\n${siteProcess.logs.toString() || '(no logs captured)'}`,
    );
  } catch (error) {
    await siteProcess.stop();
    throw error;
  }
  // Unreachable, but keeps the type checker honest.
  return { startedByScript: true, siteUrl, stop: siteProcess.stop };
}

// ── Browser lifecycle ────────────────────────────────────────────────

async function resolveChromeExecutable(chromePath) {
  if (chromePath) return chromePath;
  for (const candidate of DEFAULT_EXECUTABLE_CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Launch a Puppeteer browser (headless unless options.headed).
 * @param {{ headed?: boolean, chromePath?: string|null }} [options]
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launchBrowser(options = {}) {
  const executablePath = await resolveChromeExecutable(options.chromePath);
  return puppeteer.launch({
    headless: options.headed ? false : true,
    executablePath: executablePath ?? undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  });
}

function ringBuffer(limit = 100) {
  const values = [];
  return {
    push(value) {
      values.push(value);
      if (values.length > limit) values.splice(0, values.length - limit);
    },
    snapshot() {
      return [...values];
    },
  };
}

async function waitForDebugApi(page, timeoutMs) {
  await page.waitForFunction(
    () => Boolean(globalThis.window && window.__URDF_STUDIO_DEBUG__),
    { timeout: timeoutMs },
  );
  try {
    await page.evaluate(async () => {
      const api = window.__URDF_STUDIO_DEBUG__;
      for (const name of ['ping', 'healthCheck', 'healthcheck', 'ready']) {
        if (typeof api?.[name] === 'function') {
          await api[name]();
          return;
        }
      }
    });
  } catch {
    // ping is optional
  }
}

/**
 * True when an error is the transient "the page navigated/reloaded while we were
 * evaluating" class — safe to retry rather than fail the test. Consolidated from
 * the committed regression scripts.
 * @param {unknown} error
 */
export function isTransientPageContextError(error) {
  const message = String(error?.stack || error?.message || error || '');
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id') ||
    message.includes('Runtime.getProperties') ||
    message.includes('window.__URDF_STUDIO_DEBUG__ is not available') ||
    message.includes('Inspected target navigated or closed') ||
    message.includes('Navigating frame was detached') ||
    message.includes('frame got detached') ||
    message.includes('Protocol error') ||
    message.includes('Target closed') ||
    message.includes('Session closed')
  );
}

/**
 * Let an initial post-load SPA navigation settle: wait for the debug API, pause,
 * then wait again. Mirrors `stabilizeDebugPage` from the committed scripts.
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 */
export async function stabilizeDebugPage(page, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await waitForDebugApi(page, timeoutMs);
  await delay(1_000);
  await waitForDebugApi(page, timeoutMs);
}

/**
 * Explicitly load a registered/selected file into the viewer via the debug API.
 *
 * Uploading a file only registers + auto-selects it; the document is not loaded
 * into the viewer until loadRobotByName() runs (see App.tsx loadRobotFile). The
 * format helpers call this after upload so a subsequent waitForReady() can reach
 * the 'ready' state. Tolerant of the transient navigation the load may trigger.
 * @param {import('puppeteer').Page} page
 * @param {string} fileName - The available/selected file name to load.
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>} the debug API's load result (or null)
 */
export async function triggerRobotLoad(page, fileName, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForFunction(
    () => typeof window.__URDF_STUDIO_DEBUG__?.loadRobotByName === 'function',
    { timeout: timeoutMs },
  );
  // Kick the load off WITHOUT awaiting its resolved promise. The debug bridge's
  // loadRobotByName internally awaits a "stable snapshot" that requires
  // documentLoadState.status === 'ready'; for the standard (non-USD) editor that
  // status stays at 'loading' even after the runtime robot is fully built, so
  // awaiting here would block until timeout. We fire it and let waitForReady()
  // poll for the built runtime instead (mirrors the menagerie regression).
  try {
    await page.evaluate((fn) => { void window.__URDF_STUDIO_DEBUG__?.loadRobotByName?.(fn); }, fileName);
  } catch (error) {
    if (!isTransientPageContextError(error)) throw error;
  }
}

/**
 * Open a new page, instrument console/error capture, navigate, and wait for the
 * debug API.
 * @param {import('puppeteer').Browser} browser
 * @param {string} siteUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<{ page: import('puppeteer').Page, consoleMessages: { snapshot(): string[] }, pageErrors: { snapshot(): string[] } }>}
 */
export async function createPage(browser, siteUrl, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  const page = await browser.newPage();
  const consoleMessages = ringBuffer(100);
  const pageErrors = ringBuffer(50);

  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.on('console', (message) => consoleMessages.push(`[${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));

  await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await stabilizeDebugPage(page, timeoutMs);

  return { page, consoleMessages, pageErrors };
}

// ── File upload ──────────────────────────────────────────────────────

/**
 * Upload a single file into the app's import <input type=file>.
 * Prefers an input whose `accept` matches the file extension, then any
 * non-directory file input.
 * @param {import('puppeteer').Page} page
 * @param {string} filePath - Absolute path to the file
 * @param {number} [timeoutMs]
 */
export async function uploadFile(page, filePath, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
  const handles = await page.$$('input[type="file"]');
  if (handles.length === 0) fail('Could not find a file input on the page.');

  const ext = path.extname(filePath).toLowerCase();
  let bestHandle = null;
  let bestScore = -1;
  for (const handle of handles) {
    const score = await handle.evaluate((element, extension) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'file') return -1;
      // Directory inputs cannot take a single arbitrary file reliably.
      if (element.webkitdirectory || element.hasAttribute('webkitdirectory') || element.hasAttribute('directory')) {
        return 0;
      }
      const accept = (element.accept || '').toLowerCase();
      let value = 1; // any plain file input is usable
      if (extension && accept.includes(extension)) value += 100;
      if (!accept) value += 10; // unrestricted input is a good generic target
      return value;
    }, ext);
    if (score > bestScore) {
      bestScore = score;
      bestHandle = handle;
    }
  }

  if (!bestHandle) fail('Could not find a usable file input on the page.');
  await bestHandle.uploadFile(filePath);
}

/**
 * Upload an entire directory of files into the app's directory import input
 * (the one with `webkitdirectory`), falling back to a multiple-file input.
 * @param {import('puppeteer').Page} page
 * @param {string} dir - Absolute path to the directory
 * @param {number} [timeoutMs]
 */
export async function uploadDirectory(page, dir, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  await page.waitForSelector('input[type="file"]', { timeout: timeoutMs });
  const handles = await page.$$('input[type="file"]');
  if (handles.length === 0) fail('Could not find a folder input on the page.');

  let bestHandle = null;
  for (const handle of handles) {
    const isDirectoryInput = await handle.evaluate((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
      return (
        element.webkitdirectory ||
        element.hasAttribute('webkitdirectory') ||
        element.hasAttribute('directory')
      );
    });
    if (isDirectoryInput) {
      bestHandle = handle;
      break;
    }
  }
  // Fall back to the first plain file input if no explicit directory input exists.
  if (!bestHandle) bestHandle = handles[0];

  const files = await collectFiles(dir);
  if (files.length === 0) fail(`Directory is empty: ${dir}`);

  await bestHandle.evaluate((element) => {
    if (element instanceof HTMLInputElement) {
      element.multiple = true;
      element.setAttribute('multiple', '');
    }
  });
  await bestHandle.uploadFile(...files);
}
