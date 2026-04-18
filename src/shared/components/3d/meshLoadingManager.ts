import { useMemo } from 'react';
import * as THREE from 'three';
import { buildAssetIndex, resolveManagedAssetUrl } from '@/core/loaders';

export const useLoadingManager = (assets: Record<string, string>, assetBaseDir = '') => {
  return useMemo(() => {
    const manager = new THREE.LoadingManager();
    const assetIndex = buildAssetIndex(assets, assetBaseDir);

    manager.setURLModifier((url) => resolveManagedAssetUrl(url, assetIndex, assetBaseDir));

    return manager;
  }, [assetBaseDir, assets]);
};
