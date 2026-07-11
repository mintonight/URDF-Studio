import test from 'node:test'
import assert from 'node:assert/strict'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { translations } from '@/shared/i18n'
import { GeometryType, type RobotState } from '@/types'
import { buildNormalInspectionPlan } from '../utils/inspectionNormalPlan.ts'
import { InspectionSetupNormalView } from './InspectionSetupNormalView.tsx'

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })

  ;(globalThis as { window?: Window }).window = dom.window as unknown as Window
  ;(globalThis as { document?: Document }).document = dom.window.document
  ;(globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement
  ;(globalThis as { Node?: typeof Node }).Node = dom.window.Node
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  return dom
}

const createRobot = (): RobotState =>
  ({
    name: 'normal-plan-robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
      },
    },
    joints: {},
    inspectionContext: { sourceFormat: 'urdf' },
    selection: null,
  }) as unknown as RobotState

test('normal setup view shows the profile recommendation card', async () => {
  const dom = installDom()
  const container = dom.window.document.getElementById('root')
  assert.ok(container, 'root container should exist')

  const root = createRoot(container)
  const plan = buildNormalInspectionPlan({ robot: createRobot() })

  try {
    await act(async () => {
      root.render(
        <InspectionSetupNormalView
          lang="en"
          t={translations.en}
          plan={plan}
          override={{}}
          onOverrideChange={() => {}}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>(
      '[data-inspection-profile-recommendation-card]',
    )
    assert.ok(card, 'expected the recommendation card to render')
    assert.match(
      card.className,
      /\boverflow-hidden\b/,
      'recommendation card should clip child backgrounds to its rounded corners',
    )
    assert.match(card.textContent ?? '', /Recommended Plan/)
    assert.match(card.textContent ?? '', /URDF/)
    assert.match(card.textContent ?? '', /Inspection Purpose/)
    assert.ok(
      card.querySelector('[data-inspection-normal-select="purpose"]'),
      'expected purpose to be editable through a select control',
    )
    assert.ok(
      card.querySelector('[data-inspection-normal-select="targetPlatform"]'),
      'expected target platform to be editable through a select control',
    )
    assert.equal(
      card.querySelector('[data-inspection-profile-adjust-scope]'),
      null,
      'expected the separate adjust-scope action to be removed',
    )
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
  }
})
