/**
 * Import-free state shared by Core features and an optional hosting shell.
 * Keep this module free of UI, store, and feature dependencies.
 */

export type AssetDownloadEndpointResolver = (remoteImportOrigin: string) => URL;
export type AiBackendAuthTokenProvider = () => string | null | undefined;

const defaultAssetDownloadEndpointResolver: AssetDownloadEndpointResolver =
  (remoteImportOrigin) => new URL('/api/download-asset', remoteImportOrigin);

let assetDownloadEndpointResolver = defaultAssetDownloadEndpointResolver;
let aiBackendAuthTokenProvider: AiBackendAuthTokenProvider | null = null;

export function setAssetDownloadEndpointResolver(
  resolver: AssetDownloadEndpointResolver | null,
): void {
  assetDownloadEndpointResolver = resolver ?? defaultAssetDownloadEndpointResolver;
}

export function resolveAssetDownloadEndpoint(remoteImportOrigin: string): URL {
  return assetDownloadEndpointResolver(remoteImportOrigin);
}

export function setAiBackendAuthTokenProvider(
  provider: AiBackendAuthTokenProvider | null,
): void {
  aiBackendAuthTokenProvider = provider;
}

export function getAiBackendAuthToken(): string | null | undefined {
  return aiBackendAuthTokenProvider?.();
}
