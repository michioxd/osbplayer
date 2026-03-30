import { EventType, Layer, ParameterType, type PreparedStoryboardVisual } from "../types/storyboard";
import { getFileName } from "../utils/path";

function createVisualInspectorLabel(visual: PreparedStoryboardVisual, index: number): string {
    const commands = collectVisualCommandLabels(visual);
    const effects = collectVisualEffectLabels(visual);
    const triggerLabels = visual.triggers.map((trigger) => {
        const range = Number.isFinite(trigger.endTime)
            ? `${trigger.startTime}-${trigger.endTime}`
            : `${trigger.startTime}+`;
        return `${trigger.triggerName || "trg"}@${range}`;
    });

    const parts = [
        `v:${getLayerLabel(visual.layer)}#${index}:${getFileName(visual.filePath)}`,
        `k=${getKindLabel(visual.kind)}`,
    ];

    if (commands.length > 0) {
        parts.push(`c=${commands.join(",")}`);
    }

    if (effects.length > 0) {
        parts.push(`fx=${effects.join(",")}`);
    }

    if (visual.loops.length > 0) {
        parts.push(`l=${visual.loops.length}`);
    }

    if (triggerLabels.length > 0) {
        parts.push(`t=${triggerLabels.join(";")}`);
    }

    return parts.join(" | ");
}

function collectVisualCommandLabels(visual: PreparedStoryboardVisual): string[] {
    const commands = new Set<string>();

    for (const event of visual.events) {
        commands.add(event.type);
    }

    for (const loop of visual.loops) {
        commands.add("L");
        for (const event of loop.events) {
            commands.add(event.type);
        }
    }

    for (const trigger of visual.triggers) {
        commands.add("T");
        for (const event of trigger.events) {
            commands.add(event.type);
        }
    }

    return ["M", "MX", "MY", "S", "V", "R", "F", "C", "P", "L", "T"].filter((command) => commands.has(command));
}

function collectVisualEffectLabels(visual: PreparedStoryboardVisual): string[] {
    const effects = new Set<string>();

    if (visual.flipHRange.length > 0) {
        effects.add(formatParameterLabel(ParameterType.FlipH));
    }

    if (visual.flipVRange.length > 0) {
        effects.add(formatParameterLabel(ParameterType.FlipV));
    }

    if (visual.additiveRange.length > 0) {
        effects.add(formatParameterLabel(ParameterType.Additive));
    }

    for (const event of visual.events) {
        if (event.type === EventType.P) {
            effects.add(formatParameterLabel(event.startValue));
        }
    }

    for (const loop of visual.loops) {
        for (const event of loop.events) {
            if (event.type === EventType.P) {
                effects.add(formatParameterLabel(event.startValue));
            }
        }
    }

    for (const trigger of visual.triggers) {
        for (const event of trigger.events) {
            if (event.type === EventType.P) {
                effects.add(formatParameterLabel(event.startValue));
            }
        }
    }

    return Array.from(effects);
}

function formatParameterLabel(value: number | number[] | ParameterType): string {
    if (value === ParameterType.FlipH) {
        return "H";
    }

    if (value === ParameterType.FlipV) {
        return "V";
    }

    if (value === ParameterType.Additive) {
        return "A";
    }

    return String(value);
}

function getLayerLabel(layer: number): string {
    switch (layer) {
        case Layer.Background:
            return "BG";
        case Layer.Fail:
            return "F";
        case Layer.Pass:
            return "P";
        case Layer.Foreground:
            return "FG";
        case Layer.Overlay:
            return "OV";
        default:
            return String(layer);
    }
}

function getKindLabel(kind: PreparedStoryboardVisual["kind"]): string {
    return kind === "animation" ? "anim" : "spr";
}

export { createVisualInspectorLabel };
