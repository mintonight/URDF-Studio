/**
 * UI Store - Manages UI-related state
 * Handles app mode, view options, panel visibility, theme, language, etc.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppMode, DetailLinkTab, Theme } from '@/types';
import { translations } from '@/shared/i18n';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';

// Language type
export type Language = 'en' | 'zh';
export type RotationDisplayMode = 'euler_deg' | 'euler_rad' | 'quaternion';
export type GlobalFontSize = 'small' | 'medium' | 'large';
export type CodeEditorFontFamily = 'jetbrains-mono' | 'fira-code' | 'system-mono';
export type MassInertiaChangeBehavior = 'ask' | 'preserve' | 'reestimate';

// View configuration for different modes
export interface ViewConfig {
  showOptionsPanel: boolean; // For viewer scene options
  showJointPanel: boolean;
}

// View options for 3D visualization
export interface ViewOptions {
  showGrid: boolean;
  showAxes: boolean;
  showUsageGuide: boolean;
  showMjcfWorldLink: boolean;
  showIkHandles: boolean;
  showJointAxes: boolean;
  showInertia: boolean;
  showCenterOfMass: boolean;
  showCollision: boolean;
  modelOpacity: number;
}

// Panel visibility state
export interface PanelsState {
  codeEditor: boolean;
  aiAssistant: boolean;
}

// Sidebar collapse state
export interface SidebarState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export interface PanelLayoutState {
  propertyEditorWidth: number;
  treeFileBrowserHeight: number;
  treeJointPanelHeight: number;
  treeSidebarWidth: number;
}

interface UIState {
  // App mode
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  // Theme (light/dark/system)
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Language (en/zh)
  lang: Language;
  setLang: (lang: Language) => void;

  // View configuration
  viewConfig: ViewConfig;
  setViewConfig: <K extends keyof ViewConfig>(key: K, value: ViewConfig[K]) => void;

  // View options for 3D scene
  viewOptions: ViewOptions;
  setViewOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;

  // Ground plane offset (Z position)
  groundPlaneOffset: number;
  setGroundPlaneOffset: (offset: number) => void;

  // Panel visibility
  panels: PanelsState;
  togglePanel: (panel: keyof PanelsState) => void;
  setPanel: (panel: keyof PanelsState, open: boolean) => void;

  // Sidebar collapse
  sidebar: SidebarState;
  toggleSidebar: (side: 'left' | 'right') => void;
  setSidebar: (side: 'left' | 'right', collapsed: boolean) => void;

  // Sidebar Tab (structure/workspace)
  sidebarTab: 'structure' | 'workspace';
  setSidebarTab: (tab: 'structure' | 'workspace') => void;

  // Resizable panel layout
  panelLayout: PanelLayoutState;
  setPanelLayout: <K extends keyof PanelLayoutState>(key: K, value: PanelLayoutState[K]) => void;

  // Settings modal
  isSettingsOpen: boolean;
  settingsPos: { x: number; y: number };
  openSettings: (pos?: { x: number; y: number }) => void;
  closeSettings: () => void;
  setSettingsPos: (pos: { x: number; y: number }) => void;

  // OS detection
  os: 'mac' | 'win';
  setOs: (os: 'mac' | 'win') => void;

  // Import warning
  showImportWarning: boolean;
  setShowImportWarning: (show: boolean) => void;

  // Panel Sections (collapsed state)
  panelSections: Record<string, boolean>;
  setPanelSection: (section: string, collapsed: boolean) => void;

  // Font Size Preference
  fontSize: GlobalFontSize;
  setFontSize: (size: GlobalFontSize) => void;

  // Source code editor typography
  codeEditorFontFamily: CodeEditorFontFamily;
  setCodeEditorFontFamily: (fontFamily: CodeEditorFontFamily) => void;
  codeEditorFontSize: number;
  setCodeEditorFontSize: (size: number) => void;

  // Source code editor
  sourceCodeAutoApply: boolean;
  setSourceCodeAutoApply: (enabled: boolean) => void;

  // Property editor rotation format
  rotationDisplayMode: RotationDisplayMode;
  setRotationDisplayMode: (mode: RotationDisplayMode) => void;

  // Property editor mass/inertia confirmation preference
  massInertiaChangeBehavior: MassInertiaChangeBehavior;
  setMassInertiaChangeBehavior: (behavior: MassInertiaChangeBehavior) => void;

  // Editor link property tab
  detailLinkTab: DetailLinkTab;
  setDetailLinkTab: (tab: DetailLinkTab) => void;

  // Structure tree geometry detail disclosure
  structureTreeShowGeometryDetails: boolean;
  setStructureTreeShowGeometryDetails: (show: boolean) => void;
}

// Default values
const defaultViewConfig: ViewConfig = {
  showOptionsPanel: true,
  showJointPanel: true,
};

const defaultViewOptions: ViewOptions = {
  showGrid: true,
  showAxes: true,
  showUsageGuide: true,
  showMjcfWorldLink: true,
  showIkHandles: false,
  showJointAxes: false,
  showInertia: false,
  showCenterOfMass: false,
  showCollision: false,
  modelOpacity: 1,
};

const defaultPanels: PanelsState = {
  codeEditor: false,
  aiAssistant: false,
};

const defaultSidebar: SidebarState = {
  leftCollapsed: false,
  rightCollapsed: false,
};

const defaultPanelLayout: PanelLayoutState = {
  propertyEditorWidth: 248,
  treeFileBrowserHeight: 216,
  treeJointPanelHeight: 132,
  treeSidebarWidth: 264,
};

const normalizeDetailLinkTab = (value: unknown): DetailLinkTab =>
  value === 'collision' || value === 'physics'
    ? value
    : value === 'material' || value === 'joint'
      ? value === 'joint'
        ? 'physics'
        : 'visual'
      : 'visual';

// Detect system language
const getSystemLang = (): Language => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('language');
    if (saved === 'en' || saved === 'zh') {
      return saved;
    }
    const systemLang =
      navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage;
    if (systemLang && systemLang.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  }
  return 'en';
};

// Detect OS
const detectOs = (): 'mac' | 'win' => {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    const userAgentDataPlatform =
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string };
        }
      ).userAgentData?.platform?.toLowerCase() || '';
    const osHint = `${userAgentDataPlatform} ${userAgent}`;

    if (osHint.includes('mac') || osHint.includes('darwin')) {
      return 'mac';
    }
  }
  return 'win';
};

// Get saved theme or default
const getSavedTheme = (): Theme => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
  }
  return 'system';
};

// Get saved sidebar state
const getSavedSidebar = (): SidebarState => {
  if (typeof window !== 'undefined') {
    return {
      leftCollapsed: localStorage.getItem('leftSidebarCollapsed') === 'true',
      rightCollapsed: localStorage.getItem('rightSidebarCollapsed') === 'true',
    };
  }
  return defaultSidebar;
};

// Helper to apply font size (affects text size via CSS variable)
const DEFAULT_GLOBAL_FONT_SIZE: GlobalFontSize = 'medium';
const DEFAULT_CODE_EDITOR_FONT_FAMILY: CodeEditorFontFamily = 'jetbrains-mono';
const DEFAULT_CODE_EDITOR_FONT_SIZE = 13;
const MIN_CODE_EDITOR_FONT_SIZE = 11;
const MAX_CODE_EDITOR_FONT_SIZE = 24;

const normalizeGlobalFontSize = (value: unknown): GlobalFontSize =>
  value === 'small' || value === 'large' ? value : 'medium';

const normalizeCodeEditorFontFamily = (value: unknown): CodeEditorFontFamily =>
  value === 'fira-code' || value === 'system-mono' ? value : 'jetbrains-mono';

const normalizeMassInertiaChangeBehavior = (value: unknown): MassInertiaChangeBehavior =>
  value === 'preserve' || value === 'reestimate' ? value : 'ask';

const clampCodeEditorFontSize = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CODE_EDITOR_FONT_SIZE;
  }

  return Math.round(
    Math.min(MAX_CODE_EDITOR_FONT_SIZE, Math.max(MIN_CODE_EDITOR_FONT_SIZE, parsed)),
  );
};

const applyFontSize = (fontSize: GlobalFontSize) => {
  if (typeof window === 'undefined') return;
  let scale: number;
  switch (fontSize) {
    case 'small':
      scale = 0.85;
      break; // 85%
    case 'large':
      scale = 1.25;
      break; // 125%
    case 'medium':
    default:
      scale = 1.0;
      break; // 100%
  }
  document.documentElement.style.setProperty('--font-scale', scale.toString());
  document.documentElement.setAttribute('data-font-size', fontSize);
};

// Helper to apply theme
const applyTheme = (theme: Theme) => {
  if (typeof window === 'undefined') return;

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // App mode
      appMode: normalizeMergedAppMode('editor'),
      setAppMode: (mode) => set({ appMode: normalizeMergedAppMode(mode) }),

      // Theme
      theme: getSavedTheme(),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      // Language
      lang: getSystemLang(),
      setLang: (lang) => {
        // Update document title
        document.title = translations[lang].documentTitle;
        set({ lang });
      },

      // View configuration
      viewConfig: defaultViewConfig,
      setViewConfig: (key, value) =>
        set((state) => ({
          viewConfig: { ...state.viewConfig, [key]: value },
        })),

      // View options
      viewOptions: defaultViewOptions,
      setViewOption: (key, value) =>
        set((state) => ({
          viewOptions: { ...state.viewOptions, [key]: value },
        })),

      // Ground plane offset
      groundPlaneOffset: 0,
      setGroundPlaneOffset: (offset) => set({ groundPlaneOffset: offset }),

      // Panels
      panels: defaultPanels,
      togglePanel: (panel) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: !state.panels[panel] },
        })),
      setPanel: (panel, open) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: open },
        })),

      // Sidebar
      sidebar: getSavedSidebar(),
      toggleSidebar: (side) =>
        set((state) => {
          const key = side === 'left' ? 'leftCollapsed' : 'rightCollapsed';
          const newValue = !state.sidebar[key];
          // Persist to localStorage
          localStorage.setItem(
            side === 'left' ? 'leftSidebarCollapsed' : 'rightSidebarCollapsed',
            String(newValue),
          );
          return {
            sidebar: { ...state.sidebar, [key]: newValue },
          };
        }),
      setSidebar: (side, collapsed) =>
        set((state) => {
          const key = side === 'left' ? 'leftCollapsed' : 'rightCollapsed';
          localStorage.setItem(
            side === 'left' ? 'leftSidebarCollapsed' : 'rightSidebarCollapsed',
            String(collapsed),
          );
          return {
            sidebar: { ...state.sidebar, [key]: collapsed },
          };
        }),

      // Sidebar Tab
      sidebarTab: 'structure',
      setSidebarTab: (tab) => set({ sidebarTab: tab }),

      // Resizable panel layout
      panelLayout: defaultPanelLayout,
      setPanelLayout: (key, value) =>
        set((state) => ({
          panelLayout: { ...state.panelLayout, [key]: value },
        })),

      // Settings modal
      isSettingsOpen: false,
      settingsPos: { x: 0, y: 0 }, // Will be calculated on open
      openSettings: (pos) =>
        set((state) => {
          let newPos = pos;
          // Only calculate center if no pos provided AND current pos is default (0,0)
          if (!newPos && state.settingsPos.x === 0 && state.settingsPos.y === 0) {
            if (typeof window !== 'undefined') {
              const defaultWidth = 580;
              const defaultHeight = 420;
              newPos = {
                x: Math.max(12, window.innerWidth / 2 - defaultWidth / 2),
                y: Math.max(12, window.innerHeight / 2 - defaultHeight / 2),
              };
            } else {
              newPos = { x: 100, y: 100 };
            }
          }
          return {
            isSettingsOpen: true,
            settingsPos: newPos || state.settingsPos,
          };
        }),
      closeSettings: () => set({ isSettingsOpen: false }),
      setSettingsPos: (pos) => set({ settingsPos: pos }),

      // OS detection
      os: detectOs(),
      setOs: (os) => set({ os }),

      // Import warning
      showImportWarning: true,
      setShowImportWarning: (show) => set({ showImportWarning: show }),

      // Panel Sections
      panelSections: {},
      setPanelSection: (section, collapsed) =>
        set((state) => ({
          panelSections: { ...state.panelSections, [section]: collapsed },
        })),

      // Font Size
      fontSize: DEFAULT_GLOBAL_FONT_SIZE,
      setFontSize: (size) => {
        applyFontSize(size);
        set({ fontSize: size });
      },

      // Source code editor typography
      codeEditorFontFamily: DEFAULT_CODE_EDITOR_FONT_FAMILY,
      setCodeEditorFontFamily: (codeEditorFontFamily) =>
        set({ codeEditorFontFamily: normalizeCodeEditorFontFamily(codeEditorFontFamily) }),
      codeEditorFontSize: DEFAULT_CODE_EDITOR_FONT_SIZE,
      setCodeEditorFontSize: (codeEditorFontSize) =>
        set({ codeEditorFontSize: clampCodeEditorFontSize(codeEditorFontSize) }),

      // Source code editor
      sourceCodeAutoApply: false,
      setSourceCodeAutoApply: (sourceCodeAutoApply) => set({ sourceCodeAutoApply }),

      // Property editor rotation format
      rotationDisplayMode: 'euler_deg',
      setRotationDisplayMode: (rotationDisplayMode) => set({ rotationDisplayMode }),

      // Property editor mass/inertia confirmation preference
      massInertiaChangeBehavior: 'ask',
      setMassInertiaChangeBehavior: (massInertiaChangeBehavior) =>
        set({
          massInertiaChangeBehavior: normalizeMassInertiaChangeBehavior(massInertiaChangeBehavior),
        }),

      // Editor link property tab
      detailLinkTab: 'visual',
      setDetailLinkTab: (detailLinkTab) =>
        set({ detailLinkTab: normalizeDetailLinkTab(detailLinkTab) }),

      // Structure tree geometry detail disclosure
      structureTreeShowGeometryDetails: false,
      setStructureTreeShowGeometryDetails: (structureTreeShowGeometryDetails) =>
        set({ structureTreeShowGeometryDetails }),
    }),
    {
      name: 'urdf-studio-ui',
      version: 17,
      migrate: (persistedState: unknown, persistedVersion) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }

        const state = persistedState as {
          panelLayout?: Partial<PanelLayoutState>;
          viewOptions?: Partial<ViewOptions>;
          detailLinkTab?: unknown;
          fontSize?: unknown;
          codeEditorFontFamily?: unknown;
          codeEditorFontSize?: unknown;
          massInertiaChangeBehavior?: unknown;
        };

        const migratedViewOptions: ViewOptions = {
          ...defaultViewOptions,
          ...state.viewOptions,
        };

        // Earlier builds persisted MJCF world visibility as enabled by default.
        // Reset upgraded sessions to the current hidden-by-default behavior so
        // MJCF ground/world geometry stays opt-in unless the user toggles it again.
        if ((persistedVersion ?? 0) < 14) {
          migratedViewOptions.showMjcfWorldLink = false;
        }

        // IK handles should stay opt-in. Older sessions could carry them as
        // always-visible, which leaves a green helper ball on first load.
        if ((persistedVersion ?? 0) < 15) {
          migratedViewOptions.showIkHandles = false;
        }

        // MJCF world link (ground plane) should be visible by default.
        // Earlier migrations (v14) forced this to false; reset to true so
        // imported MJCF scenes show their floor immediately.
        if ((persistedVersion ?? 0) < 16) {
          migratedViewOptions.showMjcfWorldLink = true;
        }

        return {
          ...state,
          viewOptions: migratedViewOptions,
          panelLayout: {
            ...defaultPanelLayout,
            ...state.panelLayout,
          },
          fontSize: normalizeGlobalFontSize(state.fontSize),
          codeEditorFontFamily: normalizeCodeEditorFontFamily(state.codeEditorFontFamily),
          codeEditorFontSize: clampCodeEditorFontSize(state.codeEditorFontSize),
          massInertiaChangeBehavior: normalizeMassInertiaChangeBehavior(
            state.massInertiaChangeBehavior,
          ),
          detailLinkTab: normalizeDetailLinkTab(state.detailLinkTab),
        };
      },
      partialize: (state) => ({
        theme: state.theme,
        lang: state.lang,
        sidebar: state.sidebar,
        viewOptions: state.viewOptions,
        panelLayout: state.panelLayout,
        showImportWarning: state.showImportWarning,
        panelSections: state.panelSections,
        fontSize: state.fontSize,
        codeEditorFontFamily: state.codeEditorFontFamily,
        codeEditorFontSize: state.codeEditorFontSize,
        sourceCodeAutoApply: state.sourceCodeAutoApply,
        rotationDisplayMode: state.rotationDisplayMode,
        massInertiaChangeBehavior: state.massInertiaChangeBehavior,
        detailLinkTab: state.detailLinkTab,
        structureTreeShowGeometryDetails: state.structureTreeShowGeometryDetails,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-apply theme and font size on hydration
        if (state) {
          applyTheme(state.theme);
          document.documentElement.style.fontSize = '100%';
          // Re-apply font size
          applyFontSize(normalizeGlobalFontSize(state.fontSize));
          const normalizedCodeEditorFontFamily = normalizeCodeEditorFontFamily(
            state.codeEditorFontFamily,
          );
          if (state.codeEditorFontFamily !== normalizedCodeEditorFontFamily) {
            state.setCodeEditorFontFamily(normalizedCodeEditorFontFamily);
          }
          const normalizedCodeEditorFontSize = clampCodeEditorFontSize(state.codeEditorFontSize);
          if (state.codeEditorFontSize !== normalizedCodeEditorFontSize) {
            state.setCodeEditorFontSize(normalizedCodeEditorFontSize);
          }
          const normalizedMassInertiaChangeBehavior = normalizeMassInertiaChangeBehavior(
            state.massInertiaChangeBehavior,
          );
          if (state.massInertiaChangeBehavior !== normalizedMassInertiaChangeBehavior) {
            state.setMassInertiaChangeBehavior(normalizedMassInertiaChangeBehavior);
          }
          const normalizedDetailLinkTab = normalizeDetailLinkTab(state.detailLinkTab);
          if (state.detailLinkTab !== normalizedDetailLinkTab) {
            state.setDetailLinkTab(normalizedDetailLinkTab);
          }
        }
      },
    },
  ),
);
