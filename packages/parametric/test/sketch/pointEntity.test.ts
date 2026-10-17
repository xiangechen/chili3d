// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Result, type XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { breakEntity, breakPreview } from "../../src/sketch/breakOps";
import { entityDomain, evaluateEntity, projectPoint } from "../../src/sketch/curveEval";
import { extendEntity } from "../../src/sketch/extendOps";
import { mirrorEntities } from "../../src/sketch/mirrorOps";
import { offsetEntities } from "../../src/sketch/offsetOps";
import {
    axisLineRefs,
    ConstraintKind,
    originRef,
    profileEntities,
    SKETCH_Y_AXIS_ID,
    type SketchArrayPattern,
    type SketchData,
} from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import { transformEntities } from "../../src/sketch/transformOps";
import { trimEntity } from "../../src/sketch/trimOps";
import "./setup";

const TOLERANCE = 1e-6;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / Math.hypot(dx, dy);
}

describe("sketch point entity", () => {
    describe("entity layout", () => {
        test("addPoint contributes 2 dofs and a two-param entity", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(3, 4);
                expect(solver.dofs()).toBe(2);
                expect(solver.entities()).toEqual([{ id, type: "point", params: [3, 4] }]);
                expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([3, 4]);
                expect(solver.entityPoints(id)).toEqual([[3, 4]]);
            } finally {
                solver.dispose();
            }
        });

        test("round-trips through toData", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const pointId = solver.addPoint(5, 7);
                const restored = new SketchSolver(Plane.XY, solver.toData());
                try {
                    expect(restored.entity(pointId)).toEqual({ id: pointId, type: "point", params: [5, 7] });
                } finally {
                    restored.dispose();
                }
            } finally {
                solver.dispose();
            }
        });

        test("a constraint on a point survives the round-trip and still solves", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const pointId = solver.addPoint(10.3, 0.2);
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: pointId, pointIndex: 0 },
                        { entityId: lineId, pointIndex: 1 },
                    ],
                });

                const restored = new SketchSolver(Plane.XY, solver.toData());
                try {
                    expect(restored.toData().constraints).toEqual(solver.toData().constraints);
                    const outcome = restored.solve(true);
                    expect(outcome.result.startsWith("Ok")).toBe(true);
                    const [px, py] = restored.pointOf({ entityId: pointId, pointIndex: 0 });
                    const [lx, ly] = restored.pointOf({ entityId: lineId, pointIndex: 1 });
                    near(px, lx);
                    near(py, ly);
                } finally {
                    restored.dispose();
                }
            } finally {
                solver.dispose();
            }
        });
    });

    describe("curve evaluation", () => {
        test("evaluates to its position at any parameter, with an empty domain", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(2, 9);
                const entity = solver.entity(id)!;
                expect(evaluateEntity(entity, 0)).toEqual([2, 9]);
                expect(evaluateEntity(entity, 123.4)).toEqual([2, 9]);
                expect(entityDomain(entity)).toEqual([0, 0]);
            } finally {
                solver.dispose();
            }
        });

        test("projects a probe onto the position itself", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(2, 9);
                const projection = projectPoint(solver.entity(id)!, [5, 5]);
                expect(projection.point).toEqual([2, 9]);
                expect(projection.distance).toBeCloseTo(5, 9);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("profile exclusion", () => {
        test("profileEntities keeps curves out of construction but drops points", () => {
            const data: SketchData = {
                entities: [
                    { id: 1, type: "line", params: [0, 0, 1, 1] },
                    { id: 2, type: "point", params: [3, 3] },
                    { id: 3, type: "circle", params: [0, 0, 5], construction: true },
                ],
                constraints: [],
            };
            expect(profileEntities(data).map((entity) => entity.id)).toEqual([1]);
        });
    });

    describe("constraints", () => {
        test("a Fix pins the point: no dofs left and the solve keeps it in place", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(3, 4);
                solver.addConstraint({
                    kind: ConstraintKind.Fix,
                    refs: [{ entityId: id, pointIndex: 0 }],
                    datums: [3, 4],
                });
                expect(solver.dofs()).toBe(0);

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([3, 4]);
            } finally {
                solver.dispose();
            }
        });

        test("a coincidence with a line's endpoint merges the two after a solve", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const pointId = solver.addPoint(10.3, 0.2);
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: pointId, pointIndex: 0 },
                        { entityId: lineId, pointIndex: 1 },
                    ],
                });

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const [px, py] = solver.pointOf({ entityId: pointId, pointIndex: 0 });
                const [lx, ly] = solver.pointOf({ entityId: lineId, pointIndex: 1 });
                near(px, lx);
                near(py, ly);
            } finally {
                solver.dispose();
            }
        });

        test("a PointOnLine pulls the point onto the line", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const pointId = solver.addPoint(5, 3);
                solver.addConstraint({
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: pointId, pointIndex: 0 },
                        { entityId: lineId, pointIndex: 0 },
                        { entityId: lineId, pointIndex: 1 },
                    ],
                });

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                // the solve may move the line as much as the point — the constraint is
                // incidence, not "the point comes down to where the line was"
                const p = solver.pointOf({ entityId: pointId, pointIndex: 0 });
                const a = solver.pointOf({ entityId: lineId, pointIndex: 0 });
                const b = solver.pointOf({ entityId: lineId, pointIndex: 1 });
                expect(perpendicularDistance(p, a, b)).toBeCloseTo(0, 9);
            } finally {
                solver.dispose();
            }
        });

        test("a P2PDistance dimensions the gap between two points", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const a = solver.addPoint(0, 0);
                const b = solver.addPoint(3, 4);
                solver.addConstraint({
                    kind: ConstraintKind.P2PDistance,
                    refs: [
                        { entityId: a, pointIndex: 0 },
                        { entityId: b, pointIndex: 0 },
                    ],
                    datum: 10,
                });

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const [ax, ay] = solver.pointOf({ entityId: a, pointIndex: 0 });
                const [bx, by] = solver.pointOf({ entityId: b, pointIndex: 0 });
                near(Math.hypot(bx - ax, by - ay), 10);
            } finally {
                solver.dispose();
            }
        });

        test("two points go symmetric about the Y axis", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const a = solver.addPoint(2, 5);
                const b = solver.addPoint(-4, 5);
                solver.addConstraint({
                    kind: ConstraintKind.Symmetric,
                    refs: [
                        { entityId: a, pointIndex: 0 },
                        { entityId: b, pointIndex: 0 },
                        ...axisLineRefs(SKETCH_Y_AXIS_ID),
                    ],
                });

                const outcome = solver.solve(true);
                expect(outcome.result.startsWith("Ok")).toBe(true);
                const [ax, ay] = solver.pointOf({ entityId: a, pointIndex: 0 });
                const [bx, by] = solver.pointOf({ entityId: b, pointIndex: 0 });
                near(ax, -bx);
                near(ay, by);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("drag", () => {
        test("setPointPosition moves the point without a solve", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(1, 1);
                solver.setPointPosition({ entityId: id, pointIndex: 0 }, 7, -2);
                expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([7, -2]);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("curve ops refuse a point", () => {
        test("trim refuses", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(1, 1);
                const result = trimEntity(solver, id, [1, 1], TOLERANCE);
                expect(result.isOk).toBe(false);
                expect(result.error).toBe("A point cannot be trimmed");
            } finally {
                solver.dispose();
            }
        });

        test("break refuses and previews nothing", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const id = solver.addPoint(1, 1);
                const result = breakEntity(solver, id, [[1, 1]], TOLERANCE);
                expect(result.isOk).toBe(false);
                expect(result.error).toBe("A point cannot be broken");
                expect(breakPreview(solver, id, [[1, 1]], TOLERANCE)).toEqual([]);
            } finally {
                solver.dispose();
            }
        });

        test("extend refuses a point as target and as boundary", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const pointId = solver.addPoint(12, 0);
                const asTarget = extendEntity(solver, {
                    targetId: pointId,
                    targetUv: [12, 0],
                    boundaryId: lineId,
                    boundaryUv: [10, 0],
                    modifyBoundary: false,
                    tolerance: TOLERANCE,
                });
                expect(asTarget.isOk).toBe(false);
                expect(asTarget.error).toBe("A point has no end to extend");

                const asBoundary = extendEntity(solver, {
                    targetId: lineId,
                    targetUv: [10, 0],
                    boundaryId: pointId,
                    boundaryUv: [12, 0],
                    modifyBoundary: false,
                    tolerance: TOLERANCE,
                });
                expect(asBoundary.isOk).toBe(false);
                expect(asBoundary.error).toBe("A point is no boundary to extend to");
            } finally {
                solver.dispose();
            }
        });

        test("offset skips points: alone there is nothing to offset, beside a line it is ignored", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const pointId = solver.addPoint(1, 1);
                const alone = offsetEntities(solver, [pointId], 1, TOLERANCE);
                expect(alone.isOk).toBe(false);
                expect(alone.error).toBe("Nothing to offset");

                const lineId = solver.addLine(0, 0, 10, 0);
                const mixed = offsetEntities(solver, [lineId, pointId], 1, TOLERANCE);
                expect(mixed.isOk).toBe(true);
                expect(mixed.value.createdEntityIds).toHaveLength(1);
                expect(solver.entity(mixed.value.createdEntityIds[0])!.type).toBe("line");
            } finally {
                solver.dispose();
            }
        });
    });

    describe("curve ops accept a point", () => {
        test("a transform moves it — alone, and beside a line without a collapse complaint", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const lineId = solver.addLine(0, 0, 10, 0);
                const pointId = solver.addPoint(4, 3);
                const moved = transformEntities(solver, [lineId, pointId], [0, 0], {
                    du: 0,
                    dv: 0,
                    angle: Math.PI / 2,
                    scale: 2,
                });
                expect(moved.isOk).toBe(true);
                expect(moved.value.movedEntityIds).toEqual([lineId, pointId]);
                // (4, 3) scaled ×2 about the origin, then turned a quarter: (−6, 8)
                const [px, py] = solver.pointOf({ entityId: pointId, pointIndex: 0 });
                near(px, -6);
                near(py, 8);
            } finally {
                solver.dispose();
            }
        });

        test("a mirror copies it across a line", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const axisId = solver.addLine(0, 0, 0, 10);
                const pointId = solver.addPoint(4, 3);
                const mirrored = mirrorEntities(solver, [pointId], axisId, TOLERANCE);
                expect(mirrored.isOk).toBe(true);
                expect(mirrored.value.createdEntityIds).toHaveLength(1);

                const copy = solver.entity(mirrored.value.createdEntityIds[0])!;
                expect(copy.type).toBe("point");
                const [px, py] = solver.pointOf({ entityId: copy.id, pointIndex: 0 });
                near(px, -4);
                near(py, 3);
            } finally {
                solver.dispose();
            }
        });

        test("a circular array lays point instances around the centre — the bolt-hole circle", () => {
            const solver = new SketchSolver(Plane.XY);
            try {
                const pointId = solver.addPoint(10, 0);
                const pattern: SketchArrayPattern = {
                    type: "circular",
                    center: { type: "ref", ref: originRef() },
                    count: 4,
                    twist: 360,
                    equalSpacing: true,
                };
                const arrayId = solver.addArray(pattern, [pointId]);
                expect(arrayId.isOk).toBe(true);

                const record = solver.arrayRecord(arrayId.value)!;
                expect(record.instanceEntityIds).toHaveLength(3);
                const positions = record.instanceEntityIds.map((id) =>
                    solver.pointOf({ entityId: id!, pointIndex: 0 }),
                );
                // 90°, 180°, 270° around the origin at radius 10
                near(positions[0][0], 0);
                near(positions[0][1], 10);
                near(positions[1][0], -10);
                near(positions[1][1], 0);
                near(positions[2][0], 0);
                near(positions[2][1], -10);
            } finally {
                solver.dispose();
            }
        });
    });

    describe("node shape", () => {
        function mockFactory() {
            const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
            const line = rs.fn((_start: XYZ, _end: XYZ) =>
                Result.ok({ name: "line", isEqual: () => false } as any),
            );
            const combine = rs.fn((edges: any[]) =>
                Result.ok({ name: `compound:${edges.length}`, isEqual: () => false } as any),
            );
            Object.defineProperty(globalThis, "shapeFactory", {
                value: { line, combine },
                writable: true,
                configurable: true,
            });
            return {
                line,
                combine,
                restore: () => {
                    if (previous) {
                        Object.defineProperty(globalThis, "shapeFactory", previous);
                    } else {
                        delete (globalThis as any).shapeFactory;
                    }
                },
            };
        }

        test("a point-only sketch shapes an empty compound — nothing for the factory", () => {
            const { line, combine, restore } = mockFactory();
            try {
                const node = new SketchNode({
                    document: createMockDocument(),
                    plane: Plane.XY,
                    data: { entities: [{ id: 1, type: "point", params: [2, 3] }], constraints: [] },
                });
                const result = node.generateShape();
                expect(result.isOk).toBe(true);
                expect(line).not.toHaveBeenCalled();
                expect(combine).toHaveBeenCalledTimes(1);
                expect((combine.mock.calls[0] as unknown as [any[]])[0]).toEqual([]);
            } finally {
                restore();
            }
        });

        test("a point beside a line never reaches the factory", () => {
            const { line, combine, restore } = mockFactory();
            try {
                const node = new SketchNode({
                    document: createMockDocument(),
                    plane: Plane.XY,
                    data: {
                        entities: [
                            { id: 1, type: "line", params: [0, 0, 10, 0] },
                            { id: 2, type: "point", params: [5, 5] },
                        ],
                        constraints: [],
                    },
                });
                const result = node.generateShape();
                expect(result.isOk).toBe(true);
                expect(line).toHaveBeenCalledTimes(1);
                // one edge, so the shape is the edge itself — no combine at all
                expect(combine).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        });
    });
});
