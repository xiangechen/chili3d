// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    arcAngles,
    defaultNurbsSpec,
    type NurbsSpec,
    type OffsetCurveRef,
    type SketchEntityData,
    type SketchEntityType,
} from "./sketchModel";

/**
 * Numeric 2D curve evaluation for the sketch: sampling, projection, closest pairs,
 * crossings and bezier splitting. Everything here is a pure function of an entity's
 * params — no solver, no kernel — so the solver (constraint seeds), the editor
 * (meshes, hit distances), the auto-constraints (projections, tangency gaps) and the
 * curve ops (trim/extend/break arithmetic) all read the same geometry the same way.
 *
 * The types needing real numerics are the ellipse family, the conic, the cubic bezier
 * and the NURBS; the line, circle and arc get adapters too, so a mixed pair of curves
 * goes through one code path (`intersectCurves`, `closestCurvePair`).
 */

/** The part of an entity the curve math reads — the structure a NURBS needs included. */
export type CurveEntity = Pick<SketchEntityData, "type" | "params" | "nurbs" | "offset">;

/** The point on an entity nearest a probe, in the entity's natural parameter. */
export interface CurveProjection {
    readonly point: [number, number];
    /**
     * Natural parameter: the angle for the circle/ellipse families, the bezier t ∈ [0, 1]
     * for the conic and the cubic bezier, the knot parameter for a NURBS (whose domain is
     * [knots[degree], knots[poles]] rather than [0, 1]).
     */
    readonly t: number;
    readonly distance: number;
}

/** The nearest pair of points between two entities' drawn curves. */
export interface CurvePairClosest {
    readonly pointA: [number, number];
    readonly pointB: [number, number];
    readonly tA: number;
    readonly tB: number;
    readonly distance: number;
}

/** One crossing of two entities, with both natural parameters at it. */
export interface CurveIntersection {
    readonly point: [number, number];
    readonly tA: number;
    readonly tB: number;
}

/**
 * One entity as a parametrized curve: its value and derivative at a natural
 * parameter, the domain the drawn curve covers, and the domain crossings are
 * searched on (the *support curve* — a line's infinite extent made finite, an
 * ellipseArc's whole ellipse, a bezier's clamped extrapolation). `period` is the
 * parameter wrap of the closed families, 0 for the open ones.
 */
interface CurveAdapter {
    evaluate(t: number): [number, number];
    derivative(t: number): [number, number];
    domain: [number, number];
    support: [number, number];
    period: number;
}

const FULL_TURN = Math.PI * 2;

// ------------------------------------------------------------------ Ellipse family

/** The ellipse family's frame: centre, major axis vector (m − c), minor axis vector (n − c). */
export function ellipseAxes(params: readonly number[]): {
    center: [number, number];
    u: [number, number];
    v: [number, number];
} {
    const [cx, cy, mx, my, nx, ny] = params;
    return { center: [cx, cy], u: [mx - cx, my - cy], v: [nx - cx, ny - cy] };
}

/** The ellipse point at parameter t: c + u·cos t + v·sin t. */
export function evaluateEllipse(params: readonly number[], t: number): [number, number] {
    const { center, u, v } = ellipseAxes(params);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return [center[0] + u[0] * cos + v[0] * sin, center[1] + u[1] * cos + v[1] * sin];
}

/** The ellipse's derivative at t: −u·sin t + v·cos t. */
export function ellipseDerivative(params: readonly number[], t: number): [number, number] {
    const { u, v } = ellipseAxes(params);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return [v[0] * cos - u[0] * sin, v[1] * cos - u[1] * sin];
}

/**
 * The ellipse parameter of a point: exact when the point lies on the ellipse and
 * the axes are perpendicular (which the entity's structural constraint keeps true),
 * the natural seed for the projection's Newton step otherwise.
 */
export function ellipseParameterOf(params: readonly number[], point: readonly [number, number]): number {
    const { center, u, v } = ellipseAxes(params);
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const uu = u[0] * u[0] + u[1] * u[1];
    const vv = v[0] * v[0] + v[1] * v[1];
    const cos = uu < 1e-30 ? 0 : (dx * u[0] + dy * u[1]) / uu;
    const sin = vv < 1e-30 ? 0 : (dx * v[0] + dy * v[1]) / vv;
    return Math.atan2(sin, cos);
}

/**
 * An ellipseArc's swept parameter range [tStart, tEnd], tEnd > tStart, sweeping
 * counter-clockwise — the same convention `arcAngles` gives an arc: a collapsed
 * end ray reads as the full ellipse.
 */
export function ellipseSweep(params: readonly number[]): [number, number] {
    const start = ellipseParameterOf(params, [params[6], params[7]]);
    let end = ellipseParameterOf(params, [params[8], params[9]]);
    if (end <= start + 1e-12) end += FULL_TURN;
    return [start, end];
}

// ------------------------------------------------------------------ Bezier family (conic, cubic)

/** The middle weight of a conic's standard form [1, w, 1]: w = ρ/(1−ρ). */
export function conicWeight(rho: number): number {
    return rho / (1 - rho);
}

/**
 * A conic's shoulder point: the bezier's midpoint t = ½, which is where its rho
 * reads — M + ρ·(C−M) with M the chord's midpoint and C the control point. The rho
 * dimension's leader points here.
 */
export function conicShoulder(params: readonly number[]): [number, number] {
    const [sx, sy, cx, cy, ex, ey, rho] = params;
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    return [mx + rho * (cx - mx), my + rho * (cy - my)];
}

/** The rho of a standard-form middle weight: ρ = w/(1+w). */
export function rhoFromWeight(w: number): number {
    return w / (1 + w);
}

/**
 * The control points a free curve is evaluated from: a conic's three (start, control,
 * end), a cubic bezier's four, a NURBS' every control point — which is where a NURBS'
 * params run out and its weights begin.
 */
export function curveControlPoints(entity: CurveEntity): [number, number][] {
    const count =
        entity.type === "conic" ? 6 : entity.type === "nurbs" ? nurbsPoleCount(entity.params) * 2 : 8;
    const poles: [number, number][] = [];
    for (let i = 0; i + 1 < count; i += 2) {
        poles.push([entity.params[i], entity.params[i + 1]]);
    }
    return poles;
}

/** The rational weights of a conic ([1, w, 1] from its rho) or a NURBS; a cubic bezier has none. */
export function curveWeights(entity: CurveEntity): number[] | undefined {
    if (entity.type === "conic") return [1, conicWeight(entity.params[6]), 1];
    if (entity.type === "nurbs") return nurbsWeights(entity.params);
    return undefined;
}

/** The lifted (homogeneous) pole of a bezier control point: (w·x, w·y, w). */
type HomogeneousPole = [number, number, number];

function liftPoles(poles: readonly [number, number][], weights?: readonly number[]): HomogeneousPole[] {
    return poles.map((p, i) => {
        const w = weights?.[i] ?? 1;
        return [p[0] * w, p[1] * w, w];
    });
}

function lerpPole(a: HomogeneousPole, b: HomogeneousPole, t: number): HomogeneousPole {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** de Casteljau on homogeneous poles, valid for any t — extrapolation included. */
function deCasteljau(poles: readonly HomogeneousPole[], t: number): HomogeneousPole {
    let level = poles.map((p) => [...p] as HomogeneousPole);
    for (let r = 1; r < poles.length; r++) {
        const next: HomogeneousPole[] = [];
        for (let i = 0; i + r < poles.length; i++) {
            next.push(lerpPole(level[i], level[i + 1], t));
        }
        level = next;
    }
    return level[0];
}

/** The bezier point at t; `weights` makes it the rational form (the conic's). */
export function evaluateBezier(
    poles: readonly [number, number][],
    t: number,
    weights?: readonly number[],
): [number, number] {
    const [x, y, w] = deCasteljau(liftPoles(poles, weights), t);
    return Math.abs(w) < 1e-30 ? [x, y] : [x / w, y / w];
}

/** The bezier's derivative at t, through the quotient rule on the homogeneous form. */
export function bezierDerivative(
    poles: readonly [number, number][],
    t: number,
    weights?: readonly number[],
): [number, number] {
    const lifted = liftPoles(poles, weights);
    const n = lifted.length - 1;
    const [x, y, w] = deCasteljau(lifted, t);
    const differences: HomogeneousPole[] = [];
    for (let i = 0; i < n; i++) {
        differences.push([
            (lifted[i + 1][0] - lifted[i][0]) * n,
            (lifted[i + 1][1] - lifted[i][1]) * n,
            (lifted[i + 1][2] - lifted[i][2]) * n,
        ]);
    }
    const [dx, dy, dw] =
        differences.length === 0 ? ([0, 0, 0] as HomogeneousPole) : deCasteljau(differences, t);
    const ww = w * w;
    return ww < 1e-30 ? [dx, dy] : [(dx * w - x * dw) / ww, (dy * w - y * dw) / ww];
}

export interface BezierSplit {
    readonly leftPoles: [number, number][];
    readonly rightPoles: [number, number][];
    readonly leftWeights?: number[];
    readonly rightWeights?: number[];
}

/**
 * The de Casteljau split at t: the poles of the two pieces [0, t] and [t, 1] of the
 * curve's *polynomial support*, so a t outside [0, 1] reparametrizes an extension —
 * which is what the extend op runs on. Rational curves split in homogeneous space.
 */
export function splitBezier(
    poles: readonly [number, number][],
    t: number,
    weights?: readonly number[],
): BezierSplit {
    let level = liftPoles(poles, weights);
    const left: HomogeneousPole[] = [level[0]];
    const right: HomogeneousPole[] = [level[level.length - 1]];
    for (let r = 1; r < poles.length; r++) {
        const next: HomogeneousPole[] = [];
        for (let i = 0; i + r < poles.length; i++) {
            next.push(lerpPole(level[i], level[i + 1], t));
        }
        left.push(next[0]);
        right.push(next[next.length - 1]);
        level = next;
    }
    right.reverse();
    const project = (pole: HomogeneousPole): [number, number] =>
        Math.abs(pole[2]) < 1e-30 ? [pole[0], pole[1]] : [pole[0] / pole[2], pole[1] / pole[2]];
    return {
        leftPoles: left.map(project),
        rightPoles: right.map(project),
        ...(weights === undefined
            ? {}
            : {
                  leftWeights: left.map((pole) => pole[2]),
                  rightWeights: right.map((pole) => pole[2]),
              }),
    };
}

/**
 * The poles (and weights) of the piece between t0 and t1, reparametrized to [0, 1], or
 * `undefined` when there is no span to take — a piece starting at the end.
 */
export function subBezier(
    poles: readonly [number, number][],
    t0: number,
    t1: number,
    weights?: readonly number[],
): { poles: [number, number][]; weights?: number[] } | undefined {
    const [from, to] = t0 <= t1 ? [t0, t1] : [t1, t0];
    // a piece that starts at the end is no piece: the reparametrization below divides by the
    // span it leaves, and at the end there is none
    if (1 - from <= 1e-12) return undefined;
    const right = splitBezier(poles, from, weights);
    if (to === 1) {
        return { poles: right.rightPoles, ...(right.rightWeights ? { weights: right.rightWeights } : {}) };
    }
    const rebased = splitBezier(right.rightPoles, (to - from) / (1 - from), right.rightWeights);
    return { poles: rebased.leftPoles, ...(rebased.leftWeights ? { weights: rebased.leftWeights } : {}) };
}

/**
 * The piece of a conic between t0 and t1 as a conic of its own: the poles of the
 * reparametrized rational quadratic, and its rho back in standard form. A rational
 * quadratic's shape is carried by w₁²/(w₀·w₂), so normalizing the end weights to 1
 * changes the parametrization but not the traced arc. `undefined` when the piece is
 * degenerate — extrapolating past where the conic carries a standard form (a weight
 * of the pair went through zero) is the extend running off the support.
 */
export function subConic(
    poles: readonly [number, number][],
    rho: number,
    t0: number,
    t1: number,
): { poles: [number, number][]; rho: number } | undefined {
    const sub = subBezier(poles, t0, t1, [1, conicWeight(rho), 1]);
    if (sub === undefined) return undefined;
    const { poles: subPoles, weights } = sub;
    if (weights === undefined || weights.length !== 3) return undefined;
    const product = weights[0] * weights[2];
    if (product <= 1e-30) return undefined;
    const w = weights[1] / Math.sqrt(product);
    if (!(w > 0)) return undefined;
    return { poles: subPoles, rho: rhoFromWeight(w) };
}

// ------------------------------------------------------------------ NURBS

/**
 * The control points a NURBS' params carry. They come first — two coordinates each — and
 * the rational weights follow them, so the pole count is what the params' length says
 * divided by three. Must agree with `entityPointCount` and with garlic's own layout
 * (`PointOnNurbs` = head + 2n + n + t).
 */
export function nurbsPoleCount(params: readonly number[]): number {
    // floored: the layout is three params per pole, and a params list that is not a whole
    // number of them reads as the poles it does hold rather than as a fraction of one
    return Math.floor(params.length / 3);
}

/** A NURBS' control point coordinates — the params before its weights. */
export function nurbsPoleValues(params: readonly number[]): number[] {
    return params.slice(0, nurbsPoleCount(params) * 2);
}

/** A NURBS' rational weights: the params past its control points. */
export function nurbsWeights(params: readonly number[]): number[] {
    return params.slice(nurbsPoleCount(params) * 2);
}

/**
 * The construction constants a NURBS entity is read with — its own, or the clamped uniform
 * default for a half-built one (a tool's live preview carries poles and nothing else, and
 * the default is exactly what the tool would give the committed entity).
 *
 * A stored pair that does not fit the pole count is not a curve at all — hand-edited or
 * half-written data — and every read below would index past its knots, so it falls back to
 * the default rather than throwing from a rebuild path. Knots that do not ascend are the same
 * kind of not-a-curve (`nurbsSpan`'s search reads them as ordered), so they fall back too.
 */
export function nurbsSpec(entity: CurveEntity): NurbsSpec {
    const spec = entity.nurbs;
    const poles = nurbsPoleCount(entity.params);
    if (
        spec === undefined ||
        spec.degree < 1 ||
        spec.degree > poles - 1 ||
        spec.knots.length !== poles + spec.degree + 1 ||
        !knotsAscend(spec.knots)
    ) {
        return defaultNurbsSpec(poles);
    }
    return spec;
}

/** Whether every knot is at or past the one before it — the order `nurbsSpan`'s search reads. */
function knotsAscend(knots: readonly number[]): boolean {
    for (let i = 1; i < knots.length; i++) {
        if (knots[i] < knots[i - 1]) return false;
    }
    return true;
}

/** The parameter domain of a NURBS: the knots its first and last pole are clamped at. */
export function nurbsDomain(spec: NurbsSpec, poleCount: number): [number, number] {
    return [spec.knots[spec.degree], spec.knots[poleCount]];
}

/**
 * The span `t` falls in, in garlic's `find_span` convention: the last index whose knot is
 * not past `t`, clamped to the end spans. Past the domain the clamp is what makes the
 * boundary piece's polynomial the one that continues (see `nurbsBasis`).
 */
function nurbsSpan(poleCount: number, degree: number, knots: readonly number[], t: number): number {
    const last = poleCount - 1;
    if (t >= knots[last + 1]) return last;
    if (t <= knots[degree]) return degree;
    let low = degree;
    let high = last + 1;
    let mid = (low + high) >> 1;
    while (t < knots[mid] || t >= knots[mid + 1]) {
        if (t < knots[mid]) high = mid;
        else low = mid;
        mid = (low + high) >> 1;
    }
    return mid;
}

/**
 * The degree + 1 basis functions that are non-zero at `t`, and the index of the control
 * point the first of them weights — garlic's `nurbs.rs` recurrence, which its residuals
 * and Jacobian read. The two must agree exactly: a t seed computed here and a solve
 * running there would otherwise be talking about two different curves.
 */
function nurbsBasis(
    poleCount: number,
    degree: number,
    knots: readonly number[],
    t: number,
): { first: number; values: number[] } {
    const span = nurbsSpan(poleCount, degree, knots, t);
    const first = span - degree;
    let values = [1];
    for (let l = 1; l <= degree; l++) {
        const next = new Array<number>(l + 1).fill(0);
        for (let j = 0; j <= l; j++) {
            const i = first + degree - l + j;
            const left = knots[i + l] - knots[i];
            const right = knots[i + l + 1] - knots[i + 1];
            const before = left > 0 ? (t - knots[i]) / left : 0;
            const after = right > 0 ? (knots[i + l + 1] - t) / right : 0;
            next[j] = (j >= 1 ? before * values[j - 1] : 0) + (j < l ? after * values[j] : 0);
        }
        values = next;
    }
    return { first, values };
}

/** The homogeneous (w·x, w·y, w) form of a rational control point. */
function homogeneousPoints(
    poles: readonly [number, number][],
    weights: readonly number[],
): HomogeneousPole[] {
    return poles.map((point, index) => [
        point[0] * weights[index],
        point[1] * weights[index],
        weights[index],
    ]);
}

/**
 * The homogeneous point of a curve: A = Σ N·w·P and W = Σ N·w at `t`. A control point the
 * basis reaches past is one the structure does not have — a malformed entity, which a
 * tool's probe can be mid-gesture — and contributes nothing rather than throwing out of a
 * rebuild.
 */
function homogeneousAt(
    homogeneous: readonly HomogeneousPole[],
    degree: number,
    knots: readonly number[],
    t: number,
): HomogeneousPole {
    const { first, values } = nurbsBasis(homogeneous.length, degree, knots, t);
    const sum: HomogeneousPole = [0, 0, 0];
    for (let r = 0; r < values.length; r++) {
        const pole = homogeneous[first + r];
        if (pole === undefined) continue;
        const weight = values[r];
        sum[0] += weight * pole[0];
        sum[1] += weight * pole[1];
        sum[2] += weight * pole[2];
    }
    return sum;
}

/** The homogeneous point divided back out: the curve's Cartesian point. */
function fromHomogeneous(point: HomogeneousPole, fallback: readonly [number, number]): [number, number] {
    // garlic zeroes its whole row at this degeneracy; a position is what a caller needs,
    // and the boundary pole is the only one the curve has ever been near
    if (Math.abs(point[2]) <= 1e-12) return [fallback[0], fallback[1]];
    return [point[0] / point[2], point[1] / point[2]];
}

/** The rational B-spline point at t: C = A/W (garlic's `Cox–de Boor` + `C = A/W`). */
export function evaluateNurbs(
    poles: readonly [number, number][],
    weights: readonly number[],
    spec: NurbsSpec,
    t: number,
): [number, number] {
    const homogeneous = homogeneousPoints(poles, weights);
    return fromHomogeneous(homogeneousAt(homogeneous, spec.degree, spec.knots, t), poles[0]);
}

/**
 * The NURBS' derivative at t, through the derivative control points: a degree d B-spline
 * differentiates into a degree d−1 one whose homogeneous poles are
 * d·(H_{i+1} − H_i)/(k_{i+d+1} − k_{i+1}) — which is why the quotient rule has to run in
 * homogeneous space, where the subtraction and the division are both defined.
 */
export function nurbsDerivative(
    poles: readonly [number, number][],
    weights: readonly number[],
    spec: NurbsSpec,
    t: number,
): [number, number] {
    const { degree, knots } = spec;
    const homogeneous = homogeneousPoints(poles, weights);
    const value = homogeneousAt(homogeneous, degree, knots, t);
    if (degree < 1 || homogeneous.length < 2) return [0, 0];
    const differences: HomogeneousPole[] = [];
    for (let i = 0; i + 1 < homogeneous.length; i++) {
        const span = knots[i + degree + 1] - knots[i + 1];
        const scale = span > 1e-30 ? degree / span : 0;
        differences.push([
            (homogeneous[i + 1][0] - homogeneous[i][0]) * scale,
            (homogeneous[i + 1][1] - homogeneous[i][1]) * scale,
            (homogeneous[i + 1][2] - homogeneous[i][2]) * scale,
        ]);
    }
    const derivative = homogeneousAt(differences, degree - 1, knots.slice(1, knots.length - 1), t);
    if (Math.abs(value[2]) <= 1e-12) return [derivative[0], derivative[1]];
    const cx = value[0] / value[2];
    const cy = value[1] / value[2];
    return [(derivative[0] - derivative[2] * cx) / value[2], (derivative[1] - derivative[2] * cy) / value[2]];
}

/**
 * One knot insertion (Boehm): `u` gains a copy and the poles one entry, and the curve is
 * unchanged. The new pole is the convex combination α·H_i + (1−α)·H_{i−1} over the poles
 * the knot's interval reaches, α = (u − k_i)/(k_{i+d} − k_i) — in homogeneous space, where
 * the weights ride along. A no-op for a knot already at full multiplicity.
 */
function insertKnot(homogeneous: HomogeneousPole[], knots: number[], degree: number, u: number): void {
    let span = -1;
    for (let i = 0; i + 1 < knots.length; i++) {
        if (knots[i] <= u && u < knots[i + 1]) {
            span = i;
            break;
        }
    }
    if (span === -1) return;
    const multiplicity = knots.filter((knot) => knot === u).length;
    if (multiplicity > degree) return;
    const next: HomogeneousPole[] = [];
    for (let i = 0; i <= homogeneous.length; i++) {
        if (i <= span - degree) {
            next.push(homogeneous[i]);
        } else if (i >= span - multiplicity + 1) {
            next.push(homogeneous[i - 1]);
        } else {
            const interval = knots[i + degree] - knots[i];
            const alpha = interval > 0 ? (u - knots[i]) / interval : 0;
            next.push(lerpPole(homogeneous[i - 1], homogeneous[i], alpha));
        }
    }
    homogeneous.length = 0;
    homogeneous.push(...next);
    knots.splice(span + 1, 0, u);
}

/** A curve's poles and weights, projected back out of their homogeneous form. */
function fromHomogeneousPoles(
    homogeneous: readonly HomogeneousPole[],
): { poles: [number, number][]; weights: number[] } | undefined {
    const poles: [number, number][] = [];
    const weights: number[] = [];
    for (const pole of homogeneous) {
        // a non-positive weight is no longer a curve the kernel or garlic can carry
        if (pole[2] <= 1e-12) return undefined;
        poles.push([pole[0] / pole[2], pole[1] / pole[2]]);
        weights.push(pole[2]);
    }
    return { poles, weights };
}

/**
 * The piece of a NURBS between t0 and t1, or undefined when the pair is not a curve
 * (a weight driven through zero by the split). The cut parameters are each raised to full
 * multiplicity — which splits the curve there without moving it a bit — and the poles,
 * weights and knots on the kept side are then a curve in their own right. Unlike
 * `subBezier` the piece keeps the original parametrization: a NURBS' parameters are its
 * knots, so the piece is simply the part of the domain that was kept, and no
 * reparametrization is needed to express it.
 *
 * A parameter past one of the ends is the curve *extended* there rather than a refusal: the
 * end span's polynomial carried on (`extendNurbsEnd`), which is the same reading a bezier
 * gets past t = 1.
 */
export function subNurbs(
    poles: readonly [number, number][],
    weights: readonly number[],
    spec: NurbsSpec,
    t0: number,
    t1: number,
): { poles: [number, number][]; weights: number[]; spec: NurbsSpec } | undefined {
    const [from, to] = t0 <= t1 ? [t0, t1] : [t1, t0];
    const [domainStart, domainEnd] = nurbsDomain(spec, poles.length);
    let piece: HomogeneousCurve = { poles: homogeneousPoints(poles, weights), knots: [...spec.knots] };
    if (to > domainEnd + 1e-9) {
        const extended = extendNurbsEnd(piece, spec.degree, to);
        if (extended === undefined) return undefined;
        piece = extended;
    }
    if (from < domainStart - 1e-9) {
        const extended = extendNurbsStart(piece, spec.degree, from);
        if (extended === undefined) return undefined;
        piece = extended;
    }
    const [start, end] = nurbsDomain({ degree: spec.degree, knots: piece.knots }, piece.poles.length);
    // the two cuts, each keeping the side the piece keeps: past the first, before the second
    if (from > start) piece = cutPiece(piece, spec.degree, from).right;
    if (to < end) piece = cutPiece(piece, spec.degree, to).left;
    // a piece carries its degree: fewer control points than that is what a degenerate or
    // empty pair of parameters comes to, and is no curve at all
    if (piece.poles.length < spec.degree + 1) return undefined;
    const projected = fromHomogeneousPoles(piece.poles);
    if (projected === undefined) return undefined;
    return {
        poles: projected.poles,
        weights: projected.weights,
        spec: { degree: spec.degree, knots: piece.knots },
    };
}

/** A curve in homogeneous space: the poles it is drawn by, and the knots it is read with. */
interface HomogeneousCurve {
    readonly poles: HomogeneousPole[];
    readonly knots: number[];
}

/**
 * The curve split at `u` into the piece before it and the piece after, the two meeting at
 * the point `u` names. The knot is inserted until its multiplicity reaches the degree, which
 * is what makes the split exact — the curve is the same one either side — and the pole the
 * two pieces share is the last of the left and the first of the right.
 */
function cutPiece(
    curve: HomogeneousCurve,
    degree: number,
    u: number,
): { left: HomogeneousCurve; right: HomogeneousCurve } {
    const poles = [...curve.poles];
    const knots = [...curve.knots];
    for (let index = 0; index <= degree; index++) insertKnot(poles, knots, degree, u);
    const cut = lastIndexOfKnot(knots, u);
    return {
        left: { poles: poles.slice(0, cut - degree), knots: knots.slice(0, cut + 1) },
        right: { poles: poles.slice(cut - degree), knots: knots.slice(cut - degree) },
    };
}

/** The index of the last knot equal to `u` — where a split's shared pole sits. */
function lastIndexOfKnot(knots: readonly number[], u: number): number {
    let found = 0;
    for (let i = 0; i < knots.length; i++) {
        if (knots[i] === u) found = i;
    }
    return found;
}

// ------------------------------------------------------------------ Extending a NURBS

/**
 * The curve prolonged past its far end to `to`, or `undefined` when it cannot be — `to` no
 * further out than the end, or an end span too short to extrapolate over. `extendNurbsStart`
 * is the same going the other way.
 *
 * A bezier carries on past t = 1 for free: the polynomial its poles write keeps going, and
 * `evaluateBezier` reads it there. A NURBS is the same object only piece by piece — its
 * *end span* is a polynomial of the degree, and that polynomial is what continues. So the
 * work is to write the continuation back as a curve: the end span is cut off (which leaves
 * its own control points, the span being a bezier once its knots are at full multiplicity)
 * and one span's worth of poles is appended for the stretch beyond the end. The knots take
 * the old end as an interior knot of multiplicity `degree`, which is what makes the new
 * poles the ones the added span reads.
 *
 * The continuation is exact, not fitted: the two pieces are the same polynomial, so every
 * derivative agrees at the joint and the curve stays as smooth there as it was inside.
 */
function extendNurbsEnd(curve: HomogeneousCurve, degree: number, to: number): HomogeneousCurve | undefined {
    const last = curve.poles.length - 1;
    const joint = curve.knots[last + 1];
    const spanStart = curve.knots[last];
    const span = joint - spanStart;
    if (!(to > joint) || !(span > 0)) return undefined;
    const cut = cutPiece(curve, degree, spanStart);
    const ending = cut.right.poles;
    const continued = continueBezier(ending, degree, (to - joint) / span, false);
    // the span start becomes an interior knot of multiplicity `degree`. A curve that is that
    // one span has nothing before it, and its start stays the clamped one it was
    const before = cut.left.poles.length > 0;
    return {
        poles: [...(before ? cut.left.poles.slice(0, -1) : []), ...ending, ...continued.slice(1)],
        knots: [
            ...(before ? cut.left.knots.slice(0, -1) : new Array<number>(degree + 1).fill(spanStart)),
            ...new Array<number>(degree).fill(joint),
            ...new Array<number>(degree + 1).fill(to),
        ],
    };
}

/** The curve prolonged before its near end back to `from`, the same way `extendNurbsEnd` goes out. */
function extendNurbsStart(
    curve: HomogeneousCurve,
    degree: number,
    from: number,
): HomogeneousCurve | undefined {
    const joint = curve.knots[degree];
    const spanEnd = curve.knots[degree + 1];
    const span = spanEnd - joint;
    if (!(from < joint) || !(span > 0)) return undefined;
    const cut = cutPiece(curve, degree, spanEnd);
    const opening = cut.left.poles;
    // `from` is before the joint, so the step is negative: the continuation runs backwards
    const continued = continueBezier(opening, degree, (from - joint) / span, true);
    // mirrored: the span end becomes an interior knot of multiplicity `degree` unless the
    // curve is that one span, whose end stays clamped
    const after = cut.right.poles.length > 0;
    return {
        poles: [...continued.slice(0, -1), ...opening, ...(after ? cut.right.poles.slice(1) : [])],
        knots: [
            ...new Array<number>(degree + 1).fill(from),
            ...new Array<number>(degree).fill(joint),
            ...new Array<number>(after ? degree : degree + 1).fill(spanEnd),
            ...(after ? cut.right.knots.slice(degree + 1) : []),
        ],
    };
}

/**
 * The Bernstein form of the polynomial a degree-`degree` bezier segment describes, taken on
 * the interval `lambda` spans past its far end — or, `fromStart`, `|lambda|` spans before its
 * near one. `lambda` is signed by the direction: positive going out past the end, negative
 * going back before the start.
 *
 * A polynomial's Bernstein coefficients on a new interval are its derivatives at the shared
 * point, rescaled — which is what the two sums below are: a difference of the segment's own
 * control points (its derivative there, in Bernstein terms), then the Taylor-to-Bernstein
 * step onto the new interval.
 *
 * Those are the coefficients read *from the shared point*, so a segment continued backwards
 * comes out in the parameter's own direction — the far end first — and the list is reversed
 * to put them back in the order the span is read.
 */
function continueBezier(
    poles: readonly HomogeneousPole[],
    degree: number,
    lambda: number,
    fromStart: boolean,
): HomogeneousPole[] {
    const continued: HomogeneousPole[] = [];
    for (let k = 0; k <= degree; k++) {
        const sum: HomogeneousPole = [0, 0, 0];
        for (let j = 0; j <= k; j++) {
            const factor = binomial(k, j) * lambda ** j;
            const difference = poleDifference(poles, degree, j, fromStart);
            sum[0] += factor * difference[0];
            sum[1] += factor * difference[1];
            sum[2] += factor * difference[2];
        }
        continued.push(sum);
    }
    return fromStart ? continued.reverse() : continued;
}

/**
 * The j-th forward difference of a bezier's control points: Σ (−1)^{j−i} C(j, i) P_i at the
 * segment's start, Σ (−1)^i C(j, i) P_{degree−i} at its end. It is the segment's j-th
 * derivative there, up to the degree's factorial and the span's length.
 */
function poleDifference(
    poles: readonly HomogeneousPole[],
    degree: number,
    j: number,
    fromStart: boolean,
): HomogeneousPole {
    const difference: HomogeneousPole = [0, 0, 0];
    for (let i = 0; i <= j; i++) {
        const even = fromStart ? (j - i) % 2 === 0 : i % 2 === 0;
        const pole = poles[fromStart ? i : degree - i];
        const term = binomial(j, i) * (even ? 1 : -1);
        difference[0] += term * pole[0];
        difference[1] += term * pole[1];
        difference[2] += term * pole[2];
    }
    return difference;
}

/** The binomial coefficients of the degrees a NURBS curve can carry, one row per degree. */
const BINOMIALS: number[][] = [[1]];

function binomial(n: number, k: number): number {
    for (let row = BINOMIALS.length; row <= n; row++) {
        const previous = BINOMIALS[row - 1];
        const next = [1];
        for (let i = 1; i < row; i++) next.push(previous[i - 1] + previous[i]);
        next.push(1);
        BINOMIALS.push(next);
    }
    return BINOMIALS[n][k];
}

// ------------------------------------------------------------------ Adapters

function lineAdapter(params: readonly number[]): CurveAdapter {
    const [x1, y1, x2, y2] = params;
    const d: [number, number] = [x2 - x1, y2 - y1];
    return {
        evaluate: (t) => [x1 + d[0] * t, y1 + d[1] * t],
        derivative: () => d,
        domain: [0, 1],
        support: [0, 1],
        period: 0,
    };
}

function circleAdapter(center: [number, number], radius: number, domain: [number, number]): CurveAdapter {
    return {
        evaluate: (t) => [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)],
        derivative: (t) => [-radius * Math.sin(t), radius * Math.cos(t)],
        domain,
        support: [domain[0], domain[0] + FULL_TURN],
        period: FULL_TURN,
    };
}

function ellipseAdapter(params: readonly number[], domain: [number, number]): CurveAdapter {
    return {
        evaluate: (t) => evaluateEllipse(params, t),
        derivative: (t) => ellipseDerivative(params, t),
        domain,
        support: [domain[0], domain[0] + FULL_TURN],
        period: FULL_TURN,
    };
}

function bezierAdapter(entity: CurveEntity): CurveAdapter {
    const poles = curveControlPoints(entity);
    const weights = curveWeights(entity);
    // how far the support runs past the drawn [0, 1]: far enough that a trim cutter
    // just past the end still meets it, clamped so the polynomial blow-up
    // ((1+2δ)^degree on the poles) stays within reach of the scene
    const degree = Math.max(1, poles.length - 1);
    const extension = Math.min(2, 4 / degree);
    return {
        evaluate: (t) => evaluateBezier(poles, t, weights),
        derivative: (t) => bezierDerivative(poles, t, weights),
        domain: [0, 1],
        support: [-extension, 1 + extension],
        period: 0,
    };
}

/**
 * A NURBS runs on its knot parameters, and its support runs past the domain on each side by
 * the *end span's* own polynomial carried on — the same reading a bezier's support gives it
 * past t = 1, taken one span at a time rather than over a unit domain.
 *
 * A span long enough to extrapolate over is what bounds this: the further out the polynomial
 * goes the faster its homogeneous weights run away, so the reach is the same fraction of a
 * span the bezier's is of its domain (`Math.min(2, 4/degree)`), and a degenerate end span
 * leaves the support where the domain ends.
 */
function nurbsAdapter(entity: CurveEntity): CurveAdapter {
    const poles = curveControlPoints(entity);
    const weights = nurbsWeights(entity.params);
    const spec = nurbsSpec(entity);
    const domain = nurbsDomain(spec, poles.length);
    const reach = Math.min(2, 4 / Math.max(1, spec.degree));
    return {
        evaluate: (t) => evaluateNurbs(poles, weights, spec, t),
        derivative: (t) => nurbsDerivative(poles, weights, spec, t),
        domain,
        support: [
            domain[0] - reach * firstSpanLength(spec),
            domain[1] + reach * lastSpanLength(spec, poles.length),
        ],
        period: 0,
    };
}

/** The parameter length the first span of a NURBS covers — what its support reaches back over. */
function firstSpanLength(spec: NurbsSpec): number {
    return Math.max(0, spec.knots[spec.degree + 1] - spec.knots[spec.degree]);
}

/** The parameter length the last span of a NURBS covers — what its support reaches out over. */
function lastSpanLength(spec: NurbsSpec, poleCount: number): number {
    return Math.max(0, spec.knots[poleCount] - spec.knots[poleCount - 1]);
}

function adapterOf(entity: CurveEntity): CurveAdapter {
    switch (entity.type) {
        case "line":
            return lineAdapter(entity.params);
        case "circle":
            return circleAdapter([entity.params[0], entity.params[1]], entity.params[2], [0, FULL_TURN]);
        case "arc": {
            const radius = Math.hypot(
                entity.params[2] - entity.params[0],
                entity.params[3] - entity.params[1],
            );
            const [start, sweep] = arcAngles(entity.params);
            return circleAdapter([entity.params[0], entity.params[1]], radius, [start, start + sweep]);
        }
        case "ellipse":
            return ellipseAdapter(entity.params, [0, FULL_TURN]);
        case "ellipseArc": {
            const [start, end] = ellipseSweep(entity.params);
            return ellipseAdapter(entity.params, [start, end]);
        }
        case "conic":
        case "bezier":
            return bezierAdapter(entity);
        case "nurbs":
            return nurbsAdapter(entity);
        case "offsetCurve":
            return offsetAdapter(entity);
    }
}

/**
 * An offset curve reads its *source's* params — it has no geometry of its own (`OffsetCurveRef`
 * says which entity they came from and how far off it runs). So its adapter is its source's,
 * with every point pushed `distance` along the normal, and its parameter is the source's,
 * unchanged: a `t` on the offset and a `t` on its source name the same place along the pair.
 * That is also the reading OpenCASCADE's own `Geom_OffsetCurve` gives an offset curve.
 *
 * The side comes from `offsetSideSign` — the same convention the offset tool lays the copy out
 * by, read once at the domain's start: it flips only for a closed source, where "outward" faces
 * away from the centre at every point of a convex curve, so one reading holds for the whole.
 *
 * The tangent is the source's, up to magnitude: an offset shifts a point perpendicular to the
 * tangent, so `C_d′ = C′·(1 + d·κ)` points the same way wherever the offset is a curve at all
 * (and the tool refuses a distance that folds it, so it always is). The magnitude differs, and
 * the one consumer that needs it — an intersection's Newton step — reads it numerically.
 */
function offsetAdapter(entity: CurveEntity): CurveAdapter {
    const ref = entity.offset;
    if (ref === undefined) throw new Error("An offset curve carries no offset");
    const source: CurveEntity = { type: ref.sourceType, params: entity.params, nurbs: entity.nurbs };
    const base = adapterOf(source);
    const pointAt = (t: number): [number, number] => {
        const point = base.evaluate(t);
        const tangent = base.derivative(t);
        const norm = Math.hypot(tangent[0], tangent[1]);
        if (norm < 1e-12) return [point[0], point[1]];
        const nx = -tangent[1] / norm;
        const ny = tangent[0] / norm;
        const reach = offsetSideSign(source, point, nx, ny) * ref.distance;
        return [point[0] + reach * nx, point[1] + reach * ny];
    };
    const step = Math.max(1e-9, (base.domain[1] - base.domain[0]) * 1e-6);
    return {
        evaluate: pointAt,
        derivative: (t) => {
            const before = pointAt(t - step);
            const after = pointAt(t + step);
            return [(after[0] - before[0]) / (2 * step), (after[1] - before[1]) / (2 * step)];
        },
        /**
         * A trimmed copy is drawn over the window it was cut to, and read like any other curve
         * from there: its length, its placements and where a point sits along it all count from
         * the window's own start, which is what lets an op that measures in those terms — a
         * trim's spans, an extend's corners — work on one unchanged. The support stays the
         * source's, so a cut just outside the window is still found.
         */
        domain: offsetWindow(ref, base),
        support: base.support,
        period: base.period,
    };
}

/** Below which a window is not a window: a stretch of a source this short draws the whole copy. */
const OFFSET_WINDOW_EPSILON = 1e-9;

/**
 * The stretch of its source an offset copy *draws* over, in the source's own parameter, or
 * `undefined` when it draws the whole of it. This is `offsetWindow` as any reader gets it —
 * the window the entity stores with the clamping, the folding and the too-short fallback
 * already applied — so the geometry the canvas draws and the edge the kernel builds are the
 * same stretch of the same curve, which is what makes the two agree about a copy whose
 * source has moved out from under its window.
 */
export function offsetDrawnWindow(entity: CurveEntity): [number, number] | undefined {
    const ref = entity.offset;
    if (ref === undefined || ref.window === undefined) return undefined;
    const source: CurveEntity = { type: ref.sourceType, params: entity.params, nurbs: entity.nurbs };
    const [from, to] = offsetWindow(ref, adapterOf(source));
    return to - from > OFFSET_WINDOW_EPSILON ? [from, to] : undefined;
}

/**
 * The stretch of its source an offset copy runs over, as a parameter range to draw — its
 * window, or the whole of the source.
 *
 * The window is in the source's **own parameter**, which is what keeps the copy's ends
 * *exact*: an op that cuts one measures where the cut lies by projecting a point onto the
 * copy (a Newton step, good to far more than the sketch's tolerance), and a length read off
 * a polyline would carry its own error into geometry that nothing can pin back — a copy has
 * no point of its own for a constraint to hold, so the window's own numbers are all there is.
 * A parameter is also what the source's kind means by a position: the ellipse families read
 * an absolute angle, a NURBS reads its knots, and a bezier or conic reads [0, 1].
 *
 * A **periodic** source (the ellipse, and the ellipseArc's whole ellipse) wraps, so a window
 * may run past its origin again: that is what a trim leaving an arc which straddles the
 * source's seam comes to, and the parameter past the seam is the one before it carried on by
 * a period. Every other source has nowhere to wrap to, so its window is clamped into the
 * source it has — and one that has shrunk to nothing (a source the user shrank out from under
 * it) draws the whole copy rather than nothing at all.
 */
function offsetWindow(ref: OffsetCurveRef, base: CurveAdapter): [number, number] {
    if (ref.window === undefined) return base.domain;
    const [first, last] = ref.window[0] <= ref.window[1] ? ref.window : [ref.window[1], ref.window[0]];
    if (base.period > 0) {
        const span = Math.min(last - first, base.period);
        return span > OFFSET_WINDOW_EPSILON ? [first, first + span] : base.domain;
    }
    const from = Math.max(first, base.domain[0]);
    const to = Math.min(last, base.domain[1]);
    return to - from > OFFSET_WINDOW_EPSILON ? [from, to] : base.domain;
}

/**
 * Whether an entity's drawn curve is closed. An offset curve's closedness is its source's, and
 * only while it runs over the whole of it: a window makes it an open piece of a closed curve,
 * which is exactly what trimming one produces.
 */
export function isClosedEntity(entity: CurveEntity): boolean {
    if (entity.type !== "offsetCurve") return isClosedCurveType(entity.type);
    const ref = entity.offset;
    return ref !== undefined && ref.window === undefined && isClosedCurveType(ref.sourceType);
}

/**
 * Which way a positive offset distance goes, at a point whose normal is `(nx, ny)`. An open
 * curve's positive is to the *left of the direction it is stored in*, which is what makes one
 * sign mean one side of a whole chain — a line's and an arc's reading. A closed one has no
 * direction to be left of, so its positive is **outward**, the side its centre is not on: the
 * reading a lone circle's offset has, and an ellipse has to agree with it.
 */
export function offsetSideSign(
    entity: CurveEntity,
    point: readonly [number, number],
    nx: number,
    ny: number,
): number {
    if (!isClosedCurveType(entity.type)) return 1;
    const [cx, cy] = entity.params;
    return (point[0] - cx) * nx + (point[1] - cy) * ny < 0 ? -1 : 1;
}

/** The natural-parameter domain the entity's drawn curve covers. */
export function entityDomain(entity: CurveEntity): [number, number] {
    return adapterOf(entity).domain;
}

/**
 * The turn the entity's parameter is read on, or 0 when it is not closed. A circle and an
 * ellipse read a full turn; an ellipseArc's *support* is the whole ellipse it sits on, so its
 * parameter likewise runs on round. An offset copy's is its source's (`offsetAdapter`), which
 * is what lets a copy's window be read past the seam by exactly one period.
 */
export function entityPeriod(entity: CurveEntity): number {
    return adapterOf(entity).period;
}

/** The entity's curve point at natural parameter t. */
export function evaluateEntity(entity: CurveEntity, t: number): [number, number] {
    return adapterOf(entity).evaluate(t);
}

/** The entity's curve derivative at natural parameter t. */
export function entityTangentAt(entity: CurveEntity, t: number): [number, number] {
    return adapterOf(entity).derivative(t);
}

/** Whether the entity's curve closes on itself — a circle or an ellipse has no ends. */
export function isClosedCurveType(type: SketchEntityType): boolean {
    // An `offsetCurve` is neither open nor closed of itself — its closedness is its source's,
    // and only while it runs over the whole of it, which is what `isClosedEntity` answers. The
    // ops that cut a curve ask that one; this is the reading for a *kind*.
    return type === "circle" || type === "ellipse";
}

/**
 * Whether the entity's curve is one of the *free* curves: the rational and polynomial
 * pieces garlic carries as a control-point list — a conic, a cubic bezier, a NURBS. They
 * are the ones no endpoint move can shorten (their shape *is* their control points, so a
 * piece of one is a whole new list) and no closed form describes, so the ops that edit them
 * reparametrize or reshape them instead of re-aiming ends.
 */
export function isFreeCurveType(type: SketchEntityType): boolean {
    return type === "conic" || type === "bezier" || type === "nurbs";
}

// ------------------------------------------------------------------ Sampling

/** Default meshing/sampling density per entity type, in polyline segments. */
function defaultSegments(entity: CurveEntity): number {
    switch (entity.type) {
        case "line":
            return 1;
        case "offsetCurve": {
            // the density of the curve underneath: an offset is its source, moved
            const ref = entity.offset;
            return ref === undefined
                ? 64
                : defaultSegments({ type: ref.sourceType, params: entity.params, nurbs: entity.nurbs });
        }
        case "circle":
        case "ellipse":
            return 64;
        case "arc":
        case "ellipseArc": {
            const adapter = adapterOf(entity);
            const sweep = adapter.domain[1] - adapter.domain[0];
            return Math.max(2, Math.ceil((64 * sweep) / FULL_TURN));
        }
        case "conic":
            return 48;
        case "bezier":
            return 48;
        case "nurbs":
            // one knot span is one polynomial piece, so the pole count is what says how
            // much curve there is to draw
            return Math.max(32, Math.min(128, 12 * (nurbsPoleCount(entity.params) - 1)));
    }
}

function sampleAdapter(
    adapter: CurveAdapter,
    domain: [number, number],
    segments: number,
): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        points.push(adapter.evaluate(domain[0] + ((domain[1] - domain[0]) * i) / segments));
    }
    return points;
}

/** The entity's drawn curve as a polyline, at the given or default density. */
export function sampleEntity(entity: CurveEntity, segments?: number): [number, number][] {
    const adapter = adapterOf(entity);
    return sampleAdapter(adapter, adapter.domain, segments ?? defaultSegments(entity));
}

// ------------------------------------------------------------------ Arclength

/**
 * The density the drawn curve's length is measured at — `entityArcLength`, and the full turn a
 * closed support wraps by. Those two have to agree: a step back from a seam is the same place as
 * a full turn forward only when the turn was measured the way the length was. The walks that
 * only *invert* an arclength keep their own, coarser density (`adapterLength`, 64): they read a
 * length handed to them, so where they land is a question of resolution rather than agreement.
 */
const ARCLENGTH_SEGMENTS = 128;

function polylineLength(points: readonly [number, number][]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
}

/** The drawn curve's length. */
export function entityArcLength(entity: CurveEntity): number {
    return polylineLength(sampleEntity(entity, ARCLENGTH_SEGMENTS));
}

function adapterLength(adapter: CurveAdapter, from: number, to: number, segments = 64): number {
    return polylineLength(sampleAdapter(adapter, [from, to], segments));
}

/**
 * The arclength of the projection of `point`, measured from the entity's origin
 * (the drawn domain's start) — the `parameterAt` reading for the numeric types.
 */
export function lengthAtPoint(entity: CurveEntity, point: readonly [number, number]): number {
    const adapter = adapterOf(entity);
    const t = projectPoint(entity, point).t;
    return adapterLength(adapter, adapter.domain[0], t);
}

/** The point at arclength `s` from the entity's origin, by polyline interpolation. */
export function pointAtLength(entity: CurveEntity, s: number): [number, number] {
    const points = sampleEntity(entity, 128);
    // the arclength counts from the origin, so a reading at or before it is the origin itself:
    // walking on from zero would extrapolate a point off the curve behind its own start
    if (s <= 0) return points[0];
    let covered = 0;
    for (let i = 1; i < points.length; i++) {
        const segment = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (covered + segment >= s && segment > 1e-30) {
            const t = (s - covered) / segment;
            return [
                points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
                points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
            ];
        }
        covered += segment;
    }
    return points[points.length - 1];
}

/** The drawn curve between arclengths s0 and s1 (s1 < s0 runs backwards) as a polyline. */
export function samplePiece(entity: CurveEntity, s0: number, s1: number, segments = 32): [number, number][] {
    const adapter = adapterOf(entity);
    const total = entityArcLength(entity);
    if (total < 1e-30) return [adapter.evaluate(adapter.domain[0])];
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const s = Math.min(s0 + ((s1 - s0) * i) / segments, total);
        points.push(adapter.evaluate(parameterAtLength(adapter, adapter.domain, s)));
    }
    return points;
}

/**
 * The natural parameter covering arclength `s` over `domain`, inverted by polyline
 * walking. Fine at these densities, and the pieces drawn from it (the trim's and the
 * extend's previews) share the tolerance.
 */
function parameterAtLength(adapter: CurveAdapter, domain: [number, number], s: number): number {
    const steps = 64;
    const width = domain[1] - domain[0];
    let covered = 0;
    let previous = adapter.evaluate(domain[0]);
    for (let i = 1; i <= steps; i++) {
        const t = domain[0] + (width * i) / steps;
        const point = adapter.evaluate(t);
        const segment = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        if (covered + segment >= s && segment > 1e-30) {
            return t - ((covered + segment - s) / segment) * (width / steps);
        }
        covered += segment;
        previous = point;
    }
    return domain[1];
}

// ------------------------------------------------------------------ Support-curve arclength

/**
 * The natural parameter covering the *signed* arclength `s` from the drawn domain's
 * start, measured along the support curve — negative reaches back before the origin
 * end, past `entityArcLength` reaches beyond the far end. A closed support (an
 * ellipseArc's whole ellipse) wraps, so following it any distance stays on the curve;
 * a bezier's clamped extrapolation is walked out to, which is how an extend's corner
 * just past an end still lands on the curve.
 */
function supportParameterAtLength(adapter: CurveAdapter, s: number): number {
    if (adapter.period > 0) {
        // the caller's `s` is measured the way `entityArcLength` measures — same density, so a
        // step back from the seam is the same place as a full turn forward
        const full = adapterLength(adapter, adapter.support[0], adapter.support[1], ARCLENGTH_SEGMENTS);
        if (full > 1e-30) s = ((s % full) + full) % full;
    }
    const from = adapter.domain[0];
    const to = s >= 0 ? adapter.support[1] : adapter.support[0];
    const steps = ARCLENGTH_SEGMENTS;
    const width = to - from;
    const target = Math.abs(s);
    let covered = 0;
    let previous = adapter.evaluate(from);
    for (let i = 1; i <= steps; i++) {
        const t = from + (width * i) / steps;
        const point = adapter.evaluate(t);
        const segment = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        if (covered + segment >= target && segment > 1e-30) {
            return t - ((covered + segment - target) / segment) * (width / steps);
        }
        covered += segment;
        previous = point;
    }
    return to;
}

/** The support curve's point at signed arclength `s` from the entity's origin end. */
export function pointAtSupportLength(entity: CurveEntity, s: number): [number, number] {
    const adapter = adapterOf(entity);
    return adapter.evaluate(supportParameterAtLength(adapter, s));
}

/** The support curve's tangent direction at signed arclength `s` from the origin end. */
export function tangentAtSupportLength(entity: CurveEntity, s: number): [number, number] {
    const adapter = adapterOf(entity);
    return adapter.derivative(supportParameterAtLength(adapter, s));
}

/** The support curve between signed arclengths s0 and s1 from the origin, as a polyline. */
export function sampleSupportPiece(
    entity: CurveEntity,
    s0: number,
    s1: number,
    segments = 32,
): [number, number][] {
    const adapter = adapterOf(entity);
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        points.push(adapter.evaluate(supportParameterAtLength(adapter, s0 + ((s1 - s0) * i) / segments)));
    }
    return points;
}

/**
 * The support-curve span's length: the whole ellipse for an ellipseArc (what an end
 * dragged backwards wraps round), the clamped extrapolation's reach for a bezier.
 */
export function supportArcLength(entity: CurveEntity): number {
    const adapter = adapterOf(entity);
    return adapterLength(adapter, adapter.support[0], adapter.support[1]);
}

/**
 * Signed arclength from the drawn domain's start to the support parameter `t` —
 * negative when `t` sits before the origin end. The reading `parameterAt` would give
 * if the entity were drawn out to `t`.
 */
export function supportLengthAt(entity: CurveEntity, t: number): number {
    const adapter = adapterOf(entity);
    const start = adapter.domain[0];
    return t >= start ? adapterLength(adapter, start, t) : -adapterLength(adapter, t, start);
}

// ------------------------------------------------------------------ Projection

/** (C(t) − p)·C′(t): zero where the curve is nearest (or farthest from) the point. */
function projectResidual(adapter: CurveAdapter, point: readonly [number, number], t: number): number {
    const p = adapter.evaluate(t);
    const d = adapter.derivative(t);
    return (p[0] - point[0]) * d[0] + (p[1] - point[1]) * d[1];
}

/** Newton on the projection residual, from the polyline's coarse answer. */
function newtonProject(adapter: CurveAdapter, point: readonly [number, number], t0: number): number {
    const width = adapter.domain[1] - adapter.domain[0] || 1;
    const h = 1e-6 * width;
    let t = t0;
    for (let i = 0; i < 10; i++) {
        const f = projectResidual(adapter, point, t);
        const slope =
            (projectResidual(adapter, point, t + h) - projectResidual(adapter, point, t - h)) / (2 * h);
        if (Math.abs(slope) < 1e-18) break;
        const cap = width / 4;
        const step = Math.max(-cap, Math.min(cap, f / slope));
        t -= step;
        if (Math.abs(step) < 1e-12 * width) break;
    }
    return t;
}

/** t folded into the domain: wrapped for the closed families, clamped for the open ones. */
function clampDomain(adapter: CurveAdapter, t: number, domain: [number, number]): number {
    if (adapter.period > 0 && domain[1] - domain[0] >= adapter.period - 1e-9) {
        return domain[0] + ((((t - domain[0]) % adapter.period) + adapter.period) % adapter.period);
    }
    return Math.max(domain[0], Math.min(domain[1], t));
}

/** The nearest point of a polyline to the probe: segment index and local t. */
function polylineNearest(
    points: readonly [number, number][],
    probe: readonly [number, number],
): { index: number; t: number; distance: number } {
    let best = { index: 0, t: 0, distance: Number.POSITIVE_INFINITY };
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const lengthSquared = dx * dx + dy * dy;
        const t =
            lengthSquared < 1e-30
                ? 0
                : Math.max(
                      0,
                      Math.min(
                          1,
                          ((probe[0] - points[i - 1][0]) * dx + (probe[1] - points[i - 1][1]) * dy) /
                              lengthSquared,
                      ),
                  );
        const distance = Math.hypot(
            probe[0] - (points[i - 1][0] + t * dx),
            probe[1] - (points[i - 1][1] + t * dy),
        );
        if (distance < best.distance) best = { index: i - 1, t, distance };
    }
    return best;
}

/** The point on the entity's drawn curve nearest `point`, Newton-polished off a polyline seed. */
export function projectPoint(entity: CurveEntity, point: readonly [number, number]): CurveProjection {
    const adapter = adapterOf(entity);
    const segments = 64;
    const nearest = polylineNearest(sampleAdapter(adapter, adapter.domain, segments), point);
    const width = adapter.domain[1] - adapter.domain[0];
    const seed = adapter.domain[0] + ((nearest.index + nearest.t) / segments) * width;
    const t = clampDomain(adapter, newtonProject(adapter, point, seed), adapter.domain);
    const projected = adapter.evaluate(t);
    return { point: projected, t, distance: Math.hypot(projected[0] - point[0], projected[1] - point[1]) };
}

/**
 * The same projection read on the *support* curve: past the entity's own ends too,
 * which is where an extend's corner lies. A line's support is its drawn segment here —
 * the line's unbounded parameter is read analytically (`curveGeometry.parameterAt`), so
 * this is only ever asked of the numeric families.
 */
export function projectSupport(entity: CurveEntity, point: readonly [number, number]): CurveProjection {
    const adapter = adapterOf(entity);
    const segments = 96;
    const width = adapter.support[1] - adapter.support[0];
    const nearest = polylineNearest(sampleAdapter(adapter, adapter.support, segments), point);
    const seed = adapter.support[0] + ((nearest.index + nearest.t) / segments) * width;
    const t = clampDomain(adapter, newtonProject(adapter, point, seed), adapter.support);
    const projected = adapter.evaluate(t);
    return { point: projected, t, distance: Math.hypot(projected[0] - point[0], projected[1] - point[1]) };
}

// ------------------------------------------------------------------ Closest pair and crossings

/** The nearest pair of points between two segments, as the two local parameters. */
function segmentPairClosest(
    p1: readonly [number, number],
    p2: readonly [number, number],
    p3: readonly [number, number],
    p4: readonly [number, number],
): { s: number; t: number; distance: number } {
    const d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    const d2 = [p4[0] - p3[0], p4[1] - p3[1]];
    const r = [p1[0] - p3[0], p1[1] - p3[1]];
    const a = d1[0] * d1[0] + d1[1] * d1[1];
    const e = d2[0] * d2[0] + d2[1] * d2[1];
    const f = d2[0] * r[0] + d2[1] * r[1];
    const c = d1[0] * r[0] + d1[1] * r[1];
    const b = d1[0] * d2[0] + d1[1] * d2[1];
    const denominator = a * e - b * b;
    let s = denominator > 1e-30 ? Math.max(0, Math.min(1, (b * f - c * e) / denominator)) : 0;
    let t = e > 1e-30 ? (b * s + f) / e : 0;
    if (t < 0 || t > 1) {
        t = Math.max(0, Math.min(1, t));
        s = a > 1e-30 ? Math.max(0, Math.min(1, (b * t - c) / a)) : 0;
    }
    const pa = [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
    const pb = [p3[0] + d2[0] * t, p3[1] + d2[1] * t];
    return { s, t, distance: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) };
}

/**
 * The nearest pair of points between two entities' drawn curves: a polyline coarse
 * pass, then alternating Newton projections. This seeds the auxiliary contact
 * parameters of the curve-curve tangent constraints, and measures the gap the
 * auto-tangent snap reads.
 */
export function closestCurvePair(a: CurveEntity, b: CurveEntity): CurvePairClosest {
    const adA = adapterOf(a);
    const adB = adapterOf(b);
    const segments = 48;
    const pointsA = sampleAdapter(adA, adA.domain, segments);
    const pointsB = sampleAdapter(adB, adB.domain, segments);
    let best = { tA: adA.domain[0], tB: adB.domain[0], distance: Number.POSITIVE_INFINITY };
    for (let i = 1; i < pointsA.length; i++) {
        for (let j = 1; j < pointsB.length; j++) {
            const pair = segmentPairClosest(pointsA[i - 1], pointsA[i], pointsB[j - 1], pointsB[j]);
            if (pair.distance < best.distance) {
                best = {
                    tA: adA.domain[0] + ((i - 1 + pair.s) / segments) * (adA.domain[1] - adA.domain[0]),
                    tB: adB.domain[0] + ((j - 1 + pair.t) / segments) * (adB.domain[1] - adB.domain[0]),
                    distance: pair.distance,
                };
            }
        }
    }
    let { tA, tB } = best;
    for (let i = 0; i < 8; i++) {
        tA = clampDomain(adA, newtonProject(adA, adB.evaluate(tB), tA), adA.domain);
        tB = clampDomain(adB, newtonProject(adB, adA.evaluate(tA), tB), adB.domain);
    }
    const pointA = adA.evaluate(tA);
    const pointB = adB.evaluate(tB);
    return { pointA, pointB, tA, tB, distance: Math.hypot(pointA[0] - pointB[0], pointA[1] - pointB[1]) };
}

/** A line's support extended past both ends so it covers the other entity's extent. */
function extendedLineSupport(line: CurveAdapter, other: CurveAdapter): void {
    const length = Math.hypot(line.derivative(0)[0], line.derivative(0)[1]);
    if (length < 1e-30) return;
    const points = sampleAdapter(other, other.support, 48);
    let reach = 0;
    for (const point of points) {
        const origin = line.evaluate(0);
        reach = Math.max(reach, Math.hypot(point[0] - origin[0], point[1] - origin[1]));
    }
    const k = reach / length + 1;
    line.support = [-k, 1 + k];
}

/** Where two polyline segments cross, as segment-local parameters; undefined when they do not. */
export function segmentCrossing(
    p1: readonly [number, number],
    p2: readonly [number, number],
    p3: readonly [number, number],
    p4: readonly [number, number],
): { s: number; t: number } | undefined {
    const d1x = p2[0] - p1[0];
    const d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0];
    const d2y = p4[1] - p3[1];
    const det = d1x * d2y - d1y * d2x;
    // parallel or collinear: no crossing seed (a collinear run bounds no piece, same
    // rule as the analytic line-line path)
    if (Math.abs(det) < 1e-12 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) return undefined;
    const ex = p3[0] - p1[0];
    const ey = p3[1] - p1[1];
    const s = (ex * d2y - ey * d2x) / det;
    const t = (ex * d1y - ey * d1x) / det;
    const slack = 1e-9;
    if (s < -slack || s > 1 + slack || t < -slack || t > 1 + slack) return undefined;
    return { s: Math.max(0, Math.min(1, s)), t: Math.max(0, Math.min(1, t)) };
}

/** Damped-Newton refinement of a crossing seed; undefined when it converges nowhere near. */
function refineCrossing(
    adA: CurveAdapter,
    adB: CurveAdapter,
    seedA: number,
    seedB: number,
    domainA: [number, number],
    domainB: [number, number],
): { tA: number; tB: number } | undefined {
    const width = Math.max(domainA[1] - domainA[0], domainB[1] - domainB[0]) || 1;
    let tA = seedA;
    let tB = seedB;
    for (let i = 0; i < 12; i++) {
        const pa = adA.evaluate(tA);
        const pb = adB.evaluate(tB);
        const rx = pa[0] - pb[0];
        const ry = pa[1] - pb[1];
        if (Math.hypot(rx, ry) < 1e-9) return { tA, tB };
        const da = adA.derivative(tA);
        const db = adB.derivative(tB);
        // a damped least-squares step on F = A(tA) − B(tB): the damping keeps a
        // tangent crossing (singular Jacobian) moving instead of giving up
        const j00 = da[0] * da[0] + da[1] * da[1];
        const j01 = -(da[0] * db[0] + da[1] * db[1]);
        const j11 = db[0] * db[0] + db[1] * db[1];
        const r0 = da[0] * rx + da[1] * ry;
        const r1 = -(db[0] * rx + db[1] * ry);
        const lambda = 1e-12 * Math.max(j00, j11, 1e-30);
        const det = (j00 + lambda) * (j11 + lambda) - j01 * j01;
        if (Math.abs(det) < 1e-30) break;
        const cap = width / 2;
        const dtA = Math.max(-cap, Math.min(cap, -((j11 + lambda) * r0 - j01 * r1) / det));
        const dtB = Math.max(-cap, Math.min(cap, -(-j01 * r0 + (j00 + lambda) * r1) / det));
        tA = clampDomain(adA, tA + dtA, domainA);
        tB = clampDomain(adB, tB + dtB, domainB);
        if (Math.abs(dtA) + Math.abs(dtB) < 1e-13 * width) break;
    }
    const pa = adA.evaluate(tA);
    const pb = adB.evaluate(tB);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-7 ? { tA, tB } : undefined;
}

/**
 * Every crossing of two entities, Newton-refined off polyline seeds. With `support`
 * (the default) the search runs on the support curves — a line reads as its
 * infinite extent, an ellipseArc as its whole ellipse, a bezier and a NURBS as the
 * extrapolation their end pieces carry — which is what a trim's cutters and an extend's
 * corners are found on; without it, only crossings on the drawn curves themselves.
 */
export function intersectCurves(a: CurveEntity, b: CurveEntity, support = true): CurveIntersection[] {
    const adA = adapterOf(a);
    const adB = adapterOf(b);
    if (support) {
        if (a.type === "line") extendedLineSupport(adA, adB);
        if (b.type === "line") extendedLineSupport(adB, adA);
    }
    const domainA = support ? adA.support : adA.domain;
    const domainB = support ? adB.support : adB.domain;
    const pointsA = sampleAdapter(adA, domainA, a.type === "line" ? 1 : support ? 96 : 64);
    const pointsB = sampleAdapter(adB, domainB, b.type === "line" ? 1 : support ? 96 : 64);
    const crossings: CurveIntersection[] = [];
    const widthA = domainA[1] - domainA[0] || 1;
    const widthB = domainB[1] - domainB[0] || 1;
    for (let i = 1; i < pointsA.length; i++) {
        for (let j = 1; j < pointsB.length; j++) {
            const seed = segmentCrossing(pointsA[i - 1], pointsA[i], pointsB[j - 1], pointsB[j]);
            if (seed === undefined) continue;
            const seedA = domainA[0] + ((i - 1 + seed.s) / (pointsA.length - 1)) * widthA;
            const seedB = domainB[0] + ((j - 1 + seed.t) / (pointsB.length - 1)) * widthB;
            const refined = refineCrossing(adA, adB, seedA, seedB, domainA, domainB);
            if (refined === undefined) continue;
            const pointA = adA.evaluate(refined.tA);
            // the parameter gap alone misses a duplicate straddling a closed curve's
            // seam (t ≈ 0 and t ≈ 2π are the same point), so the point says it too
            const duplicate = crossings.some(
                (other) =>
                    (Math.abs(other.tA - refined.tA) < 1e-6 * widthA &&
                        Math.abs(other.tB - refined.tB) < 1e-6 * widthB) ||
                    Math.hypot(other.point[0] - pointA[0], other.point[1] - pointA[1]) < 1e-7,
            );
            if (!duplicate) crossings.push({ point: pointA, tA: refined.tA, tB: refined.tB });
        }
    }
    return crossings;
}
