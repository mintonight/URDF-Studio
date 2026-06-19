import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { getLanguageFromPath, hideSeoLanguagePathFromUserUrl } from './initialLanguage.ts';

test('getLanguageFromPath recognizes only the SEO Chinese path prefix', () => {
  assert.equal(getLanguageFromPath('/zh/'), 'zh');
  assert.equal(getLanguageFromPath('/zh'), 'zh');
  assert.equal(getLanguageFromPath('/zh/?from=search'), 'zh');
  assert.equal(getLanguageFromPath('/'), null);
  assert.equal(getLanguageFromPath('/robots/zh/model'), null);
});

test('hideSeoLanguagePathFromUserUrl normalizes direct SEO-page visits for the app', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/zh/?asset=go2#viewer',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideSeoLanguagePathFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.equal(dom.window.location.search, '?asset=go2');
    assert.equal(dom.window.location.hash, '#viewer');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
});
