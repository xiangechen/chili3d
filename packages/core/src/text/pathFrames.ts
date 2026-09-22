// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "../foundation";
import type { XYZ } from "../math";
import { type ICurve, type IEdge, type IWire, ShapeTypes } from "../shape";

/** How many points the path is sampled at when measuring its lengths. */
const SAMPLES = 128;

/**
 * A path a line of text can follow, measured once and then queried by distance.
 */
export interface PathFrames {
    /** Length of the path, in millimetres. */
    readonly length: number;
    /** The direction the text extrudes along. */
    readonly normal: XYZ;
    /** The frame at a distance along the path. Undefined where the path has no direction. */
    at(abscissa: number): PathFrame | undefined;
}

export interface PathFrame {
    point: XYZ;
    /** Unit direction of travel — where a glyph's own +x points. */
    tangent: XYZ;
    /** Unit in-plane perpendicular — where a glyph's own +y points. */
    up: XYZ;
}

interface Sample {
    /** Distance along the path, in millimetres. */
    abscissa: number;
    /** Curve parameter at that distance. */
    parameter: number;
    point: XYZ;
}

/**
 * Measure a path so text can be laid along it. Each glyph is placed at its
 * distance along the path and rotated to the path's direction there — the glyph
 * itself keeps its shape, so a letter is never stretched to fit the curve.
 *
 * The text lies in the curve's own plane, which the path has to have: a curve
 * that is flat determines the plane its text stands in, and one that is not
 * would need a rule for how the letters twist along it. `facing` says which side
 * of that plane the text extrudes toward, so the caller's working plane decides
 * it rather than the direction the curve happens to have been drawn in.
 */
export function pathFrames(path: IEdge | IWire, facing: XYZ): Result<PathFrames> {
    const edge = firstEdge(path);
    if (edge === undefined) return Result.err("The path has no edge to follow");

    const curve = edge.curve;
    const length = curve.length();
    if (length <= Precision.Distance) return Result.err("The path has no length");

    const points = curve.uniformAbscissaByCount(SAMPLES);
    if (points.length < 3) return Result.err("The path is too short to place text along");

    const plane = planeNormal(points);
    if (plane === undefined) {
        return Result.err("The path is straight, so it fixes no plane — place the text on a plane instead");
    }
    const normal = plane.dot(facing) < 0 ? plane.reverse() : plane;

    const samples = buildSamples(curve, points, length);
    if (samples === undefined) return Result.err("The path could not be measured along its length");

    return Result.ok({
        length,
        normal,
        at: frameLocator(curve, samples, length, normal, curve.isPeriodic()),
    });
}

/**
 * How a distance becomes a frame. A loop has no end to run off, so what goes past its seam
 * comes round again — which is what a line of text set on a ring is read as. An open path has
 * an end, and the text keeps on the way that end was heading: a line that reaches the end of a
 * curve reads on from where it left off rather than piling up on the last point, and how far
 * it runs on says how much of it did not fit.
 */
function frameLocator(
    curve: ICurve,
    samples: readonly Sample[],
    length: number,
    normal: XYZ,
    periodic: boolean,
): (abscissa: number) => PathFrame | undefined {
    return (abscissa) =>
        periodic
            ? frameAt(curve, samples, ((abscissa % length) + length) % length, normal)
            : extrapolated(curve, samples, abscissa, length, normal);
}

/** The frame at a distance, which past either end is the end's frame carried on straight. */
function extrapolated(
    curve: ICurve,
    samples: readonly Sample[],
    abscissa: number,
    length: number,
    normal: XYZ,
): PathFrame | undefined {
    const clamped = Math.max(0, Math.min(length, abscissa));
    const frame = frameAt(curve, samples, clamped, normal);
    if (frame === undefined || clamped === abscissa) return frame;

    return { ...frame, point: frame.point.add(frame.tangent.multiply(abscissa - clamped)) };
}

function firstEdge(path: IEdge | IWire): IEdge | undefined {
    if (path.shapeType !== ShapeTypes.wire) return path as IEdge;
    return path.findSubShapes(ShapeTypes.edge)[0] as IEdge | undefined;
}

/**
 * The normal of the plane the samples lie in, by summing the turns between
 * consecutive steps: each turn of a flat curve about the same axis, so their sum
 * is that axis. Steps that turn the other way cancel, which is why a
 * mirror-symmetric path still needs the sum rather than a single triple.
 * Undefined when the samples are collinear — a straight path.
 */
function planeNormal(points: readonly XYZ[]): XYZ | undefined {
    let sum = points[0].multiply(0);
    for (let i = 1; i + 1 < points.length; i++) {
        sum = sum.add(points[i].sub(points[i - 1]).cross(points[i + 1].sub(points[i])));
    }

    const normal = sum.normalize();
    // A curve barely off straight sums to a tiny vector whose direction is noise.
    const span = points[0].sub(points[points.length - 1]).length();
    return normal !== undefined && sum.length() > 1e-6 * span * span ? normal : undefined;
}

/**
 * Pair each sampled point with its distance and its curve parameter, so a
 * distance can be turned back into a point on the curve. The parameters come
 * from the curve itself: `uniformAbscissaByCount` spaces the points equally by
 * length but a curve's parameter rarely moves in step with its length.
 */
function buildSamples(curve: ICurve, points: readonly XYZ[], length: number): Sample[] | undefined {
    const step = length / (points.length - 1);
    const period = curve.isPeriodic() ? curve.period() : 0;
    const samples: Sample[] = [];
    let previous = Number.NEGATIVE_INFINITY;

    for (const [index, point] of points.entries()) {
        let parameter = curve.parameter(point, Precision.Distance);
        if (parameter === undefined) return undefined;

        // A loop's seam is the same point at both ends of its range, and asking
        // for the parameter of that point answers with the start of the range.
        // The samples are ordered along the curve, so a step back means the seam
        // was crossed — take the next turn of the curve instead.
        while (period > 0 && parameter < previous) parameter += period;

        samples.push({ abscissa: index * step, parameter, point });
        previous = parameter;
    }

    return samples;
}

function frameAt(
    curve: ICurve,
    samples: readonly Sample[],
    abscissa: number,
    normal: XYZ,
): PathFrame | undefined {
    const upper = indexOfFirstPast(samples, abscissa);
    const before = samples[upper - 1];
    const after = samples[upper];

    // The parameter is interpolated, not the point: the abscissa is exact at each
    // sample, so between two of them the parameter moves smoothly, and evaluating
    // the curve keeps the glyph exactly on it rather than on a chord.
    const ratio =
        after.abscissa === before.abscissa
            ? 0
            : (abscissa - before.abscissa) / (after.abscissa - before.abscissa);
    const parameter = before.parameter + (after.parameter - before.parameter) * ratio;
    const point = curve.value(parameter);

    // A curve has no direction where its derivative vanishes, and there is no
    // placing a glyph there rather than guessing one.
    const tangent = curve.d1(parameter).vec.normalize();
    if (tangent === undefined) return undefined;
    const up = normal.cross(tangent).normalize();
    if (up === undefined) return undefined;

    return { point, tangent, up };
}

/** Index of the first sample at or past `abscissa`, never past the last one. */
function indexOfFirstPast(samples: readonly Sample[], abscissa: number): number {
    let low = 1;
    let high = samples.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (samples[middle].abscissa < abscissa) low = middle + 1;
        else high = middle;
    }
    return low;
}
