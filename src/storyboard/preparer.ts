import {
    Easing,
    EventType,
    ParameterType,
    type Keyframe,
    type ParameterRange,
    type PreparedStoryboardAnimation,
    type PreparedStoryboardData,
    type PreparedStoryboardVisual,
    type StoryboardData,
    type StoryboardEvent,
    type StoryboardLoop,
    type StoryboardVisual,
} from "../types/storyboard";
import { buildAnimationFramePath } from "../utils/path";

export function prepareStoryboard(storyboard: StoryboardData): PreparedStoryboardData {
    const visuals = storyboard.visuals
        .map((visual) => prepareVisual(visual))
        .sort((left, right) => left.layer - right.layer);

    const visualDuration = visuals.reduce((max, visual) => {
        return Number.isFinite(visual.activeTime[1]) ? Math.max(max, visual.activeTime[1]) : max;
    }, storyboard.duration);

    return {
        ...storyboard,
        duration: Math.max(storyboard.duration, visualDuration),
        visuals,
    };
}

function prepareVisual(visual: StoryboardVisual): PreparedStoryboardVisual {
    const loops = visual.loops.map((loop) => expandLoop(loop));
    const triggers = visual.triggers.map((trigger) => ({ ...trigger, activated: false, loopLength: 0 }));

    const expandedEvents = [...visual.events, ...loops.flatMap((loop) => loop.events)].sort(
        (left, right) => left.startTime - right.startTime || left.endTime - right.endTime,
    );

    const activeTime = calculateActiveTime(expandedEvents);
    const positionKeyframes: [Keyframe<number>[], Keyframe<number>[]] = [[], []];
    const rotationKeyframes: Keyframe<number>[] = [];
    const uniformScaleKeyframes: Keyframe<number>[] = [];
    const vectorScaleKeyframes: [Keyframe<number>[], Keyframe<number>[]] = [[], []];
    const colourKeyframes: Keyframe<number[]>[] = [];
    const opacityKeyframes: Keyframe<number>[] = [];
    const flipHRange: ParameterRange[] = [];
    const flipVRange: ParameterRange[] = [];
    const additiveRange: ParameterRange[] = [];

    generatePositionKeyframes(positionKeyframes, expandedEvents, [visual.x, visual.y]);
    generateRotationKeyframes(rotationKeyframes, expandedEvents);
    generateUniformScaleKeyframes(uniformScaleKeyframes, expandedEvents);
    generateVectorScaleKeyframes(vectorScaleKeyframes, expandedEvents);
    generateColourKeyframes(colourKeyframes, expandedEvents);
    generateOpacityKeyframes(opacityKeyframes, expandedEvents, activeTime);
    generateParameterRanges(expandedEvents, activeTime, flipHRange, flipVRange, additiveRange);

    if (visual.kind === "animation") {
        const framePaths = Array.from({ length: Math.max(1, visual.frameCount) }, (_, index) =>
            buildAnimationFramePath(visual.filePath, index),
        );

        const prepared: PreparedStoryboardAnimation = {
            ...visual,
            loops,
            triggers,
            activeTime,
            expandedEvents,
            positionKeyframes,
            rotationKeyframes,
            uniformScaleKeyframes,
            vectorScaleKeyframes,
            colourKeyframes,
            opacityKeyframes,
            flipHRange,
            flipVRange,
            additiveRange,
            framePaths,
        };

        return prepared;
    }

    return {
        ...visual,
        loops,
        triggers,
        activeTime,
        expandedEvents,
        positionKeyframes,
        rotationKeyframes,
        uniformScaleKeyframes,
        vectorScaleKeyframes,
        colourKeyframes,
        opacityKeyframes,
        flipHRange,
        flipVRange,
        additiveRange,
    };
}

function expandLoop(loop: StoryboardLoop): StoryboardLoop {
    const expandedEvents: StoryboardEvent[] = [];
    const iterations = Math.max(1, loop.loopCount);
    const loopLength = loop.events.reduce((max, event) => Math.max(max, event.endTime), 0);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const offset = loop.startTime + loopLength * iteration;
        for (const event of loop.events) {
            expandedEvents.push({
                ...event,
                startTime: offset + event.startTime,
                endTime: offset + event.endTime,
            });
        }
    }

    return {
        ...loop,
        loopLength,
        endTime: loop.startTime + loopLength * iterations,
        events: expandedEvents,
    };
}

function calculateActiveTime(events: StoryboardEvent[]): [number, number] {
    if (events.length === 0) {
        return [0, Number.POSITIVE_INFINITY];
    }

    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;

    for (const event of events) {
        start = Math.min(start, event.startTime);
        end = Math.max(end, event.endTime);
    }

    return [start, end];
}

function generatePositionKeyframes(
    target: [Keyframe<number>[], Keyframe<number>[]],
    events: StoryboardEvent[],
    defaultPosition: [number, number],
): void {
    const eventsX = events.filter((event) => event.type === EventType.M || event.type === EventType.MX);
    const eventsY = events.filter((event) => event.type === EventType.M || event.type === EventType.MY);

    if (eventsX.length === 0) {
        target[0].push(createStaticKeyframe(0, defaultPosition[0]));
    } else {
        for (const event of eventsX) {
            const startValue =
                event.type === EventType.M && Array.isArray(event.startValue)
                    ? event.startValue[0]
                    : Number(event.startValue);

            const endValue =
                event.type === EventType.M && Array.isArray(event.endValue)
                    ? event.endValue[0]
                    : Number(event.endValue);

            target[0].push({
                time: event.startTime,
                value: startValue,
                easing: event.easing,
                interpolationOffset: event.startTime,
            });
            target[0].push({
                time: event.endTime,
                value: endValue,
                easing: Easing.Step,
                interpolationOffset: event.startTime,
            });
        }
        sortAndSquash(target[0]);
    }

    if (eventsY.length === 0) {
        target[1].push(createStaticKeyframe(0, defaultPosition[1]));
    } else {
        for (const event of eventsY) {
            const startValue =
                event.type === EventType.M && Array.isArray(event.startValue)
                    ? event.startValue[1]
                    : Number(event.startValue);

            const endValue =
                event.type === EventType.M && Array.isArray(event.endValue)
                    ? event.endValue[1]
                    : Number(event.endValue);

            target[1].push({
                time: event.startTime,
                value: startValue,
                easing: event.easing,
                interpolationOffset: event.startTime,
            });
            target[1].push({
                time: event.endTime,
                value: endValue,
                easing: Easing.Step,
                interpolationOffset: event.startTime,
            });
        }
        sortAndSquash(target[1]);
    }
}

function generateRotationKeyframes(target: Keyframe<number>[], events: StoryboardEvent[]): void {
    addKeyframesForSimpleEvents(
        target,
        events.filter((event) => event.type === EventType.R),
        0,
    );
}

function generateUniformScaleKeyframes(target: Keyframe<number>[], events: StoryboardEvent[]): void {
    addKeyframesForSimpleEvents(
        target,
        events.filter((event) => event.type === EventType.S),
        1,
    );
}

function generateVectorScaleKeyframes(
    target: [Keyframe<number>[], Keyframe<number>[]],
    events: StoryboardEvent[],
): void {
    const filtered = events.filter((event) => event.type === EventType.V);

    if (filtered.length === 0) {
        target[0].push(createStaticKeyframe(0, 1));
        target[1].push(createStaticKeyframe(0, 1));
        return;
    }

    addKeyframesForEvents(
        target,
        filtered,
        (event, isX) => (Array.isArray(event.startValue) ? event.startValue[isX ? 0 : 1] : 1),
        (event, isX) => (Array.isArray(event.endValue) ? event.endValue[isX ? 0 : 1] : 1),
    );
}

function generateColourKeyframes(target: Keyframe<number[]>[], events: StoryboardEvent[]): void {
    const filtered = events.filter((event) => event.type === EventType.C);
    if (filtered.length === 0) {
        target.push(createStaticKeyframe(0, [255, 255, 255]));
        return;
    }

    for (const event of filtered) {
        target.push({
            time: event.startTime,
            value: (event.startValue as number[]) ?? [255, 255, 255],
            easing: event.easing,
            interpolationOffset: event.startTime,
        });
        target.push({
            time: event.endTime,
            value: (event.endValue as number[]) ?? [255, 255, 255],
            easing: Easing.Step,
            interpolationOffset: event.startTime,
        });
    }

    sortAndSquash(target);
}

function generateOpacityKeyframes(
    target: Keyframe<number>[],
    events: StoryboardEvent[],
    activeTime: [number, number],
): void {
    const filtered = events.filter((event) => event.type === EventType.F);
    if (filtered.length === 0) {
        target.push(createStaticKeyframe(0, 1));
        return;
    }

    addKeyframesForSimpleEvents(target, filtered, 1);

    if (Number.isFinite(activeTime[1])) {
        target.push({
            time: activeTime[1] + 1,
            value: 0,
            easing: Easing.Step,
            interpolationOffset: activeTime[1] + 1,
        });
    }

    sortAndSquash(target);
}

function generateParameterRanges(
    events: StoryboardEvent[],
    activeTime: [number, number],
    flipHRange: ParameterRange[],
    flipVRange: ParameterRange[],
    additiveRange: ParameterRange[],
): void {
    for (const event of events) {
        if (event.type !== EventType.P) {
            continue;
        }

        const range = {
            startTime: event.startTime,
            endTime: event.startTime === event.endTime ? activeTime[1] : event.endTime,
        };

        switch (event.startValue) {
            case ParameterType.FlipH:
                flipHRange.push(range);
                break;
            case ParameterType.FlipV:
                flipVRange.push(range);
                break;
            case ParameterType.Additive:
                additiveRange.push(range);
                break;
            default:
                break;
        }
    }
}

function addKeyframesForSimpleEvents(
    target: Keyframe<number>[],
    events: StoryboardEvent[],
    defaultValue: number,
): void {
    if (events.length === 0) {
        target.push(createStaticKeyframe(0, defaultValue));
        return;
    }

    for (const event of events) {
        target.push({
            time: event.startTime,
            value: Number(event.startValue),
            easing: event.easing,
            interpolationOffset: event.startTime,
        });
        target.push({
            time: event.endTime,
            value: Number(event.endValue),
            easing: Easing.Step,
            interpolationOffset: event.startTime,
        });
    }

    sortAndSquash(target);
}

function addKeyframesForEvents(
    target: [Keyframe<number>[], Keyframe<number>[]],
    events: StoryboardEvent[],
    getStart: (event: StoryboardEvent, isX: boolean) => number,
    getEnd: (event: StoryboardEvent, isX: boolean) => number,
): void {
    for (const event of events) {
        target[0].push({
            time: event.startTime,
            value: getStart(event, true),
            easing: event.easing,
            interpolationOffset: event.startTime,
        });
        target[0].push({
            time: event.endTime,
            value: getEnd(event, true),
            easing: Easing.Step,
            interpolationOffset: event.startTime,
        });

        target[1].push({
            time: event.startTime,
            value: getStart(event, false),
            easing: event.easing,
            interpolationOffset: event.startTime,
        });
        target[1].push({
            time: event.endTime,
            value: getEnd(event, false),
            easing: Easing.Step,
            interpolationOffset: event.startTime,
        });
    }

    sortAndSquash(target[0]);
    sortAndSquash(target[1]);
}

function createStaticKeyframe<T>(time: number, value: T): Keyframe<T> {
    return {
        time,
        value,
        easing: Easing.Step,
        interpolationOffset: time,
    };
}

function sortAndSquash<T>(keyframes: Keyframe<T>[]): void {
    keyframes.sort((left, right) => left.time - right.time || left.interpolationOffset - right.interpolationOffset);

    for (let index = keyframes.length - 2; index >= 0; index -= 1) {
        if (
            keyframes[index].time === keyframes[index + 1].time &&
            JSON.stringify(keyframes[index].value) === JSON.stringify(keyframes[index + 1].value)
        ) {
            keyframes.splice(index, 1);
        }
    }
}
