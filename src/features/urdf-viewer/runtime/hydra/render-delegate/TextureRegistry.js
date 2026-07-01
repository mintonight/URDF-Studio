// @ts-nocheck
import { DefaultLoadingManager, Texture, TextureLoader } from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { debugTextures } from './shared.js';
const nowMs = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now());
const canLoadBitmapTextureInWorker = () => typeof document === 'undefined'
    && typeof createImageBitmap === 'function';
const closeTextureImageIfNeeded = (texture) => {
    const image = texture?.image;
    if (!image || typeof image.close !== 'function')
        return;
    try {
        image.close();
    }
    catch {
        return;
    }
    if (texture.image === image) {
        texture.image = null;
    }
};
const disposeManagedTexture = (texture) => {
    if (!texture || typeof texture.dispose !== 'function')
        return;
    closeTextureImageIfNeeded(texture);
    texture.dispose();
};
const ensureDefaultLoadingManagerTracker = () => {
    const manager = DefaultLoadingManager;
    if (!manager)
        return null;
    if (manager.__HYDRA_LOADING_TRACKER__) {
        return manager.__HYDRA_LOADING_TRACKER__;
    }
    const tracker = {
        starts: 0,
        ends: 0,
        errors: 0,
        pending: 0,
        lastStartUrl: '',
        lastEndUrl: '',
        lastErrorUrl: '',
        getSnapshot() {
            return {
                starts: Number(this.starts || 0),
                ends: Number(this.ends || 0),
                errors: Number(this.errors || 0),
                pending: Number(this.pending || 0),
                lastStartUrl: this.lastStartUrl || '',
                lastEndUrl: this.lastEndUrl || '',
                lastErrorUrl: this.lastErrorUrl || '',
            };
        },
    };
    const originalItemStart = typeof manager.itemStart === 'function'
        ? manager.itemStart.bind(manager)
        : null;
    const originalItemEnd = typeof manager.itemEnd === 'function'
        ? manager.itemEnd.bind(manager)
        : null;
    const originalItemError = typeof manager.itemError === 'function'
        ? manager.itemError.bind(manager)
        : null;
    manager.itemStart = (url) => {
        tracker.starts += 1;
        tracker.pending = Math.max(0, Number(tracker.pending || 0) + 1);
        tracker.lastStartUrl = String(url || '');
        if (originalItemStart)
            return originalItemStart(url);
        return undefined;
    };
    manager.itemEnd = (url) => {
        tracker.ends += 1;
        tracker.pending = Math.max(0, Number(tracker.pending || 0) - 1);
        tracker.lastEndUrl = String(url || '');
        if (originalItemEnd)
            return originalItemEnd(url);
        return undefined;
    };
    manager.itemError = (url) => {
        tracker.errors += 1;
        tracker.lastErrorUrl = String(url || '');
        if (originalItemError)
            return originalItemError(url);
        return undefined;
    };
    manager.__HYDRA_LOADING_TRACKER__ = tracker;
    if (typeof window !== 'undefined') {
        window.__HYDRA_LOADING_MANAGER_METRICS__ = {
            getSnapshot: () => tracker.getSnapshot(),
        };
    }
    return tracker;
};
class TextureRegistry {
    /**
     * @param {import('..').threeJsRenderDelegateConfig} config
     */
    constructor(config) {
        this.config = config;
        this.allPaths = config.paths;
        this.textures = [];
        this._disposed = false;
        this._pendingBlobObjectUrls = new Set();
        this.loader = new TextureLoader();
        this.tgaLoader = new TGALoader();
        this.exrLoader = new EXRLoader();
        this._loadingManagerTracker = ensureDefaultLoadingManagerTracker();
        this._textureLoadStats = {
            started: 0,
            completed: 0,
            failed: 0,
            pending: 0,
            recent: [],
            maxRecent: 24,
        };
        this.enableTextureLoadMonitoring = globalThis?.__HYDRA_PROFILE_TEXTURES__ === true;
        if (this.enableTextureLoadMonitoring && typeof window !== 'undefined') {
            window.__HYDRA_TEXTURE_METRICS__ = {
                getSnapshot: () => this.getTextureLoadSnapshot(),
            };
        }
    }
    dispose() {
        if (this._disposed === true)
            return;
        this._disposed = true;
        if (this._pendingBlobObjectUrls instanceof Set) {
            this._pendingBlobObjectUrls.forEach((url) => {
                try {
                    URL.revokeObjectURL(url);
                }
                catch {
                    // best-effort cleanup, never block texture lifecycle
                }
            });
            this._pendingBlobObjectUrls.clear();
        }
        const managedEntries = Array.isArray(this.textures)
            ? Object.values(this.textures)
            : [];
        this.textures = [];
        managedEntries.forEach((entry) => {
            if (entry instanceof Texture) {
                disposeManagedTexture(entry);
                return;
            }
            if (entry && typeof entry.then === 'function') {
                Promise.resolve(entry)
                    .then((texture) => {
                    if (this._disposed) {
                        disposeManagedTexture(texture);
                    }
                })
                    .catch(() => undefined);
            }
        });
        if (this.enableTextureLoadMonitoring) {
            const globalMetricsTarget = typeof window !== 'undefined' ? window : globalThis;
            if (globalMetricsTarget?.__HYDRA_TEXTURE_METRICS__) {
                globalMetricsTarget.__HYDRA_TEXTURE_METRICS__ = undefined;
            }
        }
    }
    getTextureLoadSnapshot() {
        const local = this._textureLoadStats || {};
        const manager = this._loadingManagerTracker?.getSnapshot?.() || null;
        return {
            started: Number(local.started || 0),
            completed: Number(local.completed || 0),
            failed: Number(local.failed || 0),
            pending: Number(local.pending || 0),
            manager,
            recent: Array.isArray(local.recent) ? local.recent.slice(-12) : [],
        };
    }
    getTexture(resourcePath) {
        if (this._disposed) {
            return Promise.reject(new Error(`TextureRegistry has been disposed: ${resourcePath}`));
        }
        if (this.textures[resourcePath]) {
            return this.textures[resourcePath];
        }
        let textureResolve, textureReject;
        this.textures[resourcePath] = new Promise((resolve, reject) => {
            textureResolve = resolve;
            textureReject = reject;
        });
        this.textures[resourcePath]
            .then((texture) => {
            if (this._disposed) {
                disposeManagedTexture(texture);
            }
        })
            .catch(() => undefined);
        if (!resourcePath) {
            return Promise.reject(new Error('Empty resource path for file: ' + resourcePath));
        }
        let filetype = undefined;
        let lowercaseFilename = resourcePath.toLowerCase();
        if (lowercaseFilename.indexOf('.png') >= lowercaseFilename.length - 5) {
            filetype = 'image/png';
        }
        else if (lowercaseFilename.indexOf('.jpg') >= lowercaseFilename.length - 5) {
            filetype = 'image/jpeg';
        }
        else if (lowercaseFilename.indexOf('.jpeg') >= lowercaseFilename.length - 5) {
            filetype = 'image/jpeg';
        }
        else if (lowercaseFilename.indexOf('.exr') >= lowercaseFilename.length - 4) {
            console.error("EXR textures are not fully supported yet", resourcePath);
            // using EXRLoader explicitly
            filetype = 'image/x-exr';
        }
        else if (lowercaseFilename.indexOf('.tga') >= lowercaseFilename.length - 4) {
            console.error("TGA textures are not fully supported yet", resourcePath);
            // using TGALoader explicitly
            filetype = 'image/tga';
        }
        else {
            console.error("Error when loading texture: unknown filetype", resourcePath);
            // throw new Error('Unknown filetype');
        }
        this.config.driver().getFile(resourcePath, async (loadedFile) => {
            let loader = this.loader;
            if (filetype === 'image/tga')
                loader = this.tgaLoader;
            else if (filetype === 'image/x-exr')
                loader = this.exrLoader;
            const baseUrl = this.baseUrl;
            const loadFromFile = (_loadedFile) => {
                let url = undefined;
                let createdBlobObjectUrl = false;
                let createdBlob = null;
                if (_loadedFile) {
                    createdBlob = new Blob([_loadedFile.slice(0)], { type: filetype });
                    url = URL.createObjectURL(createdBlob);
                    createdBlobObjectUrl = true;
                    this._pendingBlobObjectUrls?.add?.(url);
                }
                else {
                    if (baseUrl)
                        url = baseUrl + '/' + resourcePath;
                    else
                        url = resourcePath;
                }
                const loadStartedAt = nowMs();
                const stats = this._textureLoadStats;
                stats.started = Number(stats.started || 0) + 1;
                stats.pending = Math.max(0, Number(stats.pending || 0) + 1);
                let loadFinished = false;
                let blobUrlReleased = false;
                const releaseBlobObjectUrl = () => {
                    if (!createdBlobObjectUrl || !url)
                        return;
                    this._pendingBlobObjectUrls?.delete?.(url);
                    if (blobUrlReleased)
                        return;
                    blobUrlReleased = true;
                    try {
                        URL.revokeObjectURL(url);
                    }
                    catch {
                        // best-effort cleanup, never block texture lifecycle
                    }
                };
                const finalizeLoad = (status, error = null) => {
                    if (loadFinished)
                        return;
                    loadFinished = true;
                    const loadEndedAt = nowMs();
                    const durationMs = Math.max(0, loadEndedAt - loadStartedAt);
                    stats.pending = Math.max(0, Number(stats.pending || 0) - 1);
                    if (status === 'ok') {
                        stats.completed = Number(stats.completed || 0) + 1;
                    }
                    else {
                        stats.failed = Number(stats.failed || 0) + 1;
                    }
                    const managerPending = Number(this._loadingManagerTracker?.getSnapshot?.()?.pending || 0);
                    const recentEntry = {
                        resourcePath: String(resourcePath || ''),
                        url: String(url || ''),
                        status,
                        durationMs,
                        pending: Number(stats.pending || 0),
                        managerPending,
                    };
                    if (Array.isArray(stats.recent)) {
                        stats.recent.push(recentEntry);
                        const maxRecent = Number(stats.maxRecent || 24);
                        if (stats.recent.length > maxRecent) {
                            stats.recent.splice(0, stats.recent.length - maxRecent);
                        }
                    }
                    if (this.enableTextureLoadMonitoring) {
                        const pendingSuffix = `pending=${Number(stats.pending || 0)} managerPending=${managerPending}`;
                        if (status !== 'ok') {
                            console.error(`Texture Load Failed: ${resourcePath} took ${durationMs.toFixed(3)} ms (${pendingSuffix})`, error);
                        }
                    }
                };
                const loadBitmapTextureFromWorker = async () => {
                    const bitmapBlob = createdBlob
                        || await fetch(url).then((response) => {
                            if (!response.ok) {
                                throw new Error(`Failed to fetch texture: ${url}`);
                            }
                            return response.blob();
                        });
                    const bitmap = await createImageBitmap(bitmapBlob);
                    const texture = new Texture(bitmap);
                    texture.name = resourcePath;
                    texture.needsUpdate = true;
                    finalizeLoad('ok');
                    releaseBlobObjectUrl();
                    textureResolve(texture);
                };
                // Load the texture
                try {
                    if (
                        canLoadBitmapTextureInWorker()
                        && (filetype === 'image/png' || filetype === 'image/jpeg')
                    ) {
                        void loadBitmapTextureFromWorker().catch((error) => {
                            finalizeLoad('error', error);
                            releaseBlobObjectUrl();
                            textureReject(error);
                        });
                        return;
                    }
                    loader.load(
                    // resource URL
                    url, 
                    // onLoad callback
                    (texture) => {
                        texture.name = resourcePath;
                        finalizeLoad('ok');
                        releaseBlobObjectUrl();
                        textureResolve(texture);
                    }, 
                    // onProgress callback currently not used
                    undefined, 
                    // onError callback
                    (err) => {
                        finalizeLoad('error', err);
                        releaseBlobObjectUrl();
                        textureReject(err);
                    });
                }
                catch (error) {
                    finalizeLoad('error', error);
                    releaseBlobObjectUrl();
                    textureReject(error);
                }
            };
            if (!loadedFile) {
                // if the file is not part of the filesystem, we can still try to fetch it from the network
                if (baseUrl) {
                }
                else {
                    textureReject(new Error('Unknown file: ' + resourcePath));
                    return;
                }
            }
            loadFromFile(loadedFile);
        });
        return this.textures[resourcePath];
    }
}
export { TextureRegistry };
