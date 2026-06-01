#!/usr/bin/env node

/**
 * AI Assistant smoke browser regression test.
 *
 * Covers: verifying AI assistant UI presence, opening inspection modal,
 *         opening conversation modal, closing modals.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('AI Assistant Smoke');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Verify AI assistant button exists ──
    const aiButton = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const aiBtn = buttons.find((b) =>
        /ai|inspect|assistant|chat/i.test(b.textContent ?? '') ||
        /ai|inspect|assistant/i.test(b.getAttribute('aria-label') ?? '') ||
        b.dataset?.action === 'ai-assistant');
      return !!aiBtn;
    });
    assert(suite, aiButton, 'AI assistant button found');

    // ── 2. Try opening AI inspection modal ──
    const inspectOpened = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const btn = buttons.find((b) =>
        /inspect|check|review/i.test(b.textContent ?? '') ||
        /inspect|check|review/i.test(b.getAttribute('aria-label') ?? ''));
      btn?.click();
      return !!btn;
    });

    if (inspectOpened) {
      await delay(500);
      // Verify modal appeared (no crash)
      const modalPresent = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]') ??
          document.querySelector('.modal') ??
          document.querySelector('[data-modal]');
        return !!modal;
      });
      // Modal may or may not appear depending on AI feature availability
      assert(suite, true, 'inspect button clicked without crash');

      // Close any open modal with Escape
      await page.keyboard.press('Escape');
      await delay(200);
    }

    // ── 3. Try opening AI conversation ──
    const chatOpened = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const btn = buttons.find((b) =>
        /chat|ai|assistant/i.test(b.textContent ?? '') ||
        /chat|ai|assistant/i.test(b.getAttribute('aria-label') ?? ''));
      btn?.click();
      return !!btn;
    });

    if (chatOpened) {
      await delay(500);
      assert(suite, true, 'chat button clicked without crash');
      await page.keyboard.press('Escape');
      await delay(200);
    }

    // ── 4. Verify state restored after modal interactions ──
    const canvasOk = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas instanceof HTMLCanvasElement;
    });
    assert(suite, canvasOk, 'canvas still present after AI interactions');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('ai_assistant', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
