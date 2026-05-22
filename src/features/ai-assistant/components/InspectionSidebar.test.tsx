import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { INSPECTION_PROFILE_DEFINITIONS } from '../config/inspectionProfiles';
import { InspectionSidebar } from './InspectionSidebar';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createSelectedItems() {
  return Object.fromEntries(
    INSPECTION_PROFILE_DEFINITIONS.map((profile) => [
      profile.id,
      new Set(profile.items.map((item) => item.id)),
    ]),
  );
}

test('setup inspection sidebar groups selectable profiles by profile layer', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const selectedProfiles = createSelectedItems();

  try {
    await act(async () => {
      root.render(
        <InspectionSidebar
          lang="zh"
          t={translations.zh}
          isGeneratingAI={false}
          readOnly={false}
          focusedProfileId={INSPECTION_PROFILE_DEFINITIONS[0]?.id ?? ''}
          expandedProfiles={new Set(INSPECTION_PROFILE_DEFINITIONS.map((profile) => profile.id))}
          selectedProfiles={selectedProfiles}
          recommendedProfiles={selectedProfiles}
          setExpandedProfiles={() => {}}
          setSelectedProfiles={() => {}}
          onFocusProfile={() => {}}
        />,
      );
    });

    const layerSections = Array.from(
      container.querySelectorAll<HTMLElement>('[data-inspection-sidebar-layer]'),
    );

    assert.equal(layerSections.length, 5, 'expected one sidebar section per profile layer');
    ['基础通用层', '机器人形态层', '源格式层', '目标平台层', '工作流层'].forEach((layerName) => {
      assert.equal(
        layerSections.some((section) => section.textContent?.includes(layerName)),
        true,
        `expected ${layerName} layer section to render`,
      );
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('running inspection sidebar keeps scroll container interactive without rendering the checking badge', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <InspectionSidebar
          lang="zh"
          t={translations.zh}
          isGeneratingAI
          readOnly
          focusedProfileId={INSPECTION_PROFILE_DEFINITIONS[0]?.id ?? ''}
          expandedProfiles={new Set(INSPECTION_PROFILE_DEFINITIONS.map((profile) => profile.id))}
          selectedProfiles={createSelectedItems()}
          setExpandedProfiles={() => {}}
          setSelectedProfiles={() => {}}
          onFocusProfile={() => {}}
        />,
      );
    });

    const scrollContainer = container.querySelector('.custom-scrollbar');
    assert.ok(scrollContainer, 'expected sidebar scroll container to render');
    assert.equal(
      scrollContainer.classList.contains('pointer-events-none'),
      false,
      'running inspection should keep the sidebar scroll area available for wheel/trackpad scrolling',
    );

    const toggleButtons = Array.from(container.querySelectorAll('button'));
    assert.ok(toggleButtons.length > 0, 'expected profile expand buttons to render');
    assert.equal(
      toggleButtons.every((button) => (button as HTMLButtonElement).disabled),
      true,
      'running inspection should lock sidebar controls without disabling scrolling on the container',
    );

    const checkingBadge = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent?.trim() === translations.zh.checking,
    );
    assert.equal(
      checkingBadge,
      undefined,
      'running inspection sidebar should not render the checking badge in the header',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
