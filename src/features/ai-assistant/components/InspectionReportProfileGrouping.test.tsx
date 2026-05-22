import test from 'node:test'
import assert from 'node:assert/strict'

import type { InspectionReport } from '@/types'
import { buildInspectionProfileSections } from './InspectionReport.tsx'

test('buildInspectionProfileSections groups report issues by executable profile items', () => {
  const issues: InspectionReport['issues'] = [
    {
      type: 'warning',
      title: 'Invalid inertia',
      description: 'Mass should be positive.',
      profileId: 'base.physical_plausibility',
      itemId: 'mass_positive',
      score: 4,
    },
    {
      type: 'error',
      title: 'URDF root missing',
      description: 'The root contract is invalid.',
      profileId: 'format.urdf',
      itemId: 'urdf_robot_root',
      score: 0,
    },
  ]

  const sections = buildInspectionProfileSections(issues, 'en', {
    'base.physical_plausibility': 4,
    'format.urdf': 0,
  })

  assert.deepEqual(
    sections.map((section) => section.profileId),
    ['base.physical_plausibility', 'format.urdf'],
  )
  assert.equal(sections[0]?.profileName, 'Physical Plausibility')
  assert.equal(sections[0]?.itemGroups[0]?.itemId, 'mass_positive')
  assert.equal(sections[0]?.profileScore, 4)
})
