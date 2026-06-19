/**
 * App Providers - Initialization and side effects wrapper
 * Handles theme, language, and other global initializations
 */
import { useEffect, useMemo } from 'react';
import { useUIStore } from '@/store';
import { useSelectionStore } from '@/store/selectionStore';
import { useShallow } from 'zustand/react/shallow';
import { translations } from '@/shared/i18n';
import { EffectiveThemeProvider, useResolvedTheme } from '@/shared/hooks/useEffectiveTheme';
import { OverlayHoverBlockProvider } from '@/shared/hooks/useOverlayHoverBlock';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Providers component that handles global initializations
 * - Theme application (dark mode class)
 * - Language-based document title
 */
export function Providers({ children }: ProvidersProps) {
  const { theme, lang } = useUIStore(
    useShallow((state) => ({
      theme: state.theme,
      lang: state.lang,
    })),
  );
  const { beginHoverBlock, endHoverBlock, clearHover } = useSelectionStore(
    useShallow((state) => ({
      beginHoverBlock: state.beginHoverBlock,
      endHoverBlock: state.endHoverBlock,
      clearHover: state.clearHover,
    })),
  );
  const t = translations[lang];
  const effectiveTheme = useResolvedTheme(theme);
  const overlayHoverBlockActions = useMemo(
    () => ({
      beginHoverBlock,
      endHoverBlock,
      clearHover,
    }),
    [beginHoverBlock, clearHover, endHoverBlock],
  );

  // Apply theme class to document
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const applyThemeClass = () => {
      const isDark = theme === 'dark' || 
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    
    // Apply immediately
    applyThemeClass();
    
    // Listen for system theme changes when theme is 'system'
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyThemeClass();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Update document title based on language
  useEffect(() => {
    document.title = t.documentTitle;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.setAttribute('data-lang', lang);

    // Keep the canonical link aligned with the active language variant.
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute(
        'href',
        lang === 'zh' ? 'https://urdf.enkeebot.com/zh/' : 'https://urdf.enkeebot.com/',
      );
    }
  }, [lang, t]);

  return (
    <EffectiveThemeProvider value={effectiveTheme}>
      <OverlayHoverBlockProvider value={overlayHoverBlockActions}>
        {children}
      </OverlayHoverBlockProvider>
    </EffectiveThemeProvider>
  );
}

export default Providers;
