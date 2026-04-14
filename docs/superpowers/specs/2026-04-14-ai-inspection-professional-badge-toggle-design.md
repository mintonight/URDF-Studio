# AI Inspection Professional Badge Toggle Design

**Date:** 2026-04-14

**Goal**

Enable the status badge in AI inspection professional mode to toggle the corresponding inspection item selection. Clicking `已纳入` or `未纳入` should behave the same as toggling that item from the left inspection sidebar.

**Scope**

- Only change the professional-mode setup view in the AI inspection modal.
- Only make the per-item status badge clickable.
- Keep the rest of the card read-only.
- Preserve existing behavior in normal mode, running state, and report state.

**Current Behavior**

- In professional mode, the right-side detail panel shows each inspection item as a card.
- The badge text reflects selection state with `已纳入` or `未纳入`.
- The badge is display-only and cannot change selection.
- Selection changes are currently driven from the left sidebar and the normal-mode setup view.

**Desired Behavior**

- In professional mode setup, clicking the status badge toggles the item selection.
- When the item is selected, clicking `已纳入` removes it from the run.
- When the item is not selected, clicking `未纳入` includes it in the run.
- The right card state, left sidebar state, and summary metrics stay synchronized because they continue to share the same `selectedItems` state.

**Design**

## UI structure

- Replace the badge-only `span` in `InspectionSetupView.tsx` with a semantic `button`.
- Keep the visual style close to the existing badge so the change is behavioral, not visual redesign.
- Add a small hover/focus treatment consistent with current token usage.

## Data flow

- `AIInspectionModal.tsx` remains the owner of `selectedItems`.
- Pass a new `onToggleItem(categoryId, itemId)` callback into `InspectionSetupView`.
- The callback updates `selectedItems` with the same add/remove semantics already used by the sidebar item toggle.

## Interaction rules

- The badge is clickable only in setup view professional mode.
- No change to whole-card click behavior.
- No extra confirmation dialog.
- No i18n changes are required because the existing labels already match the desired states.

## Accessibility

- Use a real `button` so keyboard users can trigger the change.
- Keep the visible label as the current included/skipped text.
- Add an `aria-pressed` state tied to item selection.

## Testing

- Add a test in `AIInspectionModal.test.tsx` that enters professional mode, clicks the right-side status badge, and verifies:
  - the right-side item state toggles from included to skipped or the reverse
  - the selection summary updates
  - the left sidebar selection count remains synchronized

**Files**

- Modify `src/features/ai-assistant/components/AIInspectionModal.tsx`
- Modify `src/features/ai-assistant/components/InspectionSetupView.tsx`
- Modify `src/features/ai-assistant/components/AIInspectionModal.test.tsx`

**Out of Scope**

- Making the entire inspection item card clickable
- Changing normal-mode selection behavior
- Refactoring shared selection helpers between the sidebar and setup view
- Any report-view interaction changes
