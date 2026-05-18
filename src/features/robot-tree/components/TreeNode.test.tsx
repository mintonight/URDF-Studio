import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import { DEFAULT_LINK, GeometryType, JointType, type RobotState } from '@/types';
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
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub() {};
  }

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

function createRobotWithCollision(): RobotState {
  return {
    name: 'test-robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
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
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.18, y: 0.18, z: 0.18 },
        },
        collisionBodies: [],
      },
    },
    materials: {},
    closedLoopConstraints: [],
  };
}

function createRobotWithChildLink(): RobotState {
  return {
    name: 'child-link-robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      elbow_joint: {
        id: 'elbow_joint',
        name: 'elbow_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'forearm_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: '',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      forearm_link: {
        ...DEFAULT_LINK,
        id: 'forearm_link',
        name: 'forearm_link',
      },
    },
    materials: {},
    closedLoopConstraints: [],
  };
}

function createRobotWithNamedChildLink(jointId: string, childLinkId: string): RobotState {
  const robot = createRobotWithChildLink();
  const joint = robot.joints.elbow_joint;

  return {
    ...robot,
    joints: {
      [jointId]: {
        ...joint,
        id: jointId,
        name: jointId,
        childLinkId,
      },
    },
    links: {
      base_link: robot.links.base_link,
      [childLinkId]: {
        ...robot.links.forearm_link,
        id: childLinkId,
        name: childLinkId,
      },
    },
  };
}

function findButtonByText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | null;
}

function getReactProps(node: Element) {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;

  assert.ok(valueSetter, 'HTMLInputElement value setter should exist');
  valueSetter.call(input, value);
}

function dispatchReactChange(input: HTMLInputElement, value: string) {
  setInputValue(input, value);
  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactBlur(input: HTMLInputElement) {
  const reactProps = getReactProps(input);
  const onBlur = reactProps.onBlur;
  assert.equal(typeof onBlur, 'function', 'React onBlur handler should exist');

  (onBlur as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

test('TreeNode link context menu is portaled and exposes collision add/delete actions', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot = createRobotWithCollision();
    const addedCollisionTargets: string[] = [];

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={(parentId) => {
              addedCollisionTargets.push(parentId);
            }}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const linkRow = container.querySelector('[title="base_link"]') as HTMLDivElement | null;
    assert.ok(linkRow, 'link row should render');

    await act(async () => {
      linkRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 80,
        }),
      );
    });

    const addCollisionButton = findButtonByText(translations.en.addCollisionBody);
    const deleteCollisionButton = findButtonByText(translations.en.deleteCollisionGeometry);

    assert.ok(addCollisionButton, 'right-clicking a link should expose add collision body');
    assert.ok(
      deleteCollisionButton,
      'right-clicking a link with collisions should expose delete collision geometry',
    );
    assert.equal(
      container.contains(addCollisionButton),
      false,
      'context menu should render outside the tree container',
    );
    assert.equal(
      document.body.contains(addCollisionButton),
      true,
      'context menu should be portaled to document.body',
    );

    await act(async () => {
      addCollisionButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedCollisionTargets, ['base_link']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode re-expands a branch when the imported child structure changes under the same link', async () => {
  const { dom, container, root } = createComponentRoot();

  const renderTreeNode = async (robot: RobotState) => {
    await act(async () => {
      root.render(
        <TreeNode
          linkId="base_link"
          robot={robot}
          childJointsByParent={{ base_link: Object.values(robot.joints) }}
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
  };

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const firstRobot = createRobotWithNamedChildLink('first_joint', 'first_child_link');
    await renderTreeNode(firstRobot);

    assert.ok(
      container.querySelector('span[title="first_child_link"]'),
      'initial child branch should render expanded',
    );

    const collapseButton = container.querySelector(
      'button[aria-label="Hide base_link"]',
    ) as HTMLButtonElement | null;
    assert.ok(collapseButton, 'root link should render an expansion toggle');

    await act(async () => {
      collapseButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.equal(
      container.querySelector('span[title="first_child_link"]'),
      null,
      'test setup should collapse the first child branch',
    );

    const importedRobot = createRobotWithNamedChildLink('imported_joint', 'imported_child_link');
    await renderTreeNode(importedRobot);

    assert.ok(
      container.querySelector('span[title="imported_child_link"]'),
      'a new imported branch under the same root link should be expanded',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode keeps a child link visually close to the joint that owns it', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot = createRobotWithChildLink();

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            childJointsByParent={{
              base_link: [robot.joints.elbow_joint],
            }}
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const jointRow = container.querySelector(
      '[title="elbow_joint · Revolute"]',
    ) as HTMLDivElement | null;
    const childLinkRow = container.querySelector('[title="forearm_link"]') as HTMLDivElement | null;
    assert.ok(jointRow, 'joint row should render');
    assert.ok(childLinkRow, 'child link row should render');

    assert.equal(
      childLinkRow.style.marginLeft,
      '3px',
      'joint-owned child links should avoid the older wide nested link indent',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode deleting the selected collision geometry falls back to the parent link selection', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: 'link', id: 'base_link', subType: 'collision', objectIndex: 0 },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot = createRobotWithCollision();
    const updatedLinks: RobotState['links'][string][] = [];

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            showGeometryDetailsByDefault
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={(_type, _id, data) => {
              updatedLinks.push(data as RobotState['links'][string]);
            }}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const collisionRow = container.querySelector(
      `[title="${translations.en.collision}"]`,
    ) as HTMLDivElement | null;
    assert.ok(collisionRow, 'primary collision row should render');

    await act(async () => {
      collisionRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 140,
          clientY: 96,
        }),
      );
    });

    const deleteCollisionButton = findButtonByText(translations.en.deleteCollisionGeometry);
    assert.ok(deleteCollisionButton, 'geometry context menu should expose delete collision action');

    await act(async () => {
      deleteCollisionButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.equal(updatedLinks.length, 1, 'deleting the collision should issue one link update');
    assert.deepEqual(useSelectionStore.getState().selection, { type: 'link', id: 'base_link' });
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode resolves joint selections by joint name so the joint row still highlights', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: 'joint', id: 'elbow_joint_name' },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot: RobotState = {
      name: 'named-joint-robot',
      rootLinkId: 'base_link',
      selection: { type: null, id: null },
      joints: {
        elbow_joint_id: {
          id: 'elbow_joint_id',
          name: 'elbow_joint_name',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'forearm_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          axis: { x: 0, y: 0, z: 1 },
          limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: {
            armature: 0,
            motorType: '',
            motorId: '',
            motorDirection: 1,
          },
        },
      },
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
        forearm_link: {
          ...DEFAULT_LINK,
          id: 'forearm_link',
          name: 'forearm_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
          },
        },
      },
      materials: {},
      closedLoopConstraints: [],
    };

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            childJointsByParent={{
              base_link: [robot.joints.elbow_joint_id],
            }}
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const jointRow = container.querySelector(
      '[title="elbow_joint_name · Revolute"]',
    ) as HTMLDivElement | null;
    assert.ok(jointRow, 'joint row should render');
    assert.match(
      jointRow.className,
      /bg-system-blue\/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue\/20/,
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode opens joint rename input when the joint row is double-clicked', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot: RobotState = {
      name: 'joint-rename-robot',
      rootLinkId: 'base_link',
      selection: { type: null, id: null },
      joints: {
        elbow_joint: {
          id: 'elbow_joint',
          name: 'elbow_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'forearm_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          axis: { x: 0, y: 0, z: 1 },
          limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: {
            armature: 0,
            motorType: '',
            motorId: '',
            motorDirection: 1,
          },
        },
      },
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
        forearm_link: {
          ...DEFAULT_LINK,
          id: 'forearm_link',
          name: 'forearm_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
          },
        },
      },
      materials: {},
      closedLoopConstraints: [],
    };

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            childJointsByParent={{
              base_link: [robot.joints.elbow_joint],
            }}
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const jointRow = container.querySelector(
      '[title="elbow_joint · Revolute"]',
    ) as HTMLDivElement | null;
    assert.ok(jointRow, 'joint row should render');

    await act(async () => {
      jointRow.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'joint rename input should render on row double click');
    assert.equal(renameInput.value, 'elbow_joint');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode collision rows support right-click rename and persist the edited name', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    function ControlledCollisionRenameHarness() {
      const [robot, setRobot] = React.useState<RobotState>(() => {
        const nextRobot = createRobotWithCollision();
        nextRobot.links.base_link.collision.name = 'base_collision';
        nextRobot.links.base_link.collisionBodies = [
          {
            type: GeometryType.SPHERE,
            name: 'motor_guard',
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#00ff00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ];
        return nextRobot;
      });

      return (
        <TreeNode
          linkId="base_link"
          robot={robot}
          showGeometryDetailsByDefault
          onSelect={() => {}}
          onSelectGeometry={(linkId, subType, objectIndex = 0) => {
            useSelectionStore
              .getState()
              .setSelection({ type: 'link', id: linkId, subType, objectIndex });
          }}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={(type, id, data) => {
            if (type !== 'link' || id !== 'base_link') {
              return;
            }
            setRobot((prev) => ({
              ...prev,
              links: {
                ...prev.links,
                base_link: data as RobotState['links'][string],
              },
            }));
          }}
          mode="editor"
          t={translations.en}
        />
      );
    }

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <ControlledCollisionRenameHarness />
        </div>,
      );
    });

    const collisionRow = container.querySelector(
      '[title="base_collision"]',
    ) as HTMLDivElement | null;
    assert.ok(collisionRow, 'named collision row should render');

    await act(async () => {
      collisionRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 140,
          clientY: 96,
        }),
      );
    });

    const renameButton = findButtonByText(translations.en.rename);
    assert.ok(renameButton, 'geometry context menu should expose rename');

    await act(async () => {
      renameButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const renameInput = container.querySelector(
      'input[value="base_collision"]',
    ) as HTMLInputElement | null;
    assert.ok(renameInput, 'collision row should switch to inline rename mode');

    await act(async () => {
      dispatchReactChange(renameInput, 'torso_shell');
    });

    await act(async () => {
      dispatchReactBlur(renameInput);
    });

    const renamedCollisionRow = container.querySelector(
      '[title="torso_shell"]',
    ) as HTMLDivElement | null;
    assert.ok(renamedCollisionRow, 'renamed collision row should render with the updated name');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode geometry eye icons reflect inherited hidden state from the parent link', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });

    const robot = createRobotWithCollision();
    robot.links.base_link.visible = false;
    robot.links.base_link.visual.visible = true;
    robot.links.base_link.collision.visible = true;

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            showGeometryDetailsByDefault
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    const visualRow = container.querySelector(
      `[title="${translations.en.visualGeometry}"]`,
    ) as HTMLDivElement | null;
    const collisionRow = container.querySelector(
      `[title="${translations.en.collision}"]`,
    ) as HTMLDivElement | null;
    assert.ok(visualRow, 'visual row should render');
    assert.ok(collisionRow, 'collision row should render');

    const visualButton = visualRow.querySelector(
      'button[data-visibility-source]',
    ) as HTMLButtonElement | null;
    const collisionButton = collisionRow.querySelector(
      'button[data-visibility-source]',
    ) as HTMLButtonElement | null;
    assert.ok(visualButton, 'visual row should expose a visibility button');
    assert.ok(collisionButton, 'collision row should expose a visibility button');

    assert.equal(visualButton.dataset.visibilitySource, 'inherited');
    assert.equal(collisionButton.dataset.visibilitySource, 'inherited');
    assert.match(visualButton.innerHTML, /eye-off/i);
    assert.match(collisionButton.innerHTML, /eye-off/i);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNode relocates geometry attention to the parent link row', async () => {
  const { dom, root } = createComponentRoot();
  const scrollTargets: string[] = [];
  const originalScrollIntoView = dom.window.HTMLElement.prototype.scrollIntoView;
  const originalRequestAnimationFrame = dom.window.requestAnimationFrame;

  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewSpy() {
    scrollTargets.push(this.getAttribute('title') ?? this.textContent?.trim() ?? '');
  };
  dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof dom.window.requestAnimationFrame;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);

  try {
    useSelectionStore.setState({
      selection: { type: 'link', id: 'base_link', subType: 'collision', objectIndex: 0 },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: 'link', id: 'base_link', subType: 'collision', objectIndex: 0 },
      focusTarget: null,
    });

    const robot = createRobotWithCollision();

    await act(async () => {
      root.render(
        <div style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}>
          <TreeNode
            linkId="base_link"
            robot={robot}
            showGeometryDetailsByDefault
            onSelect={() => {}}
            onAddChild={() => {}}
            onAddCollisionBody={() => {}}
            onDelete={() => {}}
            onUpdate={() => {}}
            mode="editor"
            t={translations.en}
          />
        </div>,
      );
    });

    assert.match(scrollTargets.at(-1) ?? '', /^base_link/);
    assert.equal(
      dom.window.document.querySelector(`[title="${translations.en.visualGeometry}"]`),
      null,
      'geometry attention should relocate to the link without expanding the visual row',
    );
    assert.equal(
      dom.window.document.querySelector(`[title="${translations.en.collision}"]`),
      null,
      'geometry attention should relocate to the link without expanding the collision row',
    );
  } finally {
    dom.window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    dom.window.requestAnimationFrame = originalRequestAnimationFrame;
    (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
      dom.window.requestAnimationFrame.bind(dom.window);
    await destroyComponentRoot(dom, root);
  }
});
