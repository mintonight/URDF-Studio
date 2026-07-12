# Browser mesh-to-CAD reconstruction design

## Objective

Replace the default per-triangle STEP mesh path with a browser-only reverse-
engineering pipeline that reconstructs mechanical mesh regions as analytic CAD
surfaces. The primary output is a compact, valid STEP model that opens reliably
in SolidWorks and FreeCAD.

The implementation is not ordinary mesh simplification. It must recognize
analytic regions, rebuild trimmed CAD faces, sew them into shells, and create
solids only when closure and validity are proven.

## Product modes

### CAD compatible

This is the default STEP mode. It performs:

- deterministic mesh cleanup and topology analysis;
- curvature estimation and region growing;
- plane, cylinder, sphere, and cone recognition;
- boundary-loop extraction and parameter-space trimming;
- analytic OCCT face construction;
- sewing, shape validation, and conditional solid conversion;
- bounded faceted fallback for unrecognized regions;
- a reconstruction quality report.

### Raw faceted

This is an advanced compatibility mode. It performs cleanup and simplification
but does not recognize analytic surfaces. The complete robot is limited to
5,000 output triangles. The exporter must block output above this limit rather
than create a very large STEP file.

## Deferred scope

The following are explicitly deferred:

- remote reconstruction services;
- a local native helper;
- uploads, job queues, authentication, and server persistence;
- torus recognition;
- general unrestricted NURBS reconstruction;
- automatic hole filling;
- boolean fusion of the complete robot;
- models above the browser resource limits.

## Pipeline architecture

The browser Worker pipeline is:

1. Load indexed mesh data.
2. Apply source-node transforms and URDF scale exactly once.
3. Weld vertices and remove invalid, degenerate, and duplicate faces.
4. Build edge adjacency, connected components, and consistent winding.
5. Estimate per-face normals, curvature, area, and neighborhood statistics.
6. Seed and grow candidate surface regions.
7. Fit analytic surfaces in the fixed order plane, cylinder, sphere, cone.
8. Validate every candidate using distance, normal, area, and stability gates.
9. Resolve overlapping candidates deterministically.
10. Extract outer and inner boundary loops for each accepted region.
11. Project boundary loops into the analytic surface parameter space.
12. Build trimmed OCCT analytic faces.
13. Route unrecognized triangles through a globally budgeted faceted fallback.
14. Sew analytic and fallback faces per mesh component.
15. Validate shells and convert only valid closed manifold shells to solids.
16. Write STEP and independently reopen it for browser regression evidence.

Pure analysis and fitting code must live outside the OCCT adapter. OCCT object
creation, trimming, sewing, validation, and writing must be isolated in worker-
only modules.

## Shared analysis data

The analysis result must preserve stable IDs and source traceability:

- vertex and triangle arrays;
- face normals and areas;
- edge adjacency;
- boundary and non-manifold edges;
- connected-component IDs;
- region IDs;
- source link ID, link name, visual ID, and mesh path;
- source and world transforms;
- model and component bounding boxes;
- configured distance and angular tolerances.

Every output face must map back to one or more source triangle IDs.

## Browser resource limits

CAD-compatible reconstruction is allowed only when all conditions hold:

- at most 100,000 cleaned input triangles for the robot;
- at most 30,000 triangles in one candidate region;
- at most 200 candidate regions;
- at most 5,000 faceted fallback output triangles;
- estimated Worker memory at most 512 MB;
- total processing time at most five minutes.

The Worker must check the triangle and memory budgets before expensive fitting.
The main thread must terminate the Worker on timeout or cancellation.

When a limit is exceeded, fail with a structured resource-limit error. Do not
silently produce a giant faceted STEP.

## Default tolerances

All tolerances derive from the cleaned model bounding-box diagonal (D):

- base distance tolerance: `max(D * 1e-4, 1e-6 m)`;
- maximum accepted point distance: twice the base distance tolerance;
- normal-angle tolerance: 3 degrees;
- vertex weld tolerance: clamped `D * 1e-7`;
- minimum region: at least 20 triangles and at least 0.05% of total mesh area.

The UI may expose coarse precision presets later, but the first implementation
uses these fixed defaults from one configuration module.

## Region generation

Region growing begins from deterministic seeds sorted by:

1. descending face area;
2. ascending source triangle ID.

A neighboring face may join a region only when:

- it shares a manifold edge with the region;
- its normal is compatible with the current surface hypothesis;
- its vertices are within the provisional distance threshold;
- adding it does not destabilize fitted parameters beyond configured limits.

Non-manifold edges are hard region boundaries.

Regions rejected by one surface type remain eligible for later surface types.
Final overlap resolution prefers, in order:

1. lower normalized maximum error;
2. higher inlier count;
3. simpler surface type: plane, cylinder, sphere, cone;
4. lower seed triangle ID.

## Analytic fitting gates

Every fitted region records RMS distance, maximum distance, maximum normal
error, inlier ratio, covered area, and parameter condition/stability.

A fit is accepted only when:

- at least 95% of region vertices are inliers;
- RMS distance is no greater than base tolerance;
- maximum distance is no greater than twice base tolerance;
- maximum normal error is no greater than 3 degrees;
- minimum region size and area gates pass;
- fitted parameters are finite and non-degenerate.

Additional gates:

- plane: stable normal and two non-collinear in-plane axes;
- cylinder: positive radius, stable axis, and sufficient angular coverage;
- sphere: positive radius and sufficient two-dimensional angular coverage;
- cone: stable apex and axis, finite half-angle, and sufficient axial extent.

A rejected fit must include a machine-readable reason.

## Boundary reconstruction

Accepted regions require topological boundary loops. Boundary extraction must:

- use oriented region boundary half-edges;
- separate outer loops from holes;
- reject self-intersecting or open loops;
- simplify only collinear or tolerance-equivalent boundary points;
- preserve source triangle traceability.

Boundary points are projected into the surface parameter space. Cylinder,
sphere, and cone parameter seams must be unwrapped consistently before loop
construction. A seam-crossing loop must not be split into disconnected faces.

If a region fit is valid but its boundary cannot be reconstructed, the entire
region moves to faceted fallback and emits a warning. It must not be partially
lost.

## OCCT construction

The OCCT adapter must create:

- `Geom_Plane` for planar regions;
- `Geom_CylindricalSurface` for cylindrical regions;
- `Geom_SphericalSurface` for spherical regions;
- `Geom_ConicalSurface` for conical regions;
- 2D trimming wires or equivalent projected boundary curves;
- one trimmed `TopoDS_Face` per accepted analytic region.

Every required OpenCascade.js constructor and overload must be verified against
the bundled WASM before production use. Missing bindings make that surface type
unavailable and route its regions to fallback; generated bindings must not be
patched.

Faces are sewn per source mesh component using a tolerance derived from the
weld tolerance. Shape healing is allowed only when its bundled API is verified.

A shell becomes a solid only when:

- source topology is closed and manifold;
- reconstructed topology has zero free edges;
- no non-manifold output edges exist;
- OCCT validity analysis succeeds before and after solid construction.

Automatic hole filling is forbidden.

## Faceted fallback

All rejected and unrecognized regions share one global fallback budget of 5,000
triangles. Budget allocation is proportional to region area with a minimum of
20 triangles for every non-empty region when possible.

Fallback must use cleaned, simplified, consistently wound indexed geometry and
sewing. It must not create separate STEP products for individual triangles.

If the budget cannot retain every non-empty region, export fails with a report
of omitted regions. Silent omission is forbidden.

## Experimental freeform fitting

An experimental BSpline surface capability probe may be implemented, but the
feature remains disabled by default.

It may be enabled only if bundled WASM can:

- construct or fit a BSpline surface;
- create trimming curves and a bounded face;
- sew the face with analytic neighbors;
- write and reopen the STEP result;
- meet the same error and validity gates.

Probe failure routes freeform regions to faceted fallback. It does not block
the analytic MVP.

## Diagnostics

The Worker returns per visual and per region diagnostics:

- surface type or fallback;
- source and output triangle counts;
- vertex and face cleanup counts;
- fitted parameters;
- RMS and maximum distance;
- maximum normal error;
- inlier ratio and covered area;
- boundary-loop and hole counts;
- boundary reconstruction result;
- free and non-manifold edge counts;
- shell and solid counts;
- elapsed time;
- warnings and rejected-fit reasons.

The final dialog distinguishes:

- successful analytic reconstruction;
- successful output with faceted fallback;
- partial failure;
- complete failure;
- browser resource-limit rejection.

## Progress and cancellation

Progress phases are:

1. loading;
2. cleanup;
3. analysis;
4. region growing;
5. fitting;
6. boundary reconstruction;
7. OCCT face construction;
8. sewing and validation;
9. STEP writing.

Worker progress is throttled to five updates per second. Every phase checks a
cancellation flag between regions and before expensive OCCT calls.

## Verification corpus

Required fixtures:

- one planar box-like mesh;
- one triangulated cylinder;
- one triangulated sphere;
- one truncated cone;
- a mixed mechanical part containing plane and cylinder regions;
- an open mesh;
- a non-manifold mesh;
- a mesh containing one analytic region plus an unrecognized freeform region;
- the user-reported robot.

Each analytic fixture must include known ground-truth parameters.

## Acceptance criteria

- Plane, cylinder, sphere, and cone fixtures reconstruct to their corresponding
  analytic STEP surfaces.
- Accepted analytic regions satisfy all distance and normal gates.
- Mixed mechanical fixtures reduce STEP face count by at least 90%.
- The user-reported robot STEP is at least 80% smaller than the current
  per-triangle baseline.
- CAD open time is at least 70% lower than the baseline.
- Closed manifold fixtures reconstruct with zero free edges and valid shells or
  solids.
- Open and non-manifold fixtures remain shells or fail explicitly; they never
  become solids.
- Raw faceted mode never exceeds 5,000 triangles.
- No region is silently omitted.
- Analytic primitives already present in URDF remain unchanged.
- Focused unit tests, quality typecheck, production build, browser export, and
  independent FreeCAD reopen checks pass.
- Repeated exports do not retain Workers, OCCT wrappers, mesh arrays, or Blob
  URLs.

## Delivery phases

1. Analysis infrastructure and ground-truth fixtures.
2. Plane fitting, planar boundaries, and planar trimmed faces.
3. Cylinder fitting and seam-safe trimming.
4. Sphere and cone fitting.
5. Multi-surface overlap resolution and component sewing.
6. Faceted fallback and resource limits.
7. UI, diagnostics, cancellation, and progress.
8. Browser, size, validity, and FreeCAD regression gates.
9. Experimental BSpline capability probe, disabled by default.

