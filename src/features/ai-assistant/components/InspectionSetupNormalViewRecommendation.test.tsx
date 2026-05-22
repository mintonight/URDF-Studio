import test from 'node:test'
import assert from 'node:assert/strict'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { translations } from '@/shared/i18n'
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

test('normal setup view shows the profile recommendation card', async () => {
  const dom = installDom()
  const container = dom.window.document.getElementById('root')
  assert.ok(container, 'root container should exist')

  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        <InspectionSetupNormalView
          lang="en"
          t={translations.en}
          selectedProfiles={{}}
          setSelectedProfiles={() => {}}
          onFocusProfile={() => {}}
          recommendation={{
            sourceFormat: 'urdf',
            robotType: 'generic',
            robotTypes: ['generic'],
            targetPlatform: 'generic',
            profileIds: ['base.robot_model', 'format.urdf'],
            confidence: 'medium',
          }}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>(
      '[data-inspection-profile-recommendation-card]',
    )
    assert.ok(card, 'expected the recommendation card to render')
    assert.match(card.textContent ?? '', /Recommended Plan/)
    assert.match(card.textContent ?? '', /URDF/)
    assert.match(card.textContent ?? '', /Robot Model Baseline/)
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
  }
})
