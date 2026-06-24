import {
  Briefcase,
  ChevronDown,
  Code,
  Download,
  Eye,
  FileText,
  Folder,
  Pencil,
  Redo,
  Undo,
  Upload,
} from 'lucide-react';
import { ToolboxMenu } from './ToolboxMenu';
import { HeaderButton } from './HeaderButton';
import { HeaderMenuOverlay } from './HeaderMenuOverlay';
import { HeaderMenuItem, HeaderMenuSeparator } from './HeaderMenuItem';
import { ViewMenuItem } from './ViewMenuItem';
import { toggleOptionsPanel, toggleViewPanel } from './viewMenuState.js';
import type {
  HeaderMenuKey,
  HeaderSetViewConfig,
  HeaderTranslations,
  HeaderViewAvailability,
  HeaderViewConfig,
  ToolboxItem,
} from './types';

interface HeaderMenusProps {
  activeMenu: HeaderMenuKey;
  setActiveMenu: (menu: HeaderMenuKey) => void;
  showMenuLabels: boolean;
  showSourceInline: boolean;
  showSourceText: boolean;
  showUndoRedoInline: boolean;
  t: HeaderTranslations;
  viewConfig: HeaderViewConfig;
  viewAvailability: HeaderViewAvailability;
  setViewConfig: HeaderSetViewConfig;
  onImportFile: () => void;
  onImportFolder: () => void;
  onOpenExport: () => void;
  onExportProject: () => void;
  toolboxItems: ToolboxItem[];
  onOpenCodeViewer: () => void;
  onPrefetchCodeViewer: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function HeaderMenus({
  activeMenu,
  setActiveMenu,
  showMenuLabels,
  showSourceInline,
  showSourceText,
  showUndoRedoInline,
  t,
  viewConfig,
  viewAvailability,
  setViewConfig,
  onImportFile,
  onImportFolder,
  onOpenExport,
  onExportProject,
  toolboxItems,
  onOpenCodeViewer,
  onPrefetchCodeViewer,
  undo,
  redo,
  canUndo,
  canRedo,
}: HeaderMenusProps) {
  const jointPanelVisible = viewConfig.showJointPanel && viewAvailability.jointPanel;

  const toggleMenu = (menu: Exclude<HeaderMenuKey, null>) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleToggleViewPanel = (key: keyof HeaderViewConfig) => {
    setViewConfig((prev) => toggleViewPanel(prev, key));
    setActiveMenu(null);
  };

  const handleToggleOptionsPanel = () => {
    setViewConfig((prev) => toggleOptionsPanel(prev));
    setActiveMenu(null);
  };

  return (
    <div className="flex items-center">
      <div className="relative">
        <HeaderButton
          isActive={activeMenu === 'file'}
          onClick={() => toggleMenu('file')}
          title={t.file}
          ariaLabel={t.file}
          ariaHaspopup="menu"
          ariaExpanded={activeMenu === 'file'}
        >
          <FileText className="w-3.5 h-3.5" />
          {showMenuLabels && <span>{t.file}</span>}
          {showMenuLabels && (
            <ChevronDown
              className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'file' ? 'rotate-180' : ''}`}
            />
          )}
        </HeaderButton>

        {activeMenu === 'file' && (
          <>
            <HeaderMenuOverlay onClose={() => setActiveMenu(null)} label={t.close} />
            <div
              className="absolute top-full left-0 mt-1 w-max bg-panel-bg dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-border-black z-50 overflow-visible py-1"
              role="menu"
              aria-label={t.file}
            >
              <HeaderMenuItem
                icon={Folder}
                onClick={() => {
                  setActiveMenu(null);
                  onImportFolder();
                }}
              >
                {t.importFolder}
              </HeaderMenuItem>
              <HeaderMenuItem
                icon={Download}
                onClick={() => {
                  setActiveMenu(null);
                  onImportFile();
                }}
              >
                {t.importUspZipFile}
              </HeaderMenuItem>
              <HeaderMenuSeparator />
              <HeaderMenuItem
                icon={Upload}
                onClick={() => {
                  setActiveMenu(null);
                  onOpenExport();
                }}
              >
                {t.export}
              </HeaderMenuItem>
              <HeaderMenuItem
                icon={Briefcase}
                onClick={() => {
                  setActiveMenu(null);
                  onExportProject();
                }}
              >
                {t.exportProject}
              </HeaderMenuItem>
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <HeaderButton
          isActive={activeMenu === 'edit'}
          onClick={() => toggleMenu('edit')}
          title={t.edit}
          ariaLabel={t.edit}
          ariaHaspopup="menu"
          ariaExpanded={activeMenu === 'edit'}
        >
          <Pencil className="w-3.5 h-3.5" />
          {showMenuLabels && <span>{t.edit}</span>}
          {showMenuLabels && (
            <ChevronDown
              className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'edit' ? 'rotate-180' : ''}`}
            />
          )}
        </HeaderButton>

        {activeMenu === 'edit' && (
          <>
            <HeaderMenuOverlay onClose={() => setActiveMenu(null)} label={t.close} />
            <div
              className="absolute top-full left-0 mt-1 w-max bg-panel-bg dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-border-black z-50 overflow-visible py-1"
              role="menu"
              aria-label={t.edit}
            >
              <HeaderMenuItem
                icon={Undo}
                onClick={() => {
                  undo();
                  setActiveMenu(null);
                }}
                disabled={!canUndo}
                shortcut="Ctrl+Z"
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
                shortcut="Ctrl+Shift+Z"
              >
                {t.redo}
              </HeaderMenuItem>
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <HeaderButton
          isActive={activeMenu === 'toolbox'}
          onClick={() => toggleMenu('toolbox')}
          title={t.toolbox}
          ariaLabel={t.toolbox}
          ariaHaspopup="menu"
          ariaExpanded={activeMenu === 'toolbox'}
        >
          <Briefcase className="w-3.5 h-3.5" />
          {showMenuLabels && <span>{t.toolbox}</span>}
          {showMenuLabels && (
            <ChevronDown
              className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'toolbox' ? 'rotate-180' : ''}`}
            />
          )}
        </HeaderButton>

        {activeMenu === 'toolbox' && (
          <ToolboxMenu t={t} onClose={() => setActiveMenu(null)} items={toolboxItems} />
        )}
      </div>

      <div className="relative">
        <HeaderButton
          isActive={activeMenu === 'view'}
          onClick={() => toggleMenu('view')}
          title={t.view}
          ariaLabel={t.view}
          ariaHaspopup="menu"
          ariaExpanded={activeMenu === 'view'}
        >
          <Eye className="w-3.5 h-3.5" />
          {showMenuLabels && <span>{t.view}</span>}
          {showMenuLabels && (
            <ChevronDown
              className={`w-3 h-3 opacity-60 transition-transform ${activeMenu === 'view' ? 'rotate-180' : ''}`}
            />
          )}
        </HeaderButton>

        {activeMenu === 'view' && (
          <>
            <HeaderMenuOverlay onClose={() => setActiveMenu(null)} label={t.close} />
            <div
              className="absolute top-full left-0 mt-1 w-auto min-w-[10.5rem] bg-panel-bg dark:bg-panel-bg rounded-lg shadow-md dark:shadow-xl border border-border-black z-50 overflow-hidden py-1"
              role="menu"
              aria-label={t.view}
            >
              <ViewMenuItem
                checked={jointPanelVisible}
                label={t.jointsPanel}
                disabled={!viewAvailability.jointPanel}
                onClick={() => handleToggleViewPanel('showJointPanel')}
              />
              <ViewMenuItem
                checked={viewConfig.showOptionsPanel}
                label={t.viewOptions}
                onClick={handleToggleOptionsPanel}
              />
              <ViewMenuItem
                checked={viewConfig.showStructureGraph}
                label={t.structureGraphTitle}
                onClick={() => handleToggleViewPanel('showStructureGraph')}
              />
            </div>
          </>
        )}
      </div>

      {showSourceInline && (
        <div className="relative hidden sm:block shrink-0 ml-1">
          <button
            type="button"
            onClick={onOpenCodeViewer}
            onMouseEnter={onPrefetchCodeViewer}
            onFocus={onPrefetchCodeViewer}
            onPointerDown={onPrefetchCodeViewer}
            data-testid="source-code-open"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md whitespace-nowrap text-xs font-medium transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white"
            title={t.sourceCode}
            aria-label={t.sourceCode}
          >
            <Code className="w-3.5 h-3.5" />
            {showSourceText && <span>{t.sourceCode}</span>}
          </button>
        </div>
      )}

      {showUndoRedoInline && <div className="w-px h-5 bg-border-black mx-1.5 hidden sm:block" />}

      {showUndoRedoInline && (
        <div className="items-center gap-0.5 hidden sm:flex">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            data-testid="history-undo"
            className={`p-1 rounded-md transition-all ${
              !canUndo
                ? 'text-slate-300 dark:text-element-hover cursor-not-allowed'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
            }`}
            title={`${t.undo} (Ctrl+Z)`}
            aria-label={t.undo}
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            data-testid="history-redo"
            className={`p-1 rounded-md transition-all ${
              !canRedo
                ? 'text-slate-300 dark:text-element-hover cursor-not-allowed'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
            }`}
            title={`${t.redo} (Ctrl+Shift+Z)`}
            aria-label={t.redo}
          >
            <Redo className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
