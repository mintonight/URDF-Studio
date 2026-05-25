export type LibraryRobotLoadIntent = 'direct' | 'preview' | 'discard';

export type LibraryRobotLoadAction =
  | 'already-loaded'
  | 'load'
  | 'needs-preview-or-discard-confirm'
  | 'preview'
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

  if (intent === 'preview') {
    return 'preview';
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
    return 'needs-preview-or-discard-confirm';
  }

  if (!selectedFileName) {
    return 'blocked';
  }

  return 'blocked';
}
