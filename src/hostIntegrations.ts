/**
 * Narrow, stable hooks for hosting shells. The implementation lives in the
 * shared leaf layer so features never depend back on this app-level facade.
 */
export {
  getAiBackendAuthToken,
  resolveAssetDownloadEndpoint,
  setAiBackendAuthTokenProvider,
  setAssetDownloadEndpointResolver,
  type AiBackendAuthTokenProvider,
  type AssetDownloadEndpointResolver,
} from './shared/hostIntegrationState';
