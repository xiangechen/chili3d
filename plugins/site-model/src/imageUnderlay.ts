// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { type Point2D, REQUIRED_DISCLAIMER } from "./types";

/**
 * 2D pixel coordinate on an image (origin at top-left, u = right, v = down).
 */
export interface PixelCoord {
    u: number;
    v: number;
}

/**
 * Two-point scale calibration parameters for an image underlay.
 * Rule: User selects two known points on the image (e.g. scale bar ends or building edges)
 * and inputs the known real-world distance in metres.
 */
export interface ImageCalibration {
    pointA: PixelCoord;
    pointB: PixelCoord;
    knownDistanceM: number;
    pixelDistance: number;
    /** Metres per pixel: knownDistanceM / pixelDistance */
    metresPerPixel: number;
    /** Pixels per metre: pixelDistance / knownDistanceM */
    pixelsPerMetre: number;
    disclaimer: string;
}

/**
 * Image underlay definition for background raster plans (PNG, JPEG, PDF page).
 */
export interface ImageUnderlay {
    id: string;
    name: string;
    imageUri: string;
    widthPx: number;
    heightPx: number;
    calibration?: ImageCalibration;
    /** Pixel on the image representing the world coordinate origin (0, 0) */
    originPixel?: PixelCoord;
    /** Rotation of the image in degrees (clockwise) */
    rotationDeg?: number;
    opacity: number;
    visible: boolean;
    disclaimer: string;
}

/**
 * Calculates the Euclidean pixel distance between two pixel coordinates.
 */
export function getPixelDistance(p1: PixelCoord, p2: PixelCoord): number {
    const du = p2.u - p1.u;
    const dv = p2.v - p1.v;
    return Math.hypot(du, dv);
}

/**
 * Calibrates the scale of an image underlay given two points and their real-world distance.
 *
 * Hand-calculation reference (Task S5):
 * - Two points A and B are chosen on a scale bar:
 *   Point A = (100, 200) px, Point B = (500, 200) px
 * - Pixel distance = sqrt((500 - 100)^2 + (200 - 200)^2) = 400 px
 * - Known real-world distance = 40.0 m
 * - Metres per pixel = 40.0 m / 400 px = 0.100 m/px
 * - Measuring another 400 px segment yields: 400 px * 0.100 m/px = 40.0 m
 */
export function calibrateImageScale(
    pointA: PixelCoord,
    pointB: PixelCoord,
    knownDistanceM: number,
): Result<ImageCalibration, string> {
    if (!Number.isFinite(knownDistanceM) || knownDistanceM <= 0) {
        return Result.err("Known distance must be a positive finite number of metres.");
    }

    if (
        !Number.isFinite(pointA.u) ||
        !Number.isFinite(pointA.v) ||
        !Number.isFinite(pointB.u) ||
        !Number.isFinite(pointB.v)
    ) {
        return Result.err("Calibration points must have finite pixel coordinates.");
    }

    const pixelDistance = getPixelDistance(pointA, pointB);
    if (pixelDistance < 1e-4) {
        return Result.err("Calibration points must not coincide; pixel distance is too small.");
    }

    const metresPerPixel = knownDistanceM / pixelDistance;
    const pixelsPerMetre = pixelDistance / knownDistanceM;

    return Result.ok({
        pointA: { ...pointA },
        pointB: { ...pointB },
        knownDistanceM,
        pixelDistance,
        metresPerPixel,
        pixelsPerMetre,
        disclaimer: REQUIRED_DISCLAIMER,
    });
}

/**
 * Measures real-world distance in metres between any two pixel coordinates on a calibrated underlay.
 */
export function measureUnderlayDistanceM(
    p1: PixelCoord,
    p2: PixelCoord,
    calibration: ImageCalibration,
): number {
    const pxDist = getPixelDistance(p1, p2);
    return pxDist * calibration.metresPerPixel;
}

/**
 * Transforms an image pixel coordinate (u = right, v = down) to world coordinates in metres
 * (x = east, y = north), taking into account calibration, origin pixel, and rotation.
 */
export function pixelToWorldMetres(pixel: PixelCoord, underlay: ImageUnderlay): Result<Point2D, string> {
    if (!underlay.calibration) {
        return Result.err("Underlay is not calibrated; scale is unknown.");
    }

    const origin = underlay.originPixel ?? { u: 0, v: 0 };
    const mPerPx = underlay.calibration.metresPerPixel;

    // Delta in pixels from origin
    // Image v axis points downward (+v = south); world y axis points northward (+y = north)
    const du = pixel.u - origin.u;
    const dv = -(pixel.v - origin.v);

    const rotRad = ((underlay.rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);

    // Apply rotation and scale
    const worldX = (du * cos - dv * sin) * mPerPx;
    const worldY = (du * sin + dv * cos) * mPerPx;

    return Result.ok({ x: worldX, y: worldY });
}

/**
 * Transforms world coordinates in metres (x = east, y = north) to image pixel coordinates (u, v).
 */
export function worldMetresToPixel(world: Point2D, underlay: ImageUnderlay): Result<PixelCoord, string> {
    if (!underlay.calibration) {
        return Result.err("Underlay is not calibrated; scale is unknown.");
    }

    const origin = underlay.originPixel ?? { u: 0, v: 0 };
    const pxPerM = underlay.calibration.pixelsPerMetre;

    const rotRad = ((underlay.rotationDeg ?? 0) * Math.PI) / 180;
    // Inverse rotation: -rotRad
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);

    const scaledX = world.x * pxPerM;
    const scaledY = world.y * pxPerM;

    const du = scaledX * cos - scaledY * sin;
    const dv = -(scaledX * sin + scaledY * cos);

    return Result.ok({
        u: origin.u + du,
        v: origin.v + dv,
    });
}

/**
 * Helper to create an underlay with default settings.
 */
export function createImageUnderlay(options: {
    id: string;
    name: string;
    imageUri: string;
    widthPx: number;
    heightPx: number;
    calibration?: ImageCalibration;
    originPixel?: PixelCoord;
    rotationDeg?: number;
    opacity?: number;
    visible?: boolean;
}): ImageUnderlay {
    return {
        id: options.id,
        name: options.name,
        imageUri: options.imageUri,
        widthPx: options.widthPx,
        heightPx: options.heightPx,
        calibration: options.calibration,
        originPixel: options.originPixel,
        rotationDeg: options.rotationDeg ?? 0,
        opacity: options.opacity ?? 0.8,
        visible: options.visible ?? true,
        disclaimer: REQUIRED_DISCLAIMER,
    };
}
