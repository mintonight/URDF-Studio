import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode,
  Plus,
  Shapes,
  Shield,
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { AssemblyTreeView } from './AssemblyTreeView';
import { TreeNode } from './TreeNode';
import type { TreeEditorTranslations } from './treeEditorTypes';
import type { AppMode, AssemblyState, RobotState } from '@/types';

interface TreeEditorStructureSectionProps {
  assemblyState?: AssemblyState | null;
  childJointsByParent: Record<string, RobotState['joints'][string][]>;
  currentFileName?: string;
  isAssemblyView: boolean;
  isOpen: boolean;
  mode: AppMode;
  onAddChild: (parentId: string) => void;
  onAddSelectedOrRootChild: () => void;
  onAddCollisionBody: (parentId: string) => void;
  onCreateBridge?: () => void;
  onDelete: (id: string) => void;
  onFocus?: (id: string) => void;
  onRemoveBridge?: (id: string) => void;
  onRemoveComponent?: (id: string) => void;
  onRenameComponent?: (id: string, name: string) => void;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onToggleComponentVisibility: (componentId: string) => void;
  onToggleGeometryDetails: () => void;
  onToggleOpen: () => void;
  onToggleShowVisual: () => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  robot: RobotState;
  selectionBranchLinkIds: Set<string>;
  showGeometryDetails: boolean;
  showStructureFilePath: boolean;
  showVisual: boolean;
  sidebarTab: 'structure' | 'workspace';
  t: TreeEditorTranslations;
  treeRootLinkIds: string[];
}

export function TreeEditorStructureSection({
  assemblyState,
  childJointsByParent,
  currentFileName,
  isAssemblyView,
  isOpen,
  mode,
  onAddChild,
  onAddSelectedOrRootChild,
  onAddCollisionBody,
  onCreateBridge,
  onDelete,
  onFocus,
  onRemoveBridge,
  onRemoveComponent,
  onRenameComponent,
  onSelect,
  onSelectGeometry,
  onToggleComponentVisibility,
  onToggleGeometryDetails,
  onToggleOpen,
  onToggleShowVisual,
  onUpdate,
  robot,
  selectionBranchLinkIds,
  showGeometryDetails,
  showStructureFilePath,
  showVisual,
  sidebarTab,
  t,
  treeRootLinkIds,
}: TreeEditorStructureSectionProps) {
  const headerLabel = isAssemblyView ? t.assemblyTree : t.structureTree;
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }

    event.preventDefault();
    onToggleOpen();
  };

  return (
    <div
      className="flex flex-col min-h-0 transition-all flex-1"
      style={{ flex: isOpen ? '1 1 0%' : '0 0 auto' }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-element-bg dark:bg-element-bg cursor-pointer select-none border-b border-border-black dark:border-border-black"
        onClick={onToggleOpen}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        aria-label={headerLabel}
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
          )}
          <span className="shrink-0 text-xs font-semibold text-text-secondary tracking-[0.02em]">
            {isAssemblyView ? t.assemblyTree : t.structureTree}
          </span>
          {showStructureFilePath && (
            <div
              className="flex min-w-0 items-center gap-1 rounded-md border border-border-black bg-white px-1.5 py-0.5 dark:bg-panel-bg"
              title={currentFileName}
            >
              <FileCode className="h-3 w-3 shrink-0 text-system-blue" />
              <span className="truncate text-[10px] font-medium text-text-secondary dark:text-text-tertiary">
                {currentFileName}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
              showGeometryDetails
                ? 'bg-element-hover text-text-primary ring-1 ring-inset ring-border-black/60'
                : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGeometryDetails();
            }}
            title={showGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails}
            aria-label={showGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails}
          >
            <Shapes size={11} />
            <Shield size={11} />
          </button>

          {sidebarTab === 'structure' && (
            <button
              type="button"
              className="p-1 bg-system-blue-solid hover:bg-system-blue-hover text-white rounded-md transition-colors shadow-sm"
              onClick={(event) => {
                event.stopPropagation();
                onAddSelectedOrRootChild();
              }}
              title={t.addChildLink}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {!isAssemblyView && (
            <button
              type="button"
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-element-hover cursor-pointer text-text-tertiary transition-colors"
              onClick={(event) => {
                event.stopPropagation();
                onToggleShowVisual();
              }}
              title={showVisual ? t.hideAllVisuals : t.showAllVisuals}
              aria-label={showVisual ? t.hideAllVisuals : t.showAllVisuals}
            >
              {showVisual ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto py-2 custom-scrollbar bg-white dark:bg-panel-bg">
            <div className="min-w-max">
              {isAssemblyView && assemblyState ? (
                <AssemblyTreeView
                  assemblyState={assemblyState}
                  robot={robot}
                  showGeometryDetailsByDefault={showGeometryDetails}
                  onSelect={onSelect}
                  onSelectGeometry={onSelectGeometry}
                  onFocus={onFocus}
                  onAddChild={onAddChild}
                  onAddCollisionBody={onAddCollisionBody}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  onRemoveComponent={onRemoveComponent}
                  onRemoveBridge={onRemoveBridge}
                  onRenameComponent={onRenameComponent}
                  onCreateBridge={onCreateBridge}
                  onToggleComponentVisibility={onToggleComponentVisibility}
                  mode={mode}
                  t={t}
                />
              ) : (
                treeRootLinkIds.map((treeRootLinkId) => (
                  <TreeNode
                    key={treeRootLinkId}
                    linkId={treeRootLinkId}
                    robot={robot}
                    showGeometryDetailsByDefault={showGeometryDetails}
                    childJointsByParent={childJointsByParent}
                    selectionBranchLinkIds={selectionBranchLinkIds}
                    onSelect={onSelect}
                    onSelectGeometry={onSelectGeometry}
                    onFocus={onFocus}
                    onAddChild={onAddChild}
                    onAddCollisionBody={onAddCollisionBody}
                    onDelete={onDelete}
                    onUpdate={onUpdate}
                    mode={mode}
                    t={t}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
