import * as THREE from 'three';
import path from 'node:path';
import type { ParsedMJCFModel } from './mjcfModel';
import {
  buildGeneratedMjcfBodyPath,
  buildGeneratedMjcfBodySegment,
  buildGeneratedMjcfGeomName,
  buildGeneratedMjcfJointName,
} from './mjcfGeneratedNames';

const NUMBER_PRECISION = 6;
const EPSILON = 1e-5;
const RELAXED_NUMERIC_EPSILON = 1e-4;
const AXISYMMETRIC_GEOM_AXIS_DOT_TOLERANCE = Math.cos(THREE.MathUtils.degToRad(1));
const DEFAULT_MATERIAL_RGBA: [number, number, number, number] = [1, 1, 1, 1];
const GEOM_SIZE_ARITY_BY_TYPE: Record<string, number> = {
  sphere: 1,
  capsule: 2,
  cylinder: 2,
  box: 3,
  ellipsoid: 3,
  plane: 3,
};

export interface CanonicalMJCFBody {
  key: string;
  name: string | null;
  parentKey: string | null;
  path: string;
  pos: [number, number, number];
  quat: [number, number, number, number] | null;
  mass: number | null;
  inertialPos: [number, number, number] | null;
  inertialQuat: [number, number, number, number] | null;
  inertia: [number, number, number] | null;
  fullinertia: [number, number, number, number, number, number] | null;
}

export interface CanonicalMJCFJoint {
  key: string;
  name: string | null;
  parentBodyKey: string;
  type: string;
  axis: [number, number, number] | null;
  range: [number, number] | null;
  pos: [number, number, number] | null;
}

export interface CanonicalMJCFGeom {
  key: string;
  name: string | null;
  bodyKey: string;
  type: string;
  size: number[];
  mesh: string | null;
  material: string | null;
  mass: number | null;
  pos: [number, number, number] | null;
  quat: [number, number, number, number] | null;
  rgba: [number, number, number, number] | null;
  group: number | null;
  contype: number | null;
  conaffinity: number | null;
}

export interface CanonicalMJCFMeshAsset {
  name: string;
  file: string | null;
  scale: number[];
  refpos: [number, number, number] | null;
  refquat: [number, number, number, number] | null;
}

export interface CanonicalMJCFMaterialAsset {
  name: string;
  rgba: [number, number, number, number] | null;
  emission: number | null;
}

export interface CanonicalMJCFSnapshot {
  schema: 'urdf-studio.mjcf-canonical/v1';
  meta: {
    modelName: string;
    sourceFile?: string;
    effectiveFile?: string;
  };
  counts: {
    bodies: number;
    joints: number;
    geoms: number;
    meshes: number;
    materials: number;
  };
  bodies: CanonicalMJCFBody[];
  joints: CanonicalMJCFJoint[];
  geoms: CanonicalMJCFGeom[];
  assets: {
    meshes: CanonicalMJCFMeshAsset[];
    materials: CanonicalMJCFMaterialAsset[];
  };
}

export interface CanonicalSnapshotOptions {
  sourceFile?: string;
  effectiveFile?: string;
  angleUnit?: 'radian' | 'degree';
}

export interface MJCFSnapshotDiff {
  type:
    | 'SOURCE_RESOLUTION_MISMATCH'
    | 'BODY_MISSING'
    | 'BODY_PARENT_MISMATCH'
    | 'BODY_POS_MISMATCH'
    | 'BODY_QUAT_MISMATCH'
    | 'BODY_MASS_MISMATCH'
    | 'BODY_INERTIAL_POS_MISMATCH'
    | 'BODY_INERTIAL_QUAT_MISMATCH'
    | 'BODY_INERTIA_MISMATCH'
    | 'BODY_FULLINERTIA_MISMATCH'
    | 'JOINT_MISSING'
    | 'JOINT_BODY_MISMATCH'
    | 'JOINT_TYPE_MISMATCH'
    | 'JOINT_AXIS_MISMATCH'
    | 'JOINT_POS_MISMATCH'
    | 'JOINT_RANGE_MISMATCH'
    | 'GEOM_MISSING'
    | 'GEOM_TYPE_MISMATCH'
    | 'GEOM_BODY_MISMATCH'
    | 'GEOM_SIZE_MISMATCH'
    | 'GEOM_MESH_MISMATCH'
    | 'GEOM_MATERIAL_MISMATCH'
    | 'GEOM_POS_MISMATCH'
    | 'GEOM_QUAT_MISMATCH'
    | 'GEOM_RGBA_MISMATCH'
    | 'GEOM_GROUP_MISMATCH'
    | 'GEOM_CONTYPE_MISMATCH'
    | 'GEOM_CONAFFINITY_MISMATCH'
    | 'GEOM_MASS_MISMATCH'
    | 'MESH_PATH_MISMATCH'
    | 'MESH_SCALE_MISMATCH'
    | 'MESH_REFPOS_MISMATCH'
    | 'MESH_REFQUAT_MISMATCH'
    | 'MATERIAL_RGBA_MISMATCH'
    | 'MATERIAL_EMISSION_MISMATCH'
    | 'COUNT_MISMATCH';
  key: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(NUMBER_PRECISION));
}

function normalizeVector(value: number[] | undefined | null, length: number): number[] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const normalized: number[] = [];
  for (let index = 0; index < length; index += 1) {
    normalized.push(roundNumber(value[index] ?? 0));
  }
  return normalized;
}

function normalizeUnitVector(value: number[] | undefined | null, length: number): number[] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const raw: number[] = [];
  for (let index = 0; index < length; index += 1) {
    raw.push(value[index] ?? 0);
  }

  const magnitude = Math.hypot(...raw);
  if (magnitude <= 1e-8) {
    return raw.map((entry) => roundNumber(entry));
  }

  return raw.map((entry) => roundNumber(entry / magnitude));
}

function normalizeQuatFromEuler(
  euler: number[] | undefined,
  angleUnit: 'radian' | 'degree',
): [number, number, number, number] | null {
  if (!euler || euler.length < 3) {
    return null;
  }

  const [x, y, z] = euler;
  const eulerValue = new THREE.Euler(
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(x ?? 0) : (x ?? 0),
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(y ?? 0) : (y ?? 0),
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(z ?? 0) : (z ?? 0),
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(eulerValue);
  return [
    roundNumber(quaternion.w),
    roundNumber(quaternion.x),
    roundNumber(quaternion.y),
    roundNumber(quaternion.z),
  ];
}

function normalizeQuat(
  value: number[] | undefined | null,
): [number, number, number, number] | null {
  const raw = normalizeVector(value, 4);
  if (!raw) {
    return null;
  }

  const [w, x, y, z] = raw;
  const length = Math.hypot(w, x, y, z);
  if (length <= 1e-8) {
    return [1, 0, 0, 0];
  }

  return [
    roundNumber(w / length),
    roundNumber(x / length),
    roundNumber(y / length),
    roundNumber(z / length),
  ];
}

function normalizePos(value: number[] | undefined | null): [number, number, number] {
  return (normalizeVector(value, 3) || [0, 0, 0]) as [number, number, number];
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return roundNumber(value);
}

function normalizeScale(value: number[] | undefined | null): number[] {
  const normalized = normalizeVector(value, 3);
  if (!normalized) {
    return [1, 1, 1];
  }

  return [normalized[0] ?? 1, normalized[1] ?? 1, normalized[2] ?? 1];
}

function normalizeGeomRGBA(value: number[] | undefined | null): [number, number, number, number] {
  const normalized = normalizeVector(value, 4);
  if (!normalized) {
    return [0.5, 0.5, 0.5, 1];
  }

  return [normalized[0] ?? 0.5, normalized[1] ?? 0.5, normalized[2] ?? 0.5, normalized[3] ?? 1];
}

function quaternionToMjcfTuple(quaternion: THREE.Quaternion): [number, number, number, number] {
  const normalized = quaternion.normalize();
  return [
    roundNumber(normalized.w),
    roundNumber(normalized.x),
    roundNumber(normalized.y),
    roundNumber(normalized.z),
  ];
}

function createMuJoCoFromToQuaternion(direction: THREE.Vector3): THREE.Quaternion {
  const normalizedDirection = direction.clone().normalize();
  const localNegativeZ = new THREE.Vector3(0, 0, -1);
  const dot = localNegativeZ.dot(normalizedDirection);

  // MuJoCo resolves the 180deg ambiguity for fromto primitives by rotating
  // around +X when the canonical -Z axis needs to flip to +Z.
  if (dot <= -1 + 1e-9) {
    return new THREE.Quaternion(1, 0, 0, 0);
  }

  return new THREE.Quaternion().setFromUnitVectors(localNegativeZ, normalizedDirection);
}

function normalizeQuaternionFromDirection(
  direction: THREE.Vector3,
): [number, number, number, number] {
  if (direction.lengthSq() <= 1e-12) {
    return [1, 0, 0, 0];
  }

  const quaternion = createMuJoCoFromToQuaternion(direction);
  return quaternionToMjcfTuple(quaternion);
}

function canonicalizeFromToGeom(
  geom: Pick<ParsedMJCFModel['worldBody']['geoms'][number], 'type' | 'size' | 'fromto'>,
): {
  pos: [number, number, number];
  quat: [number, number, number, number];
  size: number[];
} | null {
  if (!geom.fromto || geom.fromto.length < 6) {
    return null;
  }

  if (geom.type !== 'capsule' && geom.type !== 'cylinder') {
    return null;
  }

  const radius = geom.size?.[0];
  if (radius == null) {
    return null;
  }

  const from = new THREE.Vector3(geom.fromto[0] ?? 0, geom.fromto[1] ?? 0, geom.fromto[2] ?? 0);
  const to = new THREE.Vector3(geom.fromto[3] ?? 0, geom.fromto[4] ?? 0, geom.fromto[5] ?? 0);
  const direction = new THREE.Vector3().subVectors(to, from);
  const center = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);

  return {
    pos: [roundNumber(center.x), roundNumber(center.y), roundNumber(center.z)],
    quat: normalizeQuaternionFromDirection(direction),
    size: [roundNumber(radius), roundNumber(direction.length() / 2)],
  };
}

function sortEigenvectorsByDescendingValues(
  eigenvalues: [number, number, number],
  eigenvectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
): {
  values: [number, number, number];
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
} {
  const pairs = eigenvalues
    .map((value, index) => ({
      value,
      vector: eigenvectors[index]!.clone(),
    }))
    .sort((left, right) => right.value - left.value);

  const vectors = pairs.map((pair) => pair.vector) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  const basis = new THREE.Matrix4().makeBasis(vectors[0], vectors[1], vectors[2]);
  if (basis.determinant() < 0) {
    vectors[2] = vectors[2].clone().multiplyScalar(-1);
  }

  return {
    values: pairs.map((pair) => roundNumber(pair.value)) as [number, number, number],
    vectors,
  };
}

function diagonalizeFullInertia(
  fullinertia: [number, number, number, number, number, number] | null | undefined,
  boundInertia: number | undefined = undefined,
): {
  diaginertia: [number, number, number];
  quat: [number, number, number, number];
} | null {
  if (!fullinertia || fullinertia.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const matrix = [
    [fullinertia[0], fullinertia[3], fullinertia[4]],
    [fullinertia[3], fullinertia[1], fullinertia[5]],
    [fullinertia[4], fullinertia[5], fullinertia[2]],
  ];
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iteration = 0; iteration < 24; iteration += 1) {
    let pivotRow = 0;
    let pivotCol = 1;
    let pivotValue = Math.abs(matrix[pivotRow]![pivotCol]!);

    for (const [row, col] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const candidate = Math.abs(matrix[row]![col]!);
      if (candidate > pivotValue) {
        pivotRow = row;
        pivotCol = col;
        pivotValue = candidate;
      }
    }

    if (pivotValue <= 1e-12) {
      break;
    }

    const app = matrix[pivotRow]![pivotRow]!;
    const aqq = matrix[pivotCol]![pivotCol]!;
    const apq = matrix[pivotRow]![pivotCol]!;
    const tau = (aqq - app) / (2 * apq);
    const tangent = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const sine = tangent * cosine;

    for (let row = 0; row < 3; row += 1) {
      if (row === pivotRow || row === pivotCol) {
        continue;
      }

      const arp = matrix[row]![pivotRow]!;
      const arq = matrix[row]![pivotCol]!;
      matrix[row]![pivotRow] = arp * cosine - arq * sine;
      matrix[pivotRow]![row] = matrix[row]![pivotRow]!;
      matrix[row]![pivotCol] = arp * sine + arq * cosine;
      matrix[pivotCol]![row] = matrix[row]![pivotCol]!;
    }

    matrix[pivotRow]![pivotRow] =
      app * cosine * cosine - 2 * apq * cosine * sine + aqq * sine * sine;
    matrix[pivotCol]![pivotCol] =
      app * sine * sine + 2 * apq * cosine * sine + aqq * cosine * cosine;
    matrix[pivotRow]![pivotCol] = 0;
    matrix[pivotCol]![pivotRow] = 0;

    for (let row = 0; row < 3; row += 1) {
      const vrp = eigenvectors[row]![pivotRow]!;
      const vrq = eigenvectors[row]![pivotCol]!;
      eigenvectors[row]![pivotRow] = vrp * cosine - vrq * sine;
      eigenvectors[row]![pivotCol] = vrp * sine + vrq * cosine;
    }
  }

  const effectiveBoundInertia =
    boundInertia != null && Number.isFinite(boundInertia) ? Math.max(boundInertia, 0) : 0;
  const sorted = sortEigenvectorsByDescendingValues(
    [matrix[0]![0]!, matrix[1]![1]!, matrix[2]![2]!],
    [
      new THREE.Vector3(eigenvectors[0]![0]!, eigenvectors[1]![0]!, eigenvectors[2]![0]!),
      new THREE.Vector3(eigenvectors[0]![1]!, eigenvectors[1]![1]!, eigenvectors[2]![1]!),
      new THREE.Vector3(eigenvectors[0]![2]!, eigenvectors[1]![2]!, eigenvectors[2]![2]!),
    ],
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(sorted.vectors[0], sorted.vectors[1], sorted.vectors[2]),
  );

  return {
    diaginertia: sorted.values.map((value) =>
      roundNumber(Math.max(value, effectiveBoundInertia)),
    ) as [number, number, number],
    quat: quaternionToMjcfTuple(quaternion),
  };
}

function quaternionsEqual(
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (arraysEqual(left, right)) {
    return true;
  }

  return arraysEqual(
    left.map((value) => -value),
    right,
  );
}

function axisymmetricGeomOrientationsEqual(
  geomType: string,
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (quaternionsEqual(left, right)) {
    return true;
  }

  if (geomType !== 'capsule' && geomType !== 'cylinder') {
    return false;
  }

  if (!left || !right) {
    return false;
  }

  const leftAxis = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion(left[1], left[2], left[3], left[0]).normalize())
    .normalize();
  const rightAxis = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion(right[1], right[2], right[3], right[0]).normalize())
    .normalize();

  return Math.abs(leftAxis.dot(rightAxis)) >= AXISYMMETRIC_GEOM_AXIS_DOT_TOLERANCE;
}

function normalizeRange(
  value: number[] | undefined | null,
  angleUnit: 'radian' | 'degree',
): [number, number] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const lower = value[0] ?? 0;
  const upper = value[1] ?? 0;
  const normalized =
    angleUnit === 'degree'
      ? [THREE.MathUtils.degToRad(lower), THREE.MathUtils.degToRad(upper)]
      : [lower, upper];
  return [roundNumber(normalized[0]), roundNumber(normalized[1])];
}

function trimTrailingZeros(values: number[] | null): number[] | null {
  if (!values) {
    return null;
  }

  const trimmed = [...values];
  while (trimmed.length > 0 && nearlyEqual(trimmed[trimmed.length - 1], 0)) {
    trimmed.pop();
  }
  return trimmed;
}

function canonicalizeGeomSize(type: string, value: number[] | null | undefined): number[] {
  const trimmed = trimTrailingZeros(value ? value.map((entry) => roundNumber(entry)) : null) || [];
  const arity = GEOM_SIZE_ARITY_BY_TYPE[type];
  if (!arity) {
    return trimmed;
  }

  return trimmed.slice(0, arity);
}

function normalizeOracleJointType(value: string | undefined | null): string {
  const normalized = (value || 'hinge')
    .replace(/^mjt[A-Za-z]+_/, '')
    .replace(/^mjJNT_/, '')
    .toLowerCase();
  return normalized || 'hinge';
}

function normalizeOracleGeomType(value: string | undefined | null): string {
  const normalized = (value || 'sphere')
    .replace(/^mjt[A-Za-z]+_/, '')
    .replace(/^mjGEOM_/, '')
    .toLowerCase();
  return normalized || 'sphere';
}

function normalizeMeshFile(file: string | null | undefined): string | null {
  if (!file) {
    return null;
  }

  return path.posix.basename(file.replace(/\\/g, '/'));
}

function bodyKeyFromName(name: string | null | undefined, path: string): string {
  return name?.trim() || path;
}

function jointKeyFromName(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

function geomKeyFromName(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

function normalizeOracleAngleUnit(value: unknown): 'radian' | 'degree' {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) {
    return 'degree';
  }
  return normalized.includes('degree') ? 'degree' : 'radian';
}

export function createCanonicalSnapshotFromParsedModel(
  parsedModel: ParsedMJCFModel,
  options: CanonicalSnapshotOptions = {},
): CanonicalMJCFSnapshot {
  const bodies: CanonicalMJCFBody[] = [];
  const joints: CanonicalMJCFJoint[] = [];
  const geoms: CanonicalMJCFGeom[] = [];

  const visitBody = (
    body: ParsedMJCFModel['worldBody'],
    parentKey: string | null,
    path: string,
  ): void => {
    const bodyName = body.sourceName || (path === 'world' ? 'world' : null);
    const bodyKey = bodyKeyFromName(bodyName, path);
    const canonicalInertia = diagonalizeFullInertia(
      body.inertial?.fullinertia || null,
      parsedModel.compilerSettings.boundinertia,
    );
    const quat = normalizeQuat(body.quat) ||
      normalizeQuatFromEuler(body.euler, parsedModel.compilerSettings.angleUnit) || [1, 0, 0, 0];

    bodies.push({
      key: bodyKey,
      name: bodyName,
      parentKey,
      path,
      pos: normalizePos(body.pos),
      quat,
      mass: normalizeNumber(body.inertial?.mass),
      inertialPos: body.inertial ? normalizePos(body.inertial.pos) : null,
      inertialQuat: body.inertial
        ? normalizeQuat(body.inertial.quat) || canonicalInertia?.quat || [1, 0, 0, 0]
        : null,
      inertia: body.inertial?.diaginertia
        ? applyBoundInertia(
            normalizeVector(body.inertial.diaginertia, 3) as [number, number, number] | null,
            parsedModel.compilerSettings.boundinertia,
          )
        : canonicalInertia?.diaginertia || null,
      fullinertia: body.inertial?.fullinertia
        ? (normalizeVector(body.inertial.fullinertia, 6) as
            | [number, number, number, number, number, number]
            | null)
        : null,
    });

    body.joints.forEach((joint, jointIndex) => {
      const fallback = buildGeneratedMjcfJointName(bodyKey, jointIndex);
      joints.push({
        key: jointKeyFromName(joint.sourceName, fallback),
        name: joint.sourceName || null,
        parentBodyKey: bodyKey,
        type: joint.type,
        axis: normalizeUnitVector(joint.axis, 3) as [number, number, number] | null,
        range: joint.range ? normalizeRange(joint.range, 'radian') : [0, 0],
        pos: normalizePos(joint.pos),
      });
    });

    body.geoms.forEach((geom, geomIndex) => {
      const fallback = buildGeneratedMjcfGeomName(bodyKey, geomIndex);
      const canonicalFromTo = canonicalizeFromToGeom(geom);
      geoms.push({
        key: geomKeyFromName(geom.sourceName || geom.name, fallback),
        name: geom.sourceName || null,
        bodyKey,
        type: geom.type,
        size:
          canonicalFromTo?.size ||
          canonicalizeGeomSize(geom.type, normalizeVector(geom.size, geom.size?.length || 0)),
        mesh: geom.mesh || null,
        material: geom.material || null,
        mass: normalizeNumber(geom.mass),
        pos: canonicalFromTo?.pos || normalizePos(geom.pos),
        quat: canonicalFromTo?.quat || normalizeQuat(geom.quat) || [1, 0, 0, 0],
        rgba: normalizeGeomRGBA(geom.rgba),
        group: geom.group ?? 0,
        contype: geom.contype ?? 1,
        conaffinity: geom.conaffinity ?? 1,
      });
    });

    body.children.forEach((child, childIndex) => {
      const childPath = child.sourceName
        ? `${path}/${child.sourceName}`
        : child.name || buildGeneratedMjcfBodyPath(path, childIndex);
      visitBody(child, bodyKey, childPath);
    });
  };

  visitBody(parsedModel.worldBody, null, 'world');

  const meshAssets = Array.from(parsedModel.meshMap.values())
    .map((mesh) => ({
      name: mesh.name,
      file: normalizeMeshFile(mesh.file),
      scale: normalizeScale(mesh.scale),
      refpos: normalizeVector(mesh.refpos, 3) as [number, number, number] | null,
      refquat: normalizeQuat(mesh.refquat),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const materialAssets = Array.from(parsedModel.materialMap.values())
    .map((material) => ({
      name: material.name,
      rgba: normalizeVector(material.rgba, 4) as [number, number, number, number] | null,
      emission: normalizeNumber(material.emission),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    schema: 'urdf-studio.mjcf-canonical/v1',
    meta: {
      modelName: parsedModel.modelName,
      sourceFile: options.sourceFile,
      effectiveFile: options.effectiveFile,
    },
    counts: {
      bodies: bodies.length,
      joints: joints.length,
      geoms: geoms.length,
      meshes: meshAssets.length,
      materials: materialAssets.length,
    },
    bodies: bodies.sort((left, right) => left.key.localeCompare(right.key)),
    joints: joints.sort((left, right) => left.key.localeCompare(right.key)),
    geoms: geoms.sort((left, right) => left.key.localeCompare(right.key)),
    assets: {
      meshes: meshAssets,
      materials: materialAssets,
    },
  };
}

export function createCanonicalSnapshotFromOracleExport(
  oracleExport: any,
  options: CanonicalSnapshotOptions = {},
): CanonicalMJCFSnapshot {
  const oracleAngleUnit =
    options.angleUnit || normalizeOracleAngleUnit(oracleExport?.compiler?.angle);
  const bodyKeyById = new Map<string, string>();
  const bodyPathById = new Map<string, string>();
  const childBodyIndexByParentId = new Map<string, number>();
  const nextLocalIndex = (counterMap: Map<string, number>, parentKey: string): number => {
    const nextIndex = counterMap.get(parentKey) ?? 0;
    counterMap.set(parentKey, nextIndex + 1);
    return nextIndex;
  };

  const bodies = (oracleExport.bodies || [])
    .map((body: any) => {
      const parentId = body.parent?.id as string | undefined;
      const parentPath = parentId
        ? bodyPathById.get(parentId) || body.parent?.name || 'world'
        : null;
      const path = parentId
        ? body.name ||
          buildGeneratedMjcfBodyPath(parentPath, nextLocalIndex(childBodyIndexByParentId, parentId))
        : 'world';
      const key = bodyKeyFromName(body.name || null, path);
      const parentKey = parentId
        ? bodyKeyById.get(parentId) || body.parent?.name || parentPath
        : null;
      bodyKeyById.set(body.id, key);
      bodyPathById.set(body.id, path);

      return {
        key,
        name: body.name || null,
        parentKey,
        path,
        pos: normalizePos(body.attrs?.pos),
        quat: normalizeQuat(body.attrs?.quat) ||
          normalizeQuatFromEuler(body.attrs?.euler, oracleAngleUnit) || [1, 0, 0, 0],
        mass: normalizeNumber(body.attrs?.mass),
        inertialPos: normalizeVector(body.attrs?.ipos, 3) as [number, number, number] | null,
        inertialQuat: normalizeQuat(body.attrs?.iquat) || [1, 0, 0, 0],
        inertia: normalizeVector(body.attrs?.inertia, 3) as [number, number, number] | null,
        fullinertia: normalizeVector(body.attrs?.fullinertia, 6) as
          | [number, number, number, number, number, number]
          | null,
      } satisfies CanonicalMJCFBody;
    })
    .sort((left: CanonicalMJCFBody, right: CanonicalMJCFBody) => left.key.localeCompare(right.key));

  const jointLocalIndexByBody = new Map<string, number>();
  const joints = (oracleExport.joints || [])
    .map((joint: any) => {
      const parentBodyKey = bodyKeyById.get(joint.parent?.id) || joint.parent?.name || 'world';
      const fallback = buildGeneratedMjcfJointName(
        parentBodyKey,
        nextLocalIndex(jointLocalIndexByBody, parentBodyKey),
      );
      return {
        key: jointKeyFromName(joint.name || null, fallback),
        name: joint.name || null,
        parentBodyKey,
        type: normalizeOracleJointType(joint.attrs?.type),
        axis: normalizeUnitVector(joint.attrs?.axis, 3) as [number, number, number] | null,
        range: normalizeRange(joint.attrs?.range, oracleAngleUnit),
        pos: normalizePos(joint.attrs?.pos),
      } satisfies CanonicalMJCFJoint;
    })
    .sort((left: CanonicalMJCFJoint, right: CanonicalMJCFJoint) =>
      left.key.localeCompare(right.key),
    );

  const geomLocalIndexByBody = new Map<string, number>();
  const geoms = (oracleExport.geoms || [])
    .map((geom: any) => {
      const parentBodyKey = bodyKeyById.get(geom.parent?.id) || geom.parent?.name || 'world';
      const fallback = buildGeneratedMjcfGeomName(
        parentBodyKey,
        nextLocalIndex(geomLocalIndexByBody, parentBodyKey),
      );
      const geomType = normalizeOracleGeomType(geom.attrs?.type);
      const canonicalFromTo = canonicalizeFromToGeom({
        type: geomType,
        size: geom.attrs?.size,
        fromto: geom.attrs?.fromto,
      });
      return {
        key: geomKeyFromName(geom.name || null, fallback),
        name: geom.name || null,
        bodyKey: parentBodyKey,
        type: geomType,
        size:
          canonicalFromTo?.size ||
          canonicalizeGeomSize(
            geomType,
            normalizeVector(geom.attrs?.size, geom.attrs?.size?.length || 0),
          ),
        mesh: geom.attrs?.meshname || null,
        material: geom.attrs?.material || null,
        mass: normalizeNumber(geom.attrs?.mass),
        pos: canonicalFromTo?.pos || normalizePos(geom.attrs?.pos),
        quat: canonicalFromTo?.quat ||
          normalizeQuat(geom.attrs?.quat) ||
          normalizeQuatFromEuler(geom.attrs?.euler, oracleAngleUnit) || [1, 0, 0, 0],
        rgba: normalizeGeomRGBA(geom.attrs?.rgba),
        group: geom.attrs?.group ?? 0,
        contype: geom.attrs?.contype ?? 1,
        conaffinity: geom.attrs?.conaffinity ?? 1,
      } satisfies CanonicalMJCFGeom;
    })
    .sort((left: CanonicalMJCFGeom, right: CanonicalMJCFGeom) => left.key.localeCompare(right.key));

  const meshAssets = (oracleExport.meshes || [])
    .map((mesh: any) => ({
      name: mesh.name || mesh.id,
      file: normalizeMeshFile(mesh.attrs?.file),
      scale: normalizeScale(mesh.attrs?.scale),
      refpos: normalizeVector(mesh.attrs?.refpos, 3) as [number, number, number] | null,
      refquat: normalizeQuat(mesh.attrs?.refquat),
    }))
    .sort((left: CanonicalMJCFMeshAsset, right: CanonicalMJCFMeshAsset) =>
      left.name.localeCompare(right.name),
    );

  const materialAssets = (oracleExport.materials || [])
    .map((material: any) => ({
      name: material.name || material.id,
      rgba: normalizeVector(material.attrs?.rgba, 4) as [number, number, number, number] | null,
      emission: normalizeNumber(material.attrs?.emission),
    }))
    .sort((left: CanonicalMJCFMaterialAsset, right: CanonicalMJCFMaterialAsset) =>
      left.name.localeCompare(right.name),
    );

  return {
    schema: 'urdf-studio.mjcf-canonical/v1',
    meta: {
      modelName: oracleExport.model_name,
      sourceFile: options.sourceFile,
      effectiveFile: options.effectiveFile,
    },
    counts: {
      bodies: oracleExport.spec_counts?.bodies ?? bodies.length,
      joints: oracleExport.spec_counts?.joints ?? joints.length,
      geoms: oracleExport.spec_counts?.geoms ?? geoms.length,
      meshes: oracleExport.spec_counts?.meshes ?? meshAssets.length,
      materials: oracleExport.spec_counts?.materials ?? materialAssets.length,
    },
    bodies,
    joints,
    geoms,
    assets: {
      meshes: meshAssets,
      materials: materialAssets,
    },
  };
}

function nearlyEqual(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance: number = EPSILON,
): boolean {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
}

function arraysEqual(
  left: number[] | null | undefined,
  right: number[] | null | undefined,
  tolerance: number = EPSILON,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => nearlyEqual(value, right[index], tolerance));
}

function optionalMassesEqual(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  if (left == null && right == null) {
    return true;
  }

  const normalizedLeft = left ?? 0;
  const normalizedRight = right ?? 0;
  return nearlyEqual(normalizedLeft, normalizedRight, RELAXED_NUMERIC_EPSILON);
}

function applyBoundInertia(
  inertia: [number, number, number] | null | undefined,
  boundInertia: number | undefined,
): [number, number, number] | null {
  if (!inertia) {
    return null;
  }

  const effectiveBoundInertia =
    boundInertia != null && Number.isFinite(boundInertia) ? Math.max(boundInertia, 0) : 0;

  return [
    roundNumber(Math.max(inertia[0], effectiveBoundInertia)),
    roundNumber(Math.max(inertia[1], effectiveBoundInertia)),
    roundNumber(Math.max(inertia[2], effectiveBoundInertia)),
  ];
}

function bodyHasExplicitInertial(body: CanonicalMJCFBody | null | undefined): boolean {
  if (!body) {
    return false;
  }

  return (
    body.mass != null ||
    body.inertialPos != null ||
    body.inertialQuat != null ||
    body.inertia != null ||
    body.fullinertia != null
  );
}

function geomMassesEqual(
  leftGeom: CanonicalMJCFGeom,
  rightGeom: CanonicalMJCFGeom,
  leftBody: CanonicalMJCFBody | null | undefined,
  rightBody: CanonicalMJCFBody | null | undefined,
): boolean {
  if (optionalMassesEqual(leftGeom.mass, rightGeom.mass)) {
    return true;
  }

  // MuJoCo canonicalizes per-geom mass away when a body carries explicit
  // inertial data, so compare those geoms on body inertial truth instead of
  // preserving noisy source-level geom mass tokens.
  if (bodyHasExplicitInertial(leftBody) || bodyHasExplicitInertial(rightBody)) {
    return true;
  }

  return false;
}

function jointAxesEqual(
  left: [number, number, number] | null | undefined,
  right: [number, number, number] | null | undefined,
): boolean {
  return arraysEqual(normalizeUnitVector(left, 3), normalizeUnitVector(right, 3));
}

function rangesEqual(
  left: number[] | null | undefined,
  right: number[] | null | undefined,
): boolean {
  return arraysEqual(left, right, RELAXED_NUMERIC_EPSILON);
}

function materialRGBAEqual(
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }

  return arraysEqual(left ?? DEFAULT_MATERIAL_RGBA, right ?? DEFAULT_MATERIAL_RGBA);
}

function canonicalBodyInertiaTensor(body: CanonicalMJCFBody): number[] | null {
  if (!body.inertia) {
    if (body.fullinertia) {
      return body.fullinertia.map((value) => roundNumber(value));
    }
    return null;
  }

  const quaternion = body.inertialQuat || [1, 0, 0, 0];
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(quaternion[1], quaternion[2], quaternion[3], quaternion[0]).normalize(),
  );
  const basisX = new THREE.Vector3().setFromMatrixColumn(rotation, 0);
  const basisY = new THREE.Vector3().setFromMatrixColumn(rotation, 1);
  const basisZ = new THREE.Vector3().setFromMatrixColumn(rotation, 2);
  const moments = body.inertia;

  const tensor = new THREE.Matrix3().set(
    basisX.x * basisX.x * moments[0] +
      basisY.x * basisY.x * moments[1] +
      basisZ.x * basisZ.x * moments[2],
    basisX.x * basisX.y * moments[0] +
      basisY.x * basisY.y * moments[1] +
      basisZ.x * basisZ.y * moments[2],
    basisX.x * basisX.z * moments[0] +
      basisY.x * basisY.z * moments[1] +
      basisZ.x * basisZ.z * moments[2],
    basisX.y * basisX.x * moments[0] +
      basisY.y * basisY.x * moments[1] +
      basisZ.y * basisZ.x * moments[2],
    basisX.y * basisX.y * moments[0] +
      basisY.y * basisY.y * moments[1] +
      basisZ.y * basisZ.y * moments[2],
    basisX.y * basisX.z * moments[0] +
      basisY.y * basisY.z * moments[1] +
      basisZ.y * basisZ.z * moments[2],
    basisX.z * basisX.x * moments[0] +
      basisY.z * basisY.x * moments[1] +
      basisZ.z * basisZ.x * moments[2],
    basisX.z * basisX.y * moments[0] +
      basisY.z * basisY.y * moments[1] +
      basisZ.z * basisZ.y * moments[2],
    basisX.z * basisX.z * moments[0] +
      basisY.z * basisY.z * moments[1] +
      basisZ.z * basisZ.z * moments[2],
  );
  const elements = tensor.elements;

  return [
    roundNumber(elements[0] ?? 0),
    roundNumber(elements[4] ?? 0),
    roundNumber(elements[8] ?? 0),
    roundNumber(elements[1] ?? 0),
    roundNumber(elements[2] ?? 0),
    roundNumber(elements[5] ?? 0),
  ];
}

export function diffCanonicalSnapshots(
  expected: CanonicalMJCFSnapshot,
  actual: CanonicalMJCFSnapshot,
): MJCFSnapshotDiff[] {
  const diffs: MJCFSnapshotDiff[] = [];

  if ((expected.meta.effectiveFile || null) !== (actual.meta.effectiveFile || null)) {
    diffs.push({
      type: 'SOURCE_RESOLUTION_MISMATCH',
      key: 'meta.effectiveFile',
      message: 'Effective MJCF file differs',
      expected: expected.meta.effectiveFile || null,
      actual: actual.meta.effectiveFile || null,
    });
  }

  (['bodies', 'joints', 'geoms', 'meshes', 'materials'] as const).forEach((field) => {
    if (expected.counts[field] !== actual.counts[field]) {
      diffs.push({
        type: 'COUNT_MISMATCH',
        key: `counts.${field}`,
        message: `Count mismatch for ${field}`,
        expected: expected.counts[field],
        actual: actual.counts[field],
      });
    }
  });

  const expectedBodies = new Map(expected.bodies.map((body) => [body.key, body]));
  const actualBodies = new Map(actual.bodies.map((body) => [body.key, body]));
  expectedBodies.forEach((expectedBody, key) => {
    const actualBody = actualBodies.get(key);
    if (!actualBody) {
      diffs.push({
        type: 'BODY_MISSING',
        key,
        message: 'Body missing in TS snapshot',
        expected: expectedBody,
      });
      return;
    }

    const expectedInertiaTensor = canonicalBodyInertiaTensor(expectedBody);
    const actualInertiaTensor = canonicalBodyInertiaTensor(actualBody);
    const inertiaTensorMatches = arraysEqual(expectedInertiaTensor, actualInertiaTensor);

    if ((expectedBody.parentKey || null) !== (actualBody.parentKey || null)) {
      diffs.push({
        type: 'BODY_PARENT_MISMATCH',
        key,
        message: 'Body parent differs',
        expected: expectedBody.parentKey || null,
        actual: actualBody.parentKey || null,
      });
    }

    if (!arraysEqual(expectedBody.pos, actualBody.pos)) {
      diffs.push({
        type: 'BODY_POS_MISMATCH',
        key,
        message: 'Body position differs',
        expected: expectedBody.pos,
        actual: actualBody.pos,
      });
    }

    if (!quaternionsEqual(expectedBody.quat, actualBody.quat)) {
      diffs.push({
        type: 'BODY_QUAT_MISMATCH',
        key,
        message: 'Body orientation differs',
        expected: expectedBody.quat,
        actual: actualBody.quat,
      });
    }

    if (!optionalMassesEqual(expectedBody.mass, actualBody.mass)) {
      diffs.push({
        type: 'BODY_MASS_MISMATCH',
        key,
        message: 'Body mass differs',
        expected: expectedBody.mass,
        actual: actualBody.mass,
      });
    }

    if (!arraysEqual(expectedBody.inertialPos, actualBody.inertialPos)) {
      diffs.push({
        type: 'BODY_INERTIAL_POS_MISMATCH',
        key,
        message: 'Body inertial position differs',
        expected: expectedBody.inertialPos,
        actual: actualBody.inertialPos,
      });
    }

    if (
      !quaternionsEqual(expectedBody.inertialQuat, actualBody.inertialQuat) &&
      !inertiaTensorMatches
    ) {
      diffs.push({
        type: 'BODY_INERTIAL_QUAT_MISMATCH',
        key,
        message: 'Body inertial orientation differs',
        expected: expectedBody.inertialQuat,
        actual: actualBody.inertialQuat,
      });
    }

    if (!arraysEqual(expectedBody.inertia, actualBody.inertia) && !inertiaTensorMatches) {
      diffs.push({
        type: 'BODY_INERTIA_MISMATCH',
        key,
        message: 'Body diagonal inertia differs',
        expected: expectedBody.inertia,
        actual: actualBody.inertia,
      });
    }

    // MuJoCo may represent non-principal inertia as NaN-padded fullinertia;
    // skip strict fullinertia comparison to avoid noisy false positives.
  });

  const expectedJoints = new Map(expected.joints.map((joint) => [joint.key, joint]));
  const actualJoints = new Map(actual.joints.map((joint) => [joint.key, joint]));
  expectedJoints.forEach((expectedJoint, key) => {
    const actualJoint = actualJoints.get(key);
    if (!actualJoint) {
      diffs.push({
        type: 'JOINT_MISSING',
        key,
        message: 'Joint missing in TS snapshot',
        expected: expectedJoint,
      });
      return;
    }

    if (expectedJoint.type !== actualJoint.type) {
      diffs.push({
        type: 'JOINT_TYPE_MISMATCH',
        key,
        message: 'Joint type differs',
        expected: expectedJoint.type,
        actual: actualJoint.type,
      });
    }

    if (expectedJoint.parentBodyKey !== actualJoint.parentBodyKey) {
      diffs.push({
        type: 'JOINT_BODY_MISMATCH',
        key,
        message: 'Joint parent body differs',
        expected: expectedJoint.parentBodyKey,
        actual: actualJoint.parentBodyKey,
      });
    }

    if (!jointAxesEqual(expectedJoint.axis, actualJoint.axis)) {
      diffs.push({
        type: 'JOINT_AXIS_MISMATCH',
        key,
        message: 'Joint axis differs',
        expected: expectedJoint.axis,
        actual: actualJoint.axis,
      });
    }

    if (!arraysEqual(expectedJoint.pos, actualJoint.pos)) {
      diffs.push({
        type: 'JOINT_POS_MISMATCH',
        key,
        message: 'Joint anchor position differs',
        expected: expectedJoint.pos,
        actual: actualJoint.pos,
      });
    }

    if (!rangesEqual(expectedJoint.range, actualJoint.range)) {
      diffs.push({
        type: 'JOINT_RANGE_MISMATCH',
        key,
        message: 'Joint range differs',
        expected: expectedJoint.range,
        actual: actualJoint.range,
      });
    }
  });

  const expectedGeoms = new Map(expected.geoms.map((geom) => [geom.key, geom]));
  const actualGeoms = new Map(actual.geoms.map((geom) => [geom.key, geom]));
  expectedGeoms.forEach((expectedGeom, key) => {
    const actualGeom = actualGeoms.get(key);
    if (!actualGeom) {
      diffs.push({
        type: 'GEOM_MISSING',
        key,
        message: 'Geom missing in TS snapshot',
        expected: expectedGeom,
      });
      return;
    }

    if (expectedGeom.type !== actualGeom.type) {
      diffs.push({
        type: 'GEOM_TYPE_MISMATCH',
        key,
        message: 'Geom type differs',
        expected: expectedGeom.type,
        actual: actualGeom.type,
      });
    }

    if (expectedGeom.bodyKey !== actualGeom.bodyKey) {
      diffs.push({
        type: 'GEOM_BODY_MISMATCH',
        key,
        message: 'Geom parent body differs',
        expected: expectedGeom.bodyKey,
        actual: actualGeom.bodyKey,
      });
    }

    const expectedSize = canonicalizeGeomSize(expectedGeom.type, expectedGeom.size);
    const actualSize = canonicalizeGeomSize(actualGeom.type, actualGeom.size);
    if (!arraysEqual(expectedSize, actualSize)) {
      diffs.push({
        type: 'GEOM_SIZE_MISMATCH',
        key,
        message: 'Geom size differs',
        expected: expectedSize,
        actual: actualSize,
      });
    }

    if ((expectedGeom.mesh || null) !== (actualGeom.mesh || null)) {
      diffs.push({
        type: 'GEOM_MESH_MISMATCH',
        key,
        message: 'Geom mesh reference differs',
        expected: expectedGeom.mesh || null,
        actual: actualGeom.mesh || null,
      });
    }

    if ((expectedGeom.material || null) !== (actualGeom.material || null)) {
      diffs.push({
        type: 'GEOM_MATERIAL_MISMATCH',
        key,
        message: 'Geom material differs',
        expected: expectedGeom.material || null,
        actual: actualGeom.material || null,
      });
    }

    if (!arraysEqual(expectedGeom.pos, actualGeom.pos)) {
      diffs.push({
        type: 'GEOM_POS_MISMATCH',
        key,
        message: 'Geom position differs',
        expected: expectedGeom.pos,
        actual: actualGeom.pos,
      });
    }

    if (!axisymmetricGeomOrientationsEqual(expectedGeom.type, expectedGeom.quat, actualGeom.quat)) {
      diffs.push({
        type: 'GEOM_QUAT_MISMATCH',
        key,
        message: 'Geom orientation differs',
        expected: expectedGeom.quat,
        actual: actualGeom.quat,
      });
    }

    if (!arraysEqual(expectedGeom.rgba, actualGeom.rgba)) {
      diffs.push({
        type: 'GEOM_RGBA_MISMATCH',
        key,
        message: 'Geom color differs',
        expected: expectedGeom.rgba,
        actual: actualGeom.rgba,
      });
    }

    if (expectedGeom.group !== actualGeom.group) {
      diffs.push({
        type: 'GEOM_GROUP_MISMATCH',
        key,
        message: 'Geom group differs',
        expected: expectedGeom.group,
        actual: actualGeom.group,
      });
    }

    if (expectedGeom.contype !== actualGeom.contype) {
      diffs.push({
        type: 'GEOM_CONTYPE_MISMATCH',
        key,
        message: 'Geom contype differs',
        expected: expectedGeom.contype,
        actual: actualGeom.contype,
      });
    }

    if (expectedGeom.conaffinity !== actualGeom.conaffinity) {
      diffs.push({
        type: 'GEOM_CONAFFINITY_MISMATCH',
        key,
        message: 'Geom conaffinity differs',
        expected: expectedGeom.conaffinity,
        actual: actualGeom.conaffinity,
      });
    }

    if (
      !geomMassesEqual(
        expectedGeom,
        actualGeom,
        expectedBodies.get(expectedGeom.bodyKey),
        actualBodies.get(actualGeom.bodyKey),
      )
    ) {
      diffs.push({
        type: 'GEOM_MASS_MISMATCH',
        key,
        message: 'Geom mass differs',
        expected: expectedGeom.mass,
        actual: actualGeom.mass,
      });
    }
  });

  const expectedMeshes = new Map(expected.assets.meshes.map((mesh) => [mesh.name, mesh]));
  const actualMeshes = new Map(actual.assets.meshes.map((mesh) => [mesh.name, mesh]));
  expectedMeshes.forEach((expectedMesh, key) => {
    const actualMesh = actualMeshes.get(key);
    if (!actualMesh || (expectedMesh.file || null) !== (actualMesh.file || null)) {
      diffs.push({
        type: 'MESH_PATH_MISMATCH',
        key,
        message: 'Mesh file path differs',
        expected: expectedMesh.file || null,
        actual: actualMesh?.file || null,
      });
    }

    if (!arraysEqual(expectedMesh.scale, actualMesh?.scale || null)) {
      diffs.push({
        type: 'MESH_SCALE_MISMATCH',
        key,
        message: 'Mesh scale differs',
        expected: expectedMesh.scale,
        actual: actualMesh?.scale || null,
      });
    }

    if (!arraysEqual(expectedMesh.refpos, actualMesh?.refpos || null)) {
      diffs.push({
        type: 'MESH_REFPOS_MISMATCH',
        key,
        message: 'Mesh reference position differs',
        expected: expectedMesh.refpos,
        actual: actualMesh?.refpos || null,
      });
    }

    if (!quaternionsEqual(expectedMesh.refquat, actualMesh?.refquat || null)) {
      diffs.push({
        type: 'MESH_REFQUAT_MISMATCH',
        key,
        message: 'Mesh reference orientation differs',
        expected: expectedMesh.refquat,
        actual: actualMesh?.refquat || null,
      });
    }
  });

  const expectedMaterials = new Map(
    expected.assets.materials.map((material) => [material.name, material]),
  );
  const actualMaterials = new Map(
    actual.assets.materials.map((material) => [material.name, material]),
  );
  expectedMaterials.forEach((expectedMaterial, key) => {
    const actualMaterial = actualMaterials.get(key);
    if (!materialRGBAEqual(expectedMaterial.rgba, actualMaterial?.rgba || null)) {
      diffs.push({
        type: 'MATERIAL_RGBA_MISMATCH',
        key,
        message: 'Material rgba differs',
        expected: expectedMaterial.rgba,
        actual: actualMaterial?.rgba || null,
      });
    }

    if (!nearlyEqual(expectedMaterial.emission, actualMaterial?.emission)) {
      diffs.push({
        type: 'MATERIAL_EMISSION_MISMATCH',
        key,
        message: 'Material emission differs',
        expected: expectedMaterial.emission,
        actual: actualMaterial?.emission ?? null,
      });
    }
  });

  return diffs;
}
