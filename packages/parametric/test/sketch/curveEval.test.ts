// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    closestCurvePair,
    conicWeight,
    ellipseParameterOf,
    ellipseSweep,
    entityArcLength,
    evaluateBezier,
    evaluateEllipse,
    evaluateNurbs,
    intersectCurves,
    lengthAtPoint,
    nurbsDerivative,
    nurbsDomain,
    offsetSideSign,
    pointAtLength,
    projectPoint,
    splitBezier,
    subBezier,
    subConic,
    subNurbs,
} from "../../src/sketch/curveEval";
import { clampedUniformKnots } from "../../src/sketch/sketchModel";

const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

// the ellipse of centre (0,0), major point (4,0), minor point (0,2): x²/16 + y²/4 = 1
const ellipse = { type: "ellipse" as const, params: [0, 0, 4, 0, 0, 2] };
const onEllipse = (point: readonly [number, number]) => point[0] ** 2 / 16 + point[1] ** 2 / 4;

describe("curveEval: ellipse", () => {
    test("evaluates onto the ellipse", () => {
        for (const t of [0, 0.7, Math.PI / 2, 2.4, Math.PI, 5.1]) {
            const point = evaluateEllipse(ellipse.params, t);
            expect(onEllipse(point)).toBeCloseTo(1, 8);
        }
    });

    test("ellipseParameterOf is the inverse of the evaluation on the curve", () => {
        for (const t of [0.3, 1.2, 2.9, 4.4]) {
            const point = evaluateEllipse(ellipse.params, t);
            // atan2 answers modulo 2π — compare wrapped
            const wrapped = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const got = ellipseParameterOf(ellipse.params, point);
            const gotWrapped = ((got % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            expect(gotWrapped).toBeCloseTo(wrapped, 8);
        }
    });

    test("ellipseSweep reads a quarter and its complement counter-clockwise", () => {
        const quarter = ellipseSweep([0, 0, 4, 0, 0, 2, 4, 0, 0, 2]);
        expect(quarter[0]).toBeCloseTo(0, 10);
        expect(quarter[1]).toBeCloseTo(Math.PI / 2, 10);
        const complement = ellipseSweep([0, 0, 4, 0, 0, 2, 0, 2, 4, 0]);
        expect(complement[0]).toBeCloseTo(Math.PI / 2, 10);
        expect(complement[1]).toBeCloseTo(Math.PI * 2, 10);
    });

    test("projectPoint lands on the ellipse", () => {
        const projection = projectPoint(ellipse, [5, 2]);
        expect(projection.distance).toBeGreaterThan(0.1);
        expect(onEllipse(projection.point)).toBeCloseTo(1, 6);
        // projecting the projection again must not move
        expect(projectPoint(ellipse, projection.point).distance).toBeLessThan(1e-6);
    });
});

describe("curveEval: bezier", () => {
    const poles: [number, number][] = [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
    ];

    test("split halves meet at the split point", () => {
        const split = splitBezier(poles, 0.5);
        const mid = evaluateBezier(poles, 0.5);
        expect(split.leftPoles[3][0]).toBeCloseTo(mid[0], 10);
        expect(split.leftPoles[3][1]).toBeCloseTo(mid[1], 10);
        expect(split.rightPoles[0][0]).toBeCloseTo(mid[0], 10);
    });

    test("subBezier reparametrizes the same curve", () => {
        const sub = subBezier(poles, 0.25, 0.75);
        expect(sub).toBeDefined();
        for (const t of [0, 0.3, 0.9, 1]) {
            const a = evaluateBezier(sub!.poles, t);
            const b = evaluateBezier(poles, 0.25 + 0.5 * t);
            expect(a[0]).toBeCloseTo(b[0], 8);
            expect(a[1]).toBeCloseTo(b[1], 8);
        }
    });

    test("a rational quadratic with weight 1 is the plain bezier", () => {
        const weights = [1, conicWeight(0.5), 1];
        for (const t of [0.1, 0.5, 0.9]) {
            const rational = evaluateBezier(
                [
                    [0, 0],
                    [1, 1],
                    [2, 0],
                ],
                t,
                weights,
            );
            const plain = evaluateBezier(
                [
                    [0, 0],
                    [1, 1],
                    [2, 0],
                ],
                t,
            );
            expect(rational[0]).toBeCloseTo(plain[0], 10);
            expect(rational[1]).toBeCloseTo(plain[1], 10);
        }
    });

    test("subConic keeps the geometric arc and a rho in (0, 1)", () => {
        const conicPoles: [number, number][] = [
            [0, 0],
            [1, 1],
            [2, 0],
        ];
        const original = { type: "conic" as const, params: [0, 0, 1, 1, 2, 0, 0.4] };
        const sub = subConic(conicPoles, 0.4, 0.2, 0.8);
        expect(sub).toBeDefined();
        expect(sub!.rho).toBeGreaterThan(0);
        expect(sub!.rho).toBeLessThan(1);
        // endpoints are parameter-free: they must sit exactly at B(t0) and B(t1)
        const weights = [1, conicWeight(0.4), 1];
        const start = evaluateBezier(conicPoles, 0.2, weights);
        const end = evaluateBezier(conicPoles, 0.8, weights);
        expect(sub!.poles[0][0]).toBeCloseTo(start[0], 10);
        expect(sub!.poles[0][1]).toBeCloseTo(start[1], 10);
        expect(sub!.poles[2][0]).toBeCloseTo(end[0], 10);
        expect(sub!.poles[2][1]).toBeCloseTo(end[1], 10);
        // the standard-form normalization reparametrizes, so interior t's differ —
        // what must hold is that every point of the sub-conic lies on the original
        for (const t of [0.15, 0.35, 0.55, 0.75, 0.95]) {
            const point = evaluateBezier(sub!.poles, t, [1, conicWeight(sub!.rho), 1]);
            expect(projectPoint(original, point).distance).toBeLessThan(1e-8);
        }
    });

    test("subConic of the whole curve reproduces rho", () => {
        const conicPoles: [number, number][] = [
            [0, 0],
            [2, 3],
            [4, 0],
        ];
        const sub = subConic(conicPoles, 0.3, 0, 1);
        expect(sub).toBeDefined();
        expect(sub!.rho).toBeCloseTo(0.3, 8);
        // same poles, same rho → identical parametrization
        for (const t of [0.2, 0.6]) {
            const a = evaluateBezier(sub!.poles, t, [1, conicWeight(sub!.rho), 1]);
            const b = evaluateBezier(conicPoles, t, [1, conicWeight(0.3), 1]);
            expect(a[0]).toBeCloseTo(b[0], 8);
            expect(a[1]).toBeCloseTo(b[1], 8);
        }
    });
});

describe("curveEval: intersections", () => {
    test("a line crosses the ellipse twice, at the vertices", () => {
        const line = { type: "line" as const, params: [-10, 0, 10, 0] };
        const crossings = intersectCurves(line, ellipse);
        expect(crossings.length).toBe(2);
        for (const crossing of crossings) {
            expect(crossing.point[1]).toBeCloseTo(0, 6);
            expect(Math.abs(crossing.point[0])).toBeCloseTo(4, 6);
        }
    });

    test("a line misses a far ellipse entirely", () => {
        const line = { type: "line" as const, params: [10, 0, 20, 3] };
        expect(intersectCurves(line, ellipse).length).toBe(0);
    });

    test("a line meets a cubic bezier at both humps", () => {
        // y(t) = 6t(1−t) peaks at 1.5, so y = 1 is crossed twice, both inside x ∈ [0, 4]
        const bezier = { type: "bezier" as const, params: [0, 0, 1, 2, 3, 2, 4, 0] };
        const line = { type: "line" as const, params: [0, 1, 4, 1] };
        const crossings = intersectCurves(line, bezier);
        expect(crossings.length).toBe(2);
        for (const crossing of crossings) {
            expect(crossing.point[1]).toBeCloseTo(1, 5);
        }
    });

    test("a circle and a conic cross on both curves", () => {
        const circle = { type: "circle" as const, params: [1, 0.4, 0.9] };
        const conic = { type: "conic" as const, params: [0, 0, 1, 1, 2, 0, 0.5] };
        const crossings = intersectCurves(circle, conic);
        expect(crossings.length).toBeGreaterThan(0);
        for (const crossing of crossings) {
            expect(near(Math.hypot(crossing.point[0] - 1, crossing.point[1] - 0.4), 0.9, 1e-5)).toBe(true);
        }
    });

    test("support curves reach beyond the drawn segment, drawn-only does not", () => {
        // a horizontal segment just right of the ellipse: its extension crosses the
        // ellipse at both vertices, the drawn segment itself touches nothing
        const segment = { type: "line" as const, params: [5, 0, 6, 0] };
        expect(intersectCurves(segment, ellipse, true).length).toBe(2);
        expect(intersectCurves(segment, ellipse, false).length).toBe(0);
    });
});

describe("curveEval: closest pair", () => {
    test("circle to ellipse across a gap", () => {
        const circle = { type: "circle" as const, params: [10, 0, 2] };
        const pair = closestCurvePair(circle, ellipse);
        expect(pair.distance).toBeCloseTo(4, 3);
        expect(pair.pointB[0]).toBeCloseTo(4, 3);
    });

    test("tangent line above the ellipse has a zero gap at the vertex", () => {
        const line = { type: "line" as const, params: [0, 2, 4, 2] };
        const pair = closestCurvePair(line, ellipse);
        expect(pair.distance).toBeLessThan(1e-6);
        expect(pair.pointB[1]).toBeCloseTo(2, 5);
    });
});

describe("curveEval: arclength", () => {
    const conic = { type: "conic" as const, params: [0, 0, 1, 1, 2, 0, 0.5] };

    test("length and back", () => {
        const length = entityArcLength(conic);
        expect(length).toBeGreaterThan(2);
        const half = pointAtLength(conic, length / 2);
        expect(lengthAtPoint(conic, half)).toBeCloseTo(length / 2, 2);
    });

    test("parameter of a point on the curve measures from the start", () => {
        const length = entityArcLength(conic);
        expect(lengthAtPoint(conic, [0, 0])).toBeCloseTo(0, 6);
        expect(lengthAtPoint(conic, [2, 0])).toBeCloseTo(length, 3);
    });
});

describe("curveEval: nurbs", () => {
    // a clamped uniform cubic: six control points, knots [0,0,0,0,1,2,3,3,3,3]
    const poles: [number, number][] = [
        [0, 0],
        [1, 2],
        [3, 3],
        [5, 1],
        [6, 3],
        [8, 0],
    ];
    const cubic = { degree: 3, knots: clampedUniformKnots(6, 3) };
    const weights = [1, 1, 1, 1, 1, 1];
    // an entity's own params: the control points, then their weights
    const params = (control: readonly [number, number][], w: readonly number[]) => [...control.flat(), ...w];
    const entity = {
        type: "nurbs" as const,
        params: params(poles, weights),
        nurbs: { degree: cubic.degree, knots: [...cubic.knots] },
    };

    test("a clamped curve starts and ends on its first and last control point", () => {
        const [start, end] = nurbsDomain(cubic, poles.length);
        expect(start).toBeCloseTo(0, 12);
        expect(end).toBeCloseTo(3, 12);
        const first = evaluateNurbs(poles, weights, cubic, start);
        const last = evaluateNurbs(poles, weights, cubic, end);
        expect(first[0]).toBeCloseTo(poles[0][0], 10);
        expect(first[1]).toBeCloseTo(poles[0][1], 10);
        expect(last[0]).toBeCloseTo(poles[5][0], 10);
        expect(last[1]).toBeCloseTo(poles[5][1], 10);
    });

    test("a degree-1 curve with unit weights is its own control polygon", () => {
        const control: [number, number][] = [
            [0, 0],
            [1, 3],
            [4, 1],
        ];
        const spec = { degree: 1, knots: clampedUniformKnots(3, 1) };
        const units = [1, 1, 1];
        expect(spec.knots).toEqual([0, 0, 1, 2, 2]);
        for (const t of [0, 0.25, 1, 1.5, 2]) {
            const point = evaluateNurbs(control, units, spec, t);
            const expected =
                t <= 1 ? [control[0][0] + t, control[0][1] + 3 * t] : [1 + 3 * (t - 1), 3 - 2 * (t - 1)];
            expect(point[0]).toBeCloseTo(expected[0], 10);
            expect(point[1]).toBeCloseTo(expected[1], 10);
        }
    });

    test("knots that make it a bezier read the same as the de Casteljau evaluation", () => {
        const spec = { degree: 3, knots: clampedUniformKnots(4, 3) };
        const control = poles.slice(0, 4);
        expect(spec.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
        for (const t of [0, 0.2, 0.5, 0.8, 1]) {
            const deBoor = evaluateNurbs(control, [1, 1, 1, 1], spec, t);
            const casteljau = evaluateBezier(control, t);
            expect(deBoor[0]).toBeCloseTo(casteljau[0], 10);
            expect(deBoor[1]).toBeCloseTo(casteljau[1], 10);
        }
    });

    test("the derivative is the central difference of the curve", () => {
        const t = 1.4;
        const h = 1e-6;
        const before = evaluateNurbs(poles, weights, cubic, t - h);
        const after = evaluateNurbs(poles, weights, cubic, t + h);
        const slope = nurbsDerivative(poles, weights, cubic, t);
        expect(slope[0]).toBeCloseTo((after[0] - before[0]) / (2 * h), 5);
        expect(slope[1]).toBeCloseTo((after[1] - before[1]) / (2 * h), 5);
    });

    test("a rational weight pulls the curve towards its control point", () => {
        const heavy = [1, 1, 4, 1, 1, 1];
        const plain = evaluateNurbs(poles, weights, cubic, 1);
        const pulled = evaluateNurbs(poles, heavy, cubic, 1);
        expect(Math.hypot(pulled[0] - poles[2][0], pulled[1] - poles[2][1])).toBeLessThan(
            Math.hypot(plain[0] - poles[2][0], plain[1] - poles[2][1]),
        );
    });

    test("subNurbs slices the domain without reparametrizing it", () => {
        const piece = subNurbs(poles, weights, cubic, 0.6, 2.4);
        expect(piece).toBeDefined();
        // every point of the piece is the original curve at the same parameter — the
        // knots are still the original ones, so the two must agree point for point
        for (const t of [0.6, 1, 1.7, 2.2, 2.4]) {
            const sliced = evaluateNurbs(piece!.poles, piece!.weights, piece!.spec, t);
            const original = evaluateNurbs(poles, weights, cubic, t);
            expect(sliced[0]).toBeCloseTo(original[0], 8);
            expect(sliced[1]).toBeCloseTo(original[1], 8);
        }
        expect(nurbsDomain(piece!.spec, piece!.poles.length)).toEqual([0.6, 2.4]);
    });

    test("subNurbs over the whole domain leaves the curve alone", () => {
        const [start, end] = nurbsDomain(cubic, poles.length);
        const whole = subNurbs(poles, weights, cubic, start, end);
        expect(whole).toBeDefined();
        for (const t of [0, 1.3, 3]) {
            const after = evaluateNurbs(whole!.poles, whole!.weights, whole!.spec, t);
            const before = evaluateNurbs(poles, weights, cubic, t);
            expect(after[0]).toBeCloseTo(before[0], 8);
            expect(after[1]).toBeCloseTo(before[1], 8);
        }
    });

    test("subNurbs past an end continues that end's span's own polynomial", () => {
        const [start, end] = nurbsDomain(cubic, poles.length);
        const reach = 0.8;
        // both ends at once, each read on its own span: the curve it had is untouched, and
        // past either end it is the same polynomial the curve's own read carries on with
        for (const [from, to, edge] of [
            [start, end + reach, end + reach],
            [start - reach, end, start - reach],
        ]) {
            const extended = subNurbs(poles, weights, cubic, from, to);
            expect(extended).toBeDefined();
            const spec = { degree: extended!.spec.degree, knots: extended!.spec.knots };
            const domain = nurbsDomain(spec, extended!.poles.length);
            expect(domain[0]).toBeCloseTo(from, 9);
            expect(domain[1]).toBeCloseTo(to, 9);
            for (const t of [start, 0.7, 1.5, 2.6, end, edge]) {
                const after = evaluateNurbs(extended!.poles, extended!.weights, spec, t);
                const before = evaluateNurbs(poles, weights, cubic, t);
                expect(after[0]).toBeCloseTo(before[0], 8);
                expect(after[1]).toBeCloseTo(before[1], 8);
            }
        }
    });

    test("projection lands on the curve and does not move when repeated", () => {
        const projection = projectPoint(entity, [1, -2]);
        expect(projection.distance).toBeGreaterThan(0.5);
        expect(projectPoint(entity, projection.point).distance).toBeLessThan(1e-6);
        // the projected point is on the curve: its parameter evaluates back to it
        const again = evaluateNurbs(poles, weights, cubic, projection.t);
        expect(again[0]).toBeCloseTo(projection.point[0], 6);
        expect(again[1]).toBeCloseTo(projection.point[1], 6);
    });

    test("offsetSideSign reads a closed curve's positive distance outward", () => {
        // the normal handed in is the left one, which on a counter-clockwise circle points at
        // its centre: the sign has to flip for the distance to mean outward, and the ellipse
        // has to read the same way — the circle used to keep the left normal and go inward
        const circle = { id: 1, type: "circle" as const, params: [0, 0, 2] };
        expect(offsetSideSign(circle, [2, 0], -1, 0)).toBe(-1);
        expect(offsetSideSign(ellipse, [4, 0], -1, 0)).toBe(-1);
        // an open curve has a side to be left of and keeps the normal as it is
        const line = { id: 2, type: "line" as const, params: [0, 0, 1, 0] };
        expect(offsetSideSign(line, [0, 0], 0, 1)).toBe(1);
    });
});
