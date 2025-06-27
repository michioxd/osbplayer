import { Application, Assets, Sprite, Texture, VERSION as PIXI_VERSION } from "pixi.js";
import { Howl } from "howler";
import { ZipReader, BlobReader, TextWriter, BlobWriter } from "@zip.js/zip.js";
import { type StoryboardData, type Difficulty, type StoryboardSprite, type StoryboardLoop, type StoryboardTrigger, type StoryboardEvent, type Keyframe, type ParameterRange, EventType, ParameterType, type StoryboardSample, type StoryboardBackground, type StoryboardVideo, EventTypeStrings } from "./types";
import { Easing, Layer, Origin, LayerStrings, OriginStrings } from "./types";
import lg from "./log";

class OsuStoryboardPlayer {
    private app: Application;
    private width = 1920;
    private height = 1080;
    private frameScale: number;
    private xOffset: number = 0;
    private audio: Howl | null = null;
    private storyboard: StoryboardData | null = null;
    private isPlaying = false;
    private currentTime = 0;
    private duration = 0;
    private animationId: number | null = null;
    private spriteObjects: Map<string, Sprite> = new Map();
    private loadedAssets: Set<string> = new Set();
    private totalAssets = 0;
    private loadingAssets = 0;

    // private mapTitle: string = "";
    // private mapArtist: string = "";
    private diffs: Record<string, Difficulty> = {};
    private zip: ZipReader<any> | null = null;
    private osbFile: string = "";
    private assets: { [key: string]: Blob } = {};

    constructor() {
        this.app = new Application();
        // @ts-ignore for debugging
        globalThis.__PIXI_APP__ = this.app;
        this.frameScale = this.height / 480.0;
        this.xOffset = (this.width - (this.height / 3.0) * 4) * 0.5;
        this.initializeApp();
        this.setupEventListeners();
    }

    private async initializeApp() {
        await this.app.init({
            width: this.width,
            height: this.height,
            backgroundColor: 0x000000,
            antialias: true,
            hello: true
        });

        lg.log(`Pixi.js v${PIXI_VERSION}`);

        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        if (canvas) {
            canvas.parentNode?.replaceChild(this.app.canvas, canvas);
            this.app.canvas.id = "canvas";
        }
    }

    private setupEventListeners() {
        const fileInput = document.getElementById("fileInput") as HTMLInputElement;
        const playButton = document.getElementById(
            "playButton"
        ) as HTMLButtonElement;
        const seekBar = document.getElementById("seekBar") as HTMLDivElement;
        const difficultySelect = document.getElementById(
            "difficultySelect"
        ) as HTMLSelectElement;
        // const seekBarHandle = document.getElementById('seekBarHandle') as HTMLDivElement;

        fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
        playButton.addEventListener("click", () => this.togglePlayback());
        difficultySelect.addEventListener("change", (e) => {
            const select = e.target as HTMLSelectElement;
            const diffID = select.value;
            if (diffID) {
                this.selectDiff(diffID);
            }
        });

        let isDragging = false;

        const handleSeek = (e: MouseEvent) => {
            const rect = seekBar.getBoundingClientRect();
            const percentage = Math.max(
                0,
                Math.min(1, (e.clientX - rect.left) / rect.width)
            );
            this.seekTo(percentage * this.duration);
        };

        seekBar.addEventListener("mousedown", (e) => {
            isDragging = true;
            handleSeek(e);
        });

        document.addEventListener("mousemove", (e) => {
            if (isDragging) {
                handleSeek(e);
            }
        });

        document.addEventListener("mouseup", () => {
            isDragging = false;
        });
    }

    private async handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file || !file.name.endsWith(".osz")) {
            alert("Please select a valid .osz file");
            return;
        }

        try {
            this.diffs = {};
            await this.loadOszFile(file);
        } catch (error) {
            lg.error("Error loading OSZ file:", error);
            alert("Error loading OSZ file");
        }
    }

    private async loadOszFile(file: File) {
        this.zip = new ZipReader(new BlobReader(file));
        const zipReader = this.zip;
        const entries = await zipReader.getEntries();

        this.osbFile = "";
        for (const entry of entries) {
            if (entry.filename.endsWith(".osu")) {
                const writer = new TextWriter();
                await entry.getData!(writer);
                const diffData = await writer.getData();

                const parsedDiffData = this.parseOsuFile(diffData);
                const diffID = Math.random(); // may be replaced with a more meaningful ID
                this.diffs[diffID] = {
                    name: parsedDiffData.diffName,
                    filePath: entry.filename,
                    fileData: diffData,
                    mapper: parsedDiffData.mapper,
                };
            } else if (entry.filename.endsWith(".osb")) {
                const writer = new TextWriter();
                await entry.getData!(writer);
                this.osbFile = await writer.getData();
                lg.log(`Extracted .osb file: ${entry.filename}`);
            }
        }

        if (Object.keys(this.diffs).length === 0) {
            throw new Error("No .osu files found in OSZ");
        }

        return this.handleDiffSelectDisplay(this.diffs);
    }

    private async handleDiffSelectDisplay(diffs: Record<string, Difficulty>) {
        const select = document.getElementById(
            "difficultySelect"
        ) as HTMLSelectElement;

        for (const child of select.children) {
            if (child.classList.contains("placeholder")) continue;
            select.removeChild(child);
        }

        for (const diffID in diffs) {
            const diff = diffs[diffID];
            const option = document.createElement("option");
            option.value = diffID;
            option.textContent = `${diff.name}`;
            select.appendChild(option);
        }
    }

    private async selectDiff(diffID: string) {
        if (!this.zip) return;

        let osuFile = this.diffs[diffID]?.fileData || "",
            osbFile = this.osbFile;

        if (this.zip) {
            const entries = await this.zip.getEntries();
            for (const entry of entries) {
                if (
                    entry.filename.match(/\.(png|jpg|jpeg|gif|bmp|webp|mp3|wav|ogg)$/i)
                ) {
                    const writer = new BlobWriter();
                    await entry.getData!(writer);
                    const blob = await writer.getData();
                    this.assets[entry.filename] = blob;
                    lg.log(
                        `Extracted asset: ${entry.filename} (${blob.size} bytes)`
                    );
                }
            }

            this.zip.close();
            this.zip = null;
        }

        osuFile += osbFile;
        osuFile = osuFile.replaceAll(/\r\n/g, "\n");

        if (!osuFile) {
            throw new Error("No .osu file found in OSZ");
        }

        this.audio?.unload();
        this.duration = 0;
        this.currentTime = 0;
        this.isPlaying = false;

        for (let [key, sprite] of this.spriteObjects.entries()) {
            this.app.stage.removeChild(sprite);
            sprite.destroy();
            this.spriteObjects.delete(key);
        }

        this.storyboard = this.parseOsuFile(osuFile);

        await this.loadAssets(this.assets);

        if (
            this.storyboard.audioFilename &&
            this.assets[this.storyboard.audioFilename]
        ) {
            const audioBlob = this.assets[this.storyboard.audioFilename];
            const audioUrl = URL.createObjectURL(audioBlob);
            this.audio = new Howl({
                src: [audioUrl],
                format: ["mp3", "wav", "ogg"],
                onload: () => {
                    const audioDuration = this.audio!.duration() * 1000;
                    this.duration = Math.max(
                        audioDuration,
                        this.storyboard?.duration || 0
                    );
                    this.updateTimeDisplay();
                    lg.log(
                        `Audio loaded: duration=${audioDuration}ms, storyboard duration=${this.storyboard?.duration}ms, final duration=${this.duration}ms`
                    );
                },
            });
        } else {
            this.duration = this.storyboard?.duration || 0;
        }

        this.initializeStoryboard();
        this.setupStoryboard();
    }

    private initializeStoryboard() {
        if (!this.storyboard) return;

        lg.log(
            "Initializing storyboard (" +
            this.storyboard.sprites.length +
            " sprites, " +
            this.storyboard.samples.length +
            " samples)"
        );

        this.storyboard.sprites.sort((a, b) => a.layer - b.layer);

        for (const sprite of this.storyboard.sprites) {
            this.initializeSprite(sprite);
        }

        lg.log(
            "Initialized " + this.storyboard.sprites.length + " sprites/animations"
        );
    }

    private initializeSprite(sprite: StoryboardSprite) {
        for (const loop of sprite.loops) {
            this.initializeLoop(loop);
        }

        for (const trigger of sprite.triggers) {
            this.initializeTrigger(trigger);
        }

        sprite.expandedEvents = [...sprite.events];

        for (const loop of sprite.loops) {
            sprite.expandedEvents.push(...loop.events);
        }

        for (const trigger of sprite.triggers) {
            if (trigger.activated) {
                sprite.expandedEvents.push(...trigger.events);
            }
        }

        sprite.expandedEvents.sort((a, b) => a.startTime - b.startTime);

        this.calculateActiveTimes(sprite);
        this.generateKeyframes(sprite);
    }

    private initializeLoop(loop: StoryboardLoop) {
        if (loop.loopCount < 1) loop.loopCount = 1;

        loop.loopLength = 0;
        for (const event of loop.events) {
            loop.loopLength = Math.max(loop.loopLength, event.endTime);
        }

        const expandedEvents: StoryboardEvent[] = [];
        const durations: [number, number][] = [];

        for (const event of loop.events) {
            durations.push([event.startTime, event.endTime]);
        }

        for (let i = 0; i < loop.loopCount; i++) {
            for (let j = 0; j < loop.events.length; j++) {
                const event = loop.events[j];
                const duration = durations[j];

                expandedEvents.push({
                    ...event,
                    startTime: loop.startTime + duration[0] + loop.loopLength * i,
                    endTime: loop.startTime + duration[1] + loop.loopLength * i,
                });
            }
        }

        loop.events = expandedEvents;
        loop.endTime = loop.startTime + loop.loopLength * loop.loopCount;
    }

    private initializeTrigger(trigger: StoryboardTrigger) {
        trigger.activated = false;
        trigger.loopLength = 0;
    }

    private generateKeyframes(sprite: StoryboardSprite) {
        const defaultPosition: [number, number] = [sprite.x, sprite.y];

        this.generatePositionKeyframes(sprite, defaultPosition);
        this.generateRotationKeyframes(sprite);
        this.generateScaleKeyframes(sprite);
        this.generateColourKeyframes(sprite);
        this.generateOpacityKeyframes(sprite);
        this.generateParameterKeyframes(sprite);
    }

    private generatePositionKeyframes(
        sprite: StoryboardSprite,
        defaultPosition: [number, number]
    ) {
        const events = sprite.expandedEvents.filter(
            (e) =>
                e.type === EventType.M ||
                e.type === EventType.MX ||
                e.type === EventType.MY
        );

        if (events.length === 0) {
            sprite.positionKeyframes[0].push({
                time: 0,
                value: defaultPosition[0],
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            sprite.positionKeyframes[1].push({
                time: 0,
                value: defaultPosition[1],
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            return;
        }

        this.addKeyframesForEvents(
            sprite.positionKeyframes,
            events,
            defaultPosition,
            (event, isX) => {
                if (event.type === EventType.M) {
                    return Array.isArray(event.startValue)
                        ? event.startValue[isX ? 0 : 1]
                        : defaultPosition[isX ? 0 : 1];
                } else if (event.type === EventType.MX && isX) {
                    return event.startValue as number;
                } else if (event.type === EventType.MY && !isX) {
                    return event.startValue as number;
                }
                return defaultPosition[isX ? 0 : 1];
            },
            (event, isX) => {
                if (event.type === EventType.M) {
                    return Array.isArray(event.endValue)
                        ? event.endValue[isX ? 0 : 1]
                        : defaultPosition[isX ? 0 : 1];
                } else if (event.type === EventType.MX && isX) {
                    return event.endValue as number;
                } else if (event.type === EventType.MY && !isX) {
                    return event.endValue as number;
                }
                return defaultPosition[isX ? 0 : 1];
            }
        );
    }

    private generateRotationKeyframes(sprite: StoryboardSprite) {
        const events = sprite.expandedEvents.filter((e) => e.type === EventType.R);

        if (events.length === 0) {
            sprite.rotationKeyframes.push({
                time: 0,
                value: 0,
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            return;
        }

        this.addKeyframesForEventsSimple(sprite.rotationKeyframes, events, 0);
    }

    private generateScaleKeyframes(sprite: StoryboardSprite) {
        const events = sprite.expandedEvents.filter(
            (e) => e.type === EventType.S || e.type === EventType.V
        );

        if (events.length === 0) {
            sprite.scaleKeyframes[0].push({
                time: 0,
                value: 1,
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            sprite.scaleKeyframes[1].push({
                time: 0,
                value: 1,
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            return;
        }

        this.addKeyframesForEvents(
            sprite.scaleKeyframes,
            events,
            [1, 1],
            (event, isX) => {
                if (event.type === EventType.S) {
                    return event.startValue as number;
                } else if (event.type === EventType.V) {
                    return Array.isArray(event.startValue)
                        ? event.startValue[isX ? 0 : 1]
                        : 1;
                }
                return 1;
            },
            (event, isX) => {
                if (event.type === EventType.S) {
                    return event.endValue as number;
                } else if (event.type === EventType.V) {
                    return Array.isArray(event.endValue)
                        ? event.endValue[isX ? 0 : 1]
                        : 1;
                }
                return 1;
            }
        );
    }

    private generateColourKeyframes(sprite: StoryboardSprite) {
        const events = sprite.expandedEvents.filter((e) => e.type === EventType.C);

        if (events.length === 0) {
            sprite.colourKeyframes.push({
                time: 0,
                value: [255, 255, 255],
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            return;
        }

        this.addKeyframesForEventsSimple(
            sprite.colourKeyframes,
            events,
            [255, 255, 255]
        );
    }

    private generateOpacityKeyframes(sprite: StoryboardSprite) {
        const events = sprite.expandedEvents.filter((e) => e.type === EventType.F);

        if (events.length === 0) {
            sprite.opacityKeyframes.push({
                time: 0,
                value: 1,
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            sprite.opacityKeyframes.push({
                time: 0,
                value: 1,
                easing: Easing.Step,
                interpolationOffset: 0,
            });
            return;
        }

        this.addKeyframesForEventsSimple(sprite.opacityKeyframes, events, 1);

        const lastEvent = events[events.length - 1];
        if (lastEvent) {
            sprite.opacityKeyframes.push({
                time: sprite.activeTime[1] + 1,
                value: 0,
                easing: Easing.Step,
                interpolationOffset: sprite.activeTime[1] + 1,
            });
        }
    }

    private generateParameterKeyframes(sprite: StoryboardSprite) {
        const flipHEvents = sprite.expandedEvents.filter(
            (e) => e.type === EventType.P && e.startValue === ParameterType.FlipH
        );
        const flipVEvents = sprite.expandedEvents.filter(
            (e) => e.type === EventType.P && e.startValue === ParameterType.FlipV
        );
        const additiveEvents = sprite.expandedEvents.filter(
            (e) => e.type === EventType.P && e.startValue === ParameterType.Additive
        );

        sprite.flipHRange = flipHEvents.map((e) => ({
            startTime: e.startTime,
            endTime: e.startTime === e.endTime ? sprite.activeTime[1] : e.endTime,
        }));

        sprite.flipVRange = flipVEvents.map((e) => ({
            startTime: e.startTime,
            endTime: e.startTime === e.endTime ? sprite.activeTime[1] : e.endTime,
        }));

        sprite.additiveRange = additiveEvents.map((e) => ({
            startTime: e.startTime,
            endTime: e.startTime === e.endTime ? sprite.activeTime[1] : e.endTime,
        }));
    }

    private addKeyframesForEvents<T>(
        keyframes: [Keyframe<T>[], Keyframe<T>[]],
        events: StoryboardEvent[],
        _: [T, T],
        getStartValue: (event: StoryboardEvent, isX: boolean) => T,
        getEndValue: (event: StoryboardEvent, isX: boolean) => T
    ) {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const appendEndtime = event.endTime > event.startTime;

            if (i === 0) {
                keyframes[0].push({
                    time: 0,
                    value: getStartValue(event, true),
                    easing: Easing.Step,
                    interpolationOffset: 0,
                });
                keyframes[1].push({
                    time: 0,
                    value: getStartValue(event, false),
                    easing: Easing.Step,
                    interpolationOffset: 0,
                });
            }

            keyframes[0].push({
                time: event.startTime,
                value: appendEndtime
                    ? getStartValue(event, true)
                    : getEndValue(event, true),
                easing: appendEndtime ? event.easing : Easing.Step,
                interpolationOffset: event.startTime,
            });
            keyframes[1].push({
                time: event.startTime,
                value: appendEndtime
                    ? getStartValue(event, false)
                    : getEndValue(event, false),
                easing: appendEndtime ? event.easing : Easing.Step,
                interpolationOffset: event.startTime,
            });

            if (appendEndtime) {
                keyframes[0].push({
                    time: event.endTime,
                    value: getEndValue(event, true),
                    easing: Easing.Step,
                    interpolationOffset: event.endTime,
                });
                keyframes[1].push({
                    time: event.endTime,
                    value: getEndValue(event, false),
                    easing: Easing.Step,
                    interpolationOffset: event.endTime,
                });
            }
        }
    }

    private addKeyframesForEventsSimple<T>(
        keyframes: Keyframe<T>[],
        events: StoryboardEvent[],
        _: T
    ) {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const appendEndtime = event.endTime > event.startTime;

            if (i === 0) {
                keyframes.push({
                    time: 0,
                    value: event.startValue as T,
                    easing: Easing.Step,
                    interpolationOffset: 0,
                });
            }

            keyframes.push({
                time: event.startTime,
                value: appendEndtime ? (event.startValue as T) : (event.endValue as T),
                easing: appendEndtime ? event.easing : Easing.Step,
                interpolationOffset: event.startTime,
            });

            if (appendEndtime) {
                keyframes.push({
                    time: isNaN(event.endTime) ? event.startTime : event.endTime,
                    value: event.endValue as T,
                    easing: Easing.Step,
                    interpolationOffset: event.endTime,
                });
            }
        }
    }

    private calculateActiveTimes(sprite: StoryboardSprite) {
        let activeStartTime = Infinity;
        let activeEndTime = -Infinity;

        for (const event of sprite.expandedEvents) {
            activeStartTime = Math.min(activeStartTime, event.startTime);
            activeEndTime = Math.max(activeEndTime, event.endTime);
        }

        sprite.activeTime = [activeStartTime, activeEndTime];
        sprite.visibleTime = sprite.activeTime;
    }

    private parseOsuFile(content: string): StoryboardData {
        const lines = content.split("\n");
        let currentSection = "";
        const sprites: StoryboardSprite[] = [];
        const samples: StoryboardSample[] = [];
        let audioFilename = "";
        let background: StoryboardBackground | undefined;
        let video: StoryboardVideo | undefined;
        let duration = 0;
        let audioLeadIn = 0;
        let currentSprite: StoryboardSprite | null = null;
        let inLoop = false;
        let inTrigger = false;
        const variables: { [key: string]: string } = {};

        let mapTitle = "";
        let mapArtist = "";
        let mapper = "";
        let diffName = "";

        for (let i = 0; i < lines.length; i++) {
            const originalLine = lines[i];
            let line = originalLine.trim();

            if (line.startsWith("[") && line.endsWith("]")) {
                currentSection = line.slice(1, -1);
                continue;
            }

            if (line.startsWith("//") || !line) continue;

            line = this.applyVariables(line, variables);

            if (currentSection === "General") {
                if (line.startsWith("AudioFilename:")) {
                    audioFilename = line.split(":")[1].trim();
                } else if (line.startsWith("AudioLeadIn:")) {
                    audioLeadIn = parseInt(line.split(":")[1].trim()) || 0;
                }
            } else if (currentSection === "Metadata") {
                if (line.startsWith("Title:")) {
                    mapTitle = line.split(":")[1].trim();
                } else if (line.startsWith("Artist:")) {
                    mapArtist = line.split(":")[1].trim();
                } else if (line.startsWith("Creator:")) {
                    mapper = line.split(":")[1].trim();
                } else if (line.startsWith("Version:")) {
                    diffName = line.split(":")[1].trim();
                }
            } else if (currentSection === "Variables") {
                const splitPos = line.indexOf("=");
                if (splitPos !== -1 && splitPos !== line.length - 1) {
                    const key = line.substring(0, splitPos);
                    const value = line.substring(splitPos + 1);
                    variables[key] = value;
                }
            } else if (currentSection === "Events") {
                const depth = originalLine.length - originalLine.trimStart().length;
                line = originalLine.trimStart();

                const parts = line.split(",");

                if (inTrigger && depth < 2) inTrigger = false;
                if (inLoop && depth < 2) inLoop = false;

                if (parts[0] === "0" && parts.length >= 3) {
                    background = {
                        path: this.removePathQuotes(parts[2]),
                        x: parseInt(parts[3]) || 0,
                        y: parseInt(parts[4]) || 0,
                    };
                } else if (parts[0] === "Video" && parts.length >= 3) {
                    video = {
                        startTime: parseFloat(parts[1]),
                        path: this.removePathQuotes(parts[2]),
                        x: parseInt(parts[3]) || 0,
                        y: parseInt(parts[4]) || 0,
                    };
                } else if (parts[0] === "Sprite" && parts.length >= 6) {
                    const filePath = this.removePathQuotes(parts[3]);

                    const skipPatterns = [
                        /^hitcircle/i,
                        /^hitcircleoverlay/i,
                        /^approach/i,
                        /^default-\d+/i,
                        /^slider/i,
                        /^reverse/i,
                        /^selection/i,
                        /^menu/i,
                        /^cursor/i,
                        /^score/i,
                        /^ranking/i,
                    ];

                    const shouldSkip = skipPatterns.some((pattern) =>
                        pattern.test(filePath)
                    );

                    if (!shouldSkip) {
                        const layer =
                            this.parseEnum(LayerStrings, parts[1]) || Layer.Background;
                        const origin =
                            this.parseEnum(OriginStrings, parts[2]) || Origin.Centre;

                        currentSprite = {
                            layer: layer,
                            origin: origin,
                            filePath: filePath,
                            x: parseFloat(parts[4]),
                            y: parseFloat(parts[5]),
                            events: [],
                            loops: [],
                            triggers: [],
                            positionKeyframes: [[], []],
                            rotationKeyframes: [],
                            scaleKeyframes: [[], []],
                            colourKeyframes: [],
                            opacityKeyframes: [],
                            flipHRange: [],
                            flipVRange: [],
                            additiveRange: [],
                            activeTime: [Infinity, -Infinity],
                            visibleTime: [Infinity, -Infinity],
                            expandedEvents: [],
                        };
                        sprites.push(currentSprite);
                    } else {
                        lg.log(`Skipping gameplay element: ${filePath}`);
                        currentSprite = null;
                    }
                } else if (parts[0] === "Animation" && parts.length >= 9) {
                    const filePath = this.removePathQuotes(parts[3]);
                    const layer =
                        this.parseEnum(LayerStrings, parts[1]) || Layer.Background;
                    const origin =
                        this.parseEnum(OriginStrings, parts[2]) || Origin.Centre;

                    currentSprite = {
                        layer: layer,
                        origin: origin,
                        filePath: filePath,
                        x: parseFloat(parts[4]),
                        y: parseFloat(parts[5]),
                        events: [],
                        loops: [],
                        triggers: [],
                        positionKeyframes: [[], []],
                        rotationKeyframes: [],
                        scaleKeyframes: [[], []],
                        colourKeyframes: [],
                        opacityKeyframes: [],
                        flipHRange: [],
                        flipVRange: [],
                        additiveRange: [],
                        activeTime: [Infinity, -Infinity],
                        visibleTime: [Infinity, -Infinity],
                        expandedEvents: [],
                    };
                    sprites.push(currentSprite);
                } else if (parts[0] === "Sample" && parts.length >= 5) {
                    const layer =
                        this.parseEnum(LayerStrings, parts[2]) || Layer.Background;
                    samples.push({
                        startTime: parseFloat(parts[1]),
                        layer: layer,
                        path: this.removePathQuotes(parts[3]),
                        volume: parseFloat(parts[4]),
                    });
                } else if (parts[0] === "T" && currentSprite) {
                    if (!inTrigger && !inLoop) {
                        const triggerName = parts[1];
                        const startTime = parseFloat(parts[2]);
                        const endTime = parseFloat(parts[3]);
                        const groupNumber = parts.length > 4 ? parseInt(parts[4]) : 0;

                        currentSprite.triggers.push({
                            triggerName,
                            startTime,
                            endTime,
                            groupNumber,
                            events: [],
                            activated: false,
                            loopLength: 0,
                        });
                        inTrigger = true;
                    }
                } else if (parts[0] === "L" && currentSprite) {
                    if (!inLoop && !inTrigger) {
                        const startTime = parseFloat(parts[1]);
                        const loopCount = parseInt(parts[2]);

                        currentSprite.loops.push({
                            startTime,
                            loopCount,
                            events: [],
                            loopLength: 0,
                            endTime: 0,
                        });
                        inLoop = true;
                    }
                } else if (depth > 0 && currentSprite !== null) {
                    const eventType = this.parseEnum(EventTypeStrings, parts[0]);
                    if (eventType && parts.length >= 4) {
                        if (parts.length < 4) parts[3] = parts[2];

                        const easing = parseInt(parts[1]) || 0;
                        const startTime = parseFloat(parts[2]);
                        const endTime = parts[3] ? parseFloat(parts[3]) : startTime;

                        let events: StoryboardEvent[] = [];

                        switch (eventType) {
                            case EventType.F:
                            case EventType.S:
                            case EventType.R:
                            case EventType.MX:
                            case EventType.MY:
                                const endEvents = parts.length;
                                if (endEvents === 5) {
                                    // Shorthand case: Start and end values are the same
                                    const finalValue = parseFloat(parts[4]);
                                    events.push({
                                        type: eventType,
                                        easing: easing,
                                        startTime,
                                        endTime,
                                        startValue: finalValue,
                                        endValue: finalValue,
                                    });
                                } else {
                                    let lastTime = startTime;
                                    const singleDuration = endTime - startTime;
                                    for (
                                        let currentPart = 4;
                                        currentPart < endEvents - 1;
                                        currentPart++
                                    ) {
                                        events.push({
                                            type: eventType,
                                            easing: easing,
                                            startTime: lastTime,
                                            endTime: lastTime + singleDuration,
                                            startValue: parseFloat(parts[currentPart]),
                                            endValue: parseFloat(parts[currentPart + 1]),
                                        });
                                        lastTime += singleDuration;
                                    }
                                }
                                break;
                            case EventType.V:
                            case EventType.M:
                                events.push({
                                    type: eventType,
                                    easing: easing,
                                    startTime,
                                    endTime,
                                    startValue: [parseFloat(parts[4]), parseFloat(parts[5])],
                                    endValue:
                                        parts.length > 6
                                            ? [parseFloat(parts[6]), parseFloat(parts[7])]
                                            : [parseFloat(parts[4]), parseFloat(parts[5])],
                                });
                                break;
                            case EventType.C:
                                events.push({
                                    type: eventType,
                                    easing: easing,
                                    startTime,
                                    endTime,
                                    startValue: [
                                        parseInt(parts[4]),
                                        parseInt(parts[5]),
                                        parseInt(parts[6]),
                                    ],
                                    endValue:
                                        parts.length > 7
                                            ? [
                                                parseInt(parts[7]),
                                                parseInt(parts[8]),
                                                parseInt(parts[9]),
                                            ]
                                            : [
                                                parseInt(parts[4]),
                                                parseInt(parts[5]),
                                                parseInt(parts[6]),
                                            ],
                                });
                                break;
                            case EventType.P:
                                const paramType = parts[4] as ParameterType;
                                events.push({
                                    type: eventType,
                                    easing: easing,
                                    startTime,
                                    endTime,
                                    startValue: paramType,
                                    endValue: paramType,
                                });
                                break;
                            default:
                                continue;
                        }

                        if (inTrigger && currentSprite.triggers.length > 0) {
                            currentSprite.triggers[
                                currentSprite.triggers.length - 1
                            ].events.push(...events);
                        } else if (inLoop && currentSprite.loops.length > 0) {
                            currentSprite.loops[currentSprite.loops.length - 1].events.push(
                                ...events
                            );
                        } else {
                            currentSprite.events.push(...events);
                        }

                        duration = Math.max(duration, endTime);
                    }
                }
            }
        }

        lg.log(`Parsed ${sprites.length} storyboard sprites`);

        return {
            sprites,
            samples,
            audioFilename,
            background,
            video,
            duration,
            audioLeadIn,

            diffName,
            mapTitle,
            mapArtist,
            mapper,
        };
    }

    private applyVariables(
        line: string,
        variables: { [key: string]: string }
    ): string {
        for (const [key, value] of Object.entries(variables)) {
            line = line.replace(new RegExp(key, "g"), value);
        }
        return line;
    }

    private removePathQuotes(path: string): string {
        if (path.length >= 2 && path[0] === '"' && path[path.length - 1] === '"') {
            return path.substring(1, path.length - 1);
        }
        return path;
    }

    private parseEnum<T>(
        enumMap: { [key: string]: T },
        value: string
    ): T | undefined {
        const result = enumMap[value];
        if (result !== undefined) return result;

        const intValue = parseInt(value);
        if (!isNaN(intValue)) {
            const enumValues = Object.values(enumMap);
            if (intValue >= 0 && intValue < enumValues.length) {
                return enumValues[intValue];
            }
        }

        return undefined;
    }

    private async loadAssets(assets: { [key: string]: Blob }) {
        const assetPaths: string[] = [];

        if (this.storyboard?.background) {
            assetPaths.push(this.storyboard.background.path);
        }

        if (this.storyboard?.video) {
            assetPaths.push(this.storyboard.video.path);
        }

        const sprites = this.storyboard?.sprites;
        if (sprites) {
            for (let i = 0; i < sprites.length; i++) {
                const sprite = sprites[i];
                const hasEvents =
                    sprite.events.length > 0 ||
                    sprite.loops.length > 0 ||
                    sprite.triggers.length > 0;

                if (hasEvents && sprite.filePath && sprite.filePath.trim() !== "") {
                    assetPaths.push(sprite.filePath);
                }
            }
        }

        if (this.storyboard?.samples) {
            for (let i = 0; i < this.storyboard.samples.length; i++) {
                const sample = this.storyboard.samples[i];
                if (sample.path && sample.path.trim() !== "") {
                    assetPaths.push(sample.path);
                }
            }
        }

        const uniquePaths = [...new Set(assetPaths)];
        this.totalAssets = uniquePaths.length;
        this.updateLoadingDisplay();

        const findAsset = (path: string): Blob | null => {
            if (!path || path.trim() === "") {
                return null;
            }

            const isImageFile = /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(path);
            const isImagePath =
                /^sb[\/\\]/.test(path) ||
                path.includes("storyboard") ||
                path.includes("sb/") ||
                path.includes("sb\\");

            if (isImagePath && !isImageFile) {
                const extensions = [".png", ".jpg", ".jpeg"];
                for (const ext of extensions) {
                    const pathWithExt = path + ext;
                    const result = findAssetHelper(pathWithExt, assets);
                    if (result) {
                        return result;
                    }
                }
            }

            const result = findAssetHelper(path, assets);
            if (!result) {
                lg.log(`Failed to find asset: ${path}`);
            }
            return result;
        };

        const findAssetHelper = (
            path: string,
            assets: { [key: string]: Blob }
        ): Blob | null => {
            if (assets[path]) {
                return assets[path];
            }

            const forwardSlash = path.replace(/\\/g, "/").replace(/ $/, "");
            if (assets[forwardSlash]) {
                return assets[forwardSlash];
            }

            const backSlash = path.replace(/\//g, "\\");
            lg.log("backSlash", backSlash);
            if (assets[backSlash]) {
                return assets[backSlash];
            }

            const lowerPath = path.toLowerCase();
            for (const [key, value] of Object.entries(assets)) {
                if (
                    key.toLowerCase() === lowerPath ||
                    key.toLowerCase().replace(/\\/g, "/") ===
                    lowerPath.replace(/\\/g, "/")
                ) {
                    return value;
                }
            }

            const pathWithoutDir = path.replace(/^.*[\\\/]/, "");
            for (const [key, value] of Object.entries(assets)) {
                const keyWithoutDir = key.replace(/^.*[\\\/]/, "");
                if (keyWithoutDir.toLowerCase() === pathWithoutDir.toLowerCase()) {
                    return value;
                }
            }

            lg.log(`Asset not found: ${path}`);
            return null;
        };

        const textureCache = new Map<string, any>();

        for (const path of uniquePaths) {
            const blob = findAsset(path);

            if (blob && blob.size > 0) {
                try {
                    lg.log(`Processing asset: ${path} (${blob.size} bytes)`);

                    const extension = path.toLowerCase().split(".").pop();
                    const mimeTypeMap: { [key: string]: string } = {
                        png: "image/png",
                        jpg: "image/jpeg",
                        jpeg: "image/jpeg",
                        gif: "image/gif",
                        bmp: "image/bmp",
                        webp: "image/webp",
                    };

                    const mimeType = mimeTypeMap[extension || ""] || "image/png";

                    const properBlob = new Blob([blob], { type: mimeType });
                    const url = URL.createObjectURL(properBlob);

                    lg.log(`Loading ${path} with MIME type: ${mimeType}`);

                    const texture = await new Promise<Texture>((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                        img.onload = () => {
                            try {
                                const canvas = document.createElement("canvas");
                                const ctx = canvas.getContext("2d")!;
                                canvas.width = img.width;
                                canvas.height = img.height;

                                ctx.drawImage(img, 0, 0);

                                const imageData = ctx.getImageData(
                                    0,
                                    0,
                                    canvas.width,
                                    canvas.height
                                );

                                let hasContent = false;
                                for (let i = 0; i < imageData.data.length; i += 4) {
                                    const alpha = imageData.data[i + 3];
                                    if (alpha > 0) {
                                        hasContent = true;
                                        break;
                                    }
                                }

                                if (!hasContent) {
                                    lg.warn(
                                        `Image appears to be empty or fully transparent: ${path}`
                                    );
                                }

                                const texture = Texture.from(canvas);

                                Assets.cache.set(path, texture);
                                lg.log(
                                    `Successfully loaded and cached texture: ${path} (${img.width}x${img.height}, hasContent: ${hasContent})`
                                );
                                resolve(texture);
                            } catch (e) {
                                lg.error(
                                    `Failed to create texture from loaded image: ${path}`,
                                    e
                                );
                                reject(e);
                            }
                        };
                        img.onerror = (e) => {
                            lg.error(`Failed to load image: ${path}`, e);
                            reject(e);
                        };
                        img.src = url;
                    });

                    textureCache.set(path, texture);
                    this.loadedAssets.add(path);
                    this.loadingAssets++;
                    this.updateLoadingDisplay();

                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                    lg.warn(`Failed to load asset: ${path}`, error);
                    this.loadingAssets++;
                    this.updateLoadingDisplay();
                }
            } else {
                lg.warn(`Asset not found: ${path}`);
                this.loadingAssets++;
                this.updateLoadingDisplay();
            }
        }
    }

    private updateLoadingDisplay() {
        const loadingElement = document.getElementById("loadingAssets");
        const totalElement = document.getElementById("totalAssets");

        if (loadingElement)
            loadingElement.textContent = this.loadingAssets.toString();
        if (totalElement) totalElement.textContent = this.totalAssets.toString();
    }

    private setupStoryboard() {
        if (!this.storyboard) return;

        this.app.stage.removeChildren();
        this.spriteObjects.clear();

        let bgSprite: Sprite | null = null;
        if (
            this.storyboard.background &&
            this.loadedAssets.has(this.storyboard.background.path)
        ) {
            try {
                const texture = Assets.cache.get(this.storyboard.background.path);
                if (texture) {
                    bgSprite = new Sprite(texture);
                    bgSprite.label = this.storyboard.background.path + " (background)";
                    bgSprite.anchor.set(0.5);

                    bgSprite.x =
                        this.width / 2 + this.storyboard.background.x * this.frameScale;
                    bgSprite.y =
                        this.height / 2 + this.storyboard.background.y * this.frameScale;

                    const backgroundScale = this.height / bgSprite.texture.height;
                    bgSprite.scale.set(backgroundScale);

                    bgSprite.zIndex = -1000;
                    this.app.stage.addChild(bgSprite);
                }
            } catch (error) {
                lg.warn(
                    `Failed to create background sprite: ${this.storyboard.background.path}`,
                    error
                );
            }
        }

        const sortedSprites = [...this.storyboard.sprites].sort(
            (a, b) => a.layer - b.layer
        );
        lg.log(`Sorted ${sortedSprites.length} sprites by layer`);

        for (const oldSprites of this.app.stage.children) {
            this.app.stage.removeChild(oldSprites);
        }

        for (let i = 0; i < sortedSprites.length; i++) {
            const spriteData = sortedSprites[i];
            const originalIndex = this.storyboard!.sprites.indexOf(spriteData);

            const hasEvents =
                spriteData.events.length > 0 ||
                spriteData.loops.length > 0 ||
                spriteData.triggers.length > 0;
            if (!hasEvents) {
                lg.log(
                    `Skipping sprite creation (no events): ${spriteData.filePath}`
                );
                continue;
            }

            try {
                let texture = null;

                if (this.loadedAssets.has(spriteData.filePath)) {
                    texture = Assets.cache.get(spriteData.filePath);
                }

                if (!texture) {
                    console.warn(
                        `Skipping sprite creation (no texture): ${spriteData.filePath}`
                    );
                    continue;
                }

                // const sprite =
                //     spriteData.filePath === this.storyboard!.background?.path &&
                //         spriteData.layer === Layer.Background &&
                //         bgSprite
                //         ? bgSprite
                //         : new Sprite(texture);
                const sprite = new Sprite(texture);

                sprite.label === "Sprite" && (sprite.label = spriteData.filePath);

                const anchorMap: { [key in Origin]: [number, number] } = {
                    [Origin.TopLeft]: [0, 0],
                    [Origin.TopCentre]: [0.5, 0],
                    [Origin.TopRight]: [1, 0],
                    [Origin.CentreLeft]: [0, 0.5],
                    [Origin.Centre]: [0.5, 0.5],
                    [Origin.CentreRight]: [1, 0.5],
                    [Origin.BottomLeft]: [0, 1],
                    [Origin.BottomCentre]: [0.5, 1],
                    [Origin.BottomRight]: [1, 1],
                };

                const anchor = anchorMap[spriteData.origin] || [0.5, 0.5];
                sprite.anchor.set(anchor[0], anchor[1]);

                sprite.x = spriteData.x * this.frameScale + this.xOffset;
                sprite.y = spriteData.y * this.frameScale;
                sprite.alpha = 1;

                const layerZIndex = spriteData.layer * 1000;
                sprite.zIndex = layerZIndex + originalIndex;

                this.app.stage.addChild(sprite);
                this.spriteObjects.set(`sprite_${originalIndex}`, sprite);
            } catch (error) {
                lg.warn(`Failed to create sprite: ${spriteData.filePath}`, error);
            }
        }

        this.app.stage.sortableChildren = true;

        this.currentTime = 0;
        this.updateStoryboard();
    }

    private updateStoryboard() {
        if (!this.storyboard) {
            return;
        };

        for (let i = 0; i < this.storyboard.sprites.length; i++) {
            const spriteData = this.storyboard.sprites[i];
            const sprite = this.spriteObjects.get(`sprite_${i}`);
            if (!sprite) continue;

            if (this.currentTime < spriteData.activeTime[0] || this.currentTime >= spriteData.activeTime[1]) {
                sprite.alpha = 0;
                continue;
            }

            let opacity = this.keyframeValueAt(
                spriteData.opacityKeyframes,
                this.currentTime,
                1
            );

            if (opacity === 0) {
                sprite.alpha = 0;
                continue;
            }

            const [scaleX, scaleY] = this.keyframeValueAtPair(
                spriteData.scaleKeyframes,
                this.currentTime,
                [1, 1]
            );
            if (scaleX === 0 || scaleY === 0) {
                sprite.alpha = 0;
                continue;
            }

            const [positionX, positionY] = this.keyframeValueAtPair(
                spriteData.positionKeyframes,
                this.currentTime,
                [spriteData.x, spriteData.y]
            );
            const rotation = this.keyframeValueAt(
                spriteData.rotationKeyframes,
                this.currentTime,
                0
            );
            const colour = this.keyframeValueAt(
                spriteData.colourKeyframes,
                this.currentTime,
                [255, 255, 255]
            );
            const flipH = this.checkIfInRange(
                spriteData.flipHRange,
                this.currentTime
            );
            const flipV = this.checkIfInRange(
                spriteData.flipVRange,
                this.currentTime
            );
            const additive = this.checkIfInRange(
                spriteData.additiveRange,
                this.currentTime
            );

            const anchorMap: { [key in Origin]: [number, number] } = {
                [Origin.TopLeft]: [0, 0],
                [Origin.TopCentre]: [0.5, 0],
                [Origin.TopRight]: [1, 0],
                [Origin.CentreLeft]: [0, 0.5],
                [Origin.Centre]: [0.5, 0.5],
                [Origin.CentreRight]: [1, 0.5],
                [Origin.BottomLeft]: [0, 1],
                [Origin.BottomCentre]: [0.5, 1],
                [Origin.BottomRight]: [1, 1],
            };

            const anchor = anchorMap[spriteData.origin] || [0.5, 0.5];
            sprite.anchor.set(anchor[0], anchor[1]);

            sprite.alpha = Math.max(0, Math.min(1, opacity));

            const finalScaleX = scaleX * this.frameScale * (flipH ? -1 : 1);
            const finalScaleY = scaleY * this.frameScale * (flipV ? -1 : 1);

            sprite.scale.set(finalScaleX, finalScaleY);
            sprite.rotation = rotation;

            sprite.x = positionX * this.frameScale + this.xOffset;
            sprite.y = positionY * this.frameScale;

            const colorR = Math.max(0, Math.min(255, colour[0]));
            const colorG = Math.max(0, Math.min(255, colour[1]));
            const colorB = Math.max(0, Math.min(255, colour[2]));
            sprite.tint =
                (Math.floor(colorR) << 16) +
                (Math.floor(colorG) << 8) +
                Math.floor(colorB);

            sprite.blendMode = additive ? "add" : "normal";

            if (spriteData.filePath === 'sb\\greyscale.jpg') {
                lg.log(positionX, positionY, this.frameScale);
            }
        }

        this.updateTimeDisplay();
        this.updateSeekBar();
    }

    private checkIfInRange(ranges: ParameterRange[], time: number) {
        for (const range of ranges) {
            if (time >= range.startTime && time <= range.endTime) {
                return true;
            }
        }

        return false;
    }

    private keyframeValueAt<T>(
        keyframes: Keyframe<T>[],
        time: number,
        defaultValue: T
    ): T {
        if (keyframes.length === 0) return defaultValue;

        let keyframe: Keyframe<T> | null = null;
        let endKeyframe: Keyframe<T> | null = null;

        for (let i = 0; i < keyframes.length; i++) {
            if (keyframes[i].time > time) {
                if (i > 0) {
                    keyframe = keyframes[i - 1];
                    endKeyframe = keyframes[i];
                }
                break;
            }
        }

        if (!keyframe) {
            keyframe = keyframes[keyframes.length - 1];
        }

        if (keyframe.easing === Easing.Step || !endKeyframe) {
            return keyframe.value;
        }

        const t =
            (time - keyframe.interpolationOffset) /
            (Math.max(endKeyframe.time, endKeyframe.interpolationOffset) -
                keyframe.interpolationOffset);
        const easedT = Math.min(
            Math.max(this.applyEasing(keyframe.easing, t), 0),
            1
        );
        return this.interpolateLinear(keyframe.value, endKeyframe.value, easedT);
    }

    private keyframeValueAtPair<T>(
        keyframes: [Keyframe<T>[], Keyframe<T>[]],
        time: number,
        defaultValue: [T, T]
    ): [T, T] {
        const first = this.keyframeValueAt(keyframes[0], time, defaultValue[0]);
        const second = this.keyframeValueAt(keyframes[1], time, defaultValue[1]);
        return [first, second];
    }

    private interpolateLinear<T>(start: T, end: T, progress: number): T {
        if (typeof start === "number" && typeof end === "number") {
            return (start + (end - start) * progress) as T;
        }
        if (Array.isArray(start) && Array.isArray(end)) {
            const result = [];
            for (let i = 0; i < start.length; i++) {
                result[i] = start[i] + (end[i] - start[i]) * progress;
            }
            return result as T;
        }
        return start;
    }

    private applyEasing(easing: Easing, progress: number): number {
        const PI = Math.PI;
        const reverse = (f: (t: number) => number, t: number) => 1 - f(1 - t);
        const toInOut = (f: (t: number) => number, t: number) =>
            0.5 * (t < 0.5 ? f(2 * t) : 2 - f(2 - 2 * t));

        switch (easing) {
            case Easing.Step:
                return progress >= 1 ? 1 : 0;
            case Easing.None:
                return progress;
            case Easing.Out:
                return reverse((t) => t * t, progress);
            case Easing.In:
                return progress * progress;
            case Easing.InQuad:
                return progress * progress;
            case Easing.OutQuad:
                return reverse((t) => t * t, progress);
            case Easing.InOutQuad:
                return toInOut((t) => t * t, progress);
            case Easing.InCubic:
                return progress * progress * progress;
            case Easing.OutCubic:
                return reverse((t) => t * t * t, progress);
            case Easing.InOutCubic:
                return toInOut((t) => t * t * t, progress);
            case Easing.InQuart:
                return Math.pow(progress, 4);
            case Easing.OutQuart:
                return reverse((t) => Math.pow(t, 4), progress);
            case Easing.InOutQuart:
                return toInOut((t) => Math.pow(t, 4), progress);
            case Easing.InQuint:
                return Math.pow(progress, 5);
            case Easing.OutQuint:
                return reverse((t) => Math.pow(t, 5), progress);
            case Easing.InOutQuint:
                return toInOut((t) => Math.pow(t, 5), progress);
            case Easing.InSine:
                return 1 - Math.cos((progress * PI) / 2);
            case Easing.OutSine:
                return reverse((t) => 1 - Math.cos((t * PI) / 2), progress);
            case Easing.InOutSine:
                return toInOut((t) => 1 - Math.cos((t * PI) / 2), progress);
            case Easing.InExpo:
                return Math.pow(2, 10 * (progress - 1));
            case Easing.OutExpo:
                return reverse((t) => Math.pow(2, 10 * (t - 1)), progress);
            case Easing.InOutExpo:
                return toInOut((t) => Math.pow(2, 10 * (t - 1)), progress);
            case Easing.InCirc:
                return 1 - Math.sqrt(1 - progress * progress);
            case Easing.OutCirc:
                return reverse((t) => 1 - Math.sqrt(1 - t * t), progress);
            case Easing.InOutCirc:
                return toInOut((t) => 1 - Math.sqrt(1 - t * t), progress);
            case Easing.InBack:
                return progress * progress * ((1.70158 + 1) * progress - 1.70158);
            case Easing.OutBack:
                return reverse((t) => t * t * ((1.70158 + 1) * t - 1.70158), progress);
            case Easing.InOutBack:
                return toInOut(
                    (t) => t * t * ((1.70158 * 1.525 + 1) * t - 1.70158 * 1.525),
                    progress
                );
            case Easing.OutBounce:
                return progress < 1 / 2.75
                    ? 7.5625 * progress * progress
                    : progress < 2 / 2.75
                        ? 7.5625 * (progress -= 1.5 / 2.75) * progress + 0.75
                        : progress < 2.5 / 2.75
                            ? 7.5625 * (progress -= 2.25 / 2.75) * progress + 0.9375
                            : 7.5625 * (progress -= 2.625 / 2.75) * progress + 0.984375;
            case Easing.InBounce:
                return reverse(
                    (t) =>
                        t < 1 / 2.75
                            ? 7.5625 * t * t
                            : t < 2 / 2.75
                                ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
                                : t < 2.5 / 2.75
                                    ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
                                    : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375,
                    progress
                );
            case Easing.InOutBounce:
                return toInOut(
                    (t) =>
                        reverse(
                            (u) =>
                                u < 1 / 2.75
                                    ? 7.5625 * u * u
                                    : u < 2 / 2.75
                                        ? 7.5625 * (u -= 1.5 / 2.75) * u + 0.75
                                        : u < 2.5 / 2.75
                                            ? 7.5625 * (u -= 2.25 / 2.75) * u + 0.9375
                                            : 7.5625 * (u -= 2.625 / 2.75) * u + 0.984375,
                            t
                        ),
                    progress
                );
            case Easing.OutElastic:
                return (
                    Math.pow(2, -10 * progress) *
                    Math.sin(((progress - 0.075) * (2 * PI)) / 0.3) +
                    1
                );
            case Easing.OutElasticHalf:
                return (
                    Math.pow(2, -10 * progress) *
                    Math.sin(((0.5 * progress - 0.075) * (2 * PI)) / 0.3) +
                    1
                );
            case Easing.OutElasticQuarter:
                return (
                    Math.pow(2, -10 * progress) *
                    Math.sin(((0.25 * progress - 0.075) * (2 * PI)) / 0.3) +
                    1
                );
            case Easing.InElastic:
                return reverse(
                    (t) =>
                        Math.pow(2, -10 * t) * Math.sin(((t - 0.075) * (2 * PI)) / 0.3) + 1,
                    progress
                );
            case Easing.InOutElastic:
                return toInOut(
                    (t) =>
                        reverse(
                            (u) =>
                                Math.pow(2, -10 * u) *
                                Math.sin(((u - 0.075) * (2 * PI)) / 0.3) +
                                1,
                            t
                        ),
                    progress
                );
            default:
                return progress;
        }
    }

    private togglePlayback() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    private play() {
        if (!this.storyboard) return;

        this.isPlaying = true;
        document.getElementById("playButton")!.textContent = "Pause";

        if (this.audio) {
            this.audio.seek(this.currentTime / 1000);
            this.audio.play();

            setTimeout(() => {
                const audioTime = this.audio!.seek() * 1000;
                if (Math.abs(audioTime - this.currentTime) > 100) {
                    lg.warn(
                        `Audio/storyboard sync issue at play: audio=${audioTime}ms, storyboard=${this.currentTime}ms`
                    );
                }
            }, 50);
        }

        this.startAnimation();
    }

    private pause() {
        this.isPlaying = false;
        document.getElementById("playButton")!.textContent = "Play";

        if (this.audio) {
            this.audio.pause();
        }

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    private seekTo(time: number) {
        this.currentTime = Math.max(0, Math.min(this.duration, time));

        if (this.audio) {
            const audioSeekTime = this.currentTime / 1000;
            this.audio.seek(audioSeekTime);

            const actualAudioTime = this.audio.seek() * 1000;
            if (Math.abs(actualAudioTime - this.currentTime) > 50) {
                lg.warn(
                    `Audio seek inaccuracy: target=${this.currentTime}ms, actual=${actualAudioTime}ms`
                );
            }
        }

        this.updateStoryboard();
    }

    private startAnimation() {
        let lastFrameTime = performance.now();

        const animate = () => {
            if (!this.isPlaying) return;

            const currentFrameTime = performance.now();
            const deltaTime = currentFrameTime - lastFrameTime;
            lastFrameTime = currentFrameTime;

            if (this.audio && this.audio.playing()) {
                const audioTime = this.audio.seek() * 1000;

                const drift = Math.abs(audioTime - this.currentTime);
                if (drift > 100) {
                    lg.warn(
                        `Correcting sync drift: audio=${audioTime}ms, storyboard=${this.currentTime}ms, drift=${drift}ms`
                    );
                    this.currentTime = audioTime;
                } else {
                    this.currentTime = audioTime;
                }
            } else {
                this.currentTime += deltaTime;
            }

            this.currentTime = Math.min(this.currentTime, this.duration);

            this.updateStoryboard();

            if (this.currentTime >= this.duration) {
                this.pause();
                this.currentTime = 0;
                this.seekTo(0);
            } else {
                this.animationId = requestAnimationFrame(animate);
            }
        };

        this.animationId = requestAnimationFrame(animate);
    }

    private updateTimeDisplay() {
        const formatTime = (ms: number) => {
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return `${minutes.toString().padStart(2, "0")}:${seconds
                .toString()
                .padStart(2, "0")}`;
        };

        const currentTimeElement = document.getElementById("currentTime");
        const totalTimeElement = document.getElementById("totalTime");

        if (currentTimeElement) {
            let timeText = formatTime(this.currentTime);

            if (this.audio && this.isPlaying) {
                const audioTime = this.audio.seek() * 1000;
                const drift = Math.abs(audioTime - this.currentTime);
                if (drift > 50) {
                    timeText += ` (⚠️${Math.round(drift)}ms)`;
                }
            }

            currentTimeElement.textContent = timeText;
        }
        if (totalTimeElement) {
            totalTimeElement.textContent = formatTime(this.duration);
        }
    }

    private updateSeekBar() {
        const seekBarFill = document.getElementById(
            "seekBarFill"
        ) as HTMLDivElement;
        const seekBarHandle = document.getElementById(
            "seekBarHandle"
        ) as HTMLDivElement;

        if (this.duration > 0) {
            const percentage = (this.currentTime / this.duration) * 100;
            if (seekBarFill) {
                seekBarFill.style.width = `${percentage}%`;
            }
            if (seekBarHandle) {
                seekBarHandle.style.left = `${percentage}%`;
            }
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new OsuStoryboardPlayer();
    const toggleConsoleButton = document.getElementById("toggleConsole");

    const consoleElement = document.getElementById("logger");
    const savedConsoleVisibility = localStorage.getItem("consoleVisible");
    if (consoleElement && savedConsoleVisibility !== null) {
        consoleElement.style.display = savedConsoleVisibility === "true" ? "flex" : "none";
    }

    toggleConsoleButton?.addEventListener("click", () => {
        if (consoleElement) {
            const isVisible = consoleElement.style.display !== "none";
            const newDisplay = isVisible ? "none" : "flex";
            consoleElement.style.display = newDisplay;
            localStorage.setItem("consoleVisible", (newDisplay === "flex").toString());
        }
    });
});
