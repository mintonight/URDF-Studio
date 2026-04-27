import { Camera, Globe, Moon, Monitor, Settings, Sun } from 'lucide-react';
import type { Theme } from '@/types';
import type {
  HeaderAction,
  HeaderResponsiveLayout,
  HeaderTranslations,
  HeaderMenuKey,
} from './types';
import { HeaderOverflowMenu } from './HeaderOverflowMenu';

interface HeaderActionsProps {
  responsive: HeaderResponsiveLayout;
  lang: 'en' | 'zh';
  theme: Theme;
  canUndo: boolean;
  canRedo: boolean;
  activeMenu: HeaderMenuKey;
  setActiveMenu: (menu: HeaderMenuKey) => void;
  setLang: (lang: 'en' | 'zh') => void;
  setTheme: (theme: Theme) => void;
  undo: () => void;
  redo: () => void;
  quickAction?: HeaderAction;
  secondaryAction?: HeaderAction;
  onOpenCodeViewer: () => void;
  onPrefetchCodeViewer: () => void;
  onSnapshot: () => void;
  onOpenSettings: () => void;
  t: HeaderTranslations;
}

export function HeaderActions({
  responsive,
  lang,
  theme,
  canUndo,
  canRedo,
  activeMenu,
  setActiveMenu,
  setLang,
  setTheme,
  undo,
  redo,
  quickAction,
  secondaryAction,
  onOpenCodeViewer,
  onPrefetchCodeViewer,
  onSnapshot,
  onOpenSettings,
  t,
}: HeaderActionsProps) {
  const {
    showQuickActionInline,
    showQuickActionLabel,
    showSnapshotInline,
    showSettingsInline,
    showLanguageInline,
    showThemeInline,
    showSecondaryActionInline,
    showSecondaryActionLabel,
    showDesktopOverflow,
  } = responsive;
  const QuickActionIcon = quickAction?.icon;
  const SecondaryActionIcon = secondaryAction?.icon;

  return (
    <div className="flex items-center gap-0.5 shrink-0 justify-self-end">
      {showQuickActionInline && quickAction && QuickActionIcon && (
        <button
          type="button"
          onClick={quickAction.onClick}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-system-blue dark:text-white hover:bg-system-blue-solid hover:text-white dark:hover:bg-system-blue-solid transition-colors hidden sm:flex"
          title={quickAction.title ?? quickAction.label}
          aria-label={quickAction.title ?? quickAction.label}
        >
          <QuickActionIcon className="w-4 h-4" />
          {showQuickActionLabel && <span>{quickAction.label}</span>}
        </button>
      )}

      {showSnapshotInline && (
        <button
          type="button"
          onClick={onSnapshot}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-colors hidden sm:flex"
          title={t.snapshot}
          aria-label={t.snapshot}
        >
          <Camera className="w-4 h-4" />
        </button>
      )}

      {showLanguageInline && (
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-colors hidden sm:flex"
          title={t.switchLanguage}
          aria-label={t.switchLanguage}
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold">{lang === 'en' ? 'EN' : '中'}</span>
        </button>
      )}

      {showThemeInline && (
        <button
          type="button"
          onClick={() => {
            if (theme === 'system') {
              const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              setTheme(isSystemDark ? 'light' : 'dark');
            } else {
              setTheme(theme === 'dark' ? 'light' : 'dark');
            }
          }}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-colors hidden sm:flex"
          title={t.toggleTheme}
          aria-label={t.toggleTheme}
        >
          {theme === 'system' ? (
            <Monitor className="w-4 h-4" />
          ) : theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
      )}

      {(showThemeInline || showDesktopOverflow) && (
        <div className="w-px h-5 bg-border-black mx-1 hidden sm:block" />
      )}

      {showDesktopOverflow && (
        <HeaderOverflowMenu
          className="hidden sm:block"
          lang={lang}
          theme={theme}
          canUndo={canUndo}
          canRedo={canRedo}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          setLang={setLang}
          setTheme={setTheme}
          undo={undo}
          redo={redo}
          quickAction={quickAction}
          secondaryAction={secondaryAction}
          onOpenCodeViewer={onOpenCodeViewer}
          onPrefetchCodeViewer={onPrefetchCodeViewer}
          onSnapshot={onSnapshot}
          onOpenSettings={onOpenSettings}
          t={t}
          showQuickAction={Boolean(quickAction) && !showQuickActionInline}
          showSourceCode={!responsive.showSourceInline}
          showUndoRedo={!responsive.showUndoRedoInline}
          showSnapshot={!showSnapshotInline}
          showSettings={!showSettingsInline}
          showLanguage={!showLanguageInline}
          showTheme={!showThemeInline}
          showSecondaryAction={Boolean(secondaryAction) && !showSecondaryActionInline}
        />
      )}

      {showSecondaryActionInline && secondaryAction && SecondaryActionIcon && (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-system-blue dark:text-white hover:bg-system-blue-solid hover:text-white dark:hover:bg-system-blue-solid transition-colors hidden sm:flex"
          title={secondaryAction.title ?? secondaryAction.label}
          aria-label={secondaryAction.title ?? secondaryAction.label}
        >
          <SecondaryActionIcon className="w-4 h-4" />
          {showSecondaryActionLabel && <span>{secondaryAction.label}</span>}
        </button>
      )}

      {showSettingsInline && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-slate-200 transition-colors hidden sm:flex"
          title={t.settings}
          aria-label={t.settings}
        >
          <Settings className="w-4 h-4" />
        </button>
      )}

      <HeaderOverflowMenu
        className="sm:hidden"
        lang={lang}
        theme={theme}
        canUndo={canUndo}
        canRedo={canRedo}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        setLang={setLang}
        setTheme={setTheme}
        undo={undo}
        redo={redo}
        quickAction={quickAction}
        secondaryAction={secondaryAction}
        onOpenCodeViewer={onOpenCodeViewer}
        onPrefetchCodeViewer={onPrefetchCodeViewer}
        onSnapshot={onSnapshot}
        onOpenSettings={onOpenSettings}
        t={t}
        showQuickAction={Boolean(quickAction)}
        showSourceCode
        showUndoRedo
        showSnapshot
        showSettings
        showLanguage
        showTheme
        showSecondaryAction={Boolean(secondaryAction)}
      />
    </div>
  );
}
