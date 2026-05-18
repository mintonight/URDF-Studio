import assert from 'node:assert/strict';
import test from 'node:test';

import React, { Profiler, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { useRobotStore } from '@/store';
import { useSelectionStore } from '@/store/selectionStore';
import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';
import { TreeNode } from './TreeNode.tsx';

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
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createRobot(): RobotData {
  return {
    name: 'store-driven-robot',
    rootLinkId: 'base_link',
    joints: {},
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        },
      },
      sibling_link: {
        ...DEFAULT_LINK,
        id: 'sibling_link',
        name: 'sibling_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.15, y: 0.15, z: 0.15 },
        },
      },
    },
    materials: {},
    closedLoopConstraints: [],
  };
}

function createMjcfRobotWithGeneratedJointNames(): RobotData {
  return {
    name: 'mjcf-store-driven-robot',
    rootLinkId: 'world',
    joints: {
      world_to_body_0: {
        ...DEFAULT_JOINT,
        id: 'world_to_body_0',
        name: 'world_to_body_0',
        type: JointType.FIXED,
        parentLinkId: 'world',
        childLinkId: 'body_0',
      },
    },
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
      },
      body_0: {
        ...DEFAULT_LINK,
        id: 'body_0',
        name: 'body_0',
      },
    },
    materials: {},
    closedLoopConstraints: [],
    inspectionContext: {
      sourceFormat: 'mjcf',
    },
  };
}

test('store-driven TreeNode uses the store inspection context for MJCF display names', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useRobotStore.getState().resetRobot(createMjcfRobotWithGeneratedJointNames());
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    await act(async () => {
      root.render(
        <TreeNode
          linkId="world"
          storeDriven
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    assert.ok(
      container.querySelector('[title="World to Body 1 · Fixed"]'),
      'store-driven MJCF trees should render friendly generated joint names',
    );
    assert.equal(
      container.querySelector('[title="world_to_body_0 · Fixed"]'),
      null,
      'generated MJCF joint ids should not leak into the structure tree label',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('store-driven TreeNode keeps unrelated siblings from re-rendering on a local link update', async () => {
  const { dom, root } = createComponentRoot();

  try {
    useRobotStore.getState().resetRobot(createRobot());
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const renderCounts = {
      base: 0,
      sibling: 0,
    };

    await act(async () => {
      root.render(
        <>
          <Profiler
            id="base"
            onRender={() => {
              renderCounts.base += 1;
            }}
          >
            <TreeNode
              linkId="base_link"
              storeDriven
              onSelect={() => {}}
              onAddChild={() => {}}
              onAddCollisionBody={() => {}}
              onDelete={() => {}}
              onUpdate={() => {}}
              mode="editor"
              t={translations.en}
            />
          </Profiler>
          <Profiler
            id="sibling"
            onRender={() => {
              renderCounts.sibling += 1;
            }}
          >
            <TreeNode
              linkId="sibling_link"
              storeDriven
              onSelect={() => {}}
              onAddChild={() => {}}
              onAddCollisionBody={() => {}}
              onDelete={() => {}}
              onUpdate={() => {}}
              mode="editor"
              t={translations.en}
            />
          </Profiler>
        </>,
      );
    });

    assert.deepEqual(renderCounts, { base: 1, sibling: 1 });

    await act(async () => {
      useRobotStore.getState().updateLink('base_link', { visible: false });
    });

    assert.ok(renderCounts.base > 1, 'updated link should re-render');
    assert.equal(renderCounts.sibling, 1, 'unrelated sibling should keep its prior render count');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
