// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * What a sketch dimension needs on top of the shared planar layout: the sketch's own
 * text size, the datum formatting, and the sizes a refresh passes down. The geometry
 * itself — extension lines, arrows, arcs, the text anchor — is core's
 * `model/planarDimensionLayout`, which the 3D annotations lift onto their own plane; the
 * sketch draws it straight in uv.
 *
 * All furniture sizes derive from `px` (world units per screen pixel), so arrows and gaps
 * keep a constant on-screen size at any zoom, while the text is a step taller than the
 * drafting base — see `SKETCH_TEXT_HEIGHT_PX`.
 */

export {
    angleDimension,
    angleVertex,
    axisDistanceDimension,
    type DimensionGeometry,
    type DimensionGraphics,
    type DimensionLabel,
    type DimensionSize,
    diameterDimension,
    distanceDimension,
    labelOnAxis,
    labelOnSegment,
    leaderDimension,
    lineIntersection,
    measuresSupplement,
    type Point2,
    pointLineDistance,
    pointLineDistanceDimension,
    pointLineFoot,
    pointLineSignedDistance,
    pushDimensionGeometry,
    radiusDimension,
    segmentAlong,
    segmentOffset,
    signedSweep,
} from "@chili3d/core";
export type { DimensionAnchor, RadiusDisplay } from "../sketchModel";
export { radiusDisplayOf, toDisplayDatum, toStorageDatum } from "../sketchModel";

import {
    type DimensionMeasurement,
    type DimensionSize,
    formatMeasurement,
    type ParameterValue,
    type Point2,
    pointLineSignedDistance,
} from "@chili3d/core";
import { ConstraintKind, type RadiusDisplay, toDisplayDatum } from "../sketchModel";

/**
 * Sketch dimension text height in screen pixels — a step up from the 12px of the
 * badges behind it, so the mesh text reads as the primary content. Note it is *not* the
 * 12px the drafting furniture is sized against: the sketch's arrows and gaps stay at the
 * drafting scale while its text reads bigger.
 */
export const SKETCH_TEXT_HEIGHT_PX = 23;

/** The sizes one sketch refresh draws its dimensions at, from its world-units-per-pixel. */
export function sketchDimensionSize(px: number): DimensionSize {
    return { scale: px, textHeight: SKETCH_TEXT_HEIGHT_PX * px };
}

/**
 * How a constraint kind reads: a radius dimension is a radius — or a diameter, when the
 * constraint says so — an angle one an angle, and a conic's rho the ratio it is.
 */
export function measurementOf(kind: ConstraintKind, display: RadiusDisplay = "radius"): DimensionMeasurement {
    switch (kind) {
        case ConstraintKind.Radius:
            return display === "diameter" ? "diameter" : "radius";
        case ConstraintKind.Angle:
            return "angle";
        case ConstraintKind.ConicRho:
            return "rho";
        default:
            return "length";
    }
}

/**
 * The text a sketch dimension shows for a stored datum: an expression reads as written —
 * that name IS the user's intent, and it is written in the same reading the dimension
 * reads in — while a literal reads as its display value, with the digits and the affixes
 * every dimension reads with (`R`, `Ø`, `°`; see `dimensionText` in core). A diameter is
 * the one kind whose *value* differs from its datum as well as its affix: the constraint
 * underneath is a radius, so the reading is twice it (`toDisplayDatum`).
 */
export function formatDatum(
    kind: ConstraintKind,
    value: ParameterValue,
    display: RadiusDisplay = "radius",
): string {
    if (typeof value === "string") return value;
    return formatMeasurement(measurementOf(kind, display), toDisplayDatum(kind, value, display));
}

/**
 * A stored datum as the value the dialog that edits it opens on — what the user reads.
 * An expression comes back as written (it is written in the reading's units, and that name
 * is the user's intent); a literal is converted out of storage units into them, which is
 * where the angle's degrees and a diameter's doubling live (`toDisplayDatum`).
 *
 * The inverse of `setDatumSource`, which is what the dialog hands back when it closes.
 */
export function datumReading(
    kind: ConstraintKind,
    value: ParameterValue,
    display: RadiusDisplay = "radius",
): ParameterValue {
    if (typeof value !== "number") return value;
    return toDisplayDatum(kind, value, display);
}

/**
 * The same text for a driven dimension, in the parentheses SolidWorks, Fusion and Onshape
 * all read a reference value with — so the text alone says the number is the geometry's
 * rather than the user's, in a screenshot or through a colour vision deficiency, neither
 * of which the tone colour survives. The tone is still drawn; this is what carries it.
 */
export function formatDrivenDatum(
    kind: ConstraintKind,
    value: ParameterValue,
    display: RadiusDisplay = "radius",
): string {
    return `(${formatDatum(kind, value, display)})`;
}

/**
 * A point-line distance in the two forms the sketch keeps of it: the number garlic holds and the
 * number the dimension reads. The layout's signed distance is positive to the *left* of the line's
 * direction and garlic's to the right, so the stored one is its negation — and since the sign is a
 * side marker either way, what the dimension reads is the magnitude of that same number rather
 * than a second conversion of it (`datumSignIsSide`).
 *
 * Every point-line dimension is built here — the pick's, the parallel lines', and the offset's
 * tie — so the two readings cannot drift apart between tools.
 */
export function pointLineReading(p: Point2, l1: Point2, l2: Point2): { datum: number; reading: number } {
    const datum = -pointLineSignedDistance(p, l1, l2);
    return { datum, reading: Math.abs(datum) };
}
