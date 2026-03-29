import type { Keyframe, ParameterRange } from "../types/storyboard";
import { Easing } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { applyEasing } from "./easing";

export function keyframeValueAt<T>(keyframes: Keyframe<T>[], time: number, defaultValue: T): T {
    if (keyframes.length === 0) {
        return defaultValue;
    }

    const nextIndex = findFirstKeyframeAfter(keyframes, time);
    const startKeyframe = nextIndex <= 0 ? keyframes[Math.max(0, nextIndex)] : keyframes[nextIndex - 1];
    const endKeyframe = nextIndex >= keyframes.length ? undefined : keyframes[nextIndex];

    if (!startKeyframe) {
        return defaultValue;
    }

    if (!endKeyframe || startKeyframe.easing === Easing.Step) {
        return startKeyframe.value;
    }

    const duration = Math.max(endKeyframe.time, endKeyframe.interpolationOffset) - startKeyframe.interpolationOffset;
    if (duration <= 0) {
        return startKeyframe.value;
    }

    const progress = clamp((time - startKeyframe.interpolationOffset) / duration, 0, 1);
    const easedProgress = applyEasing(startKeyframe.easing, progress);

    return interpolateLinear(startKeyframe.value, endKeyframe.value, easedProgress);
}

export function keyframePairValueAt<T>(
    keyframes: [Keyframe<T>[], Keyframe<T>[]],
    time: number,
    defaultValue: [T, T],
): [T, T] {
    return [keyframeValueAt(keyframes[0], time, defaultValue[0]), keyframeValueAt(keyframes[1], time, defaultValue[1])];
}

export function isTimeInRanges(ranges: ParameterRange[], time: number): boolean {
    return ranges.some((range) => time >= range.startTime && time <= range.endTime);
}

export function packRgb(rgb: number[]): number {
    const [red, green, blue] = rgb.map((value) => Math.round(clamp(value, 0, 255)));
    return (red << 16) + (green << 8) + blue;
}

function findFirstKeyframeAfter<T>(keyframes: Keyframe<T>[], time: number): number {
    let low = 0;
    let high = keyframes.length;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (keyframes[middle].time <= time) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}

function interpolateLinear<T>(start: T, end: T, progress: number): T {
    if (typeof start === "number" && typeof end === "number") {
        return (start + (end - start) * progress) as T;
    }

    if (Array.isArray(start) && Array.isArray(end)) {
        return start.map((value, index) => value + ((end[index] ?? value) - value) * progress) as T;
    }

    return start;
}
