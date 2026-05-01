import {
  Camera,
  Code,
  Globe,
  Moon,
  Monitor,
  MoreHorizontal,
  Redo,
  Settings,
  Sun,
  Undo,
} from 'lucide-react';
import { HeaderMenuItem, HeaderMenuSeparator } from './HeaderMenuItem';
import type { HeaderOverflowMenuProps } from './types';

export function HeaderOverflowMenu({
  className = '',
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
  showQuickAction,
  showSourceCode,
  showUndoRedo,
  showSnapshot,
  showSettings,
  showLanguage,
  showTheme,
  showSecondaryAction,
}: HeaderOverflowMenuProps) {
  const QuickActionIcon = quickAction?.icon;
  const SecondaryActionIcon = secondaryAction?.icon;
  const showPrimaryGroup = showQuickAction || showSourceCode || showUndoRedo;
  const showSecondaryGroup =
    showSnapshot || showSettings || showLanguage || showTheme || showSecondaryAction;

  return (
    <div className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setActiveMenu(activeMenu === 'more' ? null : 'more')}
        className={`relative z-50 flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
          activeMenu === 'more'
            ? 'bg-element-bg dark:bg-element-active text-text-primary dark:text-white'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg'
        }`}
        title={t.more}
        aria-label={t.more}
        aria-haspopup="menu"
        aria-expanded={activeMenu === 'more'}
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {activeMenu === 'more' && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
          <div
            className="absolute top-full right-0 mt-1 w-auto min-w-[10.5rem] bg-panel-bg dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-border-black z-50 overflow-hidden py-1"
            role="menu"
            aria-label={t.more}
          >
            {showPrimaryGroup && (
              <>
                {showQuickAction && quickAction && QuickActionIcon && (
                  <HeaderMenuItem
                    icon={QuickActionIcon}
                    onClick={(event) => {
                      quickAction.onClick(event);
                      setActiveMenu(null);
                    }}
                  >
                    {quickAction.label}
                  </HeaderMenuItem>
                )}
                {showSourceCode && (
                  <HeaderMenuItem
                    icon={Code}
                    onClick={() => {
                      onOpenCodeViewer();
                      setActiveMenu(null);
                    }}
                    onMouseEnter={onPrefetchCodeViewer}
                    onFocus={onPrefetchCodeViewer}
                    onTouchStart={onPrefetchCodeViewer}
                  >
                    {t.sourceCode}
                  </HeaderMenuItem>
                )}
                {showUndoRedo && (
                  <>
                    <HeaderMenuItem
                      icon={Undo}
                      onClick={() => {
                        undo();
                        setActiveMenu(null);
                      }}
                      disabled={!canUndo}
                    >
                      {t.undo}
                    </HeaderMenuItem>
                    <HeaderMenuItem
                      icon={Redo}
                      onClick={() => {
                        redo();
                        setActiveMenu(null);
                      }}
                      disabled={!canRedo}
                    >
                      {t.redo}
                    </HeaderMenuItem>
                  </>
                )}
              </>
            )}

            {showPrimaryGroup && showSecondaryGroup && (
              <HeaderMenuSeparator />
            )}

            {showSecondaryGroup && (
              <>
                {showSecondaryAction && secondaryAction && SecondaryActionIcon && (
                  <HeaderMenuItem
                    icon={SecondaryActionIcon}
                    onClick={(event) => {
                      secondaryAction.onClick(event);
                      setActiveMenu(null);
                    }}
                  >
                    {secondaryAction.label}
                  </HeaderMenuItem>
                )}
                {showSnapshot && (
                  <HeaderMenuItem
                    icon={Camera}
                    onClick={() => {
                      onSnapshot();
                      setActiveMenu(null);
                    }}
                  >
                    {t.snapshot}
                  </HeaderMenuItem>
                )}
                {showSettings && (
                  <HeaderMenuItem
                    icon={Settings}
                    onClick={() => {
                      onOpenSettings();
                      setActiveMenu(null);
                    }}
                  >
                    {t.settings}
                  </HeaderMenuItem>
                )}
                {showLanguage && (
                  <HeaderMenuItem
                    icon={Globe}
                    onClick={() => {
                      setLang(lang === 'en' ? 'zh' : 'en');
                      setActiveMenu(null);
                    }}
                  >
                    {t.switchLanguage}
                  </HeaderMenuItem>
                )}
                {showTheme && (
                  <HeaderMenuItem
                    icon={theme === 'system' ? Monitor : theme === 'dark' ? Sun : Moon}
                    onClick={() => {
                      if (theme === 'system') {
                        const isSystemDark = window.matchMedia(
                          '(prefers-color-scheme: dark)',
                        ).matches;
                        setTheme(isSystemDark ? 'light' : 'dark');
                      } else {
                        setTheme(theme === 'dark' ? 'light' : 'dark');
                      }
                      setActiveMenu(null);
                    }}
                  >
                    {t.toggleTheme}
                  </HeaderMenuItem>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
