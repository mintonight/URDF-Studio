/**
 * Feature gate for analytic surface reconstruction in STEP export.
 *
 * Analytic reconstruction (plane/cylinder/sphere/cone recognition) is
 * experimental and disabled by default. It must not be enabled until
 * browser verification and independent CAD reopen confirm validity.
 */

/**
 * Returns true only when an explicit experimental flag enables analytic
 * reconstruction. The flag is never derived from meshMode.
 */
export function shouldUseAnalyticReconstruction(
  experimentalEnabled: boolean | undefined,
): boolean {
  return experimentalEnabled === true;
}
