import type { ComponentProps } from 'react';

import { FilePreviewWindow } from '../FilePreviewWindow';
import { PropertyEditor } from '@/features/property-editor/components/PropertyEditor';
import { TreeEditor } from '@/features/robot-tree/components/TreeEditor';

interface WorkspaceSidebarsProps {
  leftSidebarClassName: string;
  rightSidebarClassName: string;
  treeEditorProps: ComponentProps<typeof TreeEditor>;
  filePreviewWindowProps: ComponentProps<typeof FilePreviewWindow>;
  propertyEditorProps: ComponentProps<typeof PropertyEditor>;
}

export function WorkspaceSidebars({
  leftSidebarClassName,
  rightSidebarClassName,
  treeEditorProps,
  filePreviewWindowProps,
  propertyEditorProps,
}: WorkspaceSidebarsProps) {
  return (
    <>
      <div className={leftSidebarClassName}>
        <TreeEditor {...treeEditorProps} />
      </div>

      <FilePreviewWindow {...filePreviewWindowProps} />

      <div className={rightSidebarClassName}>
        <PropertyEditor {...propertyEditorProps} />
      </div>
    </>
  );
}
