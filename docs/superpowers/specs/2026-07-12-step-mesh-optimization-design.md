# STEP mesh optimization design

## Problem

The current STEP exporter converts every input mesh triangle into an
independent planar `TopoDS_Face`. This proves that geometry can be written, but
it scales poorly: entity count and text size grow approximately linearly with
the original triangle count, coincident edges are not shared, and CAD systems
may display gaps, invalid shells, or large collections of disconnected faces.

The exporter must support two user goals:

1. Lightweight viewing and measurement in CAD software.
2. Heavier topology repair intended for downstream CAD operations.

Analytic URDF primitives must remain native B-Rep geometry in both modes.

## Product modes

### Lightweight mode

Lightweight mode prioritizes file size, opening time, stable visualization,
and measurement. It does not promise editable analytic surfaces.

The implementation must first run a bounded capability spike against the
bundled OpenCascade.js 1.1.1 / OCCT 7.4 runtime. The spike must determine
whether the shipped bindings can create and write an AP242 tessellated shape
representation that can be reopened by at least one independent STEP reader.

If the probe succeeds, lightweight mode uses indexed, welded tessellation and
AP242 output. If it fails, lightweight mode uses the required fallback:

- triangle-budget simplification;
- deterministic vertex welding;
- duplicate and degenerate face removal;
- consistent winding where topology permits it;
- planar face construction followed by sewing into shells;
- STEP output with surface curves disabled where the binding permits it.

The fallback is part of the deliverable, not optional future work.

### CAD repair mode

CAD repair mode prioritizes valid topology and interoperability over speed and
file size. It uses conservative simplification, vertex welding, face creation,
`BRepBuilderAPI_Sewing`, and available shape-healing APIs.

Only closed, manifold, valid shells may be converted to solids. Open or
non-manifold meshes remain shells and produce explicit warnings containing the
link name, source mesh path, free-edge count, and non-manifold-edge count.
Automatic hole filling is out of scope because it can invent incorrect robot
geometry.

## Shared mesh preparation

Mesh preparation must produce indexed geometry instead of a flat repeated
position array. The payload contains a shared vertex array, triangle indices,
the visual transform, and per-mesh diagnostics.

Preparation order is fixed:

1. Load and clone the source mesh.
2. Apply source-node transforms and URDF mesh scale exactly once.
3. Reject non-finite coordinates.
4. Weld vertices using a tolerance derived from the mesh bounding-box diagonal
   and clamped to configured minimum and maximum tolerances.
5. Remove degenerate and duplicate triangles.
6. Build edge adjacency and detect boundary and non-manifold edges.
7. Normalize connected-component winding without crossing non-manifold edges.
8. Simplify to the selected triangle budget while preserving boundaries and
   rejecting flipped or zero-area output triangles.
9. Recompute topology diagnostics after simplification.

The simplifier must accept an absolute triangle budget. A percentage-only API
is insufficient because the same percentage produces radically different STEP
sizes for small and large meshes.

## Quality presets and limits

The export dialog exposes `Lightweight` and `CAD repair` modes plus three
presets. Exact initial budgets are:

| Preset | Lightweight budget per mesh | CAD repair budget per mesh |
| --- | ---: | ---: |
| Small file | 5,000 triangles | 15,000 triangles |
| Balanced | 15,000 triangles | 40,000 triangles |
| High detail | 50,000 triangles | 100,000 triangles |

Meshes below the budget are cleaned but not intentionally decimated. A hard
aggregate limit of 250,000 output triangles applies to one export. If selected
budgets exceed it, budgets are distributed proportionally with a minimum of
500 triangles for each non-empty mesh. The UI reports the resulting aggregate
budget before export.

These values are initial product defaults and must be centralized in one
configuration module so later tuning does not require worker changes.

## OCCT topology construction

Each source mesh is processed independently. The exporter must not boolean-fuse
the entire robot.

For sewn B-Rep output:

- create one face for each cleaned triangle;
- add all faces for one connected component to one sewing operation;
- use a sewing tolerance derived from the same weld tolerance;
- inspect the sewn result and count free edges;
- run available validity and shape-fix APIs;
- convert to a solid only when closed, manifold, and valid;
- add the resulting solid or shell to the link compound;
- preserve link and mesh boundaries in the output hierarchy where supported.

Every OCCT wrapper and temporary shape must be released on both success and
failure paths. Cancellation and timeout must terminate the worker and release
temporary object URLs.

## Diagnostics and failure behavior

One failing mesh must not silently disappear. The worker returns structured
per-mesh diagnostics containing:

- input and output triangle counts;
- welded vertex count;
- removed non-finite, degenerate, and duplicate triangle counts;
- connected-component count;
- boundary and non-manifold edge counts;
- sewn shell and solid counts;
- selected output path: AP242 tessellated, sewn shell, or repaired solid;
- elapsed time and warnings.

If no geometry remains for a mesh, the export is partial and names that mesh in
the warning. If no shape remains anywhere in the robot, export fails. Exceeding
the hard aggregate budget fails before OCCT construction with a precise error
rather than exhausting browser memory.

## Compatibility spike gate

The AP242 spike is successful only if all conditions hold:

- the bundled runtime exposes every required constructor and writer method;
- a deterministic two-triangle indexed fixture is written without hand-editing
  STEP text;
- the output contains tessellated STEP entities rather than one B-Rep face per
  triangle;
- the file reopens in an independent parser or FreeCAD;
- vertex and triangle counts match the fixture;
- a transformed fixture preserves rotation, translation, and units.

If any condition fails, record the probe evidence in a test artifact and use
the sewn-shell fallback. Do not extend generated OCCT bindings as part of this
feature.

## Verification corpus

Verification uses at least three fixtures:

- Small: primitives plus a mesh under 1,000 triangles.
- Medium: 10,000 to 50,000 input triangles with multiple links.
- Large: the user-reported robot or an equivalent model above 100,000 input
  triangles.

For every mode and preset, record input/output triangle counts, file size,
export duration, peak worker memory when measurable, warnings, free edges,
shell/solid counts, and CAD open result.

Browser verification is mandatory. The exported files must also be checked in
FreeCAD when available, using document-open success, shape count, solid/shell
count, and validity results as evidence.

## Acceptance criteria

- Lightweight balanced output is at least 70% smaller than the current
  per-triangle-face baseline on the medium and large fixtures; the target is
  85% smaller.
- The large fixture stays within the 250,000-triangle aggregate limit and does
  not time out under the existing five-minute worker timeout.
- Closed manifold fixtures have zero free edges after CAD repair and reopen as
  valid shells or solids.
- Open fixtures remain shells and report their free-edge count; they are not
  silently converted to solids.
- No exported mesh is represented as a collection of completely disconnected
  faces when sewing succeeds.
- Analytic box, cylinder, and sphere dimensions and transforms remain unchanged.
- Repeated export does not grow retained worker, OCCT, or Blob URL resources.
- Focused tests, `typecheck:quality`, `build:app`, browser export, and CAD-open
  checks all pass before completion.

## Out of scope

- Recovering cylinders, planes, fillets, or NURBS from arbitrary triangle
  meshes.
- Automatically filling unknown holes.
- Boolean fusion of the complete robot.
- Modifying or regenerating the shipped OpenCascade.js bindings.
