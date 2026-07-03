#!/usr/bin/env node

/**
 * Theme Switching browser regression test.
 *
 * Covers: detecting current theme, toggling theme, verifying DOM changes.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Theme Switching');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Detect current theme ──
    const currentTheme = await page.evaluate(() => {
      const el = document.documentElement;
      const classList = [...el.classList];
      const isDark = classList.some((c) => /dark/i.test(c));
      const isLight = classList.some((c) => /light/i.test(c));
      const dataTheme = el.getAttribute('data-theme');
      const colorScheme = getComputedStyle(el).colorScheme;
      const storeTheme = window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.()?.theme;
      return { classList, isDark, isLight, dataTheme, colorScheme, storeTheme };
    });
    assert(suite, ['light', 'dark', 'system'].includes(currentTheme.storeTheme),
      'theme detectable from ui store');

    // ── 2. Find and click theme toggle button ──
    const themeToggleProbe = await page.evaluate(async () => {
      const readTransitionSnapshot = () => {
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const sample = [
          document.documentElement,
          document.body,
          ...[
            ...document.querySelectorAll(
              'header, button, [class*="bg-"], [class*="border"], [class*="text-"]',
            ),
          ]
            .filter(isVisible)
            .slice(0, 20),
        ];
        const styles = sample.map((el) => {
          const computed = getComputedStyle(el);
          return {
            duration: computed.transitionDuration,
            property: computed.transitionProperty,
            timing: computed.transitionTimingFunction,
          };
        });
        return {
          rootSwitching: document.documentElement.classList.contains('theme-switching'),
          sampleCount: sample.length,
          durationValues: [
            ...new Set(
              styles.flatMap((style) => style.duration.split(',').map((value) => value.trim())),
            ),
          ],
          propertyValues: [...new Set(styles.map((style) => style.property))],
          timingValues: [...new Set(styles.map((style) => style.timing))],
        };
      };

      let transitionSnapshot = null;
      const root = document.documentElement;
      const observer = new MutationObserver(() => {
        if (transitionSnapshot === null && root.classList.contains('theme-switching')) {
          transitionSnapshot = readTransitionSnapshot();
        }
      });
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });

      const btn = [...document.querySelectorAll('button')].find((b) =>
        /theme|dark|light|moon|sun/i.test(b.textContent ?? '') ||
        /theme|dark|light/i.test(b.getAttribute('aria-label') ?? '') ||
        b.dataset?.action === 'toggle-theme');

      if (!btn) {
        observer.disconnect();
        return { found: false, transitionSnapshot: null };
      }

      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (transitionSnapshot === null && root.classList.contains('theme-switching')) {
        transitionSnapshot = readTransitionSnapshot();
      }
      observer.disconnect();

      return {
        found: true,
        transitionSnapshot,
      };
    });

    if (themeToggleProbe.found) {
      const transitionProbe = themeToggleProbe.transitionSnapshot;
      assert(suite, transitionProbe !== null, 'root uses synchronized theme transition marker');
      if (transitionProbe === null) {
        throw new Error('missing theme transition snapshot');
      }
      assert(suite, transitionProbe.sampleCount >= 4, 'theme transition sampled visible UI elements');
      assert(
        suite,
        transitionProbe.durationValues.length === 1 && transitionProbe.durationValues[0] === '0.18s',
        `theme transition duration is uniform (${transitionProbe.durationValues.join(', ')})`,
      );
      assert(
        suite,
        transitionProbe.propertyValues.every((value) =>
          value.includes('background-color') && value.includes('border-color') && value.includes('color')),
        'theme transition properties are color-focused across sampled elements',
      );

      await delay(300);

      // ── 3. Verify theme changed ──
      const newTheme = await page.evaluate(() => {
        const el = document.documentElement;
        return {
          classList: [...el.classList],
          isDark: [...el.classList].some((c) => /dark/i.test(c)),
          isLight: [...el.classList].some((c) => /light/i.test(c)),
          dataTheme: el.getAttribute('data-theme'),
          storeTheme: window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.()?.theme,
        };
      });
      assert(suite, newTheme.isDark !== currentTheme.isDark || newTheme.storeTheme !== currentTheme.storeTheme,
        'theme changed after toggle');

      // ── 4. Verify canvas still renders ──
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0;
      });
      assert(suite, canvas, 'canvas renders after theme switch');

      // Toggle back
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /theme|dark|light|moon|sun/i.test(b.textContent ?? '') ||
          /theme|dark|light/i.test(b.getAttribute('aria-label') ?? '') ||
          b.dataset?.action === 'toggle-theme');
        btn?.click();
      });
    } else {
      // Try via store
      const storeToggle = await page.evaluate(() => {
        const store = window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.();
        if (store?.setTheme) {
          store.setTheme(store.theme === 'dark' ? 'light' : 'dark');
          return true;
        }
        return false;
      });
      assert(suite, storeToggle, 'theme toggled through ui store');
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('theme_switching', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
