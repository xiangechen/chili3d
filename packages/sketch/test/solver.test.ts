// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { ConstraintKind, type SketchPointRef } from "../src/sketchModel";
import { SketchSolver } from "../src/solver";
import "./setup";

function distance(a: [number, number], b: [number, number]) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
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
});
