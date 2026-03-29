export const Layer = {
    Background: 0,
    Fail: 1,
    Pass: 2,
    Foreground: 3,
    Overlay: 4,
} as const;

export type Layer = (typeof Layer)[keyof typeof Layer];

export const Origin = {
    TopLeft: 0,
    TopCentre: 1,
    TopRight: 2,
    CentreLeft: 3,
    Centre: 4,
    CentreRight: 5,
    BottomLeft: 6,
    BottomCentre: 7,
    BottomRight: 8,
} as const;

export type Origin = (typeof Origin)[keyof typeof Origin];

export const EventType = {
    F: "F",
    S: "S",
    V: "V",
    R: "R",
    M: "M",
    MX: "MX",
    MY: "MY",
    C: "C",
    P: "P",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const Easing = {
    None: 0,
    Out: 1,
    In: 2,
    InQuad: 3,
    OutQuad: 4,
    InOutQuad: 5,
    InCubic: 6,
    OutCubic: 7,
    InOutCubic: 8,
    InQuart: 9,
    OutQuart: 10,
    InOutQuart: 11,
    InQuint: 12,
    OutQuint: 13,
    InOutQuint: 14,
    InSine: 15,
    OutSine: 16,
    InOutSine: 17,
    InExpo: 18,
    OutExpo: 19,
    InOutExpo: 20,
    InCirc: 21,
    OutCirc: 22,
    InOutCirc: 23,
    InElastic: 24,
    OutElastic: 25,
    OutElasticHalf: 26,
    OutElasticQuarter: 27,
    InOutElastic: 28,
    InBack: 29,
    OutBack: 30,
    InOutBack: 31,
    InBounce: 32,
    OutBounce: 33,
    InOutBounce: 34,
    Step: 35,
} as const;

export type Easing = (typeof Easing)[keyof typeof Easing];

export const ParameterType = {
    FlipH: "H",
    FlipV: "V",
    Additive: "A",
} as const;

export type ParameterType = (typeof ParameterType)[keyof typeof ParameterType];

export const LayerStrings: Record<string, Layer> = {
    Background: Layer.Background,
    Fail: Layer.Fail,
    Pass: Layer.Pass,
    Foreground: Layer.Foreground,
    Overlay: Layer.Overlay,
};

export const OriginStrings: Record<string, Origin> = {
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

export const EventTypeStrings: Record<string, EventType> = {
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

export type AnimationLoopType = "LoopForever" | "LoopOnce";

export interface StoryboardEvent {
    type: EventType;
    easing: Easing;
    startTime: number;
    endTime: number;
    startValue: number | number[] | ParameterType;
    endValue: number | number[] | ParameterType;
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

interface StoryboardVisualBase {
    layer: Layer;
    origin: Origin;
    filePath: string;
    x: number;
    y: number;
    events: StoryboardEvent[];
    loops: StoryboardLoop[];
    triggers: StoryboardTrigger[];
}

export interface StoryboardSprite extends StoryboardVisualBase {
    kind: "sprite";
}

export interface StoryboardAnimation extends StoryboardVisualBase {
    kind: "animation";
    frameCount: number;
    frameDelay: number;
    loopType: AnimationLoopType;
}

export type StoryboardVisual = StoryboardSprite | StoryboardAnimation;

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
    visuals: StoryboardVisual[];
    samples: StoryboardSample[];
    audioFilename: string;
    widescreenStoryboard: boolean;
    background?: StoryboardBackground;
    video?: StoryboardVideo;
    duration: number;
    audioLeadIn: number;
    mapTitle: string;
    mapArtist: string;
    mapper: string;
    diffName: string;
}

export interface DifficultyEntry {
    id: string;
    name: string;
    mapper: string;
    filePath: string;
    fileData: string;
    title: string;
    artist: string;
}

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

interface PreparedVisualBase extends StoryboardVisualBase {
    activeTime: [number, number];
    expandedEvents: StoryboardEvent[];
    positionKeyframes: [Keyframe<number>[], Keyframe<number>[]];
    rotationKeyframes: Keyframe<number>[];
    uniformScaleKeyframes: Keyframe<number>[];
    vectorScaleKeyframes: [Keyframe<number>[], Keyframe<number>[]];
    colourKeyframes: Keyframe<number[]>[];
    opacityKeyframes: Keyframe<number>[];
    flipHRange: ParameterRange[];
    flipVRange: ParameterRange[];
    additiveRange: ParameterRange[];
}

export interface PreparedStoryboardSprite extends PreparedVisualBase {
    kind: "sprite";
}

export interface PreparedStoryboardAnimation extends PreparedVisualBase {
    kind: "animation";
    frameCount: number;
    frameDelay: number;
    loopType: AnimationLoopType;
    framePaths: string[];
}

export type PreparedStoryboardVisual = PreparedStoryboardSprite | PreparedStoryboardAnimation;

export interface PreparedStoryboardData extends Omit<StoryboardData, "visuals"> {
    visuals: PreparedStoryboardVisual[];
}

export interface AssetLoadProgress {
    loaded: number;
    total: number;
    percent: number;
    currentFile: string;
}
