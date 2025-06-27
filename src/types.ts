export enum Layer {
    Background = 0,
    Fail = 1,
    Pass = 2,
    Foreground = 3,
    Overlay = 4,
}

export enum Origin {
    TopLeft = 0,
    TopCentre = 1,
    TopRight = 2,
    CentreLeft = 3,
    Centre = 4,
    CentreRight = 5,
    BottomLeft = 6,
    BottomCentre = 7,
    BottomRight = 8,
}

export enum EventType {
    F = "F",
    S = "S",
    V = "V",
    R = "R",
    M = "M",
    MX = "MX",
    MY = "MY",
    C = "C",
    P = "P",
}

export enum Easing {
    None = 0,
    Out = 1,
    In = 2,
    InQuad = 3,
    OutQuad = 4,
    InOutQuad = 5,
    InCubic = 6,
    OutCubic = 7,
    InOutCubic = 8,
    InQuart = 9,
    OutQuart = 10,
    InOutQuart = 11,
    InQuint = 12,
    OutQuint = 13,
    InOutQuint = 14,
    InSine = 15,
    OutSine = 16,
    InOutSine = 17,
    InExpo = 18,
    OutExpo = 19,
    InOutExpo = 20,
    InCirc = 21,
    OutCirc = 22,
    InOutCirc = 23,
    InElastic = 24,
    OutElastic = 25,
    OutElasticHalf = 26,
    OutElasticQuarter = 27,
    InOutElastic = 28,
    InBack = 29,
    OutBack = 30,
    InOutBack = 31,
    InBounce = 32,
    OutBounce = 33,
    InOutBounce = 34,
    Step = 35,
}

export enum ParameterType {
    FlipH = "H",
    FlipV = "V",
    Additive = "A",
}

export const LayerStrings: { [key: string]: Layer } = {
    Background: Layer.Background,
    Fail: Layer.Fail,
    Pass: Layer.Pass,
    Foreground: Layer.Foreground,
    Overlay: Layer.Overlay,
};

export const OriginStrings: { [key: string]: Origin } = {
    TopLeft: Origin.TopLeft,
    TopCentre: Origin.TopCentre,
    TopRight: Origin.TopRight,
    CentreLeft: Origin.CentreLeft,
    Centre: Origin.Centre,
    CentreRight: Origin.CentreRight,
    BottomLeft: Origin.BottomLeft,
    BottomCentre: Origin.BottomCentre,
    BottomRight: Origin.BottomRight,
};

export const EventTypeStrings: { [key: string]: EventType } = {
    F: EventType.F,
    S: EventType.S,
    V: EventType.V,
    R: EventType.R,
    M: EventType.M,
    MX: EventType.MX,
    MY: EventType.MY,
    C: EventType.C,
    P: EventType.P,
};

export interface Keyframe<T> {
    time: number;
    value: T;
    easing: Easing;
    interpolationOffset: number;
}

export interface ParameterRange {
    startTime: number;
    endTime: number;
}

export interface StoryboardEvent {
    type: EventType;
    easing: Easing;
    startTime: number;
    endTime: number;
    startValue: number | number[] | ParameterType;
    endValue: number | number[] | ParameterType;
}

export interface StoryboardSprite {
    layer: Layer;
    origin: Origin;
    filePath: string;
    x: number;
    y: number;
    events: StoryboardEvent[];
    loops: StoryboardLoop[];
    triggers: StoryboardTrigger[];

    positionKeyframes: [Keyframe<number>[], Keyframe<number>[]];
    rotationKeyframes: Keyframe<number>[];
    scaleKeyframes: [Keyframe<number>[], Keyframe<number>[]];
    colourKeyframes: Keyframe<number[]>[];
    opacityKeyframes: Keyframe<number>[];
    flipHRange: ParameterRange[];
    flipVRange: ParameterRange[];
    additiveRange: ParameterRange[];

    activeTime: [number, number];
    visibleTime: [number, number];

    expandedEvents: StoryboardEvent[];
}

export interface StoryboardLoop {
    startTime: number;
    loopCount: number;
    events: StoryboardEvent[];
    loopLength: number;
    endTime: number;
}

export interface StoryboardTrigger {
    triggerName: string;
    startTime: number;
    endTime: number;
    groupNumber: number;
    events: StoryboardEvent[];
    activated: boolean;
    loopLength: number;
}

export interface StoryboardBackground {
    path: string;
    x: number;
    y: number;
}

export interface StoryboardVideo {
    startTime: number;
    path: string;
    x: number;
    y: number;
}

export interface StoryboardSample {
    startTime: number;
    layer: Layer;
    path: string;
    volume: number;
}

export interface StoryboardData {
    sprites: StoryboardSprite[];
    samples: StoryboardSample[];
    audioFilename: string;
    background?: StoryboardBackground;
    video?: StoryboardVideo;
    duration: number;
    audioLeadIn: number;
    mapTitle: string;
    mapArtist: string;
    mapper: string;
    diffName: string;
}

export interface Difficulty {
    name: string;
    mapper: string;
    filePath: string;
    fileData: string;
}