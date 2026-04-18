import type { ResolvedViewerRobotSourceFormat } from './sourceFormat';

interface ResolveUrdfXmlFallbackPolicyArgs {
  resolvedSourceFormat: ResolvedViewerRobotSourceFormat;
  hasStructuredRobotState: boolean;
  allowUrdfXmlFallback: boolean;
}

export function shouldWaitForStructuredUrdfRobotState({
  resolvedSourceFormat,
  hasStructuredRobotState,
  allowUrdfXmlFallback,
}: ResolveUrdfXmlFallbackPolicyArgs): boolean {
  return resolvedSourceFormat === 'urdf' && !hasStructuredRobotState && !allowUrdfXmlFallback;
}
