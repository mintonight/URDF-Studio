import {
  getMjcfLinkDisplayName,
  getMjcfRawDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import type { RobotSourceDiagnostic, RobotState } from '@/types';

const MAX_SUMMARY_ITEMS = 3;

type RobotInspectionContext = NonNullable<RobotState['inspectionContext']>;
type MjcfInspectionContext = NonNullable<RobotInspectionContext['mjcf']>;
type UrdfInspectionContext = NonNullable<RobotInspectionContext['urdf']>;

const buildSelectedItemSet = (selectedItems?: Record<string, string[]>) => {
  return new Set(Object.values(selectedItems ?? {}).flat());
};

const joinNonEmpty = (parts: Array<string | undefined>) => {
  return parts.filter(Boolean).join(', ');
};

const escapeRegExp = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const isGeneratedSiteNameForBody = (siteName: string, bodyId: string) => {
  const normalizedSiteName = siteName.trim();
  const normalizedBodyId = bodyId.trim();
  if (!normalizedSiteName || !normalizedBodyId) {
    return false;
  }

  const generatedSitePattern = new RegExp(
    `^${escapeRegExp(normalizedBodyId)}(?:::site(?:_\\d+|\\[\\d+\\])|_site_\\d+)$`,
    'i',
  );
  return generatedSitePattern.test(normalizedSiteName);
};

const formatBodiesWithSites = (
  robot: RobotState,
  bodiesWithSites: NonNullable<
    NonNullable<RobotState['inspectionContext']>['mjcf']
  >['bodiesWithSites'],
) => {
  const sourceFormat = robot.inspectionContext?.sourceFormat;
  const linkDisplayNames = Object.fromEntries(
    Object.values(robot.links).map((link) => [
      link.id,
      sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(link) : link.name,
    ]),
  );

  return bodiesWithSites
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((body) => {
      const bodyDisplayName = linkDisplayNames[body.bodyId] || getMjcfRawDisplayName(body.bodyId);
      const siteDisplayNames = body.siteNames
        .slice(0, MAX_SUMMARY_ITEMS)
        .map((siteName) =>
          getMjcfRawDisplayName(
            siteName,
            isGeneratedSiteNameForBody(siteName, body.bodyId) ? bodyDisplayName : undefined,
          ),
        )
        .join(', ');

      return `${bodyDisplayName} (${body.siteCount}: ${siteDisplayNames})`;
    })
    .join('; ');
};

const formatTendons = (
  tendons: NonNullable<NonNullable<RobotState['inspectionContext']>['mjcf']>['tendons'],
) => {
  return tendons
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((tendon) => {
      const attachments = tendon.attachmentRefs.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      const actuators = tendon.actuatorNames.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      return `${tendon.name} [${tendon.type}] (${joinNonEmpty([
        attachments ? `attachments: ${attachments}` : undefined,
        actuators ? `actuators: ${actuators}` : undefined,
      ])})`;
    })
    .join('; ');
};

const formatUrdfDiagnostics = (diagnostics: RobotSourceDiagnostic[]) => {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'info')
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((diagnostic) => {
      const related = diagnostic.relatedIds?.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      return `${diagnostic.code} [${diagnostic.severity}]${related ? ` (${related})` : ''}: ${diagnostic.message}`;
    })
    .join('; ');
};

const formatUrdfInspectionPromptNotes = (
  urdfContext: UrdfInspectionContext,
  sourceFormat: string | undefined,
  lang: 'en' | 'zh',
) => {
  const diagnosticSummary = formatUrdfDiagnostics(urdfContext.diagnostics);
  const counts = urdfContext.diagnosticCounts;
  const facts = urdfContext.facts;
  const sourceLabel = sourceFormat?.toUpperCase() ?? 'URDF';

  if (lang === 'zh') {
    const lines = [
      '**源格式附加说明:**',
      `- 该机器人来自 ${sourceLabel}，已包含本地 URDF 静态诊断供审阅参考。`,
      `- URDF 摘要：${facts.linkCount} 个 link，${facts.jointCount} 个 joint，${facts.visualCount} 个 visual，${facts.collisionCount} 个 collision，${facts.inertialCount} 个 inertial。`,
      `- 诊断计数：${counts.error} 个 error，${counts.warning} 个 warning，${counts.info} 个 info。`,
    ];

    if (diagnosticSummary) {
      lines.push(`- 优先参考这些诊断，但仍需结合机器人 JSON 独立判断：${diagnosticSummary}`);
    }

    return lines.join('\n');
  }

  const lines = [
    '**Source-Format Notes:**',
    `- This robot comes from ${sourceLabel} and includes local URDF static diagnostics as review evidence.`,
    `- URDF summary: ${facts.linkCount} links, ${facts.jointCount} joints, ${facts.visualCount} visuals, ${facts.collisionCount} collisions, ${facts.inertialCount} inertials.`,
    `- Diagnostic counts: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info items.`,
  ];

  if (diagnosticSummary) {
    lines.push(
      `- Use these diagnostics as priority evidence, but still verify against the robot JSON: ${diagnosticSummary}`,
    );
  }

  return lines.join('\n');
};

const formatMjcfInspectionPromptNotes = (
  robot: RobotState,
  mjcfContext: MjcfInspectionContext,
  selectedItems: Record<string, string[]> | undefined,
  lang: 'en' | 'zh',
) => {
  const selectedItemIds = buildSelectedItemSet(selectedItems);
  const bodySiteSummary = formatBodiesWithSites(robot, mjcfContext.bodiesWithSites);
  const tendonSummary = formatTendons(mjcfContext.tendons);

  if (lang === 'zh') {
    const lines = [
      '**源格式附加说明:**',
      '- 该机器人来自 MJCF。源 MJCF 中的 `<frame>` 会在编译后消失，不要仅因为规范化树里没有独立 frame/link 就判定结构缺失。',
      `- MJCF 摘要：${mjcfContext.siteCount} 个 site，${mjcfContext.tendonCount} 条 tendon，${mjcfContext.tendonActuatorCount} 个 tendon actuator。`,
    ];

    if (selectedItemIds.has('frame_alignment')) {
      lines.push(
        `- 在检查 frame_alignment 时，必须结合 joint 的 origin/axis 与 body-site 摘要判断坐标系是否对齐：${bodySiteSummary || '当前没有额外 site 摘要。'}`,
      );
    }

    if (selectedItemIds.has('motor_limits') || selectedItemIds.has('armature_config')) {
      lines.push(
        `- 在检查 motor_limits 或 armature_config 时，必须结合 tendon 摘要、actuator 关联和限幅信息判断：${tendonSummary || '当前没有额外 tendon 摘要。'}`,
      );
    }

    return lines.join('\n');
  }

  const lines = [
    '**Source-Format Notes:**',
    '- This robot comes from MJCF. Source `<frame>` nodes compile away, so do not report missing structure only because the normalized tree has no standalone frame/link node.',
    `- MJCF summary: ${mjcfContext.siteCount} sites, ${mjcfContext.tendonCount} tendons, ${mjcfContext.tendonActuatorCount} tendon actuators.`,
  ];

  if (selectedItemIds.has('frame_alignment')) {
    lines.push(
      `- When evaluating frame_alignment, you MUST combine joint origin/axis data with body-site evidence: ${bodySiteSummary || 'no additional site summary is available.'}`,
    );
  }

  if (selectedItemIds.has('motor_limits') || selectedItemIds.has('armature_config')) {
    lines.push(
      `- When evaluating motor_limits or armature_config, you MUST use tendon summaries, actuator associations, and limit data together: ${tendonSummary || 'no additional tendon summary is available.'}`,
    );
  }

  return lines.join('\n');
};

export const buildInspectionPromptNotes = (
  robot: RobotState,
  selectedItems: Record<string, string[]> | undefined,
  lang: 'en' | 'zh',
) => {
  const inspectionContext = robot.inspectionContext;
  if (!inspectionContext) {
    return '';
  }

  const urdfContext = inspectionContext.urdf;
  if (urdfContext) {
    return formatUrdfInspectionPromptNotes(urdfContext, inspectionContext.sourceFormat, lang);
  }

  const mjcfContext = inspectionContext.sourceFormat === 'mjcf' ? inspectionContext.mjcf : undefined;
  if (!mjcfContext) {
    return '';
  }

  return formatMjcfInspectionPromptNotes(robot, mjcfContext, selectedItems, lang);
};
