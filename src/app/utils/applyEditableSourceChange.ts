import type { SourceCodeDirtyRange } from '@/features/code-editor/utils/sourceCodeEditorSession';
import type { RobotState } from '@/types';
import type { EditableSourceIncrementalPatch } from './editableSourceIncrementalPatch';
import { detectEditableSourceIncrementalPatch } from './editableSourceIncrementalPatchDetection';
import {
  parseEditableRobotSource,
  type ParseEditableRobotSourceOptions,
} from './parseEditableRobotSource';

export interface ApplyEditableSourceChangeOptions extends ParseEditableRobotSourceOptions {
  previousContent: string;
  dirtyRanges?: SourceCodeDirtyRange[];
  attemptIncrementalPatch?: boolean;
  skipMjcfIncrementalPatch?: boolean;
}

export type ApplyEditableSourceChangeResult =
  | {
      mode: 'incremental-patch';
      patch: EditableSourceIncrementalPatch;
    }
  | {
      mode: 'full-parse';
      state: RobotState | null;
    };

export function applyEditableSourceChange(
  options: ApplyEditableSourceChangeOptions,
): ApplyEditableSourceChangeResult {
  if (options.attemptIncrementalPatch) {
    const patch = detectEditableSourceIncrementalPatch({
      file: options.file,
      previousContent: options.previousContent,
      nextContent: options.content,
      dirtyRanges: options.dirtyRanges ?? [],
      skipMjcfPatch: options.skipMjcfIncrementalPatch,
    });
    if (patch) {
      return {
        mode: 'incremental-patch',
        patch,
      };
    }
  }

  return {
    mode: 'full-parse',
    state: parseEditableRobotSource(options),
  };
}
