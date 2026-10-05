// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import {
    arcAngles,
    ConstraintKind,
    SKETCH_X_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { type TrimOutcome, type TrimPiece, trimEntity, trimPreview } from "../../src/sketch/trimOps";
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
    function rounded(piece: TrimPiece): number[] {
        const round = (value: number) => Math.round(value * 1e6) / 1e6;
        return piece.kind === "line"
            ? [...piece.point1.map(round), ...piece.point2.map(round)]
            : [...piece.center.map(round), round(piece.radius), round(piece.startAngle), round(piece.sweep)];
    }

    function previewOf(solver: SketchSolver, entityId: number, uv: [number, number]): TrimPiece {
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
