export type RenderResolutionPreference = "auto" | "144p" | "240p" | "360p" | "480p" | "720p" | "1080p" | "1440p" | "4k";

export const RENDER_RESOLUTION_ORDER: RenderResolutionPreference[] = [
    "auto",
    "144p",
    "240p",
    "360p",
    "480p",
    "720p",
    "1080p",
    "1440p",
    "4k",
];

interface RenderResolutionDimensions {
    width: number;
    height: number;
}

export function isRenderResolutionPreference(value: string): value is RenderResolutionPreference {
    return RENDER_RESOLUTION_ORDER.includes(value as RenderResolutionPreference);
}

export function formatRenderResolutionPreference(value: RenderResolutionPreference): string {
    switch (value) {
        case "auto":
            return "Auto";
        case "4k":
            return "4K";
        default:
            return value;
    }
}

export function getRenderResolutionDescription(value: RenderResolutionPreference): string {
    if (value === "auto") {
        return "Use automatic resolution based on player size";
    }

    const { width, height } = getFixedRenderResolutionDimensions(value);
    return `${width}x${height}`;
}

export function getRenderResolutionDimensions(
    value: RenderResolutionPreference,
    autoWidth: number,
    autoHeight: number,
): RenderResolutionDimensions {
    if (value === "auto") {
        return {
            width: autoWidth,
            height: autoHeight,
        };
    }

    return getFixedRenderResolutionDimensions(value);
}

function getFixedRenderResolutionDimensions(
    value: Exclude<RenderResolutionPreference, "auto">,
): RenderResolutionDimensions {
    switch (value) {
        case "144p":
            return { width: 256, height: 144 };
        case "240p":
            return { width: 426, height: 240 };
        case "360p":
            return { width: 640, height: 360 };
        case "480p":
            return { width: 854, height: 480 };
        case "720p":
            return { width: 1280, height: 720 };
        case "1080p":
            return { width: 1920, height: 1080 };
        case "1440p":
            return { width: 2560, height: 1440 };
        case "4k":
            return { width: 3840, height: 2160 };
    }
}
