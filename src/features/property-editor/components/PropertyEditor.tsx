/**
 * PropertyEditor - Main orchestrator for link and joint property editing.
 * Delegates to LinkProperties or JointProperties based on selection,
 * wrapped in a resizable sidebar panel.
 */
import React from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import type {
  AppMode,
  InteractionSelection,
  MotorSpec,
  RobotMjcfInspectionTendonSummary,
  RobotState,
  Theme,
  UrdfLink,
} from '@/types';
import { resolveJointKey, resolveLinkKey } from '@/core/robot';
import { translations } from '@/shared/i18n';
import type { Language } from '@/store';
import { useResizablePanel } from '../hooks/useResizablePanel';
import {
  PROPERTY_EDITOR_PANEL_EYEBROW_CLASS,
  PROPERTY_EDITOR_PANEL_TITLE_CLASS,
} from './FormControls';
import { LinkProperties } from './LinkProperties';
import { JointProperties } from './JointProperties';
import { TendonProperties } from './TendonProperties';

export interface PropertyEditorProps {
  robot: RobotState;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
  ) => void;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
  ) => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onAddCollisionBody?: (linkId: string) => void;
  mode: AppMode;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
  readOnlyMessage?: string;
  jointTypeLocked?: boolean;
  sourceFilePath?: string;
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  robot,
  onUpdate,
  onSelect,
  onHover,
  onSelectGeometry,
  mode,
  assets,
  onUploadAsset,
  motorLibrary,
  lang,
  collapsed,
  onToggle,
  readOnlyMessage,
  jointTypeLocked = false,
  onAddCollisionBody,
  sourceFilePath,
}) => {
  const { selection } = robot;
  const isLink = selection.type === 'link';
  const isJoint = selection.type === 'joint';
  const isTendon = selection.type === 'tendon';
  const resolvedSelectionId = selection.id
    ? isLink
      ? resolveLinkKey(robot.links, selection.id)
      : isJoint
        ? resolveJointKey(robot.joints, selection.id)
        : selection.id
    : null;
  const resolvedRobot = React.useMemo<RobotState>(() => {
    if (!resolvedSelectionId) return robot;
    if (!isLink && !isJoint) return robot;
    return {
      ...robot,
      selection: {
        ...robot.selection,
        id: resolvedSelectionId,
      },
    };
  }, [isJoint, isLink, resolvedSelectionId, robot]);
  const linkData = resolvedSelectionId && isLink ? resolvedRobot.links[resolvedSelectionId] : null;
  const jointData =
    resolvedSelectionId && isJoint ? resolvedRobot.joints[resolvedSelectionId] : null;
  const tendonData =
    resolvedSelectionId && isTendon
      ? (robot.inspectionContext?.mjcf?.tendons.find(
          (entry) => entry.name === resolvedSelectionId,
        ) ?? null)
      : null;
  const data: UrdfLink | typeof jointData | RobotMjcfInspectionTendonSummary | null =
    linkData ?? jointData ?? tendonData;
  const t = translations[lang];
  const emptyStateMessage =
    readOnlyMessage ??
    (lang === 'zh'
      ? '选择连杆、关节或肌腱以查看属性。'
      : 'Select a link, joint, or tendon to inspect its properties.');

  const { displayWidth, isDragging, handleResizeMouseDown } = useResizablePanel(collapsed);

  const isReadOnlyPreview = Boolean(readOnlyMessage);

  return (
    <div
      className={`bg-element-bg dark:bg-panel-bg border-l border-border-black flex flex-col h-full z-20 relative will-change-[width,flex] ${isDragging ? '' : 'transition-[width,min-width,flex] duration-200 ease-out'}`}
      style={{
        width: `${displayWidth}px`,
        minWidth: `${displayWidth}px`,
        flex: `0 0 ${displayWidth}px`,
      }}
    >
      {/* Side Toggle Button (Centered & Protruding Left) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className="absolute -left-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-panel-bg hover:bg-system-blue-solid hover:text-white border border-border-strong rounded-l-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-text-tertiary transition-all group"
        title={collapsed ? t.properties : t.collapseSidebar}
      >
        <div className="flex flex-col gap-0.5 items-center">
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
          {collapsed ? (
            <ChevronLeft className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
        </div>
      </button>

      {/* Content Container - use visibility to prevent flash but allow smooth transition */}
      <div className="h-full w-full flex flex-col overflow-hidden">
        <div
          style={{ width: `${displayWidth}px` }}
          className="h-full flex flex-col bg-element-bg dark:bg-panel-bg transition-all duration-200 ease-out"
        >
          {/* Header */}
          <div className="w-full flex items-center justify-between px-2 py-1 border-b border-border-black bg-panel-bg shrink-0 relative z-30">
            <span className={PROPERTY_EDITOR_PANEL_EYEBROW_CLASS}>{t.properties}</span>
            {isReadOnlyPreview && (
              <span className="ui-static-copy-guard ml-1.5 rounded-md border border-system-blue/20 bg-system-blue/10 px-1.5 py-px text-[9px] font-semibold tracking-[0.02em] text-system-blue">
                {t.preview}
              </span>
            )}
            {data && (
              <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`ui-static-copy-guard rounded-md px-1.5 py-px text-[9px] font-semibold capitalize tracking-[0.02em] shrink-0 ${
                    isLink
                      ? 'bg-system-blue/10 dark:bg-system-blue/20 text-system-blue'
                      : isJoint
                        ? 'bg-orange-100 dark:bg-orange-900/25 text-orange-700 dark:text-orange-300'
                        : 'bg-emerald-100 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {resolvedRobot.selection.type}
                </span>
                <h2 className={`${PROPERTY_EDITOR_PANEL_TITLE_CLASS} truncate`}>{data.name}</h2>
              </div>
            )}
          </div>

          {/* Content */}
          {!data || isReadOnlyPreview ? (
            <div className="w-full flex-1 flex items-center justify-center p-8 text-text-tertiary text-center">
              <p className="ui-static-copy-guard text-[11px] leading-5">{emptyStateMessage}</p>
            </div>
          ) : (
            <div className="w-full min-h-0 flex-1 overflow-y-auto custom-scrollbar p-1 space-y-1.5">
              {isLink ? (
                <LinkProperties
                  data={linkData as UrdfLink}
                  robot={resolvedRobot}
                  mode={mode}
                  selection={resolvedRobot.selection}
                  onUpdate={onUpdate}
                  onSelect={onSelect}
                  onSelectGeometry={onSelectGeometry}
                  onAddCollisionBody={onAddCollisionBody}
                  motorLibrary={motorLibrary}
                  assets={assets}
                  onUploadAsset={onUploadAsset}
                  sourceFilePath={sourceFilePath}
                  t={t}
                  lang={lang}
                />
              ) : isJoint ? (
                <JointProperties
                  data={jointData as NonNullable<typeof jointData>}
                  mode={mode}
                  selection={resolvedRobot.selection}
                  onUpdate={onUpdate}
                  motorLibrary={motorLibrary}
                  t={t}
                  lang={lang}
                  jointTypeLocked={jointTypeLocked}
                />
              ) : tendonData ? (
                <TendonProperties data={tendonData} lang={lang} />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle - only show when expanded */}
      {!collapsed && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-system-blue/40 transition-colors z-40"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
};
