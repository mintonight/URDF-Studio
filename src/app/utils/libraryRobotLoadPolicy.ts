export type LibraryRobotLoadIntent = 'direct' | 'save-draft' | 'discard';

export type LibraryRobotLoadAction =
  | 'already-loaded'
  | 'load'
  | 'needs-draft-confirm'
  | 'preview'
  | 'save-draft'
  | 'blocked';

interface ResolveLibraryRobotLoadActionOptions {
  selectedFileName: string | null | undefined;
  targetFileName: string;
  shouldPreviewCurrentState: boolean;
  hasSimpleModeSourceEdits: boolean;
  intent: LibraryRobotLoadIntent;
}

export function resolveLibraryRobotLoadAction({
  selectedFileName,
  targetFileName,
  shouldPreviewCurrentState,
  hasSimpleModeSourceEdits,
  intent,
}: ResolveLibraryRobotLoadActionOptions): LibraryRobotLoadAction {
  if (selectedFileName === targetFileName) {
    return 'already-loaded';
  }

  if (intent === 'direct' && shouldPreviewCurrentState) {
    return 'preview';
  }

  const shouldGuardLibrarySwitch =
    !shouldPreviewCurrentState && Boolean(selectedFileName) && hasSimpleModeSourceEdits;

  if (!shouldGuardLibrarySwitch || intent === 'discard') {
    return 'load';
  }

  if (intent === 'direct') {
    return 'needs-draft-confirm';
  }

  if (!selectedFileName) {
    return 'blocked';
  }

  return 'save-draft';
}
