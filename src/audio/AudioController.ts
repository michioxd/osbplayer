import { Howl } from "howler";

const HTML5_AUDIO_THRESHOLD_BYTES = 20 * 1024 * 1024;

export class AudioController {
    private howl?: Howl;
    private objectUrl?: string;
    private volume = 1;
    private endedListener?: () => void;
    private playbackId?: number;

    private readonly handleEnded = (): void => {
        this.playbackId = undefined;
        this.endedListener?.();
    };

    async load(blob: Blob, sourcePath?: string): Promise<void> {
        this.disposeHowl();
        this.disposeObjectUrl();
        this.objectUrl = URL.createObjectURL(blob);
        this.howl = await createHowl(
            this.objectUrl,
            this.volume,
            blob.size >= HTML5_AUDIO_THRESHOLD_BYTES,
            resolveHowlerFormats(sourcePath, blob),
        );
        this.howl.on("end", this.handleEnded);
        this.howl.seek(0);
    }

    play(): Promise<void> {
        const howl = this.howl;
        if (!howl) {
            return Promise.resolve();
        }

        if (this.playbackId !== undefined && howl.playing(this.playbackId)) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let settled = false;

            const handlePlay = (soundId: number): void => {
                if (soundId !== this.playbackId) {
                    return;
                }

                settled = true;
                cleanup();
                resolve();
            };

            const handlePlayError = (_soundId: number, error: unknown): void => {
                settled = true;
                cleanup();
                reject(new Error(`Failed to play media: ${String(error)}`));
            };

            const cleanup = (): void => {
                howl.off("play", handlePlay);
                howl.off("playerror", handlePlayError);
            };

            howl.on("play", handlePlay);
            howl.on("playerror", handlePlayError);
            const soundId = this.playbackId === undefined ? howl.play() : howl.play(this.playbackId);
            this.playbackId = soundId;

            queueMicrotask(() => {
                if (!settled && howl.playing(soundId)) {
                    cleanup();
                    resolve();
                }
            });
        });
    }

    pause(): void {
        if (this.playbackId !== undefined) {
            this.howl?.pause(this.playbackId);
            return;
        }

        this.howl?.pause();
    }

    seek(milliseconds: number): void {
        const seconds = Math.max(0, milliseconds / 1000);
        if (this.playbackId !== undefined) {
            this.howl?.seek(seconds, this.playbackId);
            return;
        }

        this.howl?.seek(seconds);
    }

    getCurrentTime(): number {
        const currentTime = this.playbackId !== undefined ? this.howl?.seek(this.playbackId) : this.howl?.seek();
        return typeof currentTime === "number" ? currentTime * 1000 : 0;
    }

    getDuration(): number {
        const duration = this.howl?.duration();
        return typeof duration === "number" && Number.isFinite(duration) ? duration * 1000 : 0;
    }

    isPlaying(): boolean {
        return this.playbackId !== undefined
            ? (this.howl?.playing(this.playbackId) ?? false)
            : (this.howl?.playing() ?? false);
    }

    onEnded(listener: () => void): void {
        this.endedListener = listener;
    }

    setVolume(volume: number): void {
        this.volume = Math.min(1, Math.max(0, volume));
        if (this.playbackId !== undefined) {
            this.howl?.volume(this.volume, this.playbackId);
            return;
        }

        this.howl?.volume(this.volume);
    }

    destroy(): void {
        this.pause();
        this.disposeHowl();
        this.disposeObjectUrl();
    }

    private disposeHowl(): void {
        if (!this.howl) {
            return;
        }

        this.howl.off("end", this.handleEnded);
        this.howl.unload();
        this.howl = undefined;
        this.playbackId = undefined;
    }

    private disposeObjectUrl(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = undefined;
        }
    }
}

function createHowl(src: string, volume: number, html5: boolean, format?: string[]): Promise<Howl> {
    return new Promise((resolve, reject) => {
        let howl: Howl | undefined;

        const cleanup = (): void => {
            howl?.off("load", handleLoad);
            howl?.off("loaderror", handleLoadError);
        };

        const handleLoad = (): void => {
            cleanup();
            if (howl) {
                resolve(howl);
            }
        };

        const handleLoadError = (_soundId: number, error: unknown): void => {
            cleanup();
            howl?.unload();
            reject(new Error(`Failed to load media: ${String(error)}`));
        };

        howl = new Howl({
            src: [src],
            html5,
            format,
            preload: true,
            volume,
        });

        howl.once("load", handleLoad);
        howl.once("loaderror", handleLoadError);
    });
}

function resolveHowlerFormats(sourcePath: string | undefined, blob: Blob): string[] | undefined {
    const pathFormat = getFormatFromPath(sourcePath);
    if (pathFormat) {
        return [pathFormat];
    }

    const mimeFormat = getFormatFromMimeType(blob.type);
    return mimeFormat ? [mimeFormat] : undefined;
}

function getFormatFromPath(path: string | undefined): string | undefined {
    if (!path) {
        return undefined;
    }

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
