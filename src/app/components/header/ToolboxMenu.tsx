import React from 'react';
import { Activity, ArrowUpRight, Box, RefreshCw, Ruler, ScanSearch } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n/types';
import { useEffectiveTheme } from '@/shared/hooks/useEffectiveTheme';

interface ToolboxMenuProps {
  t: TranslationKeys;
  onClose: () => void;
  onOpenAI: () => void;
  onOpenMeasureTool: () => void;
  onOpenCollisionOptimizer: () => void;
}

type ToolboxItemTone = 'primary' | 'neutral' | 'logo';

interface ToolboxItem {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  external?: boolean;
  tone?: ToolboxItemTone;
}

function ToolboxItemCard({
  item,
  isActive,
  onHoverStart,
  onHoverEnd,
}: {
  item: ToolboxItem;
  isActive: boolean;
  onHoverStart: (item: ToolboxItem) => void;
  onHoverEnd: () => void;
}) {
  const iconToneClassName =
    item.tone === 'primary'
      ? `${isActive ? 'border-system-blue-solid bg-system-blue-solid text-white scale-[1.04]' : 'text-system-blue'} group-hover:border-system-blue-solid group-hover:bg-system-blue-solid group-hover:text-white group-hover:scale-[1.04] group-focus-visible:border-system-blue-solid group-focus-visible:bg-system-blue-solid group-focus-visible:text-white group-focus-visible:scale-[1.04]`
      : item.tone === 'logo'
        ? `${isActive ? 'border-system-blue/35 bg-system-blue/10 scale-[1.04]' : 'overflow-hidden'} group-hover:border-system-blue/35 group-hover:bg-system-blue/10 group-hover:scale-[1.04] group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/10 group-focus-visible:scale-[1.04]`
        : `${isActive ? 'border-system-blue/35 bg-system-blue/10 text-system-blue scale-[1.04]' : 'text-text-secondary'} group-hover:border-system-blue/35 group-hover:bg-system-blue/10 group-hover:text-system-blue group-hover:scale-[1.04] group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/10 group-focus-visible:text-system-blue group-focus-visible:scale-[1.04]`;

  return (
    <button
      type="button"
      onClick={item.onClick}
      onPointerEnter={() => onHoverStart(item)}
      onPointerLeave={onHoverEnd}
      onFocus={() => onHoverStart(item)}
      onBlur={onHoverEnd}
      aria-label={item.title}
      className={`group relative flex min-h-[3.55rem] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-center transition-all duration-100 hover:-translate-y-0.5 hover:bg-element-hover/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        isActive ? '-translate-y-0.5 bg-element-hover/90 shadow-sm' : ''
      }`}
    >
      {item.external && (
        <span
          className={`absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-panel-bg/90 text-text-tertiary transition-all duration-100 ${
            isActive
              ? 'translate-y-0 opacity-100 text-system-blue'
              : '-translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-hover:text-system-blue group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:text-system-blue'
          }`}
        >
          <ArrowUpRight className="h-2.5 w-2.5" />
        </span>
      )}

      <span
        className={`flex h-8 w-8 items-center justify-center rounded-[0.9rem] border border-border-black bg-panel-bg shadow-sm transition-all duration-100 ${iconToneClassName}`}
      >
        {item.icon}
      </span>

      <span
        className={`line-clamp-2 text-[10px] font-semibold leading-tight transition-colors duration-100 ${
          isActive ? 'text-system-blue' : 'text-text-primary'
        }`}
      >
        {item.title}
      </span>
    </button>
  );
}

export function ToolboxMenu({
  t,
  onClose,
  onOpenAI,
  onOpenMeasureTool,
  onOpenCollisionOptimizer,
}: ToolboxMenuProps) {
  const [hoveredItemKey, setHoveredItemKey] = React.useState<string | null>(null);
  const effectiveTheme = useEffectiveTheme();
  const motrixLogoSrc =
    effectiveTheme === 'dark' ? '/logos/motrix-logo-white.svg' : '/logos/motrix-logo.svg';

  const openExternal = React.useCallback(
    (url: string) => {
      onClose();
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [onClose],
  );

  const openAI = React.useCallback(() => {
    onClose();
    onOpenAI();
  }, [onClose, onOpenAI]);

  const openCollisionOptimizer = React.useCallback(() => {
    onClose();
    onOpenCollisionOptimizer();
  }, [onClose, onOpenCollisionOptimizer]);

  const openMeasureTool = React.useCallback(() => {
    onClose();
    onOpenMeasureTool();
  }, [onClose, onOpenMeasureTool]);

  const items: ToolboxItem[] = [
    {
      key: 'ai',
      title: t.aiAssistant,
      description: t.aiAssistantDesc,
      icon: <ScanSearch className="h-[18px] w-[18px]" />,
      onClick: openAI,
      tone: 'primary',
    },
    {
      key: 'measure',
      title: t.measureMode,
      description: t.measureToolboxDesc,
      icon: <Ruler className="h-[18px] w-[18px]" />,
      onClick: openMeasureTool,
      tone: 'primary',
    },
    {
      key: 'collision-optimizer',
      title: t.collisionOptimizerDialog,
      description: t.collisionOptimizerToolboxDesc,
      icon: <Box className="h-[18px] w-[18px]" />,
      onClick: openCollisionOptimizer,
      tone: 'primary',
    },
    {
      key: 'motion-tracking',
      title: t.robotRedirect,
      description: t.motionTrackingDesc,
      icon: <RefreshCw className="h-[18px] w-[18px]" />,
      onClick: () => openExternal('https://motion-tracking.axell.top/'),
      external: true,
      tone: 'neutral',
    },
    {
      key: 'step2urdf',
      title: t.step2urdf,
      description: t.step2urdfDesc,
      icon: <img src="/logos/step2urdf-logo.svg" alt="" className="h-5 w-5 object-contain" />,
      onClick: () => openExternal('https://step2urdf.top/'),
      external: true,
      tone: 'logo',
    },
    {
      key: 'motrix',
      title: t.motrix,
      description: t.motrixDesc,
      icon: <img src={motrixLogoSrc} alt="" className="h-5 w-5 object-contain" />,
      onClick: () => openExternal('https://motrix.motphys.com/'),
      external: true,
      tone: 'logo',
    },
    {
      key: 'trajectory-editing',
      title: t.trajectoryEditing,
      description: t.trajectoryEditingDesc,
      icon: <Activity className="h-[18px] w-[18px]" />,
      onClick: () => openExternal('https://motion-editor.cyoahs.dev/'),
      external: true,
      tone: 'neutral',
    },
    {
      key: 'bridgedp',
      title: t.bridgedpEngine,
      description: t.bridgedpEngineDesc,
      icon: <img src="/logos/bridgedp-logo.png" alt="" className="h-5 w-5 object-contain" />,
      onClick: () => openExternal('https://engine.bridgedp.com/'),
      external: true,
      tone: 'logo',
    },
  ];

  const hoveredItem = React.useMemo(
    () => items.find((item) => item.key === hoveredItemKey) ?? null,
    [items, hoveredItemKey],
  );

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 z-50 mt-1 w-[15.5rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-border-black bg-panel-bg p-2 shadow-xl dark:shadow-black">
        <div className="grid grid-cols-3 gap-x-1.5 gap-y-1">
          {items.map((item) => (
            <ToolboxItemCard
              key={item.key}
              item={item}
              isActive={hoveredItemKey === item.key}
              onHoverStart={(nextItem) => setHoveredItemKey(nextItem.key)}
              onHoverEnd={() =>
                setHoveredItemKey((currentKey) => (currentKey === item.key ? null : currentKey))
              }
            />
          ))}
        </div>
        <div className="mt-1.5 min-h-8 border-t border-border-black/70 px-1 pt-1.5">
          <div className="ui-static-copy-guard text-[10px] leading-4 text-text-tertiary transition-all duration-75">
            {hoveredItem ? hoveredItem.description : t.toolboxHoverHint}
          </div>
        </div>
      </div>
    </>
  );
}
