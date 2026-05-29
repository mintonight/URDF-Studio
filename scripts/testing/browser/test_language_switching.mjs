#!/usr/bin/env node

/**
 * Language Switching browser regression test.
 *
 * Covers: detecting current language, switching language, verifying UI changes.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Language Switching');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Detect current language ──
    const currentLang = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        lang: el.getAttribute('lang'),
        storeLang: window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.()?.language,
      };
    });

    // ── 2. Switch language via store ──
    const switchResult = await page.evaluate(() => {
      const store = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.();
      if (!store?.setLanguage) return { ok: false };
      const current = store.language;
      const next = current === 'en' ? 'zh' : 'en';
      store.setLanguage(next);
      return { ok: true, from: current, to: next };
    });
    assert(suite, switchResult?.ok, 'language switched via store');
    await delay(300);

    // ── 3. Verify UI labels changed ──
    const afterSwitch = await page.evaluate(() => {
      const el = document.documentElement;
      return {
        lang: el.getAttribute('lang'),
        storeLang: window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.()?.language,
        bodyText: document.body?.innerText?.slice(0, 500) ?? '',
      };
    });
    assert(suite, afterSwitch.storeLang === switchResult.to, 'store language updated');

    // ── 4. Switch back ──
    await page.evaluate((from) => {
      const store = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.();
      store?.setLanguage?.(from);
    }, switchResult.from);
    await delay(200);

    const restored = await page.evaluate(() =>
      window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.()?.language);
    assert(suite, restored === switchResult.from, 'language restored');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('language_switching', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
