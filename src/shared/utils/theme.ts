import type { Theme } from '@/types';

export type ResolvedTheme = 'light' | 'dark';

const THEME_TRANSITION_CLASS = 'theme-switching';
const THEME_TRANSITION_DURATION_MS = 220;

let themeTransitionTimeout: number | undefined;

function canUseDocument(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getSystemTheme(): ResolvedTheme {
  if (!canUseDocument() || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function prefersReducedMotion(): boolean {
  return (
    canUseDocument() &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

function beginThemeTransition(root: HTMLElement): void {
  if (themeTransitionTimeout !== undefined) {
    window.clearTimeout(themeTransitionTimeout);
  }

  root.classList.add(THEME_TRANSITION_CLASS);
  void root.offsetWidth;

  themeTransitionTimeout = window.setTimeout(() => {
    root.classList.remove(THEME_TRANSITION_CLASS);
    themeTransitionTimeout = undefined;
  }, THEME_TRANSITION_DURATION_MS);
}

export function applyDocumentTheme(
  theme: Theme | ResolvedTheme,
  options: { animate?: boolean } = {},
): ResolvedTheme {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  if (!canUseDocument()) {
    return resolvedTheme;
  }

  const root = document.documentElement;
  const shouldUseDarkClass = resolvedTheme === 'dark';
  const isChangingTheme = root.classList.contains('dark') !== shouldUseDarkClass;

  if (options.animate === true && isChangingTheme && !prefersReducedMotion()) {
    beginThemeTransition(root);
  }

  root.classList.toggle('dark', shouldUseDarkClass);
  root.dataset.theme = resolvedTheme;

  return resolvedTheme;
}
