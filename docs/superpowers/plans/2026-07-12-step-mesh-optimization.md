# STEP Mesh Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight and CAD-repair STEP mesh export modes that reduce file size, produce sewn topology, report damage explicitly, and preserve analytic primitives.

**Architecture:** Replace flat repeated triangle payloads with indexed, cleaned mesh payloads before OCCT. Keep topology and budgets in pure TypeScript, isolate sewing/healing in one OCCT adapter, and gate AP242 output behind a reproducible capability probe with a mandatory sewn-shell fallback.

**Tech Stack:** React 19, TypeScript 5.8, Three.js, OpenCascade.js 1.1.1 / OCCT 7.4 WASM, Vite workers, Node tests, browser automation, optional FreeCAD CLI.

---

## Execution rules

1. Work on `codex/step-mesh-optimization`, not directly on `dev2`.
2. Run `git status --short` before every task. Never reset or restore unrelated work.
3. Never edit `node_modules/**`, generated bindings, or `public/wasm/**`.
4. Never hand-write STEP text, boolean-fuse the robot, or call an unvalidated shell a solid.
5. Commit only files listed for the current task.
6. Stop on unrelated failures instead of broadening scope.
7. AP242 probe failure must continue through the sewn-shell fallback; it is not a blocker.
8. Browser and FreeCAD evidence are required before claiming completion.

## Target modules

- `stepMeshTypes.ts`: indexed payloads, modes, diagnostics.
- `stepMeshConfig.ts`: centralized budgets and tolerances.
- `stepMeshTopology.ts`: weld, cleanup, adjacency, winding.
- `stepMeshBudget.ts`: aggregate budget allocation.
- `stepMeshSimplifier.ts`: simplification adapter and validation.
- `stepOcctMeshBuilder.ts`: faces, sewing, healing, shell/solid conversion.
- `stepAp242Capability.ts`: immutable probe result.
- Existing provider/generator/worker/bridge/export dialog files: integration only.

## Task 0: Protect the branch and measure the baseline

**Files:**
- Inspect: `CLAUDE.md`
- Create locally: `tmp/step-mesh-baseline/baseline.json`

- [ ] **Step 1: Check state**

```powershell
git status --short --branch
git log --oneline -5
```

Expected: tree state is recorded. If dirty, stop and ask how to preserve it.

- [ ] **Step 2: Create the branch**

```powershell
git switch -c codex/step-mesh-optimization
```

Expected: `git branch --show-current` prints that name.

- [ ] **Step 3: Verify baseline health**

```powershell
npm run test:unit -- src/core/parsers/step/stepGenerator.test.ts src/core/parsers/step/stepOcctUtils.test.ts src/app/hooks/file-export/stepExport.test.ts
npm run typecheck:quality
npm run build:app
```

Expected: all pass. Stop on failure.

- [ ] **Step 4: Export small, medium, and large baseline fixtures**

Disable STEP compression and record this exact JSON per fixture:

```json
{"name":"medium","sourceTriangles":25000,"stepBytes":0,"durationMs":0,"advancedFaceCount":0,"openResult":"not_checked"}
```

Replace zeros with measurements. Do not commit `tmp/`.

## Task 1: Add product types and centralized limits

**Files:**
- Create: `src/core/parsers/step/stepMeshTypes.ts`
- Create: `src/core/parsers/step/stepMeshConfig.ts`
- Create: `src/core/parsers/step/stepMeshConfig.test.ts`
- Modify: `src/features/file-io/components/ExportDialog/types.ts`
- Modify: `src/features/file-io/components/ExportDialog/config.ts`

- [ ] **Step 1: Write the failing config test**

```ts
test('STEP presets match the contract', () => {
  assert.deepEqual(STEP_MESH_PRESETS, {
    lightweight: { small: 5_000, balanced: 15_000, high: 50_000 },
    cadRepair: { small: 15_000, balanced: 40_000, high: 100_000 },
  });
  assert.equal(STEP_MESH_TOTAL_TRIANGLE_LIMIT, 250_000);
  assert.equal(STEP_MESH_MIN_BUDGET, 500);
});
```

Run `npm run test:unit -- src/core/parsers/step/stepMeshConfig.test.ts`.
Expected: FAIL because exports do not exist.

- [ ] **Step 2: Define exact contracts**

```ts
export type StepMeshMode = 'lightweight' | 'cad-repair';
export type StepMeshPreset = 'small' | 'balanced' | 'high';
export type StepMeshOutputKind = 'ap242-tessellated' | 'sewn-shell' | 'repaired-solid';

export interface StepIndexedMesh {
  vertices: number[];
  indices: number[];
}

export interface StepMeshDiagnostics {
  linkId: string;
  linkName: string;
  meshPath: string;
  inputTriangles: number;
  outputTriangles: number;
  weldedVertices: number;
  removedNonFiniteTriangles: number;
  removedDegenerateTriangles: number;
  removedDuplicateTriangles: number;
  connectedComponents: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  sewnShells: number;
  solids: number;
  outputKind: StepMeshOutputKind;
  elapsedMs: number;
  warnings: string[];
}
```

- [ ] **Step 3: Centralize constants**

Export the tested budgets, total 250,000, minimum 500, weld ratio `1e-7`, weld min `1e-9`, weld max `1e-4`, and sewing multiplier `2`.

- [ ] **Step 4: Replace STEP config**

```ts
export interface StepExportConfig {
  includeMeshes: boolean;
  meshMode: StepMeshMode;
  meshPreset: StepMeshPreset;
}
```

Default: `true`, `lightweight`, `balanced`. Update every fixture that constructs `ExportDialogConfig`.

- [ ] **Step 5: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepMeshConfig.test.ts src/features/file-io/components/ExportDialog/ExportDialog.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepMeshTypes.ts src/core/parsers/step/stepMeshConfig.ts src/core/parsers/step/stepMeshConfig.test.ts src/features/file-io/components/ExportDialog/types.ts src/features/file-io/components/ExportDialog/config.ts src/features/file-io/components/ExportDialog/ExportDialog.test.ts
git commit -m "feat(step): define mesh export modes and budgets"
```

## Task 2: Implement deterministic indexed topology cleanup

**Files:**
- Create: `src/core/parsers/step/stepMeshTopology.ts`
- Create: `src/core/parsers/step/stepMeshTopology.test.ts`
- Modify: `src/core/parsers/step/stepMeshTypes.ts`

- [ ] **Step 1: Add result types**

```ts
export interface PreparedStepMesh {
  mesh: StepIndexedMesh;
  components: number[][];
  boundaryVertices: number[];
  weldTolerance: number;
  stats: {
    inputTriangles: number;
    weldedVertices: number;
    removedNonFiniteTriangles: number;
    removedDegenerateTriangles: number;
    removedDuplicateTriangles: number;
    connectedComponents: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
  };
}
```

- [ ] **Step 2: Write failing tests**

Create exact fixtures for: duplicated vertices; duplicate and reverse-duplicate faces; collinear triangle; NaN/Infinity in every coordinate slot; closed tetrahedron; open two-triangle square; three faces sharing one edge; two disconnected components. Assert deterministic arrays and counts.

Run:

```powershell
npm run test:unit -- src/core/parsers/step/stepMeshTopology.test.ts
```

Expected: FAIL because `prepareStepMeshTopology` is missing.

- [ ] **Step 3: Weld vertices**

Compute bounding-box diagonal, then:

```ts
const raw = diagonal * STEP_MESH_WELD_TOLERANCE_RATIO;
const tolerance = Math.min(MAX, Math.max(MIN, raw));
const key = [x, y, z].map(v => Math.round(v / tolerance)).join(',');
```

Retain the first finite vertex for deterministic output.

- [ ] **Step 4: Filter faces**

Reject any non-finite coordinate, repeated welded index, squared cross-product below `tolerance ** 4`, and duplicate sorted index triple. Count each rejection category.

- [ ] **Step 5: Build adjacency and winding**

Store incident triangles under undirected `min:max` edge keys. Incident count 1 is boundary; greater than 2 is non-manifold. Traverse two-incident edges to find components and flip neighbors that traverse the shared directed edge in the same direction. Never propagate through non-manifold edges.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepMeshTopology.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepMeshTypes.ts src/core/parsers/step/stepMeshTopology.ts src/core/parsers/step/stepMeshTopology.test.ts
git commit -m "feat(step): clean and index mesh topology"
```

## Task 3: Allocate budgets and simplify safely

**Files:**
- Create: `src/core/parsers/step/stepMeshBudget.ts`
- Create: `src/core/parsers/step/stepMeshBudget.test.ts`
- Create: `src/core/parsers/step/stepMeshSimplifier.ts`
- Create: `src/core/parsers/step/stepMeshSimplifier.test.ts`
- Modify: `src/app/hooks/file-export/stepMeshGeometryProvider.ts`

- [ ] **Step 1: Test allocation**

Test below-budget retention, preset caps, proportional reduction above 250,000, minimum 500 when possible, deterministic remainder distribution, and total never above 250,000.

- [ ] **Step 2: Implement allocation**

```ts
export function allocateStepMeshBudgets(
  inputs: { id: string; triangleCount: number }[],
  mode: StepMeshMode,
  preset: StepMeshPreset,
): Record<string, number>;
```

Cap each mesh by its preset. If capped sum exceeds 250,000, reserve `min(500, demand)`, distribute remainder proportionally, floor, then assign leftover units in ascending ID order without exceeding demand.

- [ ] **Step 3: Test simplification**

Assert output does not exceed budget, contains finite non-degenerate triangles, preserves boundary vertex positions, preserves a tetrahedron when budget is at least four, and is deterministic.

- [ ] **Step 4: Adapt the existing compressor**

Convert indexed geometry to the existing compressor input only at the adapter boundary. Compute quality `100 * budget / inputTriangles`. Reject simplified output if it loses a boundary vertex or creates invalid triangles; return the cleaned unsimplified mesh with warning `simplification-rejected`. Re-run topology preparation after simplification.

- [ ] **Step 5: Stop flattening source meshes**

Provider must merge child indexed geometries by offsetting indices, bake child transforms and URDF scale exactly once, and return:

```ts
{ mesh: StepIndexedMesh; meshPath: string; sourceTriangles: number }
```

Do not call `toNonIndexed()`.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepMeshBudget.test.ts src/core/parsers/step/stepMeshSimplifier.test.ts src/core/parsers/step/stepMeshTopology.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepMeshBudget.ts src/core/parsers/step/stepMeshBudget.test.ts src/core/parsers/step/stepMeshSimplifier.ts src/core/parsers/step/stepMeshSimplifier.test.ts src/app/hooks/file-export/stepMeshGeometryProvider.ts
git commit -m "feat(step): prepare bounded indexed meshes"
```

## Task 4: Run the AP242 capability gate

**Files:**
- Create: `scripts/test/fixtures/probe_step_ap242.mjs`
- Create: `src/core/parsers/step/stepAp242Capability.ts`
- Create locally: `tmp/step-ap242-probe/report.json`

- [ ] **Step 1: Inventory runtime symbols**

Load bundled glue/WASM and record properties matching `/StepVisual|Tessellated|Triangulated|Poly_Triangulation|STEPControl|Interface_Static/`, including constructor arities.

- [ ] **Step 2: Attempt a two-triangle indexed square**

Use four vertices and indices `[0,1,2,0,2,3]`. Set AP242 only through exposed `Interface_Static`. Use only constructors found by the inventory; log every attempted signature and error. Never guess suffixes.

- [ ] **Step 3: Apply the hard pass gate**

```js
const checks = {
  hasIsoHeader: text.startsWith('ISO-10303-21;'),
  hasTessellatedEntity: /TESSELLATED_|TRIANGULATED_FACE/.test(text),
  avoidsPerTriangleBrep: (text.match(/ADVANCED_FACE/g) ?? []).length === 0,
  sharedVertexCountPreserved: parsedCoordinateCount === 4,
  independentReopen: freeCadOpened === true,
};
```

Missing FreeCAD means `independentReopen=false`, so support is false.

- [ ] **Step 4: Write immutable result**

Export `STEP_AP242_TESSELLATED_SUPPORTED` as true only if every check passes. Otherwise false with a comment listing OCCT version, date, and failed checks. Production must not probe per export.

- [ ] **Step 5: Run and branch**

```powershell
node scripts/test/fixtures/probe_step_ap242.mjs
Get-Content tmp\step-ap242-probe\report.json
```

Expected on incomplete OCCT 7.4 bindings: false plus non-empty `failedChecks`. If true, stop after committing and request maintainer review before writing an AP242 adapter. If false, continue to Task 5 sewn-shell fallback.

- [ ] **Step 6: Commit**

```powershell
git add scripts/test/fixtures/probe_step_ap242.mjs src/core/parsers/step/stepAp242Capability.ts
git commit -m "test(step): probe AP242 tessellated export support"
```

Never commit `tmp/step-ap242-probe/report.json`.

## Task 5: Sew indexed faces into components

**Files:**
- Create: `src/core/parsers/step/stepOcctMeshBuilder.ts`
- Create: `src/core/parsers/step/stepOcctMeshBuilder.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`

- [ ] **Step 1: Define adapter input/output**

```ts
export interface StepOcctMeshBuildInput {
  prepared: PreparedStepMesh;
  mode: StepMeshMode;
  linkId: string;
  linkName: string;
  meshPath: string;
}
export interface StepOcctMeshBuildResult {
  shape: unknown;
  diagnostics: StepMeshDiagnostics;
}
```

Keep OCCT `any` inside this module only.

- [ ] **Step 2: Add real-WASM tests**

Build an open two-triangle square and a tetrahedron. Constructor mismatch is failure, not skip. Skip only if WASM itself cannot load.

- [ ] **Step 3: Probe sewing constructor before use**

Find the actual bundled `BRepBuilderAPI_Sewing` constructor and method suffixes. Record verified names in a comment. Do not fall back to disconnected faces.

- [ ] **Step 4: Sew per component**

For each cleaned triangle create points, polygon wire, `BRepBuilderAPI_MakeFace_15(wire,true)`, and add the face to one sewing instance for that component. Call `Perform()`, retrieve `SewedShape()`, and add only the sewn result to the link compound.

- [ ] **Step 5: Count topology honestly**

Use bundled topology explorers or sewing diagnostics to count free edges, shells, and solids. If bindings cannot count free edges, fail the test and stop. Never fabricate zero.

- [ ] **Step 6: Reduce STEP text**

When exposed, set `write.surfacecurve.mode=0` before writer creation, read it back, and restore the previous global value in `finally`.

- [ ] **Step 7: Release every wrapper**

Use nested `try/finally` for points, polygon, wire, face maker, face, sewing builder, explorers, analyzers, and temporary shapes. Repeat real-WASM test 20 times.

- [ ] **Step 8: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepOcctMeshBuilder.test.ts src/core/parsers/step/stepMeshTopology.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepOcctMeshBuilder.ts src/core/parsers/step/stepOcctMeshBuilder.test.ts src/core/parsers/step/stepOcctWorker.ts
git commit -m "feat(step): sew indexed mesh faces into shells"
```

## Task 6: Add CAD repair without inventing geometry

**Files:**
- Modify: `src/core/parsers/step/stepOcctMeshBuilder.ts`
- Modify: `src/core/parsers/step/stepOcctMeshBuilder.test.ts`

- [ ] **Step 1: Write mode tests**

Tetrahedron must report boundary 0, solid 1, `repaired-solid`. Open square must report boundary 4, solid 0, `sewn-shell`, warning containing `4 free edges`.

- [ ] **Step 2: Heal conservatively**

Use actual bundled `BRepCheck_Analyzer` and `ShapeFix_Shape` methods. Only CAD-repair mode runs healing. On failure retain sewn shape and warn `shape healing failed: <message>`.

- [ ] **Step 3: Gate solid conversion**

Call `BRepBuilderAPI_MakeSolid` only when boundary edges are 0, non-manifold edges are 0, and analyzer says valid. Validate the result again; if invalid, discard it, retain shell, warn `solid validation failed`.

- [ ] **Step 4: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepOcctMeshBuilder.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepOcctMeshBuilder.ts src/core/parsers/step/stepOcctMeshBuilder.test.ts
git commit -m "feat(step): repair closed mesh shells into solids"
```

## Task 7: Integrate worker protocol, budgets, and diagnostics

**Files:**
- Modify: `src/core/parsers/step/stepGenerator.ts`
- Modify: `src/core/parsers/step/stepGenerator.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`
- Modify: `src/core/parsers/step/stepOcctWorkerBridge.ts`

- [ ] **Step 1: Replace flat mesh payload**

```ts
mesh?: {
  vertices: number[];
  indices: number[];
  meshPath: string;
  allocatedBudget: number;
};
```

Add `meshMode` to requests and `diagnostics: StepMeshDiagnostics[]` to success/bridge results.

- [ ] **Step 2: Test protocol**

Assert primitives remain unchanged, indexed arrays and mode are sent, worker diagnostics return unchanged, and warnings survive the bridge.

- [ ] **Step 3: Apply budgets before Worker creation**

Collect triangle counts, allocate, simplify, then calculate actual aggregate. Throw before creating the worker if above 250,000.

- [ ] **Step 4: Wire mandatory fallback**

```ts
const useAp242 =
  request.meshMode === 'lightweight' &&
  STEP_AP242_TESSELLATED_SUPPORTED;
```

When false, both modes call sewn-shell builder. No `not implemented` branch is allowed.

- [ ] **Step 5: Add throttled progress**

Protocol fields: `phase`, `meshIndex`, `meshCount`, `completedTriangles`. Phases: `prepare`, `sew`, `heal`, `write`. Emit at most 10 events/second.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepGenerator.test.ts src/core/parsers/step/stepMeshBudget.test.ts src/core/parsers/step/stepOcctMeshBuilder.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepGenerator.ts src/core/parsers/step/stepGenerator.test.ts src/core/parsers/step/stepOcctWorker.ts src/core/parsers/step/stepOcctWorkerBridge.ts
git commit -m "feat(step): integrate bounded sewn mesh export"
```

## Task 8: Add dual-mode UI and warnings

**Files:**
- Modify: `src/features/file-io/components/ExportDialog/ExportDialog.tsx`
- Modify: `src/features/file-io/components/ExportDialog/ExportDialog.test.ts`
- Modify: `src/app/hooks/file-export/stepExport.ts`
- Modify: `src/app/hooks/file-export/stepExport.test.ts`
- Modify: workflow translation keys and Chinese/English locales

- [ ] **Step 1: Write UI tests**

Selecting STEP must render `轻量查看`, `CAD 修复`, `小文件`, `均衡`, `高细节`, default lightweight-balanced, aggregate limit text, and slower-mode warning. Old percentage slider must be absent.

- [ ] **Step 2: Implement controls**

Keep state in `ExportDialogConfig.step`; do not add a store. Display selected per-mesh budget and aggregate maximum.

- [ ] **Step 3: Render diagnostics**

One warning per problematic mesh: link, path, free/non-manifold edges, input/output triangles, output kind. A skipped mesh makes export partial. Boundary edges alone warn but do not make a successfully written shell partial.

- [ ] **Step 4: Preserve lifecycle**

URL revocation stays in `finally`. Timeout, cancel, generator failure, download failure, and success terminate worker and revoke only export-owned URLs.

- [ ] **Step 5: Verify and commit**

```powershell
npm run test:unit -- src/features/file-io/components/ExportDialog/ExportDialog.test.ts src/app/hooks/file-export/stepExport.test.ts
npm run typecheck:quality
git add src/features/file-io/components/ExportDialog/ExportDialog.tsx src/features/file-io/components/ExportDialog/ExportDialog.test.ts src/app/hooks/file-export/stepExport.ts src/app/hooks/file-export/stepExport.test.ts src/shared/i18n/translationWorkflowKeys.ts src/shared/i18n/locales/enWorkflow.ts src/shared/i18n/locales/zhWorkflow.ts
git commit -m "feat(step): expose lightweight and CAD repair modes"
```

## Task 9: Add browser, size, and CAD gates

**Files:**
- Create: `scripts/test/browser/test_step_export.mjs`
- Create: `scripts/test/benchmark/benchmark_step_export.mjs`
- Modify: `package.json`
- Create locally: `tmp/step-export-freecad/validate_step.py`

- [ ] **Step 1: Benchmark JSON**

Write per fixture/mode/preset: input/output triangles, bytes, duration, boundary/non-manifold edges, shells, solids, warnings.

- [ ] **Step 2: Enforce acceptance**

Exit non-zero if medium or large lightweight-balanced output is less than 70% smaller than baseline, exceeds 250,000 triangles, exceeds five minutes, or a closed CAD-repair fixture has free edges.

- [ ] **Step 3: Browser regression**

Automate import, mode/preset selection, export, and download. Verify ISO header, non-empty file, warnings, and fewer `ADVANCED_FACE` entities than baseline.

- [ ] **Step 4: FreeCAD validation**

Locate `FreeCADCmd.exe` without installing it. If absent, stop and report incomplete CAD acceptance. If present, open every file and record object/shape/shell/solid count, validity, and bounding box. Fail when a closed CAD-repair fixture is invalid or bounding box differs by more than `1e-5` relative tolerance.

- [ ] **Step 5: Add scripts**

```json
"test:browser:step-export": "node scripts/test/browser/test_step_export.mjs",
"test:benchmark:step-export": "node scripts/test/benchmark/benchmark_step_export.mjs"
```

- [ ] **Step 6: Run full verification**

```powershell
npm run test:unit -- src/core/parsers/step/stepMeshConfig.test.ts src/core/parsers/step/stepMeshTopology.test.ts src/core/parsers/step/stepMeshBudget.test.ts src/core/parsers/step/stepMeshSimplifier.test.ts src/core/parsers/step/stepOcctMeshBuilder.test.ts src/core/parsers/step/stepGenerator.test.ts src/app/hooks/file-export/stepExport.test.ts
npm run typecheck:quality
npm run build:app
npm run test:browser:step-export
npm run test:benchmark:step-export
& $freecad.Source tmp\step-export-freecad\validate_step.py
git diff --check
git status --short
```

Expected: every command succeeds.

- [ ] **Step 7: Clean automation processes**

Run `node test/usd-viewer/scripts/cleanup-headless.cjs` if it exists, stop only the dev server created by this test, and never kill the user's browser.

- [ ] **Step 8: Commit test infrastructure**

```powershell
git add scripts/test/browser/test_step_export.mjs scripts/test/benchmark/benchmark_step_export.mjs package.json
git commit -m "test(step): add size and topology regressions"
```

## Completion rejection conditions

Reject the implementation if any is true:

- AP242 was assumed without probe and independent reopen evidence.
- AP242 failed and sewn-shell fallback was omitted.
- Percentage-only compression remains.
- Flat repeated triangle payload remains between provider and worker.
- Faces are added directly to root compound without sewing.
- Free-edge counts are guessed or suppressed.
- Open/non-manifold meshes are forced into solids.
- Size reduction is unmeasured or below 70% on medium/large fixtures.
- Only unit tests ran; browser and CAD-open evidence are missing.
- Generated bindings, `node_modules`, or unrelated files changed.

## Required handoff report

The executing AI must return:

1. Branch and commit list.
2. AP242 report and failed checks.
3. Added/modified files.
4. Exact command results.
5. Baseline-vs-final table for size, triangles, duration, boundaries, shells, and solids.
6. Remaining warnings or unsupported bindings.
7. Confirmation that no generated bindings, dependencies, user browser processes, or unrelated files changed.

