// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, type XYZ } from "@chili3d/core";

/**
 * The pure geometry of the primitive commands' pick flow — pulled out of the command classes
 * so the sign bookkeeping is testable without a viewport. All vectors are world space.
 */

/** The rectangle a two-point drag means on its plane: signed spans along the plane's x/y. */
export interface RectDragData {
    /** The drag plane translated to the first corner. */
    readonly plane: Plane;
    readonly dx: number;
    readonly dy: number;
}

/** The drag's signed spans — the app's `getReactData` (rect.ts), re-homed on the core types. */
export function rectDataOnPlane(atPlane: Plane, start: XYZ, end: XYZ): RectDragData {
    const plane = new Plane({ origin: start, normal: atPlane.normal, xvec: atPlane.xvec });
    const vector = end.sub(start);
    return { plane, dx: vector.dot(plane.xvec), dy: vector.dot(plane.yvec) };
}

/**
 * A signed drag span pair as the feature stores it: sizes are always positive, so a negative
 * span folds into the origin (shifted along its frame axis by exactly that span). The world
 * rectangle is unchanged — only the description is canonical.
 */
export function normalizeSignedRect(
    origin: XYZ,
    xvec: XYZ,
    yvec: XYZ,
    dx: number,
    dy: number,
): { origin: XYZ; dx: number; dy: number } {
    const shifted = origin.add(xvec.multiply(Math.min(dx, 0))).add(yvec.multiply(Math.min(dy, 0)));
    return { origin: shifted, dx: Math.abs(dx), dy: Math.abs(dy) };
}

/**
 * A signed height as the feature stores it: height is always positive, so a drag against the
 * plane normal flips the stored axis instead — the app's create commands' semantics (a
 * downward cylinder reports its axis reversed, not a negative height).
 */
export function signedHeightAxis(normal: XYZ, signedHeight: number): { axis: XYZ; height: number } {
    return signedHeight < 0
        ? { axis: normal.reverse(), height: -signedHeight }
        : { axis: normal, height: signedHeight };
}
