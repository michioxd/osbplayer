import { Container, Graphics, Text, TextStyle, VERSION, type Renderer } from "pixi.js";

const UI_PANEL_ALPHA = 0xaa / 0xff;
const STATS_TEXT_STYLE = new TextStyle({
    fill: 0xffffff,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 16,
});
const STATS_PANEL_PADDING = 8;
export const STATS_PANEL_MARGIN = 16;

export interface RendererStats {
    fps: number;
    gpu: string;
    visibleElements: number;
    visibleSprites: number;
    totalSprites: number;
    renderWidth: number;
    renderHeight: number;
}

export class StatsOverlay {
    readonly container = new Container();
    private readonly background = new Graphics();
    private readonly text = new Text({ text: "", style: STATS_TEXT_STYLE });
    private visible = false;
    private buildInfo = "unknown.unknown";

    constructor() {
        this.container.eventMode = "none";
        this.container.visible = false;
        this.background.eventMode = "none";
        this.text.eventMode = "none";
        this.container.addChild(this.background, this.text);
    }

    setBuildInfo(hash: string, branch: string): void {
        this.buildInfo = `${branch || "unknown"}.${hash || "unknown"}`;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        this.container.visible = visible;
        if (!visible) {
            this.background.clear();
        }
    }

    isVisible(): boolean {
        return this.visible;
    }

    setPosition(x: number, y: number): void {
        this.container.position.set(x, y);
    }

    update(stats: RendererStats): void {
        if (!this.visible) {
            this.container.visible = false;
            this.background.clear();
            return;
        }

        this.container.visible = true;
        this.text.text = [
            `osu!storyboard player by michioxd ${this.buildInfo}`,
            `FPS: ${formatFps(stats.fps)}`,
            `GPU: ${stats.gpu}`,
            `Elements visible: ${stats.visibleElements}`,
            `Sprites visible/total: ${stats.visibleSprites}/${stats.totalSprites}`,
            `Render resolution: ${formatResolution(stats.renderWidth, stats.renderHeight)}`,
            `PixiJS version: ${VERSION}`,
        ].join("\n");
        this.text.position.set(STATS_PANEL_PADDING, STATS_PANEL_PADDING);

        this.background.clear();
        this.background.rect(
            0,
            0,
            this.text.width + STATS_PANEL_PADDING * 2,
            this.text.height + STATS_PANEL_PADDING * 2,
        );
        this.background.fill({ color: 0x111111, alpha: UI_PANEL_ALPHA });
        this.background.stroke({ color: 0x333333, width: 1, alpha: UI_PANEL_ALPHA });
    }

    renderNow(renderer: Renderer, stage: Container, initialized: boolean): void {
        if (!initialized) {
            return;
        }

        renderer.render(stage);
    }
}

function formatFps(value: number): string {
    const normalized = Number.isFinite(value) && value > 0 ? value : 0;
    return normalized.toFixed(1);
}

function formatResolution(width: number, height: number): string {
    const safeWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const safeHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    return `${safeWidth}x${safeHeight}`;
}

export function resolveGpuInfo(canvas: HTMLCanvasElement): string {
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
        return "Unavailable";
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (typeof renderer === "string" && renderer.length > 0) {
            return renderer;
        }
    }

    const renderer = gl.getParameter(gl.RENDERER);
    return typeof renderer === "string" && renderer.length > 0 ? renderer : "Unavailable";
}
