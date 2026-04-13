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

    const firstItemButton = getButtonByText(firstItem!.nameZh);
    assert.ok(firstItemButton, 'expected the normal mode item button to render');

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

    const modeSwitcher = container.querySelector<HTMLElement>('[data-inspection-setup-mode-switcher]');
    assert.ok(modeSwitcher, 'expected the setup header to render a dedicated mode switcher wrapper');
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
