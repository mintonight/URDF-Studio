import * as THREE from 'three';

/**
 * Snap point feature kinds for Fusion 360 style joint-origin picking.
 *
 * - `surface`: raw raycast hit point on the mesh surface.
 * - `faceCenter`: centroid of the hit triangle.
 * - `bboxCenter`: bounding box center of the whole geometry object.
 * - `circleCenter`: fitted center of a coplanar circular face region.
 * - `vertex`: nearest mesh vertex.
 * - `edgeMidpoint`: midpoint of the nearest triangle edge.
 *
 * All functions here are pure and operate in the geometry's LOCAL space; the
 * caller is responsible for transforming results to world space with the
 * object's `matrixWorld`.
 */
export type SnapPointKind =
  | 'surface'
  | 'faceCenter'
  | 'bboxCenter'
  | 'circleCenter'
  | 'vertex'
  | 'edgeMidpoint';

export interface LocalSnapPoint {
  kind: SnapPointKind;
  pointLocal: THREE.Vector3;
  /** Geometric (not interpolated) face normal in local space, when available. */
  normalLocal?: THREE.Vector3;
}

const DEGENERATE_EPSILON_SQ = 1e-16;

function getFaceVertexIndices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [number, number, number] | null {
  if (!Number.isInteger(faceIndex) || faceIndex < 0) {
    return null;
  }

  const index = geometry.getIndex();
  const base = faceIndex * 3;

  if (index) {
    if (base + 2 >= index.count) {
      return null;
    }
    return [index.getX(base), index.getX(base + 1), index.getX(base + 2)];
  }

  const position = geometry.getAttribute('position');
  if (!position || base + 2 >= position.count) {
    return null;
  }
  return [base, base + 1, base + 2];
}

function getVertex(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) {
  return new THREE.Vector3().fromBufferAttribute(position, i);
}

/** Returns the three local-space vertices of the triangle at `faceIndex`. */
export function getFaceVertices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const indices = getFaceVertexIndices(geometry, faceIndex);
  const position = geometry.getAttribute('position');
  if (!indices || !position) {
    return null;
  }

  // Guard against malformed index buffers so a stray index never reads
  // `undefined` from the attribute and propagates NaN into the alignment math.
  if (indices.some((vertexIndex) => vertexIndex < 0 || vertexIndex >= position.count)) {
    return null;
  }

  return [getVertex(position, indices[0]), getVertex(position, indices[1]), getVertex(position, indices[2])];
}

/** Centroid of the triangle at `faceIndex` (local space). */
export function getFaceCenter(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  return vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
}

/**
 * Geometric face normal at `faceIndex` (local space). Uses the cross product of
 * the triangle edges rather than interpolated vertex normals so the resulting
 * frame stays flat and stable for face-to-face mating.
 */
export function getFaceNormal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  const edge1 = vertices[1].clone().sub(vertices[0]);
  const edge2 = vertices[2].clone().sub(vertices[0]);
  const normal = new THREE.Vector3().crossVectors(edge1, edge2);
  if (normal.lengthSq() < DEGENERATE_EPSILON_SQ) {
    return null;
  }

  return normal.normalize();
}

/** Of the three triangle vertices, the one closest to `localPoint`. */
export function getNearestVertexOnFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  let nearest = vertices[0];
  let nearestDistance = nearest.distanceToSquared(localPoint);
  for (let i = 1; i < vertices.length; i += 1) {
    const distance = vertices[i].distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = vertices[i];
      nearestDistance = distance;
    }
  }

  return nearest.clone();
}

/** Of the three triangle edge midpoints, the one closest to `localPoint`. */
export function getNearestEdgeMidpointOnFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  const midpoints = [
    vertices[0].clone().add(vertices[1]).multiplyScalar(0.5),
    vertices[1].clone().add(vertices[2]).multiplyScalar(0.5),
    vertices[2].clone().add(vertices[0]).multiplyScalar(0.5),
  ];

  let nearest = midpoints[0];
  let nearestDistance = nearest.distanceToSquared(localPoint);
  for (let i = 1; i < midpoints.length; i += 1) {
    const distance = midpoints[i].distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = midpoints[i];
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Nearest vertex in the whole geometry within `radius` of `localPoint`.
 *
 * No spatial index (three-mesh-bvh is intentionally not a dependency), so high
 * vertex counts are bounded by `maxSamples` stepped sampling. Prefer
 * {@link getNearestVertexOnFace} for the common case; this is the opt-in global
 * vertex snap.
 */
export function getNearestVertexInRadius(
  geometry: THREE.BufferGeometry,
  localPoint: THREE.Vector3,
  radius: number,
  maxSamples = 20000,
): THREE.Vector3 | null {
  const position = geometry.getAttribute('position');
  if (!position || !(radius > 0)) {
    return null;
  }

  const radiusSq = radius * radius;
  const step = Math.max(1, Math.ceil(position.count / Math.max(1, maxSamples)));
  const candidate = new THREE.Vector3();
  let nearest: THREE.Vector3 | null = null;
  let nearestDistance = radiusSq;

  for (let i = 0; i < position.count; i += step) {
    candidate.fromBufferAttribute(position, i);
    const distance = candidate.distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = candidate.clone();
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Collect the candidate snap points for the hit triangle, filtered by `filter`
 * (null = all face-level kinds). `surface` and `bboxCenter` are produced by the
 * caller (raw hit / object bounds), not here.
 */
export function collectSnapCandidatesFromFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localHit: THREE.Vector3,
  filter: SnapPointKind[] | null,
): LocalSnapPoint[] {
  const includes = (kind: SnapPointKind) => !filter || filter.includes(kind);
  const normalLocal = getFaceNormal(geometry, faceIndex) ?? undefined;
  const candidates: LocalSnapPoint[] = [];

  if (includes('surface')) {
    candidates.push({ kind: 'surface', pointLocal: localHit.clone(), normalLocal });
  }

  if (includes('faceCenter')) {
    const faceCenter = getFaceCenter(geometry, faceIndex);
    if (faceCenter) {
      candidates.push({ kind: 'faceCenter', pointLocal: faceCenter, normalLocal });
    }
  }

  if (includes('vertex')) {
    const vertex = getNearestVertexOnFace(geometry, faceIndex, localHit);
    if (vertex) {
      candidates.push({ kind: 'vertex', pointLocal: vertex, normalLocal });
    }
  }

  if (includes('edgeMidpoint')) {
    const edgeMidpoint = getNearestEdgeMidpointOnFace(geometry, faceIndex, localHit);
    if (edgeMidpoint) {
      candidates.push({ kind: 'edgeMidpoint', pointLocal: edgeMidpoint, normalLocal });
    }
  }

  return candidates;
}
