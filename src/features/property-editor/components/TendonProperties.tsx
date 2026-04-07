import React from 'react';
import type { RobotMjcfInspectionTendonSummary } from '@/types';
import { formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import type { Language } from '@/store';
import {
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_SUBLABEL_CLASS,
  ReadonlyValueField,
  StaticSection,
} from './FormControls';

interface TendonPropertiesProps {
  data: RobotMjcfInspectionTendonSummary;
  lang: Language;
}

interface TendonLabels {
  overview: string;
  attachments: string;
  actuators: string;
  name: string;
  type: string;
  className: string;
  group: string;
  limited: string;
  range: string;
  width: string;
  stiffness: string;
  springlength: string;
  rgba: string;
  target: string;
  extra: string;
  yes: string;
  no: string;
  none: string;
  attachmentType: Record<RobotMjcfInspectionTendonSummary['attachments'][number]['type'], string>;
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? formatNumberWithMaxDecimals(value) : '-';
}

function formatOptionalText(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : '-';
}

function formatTuple(value: number[] | undefined): string {
  if (!value?.length) {
    return '-';
  }

  return value.map((entry) => formatNumberWithMaxDecimals(entry)).join(', ');
}

function formatRange(value: [number, number] | undefined): string {
  if (!value) {
    return '-';
  }

  return `${formatNumberWithMaxDecimals(value[0])} to ${formatNumberWithMaxDecimals(value[1])}`;
}

function getLabels(lang: Language): TendonLabels {
  if (lang === 'zh') {
    return {
      overview: '概览',
      attachments: '附着点',
      actuators: '驱动器',
      name: '名称',
      type: '类型',
      className: '类',
      group: '组',
      limited: '限幅',
      range: '范围',
      width: '宽度',
      stiffness: '刚度',
      springlength: '弹簧长度',
      rgba: 'RGBA',
      target: '目标',
      extra: '附加参数',
      yes: '是',
      no: '否',
      none: '无',
      attachmentType: {
        site: 'site',
        geom: 'geom',
        joint: 'joint',
        pulley: 'pulley',
      },
    };
  }

  return {
    overview: 'Overview',
    attachments: 'Attachments',
    actuators: 'Actuators',
    name: 'Name',
    type: 'Type',
    className: 'Class',
    group: 'Group',
    limited: 'Limited',
    range: 'Range',
    width: 'Width',
    stiffness: 'Stiffness',
    springlength: 'Spring Length',
    rgba: 'RGBA',
    target: 'Target',
    extra: 'Extra',
    yes: 'Yes',
    no: 'No',
    none: 'None',
    attachmentType: {
      site: 'site',
      geom: 'geom',
      joint: 'joint',
      pulley: 'pulley',
    },
  };
}

export const TendonProperties: React.FC<TendonPropertiesProps> = ({ data, lang }) => {
  const labels = getLabels(lang);
  const limitedValue =
    typeof data.limited === 'boolean' ? (data.limited ? labels.yes : labels.no) : '-';

  return (
    <div className="space-y-2.5">
      <StaticSection title={labels.overview} className="mb-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.name}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {data.name}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.type}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium capitalize">
              {data.type}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.className}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatOptionalText(data.className)}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.group}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {typeof data.group === 'number' ? String(data.group) : '-'}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.limited}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {limitedValue}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.range}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatRange(data.range)}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.width}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatNumber(data.width)}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.stiffness}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatNumber(data.stiffness)}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5 col-span-2">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.springlength}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatNumber(data.springlength)}
            </ReadonlyValueField>
          </div>
          <div className="space-y-0.5 col-span-2">
            <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.rgba}</div>
            <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
              {formatTuple(data.rgba)}
            </ReadonlyValueField>
          </div>
        </div>
      </StaticSection>

      <StaticSection title={labels.attachments} className="mb-2.5">
        {data.attachments.length > 0 ? (
          <div className="space-y-1.5">
            {data.attachments.map((attachment, index) => {
              const target = attachment.ref ?? attachment.sidesite ?? labels.none;
              const extras = [
                typeof attachment.coef === 'number'
                  ? `coef=${formatNumberWithMaxDecimals(attachment.coef)}`
                  : null,
                typeof attachment.divisor === 'number'
                  ? `divisor=${formatNumberWithMaxDecimals(attachment.divisor)}`
                  : null,
                attachment.sidesite ? `sidesite=${attachment.sidesite}` : null,
              ].filter(Boolean);

              return (
                <div
                  key={`${attachment.type}:${attachment.ref ?? attachment.sidesite ?? index}`}
                  className="rounded-md border border-border-black bg-element-bg/70 p-1.5"
                >
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1.5">
                    <div className="space-y-0.5">
                      <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.type}</div>
                      <ReadonlyValueField className="bg-element-bg text-[10px] font-medium capitalize">
                        {labels.attachmentType[attachment.type]}
                      </ReadonlyValueField>
                    </div>
                    <div className="space-y-0.5">
                      <div className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{labels.target}</div>
                      <ReadonlyValueField className="min-w-0 bg-element-bg text-[10px] font-medium">
                        <span className="truncate">{target}</span>
                      </ReadonlyValueField>
                    </div>
                  </div>
                  {extras.length > 0 ? (
                    <div className={`${PROPERTY_EDITOR_HELPER_TEXT_CLASS} mt-1`}>
                      {labels.extra}: {extras.join(', ')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{labels.none}</div>
        )}
      </StaticSection>

      <StaticSection title={labels.actuators}>
        {data.actuatorNames.length > 0 ? (
          <div className="space-y-1">
            {data.actuatorNames.map((actuatorName) => (
              <ReadonlyValueField
                key={actuatorName}
                className="bg-element-bg text-[10px] font-medium"
              >
                {actuatorName}
              </ReadonlyValueField>
            ))}
          </div>
        ) : (
          <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{labels.none}</div>
        )}
      </StaticSection>
    </div>
  );
};
