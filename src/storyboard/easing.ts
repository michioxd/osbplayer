import { Easing } from "../types/storyboard";

export function applyEasing(easing: Easing, progress: number): number {
    const t = Math.max(0, Math.min(1, progress));
    const pi = Math.PI;
    const reverse = (fn: (value: number) => number, value: number): number => 1 - fn(1 - value);
    const toInOut = (fn: (value: number) => number, value: number): number =>
        0.5 * (value < 0.5 ? fn(2 * value) : 2 - fn(2 - 2 * value));

    switch (easing) {
        case Easing.Step:
            return t >= 1 ? 1 : 0;
        case Easing.None:
            return t;
        case Easing.Out:
        case Easing.OutQuad:
            return reverse((value) => value * value, t);
        case Easing.In:
        case Easing.InQuad:
            return t * t;
        case Easing.InOutQuad:
            return toInOut((value) => value * value, t);
        case Easing.InCubic:
            return t * t * t;
        case Easing.OutCubic:
            return reverse((value) => value * value * value, t);
        case Easing.InOutCubic:
            return toInOut((value) => value * value * value, t);
        case Easing.InQuart:
            return t ** 4;
        case Easing.OutQuart:
            return reverse((value) => value ** 4, t);
        case Easing.InOutQuart:
            return toInOut((value) => value ** 4, t);
        case Easing.InQuint:
            return t ** 5;
        case Easing.OutQuint:
            return reverse((value) => value ** 5, t);
        case Easing.InOutQuint:
            return toInOut((value) => value ** 5, t);
        case Easing.InSine:
            return 1 - Math.cos((t * pi) / 2);
        case Easing.OutSine:
            return reverse((value) => 1 - Math.cos((value * pi) / 2), t);
        case Easing.InOutSine:
            return toInOut((value) => 1 - Math.cos((value * pi) / 2), t);
        case Easing.InExpo:
            return t === 0 ? 0 : 2 ** (10 * (t - 1));
        case Easing.OutExpo:
            return reverse((value) => (value === 0 ? 0 : 2 ** (10 * (value - 1))), t);
        case Easing.InOutExpo:
            return toInOut((value) => (value === 0 ? 0 : 2 ** (10 * (value - 1))), t);
        case Easing.InCirc:
            return 1 - Math.sqrt(1 - t * t);
        case Easing.OutCirc:
            return reverse((value) => 1 - Math.sqrt(1 - value * value), t);
        case Easing.InOutCirc:
            return toInOut((value) => 1 - Math.sqrt(1 - value * value), t);
        case Easing.InBack:
            return t * t * ((1.70158 + 1) * t - 1.70158);
        case Easing.OutBack:
            return reverse((value) => value * value * ((1.70158 + 1) * value - 1.70158), t);
        case Easing.InOutBack:
            return toInOut((value) => value * value * ((1.70158 * 1.525 + 1) * value - 1.70158 * 1.525), t);
        case Easing.OutBounce:
            return bounceOut(t);
        case Easing.InBounce:
            return reverse(bounceOut, t);
        case Easing.InOutBounce:
            return toInOut((value) => reverse(bounceOut, value), t);
        case Easing.OutElastic:
            return elasticOut(t, 1);
        case Easing.OutElasticHalf:
            return elasticOut(t, 0.5);
        case Easing.OutElasticQuarter:
            return elasticOut(t, 0.25);
        case Easing.InElastic:
            return reverse((value) => elasticOut(value, 1), t);
        case Easing.InOutElastic:
            return toInOut((value) => reverse((inner) => elasticOut(inner, 1), value), t);
        default:
            return t;
    }
}

function bounceOut(progress: number): number {
    if (progress < 1 / 2.75) {
        return 7.5625 * progress * progress;
    }

    if (progress < 2 / 2.75) {
        const value = progress - 1.5 / 2.75;
        return 7.5625 * value * value + 0.75;
    }

    if (progress < 2.5 / 2.75) {
        const value = progress - 2.25 / 2.75;
        return 7.5625 * value * value + 0.9375;
    }

    const value = progress - 2.625 / 2.75;
    return 7.5625 * value * value + 0.984375;
}

function elasticOut(progress: number, factor: number): number {
    if (progress === 0 || progress === 1) {
        return progress;
    }

    return 2 ** (-10 * progress) * Math.sin(((factor * progress - 0.075) * (2 * Math.PI)) / 0.3) + 1;
}
