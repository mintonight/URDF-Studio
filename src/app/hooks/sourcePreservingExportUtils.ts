import { parseEditableRobotSource } from '@/app/utils/parseEditableRobotSource';
import type { RobotFile, RobotState } from '@/types';
import { createRobotSourceSnapshot } from './workspaceSourceSyncUtils';

export type SourcePreservingExportFormat = Extract<
  RobotFile['format'],
  'urdf' | 'mjcf' | 'sdf' | 'xacro'
>;

export type SourcePreservingExportStrategy =
  | 'source-preserved'
  | 'generated-from-robot-state';

export interface SourcePreservingExportFile {
  name: string;
  format: SourcePreservingExportFormat;
  content?: string | null;
}

export interface ResolveSourcePreservingExportContentOptions {
  format: SourcePreservingExportFormat;
  currentRobot: RobotState;
  sourceFile?: SourcePreservingExportFile | null;
  generatedContent: string;
  availableFiles?: RobotFile[];
  allFileContents?: Record<string, string>;
}

export interface SourcePreservingExportResult {
  content: string;
  strategy: SourcePreservingExportStrategy;
}

interface XmlElementBounds {
  tagName: string;
  startOffset: number;
  endOffset: number;
  parentTagName: string | null;
}

interface TextReplacement {
  startOffset: number;
  endOffset: number;
  text: string;
}

interface KeyedElement {
  key: string;
  tagName: string;
  bounds: XmlElementBounds;
  text: string;
}

export class SourcePreservingExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcePreservingExportError';
  }
}

const XML_TOKEN_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*?>/g;
const NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;
const PATCHABLE_URDF_LIKE_TAGS = new Set([
  'link',
  'joint',
  'material',
  'transmission',
  'gazebo',
  'xacro:arg',
  'xacro:property',
  'xacro:if',
  'xacro:unless',
]);
const URDF_MODEL_TAGS = new Set(['link', 'joint', 'material', 'transmission', 'gazebo']);
const MJCF_MODEL_SECTION_TAGS = new Set([
  'asset',
  'worldbody',
  'actuator',
  'tendon',
  'equality',
  'sensor',
  'contact',
]);

function collectXmlElementBounds(xml: string): XmlElementBounds[] {
  const bounds: XmlElementBounds[] = [];
  const stack: Array<{
    tagName: string;
    startOffset: number;
    parentTagName: string | null;
  }> = [];

  XML_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_TOKEN_RE.exec(xml)) !== null) {
    const rawTag = match[0];
    const tagName = match[1];

    if (!tagName) {
      continue;
    }

    if (rawTag.startsWith('</')) {
      const openTag = stack.pop();
      if (!openTag || openTag.tagName !== tagName) {
        continue;
      }

      bounds.push({
        tagName,
        startOffset: openTag.startOffset,
        endOffset: match.index + rawTag.length,
        parentTagName: openTag.parentTagName,
      });
      continue;
    }

    const parentTagName = stack[stack.length - 1]?.tagName ?? null;
    const selfClosing = /\/\s*>$/.test(rawTag);
    if (selfClosing) {
      bounds.push({
        tagName,
        startOffset: match.index,
        endOffset: match.index + rawTag.length,
        parentTagName,
      });
      continue;
    }

    stack.push({
      tagName,
      startOffset: match.index,
      parentTagName,
    });
  }

  return bounds;
}

function findRootElement(xml: string, tagName: string): XmlElementBounds | null {
  return (
    collectXmlElementBounds(xml).find(
      (element) => element.tagName === tagName && element.parentTagName === null,
    ) ?? null
  );
}

function findOpenTagEnd(xml: string, element: XmlElementBounds): number {
  const endOffset = xml.indexOf('>', element.startOffset);
  return endOffset >= 0 ? endOffset + 1 : element.startOffset;
}

function getOpenTag(xml: string, element: XmlElementBounds): string {
  return xml.slice(element.startOffset, findOpenTagEnd(xml, element));
}

function getAttributeValueFromOpenTag(openTag: string, attrName: string): string | null {
  const escapedAttrName = escapeRegex(attrName);
  const match = openTag.match(new RegExp(`\\b${escapedAttrName}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function getElementAttribute(xml: string, element: XmlElementBounds, attrName: string): string | null {
  return getAttributeValueFromOpenTag(getOpenTag(xml, element), attrName);
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceOrInsertAttribute(openTag: string, attrName: string, value: string | null): string {
  const escapedAttrName = escapeRegex(attrName);
  const attrRe = new RegExp(`\\b${escapedAttrName}\\s*=\\s*(["'])(.*?)\\1`, 'i');

  if (value == null || value === '') {
    return openTag.replace(new RegExp(`\\s+${escapedAttrName}\\s*=\\s*(["']).*?\\1`, 'i'), '');
  }

  const escapedValue = escapeXmlAttribute(value);
  if (attrRe.test(openTag)) {
    return openTag.replace(attrRe, `${attrName}="${escapedValue}"`);
  }

  return openTag.replace(/\s*\/?>$/, (suffix) => ` ${attrName}="${escapedValue}"${suffix}`);
}

function applyRootAttributePatch(
  xml: string,
  sourceRoot: XmlElementBounds,
  generatedRoot: XmlElementBounds,
  generatedXml: string,
  attrNames: string[],
): string {
  const sourceOpenTag = getOpenTag(xml, sourceRoot);
  const generatedOpenTag = getOpenTag(generatedXml, generatedRoot);
  const patchedOpenTag = attrNames.reduce(
    (openTag, attrName) =>
      replaceOrInsertAttribute(
        openTag,
        attrName,
        getAttributeValueFromOpenTag(generatedOpenTag, attrName),
      ),
    sourceOpenTag,
  );

  if (patchedOpenTag === sourceOpenTag) {
    return xml;
  }

  return `${xml.slice(0, sourceRoot.startOffset)}${patchedOpenTag}${xml.slice(
    findOpenTagEnd(xml, sourceRoot),
  )}`;
}

function applyTextReplacements(xml: string, replacements: TextReplacement[]): string {
  return [...replacements]
    .sort((left, right) => right.startOffset - left.startOffset)
    .reduce((content, replacement) => {
      if (replacement.startOffset < 0 || replacement.endOffset < replacement.startOffset) {
        return content;
      }
      return `${content.slice(0, replacement.startOffset)}${replacement.text}${content.slice(
        replacement.endOffset,
      )}`;
    }, xml);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getClosingTagStart(xml: string, element: XmlElementBounds): number {
  const fragment = xml.slice(element.startOffset, element.endOffset);
  const closeTagRe = new RegExp(`</\\s*${escapeRegex(element.tagName)}\\s*>\\s*$`, 'i');
  const match = fragment.match(closeTagRe);
  if (!match || match.index == null) {
    throw new SourcePreservingExportError(`Cannot locate </${element.tagName}> for source patch.`);
  }
  return element.startOffset + match.index;
}

function getLineStart(xml: string, index: number): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = xml[cursor - 1];
    if (previous === '\n' || previous === '\r') {
      break;
    }
    cursor -= 1;
  }
  return cursor;
}

function getIndentAt(xml: string, index: number): string {
  const lineStart = getLineStart(xml, index);
  return xml.slice(lineStart, index).match(/^[ \t]*/)?.[0] ?? '';
}

function getPreferredNewline(xml: string): string {
  return xml.includes('\r\n') ? '\r\n' : '\n';
}

function reindentFragment(fragment: string, targetIndent: string): string {
  const lines = fragment.split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim().length > 0);
  const sourceIndent = firstContentLine?.match(/^[ \t]*/)?.[0] ?? '';

  return lines
    .map((line) => {
      if (!line.trim()) {
        return line;
      }
      return `${targetIndent}${line.startsWith(sourceIndent) ? line.slice(sourceIndent.length) : line}`;
    })
    .join(getPreferredNewline(fragment));
}

function collectDirectChildren(xml: string, parentTagName: string): XmlElementBounds[] {
  return collectXmlElementBounds(xml)
    .filter((element) => element.parentTagName === parentTagName)
    .sort((left, right) => left.startOffset - right.startOffset);
}

function resolveElementKey(
  xml: string,
  element: XmlElementBounds,
  fallbackIndex: number,
): string | null {
  const openTag = getOpenTag(xml, element);
  const name = getAttributeValueFromOpenTag(openTag, 'name');
  if (name) {
    return `${element.tagName}:${name}`;
  }

  const reference = getAttributeValueFromOpenTag(openTag, 'reference');
  if (reference) {
    return `${element.tagName}:reference:${reference}`;
  }

  const value = getAttributeValueFromOpenTag(openTag, 'value');
  if (value && (element.tagName === 'xacro:if' || element.tagName === 'xacro:unless')) {
    return `${element.tagName}:value:${value}`;
  }

  if (element.tagName === 'worldbody' || element.tagName === 'asset') {
    return element.tagName;
  }

  return `${element.tagName}:index:${fallbackIndex}`;
}

function collectKeyedChildren(
  xml: string,
  parentTagName: string,
  includeTag: (tagName: string) => boolean,
): KeyedElement[] {
  return collectDirectChildren(xml, parentTagName)
    .filter((element) => includeTag(element.tagName))
    .map((element, index) => ({
      key: resolveElementKey(xml, element, index) ?? `${element.tagName}:index:${index}`,
      tagName: element.tagName,
      bounds: element,
      text: xml.slice(element.startOffset, element.endOffset),
    }));
}

function normalizeForSnapshot(robot: RobotState): RobotState {
  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const skippedKeys = new Set(['visible', 'selection', 'quaternion']);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !skippedKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableNormalize(entry)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function resolveRobotLinkByName(robot: RobotState, name: string): unknown {
  return Object.values(robot.links).find((link) => (link.name || link.id) === name) ?? null;
}

function resolveRobotJointByName(robot: RobotState, name: string): unknown {
  return Object.values(robot.joints).find((joint) => (joint.name || joint.id) === name) ?? null;
}

function collectChangedUrdfLikeKeys(
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): Set<string> {
  const changedKeys = new Set<string>();

  const sourceLinkNames = new Set(
    sourceRobot ? Object.values(sourceRobot.links).map((link) => link.name || link.id) : [],
  );
  const sourceJointNames = new Set(
    sourceRobot ? Object.values(sourceRobot.joints).map((joint) => joint.name || joint.id) : [],
  );

  Object.values(generatedRobot.links).forEach((link) => {
    const name = link.name || link.id;
    const sourceLink = sourceRobot ? resolveRobotLinkByName(sourceRobot, name) : null;
    if (!sourceLink || stableStringify(sourceLink) !== stableStringify(link)) {
      changedKeys.add(`link:${name}`);
    }
  });

  Object.values(generatedRobot.joints).forEach((joint) => {
    const name = joint.name || joint.id;
    const sourceJoint = sourceRobot ? resolveRobotJointByName(sourceRobot, name) : null;
    if (!sourceJoint || stableStringify(sourceJoint) !== stableStringify(joint)) {
      changedKeys.add(`joint:${name}`);
    }
  });

  sourceLinkNames.forEach((name) => {
    if (!resolveRobotLinkByName(generatedRobot, name)) {
      changedKeys.add(`link:${name}`);
    }
  });
  sourceJointNames.forEach((name) => {
    if (!resolveRobotJointByName(generatedRobot, name)) {
      changedKeys.add(`joint:${name}`);
    }
  });

  if (
    sourceRobot &&
    stableStringify(sourceRobot.materials ?? {}) !== stableStringify(generatedRobot.materials ?? {})
  ) {
    Object.keys(generatedRobot.materials ?? {}).forEach((name) => {
      changedKeys.add(`material:${name}`);
    });
  }

  return changedKeys;
}

function parseExportContent(
  format: SourcePreservingExportFormat,
  sourceFileName: string,
  content: string,
  availableFiles: RobotFile[] = [],
  allFileContents: Record<string, string> = {},
): RobotState | null {
  return parseEditableRobotSource({
    file: {
      name: sourceFileName,
      format,
    },
    content,
    availableFiles,
    allFileContents: {
      ...allFileContents,
      [sourceFileName]: content,
    },
  });
}

function buildRobotSnapshot(robot: RobotState): string {
  return createRobotSourceSnapshot(normalizeForSnapshot(robot));
}

function validatePatchedContent(
  options: ResolveSourcePreservingExportContentOptions,
  patchedContent: string,
): void {
  const sourceFileName = options.sourceFile?.name || `export.${options.format}`;
  const generatedRobot = parseExportContent(
    options.format,
    sourceFileName,
    options.generatedContent,
    options.availableFiles,
    options.allFileContents,
  );
  const patchedRobot = parseExportContent(
    options.format,
    sourceFileName,
    patchedContent,
    options.availableFiles,
    options.allFileContents,
  );

  if (!generatedRobot || !patchedRobot) {
    throw new SourcePreservingExportError(
      `Failed to validate ${options.format.toUpperCase()} source-preserving export.`,
    );
  }

  if (buildRobotSnapshot(generatedRobot) !== buildRobotSnapshot(patchedRobot)) {
    throw new SourcePreservingExportError(
      `${options.format.toUpperCase()} source-preserving export did not match RobotState output.`,
    );
  }
}

function assertPatchableXacro(
  sourceContent: string,
  sourceChildrenByKey: Map<string, KeyedElement>,
  generatedChildrenByKey: Map<string, KeyedElement>,
): void {
  const hasComplexXacro = /<\s*xacro:(?:macro|include)\b|\$\{|\$\(/i.test(sourceContent);
  if (!hasComplexXacro) {
    return;
  }

  const missingModelKeys = [...generatedChildrenByKey.values()].filter(
    (child) =>
      (child.tagName === 'link' || child.tagName === 'joint') &&
      !sourceChildrenByKey.has(child.key),
  );

  if (missingModelKeys.length > 0) {
    throw new SourcePreservingExportError(
      'Cannot preserve Xacro text structure because links or joints are generated by macros/includes.',
    );
  }
}

function patchUrdfLikeSource(
  sourceContent: string,
  generatedContent: string,
  format: 'urdf' | 'xacro',
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): string {
  const sourceRoot = findRootElement(sourceContent, 'robot');
  const generatedRoot = findRootElement(generatedContent, 'robot');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError(`Cannot locate <robot> root for ${format} export.`);
  }

  const changedKeys = collectChangedUrdfLikeKeys(sourceRobot, generatedRobot);
  let patched = applyRootAttributePatch(sourceContent, sourceRoot, generatedRoot, generatedContent, [
    'name',
    'version',
  ]);
  const patchedRoot = findRootElement(patched, 'robot');
  if (!patchedRoot) {
    throw new SourcePreservingExportError(`Cannot re-locate <robot> root for ${format} export.`);
  }

  const sourceChildren = collectKeyedChildren(patched, 'robot', (tagName) =>
    PATCHABLE_URDF_LIKE_TAGS.has(tagName),
  );
  const generatedChildren = collectKeyedChildren(generatedContent, 'robot', (tagName) =>
    PATCHABLE_URDF_LIKE_TAGS.has(tagName),
  );
  const sourceChildrenByKey = new Map(sourceChildren.map((child) => [child.key, child]));
  const generatedChildrenByKey = new Map(generatedChildren.map((child) => [child.key, child]));

  if (format === 'xacro') {
    assertPatchableXacro(patched, sourceChildrenByKey, generatedChildrenByKey);
  }

  const replacements: TextReplacement[] = [];
  sourceChildren.forEach((sourceChild) => {
    const generatedChild = generatedChildrenByKey.get(sourceChild.key);
    const isRobotModelTag = URDF_MODEL_TAGS.has(sourceChild.tagName);

    if (!generatedChild) {
      if (isRobotModelTag) {
        replacements.push({
          startOffset: sourceChild.bounds.startOffset,
          endOffset: sourceChild.bounds.endOffset,
          text: '',
        });
      }
      return;
    }

    if (!isRobotModelTag || changedKeys.has(sourceChild.key)) {
      replacements.push({
        startOffset: sourceChild.bounds.startOffset,
        endOffset: sourceChild.bounds.endOffset,
        text: reindentFragment(generatedChild.text, getIndentAt(patched, sourceChild.bounds.startOffset)),
      });
    }
  });

  const missingGeneratedChildren = generatedChildren.filter((child) => {
    if (sourceChildrenByKey.has(child.key)) {
      return false;
    }
    if (format === 'xacro' && child.tagName === 'xacro:property') {
      return false;
    }
    return true;
  });

  if (missingGeneratedChildren.length > 0) {
    const newline = getPreferredNewline(patched);
    const existingIndent = sourceChildren[0]
      ? getIndentAt(patched, sourceChildren[0].bounds.startOffset)
      : '  ';
    const insertion = `${newline}${missingGeneratedChildren
      .map((child) => reindentFragment(child.text, existingIndent))
      .join(newline)}${newline}`;
    replacements.push({
      startOffset: getClosingTagStart(patched, patchedRoot),
      endOffset: getClosingTagStart(patched, patchedRoot),
      text: insertion,
    });
  }

  return applyTextReplacements(patched, replacements);
}

function patchMjcfSource(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'mujoco');
  const generatedRoot = findRootElement(generatedContent, 'mujoco');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError('Cannot locate <mujoco> root for MJCF export.');
  }
  if (collectDirectChildren(sourceContent, 'mujoco').some((child) => child.tagName === 'include')) {
    throw new SourcePreservingExportError(
      'Cannot preserve MJCF text structure with root-level <include> files.',
    );
  }

  let patched = applyRootAttributePatch(sourceContent, sourceRoot, generatedRoot, generatedContent, [
    'model',
  ]);
  const patchedRoot = findRootElement(patched, 'mujoco');
  if (!patchedRoot) {
    throw new SourcePreservingExportError('Cannot re-locate <mujoco> root for MJCF export.');
  }

  const sourceSections = collectKeyedChildren(patched, 'mujoco', (tagName) =>
    MJCF_MODEL_SECTION_TAGS.has(tagName),
  );
  const generatedSections = collectKeyedChildren(generatedContent, 'mujoco', (tagName) =>
    MJCF_MODEL_SECTION_TAGS.has(tagName),
  );
  const sourceSectionsByKey = new Map(sourceSections.map((section) => [section.key, section]));
  const generatedSectionsByKey = new Map(generatedSections.map((section) => [section.key, section]));
  const replacements: TextReplacement[] = [];

  sourceSections.forEach((sourceSection) => {
    const generatedSection = generatedSectionsByKey.get(sourceSection.key);
    replacements.push({
      startOffset: sourceSection.bounds.startOffset,
      endOffset: sourceSection.bounds.endOffset,
      text: generatedSection
        ? reindentFragment(
            generatedSection.text,
            getIndentAt(patched, sourceSection.bounds.startOffset),
          )
        : '',
    });
  });

  const missingSections = generatedSections.filter((section) => !sourceSectionsByKey.has(section.key));
  if (missingSections.length > 0) {
    const newline = getPreferredNewline(patched);
    const insertionIndent = sourceSections[0]
      ? getIndentAt(patched, sourceSections[0].bounds.startOffset)
      : '  ';
    replacements.push({
      startOffset: getClosingTagStart(patched, patchedRoot),
      endOffset: getClosingTagStart(patched, patchedRoot),
      text: `${newline}${missingSections
        .map((section) => reindentFragment(section.text, insertionIndent))
        .join(newline)}${newline}`,
    });
  }

  return applyTextReplacements(patched, replacements);
}

function findGeneratedSdfModel(generatedContent: string): KeyedElement | null {
  return (
    collectKeyedChildren(generatedContent, 'sdf', (tagName) => tagName === 'model')[0] ?? null
  );
}

function findSourceSdfModel(sourceContent: string, generatedModelName: string | null): KeyedElement | null {
  const allBounds = collectXmlElementBounds(sourceContent);
  const modelBounds = allBounds
    .filter((element) => element.tagName === 'model')
    .filter((element) => element.parentTagName === 'sdf' || element.parentTagName === 'world')
    .sort((left, right) => left.startOffset - right.startOffset);
  const keyedModels = modelBounds.map((bounds, index) => ({
    key: resolveElementKey(sourceContent, bounds, index) ?? `model:index:${index}`,
    tagName: 'model',
    bounds,
    text: sourceContent.slice(bounds.startOffset, bounds.endOffset),
  }));

  if (generatedModelName) {
    const matchingModel = keyedModels.find(
      (model) => getElementAttribute(sourceContent, model.bounds, 'name') === generatedModelName,
    );
    if (matchingModel) {
      return matchingModel;
    }
  }

  if (keyedModels.length === 1) {
    return keyedModels[0];
  }

  return null;
}

function patchSdfSource(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'sdf');
  const generatedRoot = findRootElement(generatedContent, 'sdf');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError('Cannot locate <sdf> root for SDF export.');
  }

  const generatedModel = findGeneratedSdfModel(generatedContent);
  if (!generatedModel) {
    throw new SourcePreservingExportError('Cannot locate generated <model> for SDF export.');
  }

  const generatedModelName = getElementAttribute(generatedContent, generatedModel.bounds, 'name');
  const sourceModel = findSourceSdfModel(sourceContent, generatedModelName);
  if (!sourceModel) {
    throw new SourcePreservingExportError(
      'Cannot preserve SDF text structure because the source model is ambiguous.',
    );
  }

  const patched = applyRootAttributePatch(sourceContent, sourceRoot, generatedRoot, generatedContent, [
    'version',
  ]);
  const adjustedSourceModel =
    patched === sourceContent
      ? sourceModel
      : findSourceSdfModel(patched, getElementAttribute(generatedContent, generatedModel.bounds, 'name'));
  if (!adjustedSourceModel) {
    throw new SourcePreservingExportError('Cannot re-locate source <model> for SDF export.');
  }

  return applyTextReplacements(patched, [
    {
      startOffset: adjustedSourceModel.bounds.startOffset,
      endOffset: adjustedSourceModel.bounds.endOffset,
      text: reindentFragment(
        generatedModel.text,
        getIndentAt(patched, adjustedSourceModel.bounds.startOffset),
      ),
    },
  ]);
}

function patchSourceContent(
  format: SourcePreservingExportFormat,
  sourceContent: string,
  generatedContent: string,
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): string {
  switch (format) {
    case 'urdf':
      return patchUrdfLikeSource(sourceContent, generatedContent, 'urdf', sourceRobot, generatedRobot);
    case 'xacro':
      return patchUrdfLikeSource(
        sourceContent,
        generatedContent,
        'xacro',
        sourceRobot,
        generatedRobot,
      );
    case 'mjcf':
      return patchMjcfSource(sourceContent, generatedContent);
    case 'sdf':
      return patchSdfSource(sourceContent, generatedContent);
    default: {
      const unsupportedFormat: never = format;
      throw new SourcePreservingExportError(`Unsupported source-preserving export format: ${unsupportedFormat}`);
    }
  }
}

export function resolveSourcePreservingExportContent(
  options: ResolveSourcePreservingExportContentOptions,
): SourcePreservingExportResult {
  const { format, sourceFile, generatedContent } = options;
  const sourceContent = sourceFile?.content?.trim() ? sourceFile.content : null;

  if (!sourceFile || sourceFile.format !== format || !sourceContent) {
    return {
      content: generatedContent,
      strategy: 'generated-from-robot-state',
    };
  }

  const sourceRobot = parseExportContent(
    format,
    sourceFile.name,
    sourceContent,
    options.availableFiles,
    options.allFileContents,
  );
  const generatedRobot = parseExportContent(
    format,
    sourceFile.name,
    generatedContent,
    options.availableFiles,
    options.allFileContents,
  );

  if (!generatedRobot) {
    throw new SourcePreservingExportError(
      `Generated ${format.toUpperCase()} content cannot be parsed for source-preserving export.`,
    );
  }

  if (sourceRobot && buildRobotSnapshot(sourceRobot) === buildRobotSnapshot(generatedRobot)) {
    return {
      content: sourceFile.content ?? sourceContent,
      strategy: 'source-preserved',
    };
  }

  const patchedContent = patchSourceContent(
    format,
    sourceFile.content ?? sourceContent,
    generatedContent,
    sourceRobot,
    generatedRobot,
  );
  validatePatchedContent(options, patchedContent);

  return {
    content: patchedContent,
    strategy: 'source-preserved',
  };
}
