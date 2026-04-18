import { syncRobotMaterialsForLinkUpdate } from '@/core/robot/materials';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import { parseJoints } from '@/core/parsers/urdf/parser/jointParser';
import { parseLinks } from '@/core/parsers/urdf/parser/linkParser';
import { parseMaterials } from '@/core/parsers/urdf/parser/materialParser';
import type { RobotData, RobotFile, RobotState, UrdfJoint, UrdfLink } from '@/types';
import type { SourceCodeDirtyRange } from '@/features/code-editor/utils/sourceCodeEditorSession';

interface TryPatchRobotStateFromEditableSourceChangeOptions {
  file: Pick<RobotFile, 'format' | 'name'> | null | undefined;
  previousContent: string;
  nextContent: string;
  dirtyRanges: SourceCodeDirtyRange[];
  currentState: Pick<
    RobotData,
    | 'name'
    | 'version'
    | 'links'
    | 'joints'
    | 'rootLinkId'
    | 'materials'
    | 'closedLoopConstraints'
    | 'inspectionContext'
  >;
}

interface XmlElementBounds {
  tagName: string;
  startOffset: number;
  endOffset: number;
  parentTagName: string | null;
}

interface UrdfParseContext {
  globalMaterials: ReturnType<typeof parseMaterials>['globalMaterials'];
  linkGazeboMaterials: ReturnType<typeof parseMaterials>['linkGazeboMaterials'];
}

const XML_TOKEN_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*?>/g;
const MJCF_PATCH_ROOT_NAME = '__editable_source_patch_root__';

function parseXmlRootElement(xml: string, rootTagName: string): Element | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }

  return doc.querySelector(rootTagName);
}

function buildUrdfParseContext(xml: string): UrdfParseContext | null {
  const robotEl = parseXmlRootElement(xml, 'robot');
  if (!robotEl) {
    return null;
  }

  return parseMaterials(robotEl);
}

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

function overlapsRange(element: XmlElementBounds, range: SourceCodeDirtyRange): boolean {
  return range.startOffset >= element.startOffset && range.endOffset <= element.endOffset;
}

function sameElementBounds(left: XmlElementBounds, right: XmlElementBounds): boolean {
  return (
    left.tagName === right.tagName &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset &&
    left.parentTagName === right.parentTagName
  );
}

function sameSortedStrings(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function findChangedUrdfTopLevelElement(
  xml: string,
  dirtyRanges: SourceCodeDirtyRange[],
): {
  element: XmlElementBounds;
  indexByTag: number;
} | null {
  const topLevelElements = collectXmlElementBounds(xml).filter(
    (element) =>
      element.parentTagName === 'robot' &&
      (element.tagName === 'link' || element.tagName === 'joint'),
  );

  if (topLevelElements.length === 0) {
    return null;
  }

  const changedElements = dirtyRanges
    .map((range) => {
      const matchingElements = topLevelElements
        .filter((element) => overlapsRange(element, range))
        .sort(
          (left, right) =>
            left.endOffset - left.startOffset - (right.endOffset - right.startOffset),
        );
      return matchingElements[0] ?? null;
    })
    .filter((element): element is XmlElementBounds => Boolean(element));

  if (changedElements.length === 0) {
    return null;
  }

  const uniqueElementKeys = new Set(
    changedElements.map(
      (element) => `${element.tagName}:${element.startOffset}:${element.endOffset}`,
    ),
  );
  if (uniqueElementKeys.size !== 1) {
    return null;
  }

  const element = changedElements[0];
  const indexByTag = topLevelElements
    .filter((candidate) => candidate.tagName === element.tagName)
    .findIndex(
      (candidate) =>
        candidate.startOffset === element.startOffset && candidate.endOffset === element.endOffset,
    );

  if (indexByTag < 0) {
    return null;
  }

  return { element, indexByTag };
}

function resolvePreviousUrdfTopLevelElement(
  xml: string,
  tagName: 'link' | 'joint',
  indexByTag: number,
): XmlElementBounds | null {
  const topLevelElements = collectXmlElementBounds(xml).filter(
    (element) => element.parentTagName === 'robot' && element.tagName === tagName,
  );

  return topLevelElements[indexByTag] ?? null;
}

function findChangedMjcfBodyElement(
  xml: string,
  dirtyRanges: SourceCodeDirtyRange[],
): {
  element: XmlElementBounds;
  bodyIndex: number;
} | null {
  const bodyElements = collectXmlElementBounds(xml)
    .filter((element) => element.tagName === 'body')
    .sort((left, right) => left.startOffset - right.startOffset);

  if (bodyElements.length === 0) {
    return null;
  }

  const changedElements = dirtyRanges
    .map((range) => {
      const matchingBodies = bodyElements
        .filter((element) => overlapsRange(element, range))
        .sort(
          (left, right) =>
            left.endOffset - left.startOffset - (right.endOffset - right.startOffset),
        );
      return matchingBodies[0] ?? null;
    })
    .filter((element): element is XmlElementBounds => Boolean(element));

  if (changedElements.length === 0) {
    return null;
  }

  const referenceBody = changedElements[0];
  if (!changedElements.every((candidate) => sameElementBounds(candidate, referenceBody))) {
    return null;
  }

  const bodyIndex = bodyElements.findIndex((candidate) =>
    sameElementBounds(candidate, referenceBody),
  );
  if (bodyIndex < 0) {
    return null;
  }

  return {
    element: referenceBody,
    bodyIndex,
  };
}

function resolvePreviousMjcfBodyElement(xml: string, bodyIndex: number): XmlElementBounds | null {
  return (
    collectXmlElementBounds(xml)
      .filter((element) => element.tagName === 'body')
      .sort((left, right) => left.startOffset - right.startOffset)[bodyIndex] ?? null
  );
}

function parseSingleUrdfLinkFragment(fragment: string, context: UrdfParseContext): UrdfLink | null {
  const robotEl = parseXmlRootElement(`<robot>${fragment}</robot>`, 'robot');
  if (!robotEl) {
    return null;
  }

  const { links } = parseLinks(robotEl, context.globalMaterials, context.linkGazeboMaterials);
  const parsedLinks = Object.values(links);
  return parsedLinks.length === 1 ? parsedLinks[0] : null;
}

function parseSingleUrdfJointFragment(fragment: string): UrdfJoint | null {
  const robotEl = parseXmlRootElement(`<robot>${fragment}</robot>`, 'robot');
  if (!robotEl) {
    return null;
  }

  const joints = parseJoints(robotEl);
  const parsedJoints = Object.values(joints);
  return parsedJoints.length === 1 ? parsedJoints[0] : null;
}

function parseSingleMjcfBodyName(fragment: string): string | null {
  const bodyEl = parseXmlRootElement(
    `<mujoco model="editable_source_patch"><worldbody>${fragment}</worldbody></mujoco>`,
    'body',
  );
  const bodyName = bodyEl?.getAttribute('name')?.trim();
  return bodyName || null;
}

function extractDirectRootChildFragments(xml: string, rootTagName: string): string[] | null {
  const rootEl = parseXmlRootElement(xml, rootTagName);
  if (!rootEl) {
    return null;
  }

  return collectXmlElementBounds(xml)
    .filter((element) => element.parentTagName === rootTagName)
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((element) => xml.slice(element.startOffset, element.endOffset));
}

function buildMjcfBodyPatchDocument(xml: string, bodyFragment: string): string | null {
  const rootChildFragments = extractDirectRootChildFragments(xml, 'mujoco');
  if (!rootChildFragments) {
    return null;
  }

  if (rootChildFragments.some((fragment) => /<include\b/i.test(fragment))) {
    return null;
  }

  const preservedTopLevelFragments = rootChildFragments.filter(
    (fragment) => !/^<worldbody\b/i.test(fragment.trim()),
  );

  return [
    '<mujoco model="editable_source_patch">',
    ...preservedTopLevelFragments,
    '<worldbody>',
    `<body name="${MJCF_PATCH_ROOT_NAME}">`,
    bodyFragment,
    '</body>',
    '</worldbody>',
    '</mujoco>',
  ].join('\n');
}

function parseMjcfBodyPatchState(xml: string, bodyFragment: string): RobotState | null {
  const patchDocument = buildMjcfBodyPatchDocument(xml, bodyFragment);
  if (!patchDocument) {
    return null;
  }

  return parseMJCF(patchDocument);
}

function preserveRuntimeLinkMetadata(nextLink: UrdfLink, currentLink: UrdfLink): UrdfLink {
  return {
    ...nextLink,
    id: currentLink.id,
    visible: currentLink.visible,
    visual: {
      ...nextLink.visual,
      visible: currentLink.visual.visible,
    },
    visualBodies: (nextLink.visualBodies ?? []).map((body, index) => ({
      ...body,
      visible: currentLink.visualBodies?.[index]?.visible,
    })),
    collision: {
      ...nextLink.collision,
      visible: currentLink.collision.visible,
    },
    collisionBodies: (nextLink.collisionBodies ?? []).map((body, index) => ({
      ...body,
      visible: currentLink.collisionBodies?.[index]?.visible,
    })),
  };
}

function preserveRuntimeJointMetadata(nextJoint: UrdfJoint, currentJoint: UrdfJoint): UrdfJoint {
  return {
    ...nextJoint,
    id: currentJoint.id,
    parentLinkId: currentJoint.parentLinkId,
    childLinkId: currentJoint.childLinkId,
    angle: currentJoint.angle,
    quaternion: currentJoint.quaternion,
  };
}

function resolveCurrentLinkKeyByName(
  links: Record<string, UrdfLink>,
  linkName: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(links, linkName)) {
    return linkName;
  }

  return Object.keys(links).find((linkId) => links[linkId]?.name === linkName) ?? null;
}

function resolveCurrentJointKeyByName(
  joints: Record<string, UrdfJoint>,
  jointName: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(joints, jointName)) {
    return jointName;
  }

  return Object.keys(joints).find((jointId) => joints[jointId]?.name === jointName) ?? null;
}

function tryPatchUrdfState(
  options: TryPatchRobotStateFromEditableSourceChangeOptions,
): RobotState | null {
  const nextContext = buildUrdfParseContext(options.nextContent);
  const previousContext = buildUrdfParseContext(options.previousContent);
  if (!nextContext || !previousContext) {
    return null;
  }

  const nextChangedElement = findChangedUrdfTopLevelElement(
    options.nextContent,
    options.dirtyRanges,
  );
  if (!nextChangedElement) {
    return null;
  }

  const previousChangedElement = resolvePreviousUrdfTopLevelElement(
    options.previousContent,
    nextChangedElement.element.tagName as 'link' | 'joint',
    nextChangedElement.indexByTag,
  );
  if (!previousChangedElement) {
    return null;
  }

  const nextFragment = options.nextContent.slice(
    nextChangedElement.element.startOffset,
    nextChangedElement.element.endOffset,
  );
  const previousFragment = options.previousContent.slice(
    previousChangedElement.startOffset,
    previousChangedElement.endOffset,
  );

  if (nextChangedElement.element.tagName === 'link') {
    const previousLink = parseSingleUrdfLinkFragment(previousFragment, previousContext);
    const nextLink = parseSingleUrdfLinkFragment(nextFragment, nextContext);
    if (!previousLink || !nextLink) {
      return null;
    }

    const currentLinkKey = Object.prototype.hasOwnProperty.call(
      options.currentState.links,
      previousLink.id,
    )
      ? previousLink.id
      : Object.keys(options.currentState.links).find(
          (linkId) => options.currentState.links[linkId]?.name === previousLink.name,
        );
    if (!currentLinkKey) {
      return null;
    }

    const currentLink = options.currentState.links[currentLinkKey];
    const patchedLink = preserveRuntimeLinkMetadata(nextLink, currentLink);
    const nextMaterials = syncRobotMaterialsForLinkUpdate(
      options.currentState.materials,
      patchedLink,
      currentLink,
    );

    return {
      ...options.currentState,
      links: {
        ...options.currentState.links,
        [currentLinkKey]: patchedLink,
      },
      materials: nextMaterials,
      selection: { type: null, id: null },
    };
  }

  const previousJoint = parseSingleUrdfJointFragment(previousFragment);
  const nextJoint = parseSingleUrdfJointFragment(nextFragment);
  if (!previousJoint || !nextJoint) {
    return null;
  }

  const currentJointKey = Object.prototype.hasOwnProperty.call(
    options.currentState.joints,
    previousJoint.id,
  )
    ? previousJoint.id
    : Object.keys(options.currentState.joints).find(
        (jointId) => options.currentState.joints[jointId]?.name === previousJoint.name,
      );
  if (!currentJointKey) {
    return null;
  }

  const currentJoint = options.currentState.joints[currentJointKey];
  if (
    nextJoint.parentLinkId !== previousJoint.parentLinkId ||
    nextJoint.childLinkId !== previousJoint.childLinkId
  ) {
    return null;
  }

  return {
    ...options.currentState,
    joints: {
      ...options.currentState.joints,
      [currentJointKey]: preserveRuntimeJointMetadata(nextJoint, currentJoint),
    },
    selection: { type: null, id: null },
  };
}

function tryPatchMjcfState(
  options: TryPatchRobotStateFromEditableSourceChangeOptions,
): RobotState | null {
  if (
    /<include\b/i.test(options.previousContent) ||
    /<include\b/i.test(options.nextContent) ||
    (options.currentState.closedLoopConstraints?.length ?? 0) > 0
  ) {
    return null;
  }

  const nextChangedBody = findChangedMjcfBodyElement(options.nextContent, options.dirtyRanges);
  if (!nextChangedBody) {
    return null;
  }

  const previousChangedBody = resolvePreviousMjcfBodyElement(
    options.previousContent,
    nextChangedBody.bodyIndex,
  );
  if (!previousChangedBody) {
    return null;
  }

  const nextFragment = options.nextContent.slice(
    nextChangedBody.element.startOffset,
    nextChangedBody.element.endOffset,
  );
  const previousFragment = options.previousContent.slice(
    previousChangedBody.startOffset,
    previousChangedBody.endOffset,
  );

  const previousBodyName = parseSingleMjcfBodyName(previousFragment);
  const nextBodyName = parseSingleMjcfBodyName(nextFragment);
  if (!previousBodyName || !nextBodyName || previousBodyName !== nextBodyName) {
    return null;
  }

  if (/<site\b/i.test(previousFragment) || /<site\b/i.test(nextFragment)) {
    return null;
  }

  const previousPatchState = parseMjcfBodyPatchState(options.previousContent, previousFragment);
  const nextPatchState = parseMjcfBodyPatchState(options.nextContent, nextFragment);
  if (!previousPatchState || !nextPatchState) {
    return null;
  }

  const previousLinks = Object.entries(previousPatchState.links).filter(
    ([, link]) => link.name !== MJCF_PATCH_ROOT_NAME,
  );
  const nextLinks = Object.entries(nextPatchState.links).filter(
    ([, link]) => link.name !== MJCF_PATCH_ROOT_NAME,
  );
  const previousJoints = Object.entries(previousPatchState.joints);
  const nextJoints = Object.entries(nextPatchState.joints);

  if (
    !sameSortedStrings(
      previousLinks.map(([, link]) => link.name),
      nextLinks.map(([, link]) => link.name),
    ) ||
    !sameSortedStrings(
      previousJoints.map(([, joint]) => joint.name),
      nextJoints.map(([, joint]) => joint.name),
    )
  ) {
    return null;
  }

  const previousJointByName = new Map(previousJoints.map(([, joint]) => [joint.name, joint]));
  const currentLinkKeyByName = new Map<string, string>();
  const currentJointKeyByName = new Map<string, string>();

  for (const [, previousLink] of previousLinks) {
    const currentLinkKey = resolveCurrentLinkKeyByName(
      options.currentState.links,
      previousLink.name,
    );
    if (!currentLinkKey) {
      return null;
    }
    currentLinkKeyByName.set(previousLink.name, currentLinkKey);
  }

  for (const [, previousJoint] of previousJoints) {
    const currentJointKey = resolveCurrentJointKeyByName(
      options.currentState.joints,
      previousJoint.name,
    );
    if (!currentJointKey) {
      return null;
    }
    currentJointKeyByName.set(previousJoint.name, currentJointKey);
  }

  const patchedLinks = { ...options.currentState.links };
  const patchedJoints = { ...options.currentState.joints };
  let patchedMaterials = options.currentState.materials;

  for (const [, nextLink] of nextLinks) {
    const currentLinkKey = currentLinkKeyByName.get(nextLink.name);
    if (!currentLinkKey) {
      return null;
    }

    const currentLink = options.currentState.links[currentLinkKey];
    const patchedLink = preserveRuntimeLinkMetadata(nextLink, currentLink);
    patchedLinks[currentLinkKey] = patchedLink;
    patchedMaterials = syncRobotMaterialsForLinkUpdate(patchedMaterials, patchedLink, currentLink);
  }

  for (const [, nextJoint] of nextJoints) {
    const previousJoint = previousJointByName.get(nextJoint.name);
    const currentJointKey = currentJointKeyByName.get(nextJoint.name);
    if (!previousJoint || !currentJointKey) {
      return null;
    }

    if (
      nextJoint.parentLinkId !== previousJoint.parentLinkId ||
      nextJoint.childLinkId !== previousJoint.childLinkId
    ) {
      return null;
    }

    const currentJoint = options.currentState.joints[currentJointKey];
    patchedJoints[currentJointKey] = preserveRuntimeJointMetadata(nextJoint, currentJoint);
  }

  return {
    ...options.currentState,
    links: patchedLinks,
    joints: patchedJoints,
    materials: patchedMaterials,
    selection: { type: null, id: null },
  };
}

export function tryPatchRobotStateFromEditableSourceChange(
  options: TryPatchRobotStateFromEditableSourceChangeOptions,
): RobotState | null {
  if (!options.file || options.dirtyRanges.length === 0) {
    return null;
  }

  if (options.file.format === 'urdf') {
    return tryPatchUrdfState(options);
  }

  if (options.file.format === 'mjcf') {
    return tryPatchMjcfState(options);
  }

  return null;
}
