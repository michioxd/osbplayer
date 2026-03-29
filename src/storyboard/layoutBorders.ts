import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";

import { Layer } from "../types/storyboard";
import { getFileName, removePathQuotes } from "../utils/path";

const LAYOUT_LABEL_STYLE = new TextStyle({
    fill: 0xffffff,
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 12,
});
const LAYOUT_LABEL_PADDING_X = 4;
const LAYOUT_LABEL_PADDING_Y = 2;

export interface LayoutBorder {
    container: Container;
    graphics: Graphics;
    labelContainer: Container;
    labelBackground: Graphics;
    label: Text;
    color: number;
    assetName: string;
}

export function createLayoutBorder(parent: Container, color: number, zIndex: number, assetPath: string): LayoutBorder {
    const container = new Container();
    const graphics = new Graphics();
    const labelContainer = new Container();
    const labelBackground = new Graphics();
    const label = new Text({
        text: "",
        style: LAYOUT_LABEL_STYLE,
    });

    container.eventMode = "none";
    container.visible = false;
    container.zIndex = zIndex;

    graphics.eventMode = "none";
    container.addChild(graphics);
    labelContainer.eventMode = "none";
    label.eventMode = "none";
    labelBackground.eventMode = "none";
    labelContainer.addChild(labelBackground, label);
    container.addChild(labelContainer);

    parent.addChild(container);
    return {
        container,
        graphics,
        labelContainer,
        labelBackground,
        label,
        color,
        assetName: formatBorderAssetName(assetPath),
    };
}

export function destroyLayoutBorder(border?: LayoutBorder): void {
    if (!border) {
        return;
    }

    border.container.destroy({ children: true, texture: false, textureSource: false });
}

export function syncLayoutBorder(border: LayoutBorder | undefined, sprite: Sprite | undefined, visible: boolean): void {
    if (!border || !sprite || !visible || !sprite.visible) {
        if (border) {
            border.container.visible = false;
            border.graphics.clear();
            border.labelBackground.clear();
        }
        return;
    }

    const width = getTextureWidth(sprite.texture);
    const height = getTextureHeight(sprite.texture);
    if (width <= 0 || height <= 0) {
        border.container.visible = false;
        return;
    }

    const left = -sprite.anchor.x * width;
    const top = -sprite.anchor.y * height;
    const lineThickness = 2;

    border.container.visible = true;
    border.container.position.copyFrom(sprite.position);
    border.container.scale.copyFrom(sprite.scale);
    border.container.rotation = sprite.rotation;
    border.container.zIndex = sprite.zIndex + 0.5;

    border.graphics.clear();
    border.graphics.rect(left, top, width, height);
    border.graphics.stroke({
        color: border.color,
        width: lineThickness,
        alpha: 0.95,
    });

    const labelText = `${border.assetName}\n${formatCoordinate(sprite.position.x)}, ${formatCoordinate(sprite.position.y)}`;
    border.label.text = labelText;
    border.label.position.set(
        left + LAYOUT_LABEL_PADDING_X,
        top + height - border.label.height - LAYOUT_LABEL_PADDING_Y,
    );
    border.labelContainer.scale.set(sprite.scale.x < 0 ? -1 : 1, sprite.scale.y < 0 ? -1 : 1);

    const backgroundX = border.label.position.x - LAYOUT_LABEL_PADDING_X;
    const backgroundY = border.label.position.y - LAYOUT_LABEL_PADDING_Y;
    const backgroundWidth = border.label.width + LAYOUT_LABEL_PADDING_X * 2;
    const backgroundHeight = border.label.height + LAYOUT_LABEL_PADDING_Y * 2;

    border.labelBackground.clear();
    border.labelBackground.rect(backgroundX, backgroundY, backgroundWidth, backgroundHeight);
    border.labelBackground.fill({ color: border.color, alpha: 0.9 });
}

export function colorForVisualLayer(layer: Layer): number {
    switch (layer) {
        case Layer.Background:
            return 0x4dabf7;
        case Layer.Fail:
            return 0xff6b6b;
        case Layer.Pass:
            return 0x69db7c;
        case Layer.Foreground:
            return 0xffd43b;
        case Layer.Overlay:
            return 0xda77f2;
        default:
            return 0xffffff;
    }
}

function formatBorderAssetName(path: string): string {
    const unquotedPath = removePathQuotes(path).trim().replace(/\\/g, "/");
    return getFileName(unquotedPath) || unquotedPath || "unknown";
}

function formatCoordinate(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getTextureHeight(texture: Texture): number {
    if (texture.height > 1) return texture.height;
    if (texture.source && texture.source.height > 1) return texture.source.height;
    if (texture.orig && texture.orig.height > 1) return texture.orig.height;
    return 1080;
}

function getTextureWidth(texture: Texture): number {
    if (texture.width > 1) return texture.width;
    if (texture.source && texture.source.width > 1) return texture.source.width;
    if (texture.orig && texture.orig.width > 1) return texture.orig.width;
    return 1920;
}
