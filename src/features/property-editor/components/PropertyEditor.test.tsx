import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { RobotState } from '@/types';
import { GeometryType, JointType } from '@/types';
import { translations } from '@/shared/i18n';
import { PropertyEditor } from './PropertyEditor.tsx';

function createRobot(): RobotState {
  return {
    name: 'demo',
    rootLinkId: 'base_link',
    selection: {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      thigh_link: {
        id: 'thigh_link',
        name: 'thigh_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#0000ff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#0000ff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      hip_joint: {
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'thigh_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: '',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 1,
        tendonCount: 1,
        tendonActuatorCount: 1,
        bodiesWithSites: [
          {
            bodyId: 'base_link',
            siteCount: 1,
            siteNames: ['tool_center'],
          },
        ],
        tendons: [
          {
            name: 'finger_tendon',
            type: 'fixed',
            className: 'main',
            group: 2,
            limited: true,
            range: [0, 1],
            width: 0.03,
            stiffness: 12,
            springlength: 0.2,
            rgba: [0, 1, 0, 1],
            attachmentRefs: ['hip_joint'],
            attachments: [{ type: 'joint', ref: 'hip_joint', coef: 1 }],
            actuatorNames: ['finger_tendon_motor'],
          },
        ],
      },
    },
  };
}

function renderPropertyEditor(selection: RobotState['selection'] = createRobot().selection) {
  const robot = createRobot();
  robot.selection = selection;

  return renderToStaticMarkup(
    React.createElement(PropertyEditor as any, {
      robot,
      onUpdate: () => {},
      mode: 'editor',
      assets: {},
      onUploadAsset: () => {},
      motorLibrary: {},
      lang: 'en',
      theme: 'light',
    }),
  );
}

test('link selection stays link-scoped without rendering embedded joint properties', () => {
  const markup = renderPropertyEditor();

  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
  assert.match(markup, /base_link/);
});

test('link selection keeps the property header scoped to the selected link', () => {
  const markup = renderPropertyEditor();

  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
  assert.match(markup, /base_link/);
});

test('tendon selection renders tendon inspection data without joint property controls', () => {
  const markup = renderPropertyEditor({
    type: 'tendon',
    id: 'finger_tendon',
  });

  assert.match(markup, /finger_tendon/);
  assert.match(markup, /finger_tendon_motor/);
  assert.match(markup, /hip_joint/);
  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
});

test('property editor does not render the shared joints section', () => {
  const markup = renderPropertyEditor();

  assert.doesNotMatch(markup, /Joints/);
});
