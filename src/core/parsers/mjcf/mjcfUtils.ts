import * as THREE from 'three';
import {
  MJCF_COMPILER_ANGLE_SCOPE_ATTR,
  MJCF_COMPILER_EULERSEQ_SCOPE_ATTR,
} from './mjcfCompilerScope';

export interface MJCFCompilerSettings {
  angleUnit: 'radian' | 'degree';
  assetdir: string;
  meshdir: string;
  texturedir: string;
  eulerSequence: string;
  autolimits: boolean;
  fitaabb: boolean;
  inertiafromgeom: 'false' | 'true' | 'auto';
  inertiagrouprange?: [number, number];
  boundinertia?: number;
}

export type MJCFMeshInertiaMode = 'legacy' | 'shell' | 'exact' | 'convex';

export interface MJCFMesh {
  name: string;
  file?: string;
  vertices?: number[];
  scale?: number[];
  refpos?: [number, number, number];
  refquat?: [number, number, number, number];
  inertia?: MJCFMeshInertiaMode;
}

export interface MJCFMaterial {
  name: string;
  rgba?: number[];
  shininess?: number;
  specular?: number;
  reflectance?: number;
  emission?: number;
  texture?: string;
  texrepeat?: number[];
  texuniform?: boolean;
}

export interface MJCFTexture {
  name: string;
  file?: string;
  type?: string;
  builtin?: string;
}

export interface MJCFHfield {
  name: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size?: [number, number, number, number];
  elevation?: number[];
}

export interface MJCFPosition {
  x: number;
  y: number;
  z: number;
}

export interface MJCFQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

type MJCFElementType =
  | 'body'
  | 'geom'
  | 'joint'
  | 'inertial'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'site'
  | 'tendon'
  | 'motor'
  | 'position'
  | 'velocity'
  | 'intvelocity'
  | 'general'
  | 'damper'
  | 'muscle'
  | 'adhesion';

type MJCFAttributeMap = Record<string, string>;

interface MJCFElementDefaults {
  body: MJCFAttributeMap;
  geom: MJCFAttributeMap;
  joint: MJCFAttributeMap;
  inertial: MJCFAttributeMap;
  mesh: MJCFAttributeMap;
  material: MJCFAttributeMap;
  texture: MJCFAttributeMap;
  site: MJCFAttributeMap;
  tendon: MJCFAttributeMap;
  motor: MJCFAttributeMap;
  position: MJCFAttributeMap;
  velocity: MJCFAttributeMap;
  intvelocity: MJCFAttributeMap;
  general: MJCFAttributeMap;
  damper: MJCFAttributeMap;
  muscle: MJCFAttributeMap;
  adhesion: MJCFAttributeMap;
}

interface MJCFDefaultClassEntry {
  qname: string;
  className: string;
  parentQName?: string;
  defaults: MJCFElementDefaults;
  children: string[];
}

export interface MJCFDefaultsRegistry {
  root: MJCFElementDefaults;
  classesByQName: Map<string, MJCFDefaultClassEntry>;
  qnamesByClassName: Map<string, string[]>;
}

const MJCF_ROOT_PATTERN =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)*<(?:mujoco|mujocoinclude)\b/i;

export function looksLikeMJCFDocument(content: string): boolean {
  if (!content) {
    return false;
  }

  return MJCF_ROOT_PATTERN.test(content.slice(0, 2048));
}

function repairMissingAttributeWhitespace(content: string): string {
  return content
    .replace(/"(?=[A-Za-z_][\w:.-]*=)/g, '" ')
    .replace(/'(?=[A-Za-z_][\w:.-]*=)/g, "' ");
}

export interface ParsedMJCFXmlDocumentResult {
  doc: Document | null;
  parseErrorText: string | null;
  recovered: boolean;
}

function parseXmlDocument(content: string): {
  doc: Document | null;
  parseErrorText: string | null;
} {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return {
        doc: null,
        parseErrorText: parseError.textContent?.trim() || 'unknown parse error',
      };
    }

    return {
      doc,
      parseErrorText: null,
    };
  } catch (error) {
    return {
      doc: null,
      parseErrorText: error instanceof Error ? error.message : 'unknown parse error',
    };
  }
}

export function parseMJCFXmlDocument(content: string): ParsedMJCFXmlDocumentResult {
  const initial = parseXmlDocument(content);
  if (initial.doc) {
    return {
      doc: initial.doc,
      parseErrorText: null,
      recovered: false,
    };
  }

  const repairedContent = repairMissingAttributeWhitespace(content);
  if (repairedContent === content) {
    return {
      doc: null,
      parseErrorText: initial.parseErrorText,
      recovered: false,
    };
  }

  const repaired = parseXmlDocument(repairedContent);
  if (repaired.doc) {
    return {
      doc: repaired.doc,
      parseErrorText: null,
      recovered: true,
    };
  }

  return {
    doc: null,
    parseErrorText: repaired.parseErrorText ?? initial.parseErrorText,
    recovered: false,
  };
}

export function parseNumbers(str: string | null): number[] {
  if (!str) return [];

  return str
    .trim()
    .split(/\s+/)
    .map((segment) => {
      const value = parseFloat(segment);
      return isNaN(value) ? 0 : value;
    });
}

export function parseCompilerSettings(doc: Document): MJCFCompilerSettings {
  // MuJoCo accepts multiple <compiler> blocks (common with <include> files) and
  // merges them in document order: later blocks override only attributes they set.
  const compilers = Array.from(doc.querySelectorAll('compiler'));

  // MuJoCo default when not explicitly set.
  let angleAttr = 'degree';
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;
  let eulerSequence = 'xyz';
  let autolimits = false;
  let fitaabb = false;
  let inertiafromgeom: 'false' | 'true' | 'auto' = 'auto';
  let inertiagrouprange: [number, number] | undefined;
  let boundinertia: number | undefined;

  for (const compiler of compilers) {
    const rawAngle = compiler.getAttribute('angle');
    if (rawAngle) {
      angleAttr = rawAngle.toLowerCase();
    }

    const rawAssetdir = compiler.getAttribute('assetdir');
    if (rawAssetdir !== null) {
      assetdir = rawAssetdir;
    }

    const rawMeshdir = compiler.getAttribute('meshdir');
    if (rawMeshdir !== null) {
      meshdir = rawMeshdir;
    }

    const rawTexturedir = compiler.getAttribute('texturedir');
    if (rawTexturedir !== null) {
      texturedir = rawTexturedir;
    }

    const rawEulerSequence = compiler.getAttribute('eulerseq');
    if (rawEulerSequence) {
      eulerSequence = rawEulerSequence;
    }

    const rawAutolimits = compiler.getAttribute('autolimits');
    if (rawAutolimits !== null) {
      autolimits = rawAutolimits.trim().toLowerCase() === 'true';
    }

    const rawFitAabb = compiler.getAttribute('fitaabb');
    if (rawFitAabb !== null) {
      fitaabb = rawFitAabb.trim().toLowerCase() === 'true';
    }

    const rawInertiaFromGeom = compiler.getAttribute('inertiafromgeom');
    if (rawInertiaFromGeom) {
      const normalizedInertiaFromGeom = rawInertiaFromGeom.trim().toLowerCase();
      if (
        normalizedInertiaFromGeom === 'true' ||
        normalizedInertiaFromGeom === 'false' ||
        normalizedInertiaFromGeom === 'auto'
      ) {
        inertiafromgeom = normalizedInertiaFromGeom;
      }
    }

    const rawInertiaGroupRange = parseNumbers(compiler.getAttribute('inertiagrouprange'));
    if (rawInertiaGroupRange.length >= 2) {
      inertiagrouprange = [rawInertiaGroupRange[0] ?? 0, rawInertiaGroupRange[1] ?? 0];
    }

    const rawBoundInertia = compiler.getAttribute('boundinertia');
    if (rawBoundInertia !== null) {
      const parsedBoundInertia = parseFloat(rawBoundInertia);
      boundinertia = Number.isFinite(parsedBoundInertia) ? parsedBoundInertia : undefined;
    }
  }

  const effectiveMeshdir = meshdir ?? assetdir;
  const effectiveTexturedir = texturedir ?? assetdir;

  return {
    angleUnit: angleAttr === 'degree' ? 'degree' : 'radian',
    assetdir,
    meshdir: effectiveMeshdir,
    texturedir: effectiveTexturedir,
    eulerSequence,
    autolimits,
    fitaabb,
    inertiafromgeom,
    inertiagrouprange,
    boundinertia,
  };
}

function normalizeAngleUnit(value: string | null | undefined): 'radian' | 'degree' | null {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase() === 'degree' ? 'degree' : 'radian';
}

export function resolveCompilerSettingsForElement(
  element: Element | null | undefined,
  fallback: MJCFCompilerSettings,
): MJCFCompilerSettings {
  if (!element) {
    return fallback;
  }

  let current: Element | null = element;
  while (current) {
    const scopedAngleUnit = normalizeAngleUnit(
      current.getAttribute(MJCF_COMPILER_ANGLE_SCOPE_ATTR),
    );
    const scopedEulerSequence = current.getAttribute(MJCF_COMPILER_EULERSEQ_SCOPE_ATTR)?.trim();
    if (scopedAngleUnit || scopedEulerSequence) {
      return {
        ...fallback,
        angleUnit: scopedAngleUnit || fallback.angleUnit,
        eulerSequence: scopedEulerSequence || fallback.eulerSequence,
      };
    }

    current = current.parentElement;
  }

  return fallback;
}

function normalizeEulerSequence(sequence: string | undefined): string {
  const normalized = (sequence || 'xyz').trim();
  if (normalized.length !== 3) {
    return 'xyz';
  }

  if (
    [...normalized]
      .map((axis) => axis.toLowerCase())
      .sort()
      .join('') !== 'xyz'
  ) {
    return 'xyz';
  }

  return normalized;
}

function pickOrthogonalUnitVector(input: THREE.Vector3): THREE.Vector3 {
  const absolute = {
    x: Math.abs(input.x),
    y: Math.abs(input.y),
    z: Math.abs(input.z),
  };

  const basis =
    absolute.x <= absolute.y && absolute.x <= absolute.z
      ? new THREE.Vector3(1, 0, 0)
      : absolute.y <= absolute.z
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

  return basis.sub(input.clone().multiplyScalar(basis.dot(input))).normalize();
}

function convertAngle(value: number, angleUnit: 'radian' | 'degree'): number {
  return angleUnit === 'degree' ? (value * Math.PI) / 180 : value;
}

function makeQuaternionFromBasis(
  xAxis: { x: number; y: number; z: number },
  yAxis: { x: number; y: number; z: number },
  zAxis: { x: number; y: number; z: number },
): [number, number, number, number] {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z),
    new THREE.Vector3(yAxis.x, yAxis.y, yAxis.z),
    new THREE.Vector3(zAxis.x, zAxis.y, zAxis.z),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

function normalizeVector3OrNull(values: number[] | null): THREE.Vector3 | null {
  if (!values || values.length < 3) {
    return null;
  }

  const vector = new THREE.Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  if (vector.lengthSq() <= 1e-12) {
    return null;
  }

  return vector.normalize();
}

function quaternionFromAxisAngle(
  values: number[] | null,
  angleUnit: 'radian' | 'degree',
): [number, number, number, number] | undefined {
  if (!values || values.length < 4) {
    return undefined;
  }

  const axis = normalizeVector3OrNull(values);
  if (!axis) {
    return [1, 0, 0, 0];
  }

  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    axis,
    convertAngle(values[3] ?? 0, angleUnit),
  );
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

function quaternionFromEuler(
  values: number[] | null,
  settings: MJCFCompilerSettings,
): [number, number, number, number] | undefined {
  if (!values || values.length < 3) {
    return undefined;
  }

  const rawSequence = normalizeEulerSequence(settings.eulerSequence);
  const isExtrinsic = rawSequence === rawSequence.toUpperCase();
  const sequence = isExtrinsic
    ? rawSequence.toLowerCase().split('').reverse().join('')
    : rawSequence.toLowerCase();
  const orderedValues = isExtrinsic ? [...values].slice(0, 3).reverse() : values;
  const angleByAxis = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < 3; index += 1) {
    const axis = sequence[index]?.toLowerCase() as 'x' | 'y' | 'z';
    angleByAxis[axis] = convertAngle(orderedValues[index] ?? 0, settings.angleUnit);
  }

  const euler = new THREE.Euler(
    angleByAxis.x,
    angleByAxis.y,
    angleByAxis.z,
    sequence.toUpperCase() as THREE.EulerOrder,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler).normalize();
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

function quaternionFromXYAxes(
  values: number[] | null,
): [number, number, number, number] | undefined {
  if (!values || values.length < 6) {
    return undefined;
  }

  const xAxis = normalizeVector3OrNull(values.slice(0, 3));
  if (!xAxis) {
    return undefined;
  }

  const ySeed = new THREE.Vector3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0);
  const orthogonalY = ySeed.sub(xAxis.clone().multiplyScalar(ySeed.dot(xAxis)));
  const yAxis =
    orthogonalY.lengthSq() > 1e-12 ? orthogonalY.normalize() : pickOrthogonalUnitVector(xAxis);
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const correctedY = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  return makeQuaternionFromBasis(xAxis, correctedY, zAxis);
}

function quaternionFromZAxis(
  values: number[] | null,
): [number, number, number, number] | undefined {
  const zAxis = normalizeVector3OrNull(values);
  if (!zAxis) {
    return undefined;
  }

  const helper =
    Math.abs(zAxis.z) < 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(helper, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  return makeQuaternionFromBasis(xAxis, yAxis, zAxis);
}

export function parseOrientationAsQuat(
  attributes: {
    quat?: string | null;
    axisangle?: string | null;
    xyaxes?: string | null;
    zaxis?: string | null;
    euler?: string | null;
  },
  settings: MJCFCompilerSettings,
): [number, number, number, number] | undefined {
  return (
    parseQuatAsTuple(attributes.quat || null) ||
    quaternionFromAxisAngle(parseNumbers(attributes.axisangle || null), settings.angleUnit) ||
    quaternionFromXYAxes(parseNumbers(attributes.xyaxes || null)) ||
    quaternionFromZAxis(parseNumbers(attributes.zaxis || null)) ||
    quaternionFromEuler(parseNumbers(attributes.euler || null), settings)
  );
}

export function parsePosAsTuple(str: string | null): [number, number, number] {
  const nums = parseNumbers(str);

  return [
    nums.length > 0 ? nums[0] : 0,
    nums.length > 1 ? nums[1] : 0,
    nums.length > 2 ? nums[2] : 0,
  ];
}

export function parsePosAsObject(str: string | null): MJCFPosition {
  const [x, y, z] = parsePosAsTuple(str);
  return { x, y, z };
}

export function parseQuatAsTuple(str: string | null): [number, number, number, number] | undefined {
  const nums = parseNumbers(str);
  if (nums.length < 4) return undefined;

  const w = nums[0];
  const x = nums[1];
  const y = nums[2];
  const z = nums[3];
  const length = Math.hypot(w, x, y, z);

  if (length <= 1e-8) {
    return [1, 0, 0, 0];
  }

  return [w / length, x / length, y / length, z / length];
}

export function parseQuatAsObject(str: string | null): MJCFQuaternion | undefined {
  const quat = parseQuatAsTuple(str);
  if (!quat) return undefined;

  const [w, x, y, z] = quat;
  return { w, x, y, z };
}

function createEmptyDefaults(): MJCFElementDefaults {
  return {
    body: {},
    geom: {},
    joint: {},
    inertial: {},
    mesh: {},
    material: {},
    texture: {},
    site: {},
    tendon: {},
    motor: {},
    position: {},
    velocity: {},
    intvelocity: {},
    general: {},
    damper: {},
    muscle: {},
    adhesion: {},
  };
}

function cloneDefaults(defaults: MJCFElementDefaults): MJCFElementDefaults {
  return {
    body: { ...defaults.body },
    geom: { ...defaults.geom },
    joint: { ...defaults.joint },
    inertial: { ...defaults.inertial },
    mesh: { ...defaults.mesh },
    material: { ...defaults.material },
    texture: { ...defaults.texture },
    site: { ...defaults.site },
    tendon: { ...defaults.tendon },
    motor: { ...defaults.motor },
    position: { ...defaults.position },
    velocity: { ...defaults.velocity },
    intvelocity: { ...defaults.intvelocity },
    general: { ...defaults.general },
    damper: { ...defaults.damper },
    muscle: { ...defaults.muscle },
    adhesion: { ...defaults.adhesion },
  };
}

function mergeDefaults(
  base: MJCFElementDefaults,
  override: Partial<MJCFElementDefaults>,
): MJCFElementDefaults {
  return {
    body: { ...base.body, ...(override.body || {}) },
    geom: { ...base.geom, ...(override.geom || {}) },
    joint: { ...base.joint, ...(override.joint || {}) },
    inertial: { ...base.inertial, ...(override.inertial || {}) },
    mesh: { ...base.mesh, ...(override.mesh || {}) },
    material: { ...base.material, ...(override.material || {}) },
    texture: { ...base.texture, ...(override.texture || {}) },
    site: { ...base.site, ...(override.site || {}) },
    tendon: { ...base.tendon, ...(override.tendon || {}) },
    motor: { ...base.motor, ...(override.motor || {}) },
    position: { ...base.position, ...(override.position || {}) },
    velocity: { ...base.velocity, ...(override.velocity || {}) },
    intvelocity: { ...base.intvelocity, ...(override.intvelocity || {}) },
    general: { ...base.general, ...(override.general || {}) },
    damper: { ...base.damper, ...(override.damper || {}) },
    muscle: { ...base.muscle, ...(override.muscle || {}) },
    adhesion: { ...base.adhesion, ...(override.adhesion || {}) },
  };
}

function collectDirectAttributes(element: Element, selector: MJCFElementType): MJCFAttributeMap {
  const directChild = element.querySelector(`:scope > ${selector}`);
  if (!directChild) {
    return {};
  }

  const attributes: MJCFAttributeMap = {};
  for (const attribute of Array.from(directChild.attributes)) {
    attributes[attribute.name] = attribute.value;
  }

  return attributes;
}

function collectDefaultAttributes(defaultEl: Element): Partial<MJCFElementDefaults> {
  return {
    body: collectDirectAttributes(defaultEl, 'body'),
    geom: collectDirectAttributes(defaultEl, 'geom'),
    joint: collectDirectAttributes(defaultEl, 'joint'),
    inertial: collectDirectAttributes(defaultEl, 'inertial'),
    mesh: collectDirectAttributes(defaultEl, 'mesh'),
    material: collectDirectAttributes(defaultEl, 'material'),
    texture: collectDirectAttributes(defaultEl, 'texture'),
    site: collectDirectAttributes(defaultEl, 'site'),
    tendon: collectDirectAttributes(defaultEl, 'tendon'),
    motor: collectDirectAttributes(defaultEl, 'motor'),
    position: collectDirectAttributes(defaultEl, 'position'),
    velocity: collectDirectAttributes(defaultEl, 'velocity'),
    intvelocity: collectDirectAttributes(defaultEl, 'intvelocity'),
    general: collectDirectAttributes(defaultEl, 'general'),
    damper: collectDirectAttributes(defaultEl, 'damper'),
    muscle: collectDirectAttributes(defaultEl, 'muscle'),
    adhesion: collectDirectAttributes(defaultEl, 'adhesion'),
  };
}

function registerDefaultClass(
  registry: MJCFDefaultsRegistry,
  className: string,
  qname: string,
  parentQName: string | undefined,
  defaults: MJCFElementDefaults,
): void {
  const entry: MJCFDefaultClassEntry = {
    qname,
    className,
    parentQName,
    defaults,
    children: [],
  };

  registry.classesByQName.set(qname, entry);

  const qnames = registry.qnamesByClassName.get(className) || [];
  qnames.push(qname);
  registry.qnamesByClassName.set(className, qnames);

  if (parentQName) {
    const parent = registry.classesByQName.get(parentQName);
    if (parent) {
      parent.children.push(qname);
    }
  }
}

function visitDefaultElement(
  defaultEl: Element,
  registry: MJCFDefaultsRegistry,
  scopeDefaults: MJCFElementDefaults,
  activeNamedQName?: string,
): MJCFElementDefaults {
  const mergedDefaults = mergeDefaults(scopeDefaults, collectDefaultAttributes(defaultEl));
  const className = defaultEl.getAttribute('class')?.trim();

  let nextNamedQName = activeNamedQName;
  if (className) {
    nextNamedQName = activeNamedQName ? `${activeNamedQName}/${className}` : className;
    registerDefaultClass(
      registry,
      className,
      nextNamedQName,
      activeNamedQName,
      cloneDefaults(mergedDefaults),
    );
  }

  const childDefaults = cloneDefaults(mergedDefaults);
  const childDefaultElements = defaultEl.querySelectorAll(':scope > default');
  childDefaultElements.forEach((childDefaultEl) => {
    visitDefaultElement(childDefaultEl, registry, childDefaults, nextNamedQName);
  });

  return mergedDefaults;
}

export function parseMJCFDefaults(doc: Document): MJCFDefaultsRegistry {
  const registry: MJCFDefaultsRegistry = {
    root: createEmptyDefaults(),
    classesByQName: new Map<string, MJCFDefaultClassEntry>(),
    qnamesByClassName: new Map<string, string[]>(),
  };

  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return registry;
  }

  const topLevelDefaults = mujocoEl.querySelectorAll(':scope > default');
  topLevelDefaults.forEach((defaultEl) => {
    const mergedDefaults = visitDefaultElement(defaultEl, registry, registry.root, undefined);
    const className = defaultEl.getAttribute('class')?.trim();

    // MuJoCo's implicit global defaults class is `main`. Some menagerie models
    // express the active root defaults via `<default class="main">` instead of
    // an unnamed top-level `<default>`, so we need to seed `registry.root`
    // from both representations.
    if (!className || className === 'main') {
      registry.root = mergeDefaults(registry.root, mergedDefaults);
    }
  });

  return registry;
}

function findDescendantClassQName(
  registry: MJCFDefaultsRegistry,
  rootQName: string,
  className: string,
): string | undefined {
  const root = registry.classesByQName.get(rootQName);
  if (!root) {
    return undefined;
  }

  for (const childQName of root.children) {
    const child = registry.classesByQName.get(childQName);
    if (!child) {
      continue;
    }

    if (child.className === className) {
      return child.qname;
    }

    const nestedMatch = findDescendantClassQName(registry, childQName, className);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

export function resolveDefaultClassQName(
  registry: MJCFDefaultsRegistry,
  className: string | null | undefined,
  activeClassQName?: string,
): string | undefined {
  const normalizedClassName = className?.trim();
  if (!normalizedClassName) {
    return activeClassQName;
  }

  if (activeClassQName) {
    const activeEntry = registry.classesByQName.get(activeClassQName);
    if (activeEntry?.className === normalizedClassName) {
      return activeClassQName;
    }

    const descendantMatch = findDescendantClassQName(
      registry,
      activeClassQName,
      normalizedClassName,
    );
    if (descendantMatch) {
      return descendantMatch;
    }
  }

  const qnames = registry.qnamesByClassName.get(normalizedClassName);
  return qnames?.[0];
}

export function resolveElementAttributes(
  registry: MJCFDefaultsRegistry,
  elementType: MJCFElementType,
  element: Element,
  activeClassQName?: string,
): MJCFAttributeMap {
  const resolvedAttributes: MJCFAttributeMap = {
    ...registry.root[elementType],
  };

  const explicitClassName = element.getAttribute('class')?.trim();
  const explicitClassQName = explicitClassName
    ? resolveDefaultClassQName(registry, explicitClassName, activeClassQName)
    : undefined;
  const classQNameToApply = explicitClassQName || activeClassQName;

  if (classQNameToApply) {
    const classEntry = registry.classesByQName.get(classQNameToApply);
    if (classEntry) {
      Object.assign(resolvedAttributes, classEntry.defaults[elementType]);
    }
  }

  for (const attribute of Array.from(element.attributes)) {
    resolvedAttributes[attribute.name] = attribute.value;
  }

  return resolvedAttributes;
}

export function parseMeshAssets(
  doc: Document,
  settings?: MJCFCompilerSettings,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFMesh> {
  const meshMap = new Map<string, MJCFMesh>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return meshMap;
  }

  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  let meshIndex = 0;
  assetSections.forEach((assetEl) => {
    const meshes = assetEl.querySelectorAll(':scope > mesh');
    meshes.forEach((meshEl) => {
      const meshAttrs = resolveElementAttributes(defaults, 'mesh', meshEl);
      let name = meshEl.getAttribute('name') || meshAttrs.name;
      let file = meshEl.getAttribute('file') || meshAttrs.file;
      const vertex = meshEl.getAttribute('vertex') || meshAttrs.vertex;
      const vertices = parseNumbers(vertex || null);
      const hasInlineVertices = vertices.length >= 9;

      if (!file && !hasInlineVertices) {
        meshIndex += 1;
        return;
      }

      if (file && settings?.meshdir && !file.startsWith('/') && !file.includes(':')) {
        const prefix = settings.meshdir.endsWith('/') ? settings.meshdir : `${settings.meshdir}/`;
        file = `${prefix}${file}`;
      }

      if (!name) {
        name = file ? deriveAssetName(file, 'mesh', meshIndex) : `mesh_${meshIndex}`;
      }

      const scale = parseNumbers(meshAttrs.scale || null);
      const refpos = parseNumbers(meshAttrs.refpos || null);
      const refquat = parseQuatAsTuple(meshAttrs.refquat || null);
      const inertiaAttr = (meshAttrs.inertia || '').trim().toLowerCase();
      const inertia =
        inertiaAttr === 'shell' ||
        inertiaAttr === 'exact' ||
        inertiaAttr === 'convex' ||
        inertiaAttr === 'legacy'
          ? inertiaAttr
          : undefined;
      meshMap.set(name, {
        name,
        file: file || undefined,
        vertices: hasInlineVertices ? vertices : undefined,
        scale: scale.length >= 3 ? scale : undefined,
        refpos: refpos.length >= 3 ? [refpos[0] ?? 0, refpos[1] ?? 0, refpos[2] ?? 0] : undefined,
        refquat,
        inertia,
      });

      meshIndex += 1;
    });
  });

  return meshMap;
}

function deriveAssetName(filePath: string, fallbackPrefix: string, assetIndex: number): string {
  const fileName = filePath.split('/').pop()?.split('\\').pop() || '';
  const lastDotIndex = fileName.lastIndexOf('.');
  return (
    (lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName) ||
    `${fallbackPrefix}_${assetIndex}`
  );
}

export function parseTextureAssets(
  doc: Document,
  settings?: MJCFCompilerSettings,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFTexture> {
  const textureMap = new Map<string, MJCFTexture>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return textureMap;
  }

  let textureIndex = 0;
  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const textures = assetEl.querySelectorAll(':scope > texture');
    textures.forEach((textureEl) => {
      const textureAttrs = resolveElementAttributes(defaults, 'texture', textureEl);
      let file = textureEl.getAttribute('file') || textureAttrs.file;
      const builtin = textureEl.getAttribute('builtin') || textureAttrs.builtin || undefined;
      const type = textureEl.getAttribute('type') || textureAttrs.type || undefined;
      const explicitName = textureEl.getAttribute('name') || textureAttrs.name || undefined;

      if (file && settings?.texturedir && !file.startsWith('/') && !file.includes(':')) {
        const prefix = settings.texturedir.endsWith('/')
          ? settings.texturedir
          : `${settings.texturedir}/`;
        file = `${prefix}${file}`;
      }

      const name =
        explicitName || (file ? deriveAssetName(file, 'texture', textureIndex) : undefined);
      if (!name) {
        textureIndex += 1;
        return;
      }

      textureMap.set(name, {
        name,
        file: file || undefined,
        type,
        builtin,
      });

      textureIndex += 1;
    });
  });

  return textureMap;
}

export function parseHfieldAssets(doc: Document): Map<string, MJCFHfield> {
  const hfieldMap = new Map<string, MJCFHfield>();
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return hfieldMap;
  }

  let hfieldIndex = 0;
  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const hfields = assetEl.querySelectorAll(':scope > hfield');
    hfields.forEach((hfieldEl) => {
      const name = hfieldEl.getAttribute('name') || `hfield_${hfieldIndex}`;
      const file = hfieldEl.getAttribute('file') || undefined;
      const contentType = hfieldEl.getAttribute('content_type') || undefined;
      const nrowAttr = hfieldEl.getAttribute('nrow');
      const ncolAttr = hfieldEl.getAttribute('ncol');
      const size = parseNumbers(hfieldEl.getAttribute('size'));
      const elevation = parseNumbers(hfieldEl.getAttribute('elevation'));

      hfieldMap.set(name, {
        name,
        file,
        contentType,
        nrow: nrowAttr != null ? parseInt(nrowAttr, 10) : undefined,
        ncol: ncolAttr != null ? parseInt(ncolAttr, 10) : undefined,
        size:
          size.length >= 4 ? [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0, size[3] ?? 0] : undefined,
        elevation: elevation.length > 0 ? elevation : undefined,
      });

      hfieldIndex += 1;
    });
  });

  return hfieldMap;
}

export function parseMaterialAssets(
  doc: Document,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFMaterial> {
  const materialMap = new Map<string, MJCFMaterial>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return materialMap;
  }

  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const materials = assetEl.querySelectorAll(':scope > material');
    materials.forEach((materialEl) => {
      const materialAttrs = resolveElementAttributes(defaults, 'material', materialEl);
      const name = materialEl.getAttribute('name') || materialAttrs.name;
      if (!name) return;

      const rgba = parseNumbers(materialEl.getAttribute('rgba') || materialAttrs.rgba || null);
      const shininess = materialEl.getAttribute('shininess') || materialAttrs.shininess;
      const specular = materialEl.getAttribute('specular') || materialAttrs.specular;
      const reflectance = materialEl.getAttribute('reflectance') || materialAttrs.reflectance;
      const emission = materialEl.getAttribute('emission') || materialAttrs.emission;
      const texrepeat = parseNumbers(
        materialEl.getAttribute('texrepeat') || materialAttrs.texrepeat || null,
      );
      const texuniform = materialEl.getAttribute('texuniform') || materialAttrs.texuniform;
      const texture = materialEl.getAttribute('texture') || materialAttrs.texture;

      materialMap.set(name, {
        name,
        rgba: rgba.length >= 3 ? rgba : undefined,
        shininess: shininess != null ? parseFloat(shininess) : undefined,
        specular: specular != null ? parseFloat(specular) : undefined,
        reflectance: reflectance != null ? parseFloat(reflectance) : undefined,
        emission: emission != null ? parseFloat(emission) : undefined,
        texture: texture || undefined,
        texrepeat: texrepeat.length >= 2 ? texrepeat : undefined,
        texuniform:
          texuniform != null ? ['true', '1'].includes(texuniform.toLowerCase()) : undefined,
      });
    });
  });

  return materialMap;
}
