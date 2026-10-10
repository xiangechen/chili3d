// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import {
    type CurveEntity,
    conicShoulder,
    entityDomain,
    entityTangentAt,
    evaluateEntity,
    nurbsPoleCount,
    projectPoint,
    projectSupport,
} from "../../src/sketch/curveEval";
import { splitCurveEntity } from "../../src/sketch/entityEditOps";
import {
    ConstraintKind,
    defaultNurbsSpec,
    entityPointCount,
    type SketchData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { pointOnConstraintFor, tangentConstraintFor, tangentKindFor } from "../../src/sketch/solverEntities";
import "./setup";

/** A point on the [0, 0, 10, 0, 0, 5] ellipse at parameter t. */
function ellipsePoint(t: number): [number, number] {
    return [10 * Math.cos(t), 5 * Math.sin(t)];
}

/**
 * The parameter minimizing `measure` over the curve's drawn domain: a dense scan for the
 * global neighbourhood, then golden-section refinement. `closestCurvePair` alone is not
 * sharp enough for these assertions — its alternating projections stall at a flat tangent
 * contact, reporting ~1e-4 where the solver hit the contact exactly.
 */
function argminOnCurve(curve: CurveEntity, measure: (t: number) => number): number {
    const [lo, hi] = entityDomain(curve);
    const samples = 2048;
    let bestT = lo;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= samples; i++) {
        const t = lo + ((hi - lo) * i) / samples;
        const value = measure(t);
        if (value < best) {
            best = value;
            bestT = t;
        }
    }
    let left = bestT - (hi - lo) / samples;
    let right = bestT + (hi - lo) / samples;
    const invPhi = (Math.sqrt(5) - 1) / 2;
    let c = right - invPhi * (right - left);
    let d = left + invPhi * (right - left);
    for (let i = 0; i < 200; i++) {
        if (measure(c) ** 2 < measure(d) ** 2) {
            right = d;
        } else {
            left = c;
        }
        c = right - invPhi * (right - left);
        d = left + invPhi * (right - left);
    }
    return (left + right) / 2;
}

interface TangencyMeasure {
    /** Gap between the two curves at the contact — zero for a true touch. */
    distance: number;
    /** |sin| of the angle between the two tangent directions at the contact. */
    sinAngle: number;
    /** The contact's parameter along the line (line pairs only): in [0, 1] the drawn segment reaches it. */
    lineT?: number;
}

/** |sin| of the angle between two direction vectors. */
function directionSine(a: [number, number], b: [number, number]): number {
    return Math.abs(a[0] * b[1] - a[1] * b[0]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]));
}

/** |cos| of the angle between an ellipse frame's two axis vectors — 0 for perpendicular. */
function axisCosine(params: number[]): number {
    const u = [params[2] - params[0], params[3] - params[1]];
    const v = [params[4] - params[0], params[5] - params[1]];
    return Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
}

/** Tangency of a curve to a line's infinite support: the curve's distance extremum onto the line. */
function lineTangency(line: number[], curve: CurveEntity): TangencyMeasure {
    const direction: [number, number] = [line[2] - line[0], line[3] - line[1]];
    const length = Math.hypot(direction[0], direction[1]);
    const normal: [number, number] = [-direction[1] / length, direction[0] / length];
    const gap = (t: number) => {
        const [x, y] = evaluateEntity(curve, t);
        return (x - line[0]) * normal[0] + (y - line[1]) * normal[1];
    };
    const t = argminOnCurve(curve, (u) => Math.abs(gap(u)));
    const contact = evaluateEntity(curve, t);
    const lineT =
        ((contact[0] - line[0]) * direction[0] + (contact[1] - line[1]) * direction[1]) / (length * length);
    return {
        distance: Math.abs(gap(t)),
        sinAngle: directionSine(entityTangentAt(curve, t), direction),
        lineT,
    };
}

/** Tangency between two curves: the true closest pair, refined past the flat-contact stall. */
function curveTangency(a: CurveEntity, b: CurveEntity): TangencyMeasure {
    const tA = argminOnCurve(a, (t) => projectPoint(b, evaluateEntity(a, t)).distance);
    const contactB = projectPoint(b, evaluateEntity(a, tA));
    return {
        distance: contactB.distance,
        sinAngle: directionSine(entityTangentAt(a, tA), entityTangentAt(b, contactB.t)),
    };
}

/** Pins the ellipse frame's three points (centre and both axis points) where they lie. */
function pinEllipseFrame(solver: SketchSolver, entityId: number): void {
    for (const pointIndex of [0, 1, 2]) {
        solver.addConstraint({
            kind: ConstraintKind.Fix,
            refs: [{ entityId, pointIndex }],
            datums: solver.pointOf({ entityId, pointIndex }),
        });
    }
}

/**
 * A solver carrying one ellipse, loaded through the persisted-data path — the same state a
 * reopened sketch carries. Loading adds no constraints on its own (they are part of the data),
 * so this ellipse lacks the structural axis Perpendicular that `addEllipse` creates; the tests
 * pin the frame with explicit Fixes instead. Direct creation is covered in "entity creation".
 */
function solverWithEllipse(params: number[]): { solver: SketchSolver; ellipse: number } {
    const data: SketchData = {
        entities: [{ id: 1, type: "ellipse", params }],
        constraints: [],
    };
    return { solver: new SketchSolver(Plane.XY, data), ellipse: 1 };
}

function ref(entityId: number, pointIndex: number): SketchPointRef {
    return { entityId, pointIndex };
}

/** The two free (arbitrary-shape) curve families every "curve family" case is run against. */
type FreeFamily = "bezier" | "nurbs";

const FREE_CASES: { label: string; family: FreeFamily }[] = [
    { label: "Bezier", family: "bezier" },
    { label: "Nurbs", family: "nurbs" },
];

/**
 * The cubic control polygon of the same curve as the quadratic control polygon [Q0, Q1, Q2]:
 * degree elevation keeps the curve, so a cubic bezier and a degree-2 nurbs built from the
 * same quadratic poles are the identical shape.
 */
function elevateQuadratic(q: number[]): number[] {
    return [
        q[0],
        q[1],
        (q[0] + 2 * q[2]) / 3,
        (q[1] + 2 * q[3]) / 3,
        (2 * q[2] + q[4]) / 3,
        (2 * q[3] + q[5]) / 3,
        q[4],
        q[5],
    ];
}

/**
 * A free curve of `family` carrying the shape of the quadratic control polygon `poles`: a
 * cubic bezier through the degree-elevated poles, or a degree-2 nurbs through the poles
 * themselves. Both come out to the same drawn curve, so a family case's geometry and its
 * assertions stay identical whichever family runs.
 */
function addFreeCurve(solver: SketchSolver, family: FreeFamily, poles: number[]): number {
    return family === "bezier"
        ? solver.addBezier(elevateQuadratic(poles))
        : solver.addNurbs(poles, defaultNurbsSpec(poles.length / 2));
}

/** The curve-curve tangency kind of a fixed family and a free one, in garlic's rank order. */
function curveTangentKind(fixed: "circle" | "arc" | "ellipse" | "conic", free: FreeFamily): ConstraintKind {
    const kinds = {
        circle: { bezier: ConstraintKind.TangentCircleBezier, nurbs: ConstraintKind.TangentCircleNurbs },
        arc: { bezier: ConstraintKind.TangentArcBezier, nurbs: ConstraintKind.TangentArcNurbs },
        ellipse: { bezier: ConstraintKind.TangentEllipseBezier, nurbs: ConstraintKind.TangentEllipseNurbs },
        conic: { bezier: ConstraintKind.TangentConicBezier, nurbs: ConstraintKind.TangentConicNurbs },
    } as const;
    return kinds[fixed][free];
}

/** The line-curve tangency kind of a free family. */
const LINE_TANGENT_KIND: Record<FreeFamily, ConstraintKind> = {
    bezier: ConstraintKind.TangentLineBezier,
    nurbs: ConstraintKind.TangentLineNurbs,
};

/** The point-on kind of a free family. */
const POINT_ON_KIND: Record<FreeFamily, ConstraintKind> = {
    bezier: ConstraintKind.PointOnBezier,
    nurbs: ConstraintKind.PointOnNurbs,
};

describe("SketchSolver curve entities", () => {
    describe("entity creation", () => {
        test("addConic contributes 7 dofs and reports its params", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                expect(solver.dofs()).toBe(7);
                expect(solver.entities()).toEqual([{ id, type: "conic", params: [0, 0, 5, 10, 10, 0, 0.5] }]);
                expect(entityPointCount(solver.entity(id)!)).toBe(3);
            } finally {
                solver.dispose();
            }
        });

        test("addBezier contributes eight dofs and echoes its four fixed control poles", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addBezier([0, 0, 5, 8, 10, 0, 15, 4]);
                expect(solver.dofs()).toBe(8);
                expect(solver.entities()).toEqual([
                    { id, type: "bezier", params: [0, 0, 5, 8, 10, 0, 15, 4] },
                ]);
                expect(entityPointCount(solver.entity(id)!)).toBe(4);
            } finally {
                solver.dispose();
            }
        });

        test("addNurbs contributes two dofs per control pole and echoes its poles and weights", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                // the weights are garlic's solve parameters too, so the sketch pins them
                // (see `pinNurbsWeights`): what is left free is the control points
                const quadratic = solver.addNurbs([0, 0, 5, 8, 10, 0], defaultNurbsSpec(3));
                expect(solver.dofs()).toBe(6);
                const cubic = solver.addNurbs([0, 0, 5, 8, 10, 0, 15, 4], defaultNurbsSpec(4));
                expect(solver.dofs()).toBe(14);
                expect(cubic).toBeGreaterThan(quadratic);
                expect(solver.entities()).toEqual([
                    {
                        id: quadratic,
                        type: "nurbs",
                        params: [0, 0, 5, 8, 10, 0, 1, 1, 1],
                        nurbs: defaultNurbsSpec(3),
                    },
                    {
                        id: cubic,
                        type: "nurbs",
                        params: [0, 0, 5, 8, 10, 0, 15, 4, 1, 1, 1, 1],
                        nurbs: defaultNurbsSpec(4),
                    },
                ]);
                expect(entityPointCount(solver.entity(cubic)!)).toBe(4);
            } finally {
                solver.dispose();
            }
        });

        test("addBezier rejects a pole list that is not exactly four poles", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                expect(() => solver.addBezier([0, 0, 5, 8, 10, 0])).toThrow(/exactly four control poles/);
                expect(() => solver.addBezier([0, 0, 5, 8, 10, 0, 15, 4, 20, 0])).toThrow(
                    /exactly four control poles/,
                );
                expect(solver.entities()).toEqual([]);
            } finally {
                solver.dispose();
            }
        });

        test("addNurbs rejects a pole list shorter than two poles or a knot vector of the wrong length", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                expect(() => solver.addNurbs([0, 0, 5], defaultNurbsSpec(3))).toThrow(
                    /at least two control poles/,
                );
                expect(() => solver.addNurbs([0, 0], defaultNurbsSpec(3))).toThrow(
                    /at least two control poles/,
                );
                // degree 2 over three poles needs a knot vector of poles + degree + 1 = 6 entries
                expect(() => solver.addNurbs([0, 0, 5, 8, 10, 0], { degree: 2, knots: [0, 1] })).toThrow(
                    /knot vector/,
                );
                expect(solver.entities()).toEqual([]);
            } finally {
                solver.dispose();
            }
        });

        test("ids keep increasing across entity families and a load", () => {
            const solver = new SketchSolver(Plane.XY, {
                entities: [{ id: 4, type: "conic", params: [0, 0, 5, 10, 10, 0, 0.5] }],
                constraints: [],
            });
            try {
                const bezier = solver.addBezier([0, 0, 5, 8, 10, 0, 15, 4]);
                const nurbs = solver.addNurbs([0, 0, 5, 8, 10, 0], defaultNurbsSpec(3));
                const conic = solver.addConic(0, 0, 1, 1, 2, 0, 0.5);
                expect(bezier).toBeGreaterThan(4);
                expect(nurbs).toBeGreaterThan(bezier);
                expect(conic).toBeGreaterThan(nurbs);
            } finally {
                solver.dispose();
            }
        });

        test("addEllipse echoes its params, contributes 5 dofs and adds the structural axis perpendicular", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addEllipse(0, 0, 10, 0, 0, 5);
                // 6 point dofs, one spent on the structural Perpendicular
                expect(solver.dofs()).toBe(5);
                expect(solver.entities()).toEqual([{ id, type: "ellipse", params: [0, 0, 10, 0, 0, 5] }]);
                expect(entityPointCount(solver.entity(id)!)).toBe(3);
                expect(solver.toData().constraints).toEqual([
                    {
                        id: 1,
                        kind: ConstraintKind.Perpendicular,
                        refs: [ref(id, 0), ref(id, 1), ref(id, 0), ref(id, 2)],
                    },
                ]);
            } finally {
                solver.dispose();
            }
        });

        test("the structural perpendicular restores the axes after an axis-point drag", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addEllipse(0, 0, 10, 0, 0, 5);
                solver.setPointPosition(ref(id, 1), 10, 3);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                // the frame may move to meet the drag, but the axes are perpendicular again
                expect(axisCosine(solver.entity(id)!.params)).toBeCloseTo(0, 9);
            } finally {
                solver.dispose();
            }
        });

        test("addEllipseArc echoes its params, contributes 7 dofs and adds the axis perpendicular and rim pins", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const rim: [number, number, number, number] = [...ellipsePoint(0.5), ...ellipsePoint(2)];
                const id = solver.addEllipseArc(0, 0, 10, 0, 0, 5, ...rim);
                // 10 point dofs, three spent on the structural constraints
                expect(solver.dofs()).toBe(7);
                expect(solver.entities()).toEqual([
                    { id, type: "ellipseArc", params: [0, 0, 10, 0, 0, 5, ...rim] },
                ]);
                expect(entityPointCount(solver.entity(id)!)).toBe(5);
                expect(solver.toData().constraints).toEqual([
                    {
                        id: 1,
                        kind: ConstraintKind.Perpendicular,
                        refs: [ref(id, 0), ref(id, 1), ref(id, 0), ref(id, 2)],
                    },
                    { id: 2, kind: ConstraintKind.PointOnEllipse, refs: [ref(id, 3), ref(id, 0)] },
                    { id: 3, kind: ConstraintKind.PointOnEllipse, refs: [ref(id, 4), ref(id, 0)] },
                ]);
            } finally {
                solver.dispose();
            }
        });

        test("the rim pins pull a dragged rim point back onto the ellipse", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addEllipseArc(0, 0, 10, 0, 0, 5, ...ellipsePoint(0.5), ...ellipsePoint(2));
                solver.setPointPosition(ref(id, 3), 12, 4);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const arc = solver.entity(id)!;
                expect(projectSupport(arc, solver.pointOf(ref(id, 3))).distance).toBeLessThan(1e-6);
                expect(projectSupport(arc, solver.pointOf(ref(id, 4))).distance).toBeLessThan(1e-6);
                // the frame may move to meet the drag, but the axes stay perpendicular
                expect(axisCosine(arc.params)).toBeCloseTo(0, 9);
            } finally {
                solver.dispose();
            }
        });

        test("the ellipse family loads with its point dofs: ellipse 6, ellipseArc 10", () => {
            // loaded through the persisted-data path — see solverWithEllipse
            const solver = new SketchSolver(Plane.XY, {
                entities: [
                    { id: 1, type: "ellipse", params: [1, 2, 11, 2, 1, 7] },
                    {
                        id: 2,
                        type: "ellipseArc",
                        params: [0, 0, 10, 0, 0, 5, ...ellipsePoint(0.5), ...ellipsePoint(2)],
                    },
                ],
                constraints: [],
            });
            try {
                expect(solver.dofs()).toBe(16);
                expect(solver.entities()).toEqual([
                    { id: 1, type: "ellipse", params: [1, 2, 11, 2, 1, 7] },
                    {
                        id: 2,
                        type: "ellipseArc",
                        params: [0, 0, 10, 0, 0, 5, ...ellipsePoint(0.5), ...ellipsePoint(2)],
                    },
                ]);
                expect(entityPointCount(solver.entity(1)!)).toBe(3);
                expect(entityPointCount(solver.entity(2)!)).toBe(5);
            } finally {
                solver.dispose();
            }
        });

        test("entityPointCount agrees with pointOf for every index and rejects the next", () => {
            const solver = new SketchSolver(Plane.XY, {
                entities: [
                    { id: 1, type: "ellipse", params: [1, 2, 11, 2, 1, 7] },
                    {
                        id: 2,
                        type: "ellipseArc",
                        params: [0, 0, 10, 0, 0, 5, ...ellipsePoint(0.5), ...ellipsePoint(2)],
                    },
                    { id: 3, type: "conic", params: [0, 0, 5, 10, 10, 0, 0.5] },
                ],
                constraints: [],
            });
            try {
                solver.addBezier([0, 0, 5, 8, 10, 0, 15, 4]);
                solver.addNurbs([0, 0, 5, 8, 10, 0], defaultNurbsSpec(3));
                for (const entity of solver.entities()) {
                    const count = entityPointCount(entity);
                    for (let pointIndex = 0; pointIndex < count; pointIndex++) {
                        expect(solver.pointOf({ entityId: entity.id, pointIndex })).toEqual([
                            entity.params[2 * pointIndex],
                            entity.params[2 * pointIndex + 1],
                        ]);
                    }
                    expect(() => solver.pointOf({ entityId: entity.id, pointIndex: count })).toThrow(
                        /Invalid point ref/,
                    );
                }
            } finally {
                solver.dispose();
            }
        });
    });

    describe("ellipseArc structural rim incidence", () => {
        test("rim points are pulled onto the ellipse at load and stay on through edits", () => {
            const start = ellipsePoint(0.5);
            const end = ellipsePoint(2);
            // the two PointOnEllipse pins are what addStructuralConstraints gives an ellipseArc; the
            // Fixes pin the frame — a free frame lets the solve skew the axes, and garlic's implicit
            // PointOnEllipse accepts points measurably off the drawn parametric ellipse on a skewed frame
            const solver = new SketchSolver(Plane.XY, {
                entities: [
                    {
                        id: 1,
                        type: "ellipseArc",
                        params: [0, 0, 10, 0, 0, 5, start[0] + 0.1, start[1] - 0.08, end[0], end[1]],
                    },
                ],
                constraints: [
                    { id: 1, kind: ConstraintKind.PointOnEllipse, refs: [ref(1, 3), ref(1, 0)] },
                    { id: 2, kind: ConstraintKind.PointOnEllipse, refs: [ref(1, 4), ref(1, 0)] },
                    { id: 3, kind: ConstraintKind.Fix, refs: [ref(1, 0)], datums: [0, 0] },
                    { id: 4, kind: ConstraintKind.Fix, refs: [ref(1, 1)], datums: [10, 0] },
                    { id: 5, kind: ConstraintKind.Fix, refs: [ref(1, 2)], datums: [0, 5] },
                ],
            });
            try {
                // loadData's closing solve already snapped the drifted start onto the ellipse
                let arc = solver.entity(1)!;
                let projection = projectSupport(arc, solver.pointOf(ref(1, 3)));
                expect(projection.distance).toBeLessThan(1e-6);
                // the end was exactly on and stays so
                projection = projectSupport(arc, solver.pointOf(ref(1, 4)));
                expect(projection.distance).toBeLessThan(1e-6);

                solver.setPointPosition(ref(1, 3), 12, 4);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                arc = solver.entity(1)!;
                projection = projectSupport(arc, solver.pointOf(ref(1, 3)));
                expect(projection.distance).toBeLessThan(1e-6);
                // the pinned frame never moved
                arc.params.slice(0, 6).forEach((p, i) => expect(p).toBeCloseTo([0, 0, 10, 0, 0, 5][i], 9));
            } finally {
                solver.dispose();
            }
        });
    });

    describe("retypeEntity", () => {
        test("ellipse to ellipseArc preserves the frame, adds the rim and rebuilds the structural constraints", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addEllipse(0, 0, 10, 0, 0, 5);
                const fixId = solver.addConstraint({
                    kind: ConstraintKind.Fix,
                    refs: [ref(id, 0)],
                    datums: [0, 0],
                });
                const rim = [...ellipsePoint(0.5), ...ellipsePoint(2)];
                const transformed: ConstraintKind[] = [];
                const result = solver.retypeEntity(
                    id,
                    "ellipseArc",
                    [0, 0, 10, 0, 0, 5, ...rim],
                    (constraint) => {
                        transformed.push(constraint.kind);
                        return constraint;
                    },
                );
                expect(result.isOk).toBe(true);
                const dropped = result.isOk ? result.value : null;
                expect(dropped).toEqual([]);
                // the transform only ever saw the user constraint — the old structural
                // Perpendicular is dropped and rebuilt, never carried through
                expect(transformed).toEqual([ConstraintKind.Fix]);

                // same id, new type: the frame params survived, the rim points were added
                const arc = solver.entity(id)!;
                expect(arc.type).toBe("ellipseArc");
                expect(arc.params).toEqual([0, 0, 10, 0, 0, 5, ...rim]);
                expect(solver.dofs()).toBe(5);

                // the Fix kept its id; the structural constraints are fresh allocations
                const constraints = solver.toData().constraints;
                expect(constraints.find((c) => c.id === fixId)).toEqual({
                    id: fixId,
                    kind: ConstraintKind.Fix,
                    refs: [ref(id, 0)],
                    datums: [0, 0],
                });
                const structural = constraints.filter((c) => c.id !== fixId);
                expect(structural.every((c) => c.id > fixId)).toBe(true);
                expect(structural.map((c) => [c.kind, c.refs])).toEqual([
                    [ConstraintKind.Perpendicular, [ref(id, 0), ref(id, 1), ref(id, 0), ref(id, 2)]],
                    [ConstraintKind.PointOnEllipse, [ref(id, 3), ref(id, 0)]],
                    [ConstraintKind.PointOnEllipse, [ref(id, 4), ref(id, 0)]],
                ]);

                expect(solver.solve(true).result.startsWith("Ok")).toBe(true);
                // the rebuilt rim pins work: a dragged rim point comes back onto the ellipse
                solver.setPointPosition(ref(id, 3), 12, 4);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                expect(projectSupport(solver.entity(id)!, solver.pointOf(ref(id, 3))).distance).toBeLessThan(
                    1e-6,
                );
                // and the kept Fix still pins the centre
                const centre = solver.pointOf(ref(id, 0));
                expect(centre[0]).toBeCloseTo(0, 9);
                expect(centre[1]).toBeCloseTo(0, 9);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("incidence constraints", () => {
        test("PointOnEllipse pulls a line end onto a pinned ellipse", () => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                pinEllipseFrame(solver, ellipse);
                const line = solver.addLine(0, 0, 10.3, 0.2);
                const spec = pointOnConstraintFor("ellipse", ref(line, 1), ellipse)!;
                expect(spec.kind).toBe(ConstraintKind.PointOnEllipse);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const end = solver.pointOf(ref(line, 1));
                expect(projectSupport(solver.entity(ellipse)!, end).distance).toBeLessThan(1e-6);
            } finally {
                solver.dispose();
            }
        });

        test("PointOnConic pulls a line end onto the conic", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                const line = solver.addLine(-5, 3, 2.6, 3.6);
                const spec = pointOnConstraintFor("conic", ref(line, 1), conic)!;
                expect(spec.kind).toBe(ConstraintKind.PointOnConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const end = solver.pointOf(ref(line, 1));
                expect(projectSupport(solver.entity(conic)!, end).distance).toBeLessThan(1e-6);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("PointOn$label pulls a line end onto the free curve", ({ family }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const curve = addFreeCurve(solver, family, [0, 0, 5, 10, 10, 0]);
                const line = solver.addLine(-5, 8, 5.2, 4.8);
                const spec = pointOnConstraintFor(family, ref(line, 1), curve)!;
                expect(spec.kind).toBe(POINT_ON_KIND[family]);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const end = solver.pointOf(ref(line, 1));
                expect(projectSupport(solver.entity(curve)!, end).distance).toBeLessThan(1e-6);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("tangency constraints", () => {
        test("TangentLineEllipse makes the line touch a pinned ellipse tangentially", () => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                pinEllipseFrame(solver, ellipse);
                const line = solver.addLine(-20, 5.3, 20, 4.9);
                const spec = tangentConstraintFor("line", line, "ellipse", ellipse)!;
                expect(spec.kind).toBe(ConstraintKind.TangentLineEllipse);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = lineTangency(solver.entity(line)!.params, solver.entity(ellipse)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
                expect(measure.lineT).toBeGreaterThan(0);
                expect(measure.lineT).toBeLessThan(1);
            } finally {
                solver.dispose();
            }
        });

        test("TangentLineConic makes the line touch the conic's apex tangentially", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                const line = solver.addLine(-5, 5.3, 15, 5.1);
                const spec = tangentConstraintFor("line", line, "conic", conic)!;
                expect(spec.kind).toBe(ConstraintKind.TangentLineConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = lineTangency(solver.entity(line)!.params, solver.entity(conic)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
                expect(measure.lineT).toBeGreaterThan(0);
                expect(measure.lineT).toBeLessThan(1);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("TangentLine$label makes the line touch the free curve's apex", ({
            family,
        }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const curve = addFreeCurve(solver, family, [0, 0, 5, 8, 10, 0]);
                const line = solver.addLine(-5, 4.3, 15, 4.1);
                const spec = tangentConstraintFor("line", line, family, curve)!;
                expect(spec.kind).toBe(LINE_TANGENT_KIND[family]);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = lineTangency(solver.entity(line)!.params, solver.entity(curve)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
                expect(measure.lineT).toBeGreaterThan(0);
                expect(measure.lineT).toBeLessThan(1);
            } finally {
                solver.dispose();
            }
        });

        test("TangentCircleEllipse makes the circle touch a pinned ellipse tangentially", () => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                pinEllipseFrame(solver, ellipse);
                const circle = solver.addCircle(15.2, 0, 5);
                const spec = tangentConstraintFor("circle", circle, "ellipse", ellipse)!;
                expect(spec.kind).toBe(ConstraintKind.TangentCircleEllipse);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(circle)!, solver.entity(ellipse)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentCircleConic makes the circle touch the conic's apex tangentially", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const circle = solver.addCircle(5, 9.3, 4);
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                const spec = tangentConstraintFor("circle", circle, "conic", conic)!;
                expect(spec.kind).toBe(ConstraintKind.TangentCircleConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(circle)!, solver.entity(conic)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("TangentCircle$label makes the circle touch the free curve's apex", ({
            family,
        }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const circle = solver.addCircle(5, 8.2, 4);
                const curve = addFreeCurve(solver, family, [0, 0, 5, 8, 10, 0]);
                const spec = tangentConstraintFor("circle", circle, family, curve)!;
                expect(spec.kind).toBe(curveTangentKind("circle", family));
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(circle)!, solver.entity(curve)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentArcEllipse makes the arc touch the ellipse tangentially", () => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                const arc = solver.addArc(15.2, 0, 10.2, 0, 15.2, 5);
                const spec = tangentConstraintFor("arc", arc, "ellipse", ellipse)!;
                expect(spec.kind).toBe(ConstraintKind.TangentArcEllipse);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(arc)!, solver.entity(ellipse)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentArcConic makes the conic touch the arc tangentially", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const arc = solver.addArc(0, 0, 5, 0, 0, 5);
                const conic = solver.addConic(2.404, 6.646, 2.828, 2.828, 6.646, 2.404, 0.5);
                const spec = tangentConstraintFor("arc", arc, "conic", conic)!;
                expect(spec.kind).toBe(ConstraintKind.TangentArcConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(arc)!, solver.entity(conic)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("TangentArc$label makes the free curve touch the arc tangentially", ({
            family,
        }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const arc = solver.addArc(0, 0, 5, 0, 0, 5);
                const curve = addFreeCurve(solver, family, [2.404, 6.646, 2.829, 2.829, 6.646, 2.404]);
                const spec = tangentConstraintFor("arc", arc, family, curve)!;
                expect(spec.kind).toBe(curveTangentKind("arc", family));
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(arc)!, solver.entity(curve)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentEllipseEllipse makes two ellipses touch tangentially", () => {
            const solver = new SketchSolver(Plane.XY, {
                entities: [
                    { id: 1, type: "ellipse", params: [0, 0, 10, 0, 0, 5] },
                    { id: 2, type: "ellipse", params: [20.2, 0, 30.2, 0, 20.2, 5] },
                ],
                constraints: [],
            });
            try {
                const spec = tangentConstraintFor("ellipse", 1, "ellipse", 2)!;
                expect(spec.kind).toBe(ConstraintKind.TangentEllipseEllipse);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(1)!, solver.entity(2)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentEllipseConic makes the conic touch a pinned ellipse tangentially", () => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                pinEllipseFrame(solver, ellipse);
                const conic = solver.addConic(10.2, -3, 10.4, 0, 10.2, 3, 0.5);
                const spec = tangentConstraintFor("ellipse", ellipse, "conic", conic)!;
                expect(spec.kind).toBe(ConstraintKind.TangentEllipseConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(conic)!, solver.entity(ellipse)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("TangentEllipse$label makes the free curve touch a pinned ellipse", ({
            family,
        }) => {
            const { solver, ellipse } = solverWithEllipse([0, 0, 10, 0, 0, 5]);
            try {
                pinEllipseFrame(solver, ellipse);
                const curve = addFreeCurve(solver, family, [10.2, -3, 10.4, 0, 10.2, 3]);
                const spec = tangentConstraintFor("ellipse", ellipse, family, curve)!;
                expect(spec.kind).toBe(curveTangentKind("ellipse", family));
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(curve)!, solver.entity(ellipse)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test("TangentConicConic makes two conics touch apex to apex", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const c1 = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                const c2 = solver.addConic(0, 10.4, 5, 0.4, 10, 10.4, 0.5);
                const spec = tangentConstraintFor("conic", c1, "conic", c2)!;
                expect(spec.kind).toBe(ConstraintKind.TangentConicConic);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(c1)!, solver.entity(c2)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test.each(FREE_CASES)("TangentConic$label makes the conic and the free curve touch apex to apex", ({
            family,
        }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                const curve = addFreeCurve(solver, family, [0, 10.4, 5, 0.4, 10, 10.4]);
                const spec = tangentConstraintFor("conic", conic, family, curve)!;
                expect(spec.kind).toBe(curveTangentKind("conic", family));
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(conic)!, solver.entity(curve)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });

        test.each([
            {
                pair: "BezierBezier",
                first: "bezier" as FreeFamily,
                second: "bezier" as FreeFamily,
                kind: ConstraintKind.TangentBezierBezier,
            },
            {
                pair: "BezierNurbs",
                first: "bezier" as FreeFamily,
                second: "nurbs" as FreeFamily,
                kind: ConstraintKind.TangentBezierNurbs,
            },
            {
                pair: "NurbsNurbs",
                first: "nurbs" as FreeFamily,
                second: "nurbs" as FreeFamily,
                kind: ConstraintKind.TangentNurbsNurbs,
            },
        ])("Tangent$pair makes two free curves touch apex to apex", ({ first, second, kind }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const s1 = addFreeCurve(solver, first, [0, 0, 5, 8, 10, 0]);
                const s2 = addFreeCurve(solver, second, [0, 8.6, 5, 0.6, 10, 8.6]);
                const spec = tangentConstraintFor(first, s1, second, s2)!;
                expect(spec.kind).toBe(kind);
                solver.addConstraint(spec);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const measure = curveTangency(solver.entity(s1)!, solver.entity(s2)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("ConicRho datum", () => {
        test("the datum drives the conic's rho and with it the shoulder", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.3);
                solver.addConstraint({ kind: ConstraintKind.ConicRho, refs: [ref(conic, 0)], datum: 0.7 });
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const params = solver.entity(conic)!.params;
                expect(params[6]).toBeCloseTo(0.7, 9);
                // the poles are free and stay; only the rho moved the shoulder to M + 0.7·(C − M)
                const shoulder = conicShoulder(params);
                expect(shoulder[0]).toBeCloseTo(5, 6);
                expect(shoulder[1]).toBeCloseTo(7, 6);
            } finally {
                solver.dispose();
            }
        });

        test("a datumless ConicRho pins the current rho through later edits", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.3);
                solver.addConstraint({ kind: ConstraintKind.ConicRho, refs: [ref(conic, 0)] });
                solver.solve(true);
                solver.setPointPosition(ref(conic, 1), 6, 12);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                expect(solver.entity(conic)!.params[6]).toBeCloseTo(0.3, 9);
                expect(solver.pointOf(ref(conic, 1))[0]).toBeCloseTo(6, 6);
            } finally {
                solver.dispose();
            }
        });

        test("setConicRho writes the param without a solve and rejects a non-conic", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.3);
                solver.setConicRho(conic, 0.42);
                expect(solver.entity(conic)!.params[6]).toBe(0.42);
                const line = solver.addLine(0, 0, 1, 1);
                expect(() => solver.setConicRho(line, 0.5)).toThrow(`Entity ${line} is not a conic`);
            } finally {
                solver.dispose();
            }
        });

        test("a conic tangent to a circle still solves with its rho driven", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const circle = solver.addCircle(5, 9.3, 4);
                const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
                solver.addConstraint(tangentConstraintFor("circle", circle, "conic", conic)!);
                solver.addConstraint({ kind: ConstraintKind.ConicRho, refs: [ref(conic, 0)], datum: 0.6 });
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                expect(solver.entity(conic)!.params[6]).toBeCloseTo(0.6, 9);
                const measure = curveTangency(solver.entity(circle)!, solver.entity(conic)!);
                expect(measure.distance).toBeLessThan(1e-6);
                expect(measure.sinAngle).toBeLessThan(1e-3);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("serialization", () => {
        test("toData round-trips every curve type with identical params, spec and constraints", () => {
            const solver = new SketchSolver(Plane.XY, {
                entities: [
                    { id: 1, type: "ellipse", params: [1, 2, 11, 2, 1, 7] },
                    {
                        id: 2,
                        type: "ellipseArc",
                        params: [0, 0, 10, 0, 0, 5, ...ellipsePoint(0.5), ...ellipsePoint(2)],
                    },
                ],
                constraints: [
                    { id: 1, kind: ConstraintKind.PointOnEllipse, refs: [ref(2, 3), ref(2, 0)] },
                    { id: 2, kind: ConstraintKind.PointOnEllipse, refs: [ref(2, 4), ref(2, 0)] },
                ],
            });
            const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.42);
            solver.addBezier([0, 0, 5, 8, 10, 0, 15, 4]);
            solver.addNurbs([0, 0, 5, 8, 10, 0], defaultNurbsSpec(3));
            solver.addConstraint({ kind: ConstraintKind.ConicRho, refs: [ref(conic, 0)], datum: 0.6 });
            solver.solve(true);
            try {
                const data = solver.toData();
                const restored = new SketchSolver(Plane.XY, data);
                try {
                    const expected = solver.entities();
                    const actual = restored.entities();
                    expect(actual.length).toBe(expected.length);
                    for (let i = 0; i < expected.length; i++) {
                        expect(actual[i].id).toBe(expected[i].id);
                        expect(actual[i].type).toBe(expected[i].type);
                        // a nurbs' degree and knots ride on the entity, so they must survive too
                        expect(actual[i].nurbs).toEqual(expected[i].nurbs);
                        expected[i].params.forEach((p, j) => expect(actual[i].params[j]).toBeCloseTo(p, 9));
                    }
                    expect(restored.toData().constraints).toEqual(data.constraints);
                } finally {
                    restored.dispose();
                }
            } finally {
                solver.dispose();
            }
        });
    });

    describe("coincidence across families", () => {
        test.each(FREE_CASES)("a $label pole coincident with a line end survives editing another pole", ({
            family,
        }) => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const curve = addFreeCurve(solver, family, [0, 0, 10, 10, 20, 0]);
                // degree elevation keeps the ends put, so the last control pole is (20, 0)
                const lastPole = entityPointCount(solver.entity(curve)!) - 1;
                const line = solver.addLine(20.3, 0.4, 30, 5);
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [ref(curve, lastPole), ref(line, 0)],
                });
                expect(solver.solve(true).result.startsWith("Ok")).toBe(true);

                solver.setPointPosition(ref(curve, 1), 10, 16);
                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const pole = solver.pointOf(ref(curve, lastPole));
                const end = solver.pointOf(ref(line, 0));
                expect(pole[0]).toBeCloseTo(end[0], 6);
                expect(pole[1]).toBeCloseTo(end[1], 6);
                // the line's unconstrained end never moved
                const freeEnd = solver.pointOf(ref(line, 1));
                expect(freeEnd[0]).toBeCloseTo(30, 6);
                expect(freeEnd[1]).toBeCloseTo(5, 6);
            } finally {
                solver.dispose();
            }
        });
    });
});

describe("SketchSolver curve entities: copies and splits", () => {
    test("an offset curve is not a tangency target, and asking does not raise", () => {
        // this used to throw, which reached the tangent command as an uncaught error instead
        // of the "these two cannot be tangent" the pick deserves
        expect(tangentKindFor("offsetCurve", "line")).toBeUndefined();
        expect(tangentKindFor("circle", "offsetCurve")).toBeUndefined();
        expect(tangentKindFor("offsetCurve", "offsetCurve")).toBeUndefined();
    });

    test("entityPointCount floors a nurbs' params the way nurbsPoleCount does", () => {
        const params = [0, 0, 1, 1, 2, 2, 1];
        expect(nurbsPoleCount(params)).toBe(2);
        expect(entityPointCount({ type: "nurbs", params })).toBe(2);
    });

    test("a copy of a NURBS reads the source's own construction constants", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // knots that are *not* the clamped uniform default: a copy read without them would
            // be a different curve of the same pole count
            const spec = { degree: 2, knots: [0, 0, 0, 1, 2, 2, 2] };
            const source = solver.addNurbs([0, 0, 4, 0, 8, 4, 12, 0], spec);
            const copy = solver.addEntityFromParams("offsetCurve", [], undefined, {
                sourceId: source,
                sourceType: "nurbs",
                distance: 1,
            });
            expect(solver.entity(copy)?.nurbs).toEqual(spec);
            expect(solver.entities().find((entity) => entity.id === copy)?.nurbs).toEqual(spec);
        } finally {
            solver.dispose();
        }
    });

    test.each([
        ["conic", (solver: SketchSolver) => solver.addConic(0, 0, 10, 10, 20, 0, 0.5)],
        ["bezier", (solver: SketchSolver) => solver.addBezier(elevateQuadratic([0, 0, 10, 10, 20, 0]))],
        ["nurbs", (solver: SketchSolver) => solver.addNurbs([0, 0, 10, 10, 20, 0], defaultNurbsSpec(3))],
    ] as const)("splitting a %s carries the far end's constraints onto the new half", (_family, build) => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const curve = build(solver);
            const lastPole = entityPointCount(solver.entity(curve)!) - 1;
            const line = solver.addLine(20, 0, 30, 5);
            const tie = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(curve, lastPole), ref(line, 0)],
            });

            const split = splitCurveEntity(solver, solver.entity(curve)!, 0.4, 0.6);
            expect(split.isOk).toBe(true);
            // the far half is the entity that now holds the point, so the tie follows it
            // there — a reshape drops what reads a pole the kept piece no longer has, and
            // waiting until after the reshape would find nothing left to move
            const kept = solver.toData().constraints.find((constraint) => constraint.id === tie);
            expect(kept).toBeDefined();
            expect(kept!.refs[0].entityId).toBe(split.value.newId);
            expect(kept!.refs[1].entityId).toBe(line);
        } finally {
            solver.dispose();
        }
    });
});
