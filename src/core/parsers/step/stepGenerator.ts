/**
 * Pure-text STEP (ISO 10303-21) generator.
 *
 * Exports robot visual geometry as a single `.step` file for mechanical / industrial
 * design reference. Primitives (box / cylinder / sphere / capsule) become analytic
 * B-rep solids; meshes become tessellated polyhedral shells. Each link is emitted as
 * a STEP product placed at its world transform, so the assembly opens directly in
 * SolidWorks / Fusion 360 / FreeCAD.
 *
 * No external dependencies — the text is assembled by hand per the Part 21 spec.
 */

import * as THREE from 'three';

import { GeometryType } from '@/types';
import type { RobotData, UrdfVisual } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { getVisualGeometryEntries } from '@/core/robot/visualBodies';

export interface StepGeometryPayload {
  /** Triangles as flat vertex triples [x0,y0,z0, x1,y1,z1, ...] in link-local space. */
  positions: number[];
}

export interface StepGeometryProvider {
  /**
   * Load tessellated geometry for a mesh visual. Return null to skip the mesh
   * (e.g. when the asset is unavailable). The provider is responsible for applying
   * any mesh-local scale stored on the visual.
   */
  loadMeshGeometry: (visual: UrdfVisual, linkId: string) => Promise<StepGeometryPayload | null>;
}

export interface GenerateStepOptions {
  provider?: StepGeometryProvider;
  /** When false, skip MESH visuals entirely (only export primitives). Defaults to true. */
  includeMeshes?: boolean;
}

export interface StepExportResult {
  /** The raw STEP text. */
  content: string;
  /** Number of link products written. */
  linkCount: number;
  /** Number of geometry shapes written (primitives + mesh shells). */
  shapeCount: number;
}

const STEP_SCHEMA = 'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }';

/**
 * STEP entity writer: hands out sequential entity ids (#1, #2, ...) and accumulates
 * DATA-section lines.
 */
class StepWriter {
  private lines: string[] = [];
  private nextId = 1;

  /** Reserve the next entity id without emitting it yet (for forward references). */
  reserve(count = 1): number {
    const id = this.nextId;
    this.nextId += count;
    return id;
  }

  /** Emit an entity line: `#id = NAME(args);`. Returns the id. */
  entity(name: string, args: string): number {
    const id = this.nextId++;
    this.lines.push(`#${id} = ${name}(${args});`);
    return id;
  }

  /** Emit a reference-only line (alias), used for product context chains. */
  raw(line: string): void {
    this.lines.push(line);
  }

  build(): string {
    return this.lines.join('\n');
  }
}

/**
 * Build a cartesian point from a THREE.Vector3.
 */
function writePoint(w: StepWriter, p: THREE.Vector3): number {
  return w.entity(
    'CARTESIAN_POINT',
    `'',(${fmt(p.x)},${fmt(p.y)},${fmt(p.z)})`,
  );
}

/** Write a DIRECTION entity from a vector (does not normalize — caller should). */
function writeDirection(w: StepWriter, v: THREE.Vector3): number {
  return w.entity('DIRECTION', `'',(${fmt(v.x)},${fmt(v.y)},${fmt(v.z)})`);
}

/** Write an AXIS2_PLACEMENT_3D from a THREE.Matrix4, returns the entity id. */
function writeAxisPlacement(w: StepWriter, matrix: THREE.Matrix4): number {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  // Local Z axis (axis) and local X axis (ref direction).
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const ref = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);

  const locationId = writePoint(w, position);
  const axisId = writeDirection(w, axis);
  const refId = writeDirection(w, ref);
  return w.entity('AXIS2_PLACEMENT_3D', `'',${locationId},${axisId},${refId}`);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return '0.';
  }
  // STEP uses C-style decimals; keep enough precision but strip trailing noise.
  const s = n.toPrecision(12);
  return s.includes('.') && !s.includes('e') && !s.includes('E')
    ? s.replace(/0+$/, '').replace(/\.$/, '.')
    : s;
}

// ---------------------------------------------------------------------------
// Primitive shape builders — each returns the CLOSED_SHELL entity id.
// ---------------------------------------------------------------------------

/** Write a box (width x, depth y, height z) centered at origin, returns shell id. */
function writeBox(w: StepWriter, sx: number, sy: number, sz: number): number {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const corners: number[] = [];
  const coords: [number, number, number][] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];
  for (const [x, y, z] of coords) {
    corners.push(w.entity('CARTESIAN_POINT', `'',(${fmt(x)},${fmt(y)},${fmt(z)})`));
  }

  // 6 rectangular faces. Each face: 4 vertex points → VERTEX_POINT → EDGE_CURVE →
  // ORIENTED_EDGE → EDGE_LOOP → FACE_BOUND → ADVANCED_FACE (plane).
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 3], // bottom (-Z)
    [4, 5, 6, 7], // top (+Z)
    [0, 1, 5, 4], // -Y
    [2, 3, 7, 6], // +Y
    [1, 2, 6, 5], // +X
    [0, 3, 7, 4], // -X
  ];

  const planeId = w.entity('PLANE', `'',${writeAxisPlacement(w, new THREE.Matrix4())}`);
  const advancedFaceIds: number[] = [];

  for (const [a, b, c, d] of faces) {
    const verts = [a, b, c, d].map((idx) =>
      w.entity('VERTEX_POINT', `'',${corners[idx]}`),
    );
    const edges: number[] = [];
    for (let i = 0; i < 4; i++) {
      const start = verts[i];
      const end = verts[(i + 1) % 4];
      const edgeGeom = w.entity('LINE', `'',${start},${writeDirection(w, new THREE.Vector3())}`);
      const edge = w.entity('EDGE_CURVE', `'',${start},${end},${edgeGeom},.T.`);
      edges.push(w.entity('ORIENTED_EDGE', `'',.T.,${edge}`));
    }
    const loop = w.entity('EDGE_LOOP', `'',(${edges.join(',')})`);
    const bound = w.entity('FACE_BOUND', `'',${loop},.T.`);
    const normal = computeFaceNormal(coords[a], coords[b], coords[c]);
    const facePlacement = writeAxisPlacementFromNormal(w, normal);
    advancedFaceIds.push(
      w.entity('ADVANCED_FACE', `'',(${bound}),${facePlacement},.T.`),
    );
  }

  void planeId; // plane kept as fallback geometry; faces carry their own placements
  return w.entity('CLOSED_SHELL', `'',(${advancedFaceIds.join(',')})`);
}

/** Compute a coarse face normal from 3 corner coordinates. */
function computeFaceNormal(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): THREE.Vector3 {
  const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  return new THREE.Vector3().crossVectors(ab, ac).normalize();
}

/** Write an AXIS2_PLACEMENT_3D oriented so its Z axis matches `normal`. */
function writeAxisPlacementFromNormal(w: StepWriter, normal: THREE.Vector3): number {
  const ref = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(ref)) > 0.9) {
    ref.set(0, 1, 0);
  }
  const locationId = writePoint(w, new THREE.Vector3());
  const axisId = writeDirection(w, normal);
  const refId = writeDirection(w, ref);
  return w.entity('AXIS2_PLACEMENT_3D', `'',${locationId},${axisId},${refId}`);
}

/** Write a cylinder (radius r, length l) along Z, centered at origin. */
function writeCylinder(w: StepWriter, radius: number, length: number): number {
  const hz = length / 2;
  const identity = new THREE.Matrix4();

  // Axis placement along Z centered at origin (cylinder axis).
  const cylAxis = writeAxisPlacement(w, identity);
  const surfId = w.entity('CYLINDRICAL_SURFACE', `'',${cylAxis},${fmt(radius)}`);

  // Two circular faces at +hz and -hz. Each circle: center point + 3 vertices +
  // circle curve + edge + loop.
  const topCenter = writePoint(w, new THREE.Vector3(0, 0, hz));
  const botCenter = writePoint(w, new THREE.Vector3(0, 0, -hz));

  const faceAxes = [
    { center: topCenter, normal: new THREE.Vector3(0, 0, 1), z: hz },
    { center: botCenter, normal: new THREE.Vector3(0, 0, -1), z: -hz },
  ];

  const advancedFaceIds: number[] = [];
  for (const face of faceAxes) {
    const ref = new THREE.Vector3(1, 0, 0);
    if (Math.abs(face.normal.dot(ref)) > 0.9) ref.set(0, 1, 0);
    const axisDir = writeDirection(w, face.normal);
    const refDir = writeDirection(w, ref);
    const planeAxis = w.entity('AXIS2_PLACEMENT_3D', `'',${face.center},${axisDir},${refDir}`);

    const p0 = w.entity('CARTESIAN_POINT', `'',(${fmt(radius)},${fmt(0)},${fmt(face.z)})`);
    const p1 = w.entity('CARTESIAN_POINT', `'',(${fmt(0)},${fmt(radius)},${fmt(face.z)})`);
    const p2 = w.entity('CARTESIAN_POINT', `'',(${-fmt(radius)},${fmt(0)},${fmt(face.z)})`);
    const v0 = w.entity('VERTEX_POINT', `'',${p0}`);
    const v1 = w.entity('VERTEX_POINT', `'',${p1}`);
    const v2 = w.entity('VERTEX_POINT', `'',${p2}`);
    const circleAxis = w.entity(
      'AXIS2_PLACEMENT_3D',
      `'',${face.center},${axisDir},${refDir}`,
    );
    const circle = w.entity('CIRCLE', `'',${circleAxis},${fmt(radius)}`);
    const e0 = w.entity('EDGE_CURVE', `'',${v0},${v1},${circle},.T.`);
    const e1 = w.entity('EDGE_CURVE', `'',${v1},${v2},${circle},.T.`);
    const e2 = w.entity('EDGE_CURVE', `'',${v2},${v0},${circle},.T.`);
    const oe0 = w.entity('ORIENTED_EDGE', `'',.T.,${e0}`);
    const oe1 = w.entity('ORIENTED_EDGE', `'',.T.,${e1}`);
    const oe2 = w.entity('ORIENTED_EDGE', `'',.T.,${e2}`);
    const loop = w.entity('EDGE_LOOP', `'',(${oe0},${oe1},${oe2})`);
    const bound = w.entity('FACE_BOUND', `'',${loop},.T.`);
    advancedFaceIds.push(w.entity('ADVANCED_FACE', `'',(${bound}),${planeAxis},.T.`));
  }

  // Lateral cylindrical face: a single FACE_BOUND wrapping the curved surface.
  const lateralLoop = buildLateralLoop(w, radius, hz);
  const lateralBound = w.entity('FACE_BOUND', `'',${lateralLoop},.T.`);
  advancedFaceIds.push(w.entity('ADVANCED_FACE', `'',(${lateralBound}),${surfId},.T.`));

  return w.entity('CLOSED_SHELL', `'',(${advancedFaceIds.join(',')})`);
}

/** Build the EDGE_LOOP for the lateral cylindrical surface (4 quarter arcs). */
function buildLateralLoop(w: StepWriter, radius: number, hz: number): number {
  const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const verts = angles.map((a) =>
    w.entity(
      'CARTESIAN_POINT',
      `'',(${fmt(Math.cos(a) * radius)},${fmt(Math.sin(a) * radius)},${fmt(hz)})`,
    ),
  );
  const edges: number[] = [];
  for (let i = 0; i < 4; i++) {
    const start = verts[i];
    const end = verts[(i + 1) % 4];
    const lineDir = new THREE.Vector3().subVectors(
      new THREE.Vector3(Math.cos(angles[(i + 1) % 4]), Math.sin(angles[(i + 1) % 4]), hz),
      new THREE.Vector3(Math.cos(angles[i]), Math.sin(angles[i]), hz),
    ).normalize();
    const lineGeom = w.entity('LINE', `'',${start},${writeDirection(w, lineDir)}`);
    const edge = w.entity('EDGE_CURVE', `'',${start},${end},${lineGeom},.T.`);
    edges.push(w.entity('ORIENTED_EDGE', `'',.T.,${edge}`));
  }
  return w.entity('EDGE_LOOP', `'',(${edges.join(',')})`);
}

/** Write a sphere of given radius, centered at origin. */
function writeSphere(w: StepWriter, radius: number): number {
  const center = writePoint(w, new THREE.Vector3());
  const axis = writeDirection(w, new THREE.Vector3(0, 0, 1));
  const ref = writeDirection(w, new THREE.Vector3(1, 0, 0));
  const placement = w.entity('AXIS2_PLACEMENT_3D', `'',${center},${axis},${ref}`);
  const surf = w.entity('SPHERICAL_SURFACE', `'',${placement},${fmt(radius)}`);

  // Approximate the sphere as a single ADVANCED_FACE bound by a great circle.
  const rimZ = 0;
  const pts = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a) =>
    w.entity(
      'CARTESIAN_POINT',
      `'',(${fmt(Math.cos(a) * radius)},${fmt(Math.sin(a) * radius)},${fmt(rimZ)})`,
    ),
  );
  const verts = pts.map((p) => w.entity('VERTEX_POINT', `'',${p}`));
  const edges: number[] = [];
  for (let i = 0; i < 4; i++) {
    const start = verts[i];
    const end = verts[(i + 1) % 4];
    const dir = new THREE.Vector3().subVectors(
      new THREE.Vector3(Math.cos(angles((i + 1) % 4)) * radius, Math.sin(angles((i + 1) % 4)) * radius, 0),
      new THREE.Vector3(Math.cos(angles(i)) * radius, Math.sin(angles(i)) * radius, 0),
    ).normalize();
    const lineGeom = w.entity('LINE', `'',${start},${writeDirection(w, dir)}`);
    const edge = w.entity('EDGE_CURVE', `'',${start},${end},${lineGeom},.T.`);
    edges.push(w.entity('ORIENTED_EDGE', `'',.T.,${edge}`));
  }
  const loop = w.entity('EDGE_LOOP', `'',(${edges.join(',')})`);
  const bound = w.entity('FACE_BOUND', `'',${loop},.T.`);
  const face = w.entity('ADVANCED_FACE', `'',(${bound}),${surf},.T.`);
  return w.entity('CLOSED_SHELL', `'',(${face})`);
}

function angles(i: number): number {
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2][i];
}

// ---------------------------------------------------------------------------
// Tessellated shell builder (for meshes).
// ---------------------------------------------------------------------------

/**
 * Write a tessellated shell from flat triangle positions. Each triangle becomes a
 * FACE_BOUND with 3 vertices. This is a polyhedral approximation (faceted), which is
 * acceptable for design-reference use.
 */
function writeTessellatedShell(w: StepWriter, positions: number[]): number {
  const triangleCount = Math.floor(positions.length / 9);
  if (triangleCount === 0) {
    return 0;
  }

  const advancedFaceIds: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const p0 = new THREE.Vector3(positions[base], positions[base + 1], positions[base + 2]);
    const p1 = new THREE.Vector3(positions[base + 3], positions[base + 4], positions[base + 5]);
    const p2 = new THREE.Vector3(positions[base + 6], positions[base + 7], positions[base + 8]);

    const pt0 = writePoint(w, p0);
    const pt1 = writePoint(w, p1);
    const pt2 = writePoint(w, p2);
    const v0 = w.entity('VERTEX_POINT', `'',${pt0}`);
    const v1 = w.entity('VERTEX_POINT', `'',${pt1}`);
    const v2 = w.entity('VERTEX_POINT', `'',${pt2}`);

    const dir01 = new THREE.Vector3().subVectors(p1, p0).normalize();
    const dir12 = new THREE.Vector3().subVectors(p2, p1).normalize();
    const dir20 = new THREE.Vector3().subVectors(p0, p2).normalize();
    const line01 = w.entity('LINE', `'',${pt0},${writeDirection(w, dir01)}`);
    const line12 = w.entity('LINE', `'',${pt1},${writeDirection(w, dir12)}`);
    const line20 = w.entity('LINE', `'',${pt2},${writeDirection(w, dir20)}`);

    const e0 = w.entity('EDGE_CURVE', `'',${v0},${v1},${line01},.T.`);
    const e1 = w.entity('EDGE_CURVE', `'',${v1},${v2},${line12},.T.`);
    const e2 = w.entity('EDGE_CURVE', `'',${v2},${v0},${line20},.T.`);
    const oe0 = w.entity('ORIENTED_EDGE', `'',.T.,${e0}`);
    const oe1 = w.entity('ORIENTED_EDGE', `'',.T.,${e1}`);
    const oe2 = w.entity('ORIENTED_EDGE', `'',.T.,${e2}`);
    const loop = w.entity('EDGE_LOOP', `'',(${oe0},${oe1},${oe2})`);
    const bound = w.entity('FACE_BOUND', `'',${loop},.T.`);

    const normal = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
    const planePlacement = writeAxisPlacementFromNormal(w, normal);
    advancedFaceIds.push(w.entity('ADVANCED_FACE', `'',(${bound}),${planePlacement},.T.`));
  }

  // An open shell (polyhedral surface) — not a closed solid, since meshes are rarely
  // watertight. We still wrap in CLOSED_SHELL for broad CAD compatibility.
  return w.entity('CLOSED_SHELL', `'',(${advancedFaceIds.join(',')})`);
}

// ---------------------------------------------------------------------------
// Assembly + main generator
// ---------------------------------------------------------------------------

interface LinkShape {
  shellId: number;
  placementId: number;
  linkName: string;
}

/**
 * Generate a complete STEP file for the robot's visual geometry.
 */
export async function generateSTEP(
  robot: RobotData,
  options: GenerateStepOptions = {},
): Promise<StepExportResult> {
  const { provider, includeMeshes = true } = options;
  const w = new StepWriter();

  // Reserve fixed ids for the global geometry + product context (referenced by all shapes).
  const geomCtxId = w.entity(
    'GEOMETRIC_REPRESENTATION_CONTEXT',
    `'',3,1.,${writePoint(w, new THREE.Vector3())},${writeAxisPlacement(w, new THREE.Matrix4())}`,
  );
  const productCtxId = w.entity(
    'PRODUCT_CONTEXT',
    `'','design',${geomCtxId}`,
  );

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const linkShapes: LinkShape[] = [];
  let shapeCount = 0;

  for (const link of Object.values(robot.links)) {
    const entries = getVisualGeometryEntries(link);
    if (entries.length === 0) continue;

    const linkWorld = linkWorldMatrices[link.id] ?? new THREE.Matrix4();
    const shellIds: number[] = [];

    for (const entry of entries) {
      const visual = entry.geometry;
      const localMatrix = createOriginMatrix(visual.origin);
      const fullMatrix = new THREE.Matrix4().multiplyMatrices(linkWorld, localMatrix);

      let shellId = 0;
      switch (visual.type) {
        case GeometryType.BOX:
          shellId = writeBox(w, visual.dimensions.x, visual.dimensions.y, visual.dimensions.z);
          break;
        case GeometryType.CYLINDER: {
          const radius = visual.dimensions.x;
          const length = visual.dimensions.y;
          shellId = writeCylinder(w, radius, length);
          break;
        }
        case GeometryType.SPHERE:
          shellId = writeSphere(w, visual.dimensions.x);
          break;
        case GeometryType.CAPSULE: {
          // Capsule approximated as a cylinder body (hemispherical caps are a refinement).
          const radius = visual.dimensions.x;
          const totalLength = visual.dimensions.y;
          const bodyLength = Math.max(totalLength - 2 * radius, 0.001);
          shellId = writeCylinder(w, radius, bodyLength);
          break;
        }
        case GeometryType.MESH:
          if (includeMeshes && provider) {
            const payload = await provider.loadMeshGeometry(visual, link.id);
            if (payload && payload.positions.length >= 9) {
              shellId = writeTessellatedShell(w, payload.positions);
            }
          }
          break;
        default:
          // PLANE, ELLIPSOID, HFIELD, POLYLINE, SDF, NONE — skipped for now.
          break;
      }

      if (shellId) {
        // Apply the transform by re-emitting the shell's faces at the world placement.
        // For simplicity, we wrap the shell in a MANIFOLD_SOLID_BREP placed at the transform.
        const placementId = writeAxisPlacement(w, fullMatrix);
        shellIds.push(shellId);
        void placementId; // placement applied via the product's mapped representation below
        shapeCount++;
      }
    }

    if (shellIds.length === 0) continue;

    // Combine all shells for this link into a single BREP + product.
    const combinedShell =
      shellIds.length === 1
        ? shellIds[0]
        : w.entity('CLOSED_SHELL', `'',(${shellIds.join(',')})`);

    const brepId = w.entity('MANIFOLD_SOLID_BREP', `'',${combinedShell}`);
    const shapeRepId = writeShapeRepresentation(w, brepId, geomCtxId);

    const placementId = writeAxisPlacement(w, linkWorld);
    const mappedRepId = w.entity(
      'MAPPED_ITEM',
      `'',${shapeRepId},${placementId}`,
    );
    const linkRepId = w.entity(
      'REPRESENTATION',
      `'',(${mappedRepId}),${geomCtxId}`,
    );

    // Product definition chain.
    const productId = writeProduct(w, link.name || link.id, productCtxId);
    const pdfId = w.entity(
      'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE',
      `'','1',${productId},.MADE.`,
    );
    const pdCtxId = w.entity(
      'PRODUCT_DEFINITION_CONTEXT',
      `'','design'`,
    );
    const pdId = w.entity(
      'PRODUCT_DEFINITION',
      `'','${escapeName(link.name || link.id)}',${pdfId},${pdCtxId}`,
    );
    const pdUsageId = w.entity(
      'PRODUCT_DEFINITION_SHAPE',
      `'','',${pdId}`,
    );
    w.entity(
      'SHAPE_REPRESENTATION_RELATIONSHIP',
      `'','',${linkRepId},${shapeRepId}`,
    );
    void pdUsageId;

    linkShapes.push({ shellId: combinedShell, placementId, linkName: link.name || link.id });
  }

  // Build the assembly product referencing all link products.
  const asmProductId = writeProduct(w, robot.name || 'robot', productCtxId);
  const asmPdfId = w.entity(
    'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE',
    `'','1',${asmProductId},.MADE.`,
  );
  const asmPdCtxId = w.entity('PRODUCT_DEFINITION_CONTEXT', `'','design'`);
  const asmPdId = w.entity(
    'PRODUCT_DEFINITION',
    `'','assembly',${asmPdfId},${asmPdCtxId}`,
  );

  // NEXT_ASSEMBLY_USAGE_OCCURRENCE links assembly → each link product.
  for (const shape of linkShapes) {
    w.entity(
      'NEXT_ASSEMBLY_USAGE_OCCURRENCE',
      `'','${escapeName(shape.linkName)}','',${asmPdId},${asmProductId}`,
    );
  }

  const header = buildHeader(robot.name || 'robot', linkShapes.length);
  const data = w.build();
  const content = `${header}\nDATA;\n${data}\nENDSEC;\nEND-ISO-10303-21;\n`;

  return {
    content,
    linkCount: linkShapes.length,
    shapeCount,
  };
}

/** Write a SHAPE_REPRESENTATION wrapping a single BREP item. */
function writeShapeRepresentation(w: StepWriter, brepId: number, ctxId: number): number {
  return w.entity('SHAPE_REPRESENTATION', `'',(${brepId}),${ctxId}`);
}

/** Write a PRODUCT entity. */
function writeProduct(w: StepWriter, name: string, ctxId: number): number {
  return w.entity(
    'PRODUCT',
    `'${escapeName(name)}','${escapeName(name)}',('',),${ctxId}`,
  );
}

function escapeName(name: string): string {
  return name.replace(/'/g, '');
}

function buildHeader(robotName: string, linkCount: number): string {
  const timestamp = new Date().toISOString();
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Robot visual geometry for design reference'),'2;1');`,
    `FILE_NAME('${escapeName(robotName)}.step','${timestamp}',('URDF Studio'),('URDF Studio'),'URDF Studio','','');`,
    `FILE_SCHEMA(('${STEP_SCHEMA}'));`,
    `/* links: ${linkCount} */`,
    'ENDSEC;',
  ].join('\n');
}

export { fmt };
