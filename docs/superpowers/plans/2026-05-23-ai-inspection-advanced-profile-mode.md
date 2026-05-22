# AI Inspection Advanced Profile Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework AI inspection advanced mode so it always shows the recommended plan, groups profiles by layer, and explains deviations between current selection and the recommendation.

**Architecture:** Keep the existing `AIInspectionModal` execution path and `SelectedInspectionProfiles` state as the source of truth. Add pure view-model utilities for recommendation deviation and layer/profile/item summaries, then wire those summaries into a compact recommendation banner, a layer-tree sidebar, and item-level relation badges. The final inspection run still uses `selectedProfiles -> toSelectedInspectionProfileMap -> runRobotInspection`.

**Tech Stack:** React 19, TypeScript 5.8, Zustand state inputs, Vite test setup, Node `tsx --test`, Tailwind CSS semantic tokens, lucide-react icons.

---

## File Structure

- Modify: `src/features/ai-assistant/utils/inspectionProfileSelection.ts`
  - Add clone/equality/profile-restore helpers for `SelectedInspectionProfiles`.
- Create: `src/features/ai-assistant/utils/inspectionProfileSelection.test.ts`
  - Unit tests for clone/equality/restore helpers.
- Create: `src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.ts`
  - Pure summary/deviation model for advanced mode.
- Create: `src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts`
  - Unit tests for layer/profile/item relation summaries.
- Create: `src/features/ai-assistant/components/InspectionRecommendationBanner.tsx`
  - Compact advanced-mode recommended plan banner.
- Modify: `src/features/ai-assistant/components/InspectionSidebar.tsx`
  - Replace setup-mode flat profile list with layer tree while preserving read-only report navigation.
- Modify: `src/features/ai-assistant/components/InspectionSetupView.tsx`
  - Add profile-level restore controls and item recommendation relation badges.
- Modify: `src/features/ai-assistant/components/AIInspectionModal.tsx`
  - Provide recommended baseline, restore handlers, banner, and new props.
- Modify: `src/features/ai-assistant/components/AIInspectionModal.test.tsx`
  - Cover advanced-mode recommendation visibility and restore behavior.
- Modify: `src/features/ai-assistant/components/InspectionSidebar.test.tsx`
  - Cover layer tree rendering and report read-only behavior.
- Modify: `src/shared/i18n/locales/en.ts`
  - Add English strings for recommendation/deviation/layer tree badges.
- Modify: `src/shared/i18n/locales/zh.ts`
  - Add Chinese strings for recommendation/deviation/layer tree badges.
- Modify: `src/shared/i18n/locales/en.test.ts`, `src/shared/i18n/locales/zh.test.ts`
  - Keep locale integrity tests passing after adding keys.

## Task 1: Selection Helpers

**Files:**
- Modify: `src/features/ai-assistant/utils/inspectionProfileSelection.ts`
- Create: `src/features/ai-assistant/utils/inspectionProfileSelection.test.ts`

- [ ] **Step 1: Write failing tests for clone/equality/restore**

Add `src/features/ai-assistant/utils/inspectionProfileSelection.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  areSelectedInspectionProfilesEqual,
  cloneSelectedInspectionProfiles,
  restoreInspectionProfileSelection,
  type SelectedInspectionProfiles,
} from './inspectionProfileSelection'

const selection = (entries: Record<string, string[]>): SelectedInspectionProfiles =>
  Object.fromEntries(Object.entries(entries).map(([profileId, itemIds]) => [profileId, new Set(itemIds)]))

test('cloneSelectedInspectionProfiles creates independent item sets', () => {
  const original = selection({ 'base.robot_model': ['model_identity'] })
  const cloned = cloneSelectedInspectionProfiles(original)

  cloned['base.robot_model']?.add('tree_connectivity')

  assert.deepEqual(Array.from(original['base.robot_model'] ?? []), ['model_identity'])
  assert.deepEqual(Array.from(cloned['base.robot_model'] ?? []), ['model_identity', 'tree_connectivity'])
})

test('areSelectedInspectionProfilesEqual ignores set insertion order', () => {
  const left = selection({ 'base.robot_model': ['model_identity', 'tree_connectivity'] })
  const right = selection({ 'base.robot_model': ['tree_connectivity', 'model_identity'] })

  assert.equal(areSelectedInspectionProfilesEqual(left, right), true)
})

test('areSelectedInspectionProfilesEqual detects missing profiles and items', () => {
  const left = selection({ 'base.robot_model': ['model_identity'] })
  const right = selection({ 'base.robot_model': ['model_identity'], 'format.urdf': ['urdf_robot_root'] })
  const changedItem = selection({ 'base.robot_model': ['tree_connectivity'] })

  assert.equal(areSelectedInspectionProfilesEqual(left, right), false)
  assert.equal(areSelectedInspectionProfilesEqual(left, changedItem), false)
})

test('restoreInspectionProfileSelection restores one recommended profile without mutating current', () => {
  const current = selection({
    'base.robot_model': ['model_identity'],
    'format.urdf': ['urdf_robot_root'],
  })
  const recommended = selection({
    'base.robot_model': ['tree_connectivity', 'reference_integrity'],
  })

  const restored = restoreInspectionProfileSelection(current, recommended, 'base.robot_model')

  assert.deepEqual(Array.from(restored['base.robot_model'] ?? []).sort(), [
    'reference_integrity',
    'tree_connectivity',
  ])
  assert.deepEqual(Array.from(restored['format.urdf'] ?? []), ['urdf_robot_root'])
  assert.deepEqual(Array.from(current['base.robot_model'] ?? []), ['model_identity'])
})

test('restoreInspectionProfileSelection clears profile when recommendation does not include it', () => {
  const current = selection({ 'format.urdf': ['urdf_robot_root'] })
  const recommended = selection({ 'base.robot_model': ['model_identity'] })

  const restored = restoreInspectionProfileSelection(current, recommended, 'format.urdf')

  assert.deepEqual(Array.from(restored['format.urdf'] ?? []), [])
  assert.deepEqual(Array.from(restored['base.robot_model'] ?? []), [])
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
node --import tsx --test src/features/ai-assistant/utils/inspectionProfileSelection.test.ts
```

Expected: FAIL because the three helper functions are not exported.

- [ ] **Step 3: Implement helper functions**

Append to `inspectionProfileSelection.ts`:

```ts
export function cloneSelectedInspectionProfiles(
  selectedProfiles: SelectedInspectionProfiles,
): SelectedInspectionProfiles {
  return Object.fromEntries(
    Object.entries(selectedProfiles).map(([profileId, itemIds]) => [
      profileId,
      new Set(itemIds),
    ]),
  )
}

export function areSelectedInspectionProfilesEqual(
  a: SelectedInspectionProfiles,
  b: SelectedInspectionProfiles,
): boolean {
  const profileIds = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const profileId of profileIds) {
    const aItems = a[profileId] ?? new Set<string>()
    const bItems = b[profileId] ?? new Set<string>()
    if (aItems.size !== bItems.size) {
      return false
    }
    for (const itemId of aItems) {
      if (!bItems.has(itemId)) {
        return false
      }
    }
  }

  return true
}

export function restoreInspectionProfileSelection(
  current: SelectedInspectionProfiles,
  recommended: SelectedInspectionProfiles,
  profileId: string,
): SelectedInspectionProfiles {
  return {
    ...cloneSelectedInspectionProfiles(current),
    [profileId]: new Set(recommended[profileId] ?? []),
  }
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
node --import tsx --test src/features/ai-assistant/utils/inspectionProfileSelection.test.ts
```

Expected: PASS.

## Task 2: Advanced Scope View Model

**Files:**
- Create: `src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.ts`
- Create: `src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Add `inspectionAdvancedScopeViewModel.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInspectionItemScopeSummaries,
  buildInspectionLayerSummaries,
  buildInspectionProfileScopeSummaries,
  buildInspectionSelectionDeviation,
} from './inspectionAdvancedScopeViewModel'
import type { SelectedInspectionProfiles } from './inspectionProfileSelection'

const selection = (entries: Record<string, string[]>): SelectedInspectionProfiles =>
  Object.fromEntries(Object.entries(entries).map(([profileId, itemIds]) => [profileId, new Set(itemIds)]))

test('buildInspectionSelectionDeviation reports added and removed items', () => {
  const selected = selection({
    'base.robot_model': ['model_identity'],
    'format.urdf': ['urdf_robot_root'],
  })
  const recommended = selection({
    'base.robot_model': ['model_identity', 'tree_connectivity'],
  })

  const deviation = buildInspectionSelectionDeviation(selected, recommended)

  assert.deepEqual(deviation.addedItems, [{ profileId: 'format.urdf', itemId: 'urdf_robot_root' }])
  assert.deepEqual(deviation.removedItems, [{ profileId: 'base.robot_model', itemId: 'tree_connectivity' }])
  assert.deepEqual(deviation.changedProfileIds.sort(), ['base.robot_model', 'format.urdf'])
  assert.equal(deviation.totalChangedItemCount, 2)
})

test('buildInspectionLayerSummaries groups counts by layer', () => {
  const selected = selection({
    'base.robot_model': ['model_identity'],
    'morph.quadruped': ['quadruped_leg_quads'],
  })
  const recommended = selection({
    'base.robot_model': ['model_identity', 'tree_connectivity'],
    'morph.quadruped': ['quadruped_leg_quads'],
  })

  const summaries = buildInspectionLayerSummaries(selected, recommended)
  const base = summaries.find((summary) => summary.layer === 'base')
  const morph = summaries.find((summary) => summary.layer === 'morph')

  assert.equal(base?.selectedItemCount, 1)
  assert.equal(base?.recommendedItemCount, 2)
  assert.equal(base?.totalItemCount, 20)
  assert.equal(morph?.selectedItemCount, 1)
  assert.equal(morph?.recommendedItemCount, 1)
})

test('buildInspectionProfileScopeSummaries classifies recommendation relations', () => {
  const selected = selection({
    'base.robot_model': ['model_identity'],
    'format.urdf': ['urdf_robot_root'],
  })
  const recommended = selection({
    'base.robot_model': ['model_identity', 'tree_connectivity'],
    'morph.quadruped': ['quadruped_leg_quads'],
  })

  const summaries = buildInspectionProfileScopeSummaries(selected, recommended)
  const base = summaries.find((summary) => summary.profileId === 'base.robot_model')
  const format = summaries.find((summary) => summary.profileId === 'format.urdf')
  const morph = summaries.find((summary) => summary.profileId === 'morph.quadruped')

  assert.equal(base?.relation, 'partial')
  assert.equal(format?.relation, 'user_added')
  assert.equal(morph?.relation, 'user_removed')
})

test('buildInspectionItemScopeSummaries marks user additions and removals', () => {
  const selected = selection({ 'base.robot_model': ['model_identity'] })
  const recommended = selection({ 'base.robot_model': ['tree_connectivity'] })

  const summaries = buildInspectionItemScopeSummaries('base.robot_model', selected, recommended)
  const selectedItem = summaries.find((summary) => summary.itemId === 'model_identity')
  const removedItem = summaries.find((summary) => summary.itemId === 'tree_connectivity')

  assert.equal(selectedItem?.relation, 'user_added')
  assert.equal(removedItem?.relation, 'user_removed')
})
```

- [ ] **Step 2: Run view-model tests and verify they fail**

Run:

```bash
node --import tsx --test src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts
```

Expected: FAIL because `inspectionAdvancedScopeViewModel.ts` does not exist.

- [ ] **Step 3: Implement view-model utilities**

Create `inspectionAdvancedScopeViewModel.ts` with exported types and functions matching the tests. Use `INSPECTION_PROFILE_DEFINITIONS` and `getInspectionProfileDefinition`; use optional `getApplicability(profileId, itemId?)` callback defaulting to `applicable` so tests stay pure and components can pass real applicability.

- [ ] **Step 4: Run view-model tests and verify they pass**

Run:

```bash
node --import tsx --test src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts
```

Expected: PASS.

## Task 3: Recommendation Banner And i18n

**Files:**
- Create: `src/features/ai-assistant/components/InspectionRecommendationBanner.tsx`
- Modify: `src/shared/i18n/locales/en.ts`
- Modify: `src/shared/i18n/locales/zh.ts`

- [ ] **Step 1: Write failing modal test for advanced direct recommendation visibility**

Extend `AIInspectionModal.test.tsx` with a test that stores `urdf-studio.ai-inspection.setup-mode = advanced`, renders the modal, and asserts the advanced view contains `t.inspectionRecommendedPlan`, `t.inspectionRestoreRecommendation`, and the selected check summary.

- [ ] **Step 2: Run the focused modal test and verify it fails**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/AIInspectionModal.test.tsx
```

Expected: FAIL because advanced mode does not render the recommendation banner.

- [ ] **Step 3: Add banner component and i18n keys**

Create `InspectionRecommendationBanner.tsx` using semantic tokens and `Sparkles`, `RotateCcw`, `ChevronDown`, `ChevronRight` lucide icons. Add bilingual keys for restore recommendation, view recommendation reasons, hide reasons, deviation summary, and recommendation reasons.

- [ ] **Step 4: Wire banner into `AIInspectionModal` advanced setup path**

Render banner above `InspectionSetupView` when `inspectionSetupMode === 'advanced'` and setup view is active. Pass `normalInspectionPlan`, `selectedProfiles`, `recommendedProfiles`, and `handleRestoreRecommendation`.

- [ ] **Step 5: Run focused modal test and locale tests**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/AIInspectionModal.test.tsx
node --import tsx --test src/shared/i18n/locales/en.test.ts src/shared/i18n/locales/zh.test.ts
```

Expected: PASS.

## Task 4: Layer Tree Sidebar

**Files:**
- Modify: `src/features/ai-assistant/components/InspectionSidebar.tsx`
- Modify: `src/features/ai-assistant/components/InspectionSidebar.test.tsx`
- Modify: `src/shared/i18n/locales/en.ts`
- Modify: `src/shared/i18n/locales/zh.ts`

- [ ] **Step 1: Write failing sidebar tests for layer grouping**

Extend `InspectionSidebar.test.tsx` to render setup mode and assert localized layer names appear, profile rows are nested under layer sections, and profile item toggling still calls state updates.

- [ ] **Step 2: Run sidebar tests and verify they fail**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/InspectionSidebar.test.tsx
```

Expected: FAIL because layer sections are not rendered.

- [ ] **Step 3: Refactor setup sidebar to layer tree**

Use `buildInspectionLayerSummaries` and `buildInspectionProfileScopeSummaries`. Keep read-only report mode behavior but group visible read-only profiles by layer.

- [ ] **Step 4: Run sidebar tests and verify they pass**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/InspectionSidebar.test.tsx
```

Expected: PASS.

## Task 5: Item Relation Badges And Profile Restore

**Files:**
- Modify: `src/features/ai-assistant/components/InspectionSetupView.tsx`
- Modify: `src/features/ai-assistant/components/AIInspectionModal.tsx`
- Modify: `src/features/ai-assistant/components/AIInspectionModal.test.tsx`
- Modify: `src/shared/i18n/locales/en.ts`
- Modify: `src/shared/i18n/locales/zh.ts`

- [ ] **Step 1: Write failing modal tests for item relation and profile restore**

Add tests that remove a recommended item in advanced mode and assert it shows a user-excluded/deviation badge. Add another test that clicks restore-profile recommendation and asserts only that profile returns to the recommended count.

- [ ] **Step 2: Run modal tests and verify they fail**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/AIInspectionModal.test.tsx
```

Expected: FAIL because item relation badges and restore-profile action do not exist.

- [ ] **Step 3: Extend `InspectionSetupView` props and UI**

Pass `recommendedProfiles`, `onRestoreProfileRecommendation`, and build item summaries for the focused profile. Add profile controls and item relation badges.

- [ ] **Step 4: Add restore-profile handler in `AIInspectionModal`**

Use `restoreInspectionProfileSelection(selectedProfiles, recommendedProfiles, profileId)`.

- [ ] **Step 5: Run modal tests and verify they pass**

Run:

```bash
node --import tsx --test src/features/ai-assistant/components/AIInspectionModal.test.tsx
```

Expected: PASS.

## Task 6: Focused Verification

**Files:**
- No new files.

- [ ] **Step 1: Run utility and component tests**

Run:

```bash
node --import tsx --test \
  src/features/ai-assistant/utils/inspectionProfileSelection.test.ts \
  src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts \
  src/features/ai-assistant/components/InspectionSidebar.test.tsx \
  src/features/ai-assistant/components/AIInspectionModal.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run app test suite if focused checks pass**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add src/features/ai-assistant src/shared/i18n docs/superpowers/plans/2026-05-23-ai-inspection-advanced-profile-mode.md
git commit -m "feat: rework AI inspection advanced profile mode"
```

Expected: commit includes only plan and implementation files.
