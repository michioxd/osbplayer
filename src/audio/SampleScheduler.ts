import { Howl } from "howler";
import type { PreparedStoryboardData } from "../types/storyboard";
import { getFileName, normalizePath } from "../utils/path";

export class SampleScheduler {
    private readonly samples: PreparedStoryboardData["samples"];
    private readonly sounds = new Map<string, Howl>();
    private readonly urls = new Map<string, string>();
    private nextSampleIndex = 0;
    private lastTime = 0;

    constructor(storyboard: PreparedStoryboardData, assets: Map<string, Blob>) {
        this.samples = [...storyboard.samples].sort((left, right) => left.startTime - right.startTime);

        for (const sample of this.samples) {
            const blob = resolveSampleBlob(sample.path, assets);
            if (blob && !this.urls.has(sample.path)) {
                const url = URL.createObjectURL(blob);
                this.urls.set(sample.path, url);
                this.sounds.set(
                    sample.path,
                    new Howl({
                        src: [url],
                        html5: false,
                        format: resolveHowlerFormats(sample.path, blob),
                        preload: true,
                        pool: 16,
                    }),
                );
            }
        }
    }

    reset(time: number): void {
        this.lastTime = time;
        this.nextSampleIndex = this.findNextIndex(time);
        this.stopActiveSounds();
    }

    update(currentTime: number, isPlaying: boolean): void {
        if (!isPlaying) {
            this.lastTime = currentTime;
            return;
        }

        if (currentTime < this.lastTime) {
            this.reset(currentTime);
            return;
        }

        while (
            this.nextSampleIndex < this.samples.length &&
            this.samples[this.nextSampleIndex].startTime <= currentTime
        ) {
            const sample = this.samples[this.nextSampleIndex];
            if (sample.startTime >= this.lastTime) {
                this.playSample(sample.path, sample.volume);
            }
            this.nextSampleIndex += 1;
        }

        this.lastTime = currentTime;
    }

    destroy(): void {
        this.stopActiveSounds();
        for (const sound of this.sounds.values()) {
            sound.unload();
        }
        this.sounds.clear();
        for (const url of this.urls.values()) {
            URL.revokeObjectURL(url);
        }
        this.urls.clear();
    }

    private findNextIndex(time: number): number {
        let low = 0;
        let high = this.samples.length;

        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.samples[middle].startTime < time) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    }

    private playSample(path: string, volume: number): void {
        const sound = this.sounds.get(path);
        if (!sound) {
            return;
        }

        const soundId = sound.play();
        sound.volume(Math.min(1, Math.max(0, volume / 100)), soundId);
    }

    private stopActiveSounds(): void {
        for (const sound of this.sounds.values()) {
            sound.stop();
        }
    }
}

function resolveSampleBlob(path: string, assets: Map<string, Blob>): Blob | undefined {
    const directMatch = assets.get(path);
    if (directMatch) {
        return directMatch;
    }

    const normalizedPath = normalizePath(path);
    for (const [key, blob] of assets.entries()) {
        if (normalizePath(key) === normalizedPath) {
            return blob;
        }
    }

    const fileName = getFileName(path).toLowerCase();
    for (const [key, blob] of assets.entries()) {
        if (getFileName(key).toLowerCase() === fileName) {
            return blob;
        }
    }

    return undefined;
}

function resolveHowlerFormats(path: string, blob: Blob): string[] | undefined {
    const pathFormat = getFormatFromPath(path);
    if (pathFormat) {
        return [pathFormat];
    }

    const mimeFormat = getFormatFromMimeType(blob.type);
    return mimeFormat ? [mimeFormat] : undefined;
}

function getFormatFromPath(path: string): string | undefined {
    const match = /\.([^.\\/]+)$/.exec(path.trim().toLowerCase());
    if (!match) {
        return undefined;
    }

    return normalizeHowlerFormat(match[1]);
}

function getFormatFromMimeType(mimeType: string): string | undefined {
    const normalized = mimeType.trim().toLowerCase();
    switch (normalized) {
        case "audio/mpeg":
        case "audio/mp3":
            return "mp3";
        case "audio/wav":
        case "audio/wave":
        case "audio/x-wav":
            return "wav";
        case "audio/ogg":
        case "application/ogg":
            return "ogg";
        case "audio/mp4":
        case "audio/x-m4a":
            return "m4a";
        default:
            return undefined;
    }
}

function normalizeHowlerFormat(extension: string): string | undefined {
    switch (extension) {
        case "mp3":
        case "wav":
        case "ogg":
        case "oga":
            return extension === "oga" ? "ogg" : extension;
        case "m4a":
        case "mp4":
            return "m4a";
        default:
            return undefined;
    }
}
