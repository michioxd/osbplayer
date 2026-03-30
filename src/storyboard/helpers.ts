import { Sprite, Texture } from "pixi.js";

import type {
    PreparedStoryboardAnimation,
    PreparedStoryboardData,
    PreparedStoryboardVisual,
} from "../types/storyboard";
import { Layer, Origin } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { isTimeInRanges, keyframeValueAt, packRgb } from "./interpolation";
import type { ResolvedAssets } from "./assets";
import type { LayoutBorder } from "./layoutBorders";

export const STORYBOARD_WIDTH = 640;
export const STORYBOARD_HEIGHT = 480;
const DEFAULT_VIDEO_READY_TIMEOUT_MS = 15_000;
const EARLY_EFFECT_SETUP_GRACE_MS = 500;

export type GameplayState = "passing" | "failing";

export interface RenderVisual {
    visual: PreparedStoryboardVisual;
    sprite: Sprite;
    textures: Texture[];
    border?: LayoutBorder;
    isDynamic: boolean;
    active: boolean;
    dynamicListIndex: number;
    indices: Int32Array;
}

export function resolveVisualTextures(visual: PreparedStoryboardVisual, assets: ResolvedAssets): Texture[] {
    if (visual.kind === "animation") {
        return visual.framePaths
            .map((path) => assets.textures.get(cleanPath(path)) || assets.textures.get(path))
            .filter((texture): texture is Texture => Boolean(texture));
    }

    const cleanedPath = cleanPath(visual.filePath);
    const texture = assets.textures.get(cleanedPath) || assets.textures.get(visual.filePath);
    return texture ? [texture] : [];
}

export function isVisualDynamic(visual: PreparedStoryboardVisual, textures: Texture[]): boolean {
    if (visual.kind === "animation" && textures.length > 1) {
        return true;
    }

    return (
        visual.positionKeyframes[0].length > 1 ||
        visual.positionKeyframes[1].length > 1 ||
        visual.rotationKeyframes.length > 1 ||
        visual.uniformScaleKeyframes.length > 1 ||
        visual.vectorScaleKeyframes[0].length > 1 ||
        visual.vectorScaleKeyframes[1].length > 1 ||
        visual.colourKeyframes.length > 1 ||
        visual.opacityKeyframes.length > 1 ||
        visual.flipHRange.length > 0 ||
        visual.flipVRange.length > 0 ||
        visual.additiveRange.length > 0
    );
}

export function renderVisualAtTime(entry: RenderVisual, time: number, gameplayState: GameplayState): void {
    const { sprite, visual, textures, indices } = entry;

    if (
        !shouldRenderForGameplayState(visual, gameplayState) ||
        time < visual.activeTime[0] ||
        time > visual.activeTime[1]
    ) {
        if (sprite.visible) sprite.visible = false;
        return;
    }

    const alpha = keyframeValueAt(visual.opacityKeyframes, time, 1, indices, 0);
    const uniformScale = keyframeValueAt(
        visual.uniformScaleKeyframes,
        time,
        resolveEarlyUniformScaleDefault(visual, time),
        indices,
        1,
    );
    const vectorScaleX = keyframeValueAt(visual.vectorScaleKeyframes[0], time, 1, indices, 2);
    const vectorScaleY = keyframeValueAt(visual.vectorScaleKeyframes[1], time, 1, indices, 3);

    const scaleX = uniformScale * vectorScaleX;
    const scaleY = uniformScale * vectorScaleY;

    if (alpha <= 0 || scaleX === 0 || scaleY === 0) {
        if (sprite.visible) sprite.visible = false;
        return;
    }

    const x = keyframeValueAt(visual.positionKeyframes[0], time, visual.x, indices, 4);
    const y = keyframeValueAt(visual.positionKeyframes[1], time, visual.y, indices, 5);

    if (x < -300 || x > 1000 || y < -300 || y > 800) {
        if (sprite.visible) sprite.visible = false;
        return;
    }

    const rotation = keyframeValueAt(visual.rotationKeyframes, time, 0, indices, 6);

    const colourArr = keyframeValueAt<number[] | null>(visual.colourKeyframes, time, null, indices, 7);
    const tint = colourArr ? packRgb(colourArr) : 0xffffff;

    const flipH = isTimeInRanges(visual.flipHRange, time);
    const flipV = isTimeInRanges(visual.flipVRange, time);
    const additive = isTimeInRanges(visual.additiveRange, time) || shouldBackfillAdditiveRange(visual, time);

    let anchorX = getAnchorX(visual.origin);
    let anchorY = getAnchorY(visual.origin);
    if (flipH !== vectorScaleX < 0) anchorX = 1 - anchorX;
    if (flipV !== vectorScaleY < 0) anchorY = 1 - anchorY;

    if (!sprite.visible) sprite.visible = true;

    if (sprite.anchor.x !== anchorX || sprite.anchor.y !== anchorY) sprite.anchor.set(anchorX, anchorY);
    if (sprite.position.x !== x || sprite.position.y !== y) sprite.position.set(x, y);

    const finalScaleX = scaleX * (flipH ? -1 : 1);
    const finalScaleY = scaleY * (flipV ? -1 : 1);
    if (sprite.scale.x !== finalScaleX || sprite.scale.y !== finalScaleY) sprite.scale.set(finalScaleX, finalScaleY);

    if (sprite.rotation !== rotation) sprite.rotation = rotation;

    const finalAlpha = clamp(alpha, 0, 1);
    if (sprite.alpha !== finalAlpha) sprite.alpha = finalAlpha;

    if (sprite.tint !== tint) sprite.tint = tint;

    const blendMode = additive ? "add" : "normal";
    if (sprite.blendMode !== blendMode) sprite.blendMode = blendMode;

    if (visual.kind === "animation") {
        const texture = resolveAnimationFrame(visual, textures, time);
        if (texture && sprite.texture !== texture) {
            sprite.texture = texture;
        }
    }
}

const ORIGIN_ANCHORS: Record<Origin, { x: number; y: number }> = {
    [Origin.TopLeft]: { x: 0, y: 0 },
    [Origin.TopCentre]: { x: 0.5, y: 0 },
    [Origin.TopRight]: { x: 1, y: 0 },
    [Origin.CentreLeft]: { x: 0, y: 0.5 },
    [Origin.Centre]: { x: 0.5, y: 0.5 },
    [Origin.CentreRight]: { x: 1, y: 0.5 },
    [Origin.BottomLeft]: { x: 0, y: 1 },
    [Origin.BottomCentre]: { x: 0.5, y: 1 },
    [Origin.BottomRight]: { x: 1, y: 1 },
};

function getAnchorX(origin: Origin): number {
    return ORIGIN_ANCHORS[origin]?.x ?? 0.5;
}

function getAnchorY(origin: Origin): number {
    return ORIGIN_ANCHORS[origin]?.y ?? 0.5;
}

export function anchorFromOrigin(origin: Origin): [number, number] {
    const anchor = ORIGIN_ANCHORS[origin] || ORIGIN_ANCHORS[Origin.Centre];
    return [anchor.x, anchor.y];
}

export function shouldUseWidescreenStoryboard(storyboard: PreparedStoryboardData): boolean {
    return storyboard.widescreenStoryboard || (storyboard.visuals.length === 0 && Boolean(storyboard.video));
}

export function resolveMediaPosition(
    media:
        | Pick<PreparedStoryboardData, "background" | "video">["background"]
        | Pick<PreparedStoryboardData, "background" | "video">["video"],
    frameWidth: number,
): [number, number] {
    if (!media) {
        return [frameWidth / 2, STORYBOARD_HEIGHT / 2];
    }

    if (media.x === 0 && media.y === 0) {
        return [frameWidth / 2, STORYBOARD_HEIGHT / 2];
    }

    return [media.x, media.y];
}

export function resolveVideoPosition(
    media: Pick<PreparedStoryboardData, "video">["video"],
    frameWidth: number,
): [number, number] {
    if (!media || (media.x === 0 && media.y === 0)) {
        return [frameWidth / 2, STORYBOARD_HEIGHT / 2];
    }

    return [media.x + (frameWidth - STORYBOARD_WIDTH) / 2, media.y];
}

export function fitHeightScale(sourceHeight: number, targetHeight: number): number {
    if (sourceHeight <= 0) {
        return 1;
    }

    return targetHeight / sourceHeight;
}

export function coverScaleForSource(
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
): number {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
        return 1;
    }

    return Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
}

export function getTextureHeight(texture: Texture): number {
    if (texture.height > 1) return texture.height;
    if (texture.source && texture.source.height > 1) return texture.source.height;
    if (texture.orig && texture.orig.height > 1) return texture.orig.height;
    return 1080;
}

export function hasIndependentStoryboardBackground(storyboard: PreparedStoryboardData): boolean {
    return storyboard.visuals.some((visual) => {
        if (visual.layer !== Layer.Background) {
            return false;
        }

        return !isRedundantBeatmapBackgroundVisual(visual, storyboard);
    });
}

export function isRedundantBeatmapBackgroundVisual(
    visual: PreparedStoryboardVisual,
    storyboard: PreparedStoryboardData,
): boolean {
    if (!storyboard.background || visual.layer !== Layer.Background) {
        return false;
    }

    if (cleanPath(visual.filePath) !== cleanPath(storyboard.background.path)) {
        return false;
    }

    return visual.expandedEvents.length === 0 && visual.loops.length === 0 && visual.triggers.length === 0;
}

export function syncVideoTime(videoElement: HTMLVideoElement, desiredVideoTime: number): void {
    if (
        videoElement.readyState < HTMLMediaElement.HAVE_METADATA ||
        videoElement.videoWidth <= 0 ||
        videoElement.videoHeight <= 0
    ) {
        return;
    }

    const clampedTime = Number.isFinite(videoElement.duration)
        ? Math.min(Math.max(0, desiredVideoTime), Math.max(0, videoElement.duration - 0.001))
        : Math.max(0, desiredVideoTime);

    if (Math.abs(videoElement.currentTime - clampedTime) > 0.05) {
        videoElement.currentTime = clampedTime;
    }
}

export function waitForVideoReady(
    videoElement: HTMLVideoElement,
    timeoutMs = DEFAULT_VIDEO_READY_TIMEOUT_MS,
): Promise<void> {
    if (
        videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
    ) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for video ready"));
        }, timeoutMs);
        const handleLoadedMetadata = (): void => {
            if (videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
                return;
            }

            cleanup();
            resolve();
        };
        const handleError = (): void => {
            cleanup();
            reject(new Error("Failed to load storyboard video."));
        };
        const cleanup = (): void => {
            clearTimeout(timeoutId);
            videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
            videoElement.removeEventListener("loadeddata", handleLoadedMetadata);
            videoElement.removeEventListener("canplay", handleLoadedMetadata);
            videoElement.removeEventListener("error", handleError);
        };

        videoElement.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
        videoElement.addEventListener("loadeddata", handleLoadedMetadata, { once: true });
        videoElement.addEventListener("canplay", handleLoadedMetadata, { once: true });
        videoElement.addEventListener("error", handleError, { once: true });
    });
}

export function findFirstVisualStartingAfter(visuals: RenderVisual[], time: number): number {
    let low = 0;
    let high = visuals.length;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (visuals[middle].visual.activeTime[0] <= time) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}

export function findFirstVisualEndingAtOrAfter(visuals: RenderVisual[], time: number): number {
    let low = 0;
    let high = visuals.length;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (visuals[middle].visual.activeTime[1] < time) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}

function resolveAnimationFrame(
    visual: PreparedStoryboardAnimation,
    textures: Texture[],
    time: number,
): Texture | undefined {
    if (textures.length === 0) {
        return undefined;
    }

    const frameDelay = Math.max(1, visual.frameDelay);
    const elapsed = Math.max(0, time - visual.activeTime[0]);
    const rawIndex = Math.floor(elapsed / frameDelay);

    if (visual.loopType === "LoopOnce") {
        return textures[Math.min(textures.length - 1, rawIndex)];
    }

    return textures[rawIndex % textures.length];
}

function resolveEarlyUniformScaleDefault(visual: PreparedStoryboardVisual, time: number): number {
    const firstScaleKeyframe = visual.uniformScaleKeyframes[0];
    if (!firstScaleKeyframe || time >= firstScaleKeyframe.time) {
        return 1;
    }

    if (!shouldBackfillEarlyEffectSetup(visual, firstScaleKeyframe.time)) {
        return 1;
    }

    return firstScaleKeyframe.value;
}

function shouldBackfillAdditiveRange(visual: PreparedStoryboardVisual, time: number): boolean {
    const firstRange = visual.additiveRange[0];
    if (!firstRange || time >= firstRange.startTime) {
        return false;
    }

    if (!shouldBackfillEarlyEffectSetup(visual, firstRange.startTime)) {
        return false;
    }

    return time >= visual.activeTime[0];
}

function shouldBackfillEarlyEffectSetup(visual: PreparedStoryboardVisual, setupTime: number): boolean {
    if (setupTime <= visual.activeTime[0] || setupTime - visual.activeTime[0] > EARLY_EFFECT_SETUP_GRACE_MS) {
        return false;
    }

    const firstAdditiveRange = visual.additiveRange[0];
    const firstScaleKeyframe = visual.uniformScaleKeyframes[0];

    if (!firstAdditiveRange || !firstScaleKeyframe) {
        return false;
    }

    if (firstAdditiveRange.startTime !== firstScaleKeyframe.time || firstScaleKeyframe.time !== setupTime) {
        return false;
    }

    const [firstOpacityKeyframe, secondOpacityKeyframe] = visual.opacityKeyframes;
    if (!firstOpacityKeyframe || !secondOpacityKeyframe) {
        return false;
    }

    return (
        firstOpacityKeyframe.time === visual.activeTime[0] &&
        firstOpacityKeyframe.value === 0 &&
        secondOpacityKeyframe.time === setupTime &&
        Number(secondOpacityKeyframe.value) > 0
    );
}

function shouldRenderForGameplayState(visual: PreparedStoryboardVisual, gameplayState: GameplayState): boolean {
    if (visual.layer === Layer.Pass) {
        return gameplayState === "passing";
    }

    if (visual.layer === Layer.Fail) {
        return gameplayState === "failing";
    }

    return true;
}

function cleanPath(p: string): string {
    return p.replace(/^"|"$/g, "").trim().toLowerCase().replace(/\\/g, "/");
}
