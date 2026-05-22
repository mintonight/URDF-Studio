import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { InspectionProgress } from './InspectionProgress';

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

test('running inspection progress view places the transient status tray above the current stage card', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <InspectionProgress
          progress={{
            stage: 'requesting-model',
            selectedCount: 6,
          }}
          elapsedSeconds={12}
          runContext={{
            robotName: 'inspection-fixture',
            sourceValue: 'URDF',
            linkCount: 12,
            jointCount: 10,
            selectedCount: 6,
            selectedProfileCount: 2,
            estimatedDuration: {
              label: '10-20s',
              maxSeconds: 20,
            },
            profileSummary: [
              {
                id: 'kinematics',
                name: 'Kinematics',
                selectedCount: 3,
                totalCount: 5,
              },
            ],
            evidenceSummary: null,
          }}
          t={translations.zh}
        />,
      );
    });

    assert.match(
      container.textContent ?? '',
      new RegExp(translations.zh.inspectionRequestingModel),
      'expected the active stage content to remain visible during a running inspection',
    );
    const statusTray = container.querySelector('[data-inspection-status-tray="true"]');
    assert.ok(statusTray, 'expected the status tray to render above the current stage card');
    const runningBadge = container.querySelector('[data-inspection-running-badge="true"]');
    assert.equal(
      runningBadge,
      null,
      'expected the running badge to be removed from the running inspection status tray',
    );
    const elapsedBadge = container.querySelector('[data-inspection-elapsed-badge="true"]');
    assert.ok(elapsedBadge, 'expected the elapsed badge to render in the status tray');
    assert.match(
      elapsedBadge.textContent ?? '',
      new RegExp(translations.zh.inspectionElapsedTime),
      'expected the elapsed badge to use the localized elapsed label',
    );
    assert.equal(
      elapsedBadge.textContent?.includes('12s') ?? false,
      true,
      'expected the elapsed badge to show the current elapsed duration',
    );
    const estimatedBadge = container.querySelector('[data-inspection-estimated-badge="true"]');
    assert.ok(estimatedBadge, 'expected the estimated duration badge to render in the status tray');
    assert.match(
      estimatedBadge.textContent ?? '',
      new RegExp(translations.zh.inspectionEstimatedDuration),
      'expected the estimated badge to use the localized estimated duration label',
    );
    assert.equal(
      estimatedBadge.textContent?.includes('10-20s') ?? false,
      true,
      'expected the estimated badge to show the run context estimate',
    );
    const currentStageCard = container.querySelector(
      '[data-inspection-current-stage-card="true"]',
    ) as HTMLElement | null;
    assert.ok(currentStageCard, 'expected the current stage card to render');
    const currentStageHeader = currentStageCard.querySelector(
      '[data-inspection-current-stage-header="true"]',
    ) as HTMLElement | null;
    assert.ok(currentStageHeader, 'expected the current stage header row to render');
    const currentStageTitle = currentStageHeader.querySelector('h2');
    assert.ok(currentStageTitle, 'expected the active stage title to render in the header row');
    const currentStageBadge = currentStageHeader.querySelector(
      '[data-inspection-current-stage-badge="true"]',
    ) as HTMLElement | null;
    assert.ok(
      currentStageBadge,
      'expected the current stage badge to render beside the stage title',
    );
    assert.equal(
      currentStageTitle.nextElementSibling === currentStageBadge,
      true,
      'expected the current stage badge to follow the active stage title in the same header row',
    );
    assert.equal(
      currentStageCard.previousElementSibling === statusTray,
      true,
      'expected the transient status tray to sit directly above the current stage card',
    );
    const statusRow = container.querySelector(
      '[data-inspection-status-row="true"]',
    ) as HTMLElement | null;
    assert.ok(statusRow, 'expected the status row to render in the status tray');
    assert.equal(
      statusRow.classList.contains('items-stretch'),
      true,
      'status tray bubbles should stretch to a coordinated height instead of floating at mixed sizes',
    );
    assert.equal(
      elapsedBadge.classList.contains('min-h-11'),
      true,
      'elapsed bubble should align to the coordinated tray bubble height',
    );
    assert.equal(
      estimatedBadge.classList.contains('min-h-11'),
      true,
      'estimated bubble should align to the coordinated tray bubble height',
    );
    assert.equal(
      elapsedBadge.classList.contains('basis-72'),
      true,
      'elapsed bubble should use the shared equal-width basis in the status tray',
    );
    assert.equal(
      estimatedBadge.classList.contains('basis-72'),
      true,
      'estimated bubble should use the shared equal-width basis in the status tray',
    );
    assert.equal(
      elapsedBadge.classList.contains('flex-1'),
      true,
      'elapsed bubble should use the shared equal-width flex rule in the status tray',
    );
    assert.equal(
      estimatedBadge.classList.contains('flex-1'),
      true,
      'estimated bubble should use the shared equal-width flex rule in the status tray',
    );
    const stageStatusBadge = container.querySelector(
      '[data-inspection-stage-status-badge="true"]',
    ) as HTMLElement | null;
    assert.equal(
      stageStatusBadge,
      null,
      'expected the stage status bubble to be removed from the running inspection status tray',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('delayed inspection status renders the delay hint inside the elapsed bubble', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <InspectionProgress
          progress={{
            stage: 'processing-response',
            selectedCount: 6,
          }}
          elapsedSeconds={26}
          runContext={{
            robotName: 'inspection-fixture',
            sourceValue: 'URDF',
            linkCount: 12,
            jointCount: 10,
            selectedCount: 6,
            selectedProfileCount: 2,
            estimatedDuration: {
              label: '10-20s',
              maxSeconds: 20,
            },
            profileSummary: [
              {
                id: 'kinematics',
                name: 'Kinematics',
                selectedCount: 3,
                totalCount: 5,
              },
            ],
            evidenceSummary: null,
          }}
          t={translations.zh}
        />,
      );
    });

    const statusTray = container.querySelector(
      '[data-inspection-status-tray="true"]',
    ) as HTMLElement | null;
    assert.ok(statusTray, 'expected the status tray to render for delayed inspections');
    assert.equal(
      statusTray.childElementCount,
      1,
      'delayed inspections should keep a single status row instead of rendering a second delayed bubble row',
    );

    const elapsedBadge = container.querySelector(
      '[data-inspection-elapsed-badge="true"]',
    ) as HTMLElement | null;
    assert.ok(elapsedBadge, 'expected the elapsed badge to remain visible for delayed inspections');

    const delayedIndicator = container.querySelector(
      '[data-inspection-delayed-indicator="true"]',
    ) as HTMLElement | null;
    assert.ok(
      delayedIndicator,
      'expected delayed inspections to render an inline delay indicator inside the elapsed badge',
    );
    assert.equal(
      elapsedBadge.contains(delayedIndicator),
      true,
      'delay indicator should be grouped inside the elapsed badge instead of standing alone below the tray',
    );
    const elapsedPrimaryRow = elapsedBadge.querySelector(
      '[data-inspection-info-bubble-primary-row="true"]',
    ) as HTMLElement | null;
    assert.ok(
      elapsedPrimaryRow,
      'expected the elapsed badge to keep a dedicated primary row for the timer value and inline delay hint',
    );
    assert.equal(
      elapsedPrimaryRow.contains(delayedIndicator),
      true,
      'delay indicator should share the elapsed value row so it follows the elapsed copy inline',
    );
    assert.equal(
      delayedIndicator.classList.contains('inline-flex'),
      true,
      'delay indicator should render as an inline badge instead of a full-width block below the elapsed value',
    );
    assert.match(
      delayedIndicator.textContent ?? '',
      new RegExp(translations.zh.inspectionRunDelayed),
      'expected the inline delay indicator to use the localized delayed copy',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
