// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Precision } from "@chili3d/core";
import {
    applyAutoConstraints,
    applyDragAutoConstraints,
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

    test("snaps an arc's start and end but never its center", () => {
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
                    { entityId: id, pointIndex: 1 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0.2, 0.1]);
        expect(solver.pointOf({ entityId: id, pointIndex: 1 })).toEqual([10, 0]);
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
});
