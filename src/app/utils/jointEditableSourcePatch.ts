import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import { JointType, type UrdfJoint } from '@/types';

interface JointLimitSourcePatchOptions {
  sourceContent: string;
  jointName: string;
  jointType: UrdfJoint['type'];
  limit: NonNullable<UrdfJoint['limit']>;
}

interface XmlElementOccurrence {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  rawOpenTag: string;
}

const DEFAULT_INDENT_UNIT = '  ';
const XML_NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;
const USD_NUMERIC_VALUE_RE = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildXmlTagRegExp(tagName: string): RegExp {
  return new RegExp(`<\\s*(\\/?)${escapeRegExp(tagName)}\\b[^>]*>`, 'gi');
}

function findNamedXmlElement(
  sourceContent: string,
  tagName: string,
  name: string,
): XmlElementOccurrence | null {
  const tagRe = buildXmlTagRegExp(tagName);
  const stack: Array<{
    start: number;
    openEnd: number;
    rawOpenTag: string;
    matchesName: boolean;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    const isClosingTag = match[1] === '/';

    if (isClosingTag) {
      const openTag = stack.pop();
      if (!openTag) {
        continue;
      }
      if (openTag.matchesName) {
        return {
          start: openTag.start,
          openEnd: openTag.openEnd,
          closeStart: match.index,
          end: match.index + rawTag.length,
          selfClosing: false,
          rawOpenTag: openTag.rawOpenTag,
        };
      }
      continue;
    }

    const isSelfClosing = /\/\s*>$/.test(rawTag);
    const matchedName = XML_NAME_ATTR_RE.exec(rawTag)?.[2]?.trim() ?? '';
    if (isSelfClosing && matchedName === name) {
      return {
        start: match.index,
        openEnd: match.index + rawTag.length,
        closeStart: match.index + rawTag.length,
        end: match.index + rawTag.length,
        selfClosing: true,
        rawOpenTag: rawTag,
      };
    }

    if (!isSelfClosing) {
      stack.push({
        start: match.index,
        openEnd: match.index + rawTag.length,
        rawOpenTag: rawTag,
        matchesName: matchedName === name,
      });
    }
  }

  return null;
}

function findFirstXmlElement(sourceContent: string, tagName: string): XmlElementOccurrence | null {
  const tagRe = buildXmlTagRegExp(tagName);
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (match[1] === '/') {
      continue;
    }

    const start = match.index;
    const openEnd = start + rawTag.length;
    const selfClosing = /\/\s*>$/.test(rawTag);
    if (selfClosing) {
      return {
        start,
        openEnd,
        closeStart: openEnd,
        end: openEnd,
        selfClosing: true,
        rawOpenTag: rawTag,
      };
    }

    const closingTag = `</${tagName}>`;
    const closeStart = sourceContent.indexOf(closingTag, openEnd);
    if (closeStart < 0) {
      return null;
    }

    return {
      start,
      openEnd,
      closeStart,
      end: closeStart + closingTag.length,
      selfClosing: false,
      rawOpenTag: rawTag,
    };
  }

  return null;
}

function getPreferredNewline(sourceContent: string): string {
  return sourceContent.includes('\r\n') ? '\r\n' : '\n';
}

function getLineStart(sourceContent: string, index: number): number {
  let cursor = index;
  while (cursor > 0) {
    const previousChar = sourceContent[cursor - 1];
    if (previousChar === '\n' || previousChar === '\r') {
      break;
    }
    cursor -= 1;
  }
  return cursor;
}

function getIndentAt(sourceContent: string, index: number): string {
  const lineStart = getLineStart(sourceContent, index);
  const match = sourceContent.slice(lineStart, index).match(/^[ \t]*/);
  return match?.[0] ?? '';
}

function formatScalar(value: number): string {
  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS) || '0';
}

function replaceOrRemoveXmlAttribute(
  rawTag: string,
  attributeName: string,
  nextValue: string | null,
): string {
  const attrRe = new RegExp(`\\s+${escapeRegExp(attributeName)}\\s*=\\s*(["']).*?\\1`, 'i');
  if (nextValue == null) {
    return rawTag.replace(attrRe, '');
  }

  if (attrRe.test(rawTag)) {
    return rawTag.replace(
      new RegExp(`(\\s+${escapeRegExp(attributeName)}\\s*=\\s*)(["']).*?\\2`, 'i'),
      `$1"${nextValue}"`,
    );
  }

  return rawTag.replace(/(\s*\/?>)$/, ` ${attributeName}="${nextValue}"$1`);
}

function shouldEmitUrdfPositionLimits(jointType: UrdfJoint['type']): boolean {
  return jointType === JointType.REVOLUTE || jointType === JointType.PRISMATIC;
}

function shouldEmitUrdfEffortVelocityLimits(jointType: UrdfJoint['type']): boolean {
  return (
    jointType === JointType.REVOLUTE ||
    jointType === JointType.PRISMATIC ||
    jointType === JointType.CONTINUOUS
  );
}

function buildPatchedUrdfLimitTag(
  rawLimitTag: string,
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
): string {
  let nextTag = rawLimitTag;
  nextTag = replaceOrRemoveXmlAttribute(
    nextTag,
    'lower',
    shouldEmitUrdfPositionLimits(jointType) ? formatScalar(limit.lower) : null,
  );
  nextTag = replaceOrRemoveXmlAttribute(
    nextTag,
    'upper',
    shouldEmitUrdfPositionLimits(jointType) ? formatScalar(limit.upper) : null,
  );
  nextTag = replaceOrRemoveXmlAttribute(
    nextTag,
    'effort',
    shouldEmitUrdfEffortVelocityLimits(jointType) ? formatScalar(limit.effort) : null,
  );
  nextTag = replaceOrRemoveXmlAttribute(
    nextTag,
    'velocity',
    shouldEmitUrdfEffortVelocityLimits(jointType) ? formatScalar(limit.velocity) : null,
  );
  return nextTag;
}

function buildNewUrdfLimitTag(
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
): string {
  const attributes: string[] = [];
  if (shouldEmitUrdfPositionLimits(jointType)) {
    attributes.push(`lower="${formatScalar(limit.lower)}"`);
    attributes.push(`upper="${formatScalar(limit.upper)}"`);
  }
  if (shouldEmitUrdfEffortVelocityLimits(jointType)) {
    attributes.push(`effort="${formatScalar(limit.effort)}"`);
    attributes.push(`velocity="${formatScalar(limit.velocity)}"`);
  }
  return `<limit ${attributes.join(' ')} />`;
}

function isAngularJointType(jointType: UrdfJoint['type']): boolean {
  return jointType === JointType.REVOLUTE || jointType === JointType.CONTINUOUS;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function findMatchingUsdBrace(sourceContent: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < sourceContent.length; index += 1) {
    const char = sourceContent[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findUsdJointBlock(
  sourceContent: string,
  jointName: string,
): { start: number; end: number; content: string } | null {
  const jointBlockRe = new RegExp(
    `\\b(?:def\\s+[A-Za-z_][\\w:]*|over)\\s+"${escapeRegExp(
      jointName,
    )}"(?:\\s*\\([^{}]*?\\))?\\s*\\{`,
    'g',
  );
  const match = jointBlockRe.exec(sourceContent);
  if (!match) {
    return null;
  }

  const openBraceIndex = sourceContent.indexOf('{', match.index);
  if (openBraceIndex < 0) {
    return null;
  }

  const closeBraceIndex = findMatchingUsdBrace(sourceContent, openBraceIndex);
  if (closeBraceIndex < 0) {
    return null;
  }

  return {
    start: match.index,
    end: closeBraceIndex + 1,
    content: sourceContent.slice(match.index, closeBraceIndex + 1),
  };
}

function replaceUsdNumericProperty(
  blockContent: string,
  propertyPattern: string,
  nextValue: number,
): { content: string; didChange: boolean } {
  const propertyRe = new RegExp(
    `([ \\t]*(?:float|double|half)\\s+${propertyPattern}\\s*=\\s*)(${USD_NUMERIC_VALUE_RE})(\\s*(?:#.*)?)`,
    'm',
  );
  if (!propertyRe.test(blockContent)) {
    return { content: blockContent, didChange: false };
  }

  return {
    content: blockContent.replace(propertyRe, `$1${formatScalar(nextValue)}$3`),
    didChange: true,
  };
}

export function patchUrdfJointLimitInSource({
  sourceContent,
  jointName,
  jointType,
  limit,
}: JointLimitSourcePatchOptions): string {
  const jointOccurrence = findNamedXmlElement(sourceContent, 'joint', jointName);
  if (!jointOccurrence) {
    throw new Error(`Failed to locate URDF <joint name="${jointName}">.`);
  }

  const jointContent = sourceContent.slice(jointOccurrence.start, jointOccurrence.end);
  const limitOccurrence = findFirstXmlElement(jointContent, 'limit');
  if (limitOccurrence) {
    const limitStart = jointOccurrence.start + limitOccurrence.start;
    const nextLimitTag = buildPatchedUrdfLimitTag(limitOccurrence.rawOpenTag, jointType, limit);
    return (
      sourceContent.slice(0, limitStart) +
      nextLimitTag +
      sourceContent.slice(limitStart + limitOccurrence.rawOpenTag.length)
    );
  }

  const newline = getPreferredNewline(sourceContent);
  if (jointOccurrence.selfClosing) {
    const jointIndent = getIndentAt(sourceContent, jointOccurrence.start);
    const childIndent = `${jointIndent}${DEFAULT_INDENT_UNIT}`;
    const expandedJointTag = jointOccurrence.rawOpenTag.replace(/\/\s*>$/, '>');
    return (
      sourceContent.slice(0, jointOccurrence.start) +
      `${expandedJointTag}${newline}${childIndent}${buildNewUrdfLimitTag(
        jointType,
        limit,
      )}${newline}${jointIndent}</joint>` +
      sourceContent.slice(jointOccurrence.end)
    );
  }

  const closeLineStart = getLineStart(sourceContent, jointOccurrence.closeStart);
  const closeIndent = sourceContent.slice(closeLineStart, jointOccurrence.closeStart);
  const childIndent = `${closeIndent}${DEFAULT_INDENT_UNIT}`;
  return (
    sourceContent.slice(0, closeLineStart) +
    `${childIndent}${buildNewUrdfLimitTag(jointType, limit)}${newline}${closeIndent}` +
    sourceContent.slice(jointOccurrence.closeStart)
  );
}

export function patchUsdJointLimitInSource({
  sourceContent,
  jointName,
  jointType,
  limit,
}: JointLimitSourcePatchOptions): string {
  const jointBlock = findUsdJointBlock(sourceContent, jointName);
  if (!jointBlock) {
    throw new Error(`Failed to locate USD joint block "${jointName}".`);
  }

  const isAngularJoint = isAngularJointType(jointType);
  let nextBlockContent = jointBlock.content;
  let didChange = false;

  const lowerResult = replaceUsdNumericProperty(
    nextBlockContent,
    'physics:lowerLimit',
    isAngularJoint ? radiansToDegrees(limit.lower) : limit.lower,
  );
  nextBlockContent = lowerResult.content;
  didChange = didChange || lowerResult.didChange;

  const upperResult = replaceUsdNumericProperty(
    nextBlockContent,
    'physics:upperLimit',
    isAngularJoint ? radiansToDegrees(limit.upper) : limit.upper,
  );
  nextBlockContent = upperResult.content;
  didChange = didChange || upperResult.didChange;

  const effortResult = replaceUsdNumericProperty(
    nextBlockContent,
    'drive:[^=\\s]+:physics:maxForce',
    limit.effort,
  );
  nextBlockContent = effortResult.content;
  didChange = didChange || effortResult.didChange;

  const velocityResult = replaceUsdNumericProperty(
    nextBlockContent,
    'physxJoint:maxJointVelocity',
    isAngularJoint ? radiansToDegrees(limit.velocity) : limit.velocity,
  );
  nextBlockContent = velocityResult.content;
  didChange = didChange || velocityResult.didChange;

  if (!didChange) {
    throw new Error(`Failed to patch authored USD joint limits for "${jointName}".`);
  }

  return (
    sourceContent.slice(0, jointBlock.start) +
    nextBlockContent +
    sourceContent.slice(jointBlock.end)
  );
}
