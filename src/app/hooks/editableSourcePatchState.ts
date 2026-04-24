export interface EditableTextFileLike {
  name: string;
  content: string;
}

interface EditablePatchTargetFileLike extends EditableTextFileLike {
  format?: string | null;
}

export interface ResolvedEditablePatchTarget<TFile extends EditableTextFileLike> {
  targetFileName: string;
  targetFile: TFile | null;
}

export interface EditableSourcePatchStateResult<TFile extends EditableTextFileLike> {
  nextSelectedFile: TFile | null;
  nextAvailableFiles: TFile[];
  nextAllFileContents: Record<string, string>;
  didChange: boolean;
}

export function resolveEditablePatchTarget<TFile extends EditableTextFileLike>({
  selectedFile,
  availableFiles,
  sourceFileName,
}: {
  selectedFile: TFile | null;
  availableFiles: TFile[];
  sourceFileName?: string | null;
}): ResolvedEditablePatchTarget<TFile> {
  const targetFileName = sourceFileName ?? selectedFile?.name ?? null;
  if (!targetFileName) {
    return {
      targetFileName: '',
      targetFile: null,
    };
  }

  const targetFile =
    selectedFile?.name === targetFileName
      ? selectedFile
      : (availableFiles.find((file) => file.name === targetFileName) ?? null);

  return {
    targetFileName,
    targetFile,
  };
}

const USD_LIMIT_PROPERTY_RE =
  /\b(?:physics:(?:lowerLimit|upperLimit)|physxJoint:maxJointVelocity|drive:[^=\s]+:physics:maxForce)\b/;

function scoreUsdJointLimitPatchCandidate(
  file: EditablePatchTargetFileLike,
  jointName: string,
  preferredDirectory: string,
): number {
  if (file.format !== 'usd') {
    return -1;
  }

  let score = 0;
  if (file.content.includes(`"${jointName}"`)) {
    score += 8;
  }
  if (USD_LIMIT_PROPERTY_RE.test(file.content)) {
    score += 6;
  }
  if (/physics\.usd[a]?$/i.test(file.name)) {
    score += 4;
  }
  if (preferredDirectory && file.name.startsWith(preferredDirectory)) {
    score += 2;
  }
  return score;
}

export function resolveJointLimitEditablePatchTarget<TFile extends EditablePatchTargetFileLike>({
  selectedFile,
  availableFiles,
  sourceFileName,
  jointName,
}: {
  selectedFile: TFile | null;
  availableFiles: TFile[];
  sourceFileName?: string | null;
  jointName: string;
}): ResolvedEditablePatchTarget<TFile> {
  const directTarget = resolveEditablePatchTarget({
    selectedFile,
    availableFiles,
    sourceFileName,
  });

  if (directTarget.targetFile?.format !== 'usd') {
    return directTarget;
  }

  const preferredDirectory = directTarget.targetFileName.includes('/')
    ? directTarget.targetFileName.slice(0, directTarget.targetFileName.lastIndexOf('/') + 1)
    : '';

  const scoredCandidates = availableFiles
    .map((file) => ({
      file,
      score: scoreUsdJointLimitPatchCandidate(file, jointName, preferredDirectory),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const bestCandidate = scoredCandidates[0]?.file ?? directTarget.targetFile;
  if (!bestCandidate) {
    return directTarget;
  }

  return {
    targetFileName: bestCandidate.name,
    targetFile: bestCandidate,
  };
}

export function buildEditableSourcePatchState<TFile extends EditableTextFileLike>({
  selectedFile,
  availableFiles,
  allFileContents,
  targetFile,
  nextContent,
}: {
  selectedFile: TFile | null;
  availableFiles: TFile[];
  allFileContents: Record<string, string>;
  targetFile: TFile;
  nextContent: string;
}): EditableSourcePatchStateResult<TFile> {
  const nextSelectedFile =
    selectedFile?.name === targetFile.name && selectedFile.content !== nextContent
      ? { ...selectedFile, content: nextContent }
      : selectedFile;

  const nextAvailableFiles = availableFiles.some(
    (entry) => entry.name === targetFile.name && entry.content !== nextContent,
  )
    ? availableFiles.map((entry) =>
        entry.name === targetFile.name ? { ...entry, content: nextContent } : entry,
      )
    : availableFiles;

  const nextAllFileContents =
    allFileContents[targetFile.name] !== nextContent
      ? {
          ...allFileContents,
          [targetFile.name]: nextContent,
        }
      : allFileContents;

  return {
    nextSelectedFile,
    nextAvailableFiles,
    nextAllFileContents,
    didChange:
      nextSelectedFile !== selectedFile ||
      nextAvailableFiles !== availableFiles ||
      nextAllFileContents !== allFileContents,
  };
}
