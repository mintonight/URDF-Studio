export function stripTreeDisplayNamePrefix(value: string, prefix?: string): string {
  const normalizedPrefix = prefix?.trim();
  if (!normalizedPrefix) {
    return value;
  }

  const prefixedMarker = `${normalizedPrefix}_`;
  if (!value.toLowerCase().startsWith(prefixedMarker.toLowerCase())) {
    return value;
  }

  return value.slice(prefixedMarker.length) || value;
}
