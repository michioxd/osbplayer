import type { RenderResolutionPreference } from "./storyboard/renderResolution";
import {
    formatRenderResolutionPreference,
    getRenderResolutionDescription,
    RENDER_RESOLUTION_ORDER,
} from "./storyboard/renderResolution";
import type { AssetLoadProgress, DifficultyEntry } from "./types/storyboard";
import { qs } from "./utils/dom";
import { formatTime } from "./utils/time";

export interface PlayerUIEvents {
    onOpenFile: () => void;
    onTogglePlay: () => void;
    onToggleMenu: (visible: boolean) => void;
    onToggleFixedControls: () => void;
    onToggleLayoutBorders: () => void;
    onToggleLayoutBorderLabels: () => void;
    onCycleRendererBackend: () => void;
    onSelectRenderResolution: (resolution: RenderResolutionPreference) => void;
    onToggleStats: () => void;
    onToggleFullscreen: () => void;
    onStop: () => void;
    onSelectDifficulty: (difficultyId: string) => void;
    onSeek: (ratio: number) => void;
    onPointerActivity: () => void;
}

export class PlayerUI {
    private readonly events: PlayerUIEvents;
    private readonly app = qs<HTMLElement>("#app");
    private readonly statusText = qs<HTMLElement>("#status-text");
    private readonly menu = qs<HTMLElement>(".menu");
    private readonly menuTitle = qs<HTMLElement>("#menu-title");
    private readonly currentTime = qs<HTMLElement>("#current-time");
    private readonly totalTime = qs<HTMLElement>("#total-time");
    private readonly progress = qs<HTMLElement>("#progress");
    private readonly progressHandle = qs<HTMLElement>("#progress-handle");
    private readonly progressBar = qs<HTMLElement>("#progress-bar");
    private readonly playPauseIcon = qs<HTMLElement>("#play-pause i");
    private readonly settingsMenu = qs<HTMLElement>("#settings-menu");
    private readonly settingsMenuButton = qs<HTMLButtonElement>("#toggle-settings-menu");
    private readonly settingsPanel = qs<HTMLElement>("#settings-panel");
    private readonly settingsMainView = qs<HTMLElement>("#settings-view-main");
    private readonly settingsResolutionView = qs<HTMLElement>("#settings-view-resolution");
    private readonly fixedControlsButton = qs<HTMLButtonElement>("#toggle-fixed-controls");
    private readonly fixedControlsValue = qs<HTMLElement>("#toggle-fixed-controls-value");
    private readonly layoutBordersButton = qs<HTMLButtonElement>("#toggle-layout-borders");
    private readonly layoutBordersValue = qs<HTMLElement>("#toggle-layout-borders-value");
    private readonly layoutBorderLabelsButton = qs<HTMLButtonElement>("#toggle-layout-border-labels");
    private readonly layoutBorderLabelsValue = qs<HTMLElement>("#toggle-layout-border-labels-value");
    private readonly rendererBackendButton = qs<HTMLButtonElement>("#toggle-renderer-backend");
    private readonly rendererBackendValue = qs<HTMLElement>("#toggle-renderer-backend-value");
    private readonly resolutionButton = qs<HTMLButtonElement>("#toggle-resolution");
    private readonly resolutionValue = qs<HTMLElement>("#toggle-resolution-value");
    private readonly resolutionBackButton = qs<HTMLButtonElement>("#settings-resolution-back");
    private readonly resolutionList = qs<HTMLElement>("#settings-resolution-list");
    private readonly statsButton = qs<HTMLButtonElement>("#toggle-stats");
    private readonly statsValue = qs<HTMLElement>("#toggle-stats-value");
    private readonly menuBackdrop = qs<HTMLElement>(".menu-backdrop");
    private readonly difficultySection = qs<HTMLElement>("#difficulty-dialog");
    private readonly diffSelector = qs<HTMLElement>(".menu-diff-selector");
    private readonly loadingSection = qs<HTMLElement>("#loading-state");
    private readonly loadingPercent = qs<HTMLElement>("#loading-percent");
    private readonly loadingCurrentFile = qs<HTMLElement>("#loading-current-file");
    private readonly loadingBar = qs<HTMLElement>("#loading-progress-fill");

    private dragging = false;
    private menuVisible = true;
    private settingsMenuOpen = false;
    private settingsView: "main" | "resolution" = "main";
    private currentPlaybackRatio = 0;
    private dialogMode: "difficulty" | "loading" = "difficulty";

    constructor(events: PlayerUIEvents) {
        this.events = events;
        qs<HTMLButtonElement>("#open-file").addEventListener("click", () => this.events.onOpenFile());
        qs<HTMLButtonElement>("#play-pause").addEventListener("click", () => this.events.onTogglePlay());
        qs<HTMLButtonElement>("#show-menu").addEventListener("click", () => this.showDifficultyDialog());
        this.settingsMenuButton.addEventListener("click", () => this.setSettingsMenuOpen(!this.settingsMenuOpen));
        this.fixedControlsButton.addEventListener("click", () => this.events.onToggleFixedControls());
        this.layoutBordersButton.addEventListener("click", () => this.events.onToggleLayoutBorders());
        this.layoutBorderLabelsButton.addEventListener("click", () => this.events.onToggleLayoutBorderLabels());
        this.rendererBackendButton.addEventListener("click", () => this.events.onCycleRendererBackend());
        this.resolutionButton.addEventListener("click", () => this.setSettingsView("resolution"));
        this.resolutionBackButton.addEventListener("click", () => this.setSettingsView("main"));
        this.statsButton.addEventListener("click", () => this.events.onToggleStats());
        qs<HTMLButtonElement>("#fullscreen-toggle").addEventListener("click", () => this.events.onToggleFullscreen());
        qs<HTMLButtonElement>("#stop-all").addEventListener("click", () => this.events.onStop());
        this.menuBackdrop.addEventListener("click", () => {
            if (this.dialogMode !== "loading") {
                this.setMenuVisible(false);
            }
        });

        this.app.addEventListener("mousemove", () => this.events.onPointerActivity());
        this.app.addEventListener("pointerdown", () => this.events.onPointerActivity());

        document.addEventListener("pointerdown", this.handleDocumentPointerDown);
        window.addEventListener("keydown", this.handleWindowKeydown);

        this.progressBar.addEventListener("pointerdown", (event) => {
            this.dragging = true;
            this.seekFromPointer(event);
        });

        window.addEventListener("pointermove", (event) => {
            if (!this.dragging) {
                return;
            }
            this.seekFromPointer(event);
        });

        window.addEventListener("pointerup", () => {
            this.dragging = false;
        });

        window.addEventListener("resize", this.updateChromeInsets);
        this.renderResolutionOptions();
        this.updateChromeInsets();
    }

    setStatus(text: string): void {
        this.statusText.textContent = text;
    }

    showDifficultyDialog(): void {
        this.setDialogMode("difficulty");
        this.setMenuVisible(true);
    }

    showLoadingDialog(): void {
        this.setDialogMode("loading");
        this.setMenuVisible(true);
    }

    hideDialog(): void {
        this.setMenuVisible(false);
    }

    setMenuVisible(visible: boolean): void {
        this.menuVisible = visible;
        this.app.classList.toggle("hide_menu", !visible);
        this.events.onToggleMenu(visible);
    }

    isMenuVisible(): boolean {
        return this.menuVisible;
    }

    setControlsVisible(visible: boolean): void {
        this.app.classList.toggle("show", visible);
    }

    setFixedControlsState(enabled: boolean): void {
        this.app.classList.toggle("controls-fixed", enabled);
        this.fixedControlsButton.classList.toggle("is-active", enabled);
        this.fixedControlsButton.setAttribute("aria-pressed", String(enabled));
        this.fixedControlsButton.title = enabled ? "Unpin controls UI" : "Pin controls UI";
        this.fixedControlsValue.textContent = enabled ? "On" : "Off";
        this.updateChromeInsets();
    }

    setPlaybackState(playing: boolean): void {
        this.playPauseIcon.className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
    }

    setLayoutBordersState(enabled: boolean): void {
        this.layoutBordersButton.classList.toggle("is-active", enabled);
        this.layoutBordersButton.setAttribute("aria-pressed", String(enabled));
        this.layoutBordersButton.title = enabled ? "Hide layout borders" : "Show layout borders";
        this.layoutBordersValue.textContent = enabled ? "On" : "Off";
    }

    setLayoutBorderLabelsState(enabled: boolean): void {
        this.layoutBorderLabelsButton.classList.toggle("is-active", enabled);
        this.layoutBorderLabelsButton.setAttribute("aria-pressed", String(enabled));
        this.layoutBorderLabelsButton.title = enabled ? "Hide layout border labels" : "Show layout border labels";
        this.layoutBorderLabelsValue.textContent = enabled ? "On" : "Off";
    }

    setRendererBackendState(backend: "webgpu" | "webgl" | "canvas"): void {
        const label = getRendererBackendLabel(backend);
        this.rendererBackendValue.textContent = label.short;
        this.rendererBackendButton.title = `Renderer backend: ${label.long} (click to switch)`;
        this.rendererBackendButton.setAttribute("aria-label", `Renderer backend: ${label.long}. Click to switch.`);
    }

    setRenderResolutionState(resolution: RenderResolutionPreference): void {
        const label = formatRenderResolutionPreference(resolution);
        this.resolutionValue.textContent = label;
        this.resolutionButton.title = `Render resolution: ${label}`;
        this.resolutionButton.setAttribute("aria-label", `Render resolution: ${label}. Open resolution menu.`);

        this.resolutionList.querySelectorAll<HTMLButtonElement>("[data-resolution]").forEach((button) => {
            const active = button.dataset.resolution === resolution;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    setStatsState(enabled: boolean): void {
        this.statsButton.classList.toggle("is-active", enabled);
        this.statsButton.setAttribute("aria-pressed", String(enabled));
        this.statsButton.title = enabled ? "Hide stats overlay" : "Show stats overlay";
        this.statsValue.textContent = enabled ? "On" : "Off";
    }

    setDuration(current: number, total: number): void {
        this.currentTime.textContent = formatTime(current);
        this.totalTime.textContent = formatTime(total);
        this.setPlaybackProgress(total > 0 ? current / total : 0);
    }

    setPlaybackProgress(ratio: number): void {
        this.currentPlaybackRatio = Math.min(1, Math.max(0, ratio));
        const percent = `${this.currentPlaybackRatio * 100}%`;
        this.progress.style.width = percent;
        this.progressHandle.style.left = percent;
    }

    setLoadingState(active: boolean): void {
        this.loadingSection.classList.toggle("show", active);
        if (!active) {
            this.loadingBar.style.width = "0%";
            this.loadingPercent.textContent = "0%";
            this.loadingCurrentFile.textContent = "Waiting for load...";
        }
    }

    updateLoading(progress: AssetLoadProgress): void {
        this.loadingSection.classList.add("show");
        this.loadingBar.style.width = `${progress.percent}%`;
        this.loadingPercent.textContent = `${progress.percent}%`;
        this.loadingCurrentFile.textContent = progress.currentFile || "Preparing...";
    }

    renderDifficulties(difficulties: DifficultyEntry[]): void {
        this.diffSelector.replaceChildren();

        if (difficulties.length === 0) {
            const empty = document.createElement("div");
            empty.className = "diff-item is-empty";
            empty.textContent = "No difficulties found";
            this.diffSelector.appendChild(empty);
            return;
        }

        for (const difficulty of difficulties) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "diff-item";
            item.dataset.diffId = difficulty.id;
            item.innerHTML = `
                <span class="diff-name">${escapeHtml(difficulty.name)}</span>
                <span class="diff-meta">${escapeHtml(difficulty.mapper)}</span>
            `;
            item.addEventListener("click", () => this.events.onSelectDifficulty(difficulty.id));
            this.diffSelector.appendChild(item);
        }
    }

    setSelectedDifficulty(id: string): void {
        this.diffSelector.querySelectorAll<HTMLElement>(".diff-item").forEach((element) => {
            element.classList.toggle("is-active", element.dataset.diffId === id);
        });
    }

    private setDialogMode(mode: "difficulty" | "loading"): void {
        this.dialogMode = mode;
        this.menu.dataset.mode = mode;
        this.menuTitle.textContent = mode === "loading" ? "Loading storyboard assets" : "Select difficulty";
        this.difficultySection.hidden = mode !== "difficulty";
        this.loadingSection.classList.toggle("show", mode === "loading");
    }

    private seekFromPointer(event: PointerEvent): void {
        const rect = this.progressBar.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        this.events.onSeek(Math.min(1, Math.max(0, ratio)));
    }

    private setSettingsMenuOpen(open: boolean): void {
        this.settingsMenuOpen = open;
        this.settingsMenu.classList.toggle("is-open", open);
        this.settingsPanel.hidden = !open;
        this.settingsMenuButton.classList.toggle("is-active", open);
        this.settingsMenuButton.setAttribute("aria-expanded", String(open));
        if (!open) {
            this.setSettingsView("main");
        }
    }

    private setSettingsView(view: "main" | "resolution"): void {
        this.settingsView = view;
        const resolutionVisible = view === "resolution";
        this.settingsMainView.hidden = resolutionVisible;
        this.settingsResolutionView.hidden = !resolutionVisible;
        this.resolutionButton.setAttribute("aria-expanded", String(resolutionVisible));
    }

    private renderResolutionOptions(): void {
        this.resolutionList.replaceChildren();

        for (const resolution of RENDER_RESOLUTION_ORDER) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "settings-item settings-resolution-option";
            button.dataset.resolution = resolution;
            button.setAttribute("aria-pressed", "false");
            button.innerHTML = `
                <span class="settings-item__content">
                    <span class="settings-item__label">${escapeHtml(formatRenderResolutionPreference(resolution))}</span>
                    <span class="settings-item__description">${escapeHtml(getRenderResolutionDescription(resolution))}</span>
                </span>
                <span class="settings-item__value settings-item__check" aria-hidden="true">
                    <i class="fa-solid fa-check"></i>
                </span>
            `;
            button.addEventListener("click", () => {
                this.events.onSelectRenderResolution(resolution);
                this.setSettingsView("main");
            });
            this.resolutionList.appendChild(button);
        }
    }

    private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
        if (!this.settingsMenuOpen) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node) || this.settingsMenu.contains(target)) {
            return;
        }

        this.setSettingsMenuOpen(false);
    };

    private readonly handleWindowKeydown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && this.settingsMenuOpen && this.settingsView === "resolution") {
            this.setSettingsView("main");
            return;
        }

        if (event.key === "Escape" && this.settingsMenuOpen) {
            this.setSettingsMenuOpen(false);
        }
    };

    private readonly updateChromeInsets = (): void => {
        const headerHeight = qs<HTMLElement>(".bar.header").offsetHeight;
        const controlsHeight = qs<HTMLElement>(".bar.controls").offsetHeight;

        this.app.style.setProperty("--header-bar-height", `${headerHeight}px`);
        this.app.style.setProperty("--controls-bar-height", `${controlsHeight}px`);
    };
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getRendererBackendLabel(backend: "webgpu" | "webgl" | "canvas"): { short: string; long: string } {
    switch (backend) {
        case "webgpu":
            return { short: "GPU", long: "WebGPU" };
        case "webgl":
            return { short: "GL", long: "WebGL" };
        case "canvas":
            return { short: "2D", long: "Canvas" };
    }
}
