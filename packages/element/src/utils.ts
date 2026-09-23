// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Localize, PathBinding } from "@chili3d/core";
import type { HTMLProps } from "./htmlProps";

export function setProperties<T extends { [K: string]: any }>(left: T, prop: HTMLProps<T>) {
    for (const key in prop) {
        const value = prop[key];
        if (value instanceof Localize && (key === "textContent" || key === "title")) {
            value.set(left, key);
        } else if (value instanceof PathBinding) {
            value.setBinding(left, key);
        } else if (typeof value === "object" && typeof left[key] === "object") {
            setProperties(left[key], value);
        } else {
            (left as any)[key] = value;
        }
    }
}

export function toBase64Img(fileName: string, base64Str: string) {
    let base64: string;
    if (fileName.endsWith("png")) {
        base64 = `data:image/png;base64,${base64Str}`;
    } else if (fileName.endsWith("svg")) {
        base64 = `data:image/svg+xml;base64,${base64Str}`;
    } else if (fileName.endsWith("jpg")) {
        base64 = `data:image/jpeg;base64,${base64Str}`;
    } else {
        throw "Unsupported icon format, only png, jpg, svg are supported";
    }
    return base64;
}

/**
 * An image URL drawn into a canvas at its own intrinsic size, or undefined when it cannot be
 * loaded or the canvas has no 2d context.
 *
 * Asking for one exact size is the point: for an SVG, a browser chooses the pixel size it is
 * rasterized at, and on a hidpi screen some of them rasterize at the device pixel ratio while
 * painting the content 1:1 — most of the bitmap stays empty, and a texture uploaded from it
 * shows the image in one corner of every face. A requested size is a size every browser honours.
 */
export async function imageToCanvas(url: string): Promise<HTMLCanvasElement | undefined> {
    const image = await loadImage(url);
    if (image === undefined) return undefined;

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= 0 || height <= 0) return undefined;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return undefined;
    context.drawImage(image, 0, 0, width, height);
    return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
    return new Promise((resolve) => {
        const image = new Image();
        // An image without this is unclean, which drawing it into a canvas that is read back
        // and uploading it to WebGL both refuse.
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(undefined);
        image.src = url;
    });
}
