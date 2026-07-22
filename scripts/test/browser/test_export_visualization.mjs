#!/usr/bin/env node

/**
 * Export + roundtrip visualization regression.
 *
 * For a given robot: import -> export each format -> re-import the exported
 * archive -> capture visual / collision / inertia screenshots.
 *
 * Usage:
 *   node scripts/test/browser/test_export_visualization.mjs \
 *     --robot-dir "<abs path>" --robot-file "<name.urdf>" --label b2
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  createSession, waitForReady, getTopology, writeReport,
} from './helpers/base-helpers.mjs';
import { getMaterialSnapshot } from './helpers/base-helpers.mjs';
import {
  uploadFile, ensureDir, retryPageAction, triggerRobotLoad,
} from '../helpers/browser-helpers.mjs';
import { importZippedModel } from './helpers/zip-import-helpers.mjs';

const FORMATS = ['mjcf', 'urdf', 'xacro', 'sdf', 'usd'];

// Unbuffered progress logger that writes to stdout AND a file so we can
// monitor long-running browser automation even when stdout is piped.
const PROGRESS_LOG = path.resolve('tmp/export-viz/progress.log');
function logProgress(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { fs.appendFile(PROGRESS_LOG, line + '\n'); } catch {}
}

function parseArgs(argv) {
  const opts = {
    robotDir: null, robotFile: null, label: 'robot',
    formats: FORMATS.join(','), noStart: false,
    siteUrl: undefined,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`missing value for ${a}`); return v; };
    switch (a) {
      case '--robot-dir': opts.robotDir = path.resolve(next()); break;
      case '--robot-file': opts.robotFile = next(); break;
      case '--label': opts.label = next(); break;
      case '--formats': opts.formats = next(); break;
      case '--no-start': opts.noStart = true; break;
      case '--site-url': opts.siteUrl = next(); break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!opts.robotDir || !opts.robotFile) throw new Error('--robot-dir and --robot-file are required');
  opts.formats = opts.formats.split(',').map((s) => s.trim()).filter(Boolean);
  return opts;
}

const FORMAT_INDEX = { mjcf: 0, urdf: 1, xacro: 2, sdf: 3, usd: 4 };

async function reloadStable(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await retryPageAction(
    () => page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__), { timeout: 30_000 }),
    30_000, 'debug API after reload',
  );
  await delay(800);
  await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));
}

async function canvasScreenshot(page, outPath) {
  await ensureDir(path.dirname(outPath));
  const handle = await page.$('canvas');
  if (!handle) throw new Error('no canvas for screenshot');
  await handle.screenshot({ path: outPath, type: 'png' });
  return outPath;
}

// Read canvas pixels and compute diagnostic stats: detects blank/mono-color
// renders (stddev ~0) vs healthy varied scenes (stddev > 5, coverage > 1%).
async function canvasDiagnostics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'no canvas' };
    const w = Math.min(canvas.width, 320);
    const h = Math.min(canvas.height, 240);
    const sample = document.createElement('canvas');
    sample.width = w; sample.height = h;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, reason: 'no 2d ctx' };
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, sumSq = 0, min = 255, max = 0, nonBgPixels = 0;
    const lumas = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumas.push(luma);
      sum += luma; sumSq += luma * luma;
      if (luma < min) min = luma;
      if (luma > max) max = luma;
      const isBg = (r > 235 && g > 235 && b > 235) || (r < 25 && g < 25 && b < 25);
      if (!isBg) nonBgPixels++;
    }
    const n = lumas.length;
    const mean = sum / n;
    const stddev = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return {
      ok: true, width: w, height: h,
      meanLuma: Math.round(mean * 10) / 10,
      lumaStddev: Math.round(stddev * 10) / 10,
      lumaRange: Math.round((max - min) * 10) / 10,
      coveragePct: Math.round((nonBgPixels / n) * 1000) / 10,
      blank: stddev < 3,
    };
  });
}

async function openExportDialog(page) {
  await retryPageAction(() => page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /file|文件/i.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`));
    return Boolean(btn);
  }, { timeout: 5000 }), 30_000, 'file menu button');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /file|文件/i.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`));
    btn?.click();
  });
  await delay(600);
  await retryPageAction(() => page.waitForFunction(() => {
    const items = [...document.querySelectorAll('[role="menu"] button, [role="menuitem"], button')];
    return items.some((b) => /^(export|导出)$/i.test((b.textContent ?? '').trim()));
  }, { timeout: 5000 }), 30_000, 'export menu item');
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menu"] button, [role="menuitem"], button')];
    const btn = items.find((b) => /^(export|导出)$/i.test((b.textContent ?? '').trim()));
    btn?.click();
  });
  await page.waitForSelector('[data-export-format-picker]', { timeout: 30_000 });
}

async function selectFormat(page, format) {
  const idx = FORMAT_INDEX[format];
  await page.evaluate((index) => {
    const buttons = document.querySelectorAll('[data-export-format-picker] button');
    buttons[index]?.click();
  }, idx);
  await delay(200);
}

async function clickExportButton(page) {
  await retryPageAction(() => page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const txt = (b.textContent ?? '').trim();
      return /导出\s*zip|export\s*zip/i.test(txt) && !b.disabled;
    });
    return Boolean(btn);
  }, { timeout: 5000 }), 30_000, 'export zip button enabled');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /导出\s*zip|export\s*zip/i.test((b.textContent ?? '').trim()) && !b.disabled);
    btn?.click();
  });
}

async function setupDownloadCapture(page, dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await ensureDir(dir);
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  return client;
}

async function waitForDownload(dir, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await fs.readdir(dir).catch(() => []);
    const done = entries.filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
    if (done.length > 0) {
      await delay(500);
      return path.join(dir, done.sort().pop());
    }
    await delay(600);
  }
  throw new Error(`download timed out in ${dir}`);
}

async function reimportZip(page, zipPath, timeoutMs = 180_000) {
  const before = await page.evaluate(() =>
    (window.__URDF_STUDIO_DEBUG__?.getAvailableFiles?.() ?? []).map((f) => f.name));
  await uploadFile(page, zipPath, timeoutMs);
  const newName = await retryPageAction(async () => {
    const result = await page.evaluate((beforeArr) => {
      const before = new Set(beforeArr);
      const files = window.__URDF_STUDIO_DEBUG__?.getAvailableFiles?.() ?? [];
      const fresh = files.filter((f) => !before.has(f.name) && /\.(urdf|xml|sdf|usda?|xacro)$/i.test(f.name));
      if (fresh.length > 0) return fresh[0].name;
      const sel = window.__URDF_STUDIO_DEBUG__?.getSelectedFile?.();
      if (sel && /\.(urdf|xml|sdf|usda?|xacro)$/i.test(sel.name)) return sel.name;
      return false;
    }, before);
    return result;
  }, timeoutMs, `reimport registration of ${path.basename(zipPath)}`);
  const resolved = String(newName);
  await triggerRobotLoad(page, resolved, timeoutMs);
  return resolved;
}

async function captureMode(page, robotLabel, format, mode, screenshotDir) {
  const flags = {
    showVisual: false, showCollision: false, showInertia: false, modelOpacity: 1,
  };
  if (mode === 'visual') flags.showVisual = true;
  else if (mode === 'collision') { flags.showCollision = true; flags.showCollisionAlwaysOnTop = true; }
  else if (mode === 'inertia') { flags.showVisual = true; flags.showInertia = true; flags.modelOpacity = 0.3; }
  await page.evaluate((f) => window.__URDF_STUDIO_DEBUG__?.setViewerFlags?.(f), flags);
  await delay(1500);
  const out = path.join(screenshotDir, `${robotLabel}_${format}_${mode}.png`);
  await canvasScreenshot(page, out);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  await ensureDir(path.dirname(PROGRESS_LOG));
  logProgress(`=== Export Visualization: ${opts.label} ===`);
  logProgress(`  dir: ${opts.robotDir}`);
  logProgress(`  file: ${opts.robotFile}`);
  logProgress(`  formats: ${opts.formats.join(', ')}  noStart: ${opts.noStart}`);

  const screenshotDir = path.resolve(`tmp/export-viz/${opts.label}`);
  const downloadBase = path.resolve(`tmp/export-viz/${opts.label}/downloads`);
  await ensureDir(screenshotDir);

  const session = await createSession({ noStart: opts.noStart, siteUrl: opts.siteUrl });
  const { page } = session;
  const results = { label: opts.label, formats: {} };
  let cdpClient = null;

  try {
    for (const format of opts.formats) {
      logProgress(`-- ${opts.label} / ${format} --`);
      const fmtResult = { format, status: 'unknown', steps: {}, screenshots: {} };
      results.formats[format] = fmtResult;

      try {
        logProgress(`  [1/4] importing original robot...`);
        await reloadStable(page);
        await importZippedModel(page, opts.robotDir, opts.robotFile, 120_000, opts.label);
        await waitForReady(page, 180_000);
        const topo = await getTopology(page);
        fmtResult.topology = { links: topo.linkCount, joints: topo.jointCount };
        logProgress(`  imported: ${topo.linkCount} links, ${topo.jointCount} joints`);

        await delay(2000); // let UI settle before opening export menu
        logProgress(`  [2/4] exporting ${format}...`);
        const downloadDir = path.join(downloadBase, format);
        cdpClient = await setupDownloadCapture(page, downloadDir);
        await openExportDialog(page);
        await selectFormat(page, format);
        await clickExportButton(page);
        const zipPath = await waitForDownload(downloadDir, 240_000);
        fmtResult.steps.export = 'ok';
        fmtResult.zipPath = zipPath;
        fmtResult.zipSize = (await fs.stat(zipPath)).size;
        logProgress(`  downloaded: ${path.basename(zipPath)} (${fmtResult.zipSize} bytes)`);
        await page.keyboard.press('Escape').catch(() => {});
        await delay(500);

        logProgress(`  [3/4] re-importing exported archive...`);
        await reloadStable(page);
        const loadedFile = await reimportZip(page, zipPath, 180_000);
        await waitForReady(page, 180_000);
        const reTopo = await getTopology(page);
        fmtResult.steps.reimport = 'ok';
        fmtResult.reimportedFile = loadedFile;
        fmtResult.reimportedTopology = { links: reTopo.linkCount, joints: reTopo.jointCount };
        logProgress(`  re-imported: ${reTopo.linkCount} links, ${reTopo.jointCount} joints`);

        logProgress(`  [4/4] capturing display modes...`);
        for (const mode of ['visual', 'collision', 'inertia']) {
          const shot = await captureMode(page, opts.label, format, mode, screenshotDir);
          const diag = await canvasDiagnostics(page);
          if (mode === 'visual') {
            const matSnap = await getMaterialSnapshot(page);
            fmtResult.runtimeVisual = {
              meshCount: matSnap.runtimeVisualMeshCount,
              placeholderCount: matSnap.runtimeVisualMeshes?.filter((m) => m.isPlaceholder).length ?? 0,
              missingCount: matSnap.runtimeVisualMeshes?.filter((m) => m.missingMeshPath).length ?? 0,
              visibleCount: matSnap.runtimeVisualMeshes?.filter((m) => m.visible && m.effectiveVisible).length ?? 0,
            };
            logProgress(`  runtime visual meshes: ${fmtResult.runtimeVisual.meshCount} (visible=${fmtResult.runtimeVisual.visibleCount}, placeholder=${fmtResult.runtimeVisual.placeholderCount}, missing=${fmtResult.runtimeVisual.missingCount})`);
          }
          fmtResult.screenshots[mode] = shot;
          fmtResult.diagnostics = fmtResult.diagnostics || {};
          fmtResult.diagnostics[mode] = diag;
          fmtResult.steps[mode] = 'ok';
          logProgress(`  screenshot ${mode}: ${path.basename(shot)} | cov=${diag.coveragePct}% stddev=${diag.lumaStddev} range=${diag.lumaRange}${diag.blank ? ' [BLANK?]' : ''}`);
        }
        fmtResult.status = 'complete';
      } catch (error) {
        fmtResult.status = 'error';
        fmtResult.error = String(error?.message || error);
        logProgress(`  ERROR (${format}): ${fmtResult.error}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  } finally {
    try { await cdpClient?.detach?.(); } catch {}
    await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setViewerFlags?.({
      showVisual: true, showCollision: false, showInertia: false, modelOpacity: 1,
    })).catch(() => {});
    await session.cleanup();
  }

  await writeReport(`export-viz/${opts.label}`, results);
  logProgress(`=== ${opts.label} done. Screenshots in ${screenshotDir} ===`);

  const failed = Object.values(results.formats).filter((f) => f.status !== 'complete');
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => { logProgress(`FATAL: ${e?.stack || e}`); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
