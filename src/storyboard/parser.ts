import {
    Easing,
    EventType,
    EventTypeStrings,
    Layer,
    LayerStrings,
    Origin,
    OriginStrings,
    ParameterType,
    type AnimationLoopType,
    type DifficultyEntry,
    type StoryboardAnimation,
    type StoryboardData,
    type StoryboardEvent,
    type StoryboardLoop,
    type StoryboardSample,
    type StoryboardSprite,
    type StoryboardTrigger,
    type StoryboardVisual,
} from "../types/storyboard";
import { removePathQuotes } from "../utils/path";

const LayerNumericMap: Record<number, Layer> = {
    0: Layer.Background,
    1: Layer.Fail,
    2: Layer.Pass,
    3: Layer.Foreground,
    4: Layer.Overlay,
};

const OriginNumericMap: Record<number, Origin> = {
    0: Origin.TopLeft,
    1: Origin.Centre,
    2: Origin.CentreLeft,
    3: Origin.TopRight,
    4: Origin.BottomCentre,
    5: Origin.TopCentre,
    6: Origin.Centre,
    7: Origin.CentreRight,
    8: Origin.BottomLeft,
    9: Origin.BottomRight,
};

const gameplayAssetPatterns = [
    /^hitcircle/i,
    /^hitcircleoverlay/i,
    /^approachcircle/i,
    /^default-\d+/i,
    /^slider/i,
    /^reverse/i,
    /^selection/i,
    /^menu/i,
    /^cursor/i,
    /^score/i,
    /^ranking/i,
];

export function parseDifficultyEntry(fileData: string, filePath: string): DifficultyEntry {
    let currentSection = "";
    let title = "";
    let artist = "";
    let mapper = "";
    let name = "";

    for (const rawLine of normalizeLineEndings(fileData).split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("//")) {
            continue;
        }

        if (line.startsWith("[") && line.endsWith("]")) {
            currentSection = line.slice(1, -1);
            continue;
        }

        if (currentSection !== "Metadata") {
            continue;
        }

        if (line.startsWith("Title:")) {
            title = line.slice("Title:".length).trim();
        } else if (line.startsWith("Artist:")) {
            artist = line.slice("Artist:".length).trim();
        } else if (line.startsWith("Creator:")) {
            mapper = line.slice("Creator:".length).trim();
        } else if (line.startsWith("Version:")) {
            name = line.slice("Version:".length).trim();
        }
    }

    return {
        id: crypto.randomUUID(),
        name,
        mapper,
        filePath,
        fileData,
        title,
        artist,
    };
}

export function parseStoryboard(osuText: string, osbText = ""): StoryboardData {
    const combined = `${normalizeLineEndings(osuText)}\n${normalizeLineEndings(osbText)}`;
    const lines = combined.split("\n");

    let currentSection = "";
    let currentVisual: StoryboardVisual | null = null;
    let inLoop = false;
    let inTrigger = false;

    const visuals: StoryboardVisual[] = [];
    const samples: StoryboardSample[] = [];
    const variables: Record<string, string> = {};

    let audioFilename = "";
    let audioLeadIn = 0;
    let widescreenStoryboard = false;
    let mapTitle = "";
    let mapArtist = "";
    let mapper = "";
    let diffName = "";
    let background: StoryboardData["background"];
    let video: StoryboardData["video"];
    let duration = 0;

    for (const originalLine of lines) {
        const trimmed = originalLine.trim();

        if (!trimmed || trimmed.startsWith("//")) {
            continue;
        }

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            currentSection = trimmed.slice(1, -1);
            currentVisual = null;
            inLoop = false;
            inTrigger = false;
            continue;
        }

        let line = applyVariables(trimmed, variables);

        if (currentSection === "General") {
            if (line.startsWith("AudioFilename:")) {
                audioFilename = line.slice("AudioFilename:".length).trim();
            } else if (line.startsWith("AudioLeadIn:")) {
                audioLeadIn = Number.parseInt(line.slice("AudioLeadIn:".length).trim(), 10) || 0;
            } else if (line.startsWith("WidescreenStoryboard:")) {
                widescreenStoryboard = parseFlag(line.slice("WidescreenStoryboard:".length).trim());
            }
            continue;
        }

        if (currentSection === "Metadata") {
            if (line.startsWith("Title:")) {
                mapTitle = line.slice("Title:".length).trim();
            } else if (line.startsWith("Artist:")) {
                mapArtist = line.slice("Artist:".length).trim();
            } else if (line.startsWith("Creator:")) {
                mapper = line.slice("Creator:".length).trim();
            } else if (line.startsWith("Version:")) {
                diffName = line.slice("Version:".length).trim();
            }
            continue;
        }

        if (currentSection === "Variables") {
            const splitIndex = line.indexOf("=");
            if (splitIndex > 0 && splitIndex < line.length - 1) {
                variables[line.slice(0, splitIndex)] = line.slice(splitIndex + 1);
            }
            continue;
        }

        if (currentSection !== "Events") {
            continue;
        }

        const { depth, line: trimmedEventLine } = stripCommandIndentation(originalLine);
        line = applyVariables(trimmedEventLine, variables);
        const parts = line.split(",").map((part) => part.trim());

        if (inTrigger && depth < 2) {
            inTrigger = false;
        }

        if (inLoop && depth < 2) {
            inLoop = false;
        }

        if (parts[0] === "0" && parts.length >= 3) {
            background = {
                path: removePathQuotes(parts[2]),
                x: Number.parseFloat(parts[3] ?? "0") || 0,
                y: Number.parseFloat(parts[4] ?? "0") || 0,
            };
            continue;
        }

        if ((parts[0] === "Video" || parts[0] === "1") && parts.length >= 3) {
            video = {
                startTime: Number.parseFloat(parts[1]) || 0,
                path: removePathQuotes(parts[2]),
                x: Number.parseFloat(parts[3] ?? "0") || 0,
                y: Number.parseFloat(parts[4] ?? "0") || 0,
            };
            continue;
        }

        if ((parts[0] === "Sprite" || parts[0] === "4") && parts.length >= 6) {
            const filePath = removePathQuotes(parts[3]);
            if (shouldSkipGameplayAsset(filePath)) {
                currentVisual = null;
                continue;
            }

            currentVisual = createSprite(parts);
            visuals.push(currentVisual);
            continue;
        }

        if ((parts[0] === "Animation" || parts[0] === "6") && parts.length >= 8) {
            const filePath = removePathQuotes(parts[3]);
            if (shouldSkipGameplayAsset(filePath)) {
                currentVisual = null;
                continue;
            }

            currentVisual = createAnimation(parts);
            visuals.push(currentVisual);
            continue;
        }

        if ((parts[0] === "Sample" || parts[0] === "5") && parts.length >= 5) {
            const layer = parseLayer(parts[2]);
            samples.push({
                startTime: Number.parseFloat(parts[1]) || 0,
                layer,
                path: removePathQuotes(parts[3]),
                volume: Number.parseFloat(parts[4]) || 0,
            });
            continue;
        }

        if (parts[0] === "T" && currentVisual && !inLoop && !inTrigger) {
            const trigger: StoryboardTrigger = {
                triggerName: parts[1] ?? "",
                startTime: Number.parseFloat(parts[2] ?? "0") || 0,
                endTime: Number.parseFloat(parts[3] ?? `${duration}`) || duration,
                groupNumber: Number.parseInt(parts[4] ?? "0", 10) || 0,
                events: [],
                activated: false,
                loopLength: 0,
            };
            currentVisual.triggers.push(trigger);
            inTrigger = true;
            continue;
        }

        if (parts[0] === "L" && currentVisual && !inLoop && !inTrigger) {
            const loop: StoryboardLoop = {
                startTime: Number.parseFloat(parts[1] ?? "0") || 0,
                loopCount: Number.parseInt(parts[2] ?? "0", 10) || 0,
                events: [],
                loopLength: 0,
                endTime: 0,
            };
            currentVisual.loops.push(loop);
            inLoop = true;
            continue;
        }

        if (depth === 0 || !currentVisual) {
            continue;
        }

        const events = parseEvent(parts);
        if (events.length === 0) {
            continue;
        }

        duration = Math.max(duration, ...events.map((event) => event.endTime));

        if (inTrigger && currentVisual.triggers.length > 0) {
            currentVisual.triggers.at(-1)?.events.push(...events);
        } else if (inLoop && currentVisual.loops.length > 0) {
            currentVisual.loops.at(-1)?.events.push(...events);
        } else {
            currentVisual.events.push(...events);
        }
    }

    return {
        visuals,
        samples,
        audioFilename,
        widescreenStoryboard,
        background,
        video,
        duration,
        audioLeadIn,
        mapTitle,
        mapArtist,
        mapper,
        diffName,
    };
}

function normalizeLineEndings(content: string): string {
    return content.replaceAll(/\r\n?/g, "\n");
}

function stripCommandIndentation(line: string): { depth: number; line: string } {
    let index = 0;

    while (index < line.length && (line[index] === " " || line[index] === "_")) {
        index += 1;
    }

    return {
        depth: index,
        line: line.slice(index),
    };
}

function applyVariables(line: string, variables: Record<string, string>): string {
    let result = line;

    for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(key, value);
    }

    return result;
}

function shouldSkipGameplayAsset(filePath: string): boolean {
    return gameplayAssetPatterns.some((pattern) => pattern.test(filePath));
}

function createSprite(parts: string[]): StoryboardSprite {
    return {
        kind: "sprite",
        layer: parseLayer(parts[1]),
        origin: parseOrigin(parts[2]),
        filePath: removePathQuotes(parts[3]),
        x: Number.parseFloat(parts[4]) || 0,
        y: Number.parseFloat(parts[5]) || 0,
        events: [],
        loops: [],
        triggers: [],
    };
}

function createAnimation(parts: string[]): StoryboardAnimation {
    const loopType = (parts[8] as AnimationLoopType | undefined) ?? "LoopForever";

    return {
        kind: "animation",
        layer: parseLayer(parts[1]),
        origin: parseOrigin(parts[2]),
        filePath: removePathQuotes(parts[3]),
        x: Number.parseFloat(parts[4]) || 0,
        y: Number.parseFloat(parts[5]) || 0,
        frameCount: Number.parseInt(parts[6] ?? "0", 10) || 0,
        frameDelay: Number.parseInt(parts[7] ?? "0", 10) || 0,
        loopType: loopType === "LoopOnce" ? "LoopOnce" : "LoopForever",
        events: [],
        loops: [],
        triggers: [],
    };
}

function parseEvent(parts: string[]): StoryboardEvent[] {
    const eventType = parseEnum(EventTypeStrings, parts[0]);
    if (!eventType || parts.length < 4) {
        return [];
    }

    const easing = (Number.parseInt(parts[1], 10) || 0) as Easing;
    const startTime = Number.parseFloat(parts[2]) || 0;
    const endTime = parts[3] ? Number.parseFloat(parts[3]) || startTime : startTime;

    switch (eventType) {
        case EventType.F:
        case EventType.S:
        case EventType.R:
        case EventType.MX:
        case EventType.MY:
            return parseScalarEvents(eventType, easing, startTime, endTime, parts.slice(4));
        case EventType.V:
        case EventType.M:
            return [
                {
                    type: eventType,
                    easing,
                    startTime,
                    endTime,
                    startValue: [parseNumber(parts[4]), parseNumber(parts[5])],
                    endValue:
                        parts.length > 6
                            ? [parseNumber(parts[6]), parseNumber(parts[7])]
                            : [parseNumber(parts[4]), parseNumber(parts[5])],
                },
            ];
        case EventType.C:
            return [
                {
                    type: eventType,
                    easing,
                    startTime,
                    endTime,
                    startValue: [
                        parseColourChannel(parts[4]),
                        parseColourChannel(parts[5]),
                        parseColourChannel(parts[6]),
                    ],
                    endValue:
                        parts.length > 7
                            ? [parseColourChannel(parts[7]), parseColourChannel(parts[8]), parseColourChannel(parts[9])]
                            : [
                                  parseColourChannel(parts[4]),
                                  parseColourChannel(parts[5]),
                                  parseColourChannel(parts[6]),
                              ],
                },
            ];
        case EventType.P:
            return [
                {
                    type: eventType,
                    easing,
                    startTime,
                    endTime,
                    startValue: (parts[4] as ParameterType | undefined) ?? ParameterType.Additive,
                    endValue: (parts[4] as ParameterType | undefined) ?? ParameterType.Additive,
                },
            ];
        default:
            return [];
    }
}

function parseScalarEvents(
    type: EventType,
    easing: Easing,
    startTime: number,
    endTime: number,
    values: string[],
): StoryboardEvent[] {
    if (values.length === 0) {
        return [];
    }

    if (values.length === 1) {
        const value = Number.parseFloat(values[0]) || 0;
        return [
            {
                type,
                easing,
                startTime,
                endTime,
                startValue: value,
                endValue: value,
            },
        ];
    }

    const events: StoryboardEvent[] = [];
    const segmentCount = Math.max(1, values.length - 1);
    const segmentDuration = (endTime - startTime) / segmentCount;
    let currentStart = startTime;

    for (let index = 0; index < values.length - 1; index += 1) {
        events.push({
            type,
            easing,
            startTime: currentStart,
            endTime: index === values.length - 2 ? endTime : currentStart + segmentDuration,
            startValue: parseNumber(values[index]),
            endValue: parseNumber(values[index + 1]),
        });
        currentStart += segmentDuration;
    }

    return events;
}

function parseEnum<T>(enumMap: Record<string, T>, value: string): T | undefined {
    const mapped = enumMap[value];
    if (mapped !== undefined) {
        return mapped;
    }

    const numeric = Number.parseInt(value, 10);
    if (Number.isNaN(numeric)) {
        return undefined;
    }

    const values = Object.values(enumMap);
    return values[numeric];
}

function parseLayer(value: string | undefined): Layer {
    if (!value) {
        return Layer.Background;
    }

    const named = LayerStrings[value];
    if (named !== undefined) {
        return named;
    }

    const numeric = Number.parseInt(value, 10);
    return LayerNumericMap[numeric] ?? Layer.Background;
}

function parseOrigin(value: string | undefined): Origin {
    if (!value) {
        return Origin.Centre;
    }

    const named = OriginStrings[value];
    if (named !== undefined) {
        return named;
    }

    const numeric = Number.parseInt(value, 10);
    return OriginNumericMap[numeric] ?? Origin.Centre;
}

function parseNumber(value: string | undefined, fallback = 0): number {
    const parsed = Number.parseFloat(value ?? `${fallback}`);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseColourChannel(value: string | undefined): number {
    return clampColourChannel(parseNumber(value, 255));
}

function clampColourChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function parseFlag(value: string): boolean {
    return value === "1" || value.toLowerCase() === "true";
}
