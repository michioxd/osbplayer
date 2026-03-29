import type { AssetLoadProgress, DifficultyEntry } from "./types/storyboard";
import { qs } from "./utils/dom";
import { formatTime } from "./utils/time";

export interface PlayerUIEvents {
    onOpenFile: () => void;
    onTogglePlay: () => void;
    onToggleMenu: (visible: boolean) => void;
    onToggleLayoutBorders: () => void;
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
    private readonly layoutBordersButton = qs<HTMLButtonElement>("#toggle-layout-borders");
    private readonly statsButton = qs<HTMLButtonElement>("#toggle-stats");
    private readonly menuBackdrop = qs<HTMLElement>(".menu-backdrop");
    private readonly difficultySection = qs<HTMLElement>("#difficulty-dialog");
    private readonly diffSelector = qs<HTMLElement>(".menu-diff-selector");
    private readonly loadingSection = qs<HTMLElement>("#loading-state");
    private readonly loadingPercent = qs<HTMLElement>("#loading-percent");
    private readonly loadingCurrentFile = qs<HTMLElement>("#loading-current-file");
    private readonly loadingBar = qs<HTMLElement>("#loading-progress-fill");

    private dragging = false;
    private menuVisible = true;
    private currentPlaybackRatio = 0;
    private dialogMode: "difficulty" | "loading" = "difficulty";

    constructor(events: PlayerUIEvents) {
        this.events = events;
        qs<HTMLButtonElement>("#open-file").addEventListener("click", () => this.events.onOpenFile());
        qs<HTMLButtonElement>("#play-pause").addEventListener("click", () => this.events.onTogglePlay());
        qs<HTMLButtonElement>("#show-menu").addEventListener("click", () => this.showDifficultyDialog());
        this.layoutBordersButton.addEventListener("click", () => this.events.onToggleLayoutBorders());
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

    setPlaybackState(playing: boolean): void {
        this.playPauseIcon.className = playing ? "ti ti-control-pause" : "ti ti-control-play";
    }

    setLayoutBordersState(enabled: boolean): void {
        this.layoutBordersButton.classList.toggle("is-active", enabled);
        this.layoutBordersButton.setAttribute("aria-pressed", String(enabled));
        this.layoutBordersButton.title = enabled ? "Hide layout borders" : "Show layout borders";
    }

    setStatsState(enabled: boolean): void {
        this.statsButton.classList.toggle("is-active", enabled);
        this.statsButton.setAttribute("aria-pressed", String(enabled));
        this.statsButton.title = enabled ? "Hide stats overlay" : "Show stats overlay";
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
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
