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
    distanceDimension,
    labelOnAxis,
    labelOnSegment,
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
export type { DimensionAnchor } from "../sketchModel";
export { toDisplayDatum, toStorageDatum } from "../sketchModel";

import {
    type DimensionMeasurement,
    type DimensionSize,
    formatMeasurement,
    type ParameterValue,
} from "@chili3d/core";
import { ConstraintKind, toDisplayDatum } from "../sketchModel";

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

/** How a constraint kind reads: a radius dimension is a radius, an angle one an angle. */
function measurementOf(kind: ConstraintKind): DimensionMeasurement {
    switch (kind) {
        case ConstraintKind.Radius:
            return "radius";
        case ConstraintKind.Angle:
            return "angle";
        default:
            return "length";
    }
}

/**
 * The text a sketch dimension shows for a stored datum: an expression reads as written —
 * that name IS the user's intent — while a literal reads as its display value, with the
 * digits and the affixes every dimension reads with (`R`, `°`; see `dimensionText` in core).
 */
export function formatDatum(kind: ConstraintKind, value: ParameterValue): string {
    if (typeof value === "string") return value;
    return formatMeasurement(measurementOf(kind), toDisplayDatum(kind, value));
}
