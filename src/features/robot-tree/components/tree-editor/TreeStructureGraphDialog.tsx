import { ArrowRight, Box, CircleDot, Link2, X } from 'lucide-react';

import type { TranslationKeys } from '@/shared/i18n';
import type { AssemblyState, EntityRef, WorkspaceSelection } from '@/types';
import { useSelectionStore } from '@/store/selectionStore';

interface TreeStructureGraphDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: AssemblyState;
  activeComponentId: string;
  t: TranslationKeys;
  onSelect?: (selection: WorkspaceSelection) => void;
}

/**
 * A canonical, ownership-aware structure overview. The graph deliberately uses
 * explicit component/local identities; it never derives ownership from labels
 * or merged projection IDs.
 */
export function TreeStructureGraphDialog({
  isOpen,
  onClose,
  workspace,
  activeComponentId,
  t,
  onSelect,
}: TreeStructureGraphDialogProps) {
  const setSelection = useSelectionStore((state) => state.setSelection);
  if (!isOpen) return null;

  const select = (ref: EntityRef) => {
    const next: WorkspaceSelection = { entity: ref };
    setSelection(next);
    onSelect?.(next);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.structureTree}
      data-testid="tree-structure-graph"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-8"
    >
      <div className="flex max-h-[80vh] w-[min(900px,90vw)] flex-col overflow-hidden rounded-lg border border-border-black bg-white shadow-xl dark:bg-panel-bg">
        <div className="flex items-center justify-between border-b border-border-black px-3 py-2">
          <span className="text-sm font-semibold">{workspace.name}</span>
          <button type="button" aria-label={t.close} onClick={onClose}><X size={15} /></button>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 md:grid-cols-2">
          {Object.values(workspace.components).map((component) => (
            <section
              key={component.id}
              data-testid={`graph-component-${component.id}`}
              data-active={component.id === activeComponentId ? 'true' : 'false'}
              className="rounded border border-border-black p-2"
            >
              <button
                type="button"
                className="mb-1 flex w-full items-center gap-1 text-left text-xs font-semibold"
                onClick={() => select({ type: 'component', componentId: component.id })}
              ><Box size={13} />{component.name}</button>
              <div className="space-y-0.5 pl-2">
                {Object.values(component.robot.links).map((link) => (
                  <button
                    type="button"
                    key={link.id}
                    className="flex w-full items-center gap-1 text-left text-[11px] text-text-secondary"
                    onClick={() => select({
                      type: 'link',
                      componentId: component.id,
                      entityId: link.id,
                    })}
                  ><CircleDot size={9} />{link.name}</button>
                ))}
                {Object.values(component.robot.joints).map((joint) => (
                  <button
                    type="button"
                    key={joint.id}
                    className="flex w-full items-center gap-1 text-left text-[11px] text-text-tertiary"
                    onClick={() => select({
                      type: 'joint',
                      componentId: component.id,
                      entityId: joint.id,
                    })}
                  ><ArrowRight size={9} />{joint.name}</button>
                ))}
              </div>
            </section>
          ))}
          {Object.values(workspace.bridges).map((bridge) => (
            <button
              type="button"
              key={bridge.id}
              className="flex items-center gap-1 rounded border border-border-black p-2 text-left text-xs"
              onClick={() => select({ type: 'bridge', bridgeId: bridge.id })}
            >
              <Link2 size={12} />
              {bridge.name}: {bridge.parentComponentId}/{bridge.parentLinkId}
              <ArrowRight size={10} />
              {bridge.childComponentId}/{bridge.childLinkId}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
