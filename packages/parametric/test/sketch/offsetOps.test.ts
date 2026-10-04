// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Precision } from "@chili3d/core";
import { offsetEntities, offsetPreview } from "../../src/sketch/offsetOps";
import { ConstraintKind, type SketchEntityData, toDisplayDatum } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { joinLoop } from "../../src/sketch/solverEntities";
import "./setup";

const TOLERANCE = 1e-6;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const nearPoint = (got: readonly number[], want: readonly number[]) => {
    near(got[0], want[0]);
    near(got[1], want[1]);
};

/** Param pairs of an entity's points, in their own layout order. */
function points(entity: SketchEntityData): [number, number][] {
    const pairs: [number, number][] = [];
    for (let i = 0; i < entity.params.length; i += 2) pairs.push([entity.params[i], entity.params[i + 1]]);
    return pairs;
}

function entity(solver: SketchSolver, id: number): SketchEntityData {
    const data = solver.entity(id);
    if (data === undefined) throw new Error(`no entity ${id}`);
    return data;
}

/** Angle between two segments' directions, in radians — 0 when they are parallel. */
function angleBetween(first: readonly [number, number][], second: readonly [number, number][]): number {
    const a = [first[1][0] - first[0][0], first[1][1] - first[0][1]];
    const b = [second[1][0] - second[0][0], second[1][1] - second[0][1]];
    const cross = a[0] * b[1] - a[1] * b[0];
    return Math.abs(Math.atan2(cross, a[0] * b[0] + a[1] * b[1]));
}

/** Signed distance from a point to a segment's line, left of its direction positive. */
function signedDistance(point: readonly [number, number], line: readonly [number, number][]): number {
    const dx = line[1][0] - line[0][0];
    const dy = line[1][1] - line[0][1];
    const length = Math.hypot(dx, dy);
    return (-dy * (point[0] - line[0][0]) + dx * (point[1] - line[0][1])) / length;
}

function constraintsOn(solver: SketchSolver, entityId: number) {
    return solver.toData().constraints.filter((c) => c.refs.some((r) => r.entityId === entityId));
}

function kindsOn(solver: SketchSolver, entityId: number): ConstraintKind[] {
    return constraintsOn(solver, entityId).map((c) => c.kind);
}

/** The copies an op created, as entity data. */
function copies(solver: SketchSolver, ids: readonly number[]): SketchEntityData[] {
    return ids.map((id) => entity(solver, id));
}

/** A square, walked counter-clockwise, so its left side is the inside. */
function square(solver: SketchSolver, size = 10): number[] {
    const corners: [number, number][] = [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
    ];
    const lines = corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length];
        return solver.addLine(corner[0], corner[1], next[0], next[1]);
    });
    joinLoop(solver, lines);
    return lines;
}

describe("offsetPreview", () => {
    test.each([
        { name: "line", params: [0, 0, 10, 0], distance: 2, want: [0, 2, 10, 2] },
        { name: "line the other way", params: [0, 0, 10, 0], distance: -2, want: [0, -2, 10, -2] },
        { name: "circle", params: [3, 4, 5], distance: 2, want: [3, 4, 7] },
        // an arc's positive is its left — toward the centre — so −1 is the outward copy
        { name: "arc", params: [0, 0, 5, 0, 0, 5], distance: -1, want: [0, 0, 6, 0, 0, 6] },
    ])("offsets a $name", ({ name, params, distance, want }) => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const id =
                name === "circle"
                    ? solver.addCircle(params[0], params[1], params[2])
                    : name === "arc"
                      ? solver.addArc(params[0], params[1], params[2], params[3], params[4], params[5])
                      : solver.addLine(params[0], params[1], params[2], params[3]);

            const preview = offsetPreview(solver, [id], distance, TOLERANCE);

            expect(preview.map((copy) => copy.params)).toEqual([want]);
            // the preview leaves the sketch alone
            expect(entity(solver, id).params).toEqual(params);
        } finally {
            solver.dispose();
        }
    });

    test("previews nothing where the op would refuse", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 1);
            expect(offsetPreview(solver, [circle], -2, TOLERANCE)).toEqual([]);
            expect(offsetPreview(solver, [circle], 0, TOLERANCE)).toEqual([]);
            expect(offsetPreview(solver, [circle], Precision.Distance / 2, TOLERANCE)).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("previews a small distance the dragging tolerance would not reach", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 1);
            // the caller's tolerance is geometric (what counts as a corner): a zoomed-out
            // view must not be able to make a real distance unusable
            expect(offsetPreview(solver, [circle], 0.01, 5)).toEqual([
                { id: 1, type: "circle", params: [0, 0, 1.01] },
            ]);
        } finally {
            solver.dispose();
        }
    });
});

describe("offsetEntities geometry", () => {
    test("offsets a lone line, keeping its length", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 6);

            const result = offsetEntities(solver, [source], 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // the left normal of (3, 4) is (−4, 3)/5, so the copy is 3/5 along −x, 4/5 along y
            nearPoint(copy.params, [1 - 0.8, 2 + 0.6]);
            nearPoint(copy.params.slice(2), [4 - 0.8, 6 + 0.6]);
        } finally {
            solver.dispose();
        }
    });

    test("offsets a circle concentrically and leaves its radius free of the source", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addCircle(2, 3, 5);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            expect(copy.params).toEqual([2, 3, 7]);
            expect(kindsOn(solver, copy.id)).toEqual([ConstraintKind.P2PCoincident]);
        } finally {
            solver.dispose();
        }
    });

    test("offsets an arc without changing its sweep", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addArc(0, 0, 5, 0, 0, 5);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // +2 is the arc's left — toward its centre — so both ends ride in to radius 3
            expect(copy.params.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([0, 0, 3, 0, 0, 3]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a construction source's copies construction", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(0, 0, 10, 0);
            solver.setConstruction(source, true);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            expect(solver.isConstruction(copy.id)).toBe(true);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a distance that would leave a circle with no radius", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 1);

            const result = offsetEntities(solver, [circle], -1, TOLERANCE);

            expect(result.isOk).toBe(false);
            expect(solver.entity(circle)!.params).toEqual([0, 0, 1]);
            expect(solver.entities()).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a copy that would land on existing geometry", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(0, 0, 10, 0);
            solver.addLine(0, 2, 10, 2);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(false);
            expect(solver.entities()).toHaveLength(2);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a pick with nothing to offset", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            expect(offsetEntities(solver, [], 1, TOLERANCE).isOk).toBe(false);
            expect(offsetEntities(solver, [-1], 1, TOLERANCE).isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("offsetEntities corners", () => {
    test("offsets a closed loop inward and joins every corner", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const lines = square(solver);

            const result = offsetEntities(solver, lines, 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // walking counter-clockwise the inside is on the left, so +1 is inward
            expect(created.map((copy) => points(copy))).toEqual([
                [
                    [1, 1],
                    [9, 1],
                ],
                [
                    [9, 1],
                    [9, 9],
                ],
                [
                    [9, 9],
                    [1, 9],
                ],
                [
                    [1, 9],
                    [1, 1],
                ],
            ]);
            // one coincidence per corner, one distance per edge, plus the parallels
            for (const copy of created) {
                expect(kindsOn(solver, copy.id)).toEqual([
                    ConstraintKind.P2PCoincident,
                    ConstraintKind.P2PCoincident,
                    ConstraintKind.Parallel,
                    ConstraintKind.P2LDistance,
                ]);
            }
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("offsets a loop outward when the distance is negative", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const lines = square(solver);

            const result = offsetEntities(solver, lines, -1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            expect(created.map((copy) => points(copy))).toEqual([
                [
                    [-1, -1],
                    [11, -1],
                ],
                [
                    [11, -1],
                    [11, 11],
                ],
                [
                    [11, 11],
                    [-1, 11],
                ],
                [
                    [-1, 11],
                    [-1, -1],
                ],
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("walks a loop whose edges are stored in mixed directions", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the same counter-clockwise square, but the right edge is drawn downwards
            const bottom = solver.addLine(0, 0, 10, 0);
            const right = solver.addLine(10, 10, 10, 0);
            const top = solver.addLine(10, 10, 0, 10);
            const left = solver.addLine(0, 10, 0, 0);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: bottom, pointIndex: 1 },
                    { entityId: right, pointIndex: 1 },
                ],
            });
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: right, pointIndex: 0 },
                    { entityId: top, pointIndex: 0 },
                ],
            });
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: top, pointIndex: 1 },
                    { entityId: left, pointIndex: 0 },
                ],
            });
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: left, pointIndex: 1 },
                    { entityId: bottom, pointIndex: 0 },
                ],
            });

            const result = offsetEntities(solver, [bottom, right, top, left], 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // the backwards edge offsets inward too: every side lands on the inner square
            expect(created.map((copy) => points(copy))).toEqual([
                [
                    [1, 1],
                    [9, 1],
                ],
                [
                    [9, 9],
                    [9, 1],
                ],
                [
                    [9, 9],
                    [1, 9],
                ],
                [
                    [1, 9],
                    [1, 1],
                ],
            ]);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("joins an open chain's shared corner and leaves the free ends offset", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const first = solver.addLine(0, 0, 10, 0);
            const second = solver.addLine(10, 0, 10, 10);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: first, pointIndex: 1 },
                    { entityId: second, pointIndex: 0 },
                ],
            });

            const result = offsetEntities(solver, [first, second], 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // +1 is left of the walk: up along the first edge, then left along the second
            expect(created.map((copy) => points(copy))).toEqual([
                [
                    [0, 1],
                    [9, 1],
                ],
                [
                    [9, 1],
                    [9, 10],
                ],
            ]);
            // each edge keeps a free end, tied to its source's own end by a point distance
            expect(kindsOn(solver, created[0].id)).toContain(ConstraintKind.Perpendicular);
            expect(kindsOn(solver, created[1].id)).toContain(ConstraintKind.Perpendicular);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("offsets every edge of a filleted rectangle, arcs and lines together", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // 20×10 with radius 2 fillets, walked counter-clockwise: every line runs from
            // one fillet's end to the next fillet's start
            const edges = [
                solver.addLine(2, 0, 18, 0),
                solver.addArc(18, 2, 18, 0, 20, 2),
                solver.addLine(20, 2, 20, 8),
                solver.addArc(18, 8, 20, 8, 18, 10),
                solver.addLine(18, 10, 2, 10),
                solver.addArc(2, 8, 2, 10, 0, 8),
                solver.addLine(0, 8, 0, 2),
                solver.addArc(2, 2, 0, 2, 2, 0),
            ];
            // `joinLoop` is the line-only helper (an arc's point 0 is its centre), so the
            // two ends of each fillet meet the lines on either side of it by hand
            edges.forEach((edge, index) => {
                if (index % 2 === 0) return;
                const previous = edges[index - 1];
                const next = edges[(index + 1) % edges.length];
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: previous, pointIndex: 1 },
                        { entityId: edge, pointIndex: 1 },
                    ],
                });
                solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: edge, pointIndex: 2 },
                        { entityId: next, pointIndex: 0 },
                    ],
                });
            });

            // the plan the op works from: lines in by 1, fillets down to radius 1, every
            // corner met at the tangent point — the inside offset of the rounded outline
            expect(offsetPreview(solver, edges, 1, TOLERANCE).map((copy) => copy.params)).toEqual([
                [2, 1, 18, 1],
                [18, 2, 18, 1, 19, 2],
                [19, 2, 19, 8],
                [18, 8, 19, 8, 18, 9],
                [18, 9, 2, 9],
                [2, 8, 2, 9, 1, 8],
                [1, 8, 1, 2],
                [2, 2, 1, 2, 2, 1],
            ]);

            const result = offsetEntities(solver, edges, 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            expect(result.isOk ? result.value.branched : -1).toBe(0);
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            expect(created).toHaveLength(edges.length);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("leaves a branched pick's edges unjoined, and says how many", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // three lines meeting at the origin: no single pair is "the" corner. Only the
            // first two carry a coincidence — the third merely starts there, which is what
            // a T junction drawn by hand looks like. Three coincidences over the same point
            // would also be a garlic substitution cycle, whose duplicate row reads back as
            // a conflict and would fail the solve for a reason that is not the offset's.
            const first = solver.addLine(-10, 0, 0, 0);
            const second = solver.addLine(0, 0, 10, 0);
            const third = solver.addLine(0, 0, 0, 10);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: first, pointIndex: 1 },
                    { entityId: second, pointIndex: 0 },
                ],
            });

            const result = offsetEntities(solver, [first, second, third], 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            expect(result.isOk ? result.value.branched : 0).toBe(1);
            // every edge still offsets, each on its own
            const created = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            expect(created.map((copy) => points(copy))).toEqual([
                [
                    [-10, 1],
                    [0, 1],
                ],
                [
                    [0, 1],
                    [10, 1],
                ],
                [
                    [-1, 0],
                    [-1, 10],
                ],
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a distance that turns the geometry inside out", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const lines = square(solver, 10);

            const result = offsetEntities(solver, lines, 20, TOLERANCE);

            expect(result.isOk).toBe(false);
            expect(solver.entities()).toHaveLength(4);
        } finally {
            solver.dispose();
        }
    });

    test("joins a line to the fillet arc that continues it, keeping the arc's offset radius", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the bottom-right corner of a rectangle with a 2mm fillet: the line runs to
            // (8, 0), where the arc — centred (8, 2), radius 2 — takes over, tangent
            const line = solver.addLine(0, 0, 8, 0);
            const arc = solver.addArc(8, 2, 8, 0, 10, 2);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: arc, pointIndex: 1 },
                ],
            });

            const result = offsetEntities(solver, [line, arc], 1, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [lineCopy, arcCopy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // +1 is left of the walk, which is the inside of the corner for both curves
            expect(points(lineCopy)).toEqual([
                [0, 1],
                [8, 1],
            ]);
            // the arc shrinks to radius 1 and its start stays tangent to the offset line
            const [cx, cy, sx, sy, ex, ey] = arcCopy.params;
            near(cx, 8);
            near(cy, 2);
            nearPoint([sx, sy], [8, 1]);
            nearPoint([ex, ey], [9, 2]);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});

describe("offsetEntities ties", () => {
    test("ties a line copy by parallel, a positive distance dimension and its length", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(0, 0, 10, 0);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? copies(solver, result.value.createdEntityIds) : [];
            // a lone line keeps both ends free, so both are tied to the source's own
            expect(kindsOn(solver, copy.id).sort()).toEqual(
                [
                    ConstraintKind.Perpendicular,
                    ConstraintKind.Perpendicular,
                    ConstraintKind.P2LDistance,
                    ConstraintKind.Parallel,
                ].sort(),
            );
            const dimension = constraintsOn(solver, copy.id).find(
                (c) => c.kind === ConstraintKind.P2LDistance,
            );
            if (dimension === undefined) throw new Error("no distance constraint");
            expect(dimension.refs[0].entityId).toBe(copy.id);
            expect(dimension.refs[1].entityId).toBe(source);
            // the datum reads as the distance the user asked for, on the side they got
            expect(toDisplayDatum(ConstraintKind.P2LDistance, dimension.datum as number)).toBeCloseTo(2, 9);
        } finally {
            solver.dispose();
        }
    });

    test("reads the dimension positive whichever way the source line was drawn", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(10, 0, 0, 0);

            const result = offsetEntities(solver, [source], 2, TOLERANCE);

            expect(result.isOk).toBe(true);
            const constraint = solver.toData().constraints.find((c) => c.kind === ConstraintKind.P2LDistance);
            if (constraint === undefined) throw new Error("no distance constraint");
            expect(toDisplayDatum(ConstraintKind.P2LDistance, constraint.datum as number)).toBeCloseTo(2, 9);
        } finally {
            solver.dispose();
        }
    });

    test("follows the source when it moves, keeping the offset distance", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(0, 0, 10, 0);
            const result = offsetEntities(solver, [source], 2, TOLERANCE);
            const [copyId] = result.isOk ? result.value.createdEntityIds : [];

            solver.setPointPosition({ entityId: source, pointIndex: 1 }, 20, 10);
            solver.solve(true);

            // the source is only a free line, so it drifts too — what the copy owes is
            // that both its ends are the source's ends 2 to the left, still aligned
            const copy = points(entity(solver, copyId));
            const moved = points(entity(solver, source));
            expect(angleBetween(copy, moved)).toBeLessThan(1e-5);
            for (const [index, point] of copy.entries()) {
                expect(Math.hypot(point[0] - moved[index][0], point[1] - moved[index][1])).toBeCloseTo(2, 6);
                near(signedDistance(point, moved), 2);
            }
            // the copy adds no freedom of its own: the sketch keeps the source's four
            expect(solver.diagnose().dofs).toBe(4);
        } finally {
            solver.dispose();
        }
    });

    test("follows the source of a closed loop", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const lines = square(solver);
            const result = offsetEntities(solver, lines, 1, TOLERANCE);
            const created = result.isOk ? result.value.createdEntityIds : [];

            // drag the (10, 10) corner out to (14, 10): the offsets have to follow
            solver.setPointPosition({ entityId: lines[1], pointIndex: 1 }, 14, 10);
            solver.solve(true);

            // the sources are only joined, not pinned, so the drag redistributes them —
            // what the copies owe is the relationship, not a particular corner position
            for (const [index, copyId] of created.entries()) {
                const copy = points(entity(solver, copyId));
                const source = points(entity(solver, lines[index]));
                // still parallel to its own edge, to the solver's own convergence
                expect(angleBetween(copy, source)).toBeLessThan(1e-5);
                near(signedDistance(copy[0], source), 1); // still one to its left
            }
            for (const [index, copyId] of created.entries()) {
                const copy = points(entity(solver, copyId));
                const next = points(entity(solver, created[(index + 1) % created.length]));
                nearPoint(copy[1], next[0]); // the corners are still stitched
            }
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});
