// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type ICircle, type ICurve, type ILine, Plane, Precision, XYZ } from "@chili3d/core";

/**
 * Compute arc geometry from 3 points on a circle.
 * A: arc start, B: point on arc path, C: arc end.
 * Returns the center, normal, start point, and signed angle (degrees) for ArcNode.
 */
export function computeArcFromPoints(A: XYZ, B: XYZ, C: XYZ) {
    const circle = computeCircleFromPoints(A, B, C);
    if (!circle) return undefined;

    const OA = A.sub(circle.center).normalize()!;
    const OB = B.sub(circle.center).normalize()!;
    const OC = C.sub(circle.center).normalize()!;

    const angleB = positiveAngle(OA, OB, circle.normal);
    const angleC = positiveAngle(OA, OC, circle.normal);

    const arcAngle = angleB <= angleC ? angleC : angleC - 2 * Math.PI;

    return {
        center: circle.center,
        normal: circle.normal,
        start: A,
        D: circle.D,
        angle: (arcAngle * 180) / Math.PI,
    };
}

/**
 * Compute circle geometry from 3 points.
 * A: arc start, B: point on arc path, C: arc end.
 */
export function computeCircleFromPoints(A: XYZ, B: XYZ, C: XYZ) {
    const AB = B.sub(A);
    const AC = C.sub(A);
    const nvec = AB.cross(AC);
    if (nvec.length() < 1e-10) return undefined;

    const normal = nvec.normalize()!;
    const xvec = AB.normalize()!;
    const yvec = normal.cross(xvec).normalize()!;

    const bx = AB.dot(xvec);
    const by = AB.dot(yvec);
    const cx = AC.dot(xvec);
    const cy = AC.dot(yvec);

    const D = 2 * (bx * cy - cx * by);
    if (Math.abs(D) < 1e-10) return undefined;

    const ux = ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / D;
    const uy = ((bx * bx + by * by) * -cx + (cx * cx + cy * cy) * bx) / D;

    const center = A.add(xvec.multiply(ux)).add(yvec.multiply(uy));
    return {
        center,
        D,
        normal,
        xvec,
        yvec,
    };
}

function positiveAngle(from: XYZ, to: XYZ, normal: XYZ): number {
    const dot = from.dot(to);
    const crossVec = from.cross(to);
    const crossVal = normal.dot(crossVec);
    let angle = Math.atan2(crossVal, dot);
    if (angle < 0) angle += 2 * Math.PI;
    return angle;
}

type CurveLocus =
    | { kind: "line"; point: XYZ; direction: XYZ }
    | { kind: "circle"; center: XYZ; radius: number };

const COPLANAR_TOLERANCE = 1e-6;

/** Unwrap trimmed curves to their basis curve (line, circle, ...). */
export function basisCurveOf(curve: ICurve): ICurve {
    let result = curve;
    while (CurveUtils.isTrimmed(result)) {
        result = result.basisCurve;
    }
    return result;
}

/** Whether the basis curve of an edge is supported by the tangent-tangent-radius solver. */
export function isTangentRadiusCurve(curve: ICurve): boolean {
    const basis = basisCurveOf(curve);
    return CurveUtils.isLine(basis) || CurveUtils.isCircle(basis);
}

/** The plane both curves lie in, used for radius input and preview; undefined when not coplanar. */
export function tangentCurvesPlane(curve1: ICurve, curve2: ICurve, origin: XYZ, xvec: XYZ) {
    const normal = tangentPlaneNormal(curve1, curve2);
    if (normal === undefined || !areCoplanar(curve1, curve2, normal)) return undefined;
    const x = xvec.sub(normal.multiply(xvec.dot(normal))).normalize();
    return x === undefined ? undefined : new Plane({ normal, origin, xvec: x });
}

/**
 * Compute an arc with the given radius tangent to two curves (lines or circles).
 * refPoint1/refPoint2 (usually the pick points) disambiguate between the multiple solutions.
 * Returns the center, normal, start/end tangent points and signed angle (degrees) for ArcNode,
 * or undefined when the curves are unsupported, not coplanar, or no solution exists.
 */
export function computeTangentTangentRadiusArc(
    curve1: ICurve,
    refPoint1: XYZ,
    curve2: ICurve,
    refPoint2: XYZ,
    radius: number,
) {
    const normal = tangentPlaneNormal(curve1, curve2);
    if (normal === undefined || radius < Precision.Distance || !areCoplanar(curve1, curve2, normal)) {
        return undefined;
    }

    const centers = dedupePoints(
        offsetLoci(curve1, normal, radius).flatMap((a) =>
            offsetLoci(curve2, normal, radius).flatMap((b) => intersectLoci(a, b, normal)),
        ),
    );

    let best: { center: XYZ; t1: XYZ; t2: XYZ; score: number } | undefined;
    for (const center of centers) {
        const t1 = tangentPoint(curve1, center);
        const t2 = tangentPoint(curve2, center);
        if (t1 === undefined || t2 === undefined) continue;
        const score = t1.distanceTo(refPoint1) + t2.distanceTo(refPoint2);
        if (best === undefined || score < best.score) best = { center, t1, t2, score };
    }
    if (best === undefined) return undefined;

    return {
        center: best.center,
        normal,
        start: best.t1,
        end: best.t2,
        angle: (sweepAngle(best.center, best.t1, best.t2, normal, refPoint1, refPoint2) * 180) / Math.PI,
    };
}

function linePoint(line: ILine): XYZ {
    // firstParameter() of an infinite line is astronomical (see OccLine); parameter 0 is its finite origin.
    return line.value(0);
}

/** The normal of the plane both curves must lie in, or undefined when unsupported/impossible. */
function tangentPlaneNormal(curve1: ICurve, curve2: ICurve): XYZ | undefined {
    const isCircle1 = CurveUtils.isCircle(curve1);
    const isCircle2 = CurveUtils.isCircle(curve2);

    if (isCircle1 && isCircle2) {
        const axis = curve1.axis.normalize();
        return axis !== undefined && curve2.axis.isParallelTo(axis) ? axis : undefined;
    }

    if (isCircle1 || isCircle2) {
        const circle = (isCircle1 ? curve1 : curve2) as ICircle;
        const line = (isCircle1 ? curve2 : curve1) as ILine;
        if (!CurveUtils.isLine(line)) return undefined;
        const axis = circle.axis.normalize();
        const direction = line.direction.normalize();
        return axis !== undefined && direction !== undefined && direction.isPerpendicularTo(axis)
            ? axis
            : undefined;
    }

    if (!CurveUtils.isLine(curve1) || !CurveUtils.isLine(curve2)) return undefined;
    const d1 = curve1.direction.normalize();
    const d2 = curve2.direction.normalize();
    if (d1 === undefined || d2 === undefined) return undefined;
    if (!d1.isParallelTo(d2)) return d1.cross(d2).normalize();
    // Parallel lines: the normal comes from the vector between them (undefined when coincident).
    return d1.cross(linePoint(curve2).sub(linePoint(curve1))).normalize();
}

function curveReferencePoint(curve: ICurve): XYZ | undefined {
    if (CurveUtils.isLine(curve)) return linePoint(curve);
    if (CurveUtils.isCircle(curve)) return curve.center;
    return undefined;
}

function areCoplanar(curve1: ICurve, curve2: ICurve, normal: XYZ): boolean {
    const p1 = curveReferencePoint(curve1);
    const p2 = curveReferencePoint(curve2);
    return p1 !== undefined && p2 !== undefined && Math.abs(p2.sub(p1).dot(normal)) <= COPLANAR_TOLERANCE;
}

/** Loci of the centers of all circles with the given radius tangent to the curve. */
function offsetLoci(curve: ICurve, normal: XYZ, radius: number): CurveLocus[] {
    if (CurveUtils.isLine(curve)) {
        const direction = curve.direction.normalize()!;
        const side = normal.cross(direction);
        const point = linePoint(curve);
        return [1, -1].map((sign) => ({
            kind: "line",
            point: point.add(side.multiply(sign * radius)),
            direction,
        }));
    }

    if (CurveUtils.isCircle(curve)) {
        const loci: CurveLocus[] = [{ kind: "circle", center: curve.center, radius: curve.radius + radius }];
        const inner = Math.abs(curve.radius - radius);
        if (inner > Precision.Distance) loci.push({ kind: "circle", center: curve.center, radius: inner });
        return loci;
    }

    return [];
}

function intersectLoci(a: CurveLocus, b: CurveLocus, normal: XYZ): XYZ[] {
    if (a.kind === "line" && b.kind === "line") return intersectLines(a, b, normal);
    if (a.kind === "circle" && b.kind === "circle") return intersectCircles(a, b, normal);
    return intersectLineCircle(a, b);
}

type LineLocus = Extract<CurveLocus, { kind: "line" }>;
type CircleLocus = Extract<CurveLocus, { kind: "circle" }>;

/** Crossing of two in-plane lines: the one point where both directions agree on `normal`. */
function intersectLines(a: LineLocus, b: LineLocus, normal: XYZ): XYZ[] {
    const denominator = a.direction.cross(b.direction).dot(normal);
    if (Math.abs(denominator) < Precision.Float) return [];
    const w = b.point.sub(a.point);
    const t = w.cross(b.direction).dot(normal) / denominator;
    return [a.point.add(a.direction.multiply(t))];
}

/** Standard two-circle intersection, mirrored across the line joining the centres. */
function intersectCircles(a: CircleLocus, b: CircleLocus, normal: XYZ): XYZ[] {
    const between = b.center.sub(a.center);
    const distance = between.length();
    if (distance < Precision.Float) return [];
    if (distance > a.radius + b.radius + COPLANAR_TOLERANCE) return [];
    if (distance < Math.abs(a.radius - b.radius) - COPLANAR_TOLERANCE) return [];
    const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
    const unit = between.divided(distance)!;
    const side = normal.cross(unit);
    const base = a.center.add(unit.multiply(along));
    return dedupePoints([base.add(side.multiply(height)), base.add(side.multiply(-height))]);
}

/** Where a line meets a circle, resolved as a quadratic along the line's direction. */
function intersectLineCircle(a: CurveLocus, b: CurveLocus): XYZ[] {
    const [line, circle] = a.kind === "line" ? [a, b] : [b, a];
    if (line.kind !== "line" || circle.kind !== "circle") return [];
    const f = line.point.sub(circle.center);
    const halfB = f.dot(line.direction);
    const discriminant = halfB * halfB - (f.lengthSq() - circle.radius * circle.radius);
    if (discriminant < -COPLANAR_TOLERANCE) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return dedupePoints([
        line.point.add(line.direction.multiply(-halfB + root)),
        line.point.add(line.direction.multiply(-halfB - root)),
    ]);
}

/** The point where a circle centered at `center` touches the curve. */
function tangentPoint(curve: ICurve, center: XYZ): XYZ | undefined {
    if (CurveUtils.isLine(curve)) {
        const direction = curve.direction.normalize()!;
        const point = linePoint(curve);
        return point.add(direction.multiply(center.sub(point).dot(direction)));
    }
    if (CurveUtils.isCircle(curve)) {
        const radial = center.sub(curve.center).normalize();
        return radial === undefined ? undefined : curve.center.add(radial.multiply(curve.radius));
    }
    return undefined;
}

/**
 * The signed sweep angle (radians) from t1 to t2 around the normal. Both the short and
 * the long way are tangent arcs - pick the one whose midpoint is closer to the reference
 * midpoint, so the arc faces the points the user picked.
 */
function sweepAngle(center: XYZ, t1: XYZ, t2: XYZ, normal: XYZ, refPoint1: XYZ, refPoint2: XYZ): number {
    const v1 = t1.sub(center);
    const v2 = t2.sub(center);
    const angle = Math.atan2(normal.dot(v1.cross(v2)), v1.dot(v2));
    const alternative = angle > 0 ? angle - 2 * Math.PI : angle + 2 * Math.PI;

    const refMid = XYZ.center(refPoint1, refPoint2);
    const arcMid = (a: number) => center.add(v1.rotate(normal, a / 2)!);
    return arcMid(angle).distanceTo(refMid) <= arcMid(alternative).distanceTo(refMid) ? angle : alternative;
}

function dedupePoints(points: XYZ[]): XYZ[] {
    const result: XYZ[] = [];
    for (const point of points) {
        if (!result.some((x) => x.isEqualTo(point, COPLANAR_TOLERANCE))) result.push(point);
    }
    return result;
}
