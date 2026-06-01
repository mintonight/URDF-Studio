import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { GeometryType, JointType, type InspectionReport, type RobotState } from '@/types';
import { INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import { buildInspectionItemAnchorId, InspectionReportView } from './InspectionReport';
import { InspectionSidebar, type SelectedInspectionItems } from './InspectionSidebar';

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
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
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

const createRobotFixture = (): RobotState => ({
  name: 'inspection-fixture',
  rootLinkId: 'base_link',
  links: {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        color: '#999999',
      },
      collision: {
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.1 },
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        color: '#999999',
      },
      inertial: {
        mass: 2.5,
        inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
      },
    },
  },
  joints: {
    hip_joint: {
      id: 'hip_joint',
      name: 'hip_joint',
      type: JointType.REVOLUTE,
      parentLinkId: 'world',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0.1, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 1, z: 0 },
      limit: { lower: -1, upper: 1, effort: 20, velocity: 10 },
      dynamics: { damping: 0.1, friction: 0.1 },
      hardware: { armature: 0.03, motorType: 'servo', motorId: 'M1', motorDirection: 1 },
    },
  },
  inspectionContext: undefined,
  selection: { type: 'link', id: 'base_link' },
});

test('read-only inspection sidebar scrolls to the matching report item anchor', async () => {
  const dom = installDom();
  const scrollCalls: string[] = [];
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
    value(this: HTMLElement) {
      scrollCalls.push(this.dataset.inspectionAnchorId ?? this.id);
    },
    configurable: true,
  });

  const [firstCategory, secondCategory, thirdCategory] = INSPECTION_CRITERIA;
  assert.ok(firstCategory, 'expected at least one inspection category');
  assert.ok(secondCategory, 'expected at least two inspection categories');
  assert.ok(thirdCategory, 'expected at least three inspection categories');

  const firstItem = firstCategory.items[0];
  const secondItem = secondCategory.items[0];
  assert.ok(firstItem, 'expected the first category to contain an inspection item');
  assert.ok(secondItem, 'expected the second category to contain an inspection item');

  const selectedItems: SelectedInspectionItems = {
    [firstCategory.id]: new Set([firstItem.id]),
    [secondCategory.id]: new Set([secondItem.id]),
  };

  const report: InspectionReport = {
    summary: 'Navigation-ready report',
    issues: [
      {
        type: 'warning',
        title: `${firstItem.name} needs attention`,
        description: 'The first selected check reported a warning.',
        category: firstCategory.id,
        itemId: firstItem.id,
        score: 5,
      },
      {
        type: 'pass',
        title: `${secondItem.name} passed`,
        description: 'The second selected check passed cleanly.',
        category: secondCategory.id,
        itemId: secondItem.id,
        score: 10,
      },
    ],
    overallScore: 15,
    categoryScores: {
      [firstCategory.id]: 5,
      [secondCategory.id]: 10,
    },
    maxScore: 20,
  };

  function NavigationHarness() {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
      new Set(INSPECTION_CRITERIA.map((category) => category.id)),
    );
    const [focusedCategoryId, setFocusedCategoryId] = useState(firstCategory.id);
    const scrollViewportRef = useRef<HTMLDivElement | null>(null);
    const t = translations.en;

    const ensureCategoryExpanded = (categoryId: string) => {
      setExpandedCategories((prev) => {
        if (prev.has(categoryId)) {
          return prev;
        }

        const next = new Set(prev);
        next.add(categoryId);
        return next;
      });
    };

    const scrollToAnchor = (anchorId: string) => {
      const target = scrollViewportRef.current?.querySelector<HTMLElement>(
        `[data-inspection-anchor-id="${anchorId}"]`,
      );
      target?.scrollIntoView();
    };

    return (
      <div className="flex">
        <InspectionSidebar
          lang="en"
          t={t}
          isGeneratingAI={false}
          readOnly
          focusedCategoryId={focusedCategoryId}
          expandedCategories={expandedCategories}
          selectedItems={selectedItems}
          setExpandedCategories={setExpandedCategories}
          setSelectedItems={(value) => {
            void value;
          }}
          onFocusCategory={setFocusedCategoryId}
          onNavigateToCategory={(categoryId) => {
            setFocusedCategoryId(categoryId);
            ensureCategoryExpanded(categoryId);
          }}
          onNavigateToItem={(categoryId, itemId) => {
            setFocusedCategoryId(categoryId);
            ensureCategoryExpanded(categoryId);
            scrollToAnchor(buildInspectionItemAnchorId(categoryId, itemId));
          }}
        />

        <div ref={scrollViewportRef}>
          <InspectionReportView
            report={report}
            robot={createRobotFixture()}
            lang="en"
            t={t}
            expandedCategories={expandedCategories}
            retestingItem={null}
            isGeneratingAI={false}
            onToggleCategory={(categoryId) => {
              setExpandedCategories((prev) => {
                const next = new Set(prev);
                if (next.has(categoryId)) {
                  next.delete(categoryId);
                } else {
                  next.add(categoryId);
                }
                return next;
              });
            }}
            onRetestItem={() => {}}
            onDownloadPDF={() => {}}
            onSelectItem={() => {}}
            onAskAboutIssue={() => {}}
          />
        </div>
      </div>
    );
  }

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<NavigationHarness />);
    });

    const thirdCategoryName = thirdCategory.name;
    assert.equal(
      container.textContent?.includes(thirdCategoryName),
      false,
      'unselected categories should be hidden in the report navigation layout',
    );

    const targetAnchorId = buildInspectionItemAnchorId(firstCategory.id, firstItem.id);
    assert.ok(
      container.querySelector(`[data-inspection-anchor-id="${targetAnchorId}"]`),
      'expected the report item anchor to be rendered',
    );

    const itemButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(firstItem.name),
    );
    assert.ok(itemButton, 'expected the selected sidebar item to render as a button');

    await act(async () => {
      itemButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      scrollCalls.at(-1),
      targetAnchorId,
      'clicking a read-only sidebar item should scroll the matching report item into view',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
