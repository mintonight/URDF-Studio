import * as THREE from 'three';

import { getFaceCenter, getFaceNormal } from './meshSnapPoints.ts';

export interface CircleFitResult {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  rmsRatio: number;
  confidence: number;
}

export interface CircleFaceDetectOptions {
  coplanarCosThreshold?: number;
  maxFaces?: number;
  minBoundaryVertices?: number;
  maxRmsRatio?: number;
}

interface ResolvedOptions {
  coplanarCosThreshold: number;
  maxFaces: number;
  minBoundaryVertices: number;
  maxRmsRatio: number;
}

interface HalfEdgeAdjacency {
  faceVertices: Array<[number, number, number]>;
  faceNeighbors: number[][];
  edgeFaces: Map<string, number[]>;
  vertexKeys: string[];
  indexCount: number;
  positionCount: number;
  indexVersion: number;
}

interface CircleBasis {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

interface CoplanarFaceInput {
  geometry: THREE.BufferGeometry;
  faceIndex: number;
  adjacency: HalfEdgeAdjacency;
  seedNormal: THREE.Vector3;
  options: ResolvedOptions;
}

const CACHE_KEY = '__circleAdjCache';
const DEFAULT_OPTIONS: ResolvedOptions = {
  coplanarCosThreshold: 0.999,
  maxFaces: 4000,
  minBoundaryVertices: 8,
  maxRmsRatio: 0.05,
};
const SOLVE_EPSILON = 1e-12;
const RADIUS_EPSILON = 1e-10;
const POSITION_KEY_PRECISION = 1e-8;

function resolveOptions(options: CircleFaceDetectOptions | undefined): ResolvedOptions {
  return { ...DEFAULT_OPTIONS, ...options };
}

function vertexPositionKey(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertexIndex: number,
): string {
  const x = Math.round(position.getX(vertexIndex) / POSITION_KEY_PRECISION);
  const y = Math.round(position.getY(vertexIndex) / POSITION_KEY_PRECISION);
  const z = Math.round(position.getZ(vertexIndex) / POSITION_KEY_PRECISION);
  return `${x}_${y}_${z}`;
}

function edgeKey(vertexKeys: string[], a: number, b: number): string {
  const aKey = vertexKeys[a];
  const bKey = vertexKeys[b];
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function getCachedAdjacency(
  geometry: THREE.BufferGeometry,
  index: THREE.BufferAttribute,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): HalfEdgeAdjacency | null {
  const cached = geometry.userData[CACHE_KEY] as HalfEdgeAdjacency | undefined;
  if (
    cached &&
    cached.indexCount === index.count &&
    cached.positionCount === position.count &&
    cached.indexVersion === index.version
  ) {
    return cached;
  }

  const faceCount = index.count / 3;
  if (!Number.isInteger(faceCount)) {
    return null;
  }

  const vertexKeys = Array.from({ length: position.count }, (_, vertexIndex) =>
    vertexPositionKey(position, vertexIndex),
  );
  const faceVertices: Array<[number, number, number]> = [];
  const edgeFaces = new Map<string, number[]>();
  for (let face = 0; face < faceCount; face += 1) {
    const base = face * 3;
    const vertices: [number, number, number] = [
      index.getX(base),
      index.getX(base + 1),
      index.getX(base + 2),
    ];
    if (
      vertices.some(
        (vertexIndex) =>
          !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count,
      )
    ) {
      return null;
    }
    faceVertices.push(vertices);
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ]) {
      const key = edgeKey(vertexKeys, a, b);
      const faces = edgeFaces.get(key);
      if (faces) {
        faces.push(face);
      } else {
        edgeFaces.set(key, [face]);
      }
    }
  }

  const faceNeighbors = Array.from({ length: faceCount }, () => [] as number[]);
  for (const faces of edgeFaces.values()) {
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        faceNeighbors[faces[i]].push(faces[j]);
        faceNeighbors[faces[j]].push(faces[i]);
      }
    }
  }

  const adjacency = {
    faceVertices,
    faceNeighbors,
    edgeFaces,
    vertexKeys,
    indexCount: index.count,
    positionCount: position.count,
    indexVersion: index.version,
  };
  geometry.userData[CACHE_KEY] = adjacency;
  return adjacency;
}

function collectCoplanarFaces(input: CoplanarFaceInput): Set<number> | null {
  const { geometry, faceIndex, adjacency, seedNormal, options } = input;
  const faces = new Set<number>([faceIndex]);
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];
  let cursor = 0;

  while (cursor < queue.length) {
    const face = queue[cursor];
    cursor += 1;
    for (const neighbor of adjacency.faceNeighbors[face]) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      const normal = getFaceNormal(geometry, neighbor);
      if (!normal || normal.dot(seedNormal) < options.coplanarCosThreshold) {
        continue;
      }
      faces.add(neighbor);
      if (faces.size > options.maxFaces) {
        return null;
      }
      queue.push(neighbor);
    }
  }

  return faces;
}

function collectBoundaryVertices(faces: Set<number>, adjacency: HalfEdgeAdjacency): number[] {
  const boundary = new Map<string, number>();
  for (const face of faces) {
    const vertices = adjacency.faceVertices[face];
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ]) {
      const adjacentFaces = adjacency.edgeFaces.get(edgeKey(adjacency.vertexKeys, a, b));
      if (!adjacentFaces || adjacentFaces.some((candidate) => !faces.has(candidate))) {
        boundary.set(adjacency.vertexKeys[a], a);
        boundary.set(adjacency.vertexKeys[b], b);
      }
    }
  }
  return [...boundary.values()];
}

function buildCircleBasis(origin: THREE.Vector3, normal: THREE.Vector3): CircleBasis | null {
  const n = normal.clone();
  if (n.lengthSq() < RADIUS_EPSILON) {
    return null;
  }
  n.normalize();
  const fallback = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = fallback.sub(n.clone().multiplyScalar(fallback.dot(n)));
  if (u.lengthSq() < RADIUS_EPSILON) {
    return null;
  }
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { origin, u, v };
}

function determinant3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function replaceColumn(m: number[][], column: number, values: number[]): number[][] {
  return m.map((row, rowIndex) =>
    row.map((value, columnIndex) => (columnIndex === column ? values[rowIndex] : value)),
  );
}

export function kasaCircleFit(
  points: Array<{ x: number; y: number }>,
): { center: { x: number; y: number }; radius: number } | null {
  if (points.length < 3) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;

  for (const point of points) {
    const x2 = point.x * point.x;
    const y2 = point.y * point.y;
    sumX += point.x;
    sumY += point.y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += point.x * point.y;
    sumX3 += x2 * point.x;
    sumY3 += y2 * point.y;
    sumX2Y += x2 * point.y;
    sumXY2 += point.x * y2;
  }

  const matrix = [
    [sumX2, sumXY, sumX],
    [sumXY, sumY2, sumY],
    [sumX, sumY, points.length],
  ];
  const rhs = [sumX3 + sumXY2, sumX2Y + sumY3, sumX2 + sumY2];
  const determinant = determinant3(matrix);
  if (Math.abs(determinant) < SOLVE_EPSILON) {
    return null;
  }

  const a = determinant3(replaceColumn(matrix, 0, rhs)) / determinant;
  const b = determinant3(replaceColumn(matrix, 1, rhs)) / determinant;
  const c = determinant3(replaceColumn(matrix, 2, rhs)) / determinant;
  const radiusSq = c + (a * a + b * b) * 0.25;
  if (!(radiusSq > RADIUS_EPSILON) || !Number.isFinite(radiusSq)) {
    return null;
  }

  return {
    center: { x: a * 0.5, y: b * 0.5 },
    radius: Math.sqrt(radiusSq),
  };
}

export function detectCircleFaceFromHit(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  options?: CircleFaceDetectOptions,
): CircleFitResult | null {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index || !position || !Number.isInteger(faceIndex) || faceIndex < 0) {
    return null;
  }

  const resolvedOptions = resolveOptions(options);
  const adjacency = getCachedAdjacency(geometry, index, position);
  if (!adjacency || faceIndex >= adjacency.faceVertices.length) {
    return null;
  }

  const seedNormal = getFaceNormal(geometry, faceIndex);
  const seedCenter = getFaceCenter(geometry, faceIndex);
  if (!seedNormal || !seedCenter) {
    return null;
  }

  const faceSet = collectCoplanarFaces({
    geometry,
    faceIndex,
    adjacency,
    seedNormal,
    options: resolvedOptions,
  });
  if (!faceSet) {
    return null;
  }

  const boundaryIndices = collectBoundaryVertices(faceSet, adjacency);
  if (boundaryIndices.length < resolvedOptions.minBoundaryVertices) {
    return null;
  }

  const basis = buildCircleBasis(seedCenter, seedNormal);
  if (!basis) {
    return null;
  }

  const point = new THREE.Vector3();
  const points2d = boundaryIndices.map((vertexIndex) => {
    point.fromBufferAttribute(position, vertexIndex);
    const offset = point.clone().sub(basis.origin);
    return { x: offset.dot(basis.u), y: offset.dot(basis.v) };
  });
  const fit = kasaCircleFit(points2d);
  if (!fit) {
    return null;
  }

  let residualSq = 0;
  for (const projected of points2d) {
    const distance = Math.hypot(projected.x - fit.center.x, projected.y - fit.center.y);
    const residual = distance - fit.radius;
    residualSq += residual * residual;
  }
  const rmsRatio = Math.sqrt(residualSq / points2d.length) / fit.radius;
  if (!Number.isFinite(rmsRatio) || rmsRatio > resolvedOptions.maxRmsRatio) {
    return null;
  }

  const center = basis.origin
    .clone()
    .add(basis.u.clone().multiplyScalar(fit.center.x))
    .add(basis.v.clone().multiplyScalar(fit.center.y));
  return {
    center,
    normal: seedNormal.clone().normalize(),
    radius: fit.radius,
    rmsRatio,
    confidence: Math.max(0, 1 - rmsRatio / resolvedOptions.maxRmsRatio),
  };
}
