#!/usr/bin/env node

/**
 * AI inspection browser regression test.
 *
 * Covers: deterministic inspection launch, viewport containment, wide/short
 *         scrolling, and selection persistence across setup modes.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

const INSPECTION_DIALOG_SELECTOR =
  '[role="dialog"][aria-label="AI Inspection"], [role="dialog"][aria-label="AI审阅"]';

async function clickButtonByText(page, rootSelector, labelPattern) {
  const clicked = await page.evaluate(
    ({ rootSelector: selector, labelPattern: pattern }) => {
      const root = document.querySelector(selector);
      const matcher = new RegExp(pattern, 'i');
      const button = Array.from(root?.querySelectorAll('button') ?? []).find((candidate) =>
        matcher.test(candidate.textContent?.trim() ?? ''),
      );
      button?.click();
      return Boolean(button);
    },
    { rootSelector, labelPattern },
  );

  if (!clicked) {
    throw new Error(`Unable to find button matching /${labelPattern}/ in ${rootSelector}`);
  }
}

async function openInspection(page) {
  await page.waitForSelector('button[aria-label="AI"]', { visible: true });
  await page.click('button[aria-label="AI"]');
  await page.waitForSelector('[role="menu"][aria-label="AI"]', { visible: true });
  await clickButtonByText(
    page,
    '[role="menu"][aria-label="AI"]',
    '^(AI Inspection|AI审阅)$',
  );
  await page.waitForSelector(INSPECTION_DIALOG_SELECTOR, { visible: true });
}

async function main() {
  const suite = createTestSuite('AI Assistant Smoke');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);
    await page.setViewport({ width: 1400, height: 500, deviceScaleFactor: 1 });

    // ── 1. Open AI Inspection through the dedicated AI menu ──
    await openInspection(page);
    assert(suite, true, 'AI Inspection opens deterministically from the AI menu');

    const dialogBounds = await page.evaluate((selector) => {
      const dialog = document.querySelector(selector);
      if (!(dialog instanceof HTMLElement)) {
        throw new Error(`Inspection dialog not found: ${selector}`);
      }
      const rect = dialog.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    }, INSPECTION_DIALOG_SELECTOR);
    assert(
      suite,
      dialogBounds.left >= -0.5 &&
        dialogBounds.top >= -0.5 &&
        dialogBounds.right <= dialogBounds.viewportWidth + 0.5 &&
        dialogBounds.bottom <= dialogBounds.viewportHeight + 0.5,
      'AI Inspection remains fully inside a 1400x500 viewport',
    );

    // ── 2. Edit one normal-mode check and verify mode round-trip persistence ──
    const itemKey = await page.evaluate(() => {
      const expandedGroup = document.querySelector('[data-inspection-normal-profile-items]');
      const items = Array.from(
        expandedGroup?.querySelectorAll('[data-inspection-normal-item][aria-pressed="true"]') ?? [],
      );
      return items.length > 1 ? items[0]?.getAttribute('data-inspection-normal-item') ?? null : null;
    });
    assert(suite, Boolean(itemKey), 'normal mode exposes direct editable checks');
    if (!itemKey) {
      throw new Error('Normal inspection setup did not expose a multi-item recommended category');
    }

    const normalItemSelector = `[data-inspection-normal-item="${itemKey}"]`;
    await page.click(normalItemSelector);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'false',
      {},
      normalItemSelector,
    );

    await clickButtonByText(page, INSPECTION_DIALOG_SELECTOR, '^(Professional Mode|专业模式)$');
    await page.waitForSelector('[data-inspection-advanced-scroll-viewport]', { visible: true });

    const [profileId] = itemKey.split(':');
    const professionalProfileSelector =
      `[data-inspection-current-plan-profile-toggle="${profileId}"]`;
    await page.waitForSelector(professionalProfileSelector, { visible: true });
    await page.click(professionalProfileSelector);
    const professionalItemSelector =
      `[data-inspection-setup-item-badge="${itemKey}"]`;
    await page.waitForSelector(professionalItemSelector, { visible: true });
    const professionalSelection = await page.evaluate(
      (selector) => document.querySelector(selector)?.getAttribute('aria-pressed') ?? null,
      professionalItemSelector,
    );
    assert(
      suite,
      professionalSelection === 'false',
      'professional mode preserves the manual normal-mode selection',
    );

    await clickButtonByText(page, INSPECTION_DIALOG_SELECTOR, '^(Normal Mode|常规模式)$');
    await page.waitForSelector(normalItemSelector, { visible: true });
    const roundTripSelection = await page.evaluate(
      (selector) => document.querySelector(selector)?.getAttribute('aria-pressed') ?? null,
      normalItemSelector,
    );
    assert(
      suite,
      roundTripSelection === 'false',
      'normal/professional mode round trip does not restore the recommendation',
    );

    // ── 3. Verify the professional setup owns the only wide/short scroll viewport ──
    await clickButtonByText(page, INSPECTION_DIALOG_SELECTOR, '^(Professional Mode|专业模式)$');
    const scrollSelector = '[data-inspection-advanced-scroll-viewport]';
    await page.waitForSelector(scrollSelector, { visible: true });
    const initialScroll = await page.evaluate((selector) => {
      const viewport = document.querySelector(selector);
      if (!(viewport instanceof HTMLElement)) {
        throw new Error(`Scroll viewport not found: ${selector}`);
      }
      return {
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
    }, scrollSelector);
    assert(
      suite,
      initialScroll.scrollHeight > initialScroll.clientHeight,
      'professional setup overflows its scroll viewport at 1400x500',
    );

    await page.hover(scrollSelector);
    await page.mouse.wheel({ deltaY: 320 });
    await delay(150);
    const wheelScrollTop = await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollTop ?? 0,
      scrollSelector,
    );
    assert(suite, wheelScrollTop > 0, 'wheel input scrolls the professional setup');

    const reachedBottom = await page.evaluate((selector) => {
      const viewport = document.querySelector(selector);
      if (!(viewport instanceof HTMLElement)) {
        return false;
      }
      viewport.scrollTop = viewport.scrollHeight;
      return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
    }, scrollSelector);
    assert(suite, reachedBottom, 'professional setup can reach its bottom content');

    const closeButton = await page.evaluateHandle((dialogSelector) => {
      const dialog = document.querySelector(dialogSelector);
      return Array.from(dialog?.querySelectorAll('button') ?? []).find((button) =>
        /^(Close|关闭)$/.test(button.getAttribute('aria-label') ?? ''),
      ) ?? null;
    }, INSPECTION_DIALOG_SELECTOR);
    const closeElement = closeButton.asElement();
    if (!closeElement) {
      throw new Error('AI Inspection close button was not found');
    }
    await closeElement.click();
    await page.waitForSelector(INSPECTION_DIALOG_SELECTOR, { hidden: true });
    await closeButton.dispose();

    // ── 4. Verify the workspace remains healthy after modal interactions ──
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
