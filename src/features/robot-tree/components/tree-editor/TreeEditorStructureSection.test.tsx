import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createSingleComponentWorkspace } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { DEFAULT_LINK, type RobotData } from '@/types';
import { TreeEditorStructureSection } from './TreeEditorStructureSection';

function createWorkspace() {
  const robot: RobotData = {
    name: 'demo',
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
  return createSingleComponentWorkspace(robot, {
    componentId: 'demo-component',
    componentName: 'demo',
    sourceFile: 'robots/demo.urdf',
  });
}

function createMultiWorkspace() {
  const workspace = createWorkspace();
  workspace.components.second = {
    ...structuredClone(workspace.components['demo-component']!),
    id: 'second',
    name: 'second',
  };
  return workspace;
}

test('structure header preserves legacy file-path and stateful action styling', () => {
  const markup = renderToStaticMarkup(
    <TreeEditorStructureSection
      workspace={createWorkspace()}
      activeComponentId="demo-component"
      isOpen
      structureTreeShowGeometryDetails
      showVisual
      showStructureFilePath
      currentFileName="robots/demo.urdf"
      mode="editor"
      t={translations.en}
      onToggleOpen={() => {}}
      onToggleGeometryDetails={() => {}}
      onAddChildFromSelection={() => {}}
      onToggleVisuals={() => {}}
      onAddChild={() => {}}
      onAddCollisionBody={() => {}}
      onDelete={() => {}}
      onUpdate={() => {}}
    />,
  );

  assert.match(markup, /lucide-file-code/);
  assert.match(markup, /value="robots\/demo\.urdf"/);
  assert.match(markup, /ring-border-black\/60/);
  assert.match(markup, /bg-system-blue-solid/);
  assert.match(markup, /title="Open Structure Graph"/);
  assert.match(markup, /title="Hide Geometry Details"/);
  assert.ok(markup.includes(`title="${translations.en.addChildLink}"`));
  assert.match(markup, /title="Hide All Visuals"/);
});

test('multi-component header keeps robot-wide add and visibility actions hidden', () => {
  const markup = renderToStaticMarkup(
    <TreeEditorStructureSection
      workspace={createMultiWorkspace()}
      activeComponentId="demo-component"
      isOpen
      structureTreeShowGeometryDetails={false}
      showVisual
      mode="editor"
      t={translations.en}
      onToggleOpen={() => {}}
      onToggleGeometryDetails={() => {}}
      onAddChildFromSelection={() => {}}
      onToggleVisuals={() => {}}
      onAddChild={() => {}}
      onAddCollisionBody={() => {}}
      onDelete={() => {}}
      onUpdate={() => {}}
    />,
  );

  assert.equal(markup.includes(`title="${translations.en.addChildLink}"`), false);
  assert.equal(markup.includes(`title="${translations.en.hideAllVisuals}"`), false);
  assert.match(markup, new RegExp(`title="${translations.en.openStructureGraph}"`));
});
