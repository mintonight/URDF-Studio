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
const XML_TAG_OR_COMMENT_RE = /<!--[\s\S]*?-->|<\s*(\/?)([A-Za-z_][\w:.-]*)\b[^>]*>/g;
const SDF_MANAGED_LIMIT_TAG_NAMES = ['lower', 'upper', 'effort', 'velocity'] as const;

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildXmlTagNamesRegExp(tagNames: string[]): RegExp {
  return new RegExp(
    `<\\s*(\\/?)(${tagNames.map(escapeRegExp).join('|')})\\b[^>]*>`,
    'gi',
  );
}

function findNamedXmlElementByTagNames(
  sourceContent: string,
  tagNames: string[],
  name: string,
): XmlElementOccurrence | null {
  const tagRe = buildXmlTagNamesRegExp(tagNames);
  const stack: Array<{
    start: number;
    openEnd: number;
    rawOpenTag: string;
    tagName: string;
    matchesName: boolean;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    const isClosingTag = match[1] === '/';
    const matchedTagName = match[2] ?? '';

    if (isClosingTag) {
      let openTagIndex = -1;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]?.tagName === matchedTagName) {
          openTagIndex = index;
          break;
        }
      }
      const openTag = openTagIndex >= 0 ? stack.splice(openTagIndex, 1)[0] : null;
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
        tagName: matchedTagName,
        matchesName: matchedName === name,
      });
    }
  }

  return null;
}

function findNamedXmlElement(
  sourceContent: string,
  tagName: string,
  name: string,
): XmlElementOccurrence | null {
  return findNamedXmlElementByTagNames(sourceContent, [tagName], name);
}

function findFirstXmlElementByTagNames(
  sourceContent: string,
  tagNames: string[],
): XmlElementOccurrence | null {
  const normalizedTagNames = new Set(tagNames.map((tagName) => tagName.toLowerCase()));
  XML_TAG_OR_COMMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }

    const matchedTagName = match[2] ?? '';
    if (!normalizedTagNames.has(matchedTagName.toLowerCase())) {
      continue;
    }

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

    const closingTag = `</${matchedTagName}>`;
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

function findFirstXmlElement(sourceContent: string, tagName: string): XmlElementOccurrence | null {
  return findFirstXmlElementByTagNames(sourceContent, [tagName]);
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

function getLineEndIncludingNewline(sourceContent: string, index: number): number {
  let cursor = index;
  while (cursor < sourceContent.length) {
    const char = sourceContent[cursor];
    if (char === '\n') {
      return cursor + 1;
    }
    if (char === '\r') {
      return sourceContent[cursor + 1] === '\n' ? cursor + 2 : cursor + 1;
    }
    cursor += 1;
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

  const escapedNextValue = escapeXmlAttribute(nextValue);
  if (attrRe.test(rawTag)) {
    return rawTag.replace(
      new RegExp(`(\\s+${escapeRegExp(attributeName)}\\s*=\\s*)(["']).*?\\2`, 'i'),
      (_match, prefix: string, quote: string) => `${prefix}${quote}${escapedNextValue}${quote}`,
    );
  }

  return rawTag.replace(/(\s*\/?>)$/, ` ${attributeName}="${escapedNextValue}"$1`);
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

function shouldEmitSdfPositionLimits(jointType: UrdfJoint['type']): boolean {
  return jointType === JointType.REVOLUTE || jointType === JointType.PRISMATIC;
}

function shouldEmitSdfEffortVelocityLimits(jointType: UrdfJoint['type']): boolean {
  return (
    jointType === JointType.REVOLUTE ||
    jointType === JointType.PRISMATIC ||
    jointType === JointType.CONTINUOUS
  );
}

function buildSdfLimitEntries(
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (shouldEmitSdfPositionLimits(jointType)) {
    entries.push(['lower', formatScalar(limit.lower)]);
    entries.push(['upper', formatScalar(limit.upper)]);
  }
  if (shouldEmitSdfEffortVelocityLimits(jointType)) {
    entries.push(['effort', formatScalar(limit.effort)]);
    entries.push(['velocity', formatScalar(limit.velocity)]);
  }
  return entries;
}

function buildSdfLimitBlock(
  sourceContent: string,
  insertIndent: string,
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
): string {
  const entries = buildSdfLimitEntries(jointType, limit);
  if (entries.length === 0) {
    return '';
  }

  const newline = getPreferredNewline(sourceContent);
  const childIndent = `${insertIndent}${DEFAULT_INDENT_UNIT}`;
  return [
    `${insertIndent}<limit>`,
    ...entries.map(([tagName, value]) => `${childIndent}<${tagName}>${value}</${tagName}>`),
    `${insertIndent}</limit>`,
  ].join(newline);
}

function buildSdfLimitEntry(tagName: string, value: string): string {
  return `<${tagName}>${value}</${tagName}>`;
}

function findFirstDirectXmlChildElement(
  sourceContent: string,
  parentOccurrence: XmlElementOccurrence,
  childTagName: string,
): XmlElementOccurrence | null {
  XML_TAG_OR_COMMENT_RE.lastIndex = parentOccurrence.openEnd;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    if (match.index >= parentOccurrence.closeStart) {
      break;
    }

    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }

    const isClosingTag = match[1] === '/';
    const matchedTagName = match[2] ?? '';
    const isSelfClosing = /\/\s*>$/.test(rawTag);

    if (isClosingTag) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && matchedTagName.toLowerCase() === childTagName.toLowerCase()) {
      const start = match.index;
      const openEnd = start + rawTag.length;
      if (isSelfClosing) {
        return {
          start,
          openEnd,
          closeStart: openEnd,
          end: openEnd,
          selfClosing: true,
          rawOpenTag: rawTag,
        };
      }

      const closingTag = `</${matchedTagName}>`;
      const closeStart = sourceContent.indexOf(closingTag, openEnd);
      if (closeStart < 0 || closeStart > parentOccurrence.closeStart) {
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

    if (!isSelfClosing) {
      depth += 1;
    }
  }

  return null;
}

function replaceXmlElementText(
  sourceContent: string,
  occurrence: XmlElementOccurrence,
  tagName: string,
  value: string,
): string {
  if (occurrence.selfClosing) {
    return (
      sourceContent.slice(0, occurrence.start) +
      buildSdfLimitEntry(tagName, value) +
      sourceContent.slice(occurrence.end)
    );
  }

  return (
    sourceContent.slice(0, occurrence.openEnd) +
    value +
    sourceContent.slice(occurrence.closeStart)
  );
}

function removeXmlElementOccurrence(
  sourceContent: string,
  occurrence: XmlElementOccurrence,
): string {
  const lineStart = getLineStart(sourceContent, occurrence.start);
  const lineEnd = getLineEndIncludingNewline(sourceContent, occurrence.end);
  const beforeElementOnLine = sourceContent.slice(lineStart, occurrence.start);
  const afterElementOnLine = sourceContent.slice(occurrence.end, lineEnd);

  if (
    /^[ \t]*$/.test(beforeElementOnLine) &&
    /^[ \t]*(?:\r\n|\r|\n)?$/.test(afterElementOnLine)
  ) {
    return sourceContent.slice(0, lineStart) + sourceContent.slice(lineEnd);
  }

  return sourceContent.slice(0, occurrence.start) + sourceContent.slice(occurrence.end);
}

function insertSdfLimitEntriesBeforeClose(
  sourceContent: string,
  limitOccurrence: XmlElementOccurrence,
  entries: Array<[string, string]>,
): string {
  if (entries.length === 0) {
    return sourceContent;
  }

  const newline = getPreferredNewline(sourceContent);
  const closeLineStart = getLineStart(sourceContent, limitOccurrence.closeStart);
  const closeLinePrefix = sourceContent.slice(closeLineStart, limitOccurrence.closeStart);

  if (/^[ \t]*$/.test(closeLinePrefix)) {
    const childIndent = `${closeLinePrefix}${DEFAULT_INDENT_UNIT}`;
    const insertedLines = entries.map(([tagName, value]) =>
      `${childIndent}${buildSdfLimitEntry(tagName, value)}`,
    );
    return (
      sourceContent.slice(0, closeLineStart) +
      `${insertedLines.join(newline)}${newline}` +
      sourceContent.slice(closeLineStart)
    );
  }

  const inlineEntries = entries
    .map(([tagName, value]) => buildSdfLimitEntry(tagName, value))
    .join('');
  return (
    sourceContent.slice(0, limitOccurrence.closeStart) +
    inlineEntries +
    sourceContent.slice(limitOccurrence.closeStart)
  );
}

function patchSdfExistingLimitBlock(
  limitContent: string,
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
): string {
  const desiredEntries = new Map(buildSdfLimitEntries(jointType, limit));
  let nextContent = limitContent;

  for (const tagName of SDF_MANAGED_LIMIT_TAG_NAMES) {
    const nextLimitOccurrence = findFirstXmlElement(nextContent, 'limit');
    if (!nextLimitOccurrence || nextLimitOccurrence.selfClosing) {
      break;
    }

    const childOccurrence = findFirstDirectXmlChildElement(
      nextContent,
      nextLimitOccurrence,
      tagName,
    );
    const desiredValue = desiredEntries.get(tagName);

    if (desiredValue == null) {
      if (childOccurrence) {
        nextContent = removeXmlElementOccurrence(nextContent, childOccurrence);
      }
      continue;
    }

    if (childOccurrence) {
      nextContent = replaceXmlElementText(nextContent, childOccurrence, tagName, desiredValue);
      desiredEntries.delete(tagName);
    }
  }

  const missingEntries = SDF_MANAGED_LIMIT_TAG_NAMES.flatMap((tagName) => {
    const value = desiredEntries.get(tagName);
    return value == null ? [] : [[tagName, value] as [string, string]];
  });
  if (missingEntries.length === 0) {
    return nextContent;
  }

  const nextLimitOccurrence = findFirstXmlElement(nextContent, 'limit');
  if (!nextLimitOccurrence || nextLimitOccurrence.selfClosing) {
    return nextContent;
  }

  return insertSdfLimitEntriesBeforeClose(nextContent, nextLimitOccurrence, missingEntries);
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

export function patchUrdfRobotNameInSource(sourceContent: string, robotName: string): string {
  const robotOccurrence = findFirstXmlElementByTagNames(sourceContent, ['robot', 'xacro:robot']);
  if (!robotOccurrence) {
    throw new Error('Failed to locate URDF/Xacro <robot> root.');
  }

  const nextRobotTag = replaceOrRemoveXmlAttribute(
    robotOccurrence.rawOpenTag,
    'name',
    robotName,
  );
  return (
    sourceContent.slice(0, robotOccurrence.start) +
    nextRobotTag +
    sourceContent.slice(robotOccurrence.start + robotOccurrence.rawOpenTag.length)
  );
}

export function patchSdfModelNameInSource(sourceContent: string, modelName: string): string {
  const modelOccurrence = findFirstXmlElement(sourceContent, 'model');
  if (!modelOccurrence) {
    throw new Error('Failed to locate SDF <model> element.');
  }

  const nextModelTag = replaceOrRemoveXmlAttribute(
    modelOccurrence.rawOpenTag,
    'name',
    modelName,
  );
  return (
    sourceContent.slice(0, modelOccurrence.start) +
    nextModelTag +
    sourceContent.slice(modelOccurrence.start + modelOccurrence.rawOpenTag.length)
  );
}

export function patchSdfJointLimitInSource({
  sourceContent,
  jointName,
  jointType,
  limit,
}: JointLimitSourcePatchOptions): string {
  const jointOccurrence = findNamedXmlElement(sourceContent, 'joint', jointName);
  if (!jointOccurrence) {
    throw new Error(`Failed to locate SDF <joint name="${jointName}">.`);
  }

  const nextLimitBlock = buildSdfLimitBlock(
    sourceContent,
    getIndentAt(sourceContent, jointOccurrence.start) + DEFAULT_INDENT_UNIT.repeat(2),
    jointType,
    limit,
  );
  if (!nextLimitBlock) {
    return sourceContent;
  }

  const jointContent = sourceContent.slice(jointOccurrence.start, jointOccurrence.end);
  const axisOccurrence = findFirstXmlElement(jointContent, 'axis');
  const limitSearchOffset = axisOccurrence?.start ?? 0;
  const limitSearchContent = axisOccurrence
    ? jointContent.slice(axisOccurrence.start, axisOccurrence.end)
    : jointContent;
  const limitOccurrence = findFirstXmlElement(limitSearchContent, 'limit');
  if (limitOccurrence) {
    const limitStart = jointOccurrence.start + limitSearchOffset + limitOccurrence.start;
    const limitEnd = jointOccurrence.start + limitSearchOffset + limitOccurrence.end;
    const limitIndent = getIndentAt(sourceContent, limitStart);
    const rewrittenLimitBlock = limitOccurrence.selfClosing
      ? buildSdfLimitBlock(sourceContent, limitIndent, jointType, limit)
      : patchSdfExistingLimitBlock(
          sourceContent.slice(limitStart, limitEnd),
          jointType,
          limit,
        );
    return (
      sourceContent.slice(0, limitStart) +
      rewrittenLimitBlock +
      sourceContent.slice(limitEnd)
    );
  }

  const newline = getPreferredNewline(sourceContent);
  if (axisOccurrence) {
    const axisStart = jointOccurrence.start + axisOccurrence.start;
    if (axisOccurrence.selfClosing) {
      const axisIndent = getIndentAt(sourceContent, axisStart);
      const limitIndent = `${axisIndent}${DEFAULT_INDENT_UNIT}`;
      const expandedAxisTag = axisOccurrence.rawOpenTag.replace(/\/\s*>$/, '>');
      return (
        sourceContent.slice(0, axisStart) +
        [
          expandedAxisTag,
          buildSdfLimitBlock(sourceContent, limitIndent, jointType, limit),
          `${axisIndent}</axis>`,
        ].join(newline) +
        sourceContent.slice(axisStart + axisOccurrence.rawOpenTag.length)
      );
    }

    const axisCloseStart = jointOccurrence.start + axisOccurrence.closeStart;
    const axisCloseLineStart = getLineStart(sourceContent, axisCloseStart);
    const axisCloseIndent = sourceContent.slice(axisCloseLineStart, axisCloseStart);
    const limitIndent = `${axisCloseIndent}${DEFAULT_INDENT_UNIT}`;
    return (
      sourceContent.slice(0, axisCloseLineStart) +
      `${buildSdfLimitBlock(sourceContent, limitIndent, jointType, limit)}${newline}${axisCloseIndent}` +
      sourceContent.slice(axisCloseStart)
    );
  }

  if (jointOccurrence.selfClosing) {
    const jointIndent = getIndentAt(sourceContent, jointOccurrence.start);
    const limitIndent = `${jointIndent}${DEFAULT_INDENT_UNIT}`;
    const expandedJointTag = jointOccurrence.rawOpenTag.replace(/\/\s*>$/, '>');
    return (
      sourceContent.slice(0, jointOccurrence.start) +
      `${expandedJointTag}${newline}${buildSdfLimitBlock(
        sourceContent,
        limitIndent,
        jointType,
        limit,
      )}${newline}${jointIndent}</joint>` +
      sourceContent.slice(jointOccurrence.end)
    );
  }

  const jointCloseLineStart = getLineStart(sourceContent, jointOccurrence.closeStart);
  const jointCloseIndent = sourceContent.slice(jointCloseLineStart, jointOccurrence.closeStart);
  const limitIndent = `${jointCloseIndent}${DEFAULT_INDENT_UNIT}`;
  return (
    sourceContent.slice(0, jointCloseLineStart) +
    `${buildSdfLimitBlock(sourceContent, limitIndent, jointType, limit)}${newline}${jointCloseIndent}` +
    sourceContent.slice(jointOccurrence.closeStart)
  );
}
