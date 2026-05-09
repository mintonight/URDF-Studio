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
  shouldRenderAssembly: boolean;
  hasSimpleModeSourceEdits: boolean;
  intent: LibraryRobotLoadIntent;
}

export function resolveLibraryRobotLoadAction({
  selectedFileName,
  targetFileName,
  shouldRenderAssembly,
  hasSimpleModeSourceEdits,
  intent,
}: ResolveLibraryRobotLoadActionOptions): LibraryRobotLoadAction {
  if (selectedFileName === targetFileName) {
    return 'already-loaded';
  }

  if (intent === 'direct' && shouldRenderAssembly) {
    return 'preview';
  }

  const shouldGuardLibrarySwitch =
    !shouldRenderAssembly && Boolean(selectedFileName) && hasSimpleModeSourceEdits;

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
