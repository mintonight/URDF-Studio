import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { DEFAULT_MANAGED_WINDOW_ORDER, useUIStore } from '@/store';
import {
  __setPdfCanvasFactoryForTests,
  __setPdfGenerationDepsLoaderForTests,
} from '@/features/file-io/utils/generatePdfFromHtml';
import { INSPECTION_PROFILE_DEFINITIONS } from '../config/inspectionProfiles';
import { buildInspectionProfileRecommendation } from '../utils/inspectionProfileRecommendation';
import { buildNormalInspectionPlan } from '../utils/inspectionNormalPlan';
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
  inspectionContext: undefined,
  selection: { type: 'link', id: 'base_link' },
});

const createHumanoidMeshRobotFixture = (): RobotState => {
  const robot = createRobotFixture();
  robot.name = 'humanoid_biped_mesh_robot';
  robot.inspectionContext = { sourceFormat: 'mesh' };
  robot.links.base_link.name = 'pelvis';
  robot.links.base_link.visual.type = GeometryType.MESH;
  robot.links.base_link.visual.meshPath = 'meshes/pelvis.stl';
  robot.links.left_foot = {
    ...robot.links.base_link,
    id: 'left_foot',
    name: 'left_foot',
  };
  robot.links.right_foot = {
    ...robot.links.base_link,
    id: 'right_foot',
    name: 'right_foot',
  };
  robot.joints.left_hip_pitch = {
    ...robot.joints.hip_joint,
    id: 'left_hip_pitch',
    name: 'left_hip_pitch',
    parentLinkId: 'base_link',
    childLinkId: 'left_foot',
  };
  robot.joints.right_hip_pitch = {
    ...robot.joints.hip_joint,
    id: 'right_hip_pitch',
    name: 'right_hip_pitch',
    parentLinkId: 'base_link',
    childLinkId: 'right_foot',
  };
  return robot;
};

function getProfileItemCount(profileIds: string[]) {
  return INSPECTION_PROFILE_DEFINITIONS.filter((profile) => profileIds.includes(profile.id)).reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
}

function getRecommendedSelectedItemCount(robot: RobotState = createRobotFixture()) {
  return getProfileItemCount(buildInspectionProfileRecommendation(robot).profileIds);
}

function getNormalPlanSelectedItemCount(robot: RobotState = createRobotFixture()) {
  return Object.values(buildNormalInspectionPlan({ robot }).selectedProfiles).reduce(
    (sum, itemIds) => sum + itemIds.size,
    0,
  );
}

function getNormalProfileRow(container: Element, index = 0): HTMLButtonElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-inspection-normal-profile-row]'),
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

test('AIInspectionModal moves to the front when activated', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
    });

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={createRobotFixture()}
          lang="en"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    const initialZIndex = String(useUIStore.getState().getManagedWindowZIndex('aiInspection'));
    const windowRoot = Array.from(container.querySelectorAll<HTMLDivElement>('div')).find(
      (element) => element.style.zIndex === initialZIndex,
    );
    assert.ok(windowRoot, 'inspection window should render with dynamic z-index');
    assert.equal(windowRoot.className.includes('z-[100]'), false);
    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('sourceCode') >
        useUIStore.getState().getManagedWindowZIndex('aiInspection'),
      'source code should start above AI inspection in the default order',
    );

    await act(async () => {
      windowRoot.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });

    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('aiInspection') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'activated AI inspection window should move above source code',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
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
      confirmDialog.className.includes('z-[260]'),
      true,
      'expected regenerate confirmation dialog to render above managed windows',
    );
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
      container.textContent?.includes(t.inspectionRecommendedPlan),
      true,
      'expected confirming regenerate to return to the setup view',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      false,
      'expected the previously selected normal mode to remain active after returning to setup',
    );

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    assert.ok(summaryChip, 'expected the setup summary chip to render after confirming regenerate');
    assert.match(
      summaryChip.textContent ?? '',
      /已选择 \d+\/\d+ 项检查/,
      'expected the normal inspection plan selection to be restored after confirming regenerate',
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

test('inspection setup keeps selected checks in sync with updated recommended profiles', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const genericRobot = createRobotFixture();
  const humanoidMeshRobot = createHumanoidMeshRobotFixture();
  const t = translations.zh;
  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
  const expectedUpdatedSelectedCount = getNormalPlanSelectedItemCount(humanoidMeshRobot);

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={genericRobot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={humanoidMeshRobot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.equal(
      container.textContent?.includes('Mesh 资产检查'),
      true,
      'expected the recommendation card to show the updated mesh asset profile',
    );
    assert.equal(
      container.textContent?.includes('双足机器人检查'),
      true,
      'expected the recommendation card to show the updated biped profile',
    );
    assert.ok(
      Array.from(container.querySelectorAll<HTMLElement>('[data-inspection-normal-profile]')).find(
        (section) => section.textContent?.includes('Mesh 资产检查'),
      ),
      'expected the mesh asset profile row to render in the generated plan',
    );

    const summaryChip = container.querySelector<HTMLElement>('[data-inspection-normal-summary]');
    assert.ok(summaryChip, 'expected the normal setup summary chip to render');
    assert.equal(
      summaryChip.textContent?.includes(
        t.inspectionSelectedChecksSummary
          .replace('{selected}', String(expectedUpdatedSelectedCount))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected selected checks to match the updated recommendation profile set',
    );
  } finally {
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
      container.textContent?.includes(t.inspectionRecommendedPlan),
      true,
      'expected the saved normal mode to render the simplified setup heading',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      false,
      'expected the normal mode to hide the professional run summary',
    );
    assert.equal(
      container.textContent?.includes('请切换到专业模式'),
      true,
      'expected the normal mode setup description to reference professional mode',
    );
    assert.equal(
      container.textContent?.includes('切换到高级模式'),
      false,
      'expected the outdated advanced-mode wording to be removed from the normal mode description',
    );

    const advancedModeButton = getButtonByText(t.inspectionAdvancedMode);
    assert.ok(advancedModeButton, 'expected the advanced mode toggle to render');

    await act(async () => {
      advancedModeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      true,
      'expected the professional mode to restore the run summary',
    );
    assert.ok(
      container.textContent?.includes(t.inspectionRunSummary),
      'expected advanced mode to restore its recommended profile selection summary',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('professional setup sidebar is collapsed by default during selection', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'advanced');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
  const robot = createRobotFixture();
  const recommendedProfileIds = buildNormalInspectionPlan({ robot }).includedProfileIds;
  const firstRecommendedProfile = INSPECTION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === recommendedProfileIds[0],
  );
  assert.ok(firstRecommendedProfile, 'expected the fixture to recommend at least one profile');

  try {
    await act(async () => {
      root.render(
        <AIInspectionModal
          isOpen
          onClose={() => {}}
          robot={robot}
          lang="zh"
          onSelectItem={() => {}}
          onOpenConversationWithReport={() => {}}
        />,
      );
    });

    assert.ok(
      container.querySelector('[data-inspection-setup-sidebar-collapsed]'),
      'expected professional mode selection to render the collapsed sidebar rail by default',
    );
    assert.equal(
      container.querySelector('[data-inspection-sidebar]'),
      null,
      'expected professional mode selection to avoid rendering the full sidebar by default',
    );
    assert.equal(
      container
        .querySelector('[data-inspection-setup-sidebar-collapsed]')
        ?.textContent?.includes(firstRecommendedProfile.nameZh),
      false,
      'expected collapsed professional setup sidebar to hide profile headings by default',
    );

    const expandSidebarButton = container.querySelector<HTMLButtonElement>(
      `[aria-label="${translations.zh.expand} ${translations.zh.inspectionItems}"]`,
    );
    assert.ok(expandSidebarButton, 'expected collapsed sidebar rail to expose an expand button');

    await act(async () => {
      expandSidebarButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container
        .querySelector('[data-inspection-sidebar]')
        ?.textContent?.includes(firstRecommendedProfile.nameZh),
      true,
      'expected expanding the professional setup sidebar to reveal profile headings',
    );
    assert.ok(
      container.querySelector('[data-inspection-sidebar-layer]'),
      'expected the expanded sidebar to keep the layer-grouped profile optimization',
    );
    assert.equal(
      container.querySelector('[data-inspection-sidebar-item-list]'),
      null,
      'expected profile sections inside the expanded professional sidebar to stay collapsed by default',
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
  const initialSelectedItemCount = getNormalPlanSelectedItemCount();
  const firstProfile = INSPECTION_PROFILE_DEFINITIONS[0];
  const firstItem = firstProfile?.items[0];
  assert.ok(firstProfile, 'expected inspection profiles to include at least one profile');
  assert.ok(firstItem, 'expected the first profile to include at least one item');

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
      `[data-inspection-setup-item-badge="${firstProfile!.id}:${firstItem!.id}"]`,
    );
    assert.ok(badge, 'expected the focused item badge button to render');
    assert.equal(badge.textContent?.trim(), t.inspectionIncluded);
    assert.equal(badge.getAttribute('aria-pressed'), 'true');

    await act(async () => {
      badge!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.trim(), t.inspectionSkipped);
    assert.equal(badge!.getAttribute('aria-pressed'), 'false');

    const summaryText = t.inspectionSelectedChecks.replace(
      '{count}',
      String(initialSelectedItemCount - 1),
    );
    assert.equal(
      container.textContent?.includes(summaryText),
      true,
      'expected the professional-mode summary to reflect the deselected item',
    );
    assert.equal(
      container.textContent?.includes('用户排除推荐'),
      true,
      'expected the deselected recommended item to be marked as user-excluded from the recommendation',
    );

    const restoreProfileButton = getButtonByText('恢复本 Profile 推荐');
    assert.ok(restoreProfileButton, 'expected profile-level recommendation restore action');

    await act(async () => {
      restoreProfileButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(badge!.textContent?.trim(), t.inspectionIncluded);
    assert.equal(
      container.textContent?.includes('用户排除推荐'),
      false,
      'expected restoring the focused profile recommendation to clear the user-excluded badge',
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
  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
  const initialSelectedItemCount = getNormalPlanSelectedItemCount();

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
          .replace('{selected}', String(initialSelectedItemCount))
          .replace('{total}', String(totalItemCount)),
      ),
      true,
      'expected the inline summary to reflect the recommended default profile selection',
    );

    assert.equal(
      container.querySelector('[data-inspection-normal-action]'),
      null,
      'expected normal mode to avoid manual bulk actions',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode adjustment keeps the generated plan runnable', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.setItem('urdf-studio.ai-inspection.setup-mode', 'normal');

  const { AIInspectionModal } = await import('./AIInspectionModal.tsx');
  const root = createRoot(container);
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
    assert.ok(getRunButton(), 'expected the normal mode run button to render');
    assert.equal(getRunButton()?.disabled, false, 'expected run inspection to start enabled');

    const adjustButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-profile-adjust-scope]',
    );
    assert.ok(adjustButton, 'expected the normal mode adjustment action to render');

    await act(async () => {
      adjustButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const gazeboButton = getButtonByText('Gazebo');
    assert.ok(gazeboButton, 'expected target-platform correction controls to render');

    await act(async () => {
      gazeboButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      container.textContent?.includes('Gazebo'),
      true,
      'expected the normal plan summary to reflect the corrected target platform',
    );
    assert.equal(
      getRunButton()?.disabled,
      false,
      'expected target correction to keep running the inspection enabled',
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
    assert.equal(actionButtons.length, 0, 'expected normal mode to omit manual bulk actions');

    const scanList = container.querySelector<HTMLElement>('[data-inspection-normal-scan-list]');
    assert.ok(scanList, 'expected normal mode to render the scan queue list container');
    assert.equal(
      scanList.className.includes('divide-y'),
      true,
      'expected the scan queue to use divided rows instead of a card grid',
    );

    const firstProfileCard = container.querySelector<HTMLElement>(
      '[data-inspection-normal-profile]',
    );
    assert.ok(firstProfileCard, 'expected a normal mode profile section to render');
    assert.equal(
      firstProfileCard.className.includes('rounded-xl'),
      true,
      'expected the normal mode profile section to keep the tighter panel radius',
    );
    assert.equal(
      firstProfileCard.className.includes('border-0'),
      true,
      'expected individual profile sections to stop rendering standalone card borders',
    );

    const profileIcon = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-profile-icon]',
    );
    assert.ok(profileIcon, 'expected the profile card icon wrapper to render');
    assert.equal(
      profileIcon.className.includes('h-9 w-9'),
      true,
      'expected the profile icon wrapper to use the compact profile scale',
    );

    const firstProfileRow = firstProfileCard.querySelector<HTMLButtonElement>(
      '[data-inspection-normal-profile-row]',
    );
    assert.ok(firstProfileRow, 'expected each profile to render a scan queue row');
    assert.equal(
      firstProfileRow.className.includes('grid-cols-[auto_auto_minmax(0,1fr)_auto]'),
      true,
      'expected the profile row to use inclusion, icon, content, and disclosure columns',
    );

    const firstProfileProgress = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-profile-progress]',
    );
    assert.ok(
      firstProfileProgress,
      'expected each profile row to expose a compact scan progress indicator',
    );
    assert.equal(
      firstProfileProgress.style.width,
      '100%',
      'expected a fully selected profile to render a full progress indicator',
    );

    const firstProfileCount = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-profile-count]',
    );
    assert.ok(firstProfileCount, 'expected each profile row to render selected/total counts');
    assert.equal(
      firstProfileCount.className.includes('tabular-nums'),
      true,
      'expected profile counts to use aligned tabular numbers',
    );

    assert.equal(
      firstProfileRow.getAttribute('aria-expanded'),
      'false',
      'expected normal mode profiles to be collapsed by default',
    );
    assert.equal(
      firstProfileCard.querySelector('[data-inspection-normal-item-list]'),
      null,
      'expected collapsed normal mode profiles to hide item-level controls by default',
    );

    const selectedSummary = container.querySelector<HTMLElement>(
      '[data-inspection-normal-summary]',
    );
    assert.ok(selectedSummary, 'expected the normal mode summary to render');
    const initialSelectedSummaryText = selectedSummary.textContent;
    const profileSelectionControl = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-profile-selection]',
    );
    assert.ok(
      profileSelectionControl,
      'expected each profile to expose a read-only inclusion marker',
    );
    const profileSelectionMark = profileSelectionControl.querySelector<HTMLElement>(
      '[data-inspection-normal-selection-mark]',
    );
    assert.ok(profileSelectionMark, 'expected the profile marker to render a selection mark');
    assert.equal(
      profileSelectionMark.className.includes('bg-system-blue/80'),
      true,
      'expected included profile markers to use the lighter normal-mode blue',
    );
    assert.equal(
      profileSelectionMark.className.includes('bg-system-blue-solid'),
      false,
      'expected included profile markers to avoid the deeper solid-blue fill',
    );

    await act(async () => {
      firstProfileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstProfileRow.getAttribute('aria-expanded'),
      'true',
      'expected clicking the profile row to expand item-level controls',
    );
    assert.equal(
      selectedSummary.textContent,
      initialSelectedSummaryText,
      'expected clicking the profile row to leave selected item counts unchanged',
    );

    await act(async () => {
      firstProfileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstProfileRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the profile row again to collapse item-level controls',
    );

    await act(async () => {
      firstProfileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const itemList = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-item-list]',
    );
    assert.ok(itemList, 'expected expanded scan rows to reveal compact item-level controls');

    const firstItemRow = firstProfileCard.querySelector<HTMLElement>(
      '[data-inspection-normal-item]',
    );
    assert.ok(firstItemRow, 'expected a normal mode item row to render');
    assert.equal(
      firstItemRow.className.includes('rounded-md'),
      true,
      'expected the normal mode item rows to use a tighter scan-list item shape',
    );

    assert.equal(
      firstItemRow.className.includes('border-system-blue/15'),
      true,
      'expected normal mode item rows to keep an included-state border',
    );
    assert.equal(
      firstItemRow.className.includes('bg-system-blue/5'),
      true,
      'expected normal mode item rows to render as read-only included entries',
    );

    await act(async () => {
      firstProfileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(
      firstProfileRow.getAttribute('aria-expanded'),
      'false',
      'expected clicking the expanded profile row to collapse item-level controls',
    );
    assert.equal(
      selectedSummary.textContent,
      initialSelectedSummaryText,
      'expected collapsing the profile row to leave selected item counts unchanged',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('inspection setup normal mode exposes correction controls through a low-priority action', async () => {
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

    const adjustButton = container.querySelector<HTMLButtonElement>(
      '[data-inspection-profile-adjust-scope]',
    );

    assert.ok(adjustButton, 'expected the normal plan adjustment action to render');
    assert.equal(
      adjustButton.className.includes('bg-element-bg') &&
        adjustButton.className.includes('text-text-secondary'),
      true,
      'expected adjustment to use low-priority secondary styling',
    );
    assert.equal(
      container.querySelector('[data-inspection-normal-action]'),
      null,
      'expected the old bulk-selection actions to stay out of normal mode',
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
        setTimeout(resolve, 360);
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
        setTimeout(resolve, 100);
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
        container.textContent?.includes(t.inspectionRunSummary),
        true,
        'expected the remounted setup to restore the last selected professional mode',
      );
      assert.equal(
        container.textContent?.includes(t.inspectionRecommendedPlan),
        true,
        'expected the remounted professional setup to still show the recommended plan',
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

test('inspection setup defaults to normal mode when no saved mode exists', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  dom.window.localStorage.removeItem('urdf-studio.ai-inspection.setup-mode');

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

    assert.equal(
      container.textContent?.includes(t.inspectionRecommendedPlan),
      true,
      'expected first-time setup to enter normal mode',
    );
    assert.ok(
      container.querySelector('[data-inspection-normal-summary]'),
      'expected the normal-mode summary to render on first open',
    );
    assert.equal(
      container.textContent?.includes(t.inspectionRunSummary),
      false,
      'expected first-time setup to skip the advanced-mode layout',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
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
