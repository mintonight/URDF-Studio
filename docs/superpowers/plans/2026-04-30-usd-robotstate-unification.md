# USD RobotState Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make USD editing use `RobotState` as the durable semantic source of truth while keeping USD WASM/Hydra as the high-fidelity render backend and preserving fast stage loading.

**Architecture:** USD load remains runtime-first for performance and fidelity. Hydration produces `RobotState` plus a small USD binding sidecar that maps `RobotState` IDs to USD prim paths, mesh descriptors, snapshots, and prepared export cache keys. Editor mutations update `RobotState`; a targeted sync layer applies supported mutations to the mounted USD runtime without re-opening the stage.

**Tech Stack:** React 19, TypeScript, Zustand, Three.js/R3F, USD WASM/Hydra runtime, Vite test runner, browser fixture regression scripts.

---

## Requirements Summary

- USD stage loading must remain asynchronous/background-oriented and must not block the first render on full `RobotState` materialization.
- `RobotState` is the durable editing state for USD after hydration.
- USD-specific identity data must not bloat the generic `RobotState` type.
- Runtime rendering still comes from USD WASM/Hydra, not from rebuilding the USD model as generic Three.js.
- Supported USD edits must be visible immediately when they can be mapped safely.
- Unsupported USD edits must remain explicit: update semantic state for save/export, but do not silently pretend the live USD stage changed.
- Project save/load and USD export must preserve edited `RobotState` plus the USD mapping/cache needed for stable export.

## Current Evidence

- `RobotState` already stores generic robot semantics: `links`, `joints`, `materials`, `rootLinkId`, `closedLoopConstraints`, and `inspectionContext` in `src/types/robot.ts`.
- USD hydration commits `result.robotData` into `robotStore` through `useUsdDocumentLifecycle`.
- USD path/prim mapping currently lives in `ViewerRobotDataResolution`, not in `RobotState`.
- `rendererBackendLoadScope` intentionally ignores USD hydration data so `robotData` changes do not reopen USD stages.
- The visible USD WASM backend has been removed from the render factory; remaining USD runtime mesh helpers live in `UsdSceneGraph`.

## Target Data Model

Keep `RobotState` generic. Add a sidecar:

```ts
export interface UsdRobotBinding {
  stageSourcePath: string | null;
  revision: number;
  linkIdByPath: Record<string, string>;
  linkPathById: Record<string, string>;
  jointPathById: Record<string, string>;
  childLinkPathByJointId: Record<string, string>;
  parentLinkPathByJointId: Record<string, string>;
  meshBindingByLinkObjectKey: Record<string, {
    meshId: string;
    primPath: string | null;
    role: 'visual' | 'collision';
    objectIndex: number;
  }>;
  sceneSnapshotKey: string | null;
  preparedExportCacheKey: string | null;
}
```

Store it in a dedicated USD binding store or in `assetsStore` near `usdSceneSnapshots` and `usdPreparedExportCaches`. Do not put large `UsdSceneSnapshot` blobs into `robotStore`.

## Acceptance Criteria

- Loading a USD file hydrates `robotStore` with real links/joints and records a matching `UsdRobotBinding`.
- Editing supported link/joint properties updates `robotStore` first.
- Supported live edits update the mounted USD runtime without a stage reload.
- Unsupported live edits are tracked as semantic-only changes and still affect export/project save.
- USD hydration does not trigger repeated renderer reload loops.
- Fast USD load path remains within current performance budget for `Go2`, `B2`, and `H1-2`.
- Existing URDF/MJCF/SDF/Xacro behavior is unchanged.

## Implementation Tasks

### Task 1: Add USD Binding State

**Files:**
- Create: `src/store/usdRobotBindingStore.ts`
- Modify: `src/store/index.ts`
- Test: `src/store/usdRobotBindingStore.test.ts`

- [ ] Define `UsdRobotBinding` and keyed storage by normalized stage source path.
- [ ] Add `setUsdRobotBinding`, `getUsdRobotBinding`, `removeUsdRobotBinding`, and `clearUsdRobotBindings`.
- [ ] Normalize paths using the same leading-slash stripping pattern used by `assetsStore`.
- [ ] Test that bindings survive set/get and are cleared when the normalized key matches.

### Task 2: Persist Binding From Hydration

**Files:**
- Modify: `src/app/hooks/useUsdDocumentLifecycle.ts`
- Modify: `src/features/urdf-viewer/utils/viewerRobotData.ts`
- Test: `src/app/hooks/useUsdDocumentLifecycle.test.ts` or adjacent existing USD lifecycle tests

- [ ] Convert each `ViewerRobotDataResolution` into `UsdRobotBinding`.
- [ ] Persist the binding at the same point where `setRobot(committedRobotData, ...)` is called.
- [ ] Include `sceneSnapshotKey` and `preparedExportCacheKey` using the selected USD file name.
- [ ] Clear stale binding when USD hydration is rejected because the selected file no longer matches.

### Task 3: Build Mesh/Object Binding

**Files:**
- Modify: `src/shared/components/3d/renderers/UsdSceneGraph.ts`
- Create: `src/features/urdf-viewer/utils/usdRobotBinding.ts`
- Test: `src/features/urdf-viewer/utils/usdRobotBinding.test.ts`

- [ ] Extract mesh binding from `renderInterface.meshes`, `meshId`, resolved prim path, role, link id, and object index during `buildUsdSceneGraphFromResolution`.
- [ ] Use stable keys like `${linkId}:visual:${objectIndex}` and `${linkId}:collision:${objectIndex}`.
- [ ] Ensure collision and visual bindings are deterministic across reloads.
- [ ] Test folded fixed links, multiple visuals per link, and collision-only semantic child links.

### Task 4: Add RobotState-to-USD Runtime Sync Layer

**Files:**
- Create: `src/features/urdf-viewer/utils/usdRuntimeRobotStateSync.ts`
- Modify: `src/shared/components/3d/renderers/UsdSceneGraph.ts`
- Modify: `src/shared/components/3d/renderers/types.ts`
- Test: `src/features/urdf-viewer/utils/usdRuntimeRobotStateSync.test.ts`

- [ ] Add backend method `syncRobotStatePatch(previous, next, binding)` or equivalent typed API.
- [ ] Support visibility sync for link visual/collision meshes.
- [ ] Support collision origin sync through existing mesh transform update path.
- [ ] Support material color/opacity override only when the target runtime material can be safely resolved.
- [ ] Return structured unsupported edit records for topology edits, mesh replacement, USD variant changes, and unresolvable prims.

### Task 5: Route Editor Mutations Through Runtime Sync

**Files:**
- Modify: `src/app/hooks/useWorkspaceMutations.ts`
- Modify: `src/features/urdf-viewer/hooks/useRendererBackend.ts`
- Modify: `src/features/urdf-viewer/components/RobotModel.tsx`
- Test: `src/app/hooks/useWorkspaceMutations.usd.test.ts`

- [ ] Keep `updateLink` and `updateJoint` as the first write.
- [ ] After store mutation, if selected file is USD and a binding/backend exists, call the runtime sync API.
- [ ] Do not mutate USD runtime when the backend is loading or the binding stage path does not match the selected file.
- [ ] Record unsupported edits in a lightweight pending USD semantic changes list.

### Task 6: Preserve Fast Loading

**Files:**
- Modify: `src/features/urdf-viewer/utils/rendererBackendLoadScope.ts`
- Modify: `src/features/urdf-viewer/hooks/useRendererBackend.ts`
- Test: `src/features/urdf-viewer/utils/rendererBackendLoadScope.test.ts`

- [ ] Keep USD backend load scope based on source file, assets, available files, and reload token.
- [ ] Do not include hydrated `RobotState` in USD load scope.
- [ ] Add a separate runtime-sync revision key that does not recreate the USD backend.
- [ ] Verify hydration data changes still do not cause USD reloads.

### Task 7: Export and Project Persistence

**Files:**
- Modify: `src/app/utils/usdExportContext.ts`
- Modify: `src/features/urdf-viewer/utils/usdExportBundle.ts`
- Modify: `src/features/file-io/utils/projectExport.ts`
- Modify: `src/features/file-io/utils/projectImport.ts`
- Test: `src/app/utils/usdExportContext.test.ts`
- Test: `src/features/file-io/utils/projectExport.usdRobotBinding.test.ts`

- [ ] Include `UsdRobotBinding` in `.usp` project export/import.
- [ ] Resolve USD export bundle from current `RobotState` plus binding plus snapshot/cache.
- [ ] Ensure semantic-only edits are included in generated USD export output when live runtime sync did not apply.
- [ ] Keep existing prepared export cache behavior for fast export.

### Task 8: UI Status for Unsupported Live Edits

**Files:**
- Modify: `src/features/property-editor/components/PropertyEditor.tsx`
- Modify: `src/shared/i18n/locales/en.ts`
- Modify: `src/shared/i18n/locales/zh.ts`
- Test: `src/features/property-editor/components/PropertyEditor.test.tsx`

- [ ] Show a concise non-blocking status when a USD edit is saved semantically but not applied to the live stage.
- [ ] Avoid modal interruptions for normal edits.
- [ ] Clear the status after successful export, reload, or a later successful live sync.

### Task 9: Regression and Performance Gates

**Files:**
- Modify: `docs/update-rules.md`
- Modify: `docs/viewer.md`
- Add tests only where needed under existing USD utility test locations.

- [ ] Run unit tests for binding, runtime sync, export context, and project import/export.
- [ ] Run `npm run typecheck`.
- [ ] Run focused USD tests: `src/features/urdf-viewer/utils/usdViewerRobotAdapter.test.ts`, `src/features/urdf-viewer/utils/usdRuntimeRobotHydration.test.ts`, and new binding/sync tests.
- [ ] Run browser fixture smoke for `test/unitree_model/Go2/usd/go2.usd`, `B2`, and `H1-2`.
- [ ] Capture stage load debug timings before and after; fail the change if p95 load time regresses by more than 10% on the same machine/browser.

## Risks and Mitigations

- **Risk:** RobotState becomes polluted with USD runtime internals.
  **Mitigation:** Keep large snapshots and path maps in `UsdRobotBinding`, not in `RobotState`.

- **Risk:** RobotState edits trigger USD stage reloads and hurt speed.
  **Mitigation:** Keep USD load scope source-based and add runtime sync as a separate path.

- **Risk:** Runtime display diverges from saved semantic state.
  **Mitigation:** Return explicit unsupported edit records and surface a small UI status.

- **Risk:** Export loses edits because snapshot geometry and current RobotState differ.
  **Mitigation:** Reuse the existing merge pattern in `usdExportBundle` and extend tests around currentRobot merging.

- **Risk:** Mapping is wrong for folded fixed links or collision-only links.
  **Mitigation:** Base mapping only on runtime metadata/snapshot evidence, following `docs/viewer.md` USD constraints.

## Verification Commands

```bash
npm run typecheck
npm run test -- src/features/urdf-viewer/utils/usdRobotBinding.test.ts
npm run test -- src/features/urdf-viewer/utils/usdRuntimeRobotStateSync.test.ts
npm run test -- src/app/utils/usdExportContext.test.ts
npm run test -- src/features/file-io/utils/projectExport.usdRobotBinding.test.ts
npm run test -- src/features/urdf-viewer/utils/usdViewerRobotAdapter.test.ts src/features/urdf-viewer/utils/usdRuntimeRobotHydration.test.ts
```

For fixture performance, use the existing USD browser regression workflow documented in `docs/update-rules.md` and write output under `tmp/regression/`.

## Recommended Delivery Order

1. Binding store and hydration persistence.
2. Mesh/object binding extraction.
3. Runtime sync for visibility and collision origin only.
4. Export/project persistence.
5. Material override sync.
6. UI unsupported-edit status.
7. Broader fixture and performance hardening.
