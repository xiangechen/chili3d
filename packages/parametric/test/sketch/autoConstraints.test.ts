// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Precision } from "@chili3d/core";
import {
    applyAutoConstraints,
    applyDragAutoConstraints,
    applyPointAutoConstraints,
    dragSnapPosition,
    snapPosition,
} from "../../src/sketch/autoConstraints";
import {
    axisLineRefs,
    ConstraintKind,
    originRef,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

describe("applyAutoConstraints", () => {
    test("snaps a line endpoint onto a nearby existing point and adds coincident", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(10.2, 0.1, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual(
            solver.pointOf({ entityId: 1, pointIndex: 1 }),
        );
        solver.dispose();
    });

    test("ignores points beyond the tolerance", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(12, 1, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("adds Horizontal to a near-horizontal line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 0.5); // ~2.9°

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });
        solver.solve(true);

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.Horizontal]);
        const [x1, y1] = solver.pointOf({ entityId: id, pointIndex: 0 });
        const [, y2] = solver.pointOf({ entityId: id, pointIndex: 1 });
        expect(Math.abs(y2 - y1)).toBeLessThan(Precision.Distance);
        solver.dispose();
    });

    test("adds Vertical to a near-vertical line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 0.4, 10);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.Vertical]);
        solver.dispose();
    });

    test("adds nothing to a steep diagonal line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 1.5); // ~8.5°

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("does not duplicate an existing Horizontal constraint", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 0.2);
        solver.addConstraint({
            kind: ConstraintKind.Horizontal,
            refs: [
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 1 },
            ],
        });

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("snaps a circle center onto a nearby point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(5, 5, 15, 5);
        solver.solve(true);
        const id = solver.addCircle(5.1, 5.1, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.P2PCoincident]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([5, 5]);
        solver.dispose();
    });

    test("never collapses a line onto a single point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        // both endpoints near the existing start point (0, 0)
        const id = solver.addLine(0.1, 0.1, 0.2, 0.2);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        const coincidents = added.filter((x) => x.kind === ConstraintKind.P2PCoincident);
        expect(coincidents.length).toBeLessThanOrEqual(1);
        const [x1, y1] = solver.pointOf({ entityId: id, pointIndex: 0 });
        const [x2, y2] = solver.pointOf({ entityId: id, pointIndex: 1 });
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(Precision.Distance);
        solver.dispose();
    });

    test("snaps an arc's center, start and end onto nearby points", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        // center (0.2, 0.1) sits within tolerance of the line start, start near the line end
        const id = solver.addArc(0.2, 0.1, 10.2, 0.1, 5, 8);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 1 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0, 0]);
        expect(solver.pointOf({ entityId: id, pointIndex: 1 })).toEqual([10, 0]);
        solver.dispose();
    });

    test("snaps a line endpoint onto an arc's center", () => {
        const solver = new SketchSolver(Plane.XY);
        const arc = solver.addArc(5, 5, 8, 5, 5, 8);
        solver.solve(true);
        const id = solver.addLine(5.1, 5.1, 20, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: arc, pointIndex: 0 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([5, 5]);
        solver.dispose();
    });
});

describe("tangency snapping", () => {
    /** Circle radius read back from the solver. */
    const circleRadius = (solver: SketchSolver, id: number): number => solver.entity(id)!.params[2];
    /** Perpendicular distance from (px, py) to the line through (x1, y1) and (x2, y2). */
    const lineDistance = (
        [px, py]: [number, number],
        [x1, y1]: [number, number],
        [x2, y2]: [number, number],
    ): number => Math.abs((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) / Math.hypot(x2 - x1, y2 - y1);

    test("adds TangentLineCircle where a new line grazes a circle", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 5);
        solver.solve(true);
        // the line x + y = 7.4 misses tangency (the tangent is x + y = 5√2) by 0.23
        const id = solver.addLine(-1.25, 8.65, 8.65, -1.25);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.TangentLineCircle,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: id, pointIndex: 1 },
                    { entityId: circle, pointIndex: 0 },
                ],
            },
        ]);
        const distance = lineDistance(
            solver.pointOf({ entityId: circle, pointIndex: 0 }),
            solver.pointOf({ entityId: id, pointIndex: 0 }),
            solver.pointOf({ entityId: id, pointIndex: 1 }),
        );
        expect(distance).toBeCloseTo(circleRadius(solver, circle), 6);
        solver.dispose();
    });

    test("adds TangentCircleCircle where a new circle touches another", () => {
        const solver = new SketchSolver(Plane.XY);
        const first = solver.addCircle(0, 20, 3);
        solver.solve(true);
        const id = solver.addCircle(5.9, 20, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.TangentCircleCircle,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: first, pointIndex: 0 },
                ],
            },
        ]);
        const [ax, ay] = solver.pointOf({ entityId: first, pointIndex: 0 });
        const [bx, by] = solver.pointOf({ entityId: id, pointIndex: 0 });
        expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(
            circleRadius(solver, first) + circleRadius(solver, id),
            6,
        );
        solver.dispose();
    });

    test("adds TangentCircleCircle for an internal tangency", () => {
        const solver = new SketchSolver(Plane.XY);
        const outer = solver.addCircle(20, 20, 5);
        solver.solve(true);
        // ~ r1 − r2 = 2 apart, so the small circle sits just inside the big one
        const id = solver.addCircle(21.9, 20, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.TangentCircleCircle]);
        const [ax, ay] = solver.pointOf({ entityId: outer, pointIndex: 0 });
        const [bx, by] = solver.pointOf({ entityId: id, pointIndex: 0 });
        expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(
            Math.abs(circleRadius(solver, outer) - circleRadius(solver, id)),
            6,
        );
        solver.dispose();
    });

    test("leaves a concentric pair to the point snap instead of a degenerate tangency", () => {
        const solver = new SketchSolver(Plane.XY);
        const first = solver.addCircle(0, 0, 3);
        solver.solve(true);
        // same radius, centers within coincidence range: concentric, not internally tangent
        const id = solver.addCircle(0.2, 0, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.P2PCoincident]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual(
            solver.pointOf({ entityId: first, pointIndex: 0 }),
        );
        solver.dispose();
    });

    test("adds TangentLineCircle where a circle sits on the X axis", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addCircle(50, 4.9, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.TangentLineCircle,
                refs: [...axisLineRefs(SKETCH_X_AXIS_ID), { entityId: id, pointIndex: 0 }],
            },
        ]);
        expect(Math.abs(solver.pointOf({ entityId: id, pointIndex: 0 })[1])).toBeCloseTo(
            circleRadius(solver, id),
            6,
        );
        solver.dispose();
    });

    test("adds tangency alongside the snap of a fillet's contact point", () => {
        const solver = new SketchSolver(Plane.XY);
        const arc = solver.addArc(0, 0, 3, 0, 0, 3);
        solver.solve(true);
        // vertical line through the arc's start: tangent there, and its endpoint sits on it
        const id = solver.addLine(3, 0, 3, 10);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: arc, pointIndex: 1 },
                ],
            },
            {
                kind: ConstraintKind.Vertical,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: id, pointIndex: 1 },
                ],
            },
            {
                kind: ConstraintKind.TangentLineArc,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: id, pointIndex: 1 },
                    { entityId: arc, pointIndex: 0 },
                    { entityId: arc, pointIndex: 1 },
                ],
            },
        ]);
        const distance = lineDistance(
            solver.pointOf({ entityId: arc, pointIndex: 0 }),
            solver.pointOf({ entityId: id, pointIndex: 0 }),
            solver.pointOf({ entityId: id, pointIndex: 1 }),
        );
        const [sx, sy] = solver.pointOf({ entityId: arc, pointIndex: 1 });
        const [cx, cy] = solver.pointOf({ entityId: arc, pointIndex: 0 });
        expect(distance).toBeCloseTo(Math.hypot(sx - cx, sy - cy), 6);
        solver.dispose();
    });

    test("does not add tangency to an arc's circle where the arc is not drawn", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addArc(0, 0, 5, 0, 0, 5); // a quarter arc in the first quadrant
        solver.solve(true);
        // the line x + y = −7.4 is tangent to the same circle, but at 225° — off the sweep
        const id = solver.addLine(1.25, -8.65, -8.65, 1.25);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("does not add tangency while the contact is off the line's span", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addCircle(0, 0, 5);
        solver.solve(true);
        // on the tangent line x + y = 7.4, but past the point of contact
        const id = solver.addLine(14.3, -6.9, 21.4, -14);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("leaves a line through the circle's center to the point snap", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(5, 5, 0.1);
        solver.solve(true);
        // starts on the center of a circle barely wider than the snap tolerance
        const id = solver.addLine(5, 5, 20, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: circle, pointIndex: 0 },
                ],
            },
        ]);
        solver.dispose();
    });

    test("does not add tangency to a line crossing the circle", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addCircle(0, 0, 5);
        solver.solve(true);
        // x + y = 3 crosses the circle, its endpoints well outside it
        const id = solver.addLine(-6, 9, 9, -6);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });
});

describe("origin snapping", () => {
    test("snaps an endpoint near the origin onto it and adds coincident", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0.2, 0.1, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: id, pointIndex: 0 }, originRef()],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0, 0]);
        solver.dispose();
    });

    test("a real point at the origin wins over the datum on a tie", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(20, 5, 0.1, 0.1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
        ]);
        solver.dispose();
    });
});

describe("point-on-line snapping", () => {
    test("snaps a point near an existing line onto it", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addCircle(5, 0.3, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([5, 0]);
        solver.dispose();
    });

    test("snaps a line endpoint onto a nearby existing line", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(5, 0.3, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        const [, v] = solver.pointOf({ entityId: id, pointIndex: 0 });
        expect(v).toBeCloseTo(0, 6);
        solver.dispose();
    });

    test("point snap wins over point-on-line when both are within tolerance", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.addCircle(5, 0.2, 1);
        solver.solve(true);
        const id = solver.addCircle(5, 0.3, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5, lineTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 2, pointIndex: 0 },
                ],
            },
        ]);
        solver.dispose();
    });

    test("does not add point-on-line beyond the tolerance", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addCircle(5, 2, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5, lineTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("lineTolerance defaults to pointTolerance", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addCircle(5, 0.3, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.PointOnLine]);
        solver.dispose();
    });

    test("snaps a point near the X axis onto it", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addCircle(50, 0.3, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: id, pointIndex: 0 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([50, 0]);
        solver.dispose();
    });

    test("snaps a point near the Y axis onto it", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addCircle(0.3, 50, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: id, pointIndex: 0 }, ...axisLineRefs(SKETCH_Y_AXIS_ID)],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0, 50]);
        solver.dispose();
    });
});

describe("point-on-curve snapping", () => {
    test("snaps a line endpoint onto a circle", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 5);
        solver.solve(true);
        const id = solver.addLine(3, 4.1, 20, 10);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnCircle,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: circle, pointIndex: 0 },
                ],
            },
        ]);
        expect(Math.hypot(...solver.pointOf({ entityId: id, pointIndex: 0 }))).toBeCloseTo(5, 6);
        solver.dispose();
    });

    test("snaps a line endpoint onto an arc", () => {
        const solver = new SketchSolver(Plane.XY);
        const arc = solver.addArc(0, 0, 5, 0, 0, 5); // a quarter arc in the first quadrant
        solver.solve(true);
        const id = solver.addLine(3.6, 3.6, 20, 1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnArc,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: arc, pointIndex: 0 },
                    { entityId: arc, pointIndex: 1 },
                ],
            },
        ]);
        expect(Math.hypot(...solver.pointOf({ entityId: id, pointIndex: 0 }))).toBeCloseTo(5, 6);
        solver.dispose();
    });

    test("does not snap a point onto an arc's circle outside its sweep", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addArc(0, 0, 5, 0, 0, 5);
        solver.solve(true);
        // 0.09 off the same circle, but at 225° where the quarter arc is not drawn
        const id = solver.addLine(-3.6, -3.6, -20, -1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("snaps an arc's end despite the arc's own structural incidence", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(-10, 0.2, 10, 0.2);
        solver.solve(true);
        // end sits exactly on both the arc's circle and the line
        const arc = solver.addArc(0.7, 2, 3.7, 2, -1.7, 0.2);

        const added = applyAutoConstraints(solver, arc, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: arc, pointIndex: 2 },
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            },
        ]);
        solver.dispose();
    });

    test("settling a dragged point near a circle adds point-on-circle", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0, 0, 5);
        const line = solver.addLine(0, 0, 4.9, 1.2);
        solver.solve(true);

        const ref = { entityId: line, pointIndex: 1 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnCircle,
                refs: [ref, { entityId: circle, pointIndex: 0 }],
            },
        ]);
        expect(Math.hypot(...solver.pointOf(ref))).toBeCloseTo(5, 6);
        solver.dispose();
    });

    test("snapPosition targets a circle's curve", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(3, 4, 5);
        solver.solve(true);

        const { position, snap } = snapPosition(solver, [8.2, 4], {
            pointTolerance: 0.1,
            lineTolerance: 0.5,
        });

        expect(snap).toEqual({
            kind: "circle",
            circleRef: { entityId: circle, pointIndex: 0 },
            position: [8, 4],
        });
        expect(position).toEqual([8, 4]);
        solver.dispose();
    });

    test("snapPosition targets an arc's curve", () => {
        const solver = new SketchSolver(Plane.XY);
        const arc = solver.addArc(3, 4, 8, 4, 3, 9);
        solver.solve(true);

        const { snap } = snapPosition(solver, [8.2, 4], { pointTolerance: 0.1, lineTolerance: 0.5 });

        expect(snap).toEqual({
            kind: "arc",
            arcRefs: [
                { entityId: arc, pointIndex: 0 },
                { entityId: arc, pointIndex: 1 },
            ],
            position: [8, 4],
        });
        solver.dispose();
    });
});

describe("dragSnapPosition", () => {
    test("returns the projection onto a nearby line without adding a constraint", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        const circle = solver.addCircle(5, 5, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const { position, snap } = dragSnapPosition(solver, ref, [6, 0.2], {
            pointTolerance: 0.1,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([6, 0]);
        expect(snap).toEqual({
            kind: "line",
            lineRefs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
            position: [6, 0],
        });
        expect(solver.toData().constraints).toEqual([]);
        solver.dispose();
    });

    test("returns the projection onto a nearby axis", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(50, 5, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const { position, snap } = dragSnapPosition(solver, ref, [50, 0.3], {
            pointTolerance: 0.1,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([50, 0]);
        expect(snap).toEqual({
            kind: "line",
            lineRefs: axisLineRefs(SKETCH_X_AXIS_ID),
            position: [50, 0],
        });
        expect(solver.toData().constraints).toEqual([]);
        solver.dispose();
    });

    test("returns the cursor unchanged when nothing is near", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(5, 5, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const { position, snap } = dragSnapPosition(solver, ref, [6, 6], {
            pointTolerance: 0.5,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([6, 6]);
        expect(snap).toBeUndefined();
        solver.dispose();
    });
});

describe("applyDragAutoConstraints", () => {
    test("settling near a line adds point-on-line", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        const circle = solver.addCircle(6, 0.2, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(Math.abs(solver.pointOf(ref)[1])).toBeCloseTo(0, 6);
        solver.dispose();
    });

    test("settling near a point adds coincident", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        const circle = solver.addCircle(9.9, 0.05, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.3, lineTolerance: 0.3 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        const p1 = solver.pointOf({ entityId: circle, pointIndex: 0 });
        const p2 = solver.pointOf({ entityId: 1, pointIndex: 1 });
        expect(p1[0]).toBeCloseTo(p2[0], 6);
        expect(p1[1]).toBeCloseTo(p2[1], 6);
        solver.dispose();
    });

    test("settling near an axis adds point-on-line to the axis", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(50, 0.3, 1);
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.1, lineTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: circle, pointIndex: 0 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            },
        ]);
        expect(solver.pointOf(ref)[1]).toBeCloseTo(0, 6);
        solver.dispose();
    });

    test("does not re-add an incidence constraint to an already-constrained point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        const circle = solver.addCircle(6, 0, 1);
        solver.addConstraint({
            kind: ConstraintKind.PointOnLine,
            refs: [
                { entityId: circle, pointIndex: 0 },
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
        });
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.5, lineTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("does not re-add a coincident constraint to a point pinned to the origin", () => {
        const solver = new SketchSolver(Plane.XY);
        const circle = solver.addCircle(0.1, 0.1, 1);
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [{ entityId: circle, pointIndex: 0 }, originRef()],
        });
        solver.solve(true);

        const ref = { entityId: circle, pointIndex: 0 };
        const added = applyDragAutoConstraints(solver, ref, { pointTolerance: 0.5, lineTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });
});

describe("snapPosition", () => {
    test("snaps a probe onto a nearby existing point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);

        const { position, snap } = snapPosition(solver, [9.9, 0.05], {
            pointTolerance: 0.3,
            lineTolerance: 0.3,
        });

        expect(position).toEqual([10, 0]);
        expect(snap).toEqual({
            kind: "point",
            point: { entityId: 1, pointIndex: 1 },
            position: [10, 0],
        });
        solver.dispose();
    });

    test("snaps a probe onto the origin", () => {
        const solver = new SketchSolver(Plane.XY);

        const { position, snap } = snapPosition(solver, [0.2, 0.1], {
            pointTolerance: 0.5,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([0, 0]);
        expect(snap).toEqual({ kind: "point", point: originRef(), position: [0, 0] });
        solver.dispose();
    });

    test("snaps a probe onto a nearby line", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);

        const { position, snap } = snapPosition(solver, [6, 0.2], {
            pointTolerance: 0.1,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([6, 0]);
        expect(snap).toEqual({
            kind: "line",
            lineRefs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
            position: [6, 0],
        });
        solver.dispose();
    });

    test("returns the probe unchanged when nothing is near", () => {
        const solver = new SketchSolver(Plane.XY);

        const { position, snap } = snapPosition(solver, [5, 5], {
            pointTolerance: 0.5,
            lineTolerance: 0.5,
        });

        expect(position).toEqual([5, 5]);
        expect(snap).toBeUndefined();
        solver.dispose();
    });

    test("reports the tangency the probe's entity would get, over its own snap", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addCircle(0, 0, 5);
        solver.addCircle(10, 5, 1);
        solver.solve(true);

        // the segment from (0, 5) to the probe grazes the first circle when the
        // probe lands on the second circle's center — where the point snap fires
        const { position, snap, tangentKind } = snapPosition(
            solver,
            [10.05, 5.05],
            { pointTolerance: 0.1, lineTolerance: 0.5 },
            (probe) => ({ type: "line", params: [0, 5, ...probe] }),
        );

        expect(snap).toEqual({ kind: "point", point: { entityId: 2, pointIndex: 0 }, position: [10, 5] });
        expect(position).toEqual([10, 5]);
        expect(tangentKind).toBe(ConstraintKind.TangentLineCircle);
        solver.dispose();
    });

    test("reports tangency for a probe that snaps to nothing", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addCircle(20, 0, 5);
        solver.solve(true);

        // a circle about the origin, its radius taken from the probe, comes out
        // tangent to the existing one while the cursor is in open space
        const { snap, tangentKind } = snapPosition(
            solver,
            [14.6, 3.4],
            { pointTolerance: 0.1, lineTolerance: 0.5 },
            (probe) => ({ type: "circle", params: [0, 0, Math.hypot(probe[0], probe[1])] }),
        );

        expect(snap).toBeUndefined();
        expect(tangentKind).toBe(ConstraintKind.TangentCircleCircle);
        solver.dispose();
    });

    test("reports no tangency for a probe whose entity comes out clear of the rest", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addCircle(20, 0, 5);
        solver.solve(true);

        // radius ~10: five short of the existing circle
        const { tangentKind } = snapPosition(
            solver,
            [8, 6],
            { pointTolerance: 0.1, lineTolerance: 0.5 },
            (probe) => ({ type: "circle", params: [0, 0, Math.hypot(probe[0], probe[1])] }),
        );

        expect(tangentKind).toBeUndefined();
        solver.dispose();
    });
});

describe("applyPointAutoConstraints", () => {
    /** Builds an axis-aligned rectangle from four coincident-linked lines. */
    function addRectangle(solver: SketchSolver, x1: number, y1: number, x2: number, y2: number): number[] {
        const top = solver.addLine(x1, y2, x2, y2);
        const right = solver.addLine(x2, y2, x2, y1);
        const bottom = solver.addLine(x2, y1, x1, y1);
        const left = solver.addLine(x1, y1, x1, y2);
        for (const [from, to] of [
            [top, right],
            [right, bottom],
            [bottom, left],
            [left, top],
        ] as const) {
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: from, pointIndex: 1 },
                    { entityId: to, pointIndex: 0 },
                ],
            });
        }
        return [top, right, bottom, left];
    }

    test("snaps a corner onto the origin while ignoring the shape's own edges", () => {
        const solver = new SketchSolver(Plane.XY);
        const [top, right, bottom, left] = addRectangle(solver, 0.2, 0.1, 10, 5);
        solver.solve(true);

        const added = applyPointAutoConstraints(
            solver,
            [
                { entityId: left, pointIndex: 0 },
                { entityId: top, pointIndex: 1 },
            ],
            [top, right, bottom, left],
            { pointTolerance: 0.5 },
        );
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: left, pointIndex: 0 }, originRef()],
            },
        ]);
        expect(solver.pointOf({ entityId: left, pointIndex: 0 })).toEqual([0, 0]);
        solver.dispose();
    });

    test("does not snap a far corner onto its own edges", () => {
        const solver = new SketchSolver(Plane.XY);
        const [top, right, bottom, left] = addRectangle(solver, 0, 0, 20, 10);
        solver.solve(true);

        const added = applyPointAutoConstraints(
            solver,
            [{ entityId: top, pointIndex: 1 }],
            [top, right, bottom, left],
            { pointTolerance: 0.5, lineTolerance: 0.5 },
        );

        expect(added).toEqual([]);
        solver.dispose();
    });
});
