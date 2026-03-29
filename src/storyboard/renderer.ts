import { Application, Container, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";

import type {
    PreparedStoryboardAnimation,
    PreparedStoryboardData,
    PreparedStoryboardVisual,
} from "../types/storyboard";
import { Layer, Origin } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { getMimeType, isVideoPath } from "../utils/path";
import { isTimeInRanges, keyframePairValueAt, keyframeValueAt, packRgb } from "./interpolation";
import type { ResolvedAssets } from "./assets";

const STORYBOARD_WIDTH = 640;
const STORYBOARD_HEIGHT = 480;
const DEFAULT_VIDEO_READY_TIMEOUT_MS = 15_000;

interface RenderVisual {
    visual: PreparedStoryboardVisual;
    sprite: Sprite;
    textures: Texture[];
}

export interface RenderSnapshot {
    duration: number;
    width: number;
    height: number;
}

export class StoryboardRenderer {
    private readonly app = new Application();
    private readonly stageRoot = new Container();
    private readonly frameBackground = new Sprite(Texture.WHITE);
    private readonly videoLayer = new Container();
    private readonly playfieldRoot = new Container();
    private readonly backgroundLayer = new Container();
    private readonly contentLayer = new Container();
    private readonly foregroundLayer = new Container();
    private readonly renderVisuals: RenderVisual[] = [];
    private readonly canvasHost: HTMLElement;

    private animationFrameHandle = 0;
    private currentTime = 0;
    private playing = false;
    private duration = 0;
    private frameWidth = STORYBOARD_WIDTH;
    private size = { width: 1280, height: 720 };
    private onTick?: (time: number) => void;
    private onPointerActivity?: () => void;
    private storyboard?: PreparedStoryboardData;
    private gameplayState: "passing" | "failing" = "passing";
    private backgroundSprite?: Sprite;
    private videoElement?: HTMLVideoElement;
    private videoSprite?: Sprite;
    private videoEndTime = 0;
    private lastFrameTimestamp = 0;

    constructor(canvasHost: HTMLElement) {
        this.canvasHost = canvasHost;
        this.stageRoot.sortableChildren = true;
        this.videoLayer.sortableChildren = true;
        this.playfieldRoot.sortableChildren = true;
        this.contentLayer.sortableChildren = true;
        this.frameBackground.zIndex = 0;
        this.videoLayer.zIndex = 1;
        this.playfieldRoot.zIndex = 2;
        this.backgroundLayer.zIndex = 0;
        this.contentLayer.zIndex = 1;
        this.foregroundLayer.zIndex = 2;
        this.frameBackground.tint = 0x000000;
        this.frameBackground.anchor.set(0, 0);
        this.playfieldRoot.addChild(this.backgroundLayer, this.contentLayer, this.foregroundLayer);
        this.stageRoot.addChild(this.frameBackground, this.videoLayer, this.playfieldRoot);
    }

    async init(): Promise<void> {
        await this.app.init({
            resizeTo: this.canvasHost,
            antialias: true,
            backgroundColor: 0x000000,
            eventMode: "static",
            preference: "webgl",
        });

        this.app.stage.addChild(this.stageRoot);
        this.canvasHost.replaceChildren(this.app.canvas);
        this.app.canvas.id = "storyboard";
        this.app.canvas.addEventListener("pointermove", this.handlePointerMove);
        this.app.canvas.addEventListener("pointerdown", this.handlePointerMove);
        this.resize();
        window.addEventListener("resize", this.resize);
    }

    setPointerActivityListener(listener: () => void): void {
        this.onPointerActivity = listener;
    }

    setTickListener(listener: (time: number) => void): void {
        this.onTick = listener;
    }

    async load(storyboard: PreparedStoryboardData, assets: ResolvedAssets): Promise<void> {
        this.stop();
        this.clearScene();
        this.storyboard = storyboard;
        this.duration = storyboard.duration;
        this.currentTime = 0;
        this.frameWidth = shouldUseWidescreenStoryboard(storyboard) ? (STORYBOARD_HEIGHT * 16) / 9 : STORYBOARD_WIDTH;
        this.playfieldRoot.position.set((this.frameWidth - STORYBOARD_WIDTH) / 2, 0);
        const suppressBeatmapBackgroundVisuals = hasIndependentStoryboardBackground(storyboard);

        if (storyboard.background && !suppressBeatmapBackgroundVisuals) {
            const texture = assets.textures.get(storyboard.background.path);
            if (texture) {
                this.backgroundSprite = new Sprite(texture);
                this.backgroundSprite.anchor.set(0.5);
                this.backgroundLayer.addChild(this.backgroundSprite);
            }
        }

        if (storyboard.video && isVideoPath(storyboard.video.path)) {
            const blob = assets.blobs.get(storyboard.video.path);
            if (blob) {
                const typedBlob = new Blob([blob], { type: getMimeType(storyboard.video.path) });
                const url = URL.createObjectURL(typedBlob);
                this.videoElement = document.createElement("video");
                this.videoElement.crossOrigin = "anonymous";
                this.videoElement.preload = "auto";
                this.videoElement.muted = true;
                this.videoElement.defaultMuted = true;
                this.videoElement.playsInline = true;
                this.videoElement.src = url;
                this.videoElement.load();
                await waitForVideoReady(this.videoElement).catch(() => undefined);

                if (this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0) {
                    this.videoEndTime = Number.isFinite(this.videoElement.duration)
                        ? storyboard.video.startTime + this.videoElement.duration * 1000
                        : 0;
                    this.videoSprite = new Sprite(Texture.from(this.videoElement));
                    this.videoSprite.anchor.set(0.5);
                    this.videoSprite.visible = false;
                    this.videoSprite.zIndex = 0;
                    this.videoLayer.addChild(this.videoSprite);
                }
            }
        }

        storyboard.visuals.forEach((visual, index) => {
            if (isRedundantBeatmapBackgroundVisual(visual, storyboard)) {
                return;
            }

            const textures = resolveVisualTextures(visual, assets);
            if (textures.length === 0) return;

            const sprite = new Sprite(textures[0]);
            const anchor = anchorFromOrigin(visual.origin);
            sprite.anchor.set(anchor[0], anchor[1]);
            sprite.visible = false;
            sprite.zIndex = visual.layer * 10_000 + index;
            this.contentLayer.addChild(sprite);

            this.renderVisuals.push({ visual, sprite, textures });
        });
        this.resize();
        this.renderFrame(0);
    }

    play(startTime = this.currentTime): void {
        this.currentTime = clamp(startTime, 0, this.duration);
        this.playing = true;
        this.lastFrameTimestamp = performance.now();
        this.scheduleNextFrame();
    }

    pause(): void {
        this.playing = false;
        if (this.animationFrameHandle) {
            cancelAnimationFrame(this.animationFrameHandle);
            this.animationFrameHandle = 0;
        }
        this.videoElement?.pause();
    }

    stop(): void {
        this.pause();
        this.seek(0);
    }

    seek(time: number): void {
        this.currentTime = clamp(time, 0, this.duration);
        if (this.videoElement && this.storyboard?.video) {
            const videoTime = Math.max(0, (this.currentTime - this.storyboard.video.startTime) / 1000);
            syncVideoTime(this.videoElement, videoTime);
        }
        this.renderFrame(this.currentTime);
    }

    getTime(): number {
        return this.currentTime;
    }

    getDuration(): number {
        return this.duration;
    }

    setDuration(duration: number): void {
        this.duration = Math.max(0, duration);
        if (this.currentTime > this.duration) {
            this.currentTime = this.duration;
        }
    }

    getSnapshot(): RenderSnapshot {
        return {
            duration: this.duration,
            width: this.size.width,
            height: this.size.height,
        };
    }

    async toggleFullscreen(): Promise<void> {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
        }

        await this.canvasHost.requestFullscreen();
    }

    destroy(): void {
        this.pause();
        window.removeEventListener("resize", this.resize);
        this.app.canvas.removeEventListener("pointermove", this.handlePointerMove);
        this.app.canvas.removeEventListener("pointerdown", this.handlePointerMove);
        this.clearScene();
        this.app.destroy(undefined, { children: true, texture: false, textureSource: false });
    }

    private readonly resize = (): void => {
        const width = this.canvasHost.clientWidth || window.innerWidth;
        const height = this.canvasHost.clientHeight || window.innerHeight;
        this.size = { width, height };

        const scale = Math.min(width / this.frameWidth, height / STORYBOARD_HEIGHT);
        const contentWidth = this.frameWidth * scale;
        const contentHeight = STORYBOARD_HEIGHT * scale;
        const offsetX = (width - contentWidth) / 2;
        const offsetY = (height - contentHeight) / 2;

        this.stageRoot.position.set(offsetX, offsetY);
        this.stageRoot.scale.set(scale);
        this.frameBackground.width = this.frameWidth;
        this.frameBackground.height = STORYBOARD_HEIGHT;
        this.playfieldRoot.position.set((this.frameWidth - STORYBOARD_WIDTH) / 2, 0);

        if (this.backgroundSprite) {
            const [x, y] = resolveMediaPosition(this.storyboard?.background, STORYBOARD_WIDTH);
            this.backgroundSprite.position.set(x, y);
            const bgScale = fitHeightScale(getTextureHeight(this.backgroundSprite.texture), STORYBOARD_HEIGHT);
            this.backgroundSprite.scale.set(bgScale);
        }

        if (this.videoSprite && this.videoElement) {
            const [x, y] = resolveVideoPosition(this.storyboard?.video, this.frameWidth);
            this.videoSprite.position.set(x, y);
            const videoScale = coverScaleForSource(
                this.videoElement.videoWidth,
                this.videoElement.videoHeight,
                this.frameWidth,
                STORYBOARD_HEIGHT,
            );
            this.videoSprite.scale.set(videoScale);
        }

        this.app.renderer.resize(width, height);
    };

    private readonly handlePointerMove = (_event: FederatedPointerEvent | PointerEvent): void => {
        this.onPointerActivity?.();
    };

    private scheduleNextFrame(): void {
        this.animationFrameHandle = requestAnimationFrame((timestamp) => {
            if (!this.playing) {
                return;
            }

            const delta = timestamp - this.lastFrameTimestamp;
            this.lastFrameTimestamp = timestamp;
            this.currentTime = Math.min(this.duration, this.currentTime + delta);
            this.renderFrame(this.currentTime);

            if (this.currentTime >= this.duration) {
                this.pause();
                this.seek(0);
                return;
            }

            this.scheduleNextFrame();
        });
    }

    private renderFrame(time: number): void {
        this.currentTime = time;
        let isVideoVisible = false;

        if (this.storyboard?.video && this.videoElement && this.videoSprite) {
            const visible =
                time >= this.storyboard.video.startTime && (this.videoEndTime <= 0 || time <= this.videoEndTime);
            isVideoVisible = visible;
            this.videoSprite.visible = visible;
            if (visible) {
                const desiredVideoTime = Math.max(0, (time - this.storyboard.video.startTime) / 1000);
                syncVideoTime(this.videoElement, desiredVideoTime);
                if (this.playing) {
                    if (this.videoElement.paused) {
                        void this.videoElement.play().catch(() => undefined);
                    }
                } else {
                    this.videoElement.pause();
                }
            } else {
                this.videoElement.pause();
            }
        }

        if (this.backgroundSprite) {
            this.backgroundSprite.visible = !isVideoVisible;
        }

        for (const entry of this.renderVisuals) {
            renderVisualAtTime(entry, time, this.gameplayState);
        }

        this.onTick?.(time);
        this.app.renderer.render(this.app.stage);
    }

    private clearScene(): void {
        this.renderVisuals.splice(0, this.renderVisuals.length);
        this.videoLayer.removeChildren();
        this.backgroundLayer.removeChildren();
        this.contentLayer.removeChildren();
        this.foregroundLayer.removeChildren();
        this.backgroundSprite?.destroy();
        this.backgroundSprite = undefined;
        this.videoSprite?.destroy();
        this.videoSprite = undefined;
        this.videoEndTime = 0;

        if (this.videoElement?.src) {
            URL.revokeObjectURL(this.videoElement.src);
        }
        this.videoElement?.pause();
        this.videoElement?.removeAttribute("src");
        this.videoElement?.load();
        this.videoElement = undefined;
    }
}

function resolveVisualTextures(visual: PreparedStoryboardVisual, assets: ResolvedAssets): Texture[] {
    if (visual.kind === "animation") {
        return visual.framePaths
            .map((path) => assets.textures.get(cleanPath(path)) || assets.textures.get(path))
            .filter((texture): texture is Texture => Boolean(texture));
    }

    const cleanedPath = cleanPath(visual.filePath);
    const texture = assets.textures.get(cleanedPath) || assets.textures.get(visual.filePath);
    return texture ? [texture] : [];
}

function renderVisualAtTime(entry: RenderVisual, time: number, gameplayState: "passing" | "failing"): void {
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
    const uniformScale = keyframeValueAt(visual.uniformScaleKeyframes, time, 1);
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
    const additive = isTimeInRanges(visual.additiveRange, time);
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

function anchorFromOrigin(origin: Origin): [number, number] {
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

function shouldUseWidescreenStoryboard(storyboard: PreparedStoryboardData): boolean {
    return storyboard.widescreenStoryboard || (storyboard.visuals.length === 0 && Boolean(storyboard.video));
}

function shouldRenderForGameplayState(visual: PreparedStoryboardVisual, gameplayState: "passing" | "failing"): boolean {
    if (visual.layer === Layer.Pass) {
        return gameplayState === "passing";
    }

    if (visual.layer === Layer.Fail) {
        return gameplayState === "failing";
    }

    return true;
}

function resolveMediaPosition(
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

function resolveVideoPosition(
    media: Pick<PreparedStoryboardData, "video">["video"],
    frameWidth: number,
): [number, number] {
    if (!media || (media.x === 0 && media.y === 0)) {
        return [frameWidth / 2, STORYBOARD_HEIGHT / 2];
    }

    return [media.x + (frameWidth - STORYBOARD_WIDTH) / 2, media.y];
}

function fitHeightScale(sourceHeight: number, targetHeight: number): number {
    if (sourceHeight <= 0) {
        return 1;
    }

    return targetHeight / sourceHeight;
}

function coverScaleForSource(
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

function getTextureHeight(texture: Texture): number {
    if (texture.height > 1) return texture.height;
    if (texture.source && texture.source.height > 1) return texture.source.height;
    if (texture.orig && texture.orig.height > 1) return texture.orig.height;
    return 1080;
}

function cleanPath(p: string): string {
    return p.replace(/^"|"$/g, "").trim().toLowerCase().replace(/\\/g, "/");
}

function hasIndependentStoryboardBackground(storyboard: PreparedStoryboardData): boolean {
    return storyboard.visuals.some((visual) => {
        if (visual.layer !== Layer.Background) {
            return false;
        }

        return !isRedundantBeatmapBackgroundVisual(visual, storyboard);
    });
}

function isRedundantBeatmapBackgroundVisual(
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

function syncVideoTime(videoElement: HTMLVideoElement, desiredVideoTime: number): void {
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

function waitForVideoReady(videoElement: HTMLVideoElement, timeoutMs = DEFAULT_VIDEO_READY_TIMEOUT_MS): Promise<void> {
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
