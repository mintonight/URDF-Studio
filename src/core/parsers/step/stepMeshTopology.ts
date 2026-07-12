/**
 * Deterministic indexed topology cleanup for STEP mesh export.
 *
 * Takes raw flat vertex data (or pre-indexed data), welds duplicate vertices,
 * removes degenerate / non-finite / duplicate triangles, builds adjacency,
 * finds connected components, and reports boundary / non-manifold edges.
 *
 * All output is deterministic: the same input always produces the same vertex
 * order, index order, and stats.
 */

import {
  STEP_MESH_WELD_TOLERANCE_MAX,
  STEP_MESH_WELD_TOLERANCE_MIN,
  STEP_MESH_WELD_TOLERANCE_RATIO,
} from './stepMeshConfig';
import type { PreparedStepMesh } from './stepMeshTypes';

interface PrepareInput {
  vertices: number[];
  /** Optional pre-existing index array. If absent, vertices are treated as non-indexed triangles. */
  indices?: number[];
}

/**
 * Compute bounding-box diagonal of a flat vertex array.
 * Returns 0 if fewer than 2 finite vertices.
 */
function computeDiagonal(vertices: number[]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let hasFinite = false;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    hasFinite = true;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!hasFinite) return 0;
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Prepare raw mesh data into a cleaned, indexed, welded mesh with topology info.
 */
export function prepareStepMeshTopology(input: PrepareInput): PreparedStepMesh {
  const { vertices: rawVertices, indices: rawIndices } = input;

  // If indices provided, treat as indexed; otherwise each consecutive 9 floats = 1 triangle.
  const triangleCount = rawIndices
    ? Math.floor(rawIndices.length / 3)
    : Math.floor(rawVertices.length / 9);

  // Compute weld tolerance from bounding box.
  const diagonal = computeDiagonal(rawVertices);
  const rawTolerance = diagonal * STEP_MESH_WELD_TOLERANCE_RATIO;
  const tolerance = Math.min(
    STEP_MESH_WELD_TOLERANCE_MAX,
    Math.max(STEP_MESH_WELD_TOLERANCE_MIN, rawTolerance),
  );

  // --- Weld vertices ---
  const weldMap = new Map<string, number>();
  const weldedVertices: number[] = [];

  const weldVertex = (x: number, y: number, z: number): number => {
    const kx = Math.round(x / tolerance);
    const ky = Math.round(y / tolerance);
    const kz = Math.round(z / tolerance);
    const key = `${kx},${ky},${kz}`;
    const existing = weldMap.get(key);
    if (existing !== undefined) return existing;
    const newIndex = weldedVertices.length / 3;
    weldedVertices.push(x, y, z);
    weldMap.set(key, newIndex);
    return newIndex;
  };

  // --- Process triangles ---
  let removedNonFinite = 0;
  let removedDegenerate = 0;
  let removedDuplicate = 0;
  const seenFaceKeys = new Set<string>();
  const validTriangles: Array<[number, number, number]> = [];

  for (let t = 0; t < triangleCount; t++) {
    let a: number, b: number, c: number;
    let ax: number, ay: number, az: number;
    let bx: number, by: number, bz: number;
    let cx: number, cy: number, cz: number;

    if (rawIndices) {
      a = rawIndices[t * 3];
      b = rawIndices[t * 3 + 1];
      c = rawIndices[t * 3 + 2];
      ax = rawVertices[a * 3]; ay = rawVertices[a * 3 + 1]; az = rawVertices[a * 3 + 2];
      bx = rawVertices[b * 3]; by = rawVertices[b * 3 + 1]; bz = rawVertices[b * 3 + 2];
      cx = rawVertices[c * 3]; cy = rawVertices[c * 3 + 1]; cz = rawVertices[c * 3 + 2];
    } else {
      const base = t * 9;
      ax = rawVertices[base]; ay = rawVertices[base + 1]; az = rawVertices[base + 2];
      bx = rawVertices[base + 3]; by = rawVertices[base + 4]; bz = rawVertices[base + 5];
      cx = rawVertices[base + 6]; cy = rawVertices[base + 7]; cz = rawVertices[base + 8];
    }

    // Reject non-finite.
    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      removedNonFinite++;
      continue;
    }

    // Weld.
    const wa = weldVertex(ax, ay, az);
    const wb = weldVertex(bx, by, bz);
    const wc = weldVertex(cx, cy, cz);

    // Reject degenerate (repeated indices after weld).
    if (wa === wb || wb === wc || wa === wc) {
      removedDegenerate++;
      continue;
    }

    // Reject degenerate by area (collinear after weld).
    const fx = weldedVertices[wa * 3], fy = weldedVertices[wa * 3 + 1], fz = weldedVertices[wa * 3 + 2];
    const ex = weldedVertices[wb * 3] - fx, ey = weldedVertices[wb * 3 + 1] - fy, ez = weldedVertices[wb * 3 + 2] - fz;
    const gx = weldedVertices[wc * 3] - fx, gy = weldedVertices[wc * 3 + 1] - fy, gz = weldedVertices[wc * 3 + 2] - fz;
    const crossX = ey * gz - ez * gy;
    const crossY = ez * gx - ex * gz;
    const crossZ = ex * gy - ey * gx;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ < tolerance * tolerance * tolerance * tolerance) {
      removedDegenerate++;
      continue;
    }

    // Reject duplicates (sorted index triple).
    const sorted = [wa, wb, wc].sort((p, q) => p - q);
    const faceKey = sorted.join(',');
    if (seenFaceKeys.has(faceKey)) {
      removedDuplicate++;
      continue;
    }
    seenFaceKeys.add(faceKey);

    validTriangles.push([wa, wb, wc]);
  }

  // --- Build adjacency ---
  const edgeMap = new Map<string, number[]>();
  for (const [a, b, c] of validTriangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const list = edgeMap.get(key);
      if (list) list.push(p); // store directed p→q start to check winding
      else edgeMap.set(key, [p]);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const [, starts] of edgeMap) {
    if (starts.length === 1) boundaryEdges++;
    else if (starts.length > 2) nonManifoldEdges++;
  }

  // --- Find connected components via union-find on vertices ---
  const parent = new Int32Array(weldedVertices.length / 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x: number, y: number) => {
    const px = find(x), py = find(y);
    if (px !== py) parent[px] = py;
  };

  for (const [a, b, c] of validTriangles) {
    union(a, b);
    union(b, c);
  }

  const componentMap = new Map<number, number[]>();
  for (let i = 0; i < parent.length; i++) {
    const root = find(i);
    const list = componentMap.get(root);
    if (list) list.push(i);
    else componentMap.set(root, [i]);
  }
  const components = Array.from(componentMap.values());

  // --- Find boundary vertices ---
  const boundaryEdgeSet = new Set<string>();
  for (const [key, starts] of edgeMap) {
    if (starts.length === 1) boundaryEdgeSet.add(key);
  }
  const boundaryVerticesSet = new Set<number>();
  for (const key of boundaryEdgeSet) {
    const [p, q] = key.split(':').map(Number);
    boundaryVerticesSet.add(p);
    boundaryVerticesSet.add(q);
  }

  // --- Build output indices ---
  const outIndices: number[] = [];
  for (const [a, b, c] of validTriangles) {
    outIndices.push(a, b, c);
  }

  return {
    mesh: { vertices: weldedVertices, indices: outIndices },
    components,
    boundaryVertices: Array.from(boundaryVerticesSet),
    weldTolerance: tolerance,
    stats: {
      inputTriangles: triangleCount,
      weldedVertices: weldedVertices.length / 3,
      removedNonFiniteTriangles: removedNonFinite,
      removedDegenerateTriangles: removedDegenerate,
      removedDuplicateTriangles: removedDuplicate,
      connectedComponents: components.length,
      boundaryEdges,
      nonManifoldEdges,
    },
  };
}
