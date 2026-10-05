// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import {
    classifyTwoPoint,
    type DimensionElement,
    type DimensionPlan,
    inferDimension,
    type ResolvedDimension,
} from "../../src/sketch/dimensionInference";
import { ConstraintKind, SKETCH_X_AXIS_ID } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const point = (entityId: number, pointIndex: number): DimensionElement => ({
    kind: "point",
    ref: { entityId, pointIndex },
});
const entity = (entityId: number): DimensionElement => ({ kind: "entity", entityId });

/** The resolved dimension for a selection placed at `label`, or undefined if it inferred none. */
function resolve(
    solver: SketchSolver,
    elements: DimensionElement[],
    label: [number, number],
): ResolvedDimension | undefined {
    const plan: DimensionPlan | undefined = inferDimension(elements, solver);
    return plan?.resolve(label);
}

// Deliberately lopsided, so Δx and Δy cannot be confused for one another: with a symmetric
// pair, every reading below would pass whichever coordinate it happened to reach for.
const LOP_END: [number, number] = [30, 10];

describe("inferDimension", () => {
    test("one line is its length, between its own two endpoints", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 30, 40);

        const resolved = resolve(solver, [entity(line)], [15, -20]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.P2PDistance);
        expect(resolved?.constraint.refs).toEqual([
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ]);
        expect(resolved?.initial).toBeCloseTo(50, 9);
        expect(resolved?.positiveOnly).toBe(true);
        // the label sits below the line, so the dimension stands off it on that side
        expect(resolved?.anchor).toMatchObject({ kind: "offset", offset: -24 });
    });

    test("a full circle reads as a diameter over a radius constraint", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 30);

        const resolved = resolve(solver, [entity(circle)], [50, 0]);
        // the constraint underneath is a radius — the sketch has no diameter kind
        expect(resolved?.constraint.kind).toBe(ConstraintKind.Radius);
        expect(resolved?.constraint.datum).toBeCloseTo(30, 9);
        // ...and the constraint is what carries the diameter, which is where the solver
        // reads it back to halve what is typed
        expect(resolved?.constraint.display).toBe("diameter");
        expect(resolved?.initial).toBeCloseTo(60, 9);
        expect(resolved?.anchor).toMatchObject({ kind: "vector", dx: 50, dy: 0 });
    });

    test("an arc reads as a radius", () => {
        const solver = new SketchSolver(Plane.XY);
        const arc = solver.addArc(0, 0, 30, 0, 0, 30);

        const resolved = resolve(solver, [entity(arc)], [50, 0]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.Radius);
        expect(resolved?.constraint.datum).toBeCloseTo(30, 9);
        expect(resolved?.constraint).not.toHaveProperty("display");
        expect(resolved?.initial).toBeCloseTo(30, 9);
    });

    test("a datum axis has no length to read", () => {
        const solver = new SketchSolver(Plane.XY);
        // the axis answers with synthetic line data, so only the datum guard refuses it
        expect(solver.entity(SKETCH_X_AXIS_ID)?.type).toBe("line");
        expect(inferDimension([entity(SKETCH_X_AXIS_ID)], solver)).toBeUndefined();
    });

    test("one point on its own means nothing yet", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        expect(inferDimension([point(line, 0)], solver)).toBeUndefined();
    });

    test("two points read as their aligned distance when the label is dragged diagonally", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);

        const resolved = resolve(solver, [point(line, 0), point(line, 1)], [45, 35]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.P2PDistance);
        expect(resolved?.initial).toBeCloseTo(Math.hypot(...LOP_END), 9);
        // the endpoints are one line's own, so the dimension belongs to that line
        expect(resolved?.constraint.refs).toEqual([
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ]);
    });

    test("two points with the label above them read as the horizontal distance, Δx", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);

        const resolved = resolve(solver, [point(line, 0), point(line, 1)], [5, 40]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.HorizontalDistance);
        expect(resolved?.initial).toBeCloseTo(30, 9);
        expect(resolved?.positiveOnly).toBe(false);
        expect(resolved?.anchor).toMatchObject({ kind: "offset" });
    });

    test("two points with the label to the side read as the vertical distance, Δy", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);

        const resolved = resolve(solver, [point(line, 0), point(line, 1)], [40, 5]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.VerticalDistance);
        expect(resolved?.initial).toBeCloseTo(10, 9);
    });

    test("an axis reading reads the same whichever of the two points was picked first", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);
        const label: [number, number] = [5, 40];

        const forwards = resolve(solver, [point(line, 0), point(line, 1)], label);
        const backwards = resolve(solver, [point(line, 1), point(line, 0)], label);

        // both are the horizontal reading, and the datum differs by exactly its sign: what that
        // sign says is which point is to the right (garlic's own reading), so it follows the pick
        // order — and it is never what the user reads (`formatDatum` takes the magnitude)
        expect(forwards?.constraint.kind).toBe(ConstraintKind.HorizontalDistance);
        expect(backwards?.constraint.kind).toBe(ConstraintKind.HorizontalDistance);
        expect(forwards?.constraint.datum).toBeCloseTo(30, 9);
        expect(backwards?.constraint.datum).toBeCloseTo(-30, 9);
        expect(forwards?.initial).toBeCloseTo(30, 9);
        expect(backwards?.initial).toBeCloseTo(30, 9);
    });

    test("the same two points give different dimensions from different labels", () => {
        // the one saving grace of inferring by label: nothing is committed until placement
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);
        const picks = [point(line, 0), point(line, 1)];

        const [aligned, horizontal, vertical] = (
            [
                [45, 35],
                [5, 40],
                [40, 5],
            ] as [number, number][]
        ).map((label) => resolve(solver, picks, label));

        expect(aligned?.constraint.kind).toBe(ConstraintKind.P2PDistance);
        expect(horizontal?.constraint.kind).toBe(ConstraintKind.HorizontalDistance);
        expect(vertical?.constraint.kind).toBe(ConstraintKind.VerticalDistance);
        // and each measures its own quantity, not whichever coordinate it reached for
        expect(aligned?.initial).toBeCloseTo(Math.hypot(...LOP_END), 9);
        expect(horizontal?.initial).toBeCloseTo(30, 9);
        expect(vertical?.initial).toBeCloseTo(10, 9);
    });

    test("a point and a line read as the perpendicular distance, whichever side the point is on", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        const left = solver.addLine(3, 8, 8, 12);
        const right = solver.addLine(3, -8, 8, -12);

        const above = resolve(solver, [point(left, 0), entity(line)], [15, 4]);
        expect(above?.constraint.kind).toBe(ConstraintKind.P2LDistance);
        expect(above?.constraint.refs[0]).toEqual({ entityId: left, pointIndex: 0 });
        expect(above?.initial).toBeCloseTo(8, 9);
        expect(above?.positiveOnly).toBe(false);
        // garlic's own sign — negative to the left of the line direction — is what the datum
        // stores, and it is only a side marker: the dimension reads 8 either way, and the sign
        // is what keeps the point on the side it was measured from when the value is edited
        expect(above?.constraint.datum).toBeCloseTo(-8, 9);

        const below = resolve(solver, [point(right, 0), entity(line)], [15, -4]);
        expect(below?.initial).toBeCloseTo(8, 9);
        expect(below?.constraint.datum).toBeCloseTo(8, 9);
    });

    test("a point already on the line has no distance to read", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        expect(inferDimension([point(line, 0), entity(line)], solver)).toBeUndefined();
    });

    test("a point and a circle infer nothing — the only reading is to a pickable center", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 5);
        const line = solver.addLine(20, 20, 30, 30);
        expect(inferDimension([point(line, 0), entity(circle)], solver)).toBeUndefined();
    });

    test("two lines that meet at an angle read as that angle", () => {
        const solver = new SketchSolver(Plane.XY);
        const first = solver.addLine(0, 0, 10, 0);
        const second = solver.addLine(0, 0, 10, 10);

        // the label sits inside the 45° sector, not on its edge, so no supplement is taken
        const resolved = resolve(solver, [entity(first), entity(second)], [8, 2]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.Angle);
        expect(resolved?.constraint.refs.length).toBe(4);
        // 45° displayed in degrees, stored in radians
        expect(resolved?.initial).toBeCloseTo(45, 6);
        expect(resolved?.constraint.datum).toBeCloseTo(Math.PI / 4, 6);
    });

    test("two parallel lines read as the gap between them, not a slant", () => {
        const solver = new SketchSolver(Plane.XY);
        // a distance read between arbitrary endpoints would be the diagonal, √200
        const first = solver.addLine(0, 0, 10, 10);
        const second = solver.addLine(0, 10, 10, 20);

        const resolved = resolve(solver, [entity(first), entity(second)], [15, 20]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.P2LDistance);
        // the point is the first line's endpoint nearest the label, the line is the second
        expect(resolved?.constraint.refs).toEqual([
            { entityId: first, pointIndex: 1 },
            { entityId: second, pointIndex: 0 },
            { entityId: second, pointIndex: 1 },
        ]);
        // the two lines are 10 apart along y, so their perpendicular gap is 10/√2 — not
        // the √200 a distance read between arbitrary endpoints would have given. The datum
        // is signed (which side of the second line the point sits on), so only its size.
        const initial = resolved?.initial;
        expect(typeof initial).toBe("number");
        expect(Math.abs(Number(initial))).toBeCloseTo(10 / Math.SQRT2, 9);
    });

    test("two circles read as the distance between their centers", () => {
        const solver = new SketchSolver(Plane.XY);
        const first = solver.addCircle(0, 0, 5);
        const second = solver.addCircle(30, 40, 5);

        const resolved = resolve(solver, [entity(first), entity(second)], [15, 30]);
        expect(resolved?.constraint.kind).toBe(ConstraintKind.P2PDistance);
        expect(resolved?.constraint.refs).toEqual([
            { entityId: first, pointIndex: 0 },
            { entityId: second, pointIndex: 0 },
        ]);
        expect(resolved?.initial).toBeCloseTo(50, 9);
    });

    test("two coincident points are one point, and one point has no distance", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        expect(inferDimension([point(line, 0), point(line, 0)], solver)).toBeUndefined();
    });

    test("more than two elements infer nothing", () => {
        const solver = new SketchSolver(Plane.XY);
        const first = solver.addLine(0, 0, 10, 0);
        const second = solver.addLine(0, 5, 10, 5);
        expect(inferDimension([entity(first), entity(second), entity(first)], solver)).toBeUndefined();
    });
});

describe("inferDimension previews", () => {
    test("a circle previews as a diameter, an arc as a radius", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 30);
        const arc = solver.addArc(0, 0, 30, 0, 0, 30);

        expect(inferDimension([entity(circle)], solver)?.preview([50, 0])).toMatchObject({
            kind: "diameter",
            radius: 30,
        });
        expect(inferDimension([entity(arc)], solver)?.preview([50, 0])).toMatchObject({
            kind: "radius",
            radius: 30,
        });
    });

    test("the two-point preview follows the label, matching what committing would store", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, ...LOP_END);
        const plan = inferDimension([point(line, 0), point(line, 1)], solver);

        expect(plan?.preview([45, 35])?.kind).toBe("distance");
        expect(plan?.preview([5, 40])?.kind).toBe("axisDistance");
        expect(plan?.preview([40, 5])?.kind).toBe("axisDistance");
        // and the axes the previews name are the ones the resolved kinds would use
        expect(plan?.preview([5, 40])).toMatchObject({ axis: "h" });
        expect(plan?.preview([40, 5])).toMatchObject({ axis: "v" });
        // the preview and the commit agree on which reading a label means
        expect(plan?.resolve([5, 40])?.constraint.kind).toBe(ConstraintKind.HorizontalDistance);
        expect(plan?.resolve([40, 5])?.constraint.kind).toBe(ConstraintKind.VerticalDistance);
    });
});

describe("classifyTwoPoint", () => {
    // two points diagonal to each other, so both axes have something to measure
    const a: [number, number] = [0, 0];
    const b: [number, number] = [10, 10];

    test("a label above or below reads the horizontal distance", () => {
        expect(classifyTwoPoint(a, b, [5, 40])).toBe("horizontal");
        expect(classifyTwoPoint(a, b, [5, -40])).toBe("horizontal");
    });

    test("a label to the left or right reads the vertical distance", () => {
        expect(classifyTwoPoint(a, b, [40, 5])).toBe("vertical");
        expect(classifyTwoPoint(a, b, [-40, 5])).toBe("vertical");
    });

    test("a label anywhere diagonal reads the aligned distance", () => {
        expect(classifyTwoPoint(a, b, [25, 25])).toBe("aligned");
        expect(classifyTwoPoint(a, b, [-25, -25])).toBe("aligned");
        // just inside the band either side of 45° still reads as aligned
        expect(classifyTwoPoint(a, b, [5 + 40, 5 + 40 / 1.2])).toBe("aligned");
    });

    test("an axis that measures nothing falls through to the one that does", () => {
        // points stacked vertically: only Δy means anything, whatever the label does
        expect(classifyTwoPoint([0, 0], [0, 10], [40, 5])).toBe("vertical");
        expect(classifyTwoPoint([0, 0], [0, 10], [5, 40])).toBe("vertical");
        // and laid out horizontally only Δx does
        expect(classifyTwoPoint([0, 0], [10, 0], [5, 40])).toBe("horizontal");
        expect(classifyTwoPoint([0, 0], [10, 0], [40, 5])).toBe("horizontal");
    });

    test("coincident points have no reading at all", () => {
        expect(classifyTwoPoint([3, 4], [3, 4], [40, 5])).toBeUndefined();
    });
});
