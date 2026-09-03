// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import {
    axisLineRefs,
    ConstraintKind,
    originRef,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

function distance(a: [number, number], b: [number, number]) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / Math.hypot(dx, dy);
}

function directionOf(solver: SketchSolver, entityId: number): [number, number] {
    const [x1, y1] = solver.pointOf({ entityId, pointIndex: 0 });
    const [x2, y2] = solver.pointOf({ entityId, pointIndex: 1 });
    return [x2 - x1, y2 - y1];
}

function arcRadius(solver: SketchSolver, arc: number) {
    return distance(
        solver.pointOf({ entityId: arc, pointIndex: 0 }),
        solver.pointOf({ entityId: arc, pointIndex: 1 }),
    );
}

describe("SketchSolver", () => {
    describe("entities and dofs", () => {
        test("addLine contributes 4 dofs, addCircle contributes 3", () => {
            const solver = new SketchSolver(Plane.XY);
            const lineId = solver.addLine(0, 0, 10, 0);
            expect(solver.dofs()).toBe(4);
            const circleId = solver.addCircle(5, 5, 3);
            expect(solver.dofs()).toBe(7);

            expect(solver.entities()).toEqual([
                { id: lineId, type: "line", params: [0, 0, 10, 0] },
                { id: circleId, type: "circle", params: [5, 5, 3] },
            ]);
        });

        test("ids are stable and increasing", () => {
            const solver = new SketchSolver(Plane.XY);
            const a = solver.addLine(0, 0, 1, 1);
            const b = solver.addCircle(0, 0, 1);
            expect(b).toBeGreaterThan(a);
        });
    });

    describe("coincident", () => {
        test("reduces dofs by 2 and merges points after solve", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(10.2, 0.3, 20, 5);
            expect(solver.dofs()).toBe(8);

            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                ],
            });
            expect(solver.dofs()).toBe(6);

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p1 = solver.pointOf({ entityId: l1, pointIndex: 1 });
            const p2 = solver.pointOf({ entityId: l2, pointIndex: 0 });
            expect(p1[0]).toBeCloseTo(p2[0], 6);
            expect(p1[1]).toBeCloseTo(p2[1], 6);
        });
    });

    describe("horizontal / vertical", () => {
        test("horizontal makes y1 equal y2", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 5);
            solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });
            solver.solve(true);
            const params = solver.entities().find((e) => e.id === line)!.params;
            expect(params[1]).toBeCloseTo(params[3], 6);
        });

        test("vertical makes x1 equal x2", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 5);
            solver.addConstraint({
                kind: ConstraintKind.Vertical,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });
            solver.solve(true);
            const params = solver.entities().find((e) => e.id === line)!.params;
            expect(params[0]).toBeCloseTo(params[2], 6);
        });
    });

    describe("datum constraints", () => {
        test("p2pDistance datum drives distance and setDatum updates it", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 8, 0);
            const refs: SketchPointRef[] = [
                { entityId: line, pointIndex: 0 },
                { entityId: line, pointIndex: 1 },
            ];
            const id = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
            solver.solve(true);
            expect(distance(solver.pointOf(refs[0]), solver.pointOf(refs[1]))).toBeCloseTo(10, 6);

            solver.setDatum(id, 20);
            solver.solve(true);
            expect(distance(solver.pointOf(refs[0]), solver.pointOf(refs[1]))).toBeCloseTo(20, 6);
        });

        test("radius datum drives circle radius", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(0, 0, 5);
            const id = solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circle, pointIndex: 0 }],
                datum: 8,
            });
            solver.solve(true);
            expect(solver.entities().find((e) => e.id === circle)!.params[2]).toBeCloseTo(8, 6);

            solver.setDatum(id, 12);
            solver.solve(true);
            expect(solver.entities().find((e) => e.id === circle)!.params[2]).toBeCloseTo(12, 6);
        });

        test("removeConstraint frees the driven dofs", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const id = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });
            const constrained = solver.dofs();
            solver.removeConstraint(id);
            expect(solver.dofs()).toBe(constrained + 1);
        });
    });

    describe("serialization", () => {
        test("toData round-trips into a fresh solver with identical geometry", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(10, 0, 10, 12);
            const circle = solver.addCircle(20, 20, 6);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                ],
            });
            solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circle, pointIndex: 0 }],
                datum: 9,
            });
            solver.solve(true);

            const data = solver.toData();
            const restored = new SketchSolver(Plane.XY, data);
            const expected = solver.entities();
            const actual = restored.entities();
            expect(actual.length).toBe(expected.length);
            for (let i = 0; i < expected.length; i++) {
                expect(actual[i].id).toBe(expected[i].id);
                expect(actual[i].type).toBe(expected[i].type);
                expected[i].params.forEach((p, j) => expect(actual[i].params[j]).toBeCloseTo(p, 6));
            }
            expect(restored.toData().constraints).toEqual(data.constraints);
        });
    });

    describe("removeEntity", () => {
        test("removes the entity and cascades its constraints", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(10, 0, 10, 12);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                ],
            });
            const datum = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                ],
                datum: 10,
            });
            solver.solve(true);

            const removed = solver.removeEntity(l1);
            expect(removed.sort()).toEqual([coincident, datum].sort());
            expect(solver.entities().map((e) => e.id)).toEqual([l2]);
            expect(solver.toData().constraints).toEqual([]);
            expect(solver.dofs()).toBe(4);
        });

        test("throws for an unknown entity", () => {
            const solver = new SketchSolver(Plane.XY);
            expect(() => solver.removeEntity(42)).toThrow("Unknown sketch entity: 42");
        });
    });

    describe("drag", () => {
        test("dragging a point moves the whole coincident group", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(10, 0, 20, 4);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                ],
            });
            solver.solve(true);

            const dragged: SketchPointRef = { entityId: l1, pointIndex: 1 };
            solver.beginDrag([dragged]);
            solver.dragTo(dragged, 15, 3);
            const mid = solver.pointOf(dragged);
            expect(mid[0]).toBeCloseTo(15, 6);
            expect(mid[1]).toBeCloseTo(3, 6);
            solver.endDrag();

            const p1 = solver.pointOf({ entityId: l1, pointIndex: 1 });
            const p2 = solver.pointOf({ entityId: l2, pointIndex: 0 });
            expect(p1[0]).toBeCloseTo(15, 6);
            expect(p1[1]).toBeCloseTo(3, 6);
            expect(p2[0]).toBeCloseTo(15, 6);
            expect(p2[1]).toBeCloseTo(3, 6);
        });
    });

    describe("arc", () => {
        test("addArc contributes 5 dofs and exposes center, start and end", () => {
            const solver = new SketchSolver(Plane.XY);
            const id = solver.addArc(0, 0, 10, 0, 0, 10);

            // 6 coordinate params minus the structural PointOnArc equation
            expect(solver.dofs()).toBe(5);
            expect(solver.entities()).toEqual([{ id, type: "arc", params: [0, 0, 10, 0, 0, 10] }]);
            expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: id, pointIndex: 1 })).toEqual([10, 0]);
            expect(solver.pointOf({ entityId: id, pointIndex: 2 })).toEqual([0, 10]);
            expect(solver.entityPoints(id)).toEqual([
                [10, 0],
                [0, 10],
            ]);
            solver.dispose();
        });

        test("keeps the end point on the circle through a solve", () => {
            const solver = new SketchSolver(Plane.XY);
            const id = solver.addArc(0, 0, 10, 0, 20, 0); // end off the circle

            const outcome = solver.solve(true);

            expect(outcome.result.startsWith("Ok")).toBe(true);
            const [cx, cy] = solver.pointOf({ entityId: id, pointIndex: 0 });
            const [sx, sy] = solver.pointOf({ entityId: id, pointIndex: 1 });
            const [ex, ey] = solver.pointOf({ entityId: id, pointIndex: 2 });
            expect(Math.hypot(ex - cx, ey - cy)).toBeCloseTo(Math.hypot(sx - cx, sy - cy), 6);
            solver.dispose();
        });

        test("an out-of-range arc point ref throws", () => {
            const solver = new SketchSolver(Plane.XY);
            const id = solver.addArc(0, 0, 10, 0, 0, 10);
            expect(() => solver.pointOf({ entityId: id, pointIndex: 3 })).toThrow("Invalid point ref");
            solver.dispose();
        });

        test("arc points participate in coincident constraints", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const arc = solver.addArc(5, 5, 10.2, 0.1, 5, 10);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: arc, pointIndex: 1 },
                    { entityId: line, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);

            expect(outcome.result.startsWith("Ok")).toBe(true);
            const arcStart = solver.pointOf({ entityId: arc, pointIndex: 1 });
            const lineEnd = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(arcStart[0]).toBeCloseTo(lineEnd[0], 6);
            expect(arcStart[1]).toBeCloseTo(lineEnd[1], 6);
            solver.dispose();
        });

        test("arc survives a serialization round-trip", () => {
            const solver = new SketchSolver(Plane.XY);
            const arc = solver.addArc(1, 2, 11, 2, 1, 12);
            solver.solve(true);

            const data = solver.toData();
            const restored = new SketchSolver(Plane.XY, data);

            const restoredArc = restored.entities().find((e) => e.id === arc)!;
            expect(restoredArc.type).toBe("arc");
            restoredArc.params.forEach((p, i) => expect(p).toBeCloseTo(data.entities[0].params[i], 6));
            expect(restored.toData().constraints).toEqual(data.constraints);
            solver.dispose();
            restored.dispose();
        });

        test("removeEntity cascades the structural and user constraints", () => {
            const solver = new SketchSolver(Plane.XY);
            const arc = solver.addArc(0, 0, 10, 0, 0, 10);
            const line = solver.addLine(10, 0, 20, 0);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: arc, pointIndex: 1 },
                    { entityId: line, pointIndex: 0 },
                ],
            });
            const structural = solver.toData().constraints.find((c) => c.kind === ConstraintKind.PointOnArc)!;

            const removed = solver.removeEntity(arc);

            expect(removed.sort()).toEqual([structural.id, coincident].sort());
            expect(solver.entities().map((e) => e.id)).toEqual([line]);
            expect(solver.toData().constraints).toEqual([]);
            solver.dispose();
        });

        test("dragging an arc endpoint moves it", () => {
            const solver = new SketchSolver(Plane.XY);
            const arc = solver.addArc(0, 0, 10, 0, 0, 10);
            solver.solve(true);

            const ref: SketchPointRef = { entityId: arc, pointIndex: 2 };
            solver.beginDrag([ref]);
            solver.dragTo(ref, 5, 5);

            const [u, v] = solver.pointOf(ref);
            expect(u).toBeCloseTo(5, 2);
            expect(v).toBeCloseTo(5, 2);
            solver.endDrag();

            // the PointOnArc constraint keeps the dragged end on the circle
            const [cx, cy] = solver.pointOf({ entityId: arc, pointIndex: 0 });
            const [sx, sy] = solver.pointOf({ entityId: arc, pointIndex: 1 });
            const [ex, ey] = solver.pointOf(ref);
            expect(Math.hypot(ex - cx, ey - cy)).toBeCloseTo(Math.hypot(sx - cx, sy - cy), 6);
            solver.dispose();
        });
    });

    describe("parallel / perpendicular", () => {
        test("parallel makes the direction cross product zero and costs 1 dof", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(0, 5, 10, 6.5);
            expect(solver.dofs()).toBe(8);

            solver.addConstraint({
                kind: ConstraintKind.Parallel,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                    { entityId: l2, pointIndex: 1 },
                ],
            });
            expect(solver.dofs()).toBe(7);

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const d1 = directionOf(solver, l1);
            const d2 = directionOf(solver, l2);
            expect(d1[0] * d2[1] - d1[1] * d2[0]).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("perpendicular makes the direction dot product zero and costs 1 dof", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(5, 0, 5.5, 10);
            expect(solver.dofs()).toBe(8);

            solver.addConstraint({
                kind: ConstraintKind.Perpendicular,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                    { entityId: l2, pointIndex: 1 },
                ],
            });
            expect(solver.dofs()).toBe(7);

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const d1 = directionOf(solver, l1);
            const d2 = directionOf(solver, l2);
            expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeCloseTo(0, 6);
            solver.dispose();
        });
    });

    describe("equalLength", () => {
        test("two lines with different lengths end up equal", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(0, 10, 25, 10);
            solver.addConstraint({
                kind: ConstraintKind.EqualLength,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                    { entityId: l2, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const len1 = distance(
                solver.pointOf({ entityId: l1, pointIndex: 0 }),
                solver.pointOf({ entityId: l1, pointIndex: 1 }),
            );
            const len2 = distance(
                solver.pointOf({ entityId: l2, pointIndex: 0 }),
                solver.pointOf({ entityId: l2, pointIndex: 1 }),
            );
            expect(len2).toBeCloseTo(len1, 6);
            solver.dispose();
        });
    });

    describe("pointOnLine / midpoint", () => {
        test("pointOnLine pulls an off-line point onto the line", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const circle = solver.addCircle(5, 3, 1);
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p = solver.pointOf({ entityId: circle, pointIndex: 0 });
            const a = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(perpendicularDistance(p, a, b)).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("midpoint moves the point to the line midpoint", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const circle = solver.addCircle(4.2, 1.1, 1);
            solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p = solver.pointOf({ entityId: circle, pointIndex: 0 });
            const a = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(p[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
            expect(p[1]).toBeCloseTo((a[1] + b[1]) / 2, 6);
            solver.dispose();
        });
    });

    describe("symmetric", () => {
        test("mirrors a point across the axis line", () => {
            const solver = new SketchSolver(Plane.XY);
            const axis = solver.addLine(0, -10, 0, 10);
            const c1 = solver.addCircle(3, 4, 1);
            const c2 = solver.addCircle(-2.8, 4.1, 1);
            // pin the axis and the source point so the mirror target is unique
            solver.addConstraint({ kind: ConstraintKind.Fix, refs: [{ entityId: axis, pointIndex: 0 }] });
            solver.addConstraint({ kind: ConstraintKind.Fix, refs: [{ entityId: axis, pointIndex: 1 }] });
            solver.addConstraint({ kind: ConstraintKind.Fix, refs: [{ entityId: c1, pointIndex: 0 }] });
            solver.addConstraint({
                kind: ConstraintKind.Symmetric,
                refs: [
                    { entityId: c1, pointIndex: 0 },
                    { entityId: c2, pointIndex: 0 },
                    { entityId: axis, pointIndex: 0 },
                    { entityId: axis, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p1 = solver.pointOf({ entityId: c1, pointIndex: 0 });
            const p2 = solver.pointOf({ entityId: c2, pointIndex: 0 });
            expect(p2[0]).toBeCloseTo(-3, 6);
            expect(p2[1]).toBeCloseTo(4, 6);
            expect(p1[0] + p2[0]).toBeCloseTo(0, 6);
            expect(p1[1]).toBeCloseTo(p2[1], 6);
            solver.dispose();
        });
    });

    describe("horizontalAlign / verticalAlign", () => {
        test("horizontalAlign equalizes the y coordinates", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 1, 2);
            const c2 = solver.addCircle(8, 4, 2);
            solver.addConstraint({
                kind: ConstraintKind.HorizontalAlign,
                refs: [
                    { entityId: c1, pointIndex: 0 },
                    { entityId: c2, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p1 = solver.pointOf({ entityId: c1, pointIndex: 0 });
            const p2 = solver.pointOf({ entityId: c2, pointIndex: 0 });
            expect(p1[1]).toBeCloseTo(p2[1], 6);
            solver.dispose();
        });

        test("verticalAlign equalizes the x coordinates", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 1, 2);
            const c2 = solver.addCircle(8, 4, 2);
            solver.addConstraint({
                kind: ConstraintKind.VerticalAlign,
                refs: [
                    { entityId: c1, pointIndex: 0 },
                    { entityId: c2, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p1 = solver.pointOf({ entityId: c1, pointIndex: 0 });
            const p2 = solver.pointOf({ entityId: c2, pointIndex: 0 });
            expect(p1[0]).toBeCloseTo(p2[0], 6);
            solver.dispose();
        });
    });

    describe("equalRadius / pointOnCircle", () => {
        test("equalRadius makes two circle radii equal", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 0, 3);
            const c2 = solver.addCircle(10, 0, 7);
            solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [
                    { entityId: c1, pointIndex: 0 },
                    { entityId: c2, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const r1 = solver.entity(c1)!.params[2];
            const r2 = solver.entity(c2)!.params[2];
            expect(r2).toBeCloseTo(r1, 6);
            solver.dispose();
        });

        test("pointOnCircle puts the point at radius distance from the center", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(0, 0, 5);
            const point = solver.addCircle(6, 1, 1);
            solver.addConstraint({
                kind: ConstraintKind.PointOnCircle,
                refs: [
                    { entityId: point, pointIndex: 0 },
                    { entityId: circle, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p = solver.pointOf({ entityId: point, pointIndex: 0 });
            const center = solver.pointOf({ entityId: circle, pointIndex: 0 });
            const radius = solver.entity(circle)!.params[2];
            expect(distance(p, center)).toBeCloseTo(radius, 6);
            solver.dispose();
        });
    });

    describe("tangency and arcs", () => {
        test("tangentLineCircle drives the center-to-line distance to the radius", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 5.6, 10, 5.4);
            const circle = solver.addCircle(5, 0, 5);
            solver.addConstraint({
                kind: ConstraintKind.TangentLineCircle,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                    { entityId: circle, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const center = solver.pointOf({ entityId: circle, pointIndex: 0 });
            const a = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b = solver.pointOf({ entityId: line, pointIndex: 1 });
            const radius = solver.entity(circle)!.params[2];
            expect(perpendicularDistance(center, a, b)).toBeCloseTo(radius, 6);
            solver.dispose();
        });

        test("tangentCircleCircle drives the center distance to r1 + r2", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 0, 5);
            const c2 = solver.addCircle(11, 0, 5);
            solver.addConstraint({
                kind: ConstraintKind.TangentCircleCircle,
                refs: [
                    { entityId: c1, pointIndex: 0 },
                    { entityId: c2, pointIndex: 0 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const center1 = solver.pointOf({ entityId: c1, pointIndex: 0 });
            const center2 = solver.pointOf({ entityId: c2, pointIndex: 0 });
            const r1 = solver.entity(c1)!.params[2];
            const r2 = solver.entity(c2)!.params[2];
            expect(distance(center1, center2)).toBeCloseTo(r1 + r2, 6);
            solver.dispose();
        });

        test("tangentLineArc drives the arc-center-to-line distance to the arc radius", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 5.6, 10, 5.5);
            const arc = solver.addArc(5, 0, 10, 0, 5, 5);
            solver.addConstraint({
                kind: ConstraintKind.TangentLineArc,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                    { entityId: arc, pointIndex: 0 },
                    { entityId: arc, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const center = solver.pointOf({ entityId: arc, pointIndex: 0 });
            const a = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(perpendicularDistance(center, a, b)).toBeCloseTo(arcRadius(solver, arc), 6);
            solver.dispose();
        });

        test("tangentArcArc drives the center distance to r1 + r2", () => {
            const solver = new SketchSolver(Plane.XY);
            const a1 = solver.addArc(0, 0, 5, 0, 0, 5);
            const a2 = solver.addArc(10.8, 0, 5.8, 0, 10.8, 5);
            solver.addConstraint({
                kind: ConstraintKind.TangentArcArc,
                refs: [
                    { entityId: a1, pointIndex: 0 },
                    { entityId: a1, pointIndex: 1 },
                    { entityId: a2, pointIndex: 0 },
                    { entityId: a2, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const center1 = solver.pointOf({ entityId: a1, pointIndex: 0 });
            const center2 = solver.pointOf({ entityId: a2, pointIndex: 0 });
            expect(distance(center1, center2)).toBeCloseTo(arcRadius(solver, a1) + arcRadius(solver, a2), 6);
            solver.dispose();
        });

        test("tangentCircleArc drives the center distance to circle radius + arc radius", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(0, 0, 5);
            const arc = solver.addArc(11, 0, 6, 0, 11, 5);
            solver.addConstraint({
                kind: ConstraintKind.TangentCircleArc,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: arc, pointIndex: 0 },
                    { entityId: arc, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const circleCenter = solver.pointOf({ entityId: circle, pointIndex: 0 });
            const arcCenter = solver.pointOf({ entityId: arc, pointIndex: 0 });
            const radius = solver.entity(circle)!.params[2];
            expect(distance(circleCenter, arcCenter)).toBeCloseTo(radius + arcRadius(solver, arc), 6);
            solver.dispose();
        });

        test("equalArcRadius makes two arc radii equal", () => {
            const solver = new SketchSolver(Plane.XY);
            const a1 = solver.addArc(0, 0, 5, 0, 0, 5);
            const a2 = solver.addArc(20, 0, 28, 0, 20, 8);
            solver.addConstraint({
                kind: ConstraintKind.EqualArcRadius,
                refs: [
                    { entityId: a1, pointIndex: 0 },
                    { entityId: a1, pointIndex: 1 },
                    { entityId: a2, pointIndex: 0 },
                    { entityId: a2, pointIndex: 1 },
                ],
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(arcRadius(solver, a2)).toBeCloseTo(arcRadius(solver, a1), 6);
            solver.dispose();
        });
    });

    describe("p2lDistance", () => {
        test("datum drives the perpendicular distance and setDatum updates it", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const point = solver.addCircle(5, 6, 1);
            const id = solver.addConstraint({
                kind: ConstraintKind.P2LDistance,
                refs: [
                    { entityId: point, pointIndex: 0 },
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
                datum: 7,
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p = solver.pointOf({ entityId: point, pointIndex: 0 });
            const a = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(perpendicularDistance(p, a, b)).toBeCloseTo(7, 6);

            solver.setDatum(id, 3);
            solver.solve(true);
            const p2 = solver.pointOf({ entityId: point, pointIndex: 0 });
            const a2 = solver.pointOf({ entityId: line, pointIndex: 0 });
            const b2 = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(perpendicularDistance(p2, a2, b2)).toBeCloseTo(3, 6);
            solver.dispose();
        });

        test("default datum is signed and preserves the point's side", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const point = solver.addCircle(5, 6, 1);
            const refs: SketchPointRef[] = [
                { entityId: point, pointIndex: 0 },
                { entityId: line, pointIndex: 0 },
                { entityId: line, pointIndex: 1 },
            ];
            const signedDistance = () => {
                const [px, py] = solver.pointOf(refs[0]);
                const [x1, y1] = solver.pointOf(refs[1]);
                const [x2, y2] = solver.pointOf(refs[2]);
                return ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) / Math.hypot(x2 - x1, y2 - y1);
            };

            const id = solver.addConstraint({ kind: ConstraintKind.P2LDistance, refs });
            // garlic's sign is the negated cross product: left of the direction stores negative
            expect(solver.toData().constraints.find((c) => c.id === id)!.datum).toBeCloseTo(-6, 6);

            // accepting the default datum keeps the point above the line (no mirroring)
            solver.solve(true);
            expect(signedDistance()).toBeCloseTo(6, 6);

            // a positive garlic datum pulls the point to the other side
            solver.setDatum(id, 6);
            solver.solve(true);
            expect(signedDistance()).toBeCloseTo(-6, 6);
            solver.dispose();
        });
    });

    describe("angle", () => {
        test("datum in radians drives the angle between two lines", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(0, 0, 6.4, 7.7); // roughly 50°
            solver.addConstraint({
                kind: ConstraintKind.Angle,
                refs: [
                    { entityId: l1, pointIndex: 0 },
                    { entityId: l1, pointIndex: 1 },
                    { entityId: l2, pointIndex: 0 },
                    { entityId: l2, pointIndex: 1 },
                ],
                datum: Math.PI / 3,
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const d1 = directionOf(solver, l1);
            const d2 = directionOf(solver, l2);
            const cos =
                (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]));
            expect(cos).toBeCloseTo(0.5, 6);

            const data = solver.toData();
            const angleConstraint = data.constraints.find((c) => c.kind === ConstraintKind.Angle)!;
            expect(angleConstraint.datum).toBeCloseTo(Math.PI / 3, 6);
            solver.dispose();
        });
    });

    describe("horizontalDistance / verticalDistance", () => {
        test("horizontalDistance datum drives the signed x difference, including negative values", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 0, 2);
            const c2 = solver.addCircle(10, 3, 2);
            const p1: SketchPointRef = { entityId: c1, pointIndex: 0 };
            const p2: SketchPointRef = { entityId: c2, pointIndex: 0 };
            const id = solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: [p1, p2],
                datum: 15,
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf(p2)[0] - solver.pointOf(p1)[0]).toBeCloseTo(15, 6);

            solver.setDatum(id, -8);
            solver.solve(true);
            expect(solver.pointOf(p2)[0] - solver.pointOf(p1)[0]).toBeCloseTo(-8, 6);
            solver.dispose();
        });

        test("verticalDistance datum drives the signed y difference, including negative values", () => {
            const solver = new SketchSolver(Plane.XY);
            const c1 = solver.addCircle(0, 0, 2);
            const c2 = solver.addCircle(10, 3, 2);
            const p1: SketchPointRef = { entityId: c1, pointIndex: 0 };
            const p2: SketchPointRef = { entityId: c2, pointIndex: 0 };
            const id = solver.addConstraint({
                kind: ConstraintKind.VerticalDistance,
                refs: [p1, p2],
                datum: 12,
            });

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf(p2)[1] - solver.pointOf(p1)[1]).toBeCloseTo(12, 6);

            solver.setDatum(id, -6);
            solver.solve(true);
            expect(solver.pointOf(p2)[1] - solver.pointOf(p1)[1]).toBeCloseTo(-6, 6);
            solver.dispose();
        });
    });

    describe("fix", () => {
        test("fix pins a point, round-trips its datums, and setDatum moves it", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(3, 4, 2);
            const line = solver.addLine(20, 20, 30, 20);
            const fixedRef: SketchPointRef = { entityId: circle, pointIndex: 0 };
            expect(solver.dofs()).toBe(7);

            const id = solver.addConstraint({ kind: ConstraintKind.Fix, refs: [fixedRef] });
            expect(solver.dofs()).toBe(5);

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf(fixedRef)).toEqual([3, 4]);
            expect(solver.toData().constraints[0].datums).toEqual([3, 4]);

            const data = solver.toData();
            const restored = new SketchSolver(Plane.XY, data);
            expect(restored.toData().constraints).toEqual(data.constraints);
            restored.dispose();

            solver.setDatum(id, 42, 0);
            solver.solve(true);
            const pinned = solver.pointOf(fixedRef);
            expect(pinned[0]).toBeCloseTo(42, 6);
            expect(pinned[1]).toBeCloseTo(4, 6);

            const dragRef: SketchPointRef = { entityId: line, pointIndex: 1 };
            solver.beginDrag([dragRef]);
            solver.dragTo(dragRef, 35, 25);
            solver.endDrag();
            const afterDrag = solver.pointOf(fixedRef);
            expect(afterDrag[0]).toBeCloseTo(42, 6);
            expect(afterDrag[1]).toBeCloseTo(4, 6);
            solver.dispose();
        });
    });

    describe("constraint type validation", () => {
        test("equalRadius with line refs throws", () => {
            const solver = new SketchSolver(Plane.XY);
            const l1 = solver.addLine(0, 0, 10, 0);
            const l2 = solver.addLine(0, 5, 10, 5);
            expect(() =>
                solver.addConstraint({
                    kind: ConstraintKind.EqualRadius,
                    refs: [
                        { entityId: l1, pointIndex: 0 },
                        { entityId: l2, pointIndex: 0 },
                    ],
                }),
            ).toThrow(/is not a circle/);
            solver.dispose();
        });

        test("pointOnLine with a circle as the line ref throws", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(0, 0, 5);
            const line = solver.addLine(0, 0, 10, 0);
            expect(() =>
                solver.addConstraint({
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: line, pointIndex: 0 },
                        { entityId: circle, pointIndex: 0 },
                        { entityId: line, pointIndex: 1 },
                    ],
                }),
            ).toThrow(/is not a line/);
            solver.dispose();
        });

        test("parallel with an arc ref throws", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            const arc = solver.addArc(0, 0, 5, 0, 0, 5);
            expect(() =>
                solver.addConstraint({
                    kind: ConstraintKind.Parallel,
                    refs: [
                        { entityId: line, pointIndex: 0 },
                        { entityId: line, pointIndex: 1 },
                        { entityId: arc, pointIndex: 1 },
                        { entityId: line, pointIndex: 0 },
                    ],
                }),
            ).toThrow(/is not a line/);
            solver.dispose();
        });

        test("pointOnCircle with a line as the circle ref throws", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(0, 0, 10, 0);
            expect(() =>
                solver.addConstraint({
                    kind: ConstraintKind.PointOnCircle,
                    refs: [
                        { entityId: line, pointIndex: 0 },
                        { entityId: line, pointIndex: 1 },
                    ],
                }),
            ).toThrow(/is not a circle/);
            solver.dispose();
        });
    });

    describe("datum (origin and axes)", () => {
        test("seeding keeps an empty sketch at zero dofs and out of entities()/toData()", () => {
            const solver = new SketchSolver(Plane.XY);
            expect(solver.dofs()).toBe(0);
            expect(solver.entities()).toEqual([]);
            const data = solver.toData();
            expect(data.entities).toEqual([]);
            expect(data.constraints).toEqual([]);
            solver.dispose();
        });

        test("datum refs resolve to fixed coordinates", () => {
            const solver = new SketchSolver(Plane.XY);
            expect(solver.pointOf(originRef())).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: SKETCH_X_AXIS_ID, pointIndex: 1 })).toEqual([1, 0]);
            expect(solver.pointOf({ entityId: SKETCH_Y_AXIS_ID, pointIndex: 1 })).toEqual([0, 1]);
            expect(solver.entity(SKETCH_X_AXIS_ID)).toEqual({
                id: SKETCH_X_AXIS_ID,
                type: "line",
                params: [0, 0, 1, 0],
            });
            expect(solver.entity(SKETCH_ORIGIN_ID)).toBeUndefined();
            solver.dispose();
        });

        test("coincident with the origin pulls the point to (0, 0)", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(5, 5, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: line, pointIndex: 0 }, originRef()],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const [u, v] = solver.pointOf({ entityId: line, pointIndex: 0 });
            expect(u).toBeCloseTo(0, 6);
            expect(v).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("pointOnLine with a datum axis pulls the point onto the axis", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(5, 5, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: line, pointIndex: 0 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const [, v] = solver.pointOf({ entityId: line, pointIndex: 0 });
            expect(v).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("symmetric about the Y axis mirrors the two points", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(2, 3, 6, 3);
            solver.addConstraint({
                kind: ConstraintKind.Symmetric,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                    ...axisLineRefs(SKETCH_Y_AXIS_ID),
                ],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const [x1, y1] = solver.pointOf({ entityId: line, pointIndex: 0 });
            const [x2, y2] = solver.pointOf({ entityId: line, pointIndex: 1 });
            expect(x1).toBeCloseTo(-x2, 6);
            expect(y1).toBeCloseTo(y2, 6);
            solver.dispose();
        });

        test("horizontal distance from the origin measures the signed x coordinate", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(7, 3, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: [originRef(), { entityId: line, pointIndex: 0 }],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const data = solver.toData();
            expect(data.constraints[0].datum).toBeCloseTo(7, 6);
            solver.dispose();
        });

        test("datum constraints survive a toData/loadData round trip", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(5, 5, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: line, pointIndex: 0 }, originRef()],
            });
            solver.solve(true);

            const restored = new SketchSolver(Plane.XY, solver.toData());
            try {
                const [u, v] = restored.pointOf({ entityId: line, pointIndex: 0 });
                expect(u).toBeCloseTo(0, 6);
                expect(v).toBeCloseTo(0, 6);
                expect(restored.toData().constraints[0].refs).toEqual([
                    { entityId: line, pointIndex: 0 },
                    originRef(),
                ]);
            } finally {
                restored.dispose();
                solver.dispose();
            }
        });

        test("datum refs never join a coincident group or a drag", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(5, 5, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: line, pointIndex: 0 }, originRef()],
            });
            solver.solve(true);

            expect(solver.coincidentGroup({ entityId: line, pointIndex: 0 })).toEqual([
                { entityId: line, pointIndex: 0 },
            ]);

            // dragging the point snaps it back to the origin on the final solve
            solver.beginDrag([{ entityId: line, pointIndex: 0 }]);
            solver.dragTo({ entityId: line, pointIndex: 0 }, 8, 4);
            const outcome = solver.endDrag();
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const [u, v] = solver.pointOf({ entityId: line, pointIndex: 0 });
            expect(u).toBeCloseTo(0, 6);
            expect(v).toBeCloseTo(0, 6);
            // and the origin itself never moved
            expect(solver.pointOf(originRef())).toEqual([0, 0]);
            solver.dispose();
        });

        test("the datum cannot be moved or removed", () => {
            const solver = new SketchSolver(Plane.XY);
            expect(() => solver.setPointPosition(originRef(), 1, 1)).toThrow(/datum/);
            expect(() => solver.removeEntity(SKETCH_ORIGIN_ID)).toThrow(/datum/);
            expect(() => solver.removeEntity(SKETCH_X_AXIS_ID)).toThrow(/datum/);
            solver.dispose();
        });
    });

    describe("drag projection and incidence repair", () => {
        test("dragTo slides an axis-constrained point along the axis", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(10, 5, 60, 5);
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: line, pointIndex: 1 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            });
            solver.solve(true);

            const ref = { entityId: line, pointIndex: 1 };
            solver.beginDrag([ref]);
            solver.dragTo(ref, -500, 42);
            const [u, v] = solver.pointOf(ref);
            expect(u).toBeCloseTo(-500, 6);
            expect(v).toBeCloseTo(0, 6);
            const outcome = solver.endDrag();
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf(ref)[1]).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("large drag jumps never leave a constrained point off its axis", () => {
            const solver = new SketchSolver(Plane.XY);
            const line = solver.addLine(10, 5, 60, 5);
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: line, pointIndex: 1 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            });
            solver.solve(true);

            const ref = { entityId: line, pointIndex: 1 };
            solver.beginDrag([ref]);
            // fast mouse flicks: far-left jumps with large vertical noise
            for (const [u, v] of [
                [-800, 300],
                [-2000, -750],
                [-80109, 5],
                [-40, 12],
            ] as const) {
                const outcome = solver.dragTo(ref, u, v);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                expect(solver.pointOf(ref)[1]).toBeCloseTo(0, 6);
            }
            const outcome = solver.endDrag();
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf(ref)[1]).toBeCloseTo(0, 6);
            solver.dispose();
        });

        test("a fine solve heals a point left far off its incidence line", () => {
            // a sketch saved mid-drift: the point is far off the axis it is pinned to
            const solver = new SketchSolver(Plane.XY, {
                entities: [{ id: 1, type: "line", params: [-1050, 0, -1000, 5] }],
                constraints: [
                    {
                        id: 1,
                        kind: ConstraintKind.PointOnLine,
                        refs: [{ entityId: 1, pointIndex: 1 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
                    },
                ],
            });
            try {
                const [u, v] = solver.pointOf({ entityId: 1, pointIndex: 1 });
                // 沿线方向是自由自由度，求解器的信赖域首步允许 x 有微小漂移；
                // v 的精度下限受 PointOnLine 的 s² 行缩放制约：远端 L≈10³ 时
                // 物理残差地板 ≈ tol_r·L² ≈ 1e-4（与 INCIDENCE_TOLERANCE 同量级）
                expect(Math.abs(u + 1000)).toBeLessThan(0.05);
                expect(v).toBeCloseTo(0, 4);
                expect(solver.solve(true).result.startsWith("Ok")).toBe(true);
            } finally {
                solver.dispose();
            }
        });

        test("a far drag keeps a point on its fully pinned circle", () => {
            const solver = new SketchSolver(Plane.XY);
            const circle = solver.addCircle(0, 0, 10);
            const line = solver.addLine(10, 0, 20, 0);
            solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circle, pointIndex: 0 }],
                datum: 10,
            });
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: circle, pointIndex: 0 }, originRef()],
            });
            solver.addConstraint({
                kind: ConstraintKind.PointOnCircle,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: circle, pointIndex: 0 },
                ],
            });
            solver.solve(true);

            const ref = { entityId: line, pointIndex: 0 };
            solver.beginDrag([ref]);
            solver.dragTo(ref, -400, 300);
            const outcome = solver.endDrag();
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(Math.hypot(...solver.pointOf(ref))).toBeCloseTo(10, 6);
            solver.dispose();
        });
    });
});
