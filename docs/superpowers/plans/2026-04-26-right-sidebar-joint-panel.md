# Right Sidebar Joint Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current joint control panel into the right property sidebar, default it to expanded, and persist its collapsed state.

**Architecture:** Reuse the existing shared joint-item rendering from the floating joint panel, then add an embedded wrapper inside `PropertyEditor` that reads collapse persistence from `useUIStore().panelSections`. Keep the viewer overlay panel disabled in `AppLayout` so the sidebar becomes the single primary location.

**Tech Stack:** React 19, TypeScript, Zustand, node:test, JSDOM

---

### Task 1: Lock the new sidebar behavior with tests

**Files:**
- Modify: `src/features/property-editor/components/PropertyEditor.test.tsx`
- Create: `src/features/property-editor/components/PropertyEditorJointPanel.test.tsx`

- [ ] **Step 1: Write the failing render test**
- [ ] **Step 2: Run the property-editor test file and confirm the joint section is missing**
- [ ] **Step 3: Write the failing interaction test for collapse persistence**
- [ ] **Step 4: Run the new interaction test and confirm the collapse persistence is missing**

### Task 2: Extract reusable joint-panel content

**Files:**
- Modify: `src/shared/components/Panel/JointsPanel.tsx`
- Create: `src/shared/components/Panel/JointPanelContent.tsx`

- [ ] **Step 1: Move the shared joint list / controls logic into a reusable component**
- [ ] **Step 2: Keep `JointsPanel` behavior unchanged by wiring it to the shared component**
- [ ] **Step 3: Run the existing joint-panel tests**

### Task 3: Embed the joint panel into the property sidebar

**Files:**
- Modify: `src/features/property-editor/components/PropertyEditor.tsx`
- Create: `src/features/property-editor/components/PropertyEditorJointPanel.tsx`
- Modify: `src/app/AppLayout.tsx`

- [ ] **Step 1: Add embedded joint-panel props to `PropertyEditor`**
- [ ] **Step 2: Render the joint section above the property body with default-expanded persisted collapse state**
- [ ] **Step 3: Capture per-source initial joint angles so reset still works**
- [ ] **Step 4: Stop rendering the floating joint overlay from the main app layout**

### Task 4: Verify and review

**Files:**
- Modify: `src/features/property-editor/components/PropertyEditor.test.tsx`
- Modify: `src/features/property-editor/components/PropertyEditorJointPanel.test.tsx`

- [ ] **Step 1: Run targeted property-editor and joint-panel tests**
- [ ] **Step 2: Run `npm run test -- PropertyEditor...` / equivalent focused verification**
- [ ] **Step 3: Run `npm run typecheck` if the touched surface compiles broadly enough**
- [ ] **Step 4: Request a code review pass and address findings if needed**
