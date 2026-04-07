import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'node:util';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GeometryType, type UrdfLink } from '@/types';
import { useSelectionStore } from '@/store/selectionStore';
import { GeometryRenderer, shouldGeometryCastShadows } from './GeometryRenderer';

function withSilencedR3fDomWarnings(run: () => string) {
  const originalConsoleError = console.error;
  const expectedWarnings = [
    'Received `true` for a non-boolean attribute `visible`.',
    'React does not recognize the `userData` prop on a DOM element.',
    '<boxGeometry /> is using incorrect casing.',
    'React does not recognize the `castShadow` prop on a DOM element.',
    'React does not recognize the `receiveShadow` prop on a DOM element.',
  ];

  console.error = (...args: unknown[]) => {
    const message = format(...args);
    if (expectedWarnings.some((warning) => message.includes(warning))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    return run();
  } finally {
    console.error = originalConsoleError;
  }
}

function createLink(): UrdfLink {
  return {
    id: 'base_link',
    name: 'base_link',
    visible: true,
    visual: {
      type: GeometryType.BOX,
      dimensions: { x: 0.4, y: 0.3, z: 0.2 },
      color: '#6b7280',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    visualBodies: [],
    collision: {
      type: GeometryType.BOX,
      dimensions: { x: 0.2, y: 0.2, z: 0.2 },
      color: '#a855f7',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collisionBodies: [],
    inertial: {
      mass: 1,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
    },
  };
}

test('GeometryRenderer renders editor visual geometry without unresolved legacy refs', () => {
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearSelection();

  const markup = withSilencedR3fDomWarnings(() =>
    renderToStaticMarkup(
      React.createElement(GeometryRenderer, {
        isCollision: false,
        link: createLink(),
        mode: 'editor',
        showGeometry: true,
        showCollision: true,
        modelOpacity: 1,
        interactionLayerPriority: ['visual'],
        assets: {},
        isSelected: false,
        onLinkClick: () => {},
      }),
    ),
  );

  assert.match(markup, /boxgeometry/i);
  assert.match(markup, /group/i);
  assert.equal(shouldGeometryCastShadows(false), true);
});

test('GeometryRenderer hides collision geometry when the parent link is hidden', () => {
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearSelection();

  const hiddenLink = createLink();
  hiddenLink.visible = false;

  const markup = withSilencedR3fDomWarnings(() =>
    renderToStaticMarkup(
      React.createElement(GeometryRenderer, {
        isCollision: true,
        link: hiddenLink,
        mode: 'editor',
        showGeometry: true,
        showCollision: true,
        modelOpacity: 1,
        interactionLayerPriority: ['collision'],
        assets: {},
        isSelected: false,
        onLinkClick: () => {},
      }),
    ),
  );

  assert.equal(markup, '');
});

test('GeometryRenderer keeps collision primitives out of the shadow pass', () => {
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearSelection();

  const markup = withSilencedR3fDomWarnings(() =>
    renderToStaticMarkup(
      React.createElement(GeometryRenderer, {
        isCollision: true,
        link: createLink(),
        mode: 'editor',
        showGeometry: true,
        showCollision: true,
        modelOpacity: 1,
        interactionLayerPriority: ['collision'],
        assets: {},
        isSelected: false,
        onLinkClick: () => {},
      }),
    ),
  );

  assert.equal(shouldGeometryCastShadows(true), false);
});

test('GeometryRenderer keeps collision primitives visible even when mesh readiness tracking is active', () => {
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearSelection();

  const markup = withSilencedR3fDomWarnings(() =>
    renderToStaticMarkup(
      React.createElement(GeometryRenderer, {
        isCollision: true,
        link: createLink(),
        mode: 'editor',
        showGeometry: true,
        showCollision: true,
        modelOpacity: 1,
        interactionLayerPriority: ['collision'],
        assets: {},
        readyCollisionMeshLoadKeys: new Set<string>(),
        isSelected: false,
        onLinkClick: () => {},
      }),
    ),
  );

  assert.match(markup, /boxgeometry/i);
});

test('GeometryRenderer defers visible collision mesh rendering until the mesh is ready', () => {
  useSelectionStore.getState().clearHover();
  useSelectionStore.getState().clearSelection();

  const collisionMeshLink = createLink();
  collisionMeshLink.collision = {
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#a855f7',
    meshPath: 'meshes/collision.stl',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  };

  const markup = withSilencedR3fDomWarnings(() =>
    renderToStaticMarkup(
      React.createElement(GeometryRenderer, {
        isCollision: true,
        link: collisionMeshLink,
        mode: 'editor',
        showGeometry: true,
        showCollision: true,
        modelOpacity: 1,
        interactionLayerPriority: ['collision'],
        assets: {
          'meshes/collision.stl': 'blob:collision',
        },
        readyCollisionMeshLoadKeys: new Set<string>(),
        isSelected: false,
        onLinkClick: () => {},
      }),
    ),
  );

  assert.equal(markup, '');
});
