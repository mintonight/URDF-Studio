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
import { translations } from '@/shared/i18n';
import type { AppMode, AssemblyState, RobotState } from '@/types';
import { AssemblyTreeView } from '../AssemblyTreeView';
import { TreeNode } from '../TreeNode';

type TreeEditorTranslations = typeof translations.en;

interface TreeEditorStructureSectionProps {
  isOpen: boolean;
  isAssemblyView: boolean;
  structureTreeShowGeometryDetails: boolean;
  showVisual: boolean;
  showStructureFilePath: boolean;
  currentFileName?: string;
  mode: AppMode;
  assemblyState?: AssemblyState | null;
  robot: RobotState;
  treeRootLinkIds: string[];
  childJointsByParent: Record<string, RobotState['joints'][string][]>;
  selectionBranchLinkIds: Set<string>;
  t: TreeEditorTranslations;
  onToggleOpen: () => void;
  onToggleGeometryDetails: () => void;
  onAddChildFromSelection: () => void;
  onToggleVisuals: () => void;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddCollisionBody: (parentId: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  onRenameAssembly?: (name: string) => void;
  onRemoveComponent?: (id: string) => void;
  onRemoveBridge?: (id: string) => void;
  onRenameComponent?: (id: string, name: string) => void;
  onCreateBridge?: () => void;
  onToggleComponentVisibility: (componentId: string) => void;
  isReadOnly?: boolean;
}

export function TreeEditorStructureSection({
  isOpen,
  isAssemblyView,
  structureTreeShowGeometryDetails,
  showVisual,
  showStructureFilePath,
  currentFileName,
  mode,
  assemblyState,
  robot,
  treeRootLinkIds,
  childJointsByParent,
  selectionBranchLinkIds,
  t,
  onToggleOpen,
  onToggleGeometryDetails,
  onAddChildFromSelection,
  onToggleVisuals,
  onSelect,
  onSelectGeometry,
  onFocus,
  onAddChild,
  onAddCollisionBody,
  onDelete,
  onUpdate,
  onRenameAssembly,
  onRemoveComponent,
  onRemoveBridge,
  onRenameComponent,
  onCreateBridge,
  onToggleComponentVisibility,
  isReadOnly = false,
}: TreeEditorStructureSectionProps) {
  const useStoreDrivenTree = !isAssemblyView && !isReadOnly;

  return (
    <div className="flex flex-col min-h-0 flex-1" style={{ flex: isOpen ? '1 1 0%' : '0 0 auto' }}>
      <div
        className="flex h-8 items-center justify-between gap-2 px-2.5 bg-element-bg dark:bg-element-bg cursor-pointer select-none"
        onClick={onToggleOpen}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          )}
          <span className="shrink-0 text-[11px] leading-none font-semibold text-text-secondary tracking-[0.02em]">
            {isAssemblyView ? t.assemblyTree : t.structureTree}
          </span>
          {isReadOnly && (
            <span className="shrink-0 rounded-md border border-system-blue/20 bg-system-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-system-blue">
              {t.preview}
            </span>
          )}
          {showStructureFilePath && (
            <div
              className="flex min-w-0 max-w-full flex-1 items-center gap-1 overflow-hidden rounded-md border border-border-black bg-white px-1.5 py-0.5 dark:bg-panel-bg"
              title={currentFileName}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <FileCode className="h-3 w-3 shrink-0 text-system-blue" />
              <input
                type="text"
                readOnly
                value={currentFileName ?? ''}
                aria-label={currentFileName ?? ''}
                spellCheck={false}
                className="allow-text-selection min-w-0 flex-1 bg-transparent text-[9px] leading-none font-medium text-text-secondary outline-none dark:text-text-tertiary cursor-text"
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.currentTarget.select();
                }}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
              structureTreeShowGeometryDetails
                ? 'bg-element-hover text-text-primary ring-1 ring-inset ring-border-black/60'
                : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGeometryDetails();
            }}
            title={structureTreeShowGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails}
            aria-label={
              structureTreeShowGeometryDetails ? t.hideGeometryDetails : t.showGeometryDetails
            }
          >
            <Shapes size={11} />
            <Shield size={11} />
          </button>

          {!isAssemblyView && !isReadOnly && (
            <button
              className="p-0.5 bg-system-blue-solid hover:bg-system-blue-hover text-white rounded-md transition-colors shadow-sm"
              onClick={(event) => {
                event.stopPropagation();
                onAddChildFromSelection();
              }}
              title={t.addChildLink}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {!isAssemblyView && !isReadOnly && (
            <div
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-element-hover cursor-pointer text-text-tertiary transition-colors"
              onClick={(event) => {
                event.stopPropagation();
                onToggleVisuals();
              }}
              title={showVisual ? t.hideAllVisuals : t.showAllVisuals}
            >
              {showVisual ? <Eye size={14} /> : <EyeOff size={14} />}
            </div>
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
                  showGeometryDetailsByDefault={structureTreeShowGeometryDetails}
                  onSelect={onSelect}
                  onSelectGeometry={onSelectGeometry}
                  onFocus={onFocus}
                  onAddChild={onAddChild}
                  onAddCollisionBody={onAddCollisionBody}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  onRenameAssembly={onRenameAssembly}
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
                  <div
                    key={treeRootLinkId}
                    style={{ containIntrinsicSize: '320px', contentVisibility: 'auto' }}
                  >
                    <TreeNode
                      linkId={treeRootLinkId}
                      robot={useStoreDrivenTree ? undefined : robot}
                      showGeometryDetailsByDefault={structureTreeShowGeometryDetails}
                      childJointsByParent={useStoreDrivenTree ? undefined : childJointsByParent}
                      selectionBranchLinkIds={
                        useStoreDrivenTree ? undefined : selectionBranchLinkIds
                      }
                      onSelect={onSelect}
                      onSelectGeometry={onSelectGeometry}
                      onFocus={onFocus}
                      onAddChild={onAddChild}
                      onAddCollisionBody={onAddCollisionBody}
                      onDelete={onDelete}
                      onUpdate={onUpdate}
                      mode={mode}
                      t={t}
                      readOnly={isReadOnly}
                      storeDriven={useStoreDrivenTree}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
