export interface EditableTextFileLike {
  name: string;
  content: string;
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
