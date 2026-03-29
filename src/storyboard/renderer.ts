import { Application, Container, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import type { PreparedStoryboardData } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { getMimeType, isVideoPath } from "../utils/path";
import type { ResolvedAssets } from "./assets";
import {
    colorForVisualLayer,
    createLayoutBorder,
    destroyLayoutBorder,
    syncLayoutBorder,
    type LayoutBorder,
} from "./layoutBorders";
import {
    anchorFromOrigin,
    coverScaleForSource,
    findFirstVisualEndingAtOrAfter,
    findFirstVisualStartingAfter,
    fitHeightScale,
    getTextureHeight,
    hasIndependentStoryboardBackground,
    isRedundantBeatmapBackgroundVisual,
    isVisualDynamic,
    renderVisualAtTime,
    resolveMediaPosition,
    resolveVideoPosition,
    resolveVisualTextures,
    shouldUseWidescreenStoryboard,
    STORYBOARD_HEIGHT,
    STORYBOARD_WIDTH,
    syncVideoTime,
    waitForVideoReady,
} from "./helpers";
import type { GameplayState, RenderVisual } from "./helpers";
import { resolveGpuInfo, StatsOverlay, STATS_PANEL_MARGIN } from "./statsOverlay";
import type { RendererStats } from "./statsOverlay";

const FPS_UPDATE_INTERVAL_MS = 300;

export interface RenderSnapshot {
    duration: number;
    width: number;
    height: number;
}

export class StoryboardRenderer {
    private readonly app = new Application();
    private readonly stageRoot = new Container();
    private readonly statsOverlay = new StatsOverlay();
    private readonly frameBackground = new Sprite(Texture.WHITE);
    private readonly videoLayer = new Container();
    private readonly playfieldRoot = new Container();
    private readonly backgroundLayer = new Container();
    private readonly contentLayer = new Container();
    private readonly foregroundLayer = new Container();
    private readonly renderVisuals: RenderVisual[] = [];
    private readonly activeDynamicVisuals: RenderVisual[] = [];
    private readonly activationStartVisuals: RenderVisual[] = [];
    private readonly activationEndVisuals: RenderVisual[] = [];
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
    private gameplayState: GameplayState = "passing";
    private backgroundSprite?: Sprite;
    private backgroundBorder?: LayoutBorder;
    private videoElement?: HTMLVideoElement;
    private videoSprite?: Sprite;
    private videoBorder?: LayoutBorder;
    private videoEndTime = 0;
    private lastFrameTimestamp = 0;
    private currentFps = 0;
    private fpsSampleElapsed = 0;
    private fpsSampleFrames = 0;
    private visibleElementCount = 0;
    private gpuInfo = "Unknown";
    private initialized = false;
    private layoutBordersVisible = false;
    private statsVisible = false;
    private activationStartCursor = 0;
    private activationEndCursor = 0;

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
            preference: "webgpu",
        });

        this.app.stage.addChild(this.stageRoot);
        this.app.stage.addChild(this.statsOverlay.container);
        this.canvasHost.replaceChildren(this.app.canvas);
        this.app.canvas.id = "storyboard";
        this.app.canvas.addEventListener("pointermove", this.handlePointerMove);
        this.app.canvas.addEventListener("pointerdown", this.handlePointerMove);
        this.gpuInfo = await resolveGpuInfo(this.app.canvas);
        this.initialized = true;
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
                this.backgroundBorder = createLayoutBorder(
                    this.backgroundLayer,
                    0x4dabf7,
                    1,
                    storyboard.background.path,
                );
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
                    this.videoBorder = createLayoutBorder(this.videoLayer, 0xff922b, 1, storyboard.video.path);
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

            const border = createLayoutBorder(
                this.contentLayer,
                colorForVisualLayer(visual.layer),
                sprite.zIndex + 0.5,
                visual.filePath,
            );

            this.renderVisuals.push({
                visual,
                sprite,
                textures,
                border,
                isDynamic: isVisualDynamic(visual, textures),
                active: false,
                dynamicListIndex: -1,
            });
        });

        this.rebuildActivationIndex();
        this.resize();
        this.renderFrame(0, true);
    }

    setLayoutBordersVisible(visible: boolean): void {
        this.layoutBordersVisible = visible;
        if (visible) {
            this.updateLayoutBorders();
        } else {
            this.hideLayoutBorders();
        }
        this.app.renderer.render(this.app.stage);
    }

    areLayoutBordersVisible(): boolean {
        return this.layoutBordersVisible;
    }

    setStatsBuildInfo(hash: string, branch: string): void {
        this.statsOverlay.setBuildInfo(hash, branch);
        this.updateStatsOverlay();
        this.renderNow();
    }

    setStatsVisible(visible: boolean): void {
        this.statsVisible = visible;
        this.statsOverlay.setVisible(visible);
        this.updateStatsOverlay();
        this.renderNow();
    }

    areStatsVisible(): boolean {
        return this.statsVisible;
    }

    play(startTime = this.currentTime): void {
        this.currentTime = clamp(startTime, 0, this.duration);
        this.playing = true;
        this.currentFps = 0;
        this.fpsSampleElapsed = 0;
        this.fpsSampleFrames = 0;
        this.lastFrameTimestamp = performance.now();
        this.scheduleNextFrame();
    }

    pause(): void {
        this.playing = false;
        this.currentFps = 0;
        this.fpsSampleElapsed = 0;
        this.fpsSampleFrames = 0;
        if (this.animationFrameHandle) {
            cancelAnimationFrame(this.animationFrameHandle);
            this.animationFrameHandle = 0;
        }
        this.videoElement?.pause();
        this.updateStatsOverlay();
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
        this.renderFrame(this.currentTime, true);
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
        this.statsOverlay.setPosition(STATS_PANEL_MARGIN, STATS_PANEL_MARGIN);

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

        if (this.layoutBordersVisible) {
            this.updateLayoutBorders();
        }
        this.updateStatsOverlay();

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
            this.fpsSampleElapsed += delta;
            this.fpsSampleFrames += 1;
            if (this.fpsSampleElapsed >= FPS_UPDATE_INTERVAL_MS) {
                this.currentFps = (this.fpsSampleFrames * 1000) / this.fpsSampleElapsed;
                this.fpsSampleElapsed = 0;
                this.fpsSampleFrames = 0;
            }
            const previousTime = this.currentTime;
            this.currentTime = Math.min(this.duration, this.currentTime + delta);
            this.renderFrame(this.currentTime, false, previousTime);

            if (this.currentTime >= this.duration) {
                this.pause();
                this.seek(0);
                return;
            }

            this.scheduleNextFrame();
        });
    }

    private renderFrame(time: number, forceFullUpdate = false, previousTime = time): void {
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

        if (forceFullUpdate || time < previousTime) {
            this.rebuildActiveVisualState(time);
        } else {
            this.advanceActiveVisualState(time);
        }

        if (this.layoutBordersVisible) {
            this.updateLayoutBorders();
        }
        this.updateStatsOverlay();

        this.onTick?.(time);
        this.app.renderer.render(this.app.stage);
    }

    private clearScene(): void {
        for (const entry of this.renderVisuals) {
            destroyLayoutBorder(entry.border);
            entry.sprite.destroy();
        }

        this.renderVisuals.splice(0, this.renderVisuals.length);
        this.activeDynamicVisuals.splice(0, this.activeDynamicVisuals.length);
        this.activationStartVisuals.splice(0, this.activationStartVisuals.length);
        this.activationEndVisuals.splice(0, this.activationEndVisuals.length);
        this.activationStartCursor = 0;
        this.activationEndCursor = 0;
        this.visibleElementCount = 0;
        this.videoLayer.removeChildren();
        this.backgroundLayer.removeChildren();
        this.contentLayer.removeChildren();
        this.foregroundLayer.removeChildren();
        destroyLayoutBorder(this.backgroundBorder);
        this.backgroundSprite?.destroy();
        this.backgroundSprite = undefined;
        this.backgroundBorder = undefined;
        destroyLayoutBorder(this.videoBorder);
        this.videoSprite?.destroy();
        this.videoSprite = undefined;
        this.videoBorder = undefined;
        this.videoEndTime = 0;

        if (this.videoElement?.src) {
            URL.revokeObjectURL(this.videoElement.src);
        }
        this.videoElement?.pause();
        this.videoElement?.removeAttribute("src");
        this.videoElement?.load();
        this.videoElement = undefined;
        this.updateStatsOverlay();
    }

    private updateLayoutBorders(): void {
        syncLayoutBorder(this.backgroundBorder, this.backgroundSprite, this.layoutBordersVisible);
        syncLayoutBorder(this.videoBorder, this.videoSprite, this.layoutBordersVisible);

        for (const entry of this.renderVisuals) {
            syncLayoutBorder(entry.border, entry.sprite, this.layoutBordersVisible);
        }
    }

    private hideLayoutBorders(): void {
        syncLayoutBorder(this.backgroundBorder, this.backgroundSprite, false);
        syncLayoutBorder(this.videoBorder, this.videoSprite, false);

        for (const entry of this.renderVisuals) {
            syncLayoutBorder(entry.border, entry.sprite, false);
        }
    }

    private updateStatsOverlay(): void {
        if (!this.statsVisible) {
            return;
        }

        const stats = this.collectStats();
        this.statsOverlay.update(stats);
    }

    private renderNow(): void {
        this.statsOverlay.renderNow(this.app.renderer, this.app.stage, this.initialized);
    }

    private collectStats(): RendererStats {
        const visibleElements = this.visibleElementCount;
        const visibleSprites =
            visibleElements +
            Number(Boolean(this.backgroundSprite?.visible)) +
            Number(Boolean(this.videoSprite?.visible));
        const totalSprites =
            this.renderVisuals.length + Number(Boolean(this.backgroundSprite)) + Number(Boolean(this.videoSprite));

        return {
            fps: this.playing ? this.currentFps : 0,
            gpu: this.gpuInfo,
            visibleElements,
            visibleSprites,
            totalSprites,
            renderWidth: this.size.width,
            renderHeight: this.size.height,
        };
    }

    private rebuildActivationIndex(): void {
        this.activationStartVisuals.splice(0, this.activationStartVisuals.length, ...this.renderVisuals);
        this.activationEndVisuals.splice(0, this.activationEndVisuals.length, ...this.renderVisuals);
        this.activationStartVisuals.sort((left, right) => left.visual.activeTime[0] - right.visual.activeTime[0]);
        this.activationEndVisuals.sort((left, right) => left.visual.activeTime[1] - right.visual.activeTime[1]);
        this.activationStartCursor = 0;
        this.activationEndCursor = 0;
    }

    private rebuildActiveVisualState(time: number): void {
        this.visibleElementCount = 0;
        this.activeDynamicVisuals.length = 0;

        for (const entry of this.renderVisuals) {
            entry.active = false;
            entry.dynamicListIndex = -1;
            entry.sprite.visible = false;

            if (time < entry.visual.activeTime[0] || time > entry.visual.activeTime[1]) {
                continue;
            }

            this.activateVisual(entry);
            this.applyVisualStateAtTime(entry, time);
        }

        this.activationStartCursor = findFirstVisualStartingAfter(this.activationStartVisuals, time);
        this.activationEndCursor = findFirstVisualEndingAtOrAfter(this.activationEndVisuals, time);
    }

    private advanceActiveVisualState(time: number): void {
        while (
            this.activationStartCursor < this.activationStartVisuals.length &&
            this.activationStartVisuals[this.activationStartCursor].visual.activeTime[0] <= time
        ) {
            const entry = this.activationStartVisuals[this.activationStartCursor];
            this.activationStartCursor += 1;

            if (entry.visual.activeTime[1] < time || entry.active) {
                continue;
            }

            this.activateVisual(entry);
            if (!entry.isDynamic) {
                this.applyVisualStateAtTime(entry, time);
            }
        }

        while (
            this.activationEndCursor < this.activationEndVisuals.length &&
            this.activationEndVisuals[this.activationEndCursor].visual.activeTime[1] < time
        ) {
            this.deactivateVisual(this.activationEndVisuals[this.activationEndCursor]);
            this.activationEndCursor += 1;
        }

        for (const entry of this.activeDynamicVisuals) {
            this.applyVisualStateAtTime(entry, time);
        }
    }

    private activateVisual(entry: RenderVisual): void {
        entry.active = true;
        if (!entry.isDynamic) {
            return;
        }

        entry.dynamicListIndex = this.activeDynamicVisuals.length;
        this.activeDynamicVisuals.push(entry);
    }

    private deactivateVisual(entry: RenderVisual): void {
        if (!entry.active) {
            return;
        }

        if (entry.sprite.visible) {
            this.visibleElementCount -= 1;
        }

        entry.sprite.visible = false;
        entry.active = false;

        if (entry.dynamicListIndex >= 0) {
            const removedIndex = entry.dynamicListIndex;
            const lastEntry = this.activeDynamicVisuals.pop();
            entry.dynamicListIndex = -1;

            if (lastEntry && lastEntry !== entry) {
                this.activeDynamicVisuals[removedIndex] = lastEntry;
                lastEntry.dynamicListIndex = removedIndex;
            }
        }
    }

    private applyVisualStateAtTime(entry: RenderVisual, time: number): void {
        const wasVisible = entry.sprite.visible;
        renderVisualAtTime(entry, time, this.gameplayState);
        this.visibleElementCount += Number(entry.sprite.visible) - Number(wasVisible);
    }
}
