export interface TreeGeometryDisclosureOptions {
  showGeometryDetailsByDefault: boolean;
  selectionSubType?: 'visual' | 'collision';
  hasSelectedExtraVisual: boolean;
  hasSelectedExtraCollision: boolean;
}

export function shouldAutoExpandTreeGeometryDetails({
  showGeometryDetailsByDefault,
  selectionSubType,
  hasSelectedExtraVisual,
  hasSelectedExtraCollision,
}: TreeGeometryDisclosureOptions): boolean {
  if (!showGeometryDetailsByDefault) {
    return false;
  }

  return (
    selectionSubType === 'visual'
    || selectionSubType === 'collision'
    || hasSelectedExtraVisual
    || hasSelectedExtraCollision
  );
}
