import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import {
  __setPdfCanvasFactoryForTests,
  __setPdfGenerationDepsLoaderForTests,
} from '@/features/file-io/utils/generatePdfFromHtml';
import { INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import { GeometryType, JointType, type RobotState } from '@/types';

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

function installPdfExportMocks(savedFiles: string[]) {
  __setPdfGenerationDepsLoaderForTests(async () => ({
    html2canvas: (async () => ({
      width: 1200,
      height: 1800,
      getContext: () => ({
        fillStyle: '#ffffff',
        fillRect: () => {},
        drawImage: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,source',
    })) as never,
    jsPDF: class {
      internal = {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      };

      addImage() {}

      addPage() {}

      save(fileName: string) {
        savedFiles.push(fileName);
      }

      setProperties() {}
    } as never,
  }));

  __setPdfCanvasFactoryForTests((width, height) => ({
    width,
    height,
    getContext: () => ({
      fillStyle: '#ffffff',
      fillRect: () => {},
      drawImage: () => {},
    }),
    toDataURL: () => 'data:image/png;base64,slice',
  }));

  return () => {
    __setPdfGenerationDepsLoaderForTests(null);
    __setPdfCanvasFactoryForTests(null);
  };
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
  inspectionContext: null,
  selection: { type: 'link', id: 'base_link' },
});

function getNormalCategoryRow(container: Element, index = 0): HTMLButtonElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-inspection-normal-category-row]'),
    )[index] ?? null
  );
}

test('transparent AI inspection backdrop does not intercept pointer events', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    assert.ok(backdrop, 'expected transparent backdrop to render');
    assert.equal(
      backdrop.classList.contains('pointer-events-none'),
      true,
      'transparent backdrop should not block interactions with the workspace',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection report stays available after closing and reopening the modal', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.en;
  const previousApiKey = process.env.API_KEY;

  function ModalHarness() {
    const [isOpen, setIsOpen] = React.useState(true);

    return (
      <>
        <button type="button" onClick={() => setIsOpen(true)}>
          Reopen
        </button>
        <AIInspectionModal
          isOpen={isOpen}
          onClose={() => {
            setIsOpen(false);
          }}
          robot={createRobotFixture()}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />
      </>
    );
  }

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(<ModalHarness />);
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the inspection report actions to render after running the inspection',
    );

    const closeButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t.close}"]`,
    );
    assert.ok(closeButton, 'expected the window close button to render');

    await act(async () => {
      closeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      getButtonByText(t.discussReportWithAI),
      null,
      'expected the report action to be hidden while the modal is closed',
    );

    const reopenButton = getButtonByText('Reopen');
    assert.ok(reopenButton, 'expected the reopen control to render');

    await act(async () => {
      reopenButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the prior inspection report to remain available after reopening the modal',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection report footer uses regenerate confirmation instead of a back button', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.equal(
      getButtonByText(t.back),
      null,
      'expected the report footer to stop rendering the back button',
    );

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');
    assert.equal(
      confirmDialog.textContent?.includes(t.inspectionRegenerateConfirmTitle),
      true,
      'expected regenerate confirmation title to render',
    );
    assert.equal(
      confirmDialog.textContent?.includes(t.inspectionRegenerateConfirmMessage),
      true,
      'expected regenerate confirmation message to render',
    );

    const dialogButtons = Array.from(confirmDialog.querySelectorAll('button'));
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.back),
      true,
      'expected confirmation dialog to render the back action',
    );
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.saveReport),
      true,
      'expected confirmation dialog to render the save report action',
    );
    assert.equal(
      dialogButtons.some((button) => button.textContent?.trim() === t.retryLastResponse),
      true,
      'expected confirmation dialog to render the regenerate action',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('saving the report from regenerate confirmation returns to the inspection result view', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const savedFiles: string[] = [];
  const restorePdfMocks = installPdfExportMocks(savedFiles);
  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');

    const saveReportButton = Array.from(confirmDialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === t.saveReport,
    );
    assert.ok(saveReportButton, 'expected confirmation dialog to render the save report action');

    await act(async () => {
      saveReportButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });
    });

    assert.equal(savedFiles.length, 1, 'expected save report to export one PDF file');
    assert.equal(
      dom.window.document.querySelector('[role="dialog"][aria-modal="true"]'),
      null,
      'expected the confirmation dialog to close after saving the report',
    );
    assert.ok(
      getButtonByText(t.discussReportWithAI),
      'expected the inspection result view to remain visible after saving the report',
    );
    assert.ok(
      getButtonByText(t.retryLastResponse),
      'expected the report footer to remain on the inspection result view after saving',
    );
  } finally {
    restorePdfMocks();
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('confirming regenerate returns to setup and preserves the prior mode and selected checks', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const previousApiKey = process.env.API_KEY;
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const firstCategory = INSPECTION_CRITERIA[0];
  const firstItem = firstCategory?.items[0];
  assert.ok(firstCategory, 'expected inspection criteria to include at least one category');
  assert.ok(firstItem, 'expected the first category to include at least one item');

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    delete process.env.API_KEY;

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const firstCategoryRow = getNormalCategoryRow(container);
    assert.ok(firstCategoryRow, 'expected the normal mode category row control to render');

    await act(async () => {
      firstCategoryRow!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const firstItemButton = getButtonByText(firstItem!.nameZh);
    assert.ok(firstItemButton, 'expected the expanded normal mode item button to render');

    await act(async () => {
      firstItemButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const runButton = getButtonByText(t.runInspection);
    assert.ok(runButton, 'expected the run inspection button to render');

    await act(async () => {
      runButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const regenerateButton = getButtonByText(t.retryLastResponse);
    assert.ok(regenerateButton, 'expected the regenerate button to render in the report footer');

    await act(async () => {
      regenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const confirmDialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(confirmDialog, 'expected regenerate confirmation dialog to open');

    const confirmRegenerateButton = Array.from(confirmDialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === t.retryLastResponse,
    );
    assert.ok(
      confirmRegenerateButton,
      'expected confirmation dialog to render the regenerate action',
    );

    await act(async () => {
      confirmRegenerateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    assert.equal(
      dom.window.document.querySelector('[role="dialog"][aria-modal="true"]'),
      null,
      'expected the confirmation dialog to close after confirming regenerate',
    );
    assert.equal(
      getButtonByText(t.discussReportWithAI),
      null,
      'expected the report view to close after confirming regenerate',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionConfigureChecks),
      true,
      'expected confirming regenerate to return to the setup view',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionScoringReference),
      false,
      'expected the previously selected normal mode to remain active after returning to setup',
    );

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    assert.ok(summaryChip, 'expected the setup summary chip to render after confirming regenerate');
    assert.equal(
      summaryChip.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', String(totalItemCount - 1))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected the prior item selection to remain intact after confirming regenerate',
    );
    assert.ok(
      getButtonByText(t.runInspection),
      'expected the setup run button to render again after confirming regenerate',
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousApiKey;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup restores the saved normal mode and keeps selection in sync with advanced mode', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const firstCategory = INSPECTION_CRITERIA[0];
  const firstItem = firstCategory?.items[0];
  assert.ok(firstCategory, 'expected inspection criteria to include at least one category');
  assert.ok(firstItem, 'expected the first category to include at least one item');

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.textContent?.includes(t.inspectionConfigureChecks),
      true,
      'expected the saved normal mode to render the simplified setup heading',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionScoringReference),
      false,
      'expected the normal mode to hide advanced scoring references',
    );
    assert.equal(
      container.textContent?.includes('切换到专业模式'),
      true,
      'expected the normal mode setup description to reference professional mode',
    );
    assert.equal(
      container.textContent?.includes('切换到高级模式'),
      false,
      'expected the outdated advanced-mode wording to be removed from the normal mode description',
    );

    const firstCategoryRow = getNormalCategoryRow(container);
    assert.ok(firstCategoryRow, 'expected the normal mode category row control to render');

    await act(async () => {
      firstCategoryRow!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const firstItemButton = getButtonByText(firstItem!.nameZh);
    assert.ok(firstItemButton, 'expected the expanded normal mode item button to render');

    await act(async () => {
      firstItemButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const advancedModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(advancedModeButton, 'expected the advanced mode toggle to render');

    await act(async () => {
      advancedModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container.textContent?.includes(t.inspectionScoringReference),
      true,
      'expected the advanced mode to restore scoring references',
    );
    assert.equal(
      container.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', String(totalItemCount - 1))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected advanced mode to reflect the selection changed in normal mode',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional mode status badge toggles the inspection item selection', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const firstCategory = INSPECTION_CRITERIA[0];
  const firstItem = firstCategory?.items[0];
  assert.ok(firstCategory, 'expected inspection criteria to include at least one category');
  assert.ok(firstItem, 'expected the first category to include at least one item');

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const professionalModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(professionalModeButton, 'expected the professional mode toggle to render');

    await act(async () => {
      professionalModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const badge = container.querySelector<HTMLButtonElement>(
      `[data-inspection-setup-item-badge="${firstCategory!.id}:${firstItem!.id}"]`,
    );
    assert.ok(badge, 'expected the focused item badge button to render');
    assert.equal(badge.textContent?.trim(), t.inspectionIncluded);
    assert.equal(badge.getAttribute('aria-pressed'), 'true');

    await act(async () => {
      badge!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.trim(), t.inspectionSkipped);
    assert.equal(badge!.getAttribute('aria-pressed'), 'false');

    const summaryText = t.inspectionSelectedChecksSummary
      .replace('{selected}', String(totalItemCount - 1))
      .replace('{total}', String(totalItemCount));
    assert.equal(
      container.textContent?.includes(summaryText),
      true,
      'expected the professional-mode summary to reflect the deselected item',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode shows the inline selection summary and page-level bulk actions', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    assert.ok(summaryChip, 'expected the normal mode header to render an inline selection summary');
    assert.equal(
      summaryChip.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', String(totalItemCount))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected the inline summary to reflect the initial all-selected state',
    );

    assert.ok(getButtonByText('全选全部'), 'expected a page-level select-all action to render');
    assert.ok(getButtonByText('清空全部'), 'expected a page-level clear-all action to render');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode bulk actions keep selection counts and footer state in sync', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const summaryChip = () =>
      container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    const getRunButton = () =>
      container.querySelector<HTMLButtonElement>('[data-inspection-run-button]');
    assert.ok(getRunButton(), 'expected the normal mode run button to render');
    assert.equal(getRunButton()?.disabled, false, 'expected run inspection to start enabled');

    const clearAllButton = getButtonByText('清空全部');
    assert.ok(clearAllButton, 'expected the normal mode clear-all action to render');

    await act(async () => {
      clearAllButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      summaryChip()?.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', '0')
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected clear-all to reset the inline summary count',
    );
    assert.equal(
      getRunButton()?.disabled,
      true,
      'expected clear-all to disable running the inspection',
    );

    const selectAllButton = getButtonByText('全选全部');
    assert.ok(selectAllButton, 'expected the normal mode select-all action to render');

    await act(async () => {
      selectAllButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      summaryChip()?.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', String(totalItemCount))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected select-all to restore the inline summary count',
    );
    assert.equal(
      getRunButton()?.disabled,
      false,
      'expected select-all to re-enable running the inspection',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode uses a scan queue layout aligned with antivirus-style setup', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const title = container.querySelector<HTMLElement>('[data-inspection-normal-title]');
    assert.ok(title, 'expected the normal mode title to render a test hook');
    assert.equal(
      title.className.includes('text-lg'),
      true,
      'expected the normal mode title to use a compact heading scale',
    );

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    assert.ok(summaryChip, 'expected the normal mode summary chip to render');
    assert.equal(
      summaryChip.className.includes('text-[11px]'),
      true,
      'expected the normal mode summary chip to use compact body sizing',
    );

    const actionButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-inspection-normal-action]'),
    );
    assert.equal(actionButtons.length, 2, 'expected both normal mode bulk actions to render');
    assert.equal(
      actionButtons.every((button) => button.className.includes('h-8')),
      true,
      'expected the normal mode bulk actions to match the denser advanced-mode button height',
    );

    const scanList = container.querySelector<HTMLElement>('[data-inspection-normal-scan-list]');
    assert.ok(scanList, 'expected normal mode to render the scan queue list container');
    assert.equal(
      scanList.className.includes('divide-y'),
      true,
      'expected the scan queue to use divided rows instead of a card grid',
    );

    const firstCategoryCard = container.querySelector<HTMLElement>(
      '[data-inspection-normal-category]',
    );
    assert.ok(firstCategoryCard, 'expected a normal mode category section to render');
    assert.equal(
      firstCategoryCard.className.includes('rounded-xl'),
      true,
      'expected the normal mode category section to keep the tighter panel radius',
    );
    assert.equal(
      firstCategoryCard.className.includes('border-0'),
      true,
      'expected individual category sections to stop rendering standalone card borders',
    );

    const categoryIcon = firstCategoryCard.querySelector<HTMLElement>(
      '[data-inspection-normal-category-icon]',
    );
    assert.ok(categoryIcon, 'expected the category card icon wrapper to render');
    assert.equal(
      categoryIcon.className.includes('h-9 w-9'),
      true,
      'expected the category icon wrapper to use the compact category scale',
    );

    const firstCategoryRow = firstCategoryCard.querySelector<HTMLButtonElement>(
      '[data-inspection-normal-category-row]',
    );
    assert.ok(firstCategoryRow, 'expected each category to render a scan queue row');
    assert.equal(
      firstCategoryRow.className.includes('grid-cols-[auto_minmax(0,1fr)_auto]'),
      true,
      'expected the category row to use status, content, and disclosure columns',
    );

    const firstCategoryProgress = firstCategoryCard.querySelector<HTMLElement>(
      '[data-inspection-normal-category-progress]',
    );
    assert.ok(
      firstCategoryProgress,
      'expected each category row to expose a compact scan progress indicator',
    );
    assert.equal(
      firstCategoryProgress.style.width,
      '100%',
      'expected a fully selected category to render a full progress indicator',
    );

    const firstCategoryCount = firstCategoryCard.querySelector<HTMLElement>(
      '[data-inspection-normal-category-count]',
    );
    assert.ok(firstCategoryCount, 'expected each category row to render selected/total counts');
    assert.equal(
      firstCategoryCount.className.includes('tabular-nums'),
      true,
      'expected category counts to use aligned tabular numbers',
    );

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'false',
      'expected normal mode categories to be collapsed by default',
    );
    assert.equal(
      firstCategoryCard.querySelector('[data-inspection-normal-item-list]'),
      null,
      'expected collapsed normal mode categories to hide item-level controls by default',
    );

    const selectedSummary = container.querySelector<HTMLElement>(
      '[data-inspection-normal-summary]',
    );
    assert.ok(selectedSummary, 'expected the normal mode summary to render');
    const initialSelectedSummaryText = selectedSummary.textContent;
    const categorySelectionButton = firstCategoryCard.querySelector<HTMLButtonElement>(
      '[data-inspection-normal-category-selection]',
    );
    assert.ok(
      categorySelectionButton,
      'expected each category to expose a dedicated selection checkbox control',
    );
    const categorySelectionMark = categorySelectionButton.querySelector<HTMLElement>(
      '[data-inspection-normal-selection-mark]',
    );
    assert.ok(categorySelectionMark, 'expected the category checkbox to render a selection mark');
    assert.equal(
      categorySelectionMark.className.includes('bg-system-blue/80'),
      true,
      'expected fully selected category checkboxes to use the lighter partial-selection blue',
    );
    assert.equal(
      categorySelectionMark.className.includes('bg-system-blue-solid'),
      false,
      'expected fully selected category checkboxes to avoid the deeper solid-blue fill',
    );

    await act(async () => {
      firstCategoryRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'true',
      'expected clicking the category row to expand item-level controls',
    );
    assert.equal(
      selectedSummary.textContent,
      initialSelectedSummaryText,
      'expected clicking the category row to leave selected item counts unchanged',
    );

    await act(async () => {
      firstCategoryRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the category row again to collapse item-level controls',
    );

    await act(async () => {
      categorySelectionButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the category checkbox to leave the category collapsed',
    );
    assert.notEqual(
      selectedSummary.textContent,
      initialSelectedSummaryText,
      'expected clicking the category checkbox to change selected item counts',
    );

    await act(async () => {
      categorySelectionButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the category checkbox again to keep the category collapsed',
    );
    assert.equal(
      selectedSummary.textContent,
      initialSelectedSummaryText,
      'expected clicking the category checkbox again to restore selected item counts',
    );

    await act(async () => {
      firstCategoryRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const itemList = firstCategoryCard.querySelector<HTMLElement>(
      '[data-inspection-normal-item-list]',
    );
    assert.ok(itemList, 'expected expanded scan rows to reveal compact item-level controls');

    const firstItemRow = firstCategoryCard.querySelector<HTMLElement>(
      '[data-inspection-normal-item]',
    );
    assert.ok(firstItemRow, 'expected a normal mode item row to render');
    assert.equal(
      firstItemRow.className.includes('rounded-md'),
      true,
      'expected the normal mode item rows to use a tighter scan-list item shape',
    );

    await act(async () => {
      firstItemRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstItemRow.className.includes('border-border-black'),
      true,
      'expected unchecked normal mode item rows to keep a visible border',
    );
    assert.equal(
      firstItemRow.className.includes('hover:border-system-blue/30'),
      true,
      'expected unchecked normal mode item rows to highlight the border on hover',
    );

    const summaryAfterItemToggle = selectedSummary.textContent;

    await act(async () => {
      firstCategoryRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstCategoryRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the expanded category row to collapse item-level controls',
    );
    assert.equal(
      selectedSummary.textContent,
      summaryAfterItemToggle,
      'expected collapsing the category row to leave selected item counts unchanged',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode visually differentiates select-all and clear-all actions', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const selectAllButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-normal-action="select-all"]',
    );
    const clearAllButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-normal-action="clear-all"]',
    );

    assert.ok(selectAllButton, 'expected the select-all action to render a dedicated test hook');
    assert.ok(clearAllButton, 'expected the clear-all action to render a dedicated test hook');
    assert.equal(
      selectAllButton.className.includes('border-system-blue/25') &&
        selectAllButton.className.includes('bg-system-blue/10') &&
        selectAllButton.className.includes('text-system-blue'),
      true,
      'expected select-all to use the emphasized positive action styling',
    );
    assert.equal(
      clearAllButton.className.includes('border-danger-border') &&
        clearAllButton.className.includes('bg-danger-soft') &&
        clearAllButton.className.includes('text-danger'),
      true,
      'expected clear-all to use the reset action styling',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode footer uses a compact aligned count treatment', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const footerSummary = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-summary]',
    );
    assert.ok(footerSummary, 'expected the normal mode footer to render a dedicated count summary');
    assert.equal(
      footerSummary.className.includes('inline-flex items-center'),
      true,
      'expected the footer summary to use an aligned inline-flex layout',
    );

    const primaryCount = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-primary-count]',
    );
    const totalCount = container.querySelector<HTMLElement>(
      '[data-inspection-normal-footer-total-count]',
    );
    assert.ok(primaryCount, 'expected the footer summary to render the selected-count token');
    assert.ok(totalCount, 'expected the footer summary to render the total-count token');
    assert.equal(
      primaryCount.className.includes('text-2xl'),
      true,
      'expected the selected count to use the rebalanced primary size',
    );
    assert.equal(
      totalCount.className.includes('text-sm'),
      true,
      'expected the total count to use the smaller supporting size',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup mode switcher uses the professional mode label', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.ok(
      getButtonByText(t.inspectionAdvancedMode),
      'expected the setup mode switcher to render the renamed professional mode label',
    );
    assert.equal(
      getButtonByText('高级模式'),
      null,
      'expected the old advanced mode label to stop rendering in the setup switcher',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup highlights the run inspection action from the window center with synced breathing', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const getRunButton = () =>
      container.querySelector<HTMLButtonElement>('[data-inspection-run-button]');
    assert.ok(getRunButton(), 'expected the setup footer to expose the run inspection button hook');
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-pulse'),
      true,
      'expected entering normal mode to pulse the run inspection button',
    );

    const pointerOverlay = container.querySelector<HTMLElement>(
      '[data-inspection-run-pointer-overlay]',
    );
    assert.ok(pointerOverlay, 'expected the pointer cue to render in a full-window overlay');
    assert.equal(
      pointerOverlay.style.getPropertyValue('--inspection-run-pointer-origin-x'),
      '50%',
      'expected the pointer cue to originate from the horizontal center of the modal window',
    );
    assert.equal(
      pointerOverlay.style.getPropertyValue('--inspection-run-pointer-origin-y'),
      '50%',
      'expected the pointer cue to originate from the vertical center of the modal window',
    );

    const firstPointer = container.querySelector<HTMLElement>('[data-inspection-run-pointer]');
    assert.ok(
      firstPointer,
      'expected entering setup mode to render a temporary pointer cue toward the run inspection button',
    );
    assert.equal(
      container.querySelector('[data-inspection-run-hint]'),
      null,
      'expected the previous text hint capsule to be removed',
    );
    assert.equal(
      Boolean(firstPointer.querySelector('.inspection-run-pointer-cta')),
      true,
      'expected the pointer cue to use the dedicated pointer animation styling',
    );
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-breathe-sync'),
      true,
      'expected the run inspection button to coordinate a breathing animation with the pointer cue',
    );

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2600);
      });
    });

    assert.equal(
      container.querySelector('[data-inspection-run-pointer]'),
      null,
      'expected the pointer cue to dismiss itself after the short guidance window',
    );
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-breathe-sync'),
      false,
      'expected the run inspection button to leave the synced breathing state after the cue ends',
    );

    const professionalModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(
      professionalModeButton,
      'expected the setup mode switcher to render the professional mode',
    );

    await act(async () => {
      professionalModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const secondPointer = container.querySelector<HTMLElement>('[data-inspection-run-pointer]');
    assert.ok(
      secondPointer,
      'expected entering professional mode to trigger the pointer cue again',
    );
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-pulse'),
      true,
      'expected entering professional mode to re-apply the run inspection pulse',
    );
    assert.equal(
      getRunButton()?.className.includes('inspection-run-cta-breathe-sync'),
      true,
      'expected entering professional mode to re-apply the synced breathing state',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup replays the run inspection cue when switching modes before the previous cue ends', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getSetupModeButton = (label: string) =>
    Array.from(container.querySelectorAll('[data-inspection-setup-mode-switcher] button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const initialPointer = container.querySelector<HTMLElement>('[data-inspection-run-pointer]');
    assert.ok(initialPointer, 'expected entering setup mode to render the initial pointer cue');

    const professionalModeButton = getSetupModeButton(t.inspectionAdvancedMode);
    assert.ok(
      professionalModeButton,
      'expected the setup mode switcher to render the professional mode',
    );

    await act(async () => {
      professionalModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    });

    const normalModeButton = getSetupModeButton(t.inspectionNormalMode);
    assert.ok(normalModeButton, 'expected the setup mode switcher to render the normal mode');

    await act(async () => {
      normalModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const replayedPointer = container.querySelector<HTMLElement>('[data-inspection-run-pointer]');
    assert.ok(replayedPointer, 'expected switching back to normal mode to keep the cue visible');
    assert.notEqual(
      replayedPointer,
      initialPointer,
      'expected the pointer cue to remount so the animation can replay before the previous cue ends',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup persists the last selected mode across remounts', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.removeItem('urdf-studio.ai-inspection.setup-mode');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  const getButtonByText = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    ) ?? null;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const advancedModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(advancedModeButton, 'expected the advanced mode toggle to render');

    await act(async () => {
      advancedModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      dom.window.localStorage.getItem('urdf-studio.ai-inspection.setup-mode'),
      'advanced',
      'expected mode changes to persist into local storage',
    );

    await act(async () => {
      root.unmount();
    });

    const reopenedRoot = createRoot(container);

    try {
      await act(async () => {
        reopenedRoot.render(
          <AIInspectionModal
            isOpen
            onClose={() => {}}
            robot={createRobotFixture()}
            lang="zh"
            onSelectItem={() => {}}
            onOpenConversationWithReport={() => {}}
          />,
        );
      });

      assert.equal(
        container.textContent?.includes(t.inspectionScoringReference),
        true,
        'expected the remounted setup to restore the last selected advanced mode',
      );
      assert.equal(
        container.textContent?.includes(t.inspectionConfigureChecks),
        false,
        'expected the remounted setup to skip the normal-mode layout when advanced was saved',
      );
    } finally {
      await act(async () => {
        reopenedRoot.unmount();
      });
    }
  } finally {
    dom.window.close();
  }
});

test('inspection setup keeps the mode switcher visually centered in the header', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const modeSwitcher = container.querySelector<HTMLElement>(
      '[data-inspection-setup-mode-switcher]',
    );
    assert.ok(
      modeSwitcher,
      'expected the setup header to render a dedicated mode switcher wrapper',
    );
    assert.equal(
      modeSwitcher.className.includes('absolute left-1/2 top-1/2'),
      true,
      'expected the setup mode switcher to anchor from the visual center of the header',
    );
    assert.equal(
      modeSwitcher.className.includes('-translate-x-1/2 -translate-y-1/2'),
      true,
      'expected the setup mode switcher to translate back from the anchor point for true centering',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup header uses the toolbox AI inspection logo', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const setupHeaderLogo = container.querySelector<HTMLElement>(
      '[data-inspection-setup-header-logo]',
    );
    assert.ok(setupHeaderLogo, 'expected the setup header logo wrapper to render');
    assert.ok(
      setupHeaderLogo.querySelector('svg.lucide-scan-search'),
      'expected the setup header logo to match the toolbox AI inspection ScanSearch icon',
    );
    assert.equal(
      setupHeaderLogo.querySelector('svg.lucide-bot'),
      null,
      'expected the setup header logo to stop rendering the Bot icon',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup header uses the same maximize and restore icons as AI conversation', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const t = translations.zh;

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const maximizeButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t.maximize}"]`,
    );
    assert.ok(maximizeButton, 'expected the setup header maximize button to render');
    assert.ok(
      maximizeButton.querySelector('svg.lucide-maximize-2'),
      'expected the setup header maximize button to use the shared maximize icon',
    );

    await act(async () => {
      maximizeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const restoreButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t.restore}"]`,
    );
    assert.ok(restoreButton, 'expected the setup header restore button to render after maximizing');
    assert.ok(
      restoreButton.querySelector('svg.lucide-minimize-2'),
      'expected the setup header restore button to use the shared restore icon',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('advanced setup summary chip uses content-based width instead of stretching across the footer', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'advanced');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-setup-summary]');
    assert.ok(summaryChip, 'expected the advanced setup footer to render a summary chip wrapper');
    assert.equal(
      summaryChip.className.includes('inline-flex'),
      true,
      'expected the advanced setup summary chip to size to its content',
    );
    assert.equal(
      summaryChip.className.includes('w-fit'),
      true,
      'expected the advanced setup summary chip to stop expanding toward the footer actions',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
