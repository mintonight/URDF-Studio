/**
 * Mesh analysis infrastructure for CAD-compatible STEP export.
 *
 * Computes per-face normals, areas, curvature estimates, and neighborhood
 * statistics from a PreparedStepMesh. These are the foundation for region
 * growing and analytic surface fitting.
 */

import type { PreparedStepMesh } from './stepMeshTypes';

export interface FaceNormal {
  x: number;
  y: number;
  z: number;
}

export interface FaceStats {
  /** Unit normal vector of the triangle. */
  normal: FaceNormal;
  /** Triangle area in square meters. */
  area: number;
  /** Centroid of the triangle. */
  centroid: { x: number; y: number; z: number };
}

export interface EdgeCurvature {
  /** Dihedral angle between the two adjacent faces (radians). */
  dihedralAngle: number;
  /** Whether this edge is a sharp feature edge (dihedral > threshold). */
  isSharp: boolean;
}

export interface MeshAnalysis {
  faces: FaceStats[];
  /** Per-edge curvature keyed by "minIdx:maxIdx". */
  edgeCurvature: Map<string, EdgeCurvature>;
  /** Total surface area. */
  totalArea: number;
  /** Bounding box diagonal. */
  diagonal: number;
  /** Average edge length. */
  averageEdgeLength: number;
}

/** Compute cross product of two 3D vectors. */
function cross(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** Normalize a 3D vector in place, returning the normalized components. */
function normalize(x: number, y: number, z: number): FaceNormal {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-20) return { x: 0, y: 0, z: 1 };
  return { x: x / len, y: y / len, z: z / len };
}

/** Dot product of two face normals. */
function dotNormal(a: FaceNormal, b: FaceNormal): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Analyze a prepared mesh: compute per-face normals, areas, centroids,
 * per-edge dihedral angles, and aggregate statistics.
 */
export function analyzeMeshTopology(prepared: PreparedStepMesh): MeshAnalysis {
  const { mesh } = prepared;
  const vertices = mesh.vertices;
  const indices = mesh.indices;
  const faceCount = indices.length / 3;

  const faces: FaceStats[] = [];
  let totalArea = 0;

  // Bounding box for diagonal.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Per-face stats.
  for (let t = 0; t < faceCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;

    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];

    // Edges.
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = cx - ax, fy = cy - ay, fz = cz - az;

    // Normal = cross(e, f), normalized.
    const [nx, ny, nz] = cross(ex, ey, ez, fx, fy, fz);
    const normal = normalize(nx, ny, nz);

    // Area = 0.5 * |cross|.
    const crossLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = crossLen * 0.5;
    totalArea += area;

    // Centroid.
    const centroid = {
      x: (ax + bx + cx) / 3,
      y: (ay + by + cy) / 3,
      z: (az + bz + cz) / 3,
    };

    faces.push({ normal, area, centroid });
  }

  // Per-edge dihedral angles.
  // Build face adjacency from the prepared mesh's triangle data.
  const edgeFaces = new Map<string, number[]>();
  for (let t = 0; t < faceCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const list = edgeFaces.get(key);
      if (list) list.push(t);
      else edgeFaces.set(key, [t]);
    }
  }

  const SHARP_EDGE_THRESHOLD = 30 * Math.PI / 180; // 30 degrees
  const edgeCurvature = new Map<string, EdgeCurvature>();
  let totalEdgeLength = 0;
  let edgeCount = 0;

  for (const [key, faceList] of edgeFaces) {
    let dihedral = 0;
    let isSharp = false;

    if (faceList.length === 2) {
      const n1 = faces[faceList[0]].normal;
      const n2 = faces[faceList[1]].normal;
      const d = dotNormal(n1, n2);
      dihedral = Math.acos(Math.max(-1, Math.min(1, d)));
      isSharp = dihedral > SHARP_EDGE_THRESHOLD;
    } else if (faceList.length === 1) {
      // Boundary edge — treat as maximally sharp.
      dihedral = Math.PI;
      isSharp = true;
    } else {
      // Non-manifold edge.
      dihedral = Math.PI;
      isSharp = true;
    }

    edgeCurvature.set(key, { dihedralAngle: dihedral, isSharp });

    // Accumulate edge length for average.
    const [p, q] = key.split(':').map(Number);
    const px = vertices[p * 3], py = vertices[p * 3 + 1], pz = vertices[p * 3 + 2];
    const qx = vertices[q * 3], qy = vertices[q * 3 + 1], qz = vertices[q * 3 + 2];
    const len = Math.sqrt((qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2);
    totalEdgeLength += len;
    edgeCount++;
  }

  const averageEdgeLength = edgeCount > 0 ? totalEdgeLength / edgeCount : 0;

  return {
    faces,
    edgeCurvature,
    totalArea,
    diagonal,
    averageEdgeLength,
  };
}
