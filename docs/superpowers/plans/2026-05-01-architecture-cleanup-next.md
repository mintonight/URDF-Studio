# Architecture Cleanup Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue reducing long-file pressure, redundant compatibility wrappers, and layer violations without broad speculative rewrites.

**Architecture:** Work from the dependency edges inward: remove thin wrappers first, delete provably orphaned shared code, then move pure viewer-loader helpers down to `shared`. Keep high-risk renderer material/scene-sync extraction out of this pass.

**Tech Stack:** React 19.2, TypeScript 5.8, Three.js/R3F, Vite 6.2, Node test runner with `tsx`, ESLint.

---

## Evidence Snapshot

- Top long runtime files include `ThreeRenderDelegateInterface.js` (4695 LOC), `HydraMesh.js` (3502 LOC), `ThreeRenderDelegateCore.js` (3425 LOC), `usdExportBundle.ts` (2982 LOC), `usdOffscreenViewer.worker.ts` (2815 LOC), `useViewerController.ts` (1833 LOC), and `GeometryEditor.tsx` (1804 LOC).
- Remaining downward-boundary violations:
  - `src/shared/components/3d/renderers/ThreeJsBackend.ts` imports feature robot positioning, materials, scene sync, source metadata, and source format utilities.
  - `src/shared/components/3d/renderers/UsdSceneGraph.ts` imports USD feature utilities but is not exported and currently has no production consumers.
  - `src/lib/components/RobotCanvas.tsx` is a published package entry and imports feature internals; this should be constrained, not deleted.
- Claude agreed with the low-risk wrapper cleanup direction, but its suggestion to delete `RobotCanvas` was rejected because docs and package config show it is a public package entry.

## What Not To Do In This Pass

- Do not split the huge Hydra render delegate JS files yet; they are risky runtime files and recent USD work is already dirty.
- Do not delete or relocate `src/lib/components/RobotCanvas.tsx`; it is the `@urdf-studio/react-robot-canvas` entry.
- Do not move `syncLoadedRobotScene`, `resolveURDFMaterialsForScene`, or `SHARED_MATERIALS` yet. Those are behavior-heavy and should move only after pure utilities are out of the way.
- Do not run broad formatting over the repo; the worktree has many unrelated existing changes.

---

### Task 1: Remove Thin Internal Viewer Shims

**Files:**
- Modify: `src/lib/components/RobotCanvas.tsx`
- Modify: `src/features/urdf-viewer/hooks/useRobotLoader.ts`
- Modify: `src/features/urdf-viewer/components/RobotModel.tsx`
- Modify: `src/features/urdf-viewer/hooks/useViewerController.ts`
- Modify: `src/features/urdf-viewer/hooks/useMouseInteraction.ts`
- Modify: `src/features/urdf-viewer/utils/activeJointSelection.ts`
- Modify: `src/features/urdf-viewer/utils/robotLoaderGeometryPatch.ts`
- Delete: `src/features/urdf-viewer/utils/createViewerMeshLoader.ts`
- Delete: `src/features/urdf-viewer/utils/createViewerMeshLoader.test.ts`
- Test: `src/features/urdf-viewer/utils/internalImportBoundary.test.ts`

- [ ] **Step 1: Write the failing source-boundary test**

Create `src/features/urdf-viewer/utils/internalImportBoundary.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../components/RobotModel.tsx', import.meta.url),
  new URL('../hooks/useMouseInteraction.ts', import.meta.url),
  new URL('../hooks/useRobotLoader.ts', import.meta.url),
  new URL('../hooks/useViewerController.ts', import.meta.url),
  new URL('./activeJointSelection.ts', import.meta.url),
  new URL('./robotLoaderGeometryPatch.ts', import.meta.url),
];

test('urdf-viewer internals import shared/core helper implementations directly', async () => {
  for (const fileUrl of files) {
    const source = await readFile(fileUrl, 'utf8');
    assert.doesNotMatch(source, /['"](?:\.\.?\/)+utils\/jointTypes['"]/);
    assert.doesNotMatch(source, /createViewerMeshLoader/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/features/urdf-viewer/utils/internalImportBoundary.test.ts
```

Expected: FAIL because multiple files still import `../utils/jointTypes` or `createViewerMeshLoader`.

- [ ] **Step 3: Replace import paths**

Use these exact replacements:

```ts
// src/lib/components/RobotCanvas.tsx
import { isSingleDofJoint } from '../../shared/utils/jointTypes';

// src/features/urdf-viewer/components/RobotModel.tsx
import { isSingleDofJoint } from '@/shared/utils/jointTypes';

// src/features/urdf-viewer/hooks/useMouseInteraction.ts
import { isSingleDofJoint } from '@/shared/utils/jointTypes';

// src/features/urdf-viewer/hooks/useViewerController.ts
import { getJointType, isSingleDofJoint } from '@/shared/utils/jointTypes';

// src/features/urdf-viewer/hooks/useRobotLoader.ts
import { createMeshLoader } from '@/core/loaders';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';

// src/features/urdf-viewer/utils/activeJointSelection.ts
import { isSingleDofJoint } from '@/shared/utils/jointTypes';

// src/features/urdf-viewer/utils/robotLoaderGeometryPatch.ts
import { createMeshLoader } from '@/core/loaders';
```

Then replace calls:

```ts
loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir, {
  colladaRootNormalizationHints,
  explicitScaleMeshPaths: explicitlyScaledMeshPaths,
  yieldIfNeeded,
});
```

```ts
const meshLoader = createMeshLoader(assets, manager, urdfDir, {
  colladaRootNormalizationHints,
  explicitScaleMeshPaths,
  yieldIfNeeded,
});
```

- [ ] **Step 4: Delete unused wrapper files**

Run:

```bash
rg -n "createViewerMeshLoader" src packages
```

Expected before deletion: only `createViewerMeshLoader.ts`, its test, and the source-boundary test mention it.

Delete:

```text
src/features/urdf-viewer/utils/createViewerMeshLoader.ts
src/features/urdf-viewer/utils/createViewerMeshLoader.test.ts
```

Keep `src/features/urdf-viewer/utils/jointTypes.ts` for now because `src/features/urdf-viewer/utils/index.ts` exports it as part of the existing feature public surface.

- [ ] **Step 5: Verify**

Run:

```bash
node --import tsx --test src/features/urdf-viewer/utils/internalImportBoundary.test.ts
node --import tsx --test src/features/urdf-viewer/utils/robotLoaderGeometryPatch.test.ts
node --import tsx --test src/shared/components/3d/renderers/ThreeJsBackend.test.ts
npm run typecheck -- --pretty false
```

Expected: all pass.

---

### Task 2: Delete Or Move Orphaned `UsdSceneGraph`

**Files:**
- Delete: `src/shared/components/3d/renderers/UsdSceneGraph.ts`
- Delete: `src/shared/components/3d/renderers/UsdSceneGraph.test.ts`
- Test: no new test needed if the module is truly orphaned.

- [ ] **Step 1: Confirm there are no production consumers**

Run:

```bash
rg -n "buildUsdSceneGraphFromResolution|raycastUsdSceneGraph|updateUsdSceneGraphLinkTransform|UsdSceneGraph" src packages
```

Expected: only `src/shared/components/3d/renderers/UsdSceneGraph.ts` and `src/shared/components/3d/renderers/UsdSceneGraph.test.ts`.

- [ ] **Step 2: Delete the orphaned module and test**

Delete:

```text
src/shared/components/3d/renderers/UsdSceneGraph.ts
src/shared/components/3d/renderers/UsdSceneGraph.test.ts
```

- [ ] **Step 3: Verify shared renderer exports still compile**

Run:

```bash
npm run typecheck -- --pretty false
rg -n "UsdSceneGraph" src/shared src/features src/lib packages
```

Expected: typecheck passes, and `rg` prints no matches.

---

### Task 3: Move Pure Renderer Loader Utilities To `shared`

**Files:**
- Create: `src/shared/components/3d/renderers/sourceFormat.ts`
- Create: `src/shared/components/3d/renderers/sourceFormat.test.ts`
- Create: `src/shared/components/3d/renderers/robotLoaderSourceMetadata.ts`
- Create: `src/shared/components/3d/renderers/robotLoaderSourceMetadata.test.ts`
- Create: `src/shared/components/3d/robotPositioning.ts`
- Create: `src/shared/components/3d/robotPositioning.test.ts`
- Modify: `src/features/urdf-viewer/utils/sourceFormat.ts`
- Modify: `src/features/urdf-viewer/utils/robotLoaderSourceMetadata.ts`
- Modify: `src/features/urdf-viewer/utils/robotPositioning.ts`
- Modify: `src/features/urdf-viewer/hooks/useRobotLoader.ts`
- Modify: `src/features/urdf-viewer/components/RobotModel.tsx`
- Modify: `src/shared/components/3d/renderers/ThreeJsBackend.ts`

- [ ] **Step 1: Move source format logic**

Create `src/shared/components/3d/renderers/sourceFormat.ts`:

```ts
import { isMJCFContent } from '@/core/parsers/mjcf';
import type { RobotFile } from '@/types';

export type ViewerRobotSourceFormat = 'auto' | 'urdf' | 'mjcf' | 'sdf' | 'xacro';
export type ResolvedViewerRobotSourceFormat = 'urdf' | 'mjcf';

export function getViewerRobotSourceFormat(
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  switch (fileFormat) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
    case 'xacro':
      return fileFormat;
    default:
      return 'auto';
  }
}

export function resolvePreferredViewerRobotSourceFormat(
  explicitSourceFormat: ViewerRobotSourceFormat | undefined,
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  if (explicitSourceFormat !== undefined) {
    return explicitSourceFormat;
  }

  return getViewerRobotSourceFormat(fileFormat);
}

export function resolveViewerRobotSourceFormat(
  content: string,
  sourceFormat: ViewerRobotSourceFormat = 'auto',
): ResolvedViewerRobotSourceFormat {
  if (sourceFormat === 'mjcf') {
    return 'mjcf';
  }

  if (sourceFormat === 'urdf' || sourceFormat === 'sdf' || sourceFormat === 'xacro') {
    return 'urdf';
  }

  return isMJCFContent(content) ? 'mjcf' : 'urdf';
}
```

Replace `src/features/urdf-viewer/utils/sourceFormat.ts` with:

```ts
export {
  getViewerRobotSourceFormat,
  resolvePreferredViewerRobotSourceFormat,
  resolveViewerRobotSourceFormat,
} from '@/shared/components/3d/renderers/sourceFormat';

export type {
  ResolvedViewerRobotSourceFormat,
  ViewerRobotSourceFormat,
} from '@/shared/components/3d/renderers/sourceFormat';
```

- [ ] **Step 2: Move source metadata logic**

Move the current implementation from `src/features/urdf-viewer/utils/robotLoaderSourceMetadata.ts` into `src/shared/components/3d/renderers/robotLoaderSourceMetadata.ts`, keeping the same exported names:

```ts
export interface RobotLoaderSourceMetadata {
  robotLinks: Record<string, UrdfLink> | null;
  robotJoints: Record<string, UrdfJoint> | null;
  explicitlyScaledMeshPaths: Set<string>;
  colladaRootNormalizationHints: ColladaRootNormalizationHints | null;
}
```

Replace the feature file with:

```ts
export {
  resolveRobotLoaderSourceMetadata,
} from '@/shared/components/3d/renderers/robotLoaderSourceMetadata';

export type {
  RobotLoaderSourceMetadata,
} from '@/shared/components/3d/renderers/robotLoaderSourceMetadata';
```

- [ ] **Step 3: Move robot positioning**

Move the current implementation from `src/features/urdf-viewer/utils/robotPositioning.ts` into `src/shared/components/3d/robotPositioning.ts`.

Replace the feature file with:

```ts
export {
  alignRobotToGroundBeforeFirstMount,
  beginInitialGroundAlignment,
  copyRobotRootTransform,
  getRobotGroundOffset,
  hasInitialGroundAlignment,
  offsetRobotToGround,
  setInitialGroundAlignment,
  setPreserveAuthoredRootTransform,
  shouldPreserveAuthoredRootTransform,
} from '@/shared/components/3d/robotPositioning';
```

- [ ] **Step 4: Update direct consumers**

Use shared imports in `ThreeJsBackend`, `useRobotLoader`, and `RobotModel`:

```ts
import {
  alignRobotToGroundBeforeFirstMount,
  offsetRobotToGround,
} from '@/shared/components/3d/robotPositioning';
import { resolveRobotLoaderSourceMetadata } from '@/shared/components/3d/renderers/robotLoaderSourceMetadata';
import { resolveViewerRobotSourceFormat } from '@/shared/components/3d/renderers/sourceFormat';
```

- [ ] **Step 5: Move tests or add shared equivalents**

Move these test files to the shared locations and update their imports:

```text
src/features/urdf-viewer/utils/sourceFormat.test.ts
  -> src/shared/components/3d/renderers/sourceFormat.test.ts

src/features/urdf-viewer/utils/robotLoaderSourceMetadata.test.ts
  -> src/shared/components/3d/renderers/robotLoaderSourceMetadata.test.ts

src/features/urdf-viewer/utils/robotPositioning.test.ts
  -> src/shared/components/3d/robotPositioning.test.ts
```

- [ ] **Step 6: Verify**

Run:

```bash
node --import tsx --test \
  src/shared/components/3d/renderers/sourceFormat.test.ts \
  src/shared/components/3d/renderers/robotLoaderSourceMetadata.test.ts \
  src/shared/components/3d/robotPositioning.test.ts \
  src/shared/components/3d/renderers/ThreeJsBackend.test.ts
npm run typecheck -- --pretty false
```

Expected: all pass.

---

### Task 4: Constrain The Public `RobotCanvas` Boundary

**Files:**
- Modify: `src/lib/components/RobotCanvas.tsx`
- Create: `src/lib/libBoundary.test.ts`
- Test package: `packages/react-robot-canvas`

- [ ] **Step 1: Write the boundary test**

Create `src/lib/libBoundary.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const robotCanvasSourceUrl = new URL('./components/RobotCanvas.tsx', import.meta.url);

test('RobotCanvas package entry does not import urdf-viewer private utility shims', async () => {
  const source = await readFile(robotCanvasSourceUrl, 'utf8');

  assert.doesNotMatch(source, /features\/urdf-viewer\/utils\//);
});

test('RobotCanvas package entry keeps remaining feature component dependencies explicit', async () => {
  const source = await readFile(robotCanvasSourceUrl, 'utf8');

  assert.match(source, /features\/urdf-viewer\/components\/ViewerCanvas/);
  assert.match(source, /features\/urdf-viewer\/components\/RobotModel/);
  assert.match(source, /features\/urdf-viewer\/components\/JointInteraction/);
});
```

- [ ] **Step 2: Fix the private utility import**

In `src/lib/components/RobotCanvas.tsx`, replace:

```ts
import { isSingleDofJoint } from '../../features/urdf-viewer/utils/jointTypes';
```

with:

```ts
import { isSingleDofJoint } from '../../shared/utils/jointTypes';
```

- [ ] **Step 3: Verify app and package builds**

Run:

```bash
node --import tsx --test src/lib/libBoundary.test.ts
npm run typecheck -- --pretty false
npm run build:package:react-robot-canvas
```

Expected: tests and package build pass.

---

### Task 5: Re-Assess Large Files After Boundary Cleanup

**Files:**
- No code changes in this task.
- Produce a short follow-up note in `docs/superpowers/plans/2026-05-01-long-file-splits.md` only if the boundary cleanup is complete.

- [ ] **Step 1: Recompute long-file list**

Run:

```bash
rg --files src packages | rg '\.(ts|tsx|js|jsx)$' | xargs wc -l | sort -nr | head -40
```

- [ ] **Step 2: Pick only files with active duplication**

Use these criteria:

```text
split_candidate = file is over 1500 LOC
  and current work needs edits inside it
  and at least one cohesive function/type cluster has tests
  and extraction can preserve public imports
```

- [ ] **Step 3: Recommended next split candidates**

Prefer these only after Tasks 1-4:

```text
src/features/urdf-viewer/hooks/useViewerController.ts
src/features/property-editor/components/GeometryEditor.tsx
src/features/property-editor/utils/collisionOptimization.ts
src/features/property-editor/utils/geometryConversion.ts
src/features/urdf-viewer/utils/usdExportBundle.ts
```

Avoid these until a specific bug forces changes:

```text
src/features/urdf-viewer/runtime/hydra/render-delegate/ThreeRenderDelegateInterface.js
src/features/urdf-viewer/runtime/hydra/render-delegate/HydraMesh.js
src/features/urdf-viewer/runtime/hydra/render-delegate/ThreeRenderDelegateCore.js
src/features/urdf-viewer/workers/usdOffscreenViewer.worker.ts
```

- [ ] **Step 4: Verify no accidental broad churn**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no formatting-only churn outside the task files.
