import { Easing } from "../types/storyboard";

const reverse = (fn: (value: number) => number, value: number): number => 1 - fn(1 - value);
const toInOut = (fn: (value: number) => number, value: number): number =>
    0.5 * (value < 0.5 ? fn(2 * value) : 2 - fn(2 - 2 * value));

const quad = (v: number) => v * v;
const cubic = (v: number) => v * v * v;
const quart = (v: number) => v ** 4;
const quint = (v: number) => v ** 5;
const sine = (v: number) => 1 - Math.cos((v * Math.PI) / 2);
const expo = (v: number) => (v === 0 ? 0 : 2 ** (10 * (v - 1)));
const circ = (v: number) => 1 - Math.sqrt(1 - v * v);
const back = (v: number) => v * v * ((1.70158 + 1) * v - 1.70158);
const backInOut = (v: number) => v * v * ((1.70158 * 1.525 + 1) * v - 1.70158 * 1.525);

export function applyEasing(easing: Easing, progress: number): number {
    const t = Math.max(0, Math.min(1, progress));

    switch (easing) {
        case Easing.Step:
            return t >= 1 ? 1 : 0;
        case Easing.None:
            return t;

        case Easing.In:
        case Easing.InQuad:
            return quad(t);
        case Easing.Out:
        case Easing.OutQuad:
            return reverse(quad, t);
        case Easing.InOutQuad:
            return toInOut(quad, t);

        case Easing.InCubic:
            return cubic(t);
        case Easing.OutCubic:
            return reverse(cubic, t);
        case Easing.InOutCubic:
            return toInOut(cubic, t);

        case Easing.InQuart:
            return quart(t);
        case Easing.OutQuart:
            return reverse(quart, t);
        case Easing.InOutQuart:
            return toInOut(quart, t);

        case Easing.InQuint:
            return quint(t);
        case Easing.OutQuint:
            return reverse(quint, t);
        case Easing.InOutQuint:
            return toInOut(quint, t);

        case Easing.InSine:
            return sine(t);
        case Easing.OutSine:
            return reverse(sine, t);
        case Easing.InOutSine:
            return toInOut(sine, t);

        case Easing.InExpo:
            return expo(t);
        case Easing.OutExpo:
            return reverse(expo, t);
        case Easing.InOutExpo:
            return toInOut(expo, t);

        case Easing.InCirc:
            return circ(t);
        case Easing.OutCirc:
            return reverse(circ, t);
        case Easing.InOutCirc:
            return toInOut(circ, t);

        case Easing.InBack:
            return back(t);
        case Easing.OutBack:
            return reverse(back, t);
        case Easing.InOutBack:
            return toInOut(backInOut, t);

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
    if (progress < 1 / 2.75) return 7.5625 * progress * progress;
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
    if (progress === 0 || progress === 1) return progress;
    return 2 ** (-10 * progress) * Math.sin(((factor * progress - 0.075) * (2 * Math.PI)) / 0.3) + 1;
}
