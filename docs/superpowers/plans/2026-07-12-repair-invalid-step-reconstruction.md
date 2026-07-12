# Repair Invalid STEP Reconstruction Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore immediately valid STEP exports, then re-enable planar reconstruction only after ordered boundary loops, real OCCT faces, bounded fallback, resource cleanup, and CAD reopen gates pass.

**Architecture:** Quarantine the broken reconstruction integration behind an explicit experimental flag and restore the verified faceted-face path as the default safety net. Move boundary extraction and OCCT face construction into separately tested modules; re-enable analytic regions incrementally, starting with planes, while cylinder/sphere/cone remain bounded faceted fallback until they have their own trimmed-face builders.

**Tech Stack:** TypeScript 5.8, Three.js, OpenCascade.js 1.1.1 / OCCT 7.4 WASM, Web Worker, Vite, Node test runner, browser automation, optional FreeCAD CLI.

---

## Scope and safety rules

1. Base review range: `a01e6ced..07489e0d`.
2. Do not delete the pure fitting modules; quarantine only their unsafe OCCT integration.
3. Do not use `polygon.Shape()` as a face. Every surface passed as mesh geometry must be a verified `TopoDS_Face`, shell, or solid.
4. Do not connect a `Set` of region vertices into a polygon.
5. Do not catch resource-limit errors and export the original unlimited mesh.
6. Do not silently omit triangles or regions.
7. Do not enable cylinder, sphere, or cone reconstruction until a corresponding trimmed-face builder and real-WASM test exist.
8. Do not claim completion based on TypeScript unit tests alone.
9. Run `git status --short` before each task and commit only listed files.
10. Stop on unrelated failures rather than resetting user work.

## Target file boundaries

- Create `stepReconstructionFeatureGate.ts`: safe default and explicit experimental enablement.
- Create `stepRegionBoundary.ts`: pure oriented boundary-loop extraction.
- Create `stepOcctFaceFactory.ts`: verified triangle and planar-face construction.
- Create `stepOcctRuntime.test.ts`: real bundled-WASM write/read assertions.
- Modify `stepOcctWorker.ts`: orchestration only; remove inline unsafe builders.
- Modify `stepFallbackBudget.ts`: strict resource/fallback decisions.
- Modify Worker bridge and result diagnostics only when required by tests.
- Create browser regression and optional FreeCAD validator before enabling reconstruction.

## Task 0: Preserve evidence and establish the last-known-good baseline

**Files:**
- Inspect: `src/core/parsers/step/stepOcctWorker.ts`
- Create locally: `tmp/step-reconstruction-repair/`

- [ ] **Step 1: Confirm repository state**

```powershell
git status --short --branch
git log --oneline -10
git diff a01e6ced..07489e0d -- src/core/parsers/step/stepOcctWorker.ts
```

Expected: current HEAD is recorded and unrelated changes are absent. If dirty, stop and ask the owner before switching or reverting.

- [ ] **Step 2: Save failing exported sample**

Copy the user-failing STEP to `tmp/step-reconstruction-repair/failing.step`. Record size and entity counts:

```powershell
$step = 'tmp\step-reconstruction-repair\failing.step'
@('ADVANCED_FACE','OPEN_SHELL','CLOSED_SHELL','MANIFOLD_SOLID_BREP','EDGE_LOOP') |
  ForEach-Object {
    $count = (Select-String -LiteralPath $step -Pattern $_ -AllMatches |
      ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
    "$_=$count"
  }
```

Expected failing signature: missing or unexpectedly low `ADVANCED_FACE`/shell entities, or only wire/edge topology.

- [ ] **Step 3: Verify pre-integration behavior without changing the branch**

Use `git show a01e6ced:src/core/parsers/step/stepOcctWorker.ts` to confirm the old path called `BRepBuilderAPI_MakeFace_15(wire, true)`. Do not check out the old commit yet.

- [ ] **Step 4: Run current focused checks**

```powershell
npm run test:unit -- src/core/parsers/step/stepSurfaceReconstruction.test.ts src/core/parsers/step/stepOcctUtils.test.ts
npm run typecheck:quality
```

Expected: they pass, documenting that current tests do not reproduce the runtime regression.

## Task 1: Quarantine unsafe reconstruction and restore valid default exports

**Files:**
- Create: `src/core/parsers/step/stepReconstructionFeatureGate.ts`
- Create: `src/core/parsers/step/stepReconstructionFeatureGate.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`

- [ ] **Step 1: Write the failing feature-gate test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseAnalyticReconstruction } from './stepReconstructionFeatureGate';

test('analytic reconstruction is disabled by default', () => {
  assert.equal(shouldUseAnalyticReconstruction(undefined), false);
  assert.equal(shouldUseAnalyticReconstruction(false), false);
});

test('analytic reconstruction requires an explicit experimental flag', () => {
  assert.equal(shouldUseAnalyticReconstruction(true), true);
});
```

Run:

```powershell
npm run test:unit -- src/core/parsers/step/stepReconstructionFeatureGate.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the gate**

```ts
export function shouldUseAnalyticReconstruction(
  experimentalEnabled: boolean | undefined,
): boolean {
  return experimentalEnabled === true;
}
```

Add `experimentalAnalyticReconstruction?: boolean` to the Worker request. Do not derive this flag from `meshMode`.

- [ ] **Step 3: Restore the verified default mesh path**

When the experimental flag is false, every mesh must call the old `buildMeshShape` path, which creates real faces with:

```ts
const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
if (!faceMaker.IsDone()) {
  throw new Error('OCCT failed to create a triangle face.');
}
const face = faceMaker.Face();
```

Delete no fitting modules. Bypass only lines introduced by `07489e0d`.

- [ ] **Step 4: Make resource limits fail closed**

If input exceeds browser limits, throw the original `ResourceLimitError`. Do not catch it and call `buildMeshShape(oc, positions)`.

- [ ] **Step 5: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepReconstructionFeatureGate.test.ts src/core/parsers/step/stepOcctUtils.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepReconstructionFeatureGate.ts src/core/parsers/step/stepReconstructionFeatureGate.test.ts src/core/parsers/step/stepOcctWorker.ts
git commit -m "fix(step): quarantine invalid analytic reconstruction"
```

Expected: default export no longer enters `buildPlanarFace` or `buildSingleTriangle`.

## Task 2: Add a real OCCT STEP validity gate

**Files:**
- Create: `src/core/parsers/step/stepOcctRuntime.test.ts`
- Modify only if necessary: test runner configuration

- [ ] **Step 1: Build a real triangle face fixture**

The test must load bundled `opencascade.wasm.js`, construct three points, a closed wire, `BRepBuilderAPI_MakeFace_15`, a compound, and `STEPControl_Writer`. It must not mock Worker or OCCT.

- [ ] **Step 2: Assert OCCT construction state**

Assert:

```ts
assert.equal(faceMaker.IsDone(), true);
assert.equal(face.IsNull(), false);
assert.equal(writer.Transfer(compound, 0, true).value, retDone);
assert.equal(writer.Write(path).value, retDone);
```

Use the existing MEMFS filename-normalization helper rather than duplicating corrupted-filename handling.

- [ ] **Step 3: Assert STEP content**

```ts
assert.match(text, /^ISO-10303-21;/);
assert.equal((text.match(/ADVANCED_FACE/g) ?? []).length, 1);
assert.ok((text.match(/EDGE_LOOP/g) ?? []).length >= 1);
assert.doesNotMatch(text, /NaN|Infinity/);
```

- [ ] **Step 4: Add a negative wire-only test**

Write a closed polygon `Shape()` without MakeFace and prove it produces no `ADVANCED_FACE`. This test documents why wire-only helpers are forbidden.

- [ ] **Step 5: Release all wrappers in `finally`**

The test must delete points, polygon, wire, face maker, face, builder, compound, writer, and MEMFS files even on assertion failure.

- [ ] **Step 6: Run and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepOcctRuntime.test.ts
git add src/core/parsers/step/stepOcctRuntime.test.ts
git commit -m "test(step): verify real OCCT face STEP output"
```

Expected: face test passes; wire-only test confirms zero `ADVANCED_FACE`.

## Task 3: Extract ordered boundary loops from planar regions

**Files:**
- Create: `src/core/parsers/step/stepRegionBoundary.ts`
- Create: `src/core/parsers/step/stepRegionBoundary.test.ts`
- Modify: `src/core/parsers/step/stepMeshRegionTypes.ts`

- [ ] **Step 1: Define boundary result**

```ts
export interface StepRegionBoundary {
  outerLoop: number[];
  holeLoops: number[][];
  boundaryEdges: Array<[number, number]>;
}

export interface StepBoundaryFailure {
  reason: 'open-loop' | 'branched-boundary' | 'self-intersection' | 'empty';
  details: string;
}
```

Return a discriminated union `{ok:true; boundary:...} | {ok:false; failure:...}`.

- [ ] **Step 2: Write failing fixtures**

Cover:

1. two-triangle square → outer loop has four vertices;
2. square with square hole → one outer loop and one hole;
3. disconnected planar islands → reject as multiple components at this layer;
4. T-junction boundary → `branched-boundary`;
5. open boundary chain → `open-loop`;
6. shuffled triangle IDs → identical canonical loops;
7. reversed winding → same vertices with opposite orientation corrected.

- [ ] **Step 3: Count oriented half-edges**

For every region triangle add its three directed edges. An undirected edge occurring once is a boundary edge; twice is internal; more than twice fails as branched/non-manifold.

- [ ] **Step 4: Walk loops**

Build outgoing boundary adjacency. Every boundary vertex must have exactly one incoming and one outgoing edge. Walk from the smallest vertex ID, close at the start, and reject early repeats.

- [ ] **Step 5: Classify outer and holes**

Project vertices onto the fitted plane basis, calculate signed shoelace area, choose the largest absolute-area loop as outer, orient outer counter-clockwise and holes clockwise. Detect 2D segment intersections excluding adjacent edges.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepRegionBoundary.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepRegionBoundary.ts src/core/parsers/step/stepRegionBoundary.test.ts src/core/parsers/step/stepMeshRegionTypes.ts
git commit -m "feat(step): extract deterministic planar boundary loops"
```

Expected: all boundary fixtures pass without OCCT.

## Task 4: Build real planar faces from verified boundary loops

**Files:**
- Create: `src/core/parsers/step/stepOcctFaceFactory.ts`
- Create: `src/core/parsers/step/stepOcctFaceFactory.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`

- [ ] **Step 1: Define factory contract**

```ts
export interface StepOcctFaceResult {
  shape: unknown;
  faceCount: number;
  warnings: string[];
}

export function buildOcctTriangleFace(
  oc: unknown,
  coordinates: readonly number[],
): StepOcctFaceResult;

export function buildOcctPlanarRegionFace(
  oc: unknown,
  vertices: readonly number[],
  boundary: StepRegionBoundary,
): StepOcctFaceResult;
```

OCCT `any` stays inside this file.

- [ ] **Step 2: Implement triangle face**

Use verified `BRepBuilderAPI_MakePolygon_1`, retrieve `Wire()`, then `BRepBuilderAPI_MakeFace_15(wire, true)`. Return only `Face()`, never `polygon.Shape()`.

- [ ] **Step 3: Implement outer and hole wires**

Create each ordered loop as a closed wire. Create the planar face from the outer wire. Probe the bundled MakeFace/Add overload for hole wires in the real-WASM test; use only the verified method. If hole insertion is unavailable, return failure so the region enters faceted fallback.

- [ ] **Step 4: Add real-WASM assertions**

Test a square and square-with-hole. Write STEP and assert expected `ADVANCED_FACE` count, no NaN, and successful Transfer/Write. If FreeCAD is available, reopen and assert shape count is non-zero.

- [ ] **Step 5: Replace unsafe worker helpers**

Delete inline `buildSingleTriangle` and `buildPlanarFace`. Worker calls only the factory. If boundary extraction or face construction fails, route the complete region to bounded fallback.

- [ ] **Step 6: Guarantee cleanup**

After `builder.Add(compound, shape)`, delete only the JS wrapper when safe. Every point, wire, polygon, maker, temporary face, and builder is released in `finally`.

- [ ] **Step 7: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepRegionBoundary.test.ts src/core/parsers/step/stepOcctFaceFactory.test.ts src/core/parsers/step/stepOcctRuntime.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepOcctFaceFactory.ts src/core/parsers/step/stepOcctFaceFactory.test.ts src/core/parsers/step/stepOcctWorker.ts
git commit -m "fix(step): construct valid planar and fallback faces"
```

## Task 5: Enforce the 5,000-face fallback budget

**Files:**
- Modify: `src/core/parsers/step/stepFallbackBudget.ts`
- Modify: `src/core/parsers/step/stepFallbackBudget.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`

- [ ] **Step 1: Add failure tests**

Assert that omitted fallback regions produce a structured failure and that total allocated output never exceeds 5,000.

- [ ] **Step 2: Carry fallback region area and triangle IDs**

Worker builds `FallbackRegionInfo` from rejected analytic regions. Calculate actual area from `MeshAnalysis`; do not use triangle count as area.

- [ ] **Step 3: Fail when a region cannot receive a budget**

If `omittedRegions.length > 0`, throw:

```ts
new Error(
  `STEP faceted fallback cannot retain all regions within 5000 triangles; omitted regions: ${ids.join(', ')}`,
);
```

- [ ] **Step 4: Simplify each fallback region before OCCT**

Use `simplifyStepMesh` or a region-scoped equivalent. Verify actual resulting sum at most 5,000 before creating any OCCT faces.

- [ ] **Step 5: Never export original mesh on resource error**

Delete the catch branch that calls `buildMeshShape(oc, positions)`. Resource limit errors reach the main thread unchanged.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepFallbackBudget.test.ts src/core/parsers/step/stepMeshSimplifier.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepFallbackBudget.ts src/core/parsers/step/stepFallbackBudget.test.ts src/core/parsers/step/stepOcctWorker.ts
git commit -m "fix(step): enforce bounded faceted fallback"
```

## Task 6: Add lifecycle guards and leak regression

**Files:**
- Create: `src/core/parsers/step/stepOcctResourceScope.ts`
- Create: `src/core/parsers/step/stepOcctResourceScope.test.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`
- Modify: `src/core/parsers/step/stepOcctFaceFactory.ts`

- [ ] **Step 1: Implement an idempotent scope**

```ts
export interface DeletableOcct {
  delete?: () => void;
}

export class StepOcctResourceScope {
  private resources: DeletableOcct[] = [];
  own<T extends DeletableOcct>(value: T): T {
    this.resources.push(value);
    return value;
  }
  release(value: DeletableOcct): void {
    const index = this.resources.lastIndexOf(value);
    if (index >= 0) this.resources.splice(index, 1);
  }
  dispose(): void {
    for (let i = this.resources.length - 1; i >= 0; i--) {
      this.resources[i].delete?.();
    }
    this.resources = [];
  }
}
```

- [ ] **Step 2: Test reverse-order and exception cleanup**

Use fake wrappers that record deletion. Assert reverse order, no double delete, and cleanup after a thrown callback.

- [ ] **Step 3: Apply scopes per triangle, region, mesh, and export**

No inline `new oc.gp_Pnt_3` may remain unowned. Local `BRep_Builder`, compounds, face wrappers, transform wrappers, writer, and MEMFS files all require deterministic cleanup.

- [ ] **Step 4: Repeat real export 20 times**

The real-WASM test writes the same small fixture 20 times and asserts identical byte size/entity counts and no runtime exception.

- [ ] **Step 5: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepOcctResourceScope.test.ts src/core/parsers/step/stepOcctFaceFactory.test.ts src/core/parsers/step/stepOcctRuntime.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepOcctResourceScope.ts src/core/parsers/step/stepOcctResourceScope.test.ts src/core/parsers/step/stepOcctFaceFactory.ts src/core/parsers/step/stepOcctWorker.ts
git commit -m "fix(step): release OCCT reconstruction resources"
```

## Task 7: Re-enable plane reconstruction only

**Files:**
- Modify: `src/core/parsers/step/stepReconstructionFeatureGate.ts`
- Modify: `src/core/parsers/step/stepOcctWorker.ts`
- Modify: `src/core/parsers/step/stepSurfaceReconstruction.ts`
- Create: `src/core/parsers/step/stepPlaneIntegration.test.ts`

- [ ] **Step 1: Restrict enabled analytic types**

```ts
export const ENABLED_STEP_ANALYTIC_SURFACES = new Set(['plane'] as const);
```

Cylinder, sphere, and cone fit results remain diagnostic candidates but route to fallback until their OCCT surface and trim builders exist.

- [ ] **Step 2: Add planar integration fixtures**

Test a planar grid, planar L-shape, square with hole, two disconnected planar islands, and a mixed plane/freeform mesh.

- [ ] **Step 3: Assert complete triangle coverage**

For every fixture:

```ts
const covered = new Set([
  ...analyticRegions.flatMap(r => r.triangleIds),
  ...fallbackRegions.flatMap(r => r.triangleIds),
]);
assert.equal(covered.size, inputTriangleCount);
```

Also assert no triangle appears twice.

- [ ] **Step 4: Write STEP and inspect entities**

Accepted planar regions must produce real `ADVANCED_FACE`; fallback produces real triangle faces. Assert no wire-only region replaces surface geometry.

- [ ] **Step 5: Keep reconstruction experimental**

Do not make the flag default true in this task. Browser verification must pass first.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:unit -- src/core/parsers/step/stepPlaneIntegration.test.ts src/core/parsers/step/stepSurfaceReconstruction.test.ts src/core/parsers/step/stepRegionBoundary.test.ts
npm run typecheck:quality
git add src/core/parsers/step/stepReconstructionFeatureGate.ts src/core/parsers/step/stepOcctWorker.ts src/core/parsers/step/stepSurfaceReconstruction.ts src/core/parsers/step/stepPlaneIntegration.test.ts
git commit -m "feat(step): safely integrate planar reconstruction"
```

## Task 8: Add browser and independent CAD reopen gates

**Files:**
- Create: `scripts/test/browser/test_step_reconstruction_export.mjs`
- Create locally: `tmp/step-reconstruction-repair/validate_step.py`
- Modify: `package.json`

- [ ] **Step 1: Add browser fixture flow**

Import a planar mesh fixture, export once with reconstruction false and once true, wait for downloads, and save them under `tmp/step-reconstruction-repair/`.

- [ ] **Step 2: Validate STEP text**

Both files must start with `ISO-10303-21;`, contain at least one `ADVANCED_FACE`, contain no NaN/Infinity, and finish with `END-ISO-10303-21;`.

- [ ] **Step 3: Validate reconstruction reduction**

Experimental planar file must contain fewer `ADVANCED_FACE` entries than faceted baseline while preserving bounding box.

- [ ] **Step 4: Reopen independently**

Locate `FreeCADCmd.exe` without installing software. Open both files and record object count, shape count, validity, shell/solid count, and bounding box. If unavailable, report incomplete acceptance and do not enable reconstruction by default.

- [ ] **Step 5: Add package command**

```json
"test:browser:step-reconstruction": "node scripts/test/browser/test_step_reconstruction_export.mjs"
```

- [ ] **Step 6: Run final verification**

```powershell
npm run test:unit -- src/core/parsers/step/stepOcctRuntime.test.ts src/core/parsers/step/stepRegionBoundary.test.ts src/core/parsers/step/stepOcctFaceFactory.test.ts src/core/parsers/step/stepFallbackBudget.test.ts src/core/parsers/step/stepPlaneIntegration.test.ts
npm run typecheck:quality
npm run build:app
npm run test:browser:step-reconstruction
git diff --check
```

Expected: all pass and FreeCAD report says both files open successfully.

- [ ] **Step 7: Enable reconstruction only after acceptance**

Only after Step 6 and independent reopen pass may the product default set `experimentalAnalyticReconstruction=true` for CAD-compatible mode. Otherwise keep it false.

- [ ] **Step 8: Clean processes and commit**

Run the repository browser cleanup script if present, stop only the test dev server, then:

```powershell
git add scripts/test/browser/test_step_reconstruction_export.mjs package.json
git commit -m "test(step): gate reconstruction on CAD reopen"
```

## Separate future plans

Do not implement these in this repair plan:

- cylinder trimmed-face construction;
- sphere trimmed-face construction;
- cone trimmed-face construction;
- seam unwrapping for periodic surfaces;
- general BSpline fitting.

Each requires its own real-WASM face factory and CAD reopen plan. Existing mathematical fitters remain in the repository but are not production-enabled.

## Completion rejection conditions

Reject the change if any condition holds:

- default export still enters unsafe reconstruction before CAD reopen passes;
- `polygon.Shape()` is used as a surface face;
- region vertices are connected without boundary-loop extraction;
- any resource error exports the full original mesh;
- fallback exceeds 5,000 faces;
- any input triangle is lost or duplicated;
- cylinder/sphere/cone are enabled without trimmed-face builders;
- OCCT wrappers lack deterministic cleanup;
- tests mock OCCT instead of writing a real STEP;
- browser export or independent reopen was skipped.

## Required handoff

The executing AI must provide:

1. Commit list.
2. Before/after STEP entity counts and file sizes.
3. Exact real-WASM, typecheck, build, browser, and FreeCAD results.
4. Triangle coverage proof.
5. Fallback face count.
6. Remaining disabled analytic types and reasons.
7. Confirmation that no generated bindings, dependencies, or unrelated files changed.

