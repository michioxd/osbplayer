import "./main.scss";
import { AudioController } from "./audio/AudioController";
import { SampleScheduler } from "./audio/SampleScheduler";
import { isRenderResolutionPreference, type RenderResolutionPreference } from "./storyboard/renderResolution";
import { StoryboardRenderer, type RendererBackendPreference } from "./storyboard/renderer";
import { disposeResolvedAssets, loadStoryboardAssets, type ResolvedAssets } from "./storyboard/assets";
import { parseStoryboard } from "./storyboard/parser";
import { prepareStoryboard } from "./storyboard/preparer";
import { loadOszArchive, type OszArchiveData } from "./utils/archive";
import { PlayerUI } from "./ui";
import type { PreparedStoryboardData } from "./types/storyboard";
import { qs } from "./utils/dom";
import { logger } from "./utils/logger";

const CONTROLS_IDLE_TIMEOUT = 2_000;
const KEYBOARD_SEEK_STEP = 1_000;
const STORAGE_KEY_LAYOUT_BORDERS = "osbplayer:layout-borders";
const STORAGE_KEY_LAYOUT_BORDER_LABELS = "osbplayer:layout-border-labels";
const STORAGE_KEY_STATS = "osbplayer:stats";
const STORAGE_KEY_FIXED_CONTROLS = "osbplayer:fixed-controls";
const STORAGE_KEY_RENDERER_BACKEND = "osbplayer:renderer-backend";
const STORAGE_KEY_RENDER_RESOLUTION = "osbplayer:render-resolution";
export const GIT_HASH = import.meta.env.VITE_GIT_COMMIT;
export const GIT_BRANCH = import.meta.env.VITE_GIT_CURRENT_BRANCH;
const RENDERER_BACKEND_ORDER: RendererBackendPreference[] = ["webgpu", "webgl", "canvas"];

export class App {
    private readonly fileInput = document.createElement("input");
    private readonly ui: PlayerUI;
    private readonly renderer: StoryboardRenderer;
    private readonly audio = new AudioController();
    private rendererPreference: RendererBackendPreference;
    private renderResolutionPreference: RenderResolutionPreference;

    private archive?: OszArchiveData;
    private currentStoryboard?: PreparedStoryboardData;
    private resolvedAssets?: ResolvedAssets;
    private sampleScheduler?: SampleScheduler;
    private controlsTimer?: number;
    private fixedControls = false;
    private playing = false;

    constructor() {
        this.rendererPreference = this.getStoredRendererBackend();
        this.renderResolutionPreference = this.getStoredRenderResolution();
        this.fileInput.type = "file";
        this.fileInput.accept = ".osz";
        this.fileInput.addEventListener("change", () => {
            const file = this.fileInput.files?.[0];
            if (file) {
                void this.handleOszSelected(file);
            }
        });

        this.ui = new PlayerUI({
            onOpenFile: () => this.fileInput.click(),
            onTogglePlay: () => this.togglePlayback(),
            onToggleMenu: () => this.handleMenuVisibility(),
            onToggleFixedControls: () => this.toggleFixedControls(),
            onToggleLayoutBorders: () => this.toggleLayoutBorders(),
            onToggleLayoutBorderLabels: () => this.toggleLayoutBorderLabels(),
            onCycleRendererBackend: () => void this.cycleRendererBackend(),
            onSelectRenderResolution: (resolution) => this.setRenderResolution(resolution),
            onToggleStats: () => this.toggleStats(),
            onToggleFullscreen: () => void this.renderer.toggleFullscreen(),
            onStop: () => this.stop(),
            onSelectDifficulty: (difficultyId) => void this.loadDifficultyById(difficultyId),
            onSeek: (ratio) => this.seek(ratio),
            onPointerActivity: () => this.handlePointerActivity(),
        });

        this.renderer = new StoryboardRenderer(
            qs<HTMLElement>("#storyboard-host"),
            this.rendererPreference,
            this.renderResolutionPreference,
        );
        this.renderer.setPointerActivityListener(() => this.handlePointerActivity());
        this.renderer.setTickListener((time) => this.handleRenderTick(time));
        this.renderer.setStatsBuildInfo(GIT_HASH, GIT_BRANCH);
        this.audio.onEnded(() => this.stop());
        window.addEventListener("keydown", this.handleKeydown);

        this.ui.setStatus("Initializing assets, please wait...");
        this.ui.setControlsVisible(true);
        this.ui.hideDialog();
        this.ui.setPlaybackState(false);
        this.ui.setFixedControlsState(false);
        this.ui.setLayoutBordersState(false);
        this.ui.setLayoutBorderLabelsState(true);
        this.ui.setRendererBackendState(this.rendererPreference);
        this.ui.setRenderResolutionState(this.renderResolutionPreference);
        this.ui.setStatsState(false);
    }

    async init(): Promise<void> {
        await this.renderer.init();
        this.restoreTogglePreferences();
        this.ui.setStatus("Idle, please load an osu! beatmap contain a storyboard.");
        this.ui.hideDialog();
        this.handlePointerActivity();
    }

    destroy(): void {
        this.stop();
        this.sampleScheduler?.destroy();
        this.audio.destroy();
        if (this.resolvedAssets) {
            disposeResolvedAssets(this.resolvedAssets);
        }
        this.renderer.destroy();
        if (this.controlsTimer) {
            window.clearTimeout(this.controlsTimer);
        }
        window.removeEventListener("keydown", this.handleKeydown);
    }

    private async handleOszSelected(file: File): Promise<void> {
        try {
            this.stop();
            this.ui.showLoadingDialog();
            this.ui.setLoadingState(true);
            this.ui.updateLoading({
                loaded: 0,
                total: 1,
                percent: 0,
                currentFile: `Reading archive: ${file.name}`,
            });
            this.ui.setStatus(`Reading archive: ${file.name}`);
            this.archive = await loadOszArchive(file);
            this.ui.renderDifficulties(this.archive.difficulties);
            this.ui.setLoadingState(false);

            if (this.archive.difficulties.length === 1) {
                this.ui.setStatus("Only one difficulty found, loading automatically...");
                await this.loadDifficultyById(this.archive.difficulties[0].id);
                return;
            }

            this.ui.showDifficultyDialog();
            this.ui.setStatus("Select a difficulty to start playback.");
            logger.info(`Loaded archive ${file.name} with ${this.archive.difficulties.length} difficulties.`);
        } catch (error) {
            logger.error("Failed to read .osz archive", error);
            this.ui.setLoadingState(false);
            this.ui.hideDialog();
            this.ui.setStatus("Failed to read .osz archive.");
        }
    }

    private async loadDifficultyById(difficultyId: string): Promise<void> {
        if (!this.archive) {
            return;
        }

        const difficulty = this.archive.difficulties.find((entry) => entry.id === difficultyId);
        if (!difficulty) {
            return;
        }

        this.ui.setSelectedDifficulty(difficulty.id);
        this.ui.showLoadingDialog();
        this.ui.setLoadingState(true);
        this.ui.setStatus(`Loading storyboard: ${difficulty.artist} - ${difficulty.title} (${difficulty.name})`);

        try {
            this.stop();
            this.sampleScheduler?.destroy();
            if (this.resolvedAssets) {
                disposeResolvedAssets(this.resolvedAssets);
                this.resolvedAssets = undefined;
            }

            const rawStoryboard = parseStoryboard(difficulty.fileData, this.archive.osbText);
            const storyboard = prepareStoryboard(rawStoryboard);
            const assets = await loadStoryboardAssets(storyboard, this.archive.assets, (progress) => {
                this.ui.updateLoading(progress);
                this.ui.setStatus(`Loading assets... ${progress.percent}%`);
            });

            this.currentStoryboard = storyboard;
            this.resolvedAssets = assets;
            this.ui.updateLoading({
                loaded: 1,
                total: 3,
                percent: 34,
                currentFile: "Preparing audio...",
            });
            this.ui.setStatus("Preparing audio...");
            this.sampleScheduler = new SampleScheduler(storyboard, assets.blobs);
            this.sampleScheduler.reset(0);

            const audioBlob = assets.blobs.get(storyboard.audioFilename);
            if (audioBlob) {
                await this.audio.load(audioBlob, storyboard.audioFilename);
            }

            this.ui.updateLoading({
                loaded: 2,
                total: 3,
                percent: 67,
                currentFile: "Preparing renderer...",
            });
            this.ui.setStatus("Preparing renderer...");
            await this.renderer.load(storyboard, assets);
            this.ui.updateLoading({
                loaded: 3,
                total: 3,
                percent: 100,
                currentFile: "Finishing...",
            });
            this.renderer.setDuration(this.getDuration());
            this.ui.setLoadingState(false);
            this.ui.hideDialog();
            this.ui.setStatus(`${storyboard.mapArtist} - ${storyboard.mapTitle} (${storyboard.diffName})`);
            this.ui.setDuration(0, this.getDuration());
            logger.info(`Storyboard loaded: ${storyboard.mapArtist} - ${storyboard.mapTitle} (${storyboard.diffName})`);
            this.play();
        } catch (error) {
            logger.error("Failed to load storyboard difficulty", error);
            this.ui.setLoadingState(false);
            this.ui.showDifficultyDialog();
            this.ui.setStatus("Failed to load storyboard difficulty.");
        }
    }

    private handleRenderTick(time: number): void {
        const currentTime = this.getPlaybackTime(time);
        const totalDuration = this.getDuration();
        this.ui.setDuration(currentTime, totalDuration);
        this.sampleScheduler?.update(currentTime, this.playing);

        if (!this.playing) {
            return;
        }

        const audioTime = this.audio.getCurrentTime();
        if (audioTime > 0 && Math.abs(audioTime - time) > 60) {
            this.renderer.seek(audioTime);
            this.sampleScheduler?.reset(audioTime);
        }
    }

    private play(): void {
        if (!this.currentStoryboard) {
            return;
        }

        this.playing = true;
        const startTime = this.getPlaybackTime();
        this.renderer.play(startTime);
        if (this.audio.getDuration() > 0) {
            this.audio.seek(startTime);
            void this.audio.play().catch((error) => logger.warn("Unable to start audio", error));
        }
        this.sampleScheduler?.reset(startTime);
        this.ui.setPlaybackState(true);
        this.handlePointerActivity();
    }

    private pause(): void {
        this.playing = false;
        this.renderer.pause();
        this.audio.pause();
        this.ui.setPlaybackState(false);
    }

    private stop(): void {
        this.pause();
        this.renderer.stop();
        this.audio.seek(0);
        this.sampleScheduler?.reset(0);
        this.ui.setDuration(0, this.getDuration());
    }

    private togglePlayback(): void {
        if (this.playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    private toggleLayoutBorders(): void {
        const nextVisible = !this.renderer.areLayoutBordersVisible();
        this.renderer.setLayoutBordersVisible(nextVisible);
        this.ui.setLayoutBordersState(nextVisible);
        this.setStoredBoolean(STORAGE_KEY_LAYOUT_BORDERS, nextVisible);
        this.handlePointerActivity();
    }

    private toggleLayoutBorderLabels(): void {
        const nextVisible = !this.renderer.areLayoutBorderLabelsVisible();
        this.renderer.setLayoutBorderLabelsVisible(nextVisible);
        this.ui.setLayoutBorderLabelsState(nextVisible);
        this.setStoredBoolean(STORAGE_KEY_LAYOUT_BORDER_LABELS, nextVisible);
        this.handlePointerActivity();
    }

    private toggleStats(): void {
        const nextVisible = !this.renderer.areStatsVisible();
        this.renderer.setStatsVisible(nextVisible);
        this.ui.setStatsState(nextVisible);
        this.setStoredBoolean(STORAGE_KEY_STATS, nextVisible);
        this.handlePointerActivity();
    }

    private restoreTogglePreferences(): void {
        const fixedControls = this.getStoredBoolean(STORAGE_KEY_FIXED_CONTROLS, false);
        const layoutBordersVisible = this.getStoredBoolean(STORAGE_KEY_LAYOUT_BORDERS, false);
        const layoutBorderLabelsVisible = this.getStoredBoolean(STORAGE_KEY_LAYOUT_BORDER_LABELS, true);
        const statsVisible = this.getStoredBoolean(STORAGE_KEY_STATS, false);
        const renderResolution = this.getStoredRenderResolution();

        this.setFixedControls(fixedControls);
        this.renderer.setLayoutBordersVisible(layoutBordersVisible);
        this.ui.setLayoutBordersState(layoutBordersVisible);
        this.renderer.setLayoutBorderLabelsVisible(layoutBorderLabelsVisible);
        this.ui.setLayoutBorderLabelsState(layoutBorderLabelsVisible);
        this.renderResolutionPreference = renderResolution;
        this.renderer.setRenderResolution(renderResolution);
        this.ui.setRenderResolutionState(renderResolution);
        this.renderer.setStatsVisible(statsVisible);
        this.ui.setStatsState(statsVisible);
    }

    private getStoredBoolean(key: string, fallback: boolean): boolean {
        try {
            const value = window.localStorage.getItem(key);
            if (value === null) {
                return fallback;
            }

            return value === "true";
        } catch {
            return fallback;
        }
    }

    private setStoredBoolean(key: string, value: boolean): void {
        try {
            window.localStorage.setItem(key, String(value));
        } catch {
            logger.warn(`Unable to persist preference: ${key}`);
        }
    }

    private getStoredRendererBackend(): RendererBackendPreference {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY_RENDERER_BACKEND);
            if (value === "webgpu" || value === "webgl" || value === "canvas") {
                return value;
            }
        } catch {
            logger.warn(`Unable to read preference: ${STORAGE_KEY_RENDERER_BACKEND}`);
        }

        return "webgpu";
    }

    private setStoredRendererBackend(value: RendererBackendPreference): void {
        try {
            window.localStorage.setItem(STORAGE_KEY_RENDERER_BACKEND, value);
        } catch {
            logger.warn(`Unable to persist preference: ${STORAGE_KEY_RENDERER_BACKEND}`);
        }
    }

    private getStoredRenderResolution(): RenderResolutionPreference {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY_RENDER_RESOLUTION);
            if (value && isRenderResolutionPreference(value)) {
                return value;
            }
        } catch {
            logger.warn(`Unable to read preference: ${STORAGE_KEY_RENDER_RESOLUTION}`);
        }

        return "auto";
    }

    private setStoredRenderResolution(value: RenderResolutionPreference): void {
        try {
            window.localStorage.setItem(STORAGE_KEY_RENDER_RESOLUTION, value);
        } catch {
            logger.warn(`Unable to persist preference: ${STORAGE_KEY_RENDER_RESOLUTION}`);
        }
    }

    private async cycleRendererBackend(): Promise<void> {
        const currentIndex = RENDERER_BACKEND_ORDER.indexOf(this.rendererPreference);
        const nextBackend = RENDERER_BACKEND_ORDER[(currentIndex + 1) % RENDERER_BACKEND_ORDER.length];

        try {
            const currentTime = this.getPlaybackTime();
            const shouldResume = this.playing;

            this.pause();
            this.rendererPreference = nextBackend;
            this.ui.setRendererBackendState(nextBackend);
            await this.renderer.reinitialize(nextBackend);
            this.renderer.setRenderResolution(this.renderResolutionPreference);
            this.renderer.setStatsBuildInfo(GIT_HASH, GIT_BRANCH);
            this.setStoredRendererBackend(nextBackend);

            if (this.currentStoryboard && this.resolvedAssets) {
                await this.renderer.load(this.currentStoryboard, this.resolvedAssets);
                this.renderer.setDuration(this.getDuration());
                this.renderer.seek(currentTime);
                this.ui.setDuration(currentTime, this.getDuration());

                if (shouldResume) {
                    this.play();
                }
            } else {
                this.renderer.refreshViewport();
            }

            this.handlePointerActivity();
        } catch (error) {
            logger.error("Failed to switch renderer backend", error);
            this.ui.setStatus("Failed to switch renderer backend.");
        }
    }

    private setRenderResolution(resolution: RenderResolutionPreference): void {
        this.renderResolutionPreference = resolution;
        this.renderer.setRenderResolution(resolution);
        this.ui.setRenderResolutionState(resolution);
        this.setStoredRenderResolution(resolution);
        this.handlePointerActivity();
    }

    private seek(ratio: number): void {
        const time = this.getDuration() * ratio;
        this.renderer.seek(time);
        if (this.audio.getDuration() > 0) {
            this.audio.seek(time);
        }
        this.sampleScheduler?.reset(time);
        this.ui.setDuration(time, this.getDuration());
        this.handlePointerActivity();
    }

    private handlePointerActivity(): void {
        this.ui.setControlsVisible(true);
        if (this.controlsTimer) {
            window.clearTimeout(this.controlsTimer);
            this.controlsTimer = undefined;
        }

        if (this.fixedControls) {
            return;
        }

        this.controlsTimer = window.setTimeout(() => {
            if (!this.ui.isMenuVisible() && this.playing) {
                this.ui.setControlsVisible(false);
            }
        }, CONTROLS_IDLE_TIMEOUT);
    }

    private handleMenuVisibility(): void {
        if (this.ui.isMenuVisible() || this.fixedControls) {
            this.ui.setControlsVisible(true);
            return;
        }

        this.handlePointerActivity();
    }

    private getDuration(): number {
        return Math.max(this.currentStoryboard?.duration ?? 0, this.audio.getDuration());
    }

    private getPlaybackTime(rendererTime = this.renderer.getTime()): number {
        if (this.audio.getDuration() > 0) {
            return this.audio.getCurrentTime();
        }

        return rendererTime;
    }

    private readonly handleKeydown = (event: KeyboardEvent): void => {
        if (shouldIgnoreKeyboardShortcut(event)) {
            return;
        }

        if (event.code === "Space") {
            event.preventDefault();
            this.togglePlayback();
            this.handlePointerActivity();
            return;
        }

        if (event.code === "ArrowLeft") {
            event.preventDefault();
            this.seekToTime(this.getPlaybackTime() - KEYBOARD_SEEK_STEP);
            return;
        }

        if (event.code === "ArrowRight") {
            event.preventDefault();
            this.seekToTime(this.getPlaybackTime() + KEYBOARD_SEEK_STEP);
            return;
        }
    };

    private seekToTime(time: number): void {
        const clampedTime = Math.min(Math.max(0, time), this.getDuration());
        this.renderer.seek(clampedTime);
        if (this.audio.getDuration() > 0) {
            this.audio.seek(clampedTime);
        }
        this.sampleScheduler?.reset(clampedTime);
        this.ui.setDuration(clampedTime, this.getDuration());
        this.handlePointerActivity();
    }

    private toggleFixedControls(): void {
        const next = !this.fixedControls;
        this.setFixedControls(next);
        this.setStoredBoolean(STORAGE_KEY_FIXED_CONTROLS, next);
        this.handlePointerActivity();
    }

    private setFixedControls(enabled: boolean): void {
        this.fixedControls = enabled;
        this.ui.setFixedControlsState(enabled);

        requestAnimationFrame(() => {
            this.renderer.refreshViewport();
        });

        if (enabled) {
            if (this.controlsTimer) {
                window.clearTimeout(this.controlsTimer);
                this.controlsTimer = undefined;
            }
            this.ui.setControlsVisible(true);
        }
    }
}

function shouldIgnoreKeyboardShortcut(event: KeyboardEvent): boolean {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
        return true;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

const app = new App();

void app.init();

window.addEventListener("beforeunload", () => {
    app.destroy();
});
