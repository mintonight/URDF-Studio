import { UrdfJoint, JointType, type JointHardwareInterface } from '@/types';
import { parseVec3, parseOrigin, parseFloatSafe } from './utils';

const AXIS_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const parseLimitAttribute = (limitEl: Element | null, attribute: string): number => {
  const rawValue = limitEl?.getAttribute(attribute);
  if (rawValue === null || rawValue === undefined) {
    return Number.NaN;
  }
  return parseFloatSafe(rawValue, Number.NaN);
};

const findOriginElement = (jointEl: Element): Element | null => {
  const queryResult = jointEl.querySelector('origin');
  if (queryResult) {
    return queryResult;
  }

  // Fallbacks keep parsing robust for XML DOMs with partial selector support.
  for (let index = 0; index < jointEl.children.length; index += 1) {
    const child = jointEl.children[index];
    if (child.tagName === 'origin') {
      return child;
    }
  }

  for (let index = 0; index < jointEl.childNodes.length; index += 1) {
    const node = jointEl.childNodes[index];
    if (node.nodeType === 1 && (node as Element).tagName === 'origin') {
      return node as Element;
    }
  }

  return null;
};

const parseJointHardware = (hardwareEl: Element | null): UrdfJoint['hardware'] => {
  if (!hardwareEl) {
    return {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
      hardwareInterface: undefined,
    };
  }

  return {
    brand: hardwareEl.querySelector('brand')?.textContent || '',
    motorType: hardwareEl.querySelector('motorType')?.textContent || 'None',
    motorId: hardwareEl.querySelector('motorId')?.textContent || '',
    motorDirection: parseInt(hardwareEl.querySelector('motorDirection')?.textContent || '1') as
      | 1
      | -1,
    armature: parseFloat(hardwareEl.querySelector('armature')?.textContent || '0'),
    hardwareInterface:
      (hardwareEl.querySelector('hardwareInterface')?.textContent as JointHardwareInterface | null) ||
      undefined,
  };
};

const parseJointLimit = (
  jointType: JointType,
  limitEl: Element | null,
): UrdfJoint['limit'] | undefined => {
  if (!LIMIT_IMPORT_TYPES.has(jointType) || !limitEl) {
    return undefined;
  }

  return {
    lower: parseLimitAttribute(limitEl, 'lower'),
    upper: parseLimitAttribute(limitEl, 'upper'),
    effort: parseLimitAttribute(limitEl, 'effort'),
    velocity: parseLimitAttribute(limitEl, 'velocity'),
  };
};

const parseJointCalibration = (
  calibrationEl: Element | null,
): {
  calibration?: UrdfJoint['calibration'];
  referencePosition?: number;
} => {
  const referencePosition = parseFloatSafe(
    calibrationEl?.getAttribute('reference_position'),
    Number.NaN,
  );
  if (!calibrationEl) {
    return Number.isFinite(referencePosition) ? { referencePosition } : {};
  }

  const calibration = {
    ...(Number.isFinite(referencePosition) ? { referencePosition } : {}),
    ...(calibrationEl.hasAttribute('rising')
      ? { rising: parseFloatSafe(calibrationEl.getAttribute('rising'), Number.NaN) }
      : {}),
    ...(calibrationEl.hasAttribute('falling')
      ? { falling: parseFloatSafe(calibrationEl.getAttribute('falling'), Number.NaN) }
      : {}),
  };

  return {
    ...(Object.keys(calibration).length > 0 ? { calibration } : {}),
    ...(Number.isFinite(referencePosition) ? { referencePosition } : {}),
  };
};

const parseJointSafetyController = (
  safetyControllerEl: Element | null,
): UrdfJoint['safetyController'] | undefined => {
  if (!safetyControllerEl) {
    return undefined;
  }

  const safetyController = {
    ...(safetyControllerEl.hasAttribute('soft_lower_limit')
      ? {
          softLowerLimit: parseFloatSafe(
            safetyControllerEl.getAttribute('soft_lower_limit'),
            Number.NaN,
          ),
        }
      : {}),
    ...(safetyControllerEl.hasAttribute('soft_upper_limit')
      ? {
          softUpperLimit: parseFloatSafe(
            safetyControllerEl.getAttribute('soft_upper_limit'),
            Number.NaN,
          ),
        }
      : {}),
    ...(safetyControllerEl.hasAttribute('k_position')
      ? {
          kPosition: parseFloatSafe(safetyControllerEl.getAttribute('k_position'), Number.NaN),
        }
      : {}),
    ...(safetyControllerEl.hasAttribute('k_velocity')
      ? {
          kVelocity: parseFloatSafe(safetyControllerEl.getAttribute('k_velocity'), Number.NaN),
        }
      : {}),
  };

  return Object.keys(safetyController).length > 0 ? safetyController : undefined;
};

const parseJointMimic = (mimicEl: Element | null): UrdfJoint['mimic'] | undefined => {
  if (!mimicEl) {
    return undefined;
  }

  const mimicJoint = mimicEl.getAttribute('joint');
  if (!mimicJoint) {
    return undefined;
  }

  return {
    joint: mimicJoint,
    ...(mimicEl.hasAttribute('multiplier')
      ? { multiplier: parseFloatSafe(mimicEl.getAttribute('multiplier'), 1) }
      : {}),
    ...(mimicEl.hasAttribute('offset')
      ? { offset: parseFloatSafe(mimicEl.getAttribute('offset'), 0) }
      : {}),
  };
};

export const parseJoints = (robotEl: Element): Record<string, UrdfJoint> => {
  const joints: Record<string, UrdfJoint> = {};

  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName !== 'joint') return;
    const jointEl = child;
    const jointName = jointEl.getAttribute('name');
    if (!jointName) return;
    const id = jointName;

    const parentEl = jointEl.querySelector('parent');
    const childEl = jointEl.querySelector('child');
    const originEl = findOriginElement(jointEl);

    const axisEl = jointEl.querySelector('axis');
    const calibrationEl = jointEl.querySelector('calibration');
    const limitEl = jointEl.querySelector('limit');
    const dynamicsEl = jointEl.querySelector('dynamics');
    const safetyControllerEl = jointEl.querySelector('safety_controller');
    const hardwareEl = jointEl.querySelector('hardware');
    const mimicEl = jointEl.querySelector('mimic');

    const jointType = (jointEl.getAttribute('type') as JointType) || JointType.REVOLUTE;
    const axis = AXIS_IMPORT_TYPES.has(jointType)
      ? parseVec3(axisEl?.getAttribute('xyz') || '1 0 0')
      : undefined;
    const limit = parseJointLimit(jointType, limitEl);
    const { calibration, referencePosition } = parseJointCalibration(calibrationEl);
    const safetyController = parseJointSafetyController(safetyControllerEl);

    joints[id] = {
      id,
      name: jointName,
      type: jointType,
      parentLinkId: parentEl?.getAttribute('link') || '',
      childLinkId: childEl?.getAttribute('link') || '',
      origin: parseOrigin(originEl),
      axis,
      limit,
      dynamics: {
        damping: parseFloatSafe(dynamicsEl?.getAttribute('damping'), 0),
        friction: parseFloatSafe(dynamicsEl?.getAttribute('friction'), 0),
      },
      hardware: parseJointHardware(hardwareEl),
      ...(calibration ? { calibration } : {}),
      ...(safetyController ? { safetyController } : {}),
      ...(referencePosition !== undefined ? { referencePosition } : {}),
      mimic: parseJointMimic(mimicEl),
    };
  });

  return joints;
};
