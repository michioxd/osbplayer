import type { Keyframe, ParameterRange } from "../types/storyboard";
import { Easing } from "../types/storyboard";
import { clamp } from "../utils/dom";
import { applyEasing } from "./easing";

export function keyframeValueAt<T>(
    keyframes: Keyframe<T>[],
    time: number,
    defaultValue: T,
    indices?: Int32Array,
    indexOffset: number = 0,
): T {
    if (keyframes.length === 0) return defaultValue;

    let nextIndex = 0;

    if (indices) {
        let idx = indices[indexOffset];
        const len = keyframes.length;
        while (idx < len && keyframes[idx].time <= time) idx++;
        while (idx > 0 && keyframes[idx - 1].time > time) idx--;
        indices[indexOffset] = idx;
        nextIndex = idx;
    } else nextIndex = findFirstKeyframeAfter(keyframes, time);

    const startKeyframe = nextIndex <= 0 ? keyframes[Math.max(0, nextIndex)] : keyframes[nextIndex - 1];
    const endKeyframe = nextIndex >= keyframes.length ? undefined : keyframes[nextIndex];

    if (!startKeyframe) return defaultValue;
    if (!endKeyframe || startKeyframe.easing === Easing.Step) return startKeyframe.value;

    const duration = Math.max(endKeyframe.time, endKeyframe.interpolationOffset) - startKeyframe.interpolationOffset;
    if (duration <= 0) return startKeyframe.value;

    const progress = clamp((time - startKeyframe.interpolationOffset) / duration, 0, 1);
    const easedProgress = applyEasing(startKeyframe.easing, progress);

    return interpolateLinear(startKeyframe.value, endKeyframe.value, easedProgress);
}

export function isTimeInRanges(ranges: ParameterRange[], time: number): boolean {
    for (let i = 0; i < ranges.length; i++) {
        if (time >= ranges[i].startTime && time <= ranges[i].endTime) {
            return true;
        }
    }
    return false;
}

export function keyframePairValueAt<T>(
    keyframes: [Keyframe<T>[], Keyframe<T>[]],
    time: number,
    defaultValue: [T, T],
): [T, T] {
    return [keyframeValueAt(keyframes[0], time, defaultValue[0]), keyframeValueAt(keyframes[1], time, defaultValue[1])];
}

export function packRgb(rgb: number[]): number {
    const r = Math.max(0, Math.min(255, Math.round(rgb[0])));
    const g = Math.max(0, Math.min(255, Math.round(rgb[1])));
    const b = Math.max(0, Math.min(255, Math.round(rgb[2])));
    return (r << 16) + (g << 8) + b;
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
        if (start.length === 3) {
            return [
                start[0] + ((end[0] ?? start[0]) - start[0]) * progress,
                start[1] + ((end[1] ?? start[1]) - start[1]) * progress,
                start[2] + ((end[2] ?? start[2]) - start[2]) * progress,
            ] as unknown as T;
        }

        const result = new Array(start.length);
        for (let i = 0; i < start.length; i++) {
            result[i] = start[i] + ((end[i] ?? start[i]) - start[i]) * progress;
        }
        return result as unknown as T;
    }

    return start;
}
