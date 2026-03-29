const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
const videoExtensions = [".mp4", ".webm", ".ogv", ".mov", ".avi", ".m4v"];
const audioExtensions = [".mp3", ".ogg", ".wav", ".m4a"];

export function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").trim().toLowerCase();
}

export function removePathQuotes(path: string): string {
    if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
        return path.slice(1, -1);
    }

    return path;
}

export function getFileName(path: string): string {
    return path.replace(/^.*[\\/]/, "");
}

export function getExtension(path: string): string {
    const match = /\.[^.]+$/.exec(path);
    return match?.[0].toLowerCase() ?? "";
}

export function hasKnownImageExtension(path: string): boolean {
    return imageExtensions.includes(getExtension(path));
}

export function isVideoPath(path: string): boolean {
    return videoExtensions.includes(getExtension(path));
}

export function isAudioPath(path: string): boolean {
    return audioExtensions.includes(getExtension(path));
}

export function getImageExtensions(): string[] {
    return [...imageExtensions];
}

export function buildAnimationFramePath(path: string, frameIndex: number): string {
    const extension = getExtension(path);
    if (!extension) {
        return `${path}${frameIndex}`;
    }

    return `${path.slice(0, -extension.length)}${frameIndex}${extension}`;
}

export function getMimeType(path: string): string {
    const extension = getExtension(path);

    switch (extension) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".bmp":
            return "image/bmp";
        case ".webp":
            return "image/webp";
        case ".mp3":
            return "audio/mpeg";
        case ".wav":
            return "audio/wav";
        case ".m4a":
            return "audio/mp4";
        case ".ogg":
            return isVideoPath(path) ? "video/ogg" : "audio/ogg";
        case ".ogv":
            return "video/ogg";
        case ".mp4":
        case ".m4v":
            return "video/mp4";
        case ".webm":
            return "video/webm";
        case ".mov":
            return "video/quicktime";
        case ".avi":
            return "video/x-msvideo";
        default:
            return "application/octet-stream";
    }
}
