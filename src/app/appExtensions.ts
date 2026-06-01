import type { ReactNode } from 'react';
import type { HeaderAction } from './components/header/types';
import type { RobotFile } from '@/types';

/** Render slots: allows external repos to inject extra modals and overlays. */
export interface AppExtensionSlots {
  /** Rendered after core built-in modals, before toast. */
  renderModals?: () => ReactNode;
  /** Rendered after toast (highest z-index layer). */
  renderTopOverlays?: () => ReactNode;
}

/** Config extension: allows external repos to inject header actions etc. */
export interface AppExtensionConfig {
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
}

/** Core internal actions exposed to external consumers. */
export interface AppExposedActions {
  importFiles: (files: FileList | File[]) => void;
  openLibraryExport: (file: RobotFile) => void;
  openAIInspection: () => void;
  openAIConversation: () => void;
  openIkTool: () => void;
  openCollisionOptimizer: () => void;
  openTool: (key: string) => void;
  exportProjectBlob: () => Promise<Blob>;
  collectRawFilesBlob: () => Promise<Blob>;
}

export interface AppContentProps {
  extensions?: {
    slots?: AppExtensionSlots;
    config?: AppExtensionConfig;
  };
  /** Core calls this on mount to expose internal handlers to the external host. */
  onExposeActions?: (actions: AppExposedActions) => void;
}
