/**
 * VirtualTreeViewDemo - A demonstration of how to implement virtualization for the robot tree.
 * This approach flattens the tree into a single list of visible nodes, allowing for
 * high-performance rendering of thousands of nodes with a fixed DOM footprint.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Box, Link2, ArrowRightLeft } from 'lucide-react';

interface TreeNodeData {
  id: string;
  name: string;
  type: 'link' | 'joint' | 'component' | 'bridge';
  parentId: string | null;
  children: string[];
  depth: number;
}

interface VirtualNode extends TreeNodeData {
  isExpanded: boolean;
  isVisible: boolean;
}

export function VirtualTreeViewDemo() {
  // Mock data generation for a large tree
  const [nodes, setNodes] = useState<Record<string, TreeNodeData>>(() => {
    const data: Record<string, TreeNodeData> = {};

    // Create a root component
    data['root'] = {
      id: 'root',
      name: 'Humanoid_Robot_v2',
      type: 'component',
      parentId: null,
      children: ['base_link'],
      depth: 0,
    };

    // Generate a deep and wide tree (e.g., 500 links)
    for (let i = 0; i < 500; i++) {
      const id = `link_${i}`;
      const parentId = i === 0 ? 'root' : `link_${Math.floor((i - 1) / 2)}`;
      const children: string[] = [];

      // Add a joint for every link except root
      const jointId = `joint_${i}`;
      data[jointId] = {
        id: jointId,
        name: `joint_to_${id}`,
        type: 'joint',
        parentId: parentId,
        children: [id],
        depth: (data[parentId]?.depth ?? 0) + 1,
      };

      data[id] = {
        id,
        name: `link_segment_${i}`,
        type: 'link',
        parentId: jointId,
        children: [],
        depth: data[jointId].depth + 1,
      };

      if (data[parentId]) {
        data[parentId].children.push(jointId);
      }
    }
    return data;
  });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(['root', 'joint_0', 'link_0']),
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 1. Flatten the tree into a list of currently visible nodes
  const visibleNodes = useMemo(() => {
    const list: VirtualNode[] = [];

    function walk(id: string, isVisible: boolean) {
      const node = nodes[id];
      if (!node) return;

      const isExpanded = expandedIds.has(id);
      if (isVisible) {
        list.push({ ...node, isExpanded, isVisible });
      }

      if (isExpanded) {
        node.children.forEach((childId) => walk(childId, isVisible));
      }
    }

    walk('root', true);
    return list;
  }, [nodes, expandedIds]);

  // 2. Simple virtualization logic (only render nodes in viewport)
  const itemHeight = 28;
  const containerHeight = 400;
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 5);
  const endIndex = Math.min(
    visibleNodes.length - 1,
    Math.floor((scrollTop + containerHeight) / itemHeight) + 5,
  );

  const totalHeight = visibleNodes.length * itemHeight;
  const translateY = startIndex * itemHeight;

  return (
    <div className="p-4 bg-panel-bg rounded-lg border border-border-black shadow-lg max-w-md">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-text-primary">Virtualized Tree Demo</h3>
        <p className="text-xs text-text-tertiary">
          Rendering {visibleNodes.length} visible nodes (out of {Object.keys(nodes).length} total).
          DOM nodes rendered: {endIndex - startIndex + 1}.
        </p>
      </div>

      <div
        className="overflow-auto custom-scrollbar border border-border-black rounded bg-element-bg"
        style={{ height: containerHeight }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${translateY}px)` }}>
            {visibleNodes.slice(startIndex, endIndex + 1).map((node) => (
              <VirtualTreeNode
                key={node.id}
                node={node}
                onToggle={() => toggleExpand(node.id)}
                height={itemHeight}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 text-[10px] text-text-tertiary bg-blue-500/5 p-2 rounded border border-blue-500/20">
        <strong>Virtualization Strategy:</strong>
        <ul className="list-disc ml-4 mt-1 space-y-1">
          <li>Flatten tree into a depth-first sorted array.</li>
          <li>Calculate visibility based on parent expansion state.</li>
          <li>Only render the small "window" of nodes visible in the scroll container.</li>
          <li>Greatly reduces React reconciliation overhead for large robot models.</li>
        </ul>
      </div>
    </div>
  );
}

function VirtualTreeNode({
  node,
  onToggle,
  height,
}: {
  node: VirtualNode;
  onToggle: () => void;
  height: number;
}) {
  const Icon =
    node.type === 'link'
      ? Box
      : node.type === 'joint'
        ? ArrowRightLeft
        : node.type === 'component'
          ? Box
          : Link2;
  const iconColor =
    node.type === 'link'
      ? 'text-system-blue'
      : node.type === 'joint'
        ? 'text-orange-500'
        : 'text-green-500';

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 border-0 bg-transparent px-2 text-left hover:bg-element-hover cursor-pointer group whitespace-nowrap"
      style={{ height, paddingLeft: `${node.depth * 12 + 8}px` }}
      onClick={onToggle}
    >
      <div className="w-4 flex items-center justify-center">
        {node.children.length > 0 &&
          (node.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </div>
      <Icon size={12} className={iconColor} />
      <span className="text-[11px] font-medium text-text-secondary truncate">{node.name}</span>
      {node.type === 'component' && (
        <span className="text-[9px] bg-system-blue/10 text-system-blue px-1 rounded">root</span>
      )}
    </button>
  );
}
