import { Sprite, Texture } from "pixi.js";

import type {
    PreparedStoryboardAnimation,
    PreparedStoryboardData,
    PreparedStoryboardVisual,
} from "../types/storyboard";
import { Layer, Origin } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { isTimeInRanges, keyframePairValueAt, keyframeValueAt, packRgb } from "./interpolation";
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
    const { sprite, visual, textures } = entry;

    if (!shouldRenderForGameplayState(visual, gameplayState)) {
        sprite.visible = false;
        return;
    }

    if (time < visual.activeTime[0] || time > visual.activeTime[1]) {
        sprite.visible = false;
        return;
    }

    const alpha = keyframeValueAt(visual.opacityKeyframes, time, 1);
    const uniformScale = keyframeValueAt(
        visual.uniformScaleKeyframes,
        time,
        resolveEarlyUniformScaleDefault(visual, time),
    );
    const [vectorScaleX, vectorScaleY] = keyframePairValueAt(visual.vectorScaleKeyframes, time, [1, 1]);

    const scaleX = uniformScale * vectorScaleX;
    const scaleY = uniformScale * vectorScaleY;

    if (alpha <= 0 || scaleX === 0 || scaleY === 0) {
        sprite.visible = false;
        return;
    }

    const [x, y] = keyframePairValueAt(visual.positionKeyframes, time, [visual.x, visual.y]);
    const rotation = keyframeValueAt(visual.rotationKeyframes, time, 0);
    const colour = keyframeValueAt(visual.colourKeyframes, time, [255, 255, 255]);
    const flipH = isTimeInRanges(visual.flipHRange, time);
    const flipV = isTimeInRanges(visual.flipVRange, time);
    const additive = isTimeInRanges(visual.additiveRange, time) || shouldBackfillAdditiveRange(visual, time);
    const adjustedAnchor = adjustAnchorForTransforms(visual.origin, [vectorScaleX, vectorScaleY], flipH, flipV);

    sprite.visible = true;
    sprite.anchor.set(adjustedAnchor[0], adjustedAnchor[1]);
    sprite.position.set(x, y);
    sprite.scale.set(scaleX * (flipH ? -1 : 1), scaleY * (flipV ? -1 : 1));
    sprite.rotation = rotation;
    sprite.alpha = clamp(alpha, 0, 1);
    sprite.tint = packRgb(colour);
    sprite.blendMode = additive ? "add" : "normal";

    if (visual.kind === "animation") {
        const texture = resolveAnimationFrame(visual, textures, time);
        if (texture) {
            sprite.texture = texture;
        }
    }
}

export function anchorFromOrigin(origin: Origin): [number, number] {
    switch (origin) {
        case Origin.TopLeft:
            return [0, 0];
        case Origin.TopCentre:
            return [0.5, 0];
        case Origin.TopRight:
            return [1, 0];
        case Origin.CentreLeft:
            return [0, 0.5];
        case Origin.Centre:
            return [0.5, 0.5];
        case Origin.CentreRight:
            return [1, 0.5];
        case Origin.BottomLeft:
            return [0, 1];
        case Origin.BottomCentre:
            return [0.5, 1];
        case Origin.BottomRight:
            return [1, 1];
        default:
            return [0.5, 0.5];
    }
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

function adjustAnchorForTransforms(
    origin: Origin,
    vectorScale: [number, number],
    flipH: boolean,
    flipV: boolean,
): [number, number] {
    const anchor = [...anchorFromOrigin(origin)] as [number, number];
    const hasNegativeScaleX = vectorScale[0] < 0;
    const hasNegativeScaleY = vectorScale[1] < 0;

    if (flipH !== hasNegativeScaleX) {
        anchor[0] = 1 - anchor[0];
    }

    if (flipV !== hasNegativeScaleY) {
        anchor[1] = 1 - anchor[1];
    }

    return anchor;
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
