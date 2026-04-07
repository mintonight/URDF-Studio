import React from 'react';
import { Cuboid, File, FileCode, Folder, FolderOpen, Image } from 'lucide-react';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import type { RobotFile } from '@/types';

export interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileTreeNode[];
  file?: RobotFile;
}

interface MutableFileTreeNode extends FileTreeNode {
  childrenMap?: Map<string, MutableFileTreeNode>;
}

// Build a tree structure from flat file list
export function buildFileTree(files: RobotFile[]): FileTreeNode[] {
  const root = new Map<string, MutableFileTreeNode>();

  for (const file of files) {
    const parts = file.name.split('/').filter((part) => part.length > 0);
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      let existing = currentLevel.get(part);

      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          childrenMap: isLast ? undefined : new Map<string, MutableFileTreeNode>(),
          file: isLast ? file : undefined,
        };
        currentLevel.set(part, existing);
      }

      if (!isLast && existing.childrenMap) {
        currentLevel = existing.childrenMap;
      }
    }
  }

  const finalizeNodes = (nodes: Iterable<MutableFileTreeNode>): FileTreeNode[] => {
    return Array.from(nodes)
      .sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        name: node.name,
        path: node.path,
        isFolder: node.isFolder,
        file: node.file,
        children: node.childrenMap ? finalizeNodes(node.childrenMap.values()) : undefined,
      }));
  };

  return finalizeNodes(root.values());
}

// Get file icon based on extension
export function getFileIcon(filename: string, isFolder: boolean, isOpen: boolean): React.ReactNode {
  if (isFolder) {
    return isOpen
      ? React.createElement(FolderOpen, { className: 'w-3.5 h-3.5 text-amber-500' })
      : React.createElement(Folder, { className: 'w-3.5 h-3.5 text-amber-500' });
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (isImageAssetPath(filename)) {
    return React.createElement(Image, { className: 'w-3.5 h-3.5 text-pink-500' });
  }

  switch (ext) {
    case 'urdf':
      return React.createElement(FileCode, { className: 'w-3.5 h-3.5 text-system-blue' });
    case 'sdf':
      return React.createElement(FileCode, { className: 'w-3.5 h-3.5 text-teal-500' });
    case 'xacro':
      return React.createElement(FileCode, { className: 'w-3.5 h-3.5 text-text-secondary' });
    case 'xml':
      return React.createElement(FileCode, { className: 'w-3.5 h-3.5 text-orange-500' });
    case 'dae':
    case 'stl':
    case 'obj':
      return React.createElement(Cuboid, { className: 'w-3.5 h-3.5 text-green-500' });
    default:
      return React.createElement(File, { className: 'w-3.5 h-3.5 text-text-tertiary' });
  }
}
