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
    lastVisible: boolean;
    lastTexture?: Texture;
    lastWidth: number;
    lastHeight: number;
    lastLeft: number;
    lastTop: number;
    lastPositionX: number;
    lastPositionY: number;
    lastScaleX: number;
    lastScaleY: number;
    lastRotation: number;
    lastZIndex: number;
    lastLabelText: string;
    lastLabelX: number;
    lastLabelY: number;
    lastLabelScaleX: number;
    lastLabelScaleY: number;
    lastBackgroundX: number;
    lastBackgroundY: number;
    lastBackgroundWidth: number;
    lastBackgroundHeight: number;
    labelsVisible: boolean;
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
        lastVisible: false,
        lastWidth: Number.NaN,
        lastHeight: Number.NaN,
        lastLeft: Number.NaN,
        lastTop: Number.NaN,
        lastPositionX: Number.NaN,
        lastPositionY: Number.NaN,
        lastScaleX: Number.NaN,
        lastScaleY: Number.NaN,
        lastRotation: Number.NaN,
        lastZIndex: Number.NaN,
        lastLabelText: "",
        lastLabelX: Number.NaN,
        lastLabelY: Number.NaN,
        lastLabelScaleX: Number.NaN,
        lastLabelScaleY: Number.NaN,
        lastBackgroundX: Number.NaN,
        lastBackgroundY: Number.NaN,
        lastBackgroundWidth: Number.NaN,
        lastBackgroundHeight: Number.NaN,
        labelsVisible: true,
    };
}

export function destroyLayoutBorder(border?: LayoutBorder): void {
    if (!border) {
        return;
    }

    border.container.destroy({ children: true, texture: false, textureSource: false });
}

export function syncLayoutBorder(
    border: LayoutBorder | undefined,
    sprite: Sprite | undefined,
    visible: boolean,
    showLabel: boolean,
): void {
    if (!border || !sprite || !visible || !sprite.visible) {
        if (border?.lastVisible) {
            border.container.visible = false;
            border.lastVisible = false;
        }
        return;
    }

    const texture = sprite.texture;
    const width = border.lastTexture === texture ? border.lastWidth : getTextureWidth(texture);
    const height = border.lastTexture === texture ? border.lastHeight : getTextureHeight(texture);

    if (width <= 0 || height <= 0) {
        border.container.visible = false;
        border.lastVisible = false;
        return;
    }

    const left = -sprite.anchor.x * width;
    const top = -sprite.anchor.y * height;
    const lineThickness = 2;
    const positionX = sprite.position.x;
    const positionY = sprite.position.y;
    const scaleX = sprite.scale.x;
    const scaleY = sprite.scale.y;
    const rotation = sprite.rotation;
    const zIndex = sprite.zIndex + 0.5;

    border.container.visible = true;
    border.lastVisible = true;
    if (border.labelsVisible !== showLabel) {
        border.labelContainer.visible = showLabel;
        border.labelsVisible = showLabel;
    }

    if (border.lastPositionX !== positionX || border.lastPositionY !== positionY) {
        border.container.position.set(positionX, positionY);
        border.lastPositionX = positionX;
        border.lastPositionY = positionY;
    }

    if (border.lastScaleX !== scaleX || border.lastScaleY !== scaleY) {
        border.container.scale.set(scaleX, scaleY);
        border.lastScaleX = scaleX;
        border.lastScaleY = scaleY;
    }

    if (border.lastRotation !== rotation) {
        border.container.rotation = rotation;
        border.lastRotation = rotation;
    }

    if (border.lastZIndex !== zIndex) {
        border.container.zIndex = zIndex;
        border.lastZIndex = zIndex;
    }

    if (
        border.lastTexture !== texture ||
        border.lastWidth !== width ||
        border.lastHeight !== height ||
        border.lastLeft !== left ||
        border.lastTop !== top
    ) {
        border.graphics.clear();
        border.graphics.rect(left, top, width, height);
        border.graphics.stroke({
            color: border.color,
            width: lineThickness,
            alpha: 0.95,
        });

        border.lastTexture = texture;
        border.lastWidth = width;
        border.lastHeight = height;
        border.lastLeft = left;
        border.lastTop = top;
    }

    if (!showLabel) {
        return;
    }

    const labelText = `${border.assetName}\n${formatCoordinate(positionX)}, ${formatCoordinate(positionY)}`;
    if (border.lastLabelText !== labelText) {
        border.label.text = labelText;
        border.lastLabelText = labelText;
    }

    const labelX = left + LAYOUT_LABEL_PADDING_X;
    const labelY = top + height - border.label.height - LAYOUT_LABEL_PADDING_Y;

    if (border.lastLabelX !== labelX || border.lastLabelY !== labelY) {
        border.label.position.set(labelX, labelY);
        border.lastLabelX = labelX;
        border.lastLabelY = labelY;
    }

    const labelScaleX = scaleX < 0 ? -1 : 1;
    const labelScaleY = scaleY < 0 ? -1 : 1;
    if (border.lastLabelScaleX !== labelScaleX || border.lastLabelScaleY !== labelScaleY) {
        border.labelContainer.scale.set(labelScaleX, labelScaleY);
        border.lastLabelScaleX = labelScaleX;
        border.lastLabelScaleY = labelScaleY;
    }

    const backgroundX = labelX - LAYOUT_LABEL_PADDING_X;
    const backgroundY = labelY - LAYOUT_LABEL_PADDING_Y;
    const backgroundWidth = border.label.width + LAYOUT_LABEL_PADDING_X * 2;
    const backgroundHeight = border.label.height + LAYOUT_LABEL_PADDING_Y * 2;

    if (
        border.lastBackgroundX !== backgroundX ||
        border.lastBackgroundY !== backgroundY ||
        border.lastBackgroundWidth !== backgroundWidth ||
        border.lastBackgroundHeight !== backgroundHeight
    ) {
        border.labelBackground.clear();
        border.labelBackground.rect(backgroundX, backgroundY, backgroundWidth, backgroundHeight);
        border.labelBackground.fill({ color: border.color, alpha: 0.9 });

        border.lastBackgroundX = backgroundX;
        border.lastBackgroundY = backgroundY;
        border.lastBackgroundWidth = backgroundWidth;
        border.lastBackgroundHeight = backgroundHeight;
    }
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
