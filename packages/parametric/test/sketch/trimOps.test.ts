// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { entityDomain, evaluateEntity, isClosedEntity, projectPoint } from "../../src/sketch/curveEval";
import type { CurvePiece } from "../../src/sketch/curveGeometry";
import { offsetEntities, windowParameterAt } from "../../src/sketch/offsetOps";
import {
    arcAngles,
    ConstraintKind,
    SKETCH_X_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { type TrimOutcome, trimEntity, trimPreview } from "../../src/sketch/trimOps";
import "./setup";

const TOLERANCE = 1e-6;

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** A horizontal line crossed in the middle by a vertical one. */
function crossSolver() {
    const solver = new SketchSolver(Plane.XY);
    const horizontal = solver.addLine(0, 0, 10, 0);
    const vertical = solver.addLine(5, -5, 5, 5);
    return { solver, horizontal, vertical };
}

function trim(solver: SketchSolver, entityId: number, uv: [number, number]): TrimOutcome {
    const result = trimEntity(solver, entityId, uv, TOLERANCE);
    if (!result.isOk) throw new Error(`the trim was refused: ${result.error}`);
    return result.value;
}

function entityOf(solver: SketchSolver, id: number): SketchEntityData {
    const entity = solver.entity(id);
    expect(entity).toBeDefined();
    return entity!;
}

/** The four numbers of a line's params, as a plain array. */
function lineParams(solver: SketchSolver, id: number): number[] {
    const entity = entityOf(solver, id);
    expect(entity.type).toBe("line");
    return entity.params.map((value) => Math.round(value * 1e6) / 1e6);
}

function constraintsOf(solver: SketchSolver, kind: ConstraintKind): SketchConstraintData[] {
    return solver.toData().constraints.filter((constraint) => constraint.kind === kind);
}

describe("trimEntity crossings", () => {
    test("shortens a line to the crossing nearest the click", () => {
        const { solver, horizontal } = crossSolver();
        try {
            const outcome = trim(solver, horizontal, [8, 0]);
            expect(outcome.entityIds).toEqual([horizontal]);
            expect(outcome.deletedEntities).toEqual([]);
            expect(lineParams(solver, horizontal)).toEqual([0, 0, 5, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("shortens from the other end when the click is left of the crossing", () => {
        const { solver, horizontal } = crossSolver();
        try {
            trim(solver, horizontal, [2, 0]);
            expect(lineParams(solver, horizontal)).toEqual([5, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("pins the new endpoint onto the crossing line", () => {
        const { solver, horizontal, vertical } = crossSolver();
        try {
            trim(solver, horizontal, [8, 0]);
            const pinned = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pinned).toHaveLength(1);
            expect(pinned[0].refs[0]).toEqual(ref(horizontal, 1));
            expect(pinned[0].refs[1].entityId).toBe(vertical);
        } finally {
            solver.dispose();
        }
    });

    test("splits a line crossed twice, keeping the id for the origin half", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            solver.addLine(3, -5, 3, 5);
            solver.addLine(7, -5, 7, 5);

            const outcome = trim(solver, line, [5, 0]);
            expect(outcome.entityIds).toHaveLength(2);
            const [first, second] = outcome.entityIds;
            expect(first).toBe(line);
            expect(second).not.toBe(line);
            expect(lineParams(solver, line)).toEqual([0, 0, 3, 0]);
            expect(lineParams(solver, second)).toEqual([7, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("deletes the whole line when nothing crosses it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const outcome = trim(solver, line, [5, 0]);
            expect(outcome.deletedEntities).toEqual([line]);
            expect(outcome.entityIds).toEqual([]);
            expect(solver.entity(line)).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("turns a circle trimmed at a line into the complementary arc", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // away from the datum axes, so the line through it is the only cutter
            const circle = solver.addCircle(100, 0, 10);
            const line = solver.addLine(85, 0, 115, 0);

            // the click sits above the line: the upper half goes, the lower stays — the
            // arc that runs counter-clockwise from 180° round to 0°
            const outcome = trim(solver, circle, [100, 10]);
            expect(outcome.entityIds).toEqual([circle]);
            const arc = entityOf(solver, circle);
            expect(arc.type).toBe("arc");
            expect(arc.params.map((value) => Math.round(value))).toEqual([100, 0, 90, 0, 110, 0]);
            expect(arcAngles(arc.params)[1]).toBeCloseTo(Math.PI, 6);
            expect(solver.entity(line)).toBeDefined();
        } finally {
            solver.dispose();
        }
    });

    test("cuts against the datum axes as infinite lines", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the X axis is stored as the unit segment; the line crosses it at x = 20
            const line = solver.addLine(20, -5, 20, 5);
            trim(solver, line, [20, -4]);
            expect(lineParams(solver, line)).toEqual([20, 0, 20, 5]);
        } finally {
            solver.dispose();
        }
    });

    test("a cut on a datum axis is left free to slide along it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // this line crosses the X axis exactly where the axis's *stored* unit segment
            // ends, at (1, 0) — a point of the serialization, not of the sketch, so the
            // new endpoint must not be pinned to it
            const line = solver.addLine(1, -5, 1, 5);
            trim(solver, line, [1, 4]);

            const onLine = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(onLine).toHaveLength(1);
            expect(onLine[0].refs).toEqual([
                ref(line, 1),
                ref(SKETCH_X_AXIS_ID, 0),
                ref(SKETCH_X_AXIS_ID, 1),
            ]);
            expect(constraintsOf(solver, ConstraintKind.P2PCoincident)).toEqual([]);

            // the incidence is a point-on-line, not a pin: the endpoint keeps the dof a
            // rigid coincidence to the axis's far endpoint would have taken away
            solver.solve(true);
            expect(solver.dofs()).toBe(3);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a click that sits on the crossing itself", () => {
        const { solver, horizontal } = crossSolver();
        try {
            const result = trimEntity(solver, horizontal, [5, 0], TOLERANCE);
            expect(result.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });

    test("refuses to trim the datum or an external reference", () => {
        const { solver } = crossSolver();
        try {
            const result = trimEntity(solver, -2, [0, 0], TOLERANCE);
            expect(result.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("trimEntity constraints", () => {
    test("keeps a direction constraint but drops a length dimension of the shortened line", () => {
        const { solver, horizontal } = crossSolver();
        try {
            const direction = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [ref(horizontal, 0), ref(horizontal, 1)],
            });
            const length = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(horizontal, 0), ref(horizontal, 1)],
            });

            const outcome = trim(solver, horizontal, [8, 0]);
            expect(outcome.removedConstraints).toEqual([length]);
            expect(constraintsOf(solver, ConstraintKind.Horizontal).map((c) => c.id)).toEqual([direction]);
            expect(constraintsOf(solver, ConstraintKind.P2PDistance)).toHaveLength(0);
        } finally {
            solver.dispose();
        }
    });

    test("moves a split line's far-end constraints onto the new half", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            // a line standing on the trimmed one's far end, which is where the
            // coincidence below ties the two together
            const other = solver.addLine(10, 0, 10, 10);
            // a dimension between the split line's two ends, and that coincidence
            const length = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(line, 0), ref(line, 1)],
                datum: 10,
            });
            const joint = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(line, 1), ref(other, 0)],
            });
            solver.addLine(3, -5, 3, 5);
            solver.addLine(7, -5, 7, 5);

            const outcome = trim(solver, line, [5, 0]);
            const half = outcome.entityIds[1];
            expect(outcome.removedConstraints).toEqual([]);
            const rewrittenLength = solver.toData().constraints.find((c) => c.id === length);
            expect(rewrittenLength?.refs).toEqual([ref(line, 0), ref(half, 1)]);
            expect(rewrittenLength?.datum).toBe(10);
            const rewrittenJoint = solver.toData().constraints.find((c) => c.id === joint);
            expect(rewrittenJoint?.refs).toEqual([ref(half, 1), ref(other, 0)]);
            // the far end stayed put, so the sketch still solves
            expect(solver.entity(half)!.params[2]).toBeCloseTo(10, 6);
        } finally {
            solver.dispose();
        }
    });

    test("states a split direction constraint once per half", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const original = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [ref(line, 0), ref(line, 1)],
            });
            solver.addLine(3, -5, 3, 5);
            solver.addLine(7, -5, 7, 5);
            // a constraint numbered above the one the split re-states: were the id freed
            // and re-allocated, the anchor keyed on it would land on the wrong constraint
            const later = solver.addConstraint({
                kind: ConstraintKind.Vertical,
                refs: [ref(3, 0), ref(3, 1)],
            });
            expect(later).toBeGreaterThan(original);

            const outcome = trim(solver, line, [5, 0]);
            const half = outcome.entityIds[1];
            // the kept half's copy is the same constraint re-stated, so it keeps the id
            // the dimension anchor keys on and nothing is reported as removed
            expect(outcome.removedConstraints).toEqual([]);
            const horizontals = constraintsOf(solver, ConstraintKind.Horizontal);
            expect(horizontals).toHaveLength(2);
            expect(horizontals.map((c) => c.id)).toContain(original);
            expect(horizontals.map((c) => c.refs.map((r) => r.entityId))).toEqual([
                [line, line],
                [half, half],
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a driven direction dimension a reference on both halves of a split", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const base = solver.addLine(0, 5, 10, 5);
            solver.addConstraint({
                kind: ConstraintKind.Angle,
                refs: [ref(line, 0), ref(line, 1), ref(base, 0), ref(base, 1)],
                datum: 10,
                driven: true,
            });
            solver.addLine(3, -5, 3, 5);
            solver.addLine(7, -5, 7, 5);

            const outcome = trim(solver, line, [5, 0]);
            const half = outcome.entityIds[1];
            const angles = constraintsOf(solver, ConstraintKind.Angle);
            expect(angles.map((c) => c.refs.map((r) => r.entityId))).toEqual([
                [line, line, base, base],
                [half, half, base, base],
            ]);
            // re-stating the direction kind per half must carry the reading with it: a
            // dropped flag would hand back two dimensions that hold the geometry where the
            // user placed one that only measures it
            expect(angles.map((c) => c.driven)).toEqual([true, true]);
        } finally {
            solver.dispose();
        }
    });

    test("coincides the new endpoint when the crossing lands on the cutter's own end", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const tee = solver.addLine(5, 0, 5, 5);

            const outcome = trim(solver, line, [8, 0]);
            expect(outcome.removedConstraints).toEqual([]);
            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(joints[0].refs).toEqual([ref(line, 1), ref(tee, 0)]);
            expect(lineParams(solver, line)).toEqual([0, 0, 5, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a circle's centre constraint and reports the ones an arc cannot carry", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(100, 0, 10);
            const other = solver.addCircle(200, 0, 10);
            const fixed = solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [ref(circle, 0)],
                datums: [100, 0],
            });
            const equal = solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [ref(circle, 0), ref(other, 0)],
            });
            solver.addLine(85, 0, 115, 0);

            const outcome = trim(solver, circle, [100, 10]);
            expect(outcome.removedConstraints).toEqual([equal]);
            expect(entityOf(solver, circle).type).toBe("arc");
            expect(solver.toData().constraints.find((c) => c.id === fixed)?.refs).toEqual([ref(circle, 0)]);
        } finally {
            solver.dispose();
        }
    });

    test("a radius reading the user chose survives a circle becoming an arc", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(100, 0, 10);
            const dimension = solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [ref(circle, 0)],
                datum: 10,
                display: "diameter",
            });
            solver.addLine(85, 0, 115, 0);

            trim(solver, circle, [100, 10]);
            expect(entityOf(solver, circle).type).toBe("arc");
            // the retype moves the geometry; the Ø the user asked for is not geometry
            const carried = solver.toData().constraints.find((c) => c.id === dimension);
            expect(carried?.datum).toBeCloseTo(10);
            expect(carried?.display).toBe("diameter");
        } finally {
            solver.dispose();
        }
    });

    test("a driven radius dimension stays a reference through a circle becoming an arc", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(100, 0, 10);
            const reference = solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [ref(circle, 0)],
                datum: 10,
                driven: true,
            });
            solver.addLine(85, 0, 115, 0);
            solver.solve(true);
            const free = solver.dofs();

            trim(solver, circle, [100, 10]);

            expect(entityOf(solver, circle).type).toBe("arc");
            // the retype must not turn a measurement into a lock: the arc keeps the
            // reference, and the sketch keeps the degree of freedom it had
            expect(solver.toData().constraints.find((c) => c.id === reference)?.driven).toBe(true);
            solver.solve(true);
            expect(solver.dofs()).toBe(free);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a circle tangency when the arc's start is the end that slides", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the arc is externally tangent to the circle at (-5, 0) — its own start
            const circle = solver.addCircle(-10, 0, 5);
            const arc = solver.addArc(0, 0, -5, 0, 0, -5);
            const tangent = solver.addConstraint({
                kind: ConstraintKind.TangentCircleArc,
                refs: [ref(circle, 0), ref(arc, 0), ref(arc, 1)],
            });
            // crosses the arc at (-3, -4), past a click at 210° and before the arc's start
            solver.addLine(-3, -10, -3, 10);
            const click: [number, number] = [
                5 * Math.cos((210 * Math.PI) / 180),
                5 * Math.sin((210 * Math.PI) / 180),
            ];

            const outcome = trim(solver, arc, click);

            // the start slid along the arc's own circle, so the radius the tangency reads
            // is unchanged and the constraint still holds
            expect(outcome.removedConstraints).toEqual([]);
            expect(solver.toData().constraints.some((c) => c.id === tangent)).toBe(true);
        } finally {
            solver.dispose();
        }
    });

    test("trims through a sketch that was already conflicting", () => {
        const { solver, horizontal } = crossSolver();
        try {
            // an unrelated pair of lines the constraints contradict, so the sketch is
            // broken before the trim: the trim must not be blamed for that
            const broken = solver.addLine(0, 10, 4, 10);
            solver.addConstraint({ kind: ConstraintKind.Fix, refs: [ref(broken, 0)], datums: [0, 10] });
            solver.addConstraint({ kind: ConstraintKind.Fix, refs: [ref(broken, 1)], datums: [4, 10] });
            solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(broken, 0), ref(broken, 1)],
                datum: 40,
            });

            const outcome = trim(solver, horizontal, [8, 0]);
            expect(outcome.entityIds).toEqual([horizontal]);
            expect(lineParams(solver, horizontal)).toEqual([0, 0, 5, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("trimPreview", () => {
    /** The piece's numbers, rounded — the crossings come out of the intersection maths. */
    function rounded(piece: CurvePiece): number[] {
        const round = (value: number) => Math.round(value * 1e6) / 1e6;
        if (piece.kind === "line") return [...piece.point1.map(round), ...piece.point2.map(round)];
        if (piece.kind === "polyline") return piece.points.flatMap((point) => point.map(round));
        return [...piece.center.map(round), round(piece.radius), round(piece.startAngle), round(piece.sweep)];
    }

    function previewOf(solver: SketchSolver, entityId: number, uv: [number, number]): CurvePiece {
        const piece = trimPreview(solver, entityId, uv, TOLERANCE);
        if (piece === undefined) throw new Error("the trim would not be previewed here");
        return piece;
    }

    test("previews the piece past the crossing when clicked past it", () => {
        const { solver, horizontal } = crossSolver();
        try {
            expect(rounded(previewOf(solver, horizontal, [8, 0]))).toEqual([5, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("previews the piece before the crossing when clicked before it", () => {
        const { solver, horizontal } = crossSolver();
        try {
            expect(rounded(previewOf(solver, horizontal, [2, 0]))).toEqual([0, 0, 5, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("previews the piece between two crossings", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            solver.addLine(3, -5, 3, 5);
            solver.addLine(7, -5, 7, 5);
            expect(rounded(previewOf(solver, line, [5, 0]))).toEqual([3, 0, 7, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("previews the whole entity when nothing crosses it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            expect(rounded(previewOf(solver, line, [5, 0]))).toEqual([0, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("previews the arc a circle would keep the complement of", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(100, 0, 10);
            solver.addLine(85, 0, 115, 0);
            const piece = previewOf(solver, circle, [100, 10]);
            expect(piece.kind).toBe("arc");
            expect(rounded(piece)).toEqual([100, 0, 10, 0, Math.round(Math.PI * 1e6) / 1e6]);
        } finally {
            solver.dispose();
        }
    });

    test("previews nothing where the trim would refuse", () => {
        const { solver, horizontal } = crossSolver();
        try {
            // the crossing itself bounds no single piece
            expect(trimPreview(solver, horizontal, [5, 0], TOLERANCE)).toBeUndefined();
            // and neither does the datum, which is never the thing being cut
            expect(trimPreview(solver, -2, [0, 0], TOLERANCE)).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });
});

/**
 * An offset copy is cut like any other curve and written differently: it has no point to move,
 * so every one of a trim's shapes lands as a *window* on the source the copy reads.
 */
describe("trimEntity on an offset copy", () => {
    const near = (got: readonly number[], want: readonly number[]) => {
        expect(got[0]).toBeCloseTo(want[0], 9);
        expect(got[1]).toBeCloseTo(want[1], 9);
    };
    const nearPoint = (got: readonly number[], want: readonly number[]) => {
        expect(got[0]).toBeCloseTo(want[0], 6);
        expect(got[1]).toBeCloseTo(want[1], 6);
    };

    /** A straight cubic with its copy one unit to its left, plus two cutters across both. */
    function offsetSolver() {
        const solver = new SketchSolver(Plane.XY);
        const source = solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
        solver.solve(true);
        const offset = offsetEntities(solver, [source], 1, TOLERANCE);
        if (!offset.isOk) throw new Error(offset.error);
        const copy = offset.value.createdEntityIds[0];
        return { solver, source, copy };
    }

    /** The parameter range the copy is drawn over — its window, in the source's parameter. */
    function drawnWindow(solver: SketchSolver, copyId: number): [number, number] {
        return entityDomain(entityOf(solver, copyId));
    }

    test("reads a second cut in the copy's own window, not in the source's own turn", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addEllipse(0, 0, 10, 0, 0, 5);
            solver.solve(true);
            const offset = offsetEntities(solver, [source], 1, TOLERANCE);
            if (!offset.isOk) throw new Error(offset.error);
            const copy = offset.value.createdEntityIds[0];
            // a window straddling the source's seam: the copy is drawn from 5.5 to 7.5
            solver.setOffsetWindow(copy, [5.5, 7.5]);

            // a point on the copy at source parameter 7.0 — past one turn, so a projection
            // folds it back to 0.717, which is *outside* the window the copy is drawn over
            const t = 7.0 - Math.PI * 2;
            const on = evaluateEntity(entityOf(solver, source), t);
            const reach = Math.hypot(5 * Math.cos(t), 10 * Math.sin(t));
            const probe: [number, number] = [
                on[0] + (5 * Math.cos(t)) / reach,
                on[1] + (10 * Math.sin(t)) / reach,
            ];

            // the reading is the turn the *window* covers, not the one the projection handed
            // back: without that fold, a cut there writes the complement of the piece meant
            expect(windowParameterAt(entityOf(solver, copy), probe)).toBeCloseTo(7.0, 6);
        } finally {
            solver.dispose();
        }
    });

    test("shortens a copy to the crossing nearest the click", () => {
        const { solver, copy } = offsetSolver();
        try {
            solver.addLine(4, 0, 4, 2);
            solver.addLine(8, 0, 8, 2);
            solver.solve(true);

            // the click is past the last crossing, so the piece from it to the far end goes
            trim(solver, copy, [10, 1]);

            near(drawnWindow(solver, copy), [0, 2 / 3]);
            // and the drawn curve is the piece that is left, exactly: the copy ends at (8, 1)
            nearPoint(evaluateEntity(entityOf(solver, copy), 2 / 3), [8, 1]);
        } finally {
            solver.dispose();
        }
    });

    test("shortens from the origin end when the click is before the first crossing", () => {
        const { solver, copy } = offsetSolver();
        try {
            solver.addLine(4, 0, 4, 2);
            solver.addLine(8, 0, 8, 2);
            solver.solve(true);

            trim(solver, copy, [2, 1]);

            near(drawnWindow(solver, copy), [1 / 3, 1]);
        } finally {
            solver.dispose();
        }
    });

    test("draws the piece it would remove, as the sampled curve it is", () => {
        const { solver, copy } = offsetSolver();
        try {
            solver.addLine(4, 0, 4, 2);
            solver.addLine(8, 0, 8, 2);
            solver.solve(true);

            const piece = trimPreview(solver, copy, [6, 1], TOLERANCE);

            expect(piece?.kind).toBe("polyline");
            if (piece?.kind !== "polyline") throw new Error("expected a sampled piece");
            expect(piece.points[0][0]).toBeCloseTo(4, 6);
            expect(piece.points.at(-1)?.[0]).toBeCloseTo(8, 6);
        } finally {
            solver.dispose();
        }
    });

    test("splits a copy crossed twice, keeping the id for the origin half", () => {
        const { solver, copy } = offsetSolver();
        try {
            solver.addLine(4, 0, 4, 2);
            solver.addLine(8, 0, 8, 2);
            solver.solve(true);

            const outcome = trim(solver, copy, [6, 1]);

            expect(outcome.entityIds).toEqual([copy, outcome.entityIds[1]]);
            expect(outcome.deletedEntities).toEqual([]);
            near(drawnWindow(solver, copy), [0, 1 / 3]);
            const far = outcome.entityIds[1];
            near(drawnWindow(solver, far), [2 / 3, 1]);
            // the far half is a copy of the same source, at the same distance — the two halves
            // are two windows on one pair rather than two curves that happen to line up
            const { sourceId, sourceType, distance } = entityOf(solver, copy).offset!;
            expect(entityOf(solver, far).offset).toMatchObject({ sourceId, sourceType, distance });
        } finally {
            solver.dispose();
        }
    });

    test("deletes the copy when the piece under the click is all of it", () => {
        const { solver, source, copy } = offsetSolver();
        try {
            solver.solve(true);
            const outcome = trim(solver, copy, [6, 1]);

            expect(outcome.deletedEntities).toEqual([copy]);
            expect(solver.entity(copy)).toBeUndefined();
            // the source it read is untouched: the copy was the user's to delete, the source
            // is the geometry it came from
            expect(entityOf(solver, source).type).toBe("bezier");
        } finally {
            solver.dispose();
        }
    });

    /**
     * An ellipse with its copy one unit out, which the sketch's own X axis cuts at t = 0 and
     * t = π — the datum is a cutter like any other entity, so a closed copy comes out in two
     * halves without anything being drawn for it.
     */
    function closedCopy(): { solver: SketchSolver; ellipse: number; copy: number } {
        const solver = new SketchSolver(Plane.XY);
        const ellipse = solver.addEllipse(0, 0, 10, 0, 0, 5);
        solver.solve(true);
        const offset = offsetEntities(solver, [ellipse], 1, TOLERANCE);
        if (!offset.isOk) throw new Error(offset.error);
        return { solver, ellipse, copy: offset.value.createdEntityIds[0] };
    }

    test("opens a closed copy into the arc its removed span leaves", () => {
        const { solver, ellipse, copy } = closedCopy();
        try {
            // The X and Y axes both cut the copy, at t = 0, π/2, π and 3π/2. The click is on the
            // quarter between the first two, so that quarter goes and the rest is kept — the
            // complement, from the far bound of the removed span round to its near one.
            trim(solver, copy, evaluateEntity(entityOf(solver, copy), Math.PI / 4));

            const kept = entityOf(solver, copy);
            expect(isClosedEntity(kept)).toBe(false);
            near(drawnWindow(solver, copy), [Math.PI / 2, Math.PI * 2]);
            // the kept arc is the copy's own curve: every point of it is still one unit off the
            // source it reads
            for (const t of [Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
                expect(projectPoint(entityOf(solver, ellipse), evaluateEntity(kept, t)).distance).toBeCloseTo(
                    1,
                    6,
                );
            }
        } finally {
            solver.dispose();
        }
    });

    test("keeps a span that straddles the seam as a window running past it", () => {
        const { solver, ellipse, copy } = closedCopy();
        try {
            // the click is on the quarter between t = π/2 and t = π, so that goes and what is
            // kept contains the seam at t = 0 — which no window *inside* the source's range can
            // name, and is written instead as a range running a turn past its end
            trim(solver, copy, evaluateEntity(entityOf(solver, copy), Math.PI * 0.75));

            const [from, to] = drawnWindow(solver, copy);
            expect(from).toBeCloseTo(Math.PI, 6);
            expect(to).toBeCloseTo(Math.PI * 2.5, 6);
            for (const t of [from, Math.PI * 1.75, to]) {
                expect(
                    projectPoint(entityOf(solver, ellipse), evaluateEntity(entityOf(solver, copy), t))
                        .distance,
                ).toBeCloseTo(1, 6);
            }
            // the seam is inside the kept span: t = 2π is the ellipse's right extreme
            expect(evaluateEntity(entityOf(solver, copy), Math.PI * 2)[0]).toBeCloseTo(11, 3);
        } finally {
            solver.dispose();
        }
    });
});
