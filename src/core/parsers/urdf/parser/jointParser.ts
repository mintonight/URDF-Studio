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
    let originEl = jointEl.querySelector('origin');

    // Fallback: iterate children if querySelector fails (robustness for some XML parsers)
    if (!originEl) {
      // Try children collection first
      if (jointEl.children && jointEl.children.length > 0) {
        for (let i = 0; i < jointEl.children.length; i++) {
          if (jointEl.children[i].tagName === 'origin') {
            originEl = jointEl.children[i];
            break;
          }
        }
      }
      // Fallback to childNodes (for parsers that might not support children on Elements)
      if (!originEl && jointEl.childNodes) {
        for (let i = 0; i < jointEl.childNodes.length; i++) {
          const node = jointEl.childNodes[i];
          if (node.nodeType === 1 && (node as Element).tagName === 'origin') {
            // Node.ELEMENT_NODE
            originEl = node as Element;
            break;
          }
        }
      }
    }

    const axisEl = jointEl.querySelector('axis');
    const calibrationEl = jointEl.querySelector('calibration');
    const limitEl = jointEl.querySelector('limit');
    const dynamicsEl = jointEl.querySelector('dynamics');
    const safetyControllerEl = jointEl.querySelector('safety_controller');
    const hardwareEl = jointEl.querySelector('hardware');
    const mimicEl = jointEl.querySelector('mimic');

    let hardware = {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1 as 1 | -1,
      hardwareInterface: undefined,
    };

    if (hardwareEl) {
      hardware = {
        brand: hardwareEl.querySelector('brand')?.textContent || '',
        motorType: hardwareEl.querySelector('motorType')?.textContent || 'None',
        motorId: hardwareEl.querySelector('motorId')?.textContent || '',
        motorDirection: parseInt(hardwareEl.querySelector('motorDirection')?.textContent || '1') as
          | 1
          | -1,
        armature: parseFloat(hardwareEl.querySelector('armature')?.textContent || '0'),
        hardwareInterface:
          (hardwareEl.querySelector('hardwareInterface')
            ?.textContent as JointHardwareInterface | null) || undefined,
      };
    }

    const jointType = (jointEl.getAttribute('type') as JointType) || JointType.REVOLUTE;
    const axis = AXIS_IMPORT_TYPES.has(jointType)
      ? parseVec3(axisEl?.getAttribute('xyz') || '0 0 1')
      : undefined;
    const limit =
      LIMIT_IMPORT_TYPES.has(jointType) && limitEl
        ? {
            lower: parseLimitAttribute(limitEl, 'lower'),
            upper: parseLimitAttribute(limitEl, 'upper'),
            effort: parseLimitAttribute(limitEl, 'effort'),
            velocity: parseLimitAttribute(limitEl, 'velocity'),
          }
        : undefined;
    const referencePosition = parseFloatSafe(
      calibrationEl?.getAttribute('reference_position'),
      Number.NaN,
    );
    const calibration = calibrationEl
      ? {
          ...(Number.isFinite(referencePosition) ? { referencePosition } : {}),
          ...(calibrationEl.hasAttribute('rising')
            ? { rising: parseFloatSafe(calibrationEl.getAttribute('rising'), Number.NaN) }
            : {}),
          ...(calibrationEl.hasAttribute('falling')
            ? { falling: parseFloatSafe(calibrationEl.getAttribute('falling'), Number.NaN) }
            : {}),
        }
      : undefined;
    const safetyController = safetyControllerEl
      ? {
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
                kPosition: parseFloatSafe(
                  safetyControllerEl.getAttribute('k_position'),
                  Number.NaN,
                ),
              }
            : {}),
          ...(safetyControllerEl.hasAttribute('k_velocity')
            ? {
                kVelocity: parseFloatSafe(
                  safetyControllerEl.getAttribute('k_velocity'),
                  Number.NaN,
                ),
              }
            : {}),
        }
      : undefined;

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
      hardware: hardware,
      ...(calibration && Object.keys(calibration).length > 0 ? { calibration } : {}),
      ...(safetyController && Object.keys(safetyController).length > 0 ? { safetyController } : {}),
      ...(Number.isFinite(referencePosition) ? { referencePosition } : {}),
      mimic: mimicEl?.getAttribute('joint')
        ? {
            joint: mimicEl.getAttribute('joint') || '',
            ...(mimicEl.hasAttribute('multiplier')
              ? { multiplier: parseFloatSafe(mimicEl.getAttribute('multiplier'), 1) }
              : {}),
            ...(mimicEl.hasAttribute('offset')
              ? { offset: parseFloatSafe(mimicEl.getAttribute('offset'), 0) }
              : {}),
          }
        : undefined,
    };
  });

  return joints;
};
