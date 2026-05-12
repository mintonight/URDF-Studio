import type { TranslationKeys } from '@/shared/i18n/types';

const URDF_UNSUPPORTED_BALL_PATTERN =
  /\[URDF export\] Joint "([^"]+)" uses unsupported ball type\./i;

export function resolveExportErrorMessage(
  error: unknown,
  t: Pick<TranslationKeys, 'exportFailedParse' | 'exportUrdfBallJointUnsupported'>,
): string {
  const message = error instanceof Error && error.message ? error.message : '';
  const unsupportedBallMatch = message.match(URDF_UNSUPPORTED_BALL_PATTERN);

  if (unsupportedBallMatch) {
    return t.exportUrdfBallJointUnsupported.replace('{name}', unsupportedBallMatch[1]);
  }

  return message || t.exportFailedParse;
}
