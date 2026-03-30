import { Assets, Texture } from "pixi.js";

import type { AssetLoadProgress, PreparedStoryboardData } from "../types/storyboard";
import {
    getFileName,
    getImageExtensions,
    getMimeType,
    hasKnownImageExtension,
    isVideoPath,
    normalizePath,
} from "../utils/path";
import { logger } from "../utils/logger";

export interface ResolvedAssets {
    textures: Map<string, Texture>;
    blobs: Map<string, Blob>;
    urls: Map<string, string>;
    managedTextureKeys: Set<string>;
}

export interface BlobAssetSource {
    keys(): IterableIterator<string>;
    loadMany(
        paths: string[],
        onProgress?: (progress: { loaded: number; total: number; currentFile: string }) => void,
    ): Promise<Map<string, Blob>>;
}

export async function loadStoryboardAssets(
    storyboard: PreparedStoryboardData,
    sourceAssets: BlobAssetSource,
    onProgress?: (progress: AssetLoadProgress) => void,
): Promise<ResolvedAssets> {
    const requiredAssetPaths = collectRequiredAssetPaths(storyboard);
    const availableAssetKeys = [...sourceAssets.keys()];
    const resolvedAssets: ResolvedAssets = {
        textures: new Map(),
        blobs: new Map(),
        urls: new Map(),
        managedTextureKeys: new Set(),
    };

    const resolvedAssetKeys = new Map<string, string>();
    const uniqueResolvedAssetKeys = new Set<string>();

    for (const path of requiredAssetPaths) {
        const resolvedKey = resolveAssetKey(path, availableAssetKeys);
        if (resolvedKey) {
            resolvedAssetKeys.set(path, resolvedKey);
            uniqueResolvedAssetKeys.add(resolvedKey);
        }
    }

    const extractionTotal = uniqueResolvedAssetKeys.size;
    const processingTotal = requiredAssetPaths.length;
    const total = Math.max(1, extractionTotal + processingTotal);

    onProgress?.({
        loaded: 0,
        total,
        percent: 0,
        currentFile: extractionTotal > 0 ? "Preparing archive assets..." : "Preparing storyboard assets...",
    });

    const extractedAssets = await sourceAssets.loadMany([...uniqueResolvedAssetKeys], (progress) => {
        onProgress?.({
            loaded: progress.loaded,
            total,
            percent: Math.round((progress.loaded / total) * 100),
            currentFile: `Extracting: ${progress.currentFile}`,
        });
    });

    let loaded = extractionTotal;

    for (const path of requiredAssetPaths) {
        const resolvedKey = resolvedAssetKeys.get(path);
        const resolvedBlob = resolvedKey ? extractedAssets.get(resolvedKey) : undefined;
        loaded += 1;

        if (!resolvedBlob) {
            onProgress?.({
                loaded,
                total,
                percent: total === 0 ? 100 : Math.round((loaded / total) * 100),
                currentFile: path,
            });
            continue;
        }

        resolvedAssets.blobs.set(path, resolvedBlob);

        if (isImageAsset(path)) {
            try {
                const loadedTexture = await loadTexture(path, resolvedBlob);
                resolvedAssets.textures.set(path, loadedTexture.texture);

                if (loadedTexture.managedUrl) {
                    resolvedAssets.urls.set(path, loadedTexture.managedUrl);
                    resolvedAssets.managedTextureKeys.add(path);
                }
            } catch (error) {
                logger.warn(`Failed to load storyboard image asset: ${path}`, error);
            }
        }

        onProgress?.({
            loaded,
            total,
            percent: total === 0 ? 100 : Math.round((loaded / total) * 100),
            currentFile: path,
        });
    }

    return resolvedAssets;
}

export function disposeResolvedAssets(assets: ResolvedAssets): void {
    for (const [path, texture] of assets.textures.entries()) {
        if (assets.managedTextureKeys.has(path)) {
            const managedUrl = assets.urls.get(path);
            void Assets.unload(path)
                .catch(() => undefined)
                .finally(() => {
                    if (managedUrl) {
                        URL.revokeObjectURL(managedUrl);
                    }
                });
            continue;
        }

        texture.destroy(true);
    }

    for (const [path, url] of assets.urls.entries()) {
        if (!assets.managedTextureKeys.has(path)) {
            URL.revokeObjectURL(url);
        }
    }

    assets.textures.clear();
    assets.blobs.clear();
    assets.urls.clear();
    assets.managedTextureKeys.clear();
}

function collectRequiredAssetPaths(storyboard: PreparedStoryboardData): string[] {
    const paths = new Set<string>();

    if (storyboard.background) {
        paths.add(storyboard.background.path);
    }

    if (storyboard.video) {
        paths.add(storyboard.video.path);
    }

    if (storyboard.audioFilename) {
        paths.add(storyboard.audioFilename);
    }

    for (const visual of storyboard.visuals) {
        if (visual.kind === "animation") {
            for (const framePath of visual.framePaths) {
                paths.add(framePath);
            }
        } else {
            paths.add(visual.filePath);
        }
    }

    for (const sample of storyboard.samples) {
        paths.add(sample.path);
    }

    return [...paths];
}

function isImageAsset(path: string): boolean {
    return hasKnownImageExtension(path) || /^(sb[\\/]|storyboard)/i.test(path);
}

function resolveAssetKey(requestedPath: string, assetKeys: string[]): string | undefined {
    const requested = normalizePath(requestedPath);

    if (assetKeys.includes(requestedPath)) {
        return requestedPath;
    }

    for (const key of assetKeys) {
        if (normalizePath(key) === requested) {
            return key;
        }
    }

    const fileName = getFileName(requestedPath).toLowerCase();
    for (const key of assetKeys) {
        if (getFileName(key).toLowerCase() === fileName) {
            return key;
        }
    }

    if (!hasKnownImageExtension(requestedPath) && !isVideoPath(requestedPath)) {
        for (const extension of getImageExtensions()) {
            const withExtension = `${requestedPath}${extension}`;
            const resolved = resolveAssetKey(withExtension, assetKeys);
            if (resolved) {
                return resolved;
            }
        }
    }

    return undefined;
}

async function loadTexture(path: string, blob: Blob): Promise<{ texture: Texture; managedUrl?: string }> {
    const typedBlob = new Blob([blob], { type: getMimeType(path) });
    const objectUrl = URL.createObjectURL(typedBlob);

    try {
        const texture = await Assets.load<Texture>({ alias: path, src: objectUrl, parser: "loadTextures" });
        return { texture, managedUrl: objectUrl };
    } catch {
        try {
            const image = await loadImage(objectUrl);
            return { texture: Texture.from(image) };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        image.src = src;
    });
}
