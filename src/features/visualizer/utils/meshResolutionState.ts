export interface MergeResolvedMeshLoadKeysOptions {
  currentResolvedKeys: ReadonlySet<string>;
  currentSignature: string;
  expectedMeshLoadKeySet: ReadonlySet<string>;
  expectedSignature: string;
  pendingResolvedKeys: Iterable<string>;
}

export interface MeshResolutionStateSnapshot {
  signature: string;
  resolvedKeys: Set<string>;
}

export function reconcileResolvedMeshLoadKeys({
  currentResolvedKeys,
  expectedMeshLoadKeySet,
  expectedSignature,
}: {
  currentResolvedKeys: ReadonlySet<string>;
  expectedMeshLoadKeySet: ReadonlySet<string>;
  expectedSignature: string;
}): MeshResolutionStateSnapshot {
  const nextResolvedKeys = new Set<string>();

  for (const meshLoadKey of currentResolvedKeys) {
    if (expectedMeshLoadKeySet.has(meshLoadKey)) {
      nextResolvedKeys.add(meshLoadKey);
    }
  }

  return {
    signature: expectedSignature,
    resolvedKeys: nextResolvedKeys,
  };
}

export function mergeResolvedMeshLoadKeys({
  currentResolvedKeys,
  currentSignature,
  expectedMeshLoadKeySet,
  expectedSignature,
  pendingResolvedKeys,
}: MergeResolvedMeshLoadKeysOptions): MeshResolutionStateSnapshot | null {
  const baseResolvedKeys =
    currentSignature === expectedSignature ? currentResolvedKeys : new Set<string>();
  let nextResolvedKeys: Set<string> | null =
    currentSignature === expectedSignature ? null : new Set<string>();

  for (const meshLoadKey of pendingResolvedKeys) {
    if (!expectedMeshLoadKeySet.has(meshLoadKey)) {
      continue;
    }

    const hasResolved = nextResolvedKeys
      ? nextResolvedKeys.has(meshLoadKey)
      : baseResolvedKeys.has(meshLoadKey);
    if (hasResolved) {
      continue;
    }

    if (!nextResolvedKeys) {
      nextResolvedKeys = new Set(baseResolvedKeys);
    }
    nextResolvedKeys.add(meshLoadKey);
  }

  if (!nextResolvedKeys) {
    return null;
  }

  return {
    signature: expectedSignature,
    resolvedKeys: nextResolvedKeys,
  };
}
