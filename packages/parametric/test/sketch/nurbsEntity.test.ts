// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The NURBS entity and the cubic bezier beside it: what a sketch stores for them, what
 * survives a save and a reload, and what the curve ops make of a curve whose control-point
 * count is not fixed. The family suites cover the constraints; these are the parts only a
 * NURBS has — its construction constants (degree and knot vector), the reshape a split
 * costs, and the kernel edge built from it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IBSplineCurve, type IEdge, type IWire, Plane, ShapeTypes } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { breakEntity } from "../../src/sketch/breakOps";
import {
    curveControlPoints,
    evaluateNurbs,
    nurbsDomain,
    nurbsPoleCount,
    nurbsSpec,
    nurbsWeights,
    projectPoint,
    sampleEntity,
} from "../../src/sketch/curveEval";
import { type CurveSplit, isBroken, reshapeCurve, splitCurveEntity } from "../../src/sketch/entityEditOps";
import { extendEntity } from "../../src/sketch/extendOps";
import {
    ConstraintKind,
    clampedUniformKnots,
    defaultNurbsSpec,
    entityPointCount,
    type NurbsSpec,
    type SketchEntityType,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });
const TOLERANCE = 1e-6;

/** The control points of a curve whose shape climbs and comes back down. */
const POLES = [
    [0, 0],
    [2, 8],
    [6, 8],
    [8, 0],
    [10, 6],
    [12, 0],
];

function addCurve(solver: SketchSolver): number {
    return solver.addNurbs(POLES.flat(), defaultNurbsSpec(POLES.length));
}

/** How far a point lies from a polyline. */
function distanceToPolyline(point: readonly [number, number], points: readonly [number, number][]): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t =
            lengthSq < 1e-30
                ? 0
                : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSq));
        best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
    return best;
}

/**
 * How far the worst sample of `entityId` lies from `original` — the curve it was cut out
 * of, evaluated rather than approximated, so the number says whether the two are the same
 * curve and not how finely either was sampled.
 */
function gapToCurve(
    solver: SketchSolver,
    entityId: number,
    original: { type: SketchEntityType; params: number[]; nurbs?: NurbsSpec },
): number {
    const entity = solver.entity(entityId);
    expect(entity).toBeDefined();
    let worst = 0;
    for (const point of sampleEntity(entity!, 128)) {
        worst = Math.max(worst, projectPoint(original, point).distance);
    }
    return worst;
}

/** A constraint tying one of `entityId`'s control points to a fresh line's end. */
function pinPole(solver: SketchSolver, entityId: number, pointIndex: number): number {
    const line = solver.addLine(pointIndex, -20, pointIndex, -18);
    return solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [ref(line, 1), ref(entityId, pointIndex)],
    });
}

describe("sketch NURBS entity", () => {
    test("stores its construction constants beside the control points", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const entity = solver.entity(id)!;
        expect(entity.type).toBe("nurbs");
        // three params per control point: two coordinates and the unit weight
        expect(entity.params.length).toBe(POLES.length * 3);
        expect(entity.params.slice(0, POLES.length * 2)).toEqual(POLES.flat());
        expect(entity.params.slice(POLES.length * 2)).toEqual(new Array(POLES.length).fill(1));
        expect(entity.nurbs).toEqual({ degree: 3, knots: clampedUniformKnots(POLES.length, 3) });
        expect(entityPointCount(entity)).toBe(POLES.length);
    });

    test("a reload reads back the same knots, degree and constraints", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const line = solver.addLine(0, -20, 0, -18);
        const pinned = solver.addConstraint({
            kind: ConstraintKind.PointOnNurbs,
            refs: [ref(line, 1), ref(id, 0)],
        });
        const data = solver.toData();

        const reloaded = new SketchSolver(Plane.XY, data);
        const entity = reloaded.entity(id)!;
        expect(entity.type).toBe("nurbs");
        expect(entity.nurbs).toEqual({ degree: 3, knots: clampedUniformKnots(POLES.length, 3) });
        expect(entity.params.length).toBe(POLES.length * 3);
        expect(reloaded.toData().constraints.find((c) => c.id === pinned)?.kind).toBe(
            ConstraintKind.PointOnNurbs,
        );
        // the reloaded constraint still holds: it is a curve constraint, and the curve came
        // back with the knots it is read with — the gap is what proves the two agree
        const curve = reloaded.entity(id)!;
        expect(distanceToPolyline(reloaded.pointOf(ref(line, 1)), sampleEntity(curve, 2048))).toBeLessThan(
            1e-4,
        );
        // and the tree it comes back as is the tree that goes in: another load changes nothing
        const again = new SketchSolver(Plane.XY, reloaded.toData()).toData();
        expect(again.entities).toEqual(reloaded.toData().entities);
    });

    test("fits the clamped uniform structure when the stored one does not belong to the poles", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const data = solver.toData();
        // a hand-edited document: the knot vector belongs to a curve of another size
        data.entities[0].nurbs = { degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1] };

        const reloaded = new SketchSolver(Plane.XY, data);
        expect(reloaded.entity(id)!.nurbs).toEqual(defaultNurbsSpec(POLES.length));
        expect(sampleEntity(reloaded.entity(id)!, 8).length).toBe(9);
    });

    test("drops a partial control point rather than failing the load", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const data = solver.toData();
        // two stray numbers: a control point's coordinates with no weight of its own
        data.entities[0].params = [...data.entities[0].params, 3, 3];

        const reloaded = new SketchSolver(Plane.XY, data);
        expect(reloaded.entity(id)!.params).toEqual(solver.entity(id)!.params);
    });

    test("reads a params list that is not three per pole as the poles it holds", () => {
        // a malformed entity — a tool's half-built probe, or hand-written data — used to
        // reach `new Array(degree + 1)` with a fractional degree and throw out of a rebuild
        const curve = { type: "nurbs" as const, params: [0, 0, 4, 4] };
        expect(nurbsPoleCount(curve.params)).toBe(1);
        expect(sampleEntity(curve).length).toBeGreaterThan(0);
        expect(evaluateNurbs([[0, 0]], [1], { degree: 0, knots: [0, 1] }, 0)).toEqual([0, 0]);
    });

    test("refuses a bezier that is not a cubic, and a NURBS its knots cannot carry", () => {
        const solver = new SketchSolver(Plane.XY);
        expect(() => solver.addBezier([0, 0, 1, 1, 2, 0])).toThrow(/exactly four control poles/);
        expect(() => solver.addBezier([0, 0, 1, 1, 2, 0, 3, 3])).not.toThrow();
        // degree 3 over two poles, and a knot vector of the wrong length
        expect(() => solver.addNurbs([0, 0, 1, 1], { degree: 3, knots: [0, 0, 0, 0, 1, 1] })).toThrow(
            /cannot carry degree/,
        );
        expect(() => solver.addNurbs([0, 0, 1, 1, 2, 0], { degree: 2, knots: [0, 0, 0, 1, 1] })).toThrow(
            /knot vector is poles \+ degree \+ 1 long/,
        );
    });

    test("counts a degree of freedom per control point coordinate, the weights held", () => {
        const solver = new SketchSolver(Plane.XY);
        const before = solver.dofs();
        addCurve(solver);
        // the weights are the solver's parameters too (garlic's own layout), so the sketch
        // pins them: what is left to place is the control points
        expect(solver.dofs() - before).toBe(POLES.length * 2);
    });

    test("a solve moves the control points and leaves the weights alone", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const line = solver.addLine(0, 12, 1, 12);
        solver.addConstraint({ kind: ConstraintKind.PointOnNurbs, refs: [ref(line, 0), ref(id, 0)] });
        expect(isBroken(solver.solve(true).result)).toBe(false);
        // the whole curve is free but its weights, so the constraint is taken up by the
        // control points — and the curve stays the plain B-spline it was drawn as. A weight
        // driven to zero or below would be a curve the kernel refuses to build at all
        expect(nurbsWeights(solver.entity(id)!.params)).toEqual(new Array(POLES.length).fill(1));
        expect(curveControlPoints(solver.entity(id)!).flat()).not.toEqual(POLES.flat());
        expect(
            distanceToPolyline(solver.pointOf(ref(line, 0)), sampleEntity(solver.entity(id)!, 2048)),
        ).toBeLessThan(1e-4);
    });

    test("a point-on constraint pulls a line end onto the curve", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const line = solver.addLine(0, 12, 1, 12);
        solver.addConstraint({ kind: ConstraintKind.PointOnNurbs, refs: [ref(line, 0), ref(id, 0)] });
        expect(isBroken(solver.solve(true).result)).toBe(false);
        const curve = solver.entity(id)!;
        expect(distanceToPolyline(solver.pointOf(ref(line, 0)), sampleEntity(curve, 2048))).toBeLessThan(
            1e-4,
        );
    });
});

describe("curve ops on a NURBS", () => {
    test("a break carves two halves that retrace the curve they came from", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const original = { ...solver.entity(id)! };

        const outcome = breakEntity(solver, id, [[5.5, 7.5]], TOLERANCE);
        expect(outcome.isOk).toBe(true);
        const [keptId, halfId] = outcome.value.entityIds;
        expect(keptId).toBe(id);
        expect(solver.entity(id)!.type).toBe("nurbs");
        expect(solver.entity(halfId)!.type).toBe("nurbs");
        // the curve really was reshaped rather than left alone, and each half traces the
        // curve it was cut out of — neither is a refit or a deformation
        expect(solver.entity(id)!.params).not.toEqual(original.params);
        expect(gapToCurve(solver, id, original)).toBeLessThan(1e-9);
        expect(gapToCurve(solver, halfId, original)).toBeLessThan(1e-9);
        // the cut is shared: a coincidence holds the two halves together at it
        expect(
            solver
                .toData()
                .constraints.some(
                    (c) =>
                        c.kind === ConstraintKind.P2PCoincident &&
                        c.refs.some((r) => r.entityId === id) &&
                        c.refs.some((r) => r.entityId === halfId),
                ),
        ).toBe(true);
        // and the two halves meet: the kept half's far end is the new half's start
        const kept = solver.entity(id)!;
        const keptEnd = solver.pointOf(ref(id, entityPointCount(kept) - 1));
        const halfStart = solver.pointOf(ref(halfId, 0));
        expect(Math.hypot(keptEnd[0] - halfStart[0], keptEnd[1] - halfStart[1])).toBeLessThan(1e-9);
    });

    test("a reshape keeps the control points that stand still and drops the ones that move", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        // the curve is clamped, so its first control point is on the curve; an interior one
        // is a handle, and a piece of the curve has no reason to carry it
        const startPin = pinPole(solver, id, 0);
        const handlePin = pinPole(solver, id, 2);
        // deliberately unsolved: the curve is entirely free, so a solve would drag its
        // control points to wherever the two pinned line ends are before the reshape runs
        const before = solver.entity(id)!;
        const spec = nurbsSpec(before);
        const [start, end] = nurbsDomain(spec, POLES.length);
        const cut = start + (end - start) * 0.2;
        const split = splitCurveEntity(solver, before, cut, start + (end - start) * 0.8);
        expect(split.isOk).toBe(true);
        const { newId, dropped } = (split as { value: CurveSplit }).value;

        const kept = solver.entity(id)!;
        expect(kept.type).toBe("nurbs");
        // the piece's own first control point is where the original's was — the curve is
        // clamped, and a piece keeps the end it was cut away from — so that constraint
        // still says what it said, while the handle is gone with its control point
        const startPoint = solver.pointOf(ref(id, 0));
        expect(Math.hypot(startPoint[0] - POLES[0][0], startPoint[1] - POLES[0][1])).toBeLessThan(1e-9);
        const constraintIds = solver.toData().constraints.map((c) => c.id);
        expect(constraintIds).toContain(startPin);
        expect(constraintIds).not.toContain(handlePin);
        expect(dropped).toEqual([handlePin]);
        // the far half is a curve of its own, and the far end moved onto it
        expect(solver.entity(newId)!.type).toBe("nurbs");
        expect(gapToCurve(solver, newId, before)).toBeLessThan(1e-9);
    });

    test("an extent inside the domain shortens the curve, one past its ends is refused", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const original = { ...solver.entity(id)! };
        const boundary = solver.addLine(9.5, -20, 9.5, 20);
        // a corner the curve really reaches: the far end moves back to it, and what is left
        // is still the same curve over a shorter domain
        const shortened = extendEntity(solver, {
            targetId: id,
            targetUv: [10, 4],
            boundaryId: boundary,
            boundaryUv: [9.5, 4],
            modifyBoundary: false,
            tolerance: TOLERANCE,
        });
        expect(shortened.isOk).toBe(true);
        expect(gapToCurve(solver, id, original)).toBeLessThan(1e-9);

        // a NURBS is defined on its knot domain: a corner past its ends is off the curve
        const other = new SketchSolver(Plane.XY);
        const otherId = addCurve(other);
        const far = other.addLine(40, 30, 41, 30);
        const refused = extendEntity(other, {
            targetId: otherId,
            targetUv: [12, 0],
            boundaryId: far,
            boundaryUv: [40, 30],
            modifyBoundary: false,
            tolerance: TOLERANCE,
        });
        expect(refused.isOk).toBe(false);
    });

    test("a reshape of the whole domain leaves the curve exactly as it was", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = addCurve(solver);
        const entity = solver.entity(id)!;
        const spec = nurbsSpec(entity);
        expect(nurbsDomain(spec, POLES.length)).toEqual([0, 3]);
        const reshaped = reshapeCurve(solver, entity, {
            poles: curveControlPoints(entity),
            weights: entity.params.slice(POLES.length * 2),
            spec,
        });
        expect(reshaped.isOk).toBe(true);
        expect(reshaped.value).toEqual([]);
        expect(solver.entity(id)!.params).toEqual(entity.params);
    });
});

describe("NURBS edge into the kernel", () => {
    let factory: ShapeFactory;

    beforeAll(async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        factory = new ShapeFactory();
        Object.defineProperty(globalThis, "shapeFactory", {
            value: factory,
            writable: true,
            configurable: true,
        });
    });

    /** The sketch's own edge for one entity, through the node that builds them. */
    function edgeOf(solver: SketchSolver): { isOk: boolean; value: IEdge[]; error?: string } {
        const node = new SketchNode({
            document: createMockDocument(),
            plane: Plane.XY,
            data: solver.toData(),
        });
        const build = (node as unknown as { buildEdges(d: unknown): unknown }).buildEdges.bind(node);
        return build(solver.toData()) as { isOk: boolean; value: IEdge[]; error?: string };
    }

    test("builds one exact B-spline edge, not a sampled polyline", () => {
        const solver = new SketchSolver(Plane.XY);
        addCurve(solver);
        const edges = edgeOf(solver);
        expect(edges.isOk).toBe(true);
        expect(edges.value.length).toBe(1);
        const edge = edges.value[0];
        expect(edge.shapeType).toBe(ShapeTypes.edge);
        const curve = edge.curve.basisCurve;
        expect(curve.curveType).toBe("bsplineCurve");
        // the entity's own structure, not an approximation of it
        const bspline = curve as IBSplineCurve;
        expect(bspline.degree()).toBe(3);
        expect(bspline.nbPoles()).toBe(POLES.length);
        expect(bspline.nbKnots()).toBe(4);
        // the edge is the curve the sketch draws: its clamped ends are the first and last
        // control points, which is what says the knots and poles reached the kernel as they are
        const start = edge.startPoint();
        const end = edge.endPoint();
        expect(start.x).toBeCloseTo(POLES[0][0], 9);
        expect(start.y).toBeCloseTo(POLES[0][1], 9);
        expect(end.x).toBeCloseTo(POLES[POLES.length - 1][0], 9);
        expect(end.y).toBeCloseTo(POLES[POLES.length - 1][1], 9);
    });

    test("a closed NURBS becomes a face bounded by one curve edge", () => {
        const solver = new SketchSolver(Plane.XY);
        // a convex control polygon repeating its first point, so the loop closes
        const loop: [number, number][] = [
            [0, 0],
            [4, 1],
            [6, 4],
            [3, 7],
            [-1, 5],
            [-2, 2],
            [0, 0],
        ];
        solver.addNurbs(loop.flat(), defaultNurbsSpec(loop.length));
        const edges = edgeOf(solver);
        expect(edges.isOk).toBe(true);
        const edge = edges.value[0];
        expect(edge.curve.basisCurve.curveType).toBe("bsplineCurve");
        expect(edge.startPoint().distanceTo(edge.endPoint())).toBeLessThan(1e-9);
        // the kernel takes the closed curve as a profile boundary: one wire, one face —
        // the region an extrude would be built from
        const wire = factory.wire([edge]);
        expect(wire.isOk).toBe(true);
        const face = factory.face([wire.value as IWire]);
        expect(face.isOk).toBe(true);
        expect(face.value.shapeType).toBe(ShapeTypes.face);
    });
});
