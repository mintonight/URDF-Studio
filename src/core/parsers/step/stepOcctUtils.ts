/** Return whether three points are non-finite or have effectively zero area. */
export function isDegenerateTriangle(coordinates: readonly number[]): boolean {
  if (coordinates.length !== 9 || coordinates.some((value) => !Number.isFinite(value))) {
    return true;
  }
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = coordinates;
  const crossX = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const crossZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-18;
}
