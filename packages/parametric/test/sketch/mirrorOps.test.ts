// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { mirrorEntities, mirrorPreview, reflectPoint } from "../../src/sketch/mirrorOps";
import { ConstraintKind, SKETCH_X_AXIS_ID, type SketchEntityData } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

type Point = [number, number];

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const nearPoint = (got: readonly number[], want: readonly number[]) => {
    near(got[0], want[0]);
    near(got[1], want[1]);
};

/** The X datum axis as the mirror; fixed, so every DOF left is the sources' own. */
const DATUM_AXIS = SKETCH_X_AXIS_ID;

function entity(solver: SketchSolver, id: number): SketchEntityData {
    const data = solver.entity(id);
    if (data === undefined) throw new Error(`no entity ${id}`);
    return data;
}

/** Constraint kinds of everything referencing `entityId` as a ref. */
function kindsOn(solver: SketchSolver, entityId: number): ConstraintKind[] {
    return solver
        .toData()
        .constraints.filter((c) => c.refs.some((r) => r.entityId === entityId))
        .map((c) => c.kind);
}

describe("reflectPoint", () => {
    test("reflects across a line, not a point", () => {
        nearPoint(reflectPoint([3, 2], [0, 0], [1, 0]), [3, -2]);
        nearPoint(reflectPoint([1, 1], [0, 0], [1, 1]), [1, 1]);
    });
});

describe("mirrorEntities", () => {
    test("mirrors a line and ties both endpoints to it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            const result = mirrorEntities(solver, [source], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];
            nearPoint(entity(solver, copy).params, [1, -2]);
            nearPoint(entity(solver, copy).params.slice(2), [4, -3]);
            expect(kindsOn(solver, copy)).toEqual([ConstraintKind.Symmetric, ConstraintKind.Symmetric]);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
            // the copy is fully determined, so the sketch has exactly the source's own freedom
            expect(diagnostics.dofs).toBe(4);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors a circle, reflecting the center and tying the radius", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addCircle(2, 3, 5);
            const result = mirrorEntities(solver, [source], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];
            const params = entity(solver, copy).params;
            nearPoint(params, [2, -3]);
            near(params[2], 5);
            expect(kindsOn(solver, copy).sort()).toEqual(
                [ConstraintKind.EqualRadius, ConstraintKind.Symmetric].sort(),
            );
            expect(solver.diagnose().redundant).toEqual([]);
            expect(solver.diagnose().dofs).toBe(3);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors an arc with its start and end swapped", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addArc(1, 2, 4, 2, 1, -1);
            const result = mirrorEntities(solver, [source], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];
            const params = entity(solver, copy).params;
            // center reflected; the reflected start is the image of the source's END
            nearPoint(params, [1, -2]);
            nearPoint(params.slice(2), reflectPoint([1, -1], [0, 0], [1, 0]));
            nearPoint(params.slice(4), reflectPoint([4, 2], [0, 0], [1, 0]));

            // the image really is the reflection: its midpoint is the reflection of the
            // source arc's midpoint, which a wrong start/end order would miss
            nearPoint(
                arcMidpoint(params),
                reflectPoint(arcMidpoint(entity(solver, source).params), [0, 0], [1, 0]),
            );
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a construction source's copy construction", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            solver.setConstruction(source, true);

            const result = mirrorEntities(solver, [source], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];
            // the flag lives on the solver, not on the data `planSources` reads
            expect(solver.isConstruction(copy)).toBe(true);
        } finally {
            solver.dispose();
        }
    });

    test("does not read a line as the geometry of an arc it only touches", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a real line for the axis, so it sits in the sketch the way a picked edge
            // would; the arc's copy reflects its centre onto the axis's far end and its
            // end onto the axis's near one — a line-shaped read of the arc's own params
            const axis = solver.addLine(5, 0, 6, 0);
            const source = solver.addArc(6, 0, 6, 1, 5, 0);

            const result = mirrorEntities(solver, [source], axis, 1e-6);

            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.skippedSelfMirror).toEqual([]);
            expect(result.value.createdEntityIds).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors a closed rectangle into a second closed loop", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const sides = rectangle(solver, 1, 4);
            const result = mirrorEntities(solver, sides, DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const copies = result.isOk ? result.value.createdEntityIds : [];
            expect(copies).toHaveLength(4);
            // every corner of the copy lands on the reflection of its source corner
            for (let i = 0; i < 4; i++) {
                const source = entity(solver, sides[i]).params;
                const copy = entity(solver, copies[i]).params;
                nearPoint(copy, reflectPoint([source[0], source[1]], [0, 0], [1, 0]));
                nearPoint(copy.slice(2), reflectPoint([source[2], source[3]], [0, 0], [1, 0]));
            }
            // and the copies' own corners meet, so they describe a loop like their source
            expect(cornerGap(solver, copies)).toBeLessThan(1e-9);
            expect(solver.diagnose().redundant).toEqual([]);

            // Dragging a copy's own corner must not prise it open. The copy carries no
            // freedom of its own, so the pull goes through the symmetry into the source —
            // which is exactly why the copies need no coincidences of their own.
            const sourceBefore = entity(solver, sides[0]).params;
            solver.setPointPosition({ entityId: copies[0], pointIndex: 1 }, 2.5, -9);
            solver.solve(true);
            expect(cornerGap(solver, copies)).toBeLessThan(1e-9);
            expect(entity(solver, sides[0]).params).not.toEqual(sourceBefore);
        } finally {
            solver.dispose();
        }
    });

    test("a mirrored corner is joined in the copy, not left loose", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const [first, second] = connectedPair(solver);
            const result = mirrorEntities(solver, [first, second], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            const copies = result.isOk ? result.value.createdEntityIds : [];
            const corner = { entityId: copies[0], pointIndex: 1 };
            const neighbour = { entityId: copies[1], pointIndex: 0 };

            // The copy's corner carries the source's coincidence. It matters beyond
            // tidiness: a drag landing on the corner adds exactly this constraint, and
            // without it here garlic's substitution would merge the two corner points and
            // the two corner symmetries would become one row twice — the later one
            // flagged redundant. `hasConstraint` is what the drag's auto-constraint asks,
            // so finding it already there is the whole guard.
            expect(solver.hasConstraint(ConstraintKind.P2PCoincident, [corner, neighbour])).toBe(true);
            // one symmetry for the shared corner, not one per line: the two far ends plus it
            const symmetries = solver.toData().constraints.filter((c) => c.kind === ConstraintKind.Symmetric);
            expect(symmetries).toHaveLength(3);
            expect(solver.diagnose().redundant).toEqual([]);
            expect(solver.diagnose().conflicting).toEqual([]);
            // …and the copy is still fully driven: the sketch keeps the source's six
            expect(solver.diagnose().dofs).toBe(6);
        } finally {
            solver.dispose();
        }
    });

    test("dragging a mirrored corner keeps the pair joined and redundant-free", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const [first, second] = connectedPair(solver);
            const result = mirrorEntities(solver, [first, second], DATUM_AXIS, 1e-6);
            const copies = result.isOk ? result.value.createdEntityIds : [];

            // what the editor's drag does: move the corner, solve, then let the drag's
            // auto-constraint add a coincidence — which must find one already there
            const corner = { entityId: copies[0], pointIndex: 1 };
            solver.setPointPosition(corner, 7, 4);
            solver.solve(true);
            const neighbour = { entityId: copies[1], pointIndex: 0 };
            expect(solver.hasConstraint(ConstraintKind.P2PCoincident, [corner, neighbour])).toBe(true);

            const diagnostics = solver.diagnose();
            expect(diagnostics.redundant).toEqual([]);
            expect(diagnostics.conflicting).toEqual([]);
            // the corners still meet, and the source corner came along
            const cornerNow = entity(solver, copies[0]).params.slice(2);
            const neighbourNow = entity(solver, copies[1]).params;
            near(cornerNow[0], neighbourNow[0]);
            near(cornerNow[1], neighbourNow[1]);
            near(entity(solver, first).params[2], solver.pointOf({ entityId: second, pointIndex: 0 })[0]);
        } finally {
            solver.dispose();
        }
    });

    test("the copies follow the axis and the source", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a real, movable axis: the reflection is defined against where it goes
            const axis = solver.addLine(0, 0, 0, 10);
            const source = solver.addLine(1, 2, 4, 3);
            const result = mirrorEntities(solver, [source], axis, 1e-6);
            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];
            nearPoint(entity(solver, copy).params, [-1, 2]);

            // tilt the axis; the copy must land on the reflection across the new line
            solver.setPointPosition({ entityId: axis, pointIndex: 1 }, 5, 10);
            solver.solve(true);
            const axisNow = entity(solver, axis).params;
            const a: Point = [axisNow[0], axisNow[1]];
            const b: Point = [axisNow[2], axisNow[3]];
            const sourceNow = entity(solver, source).params;
            nearPoint(entity(solver, copy).params, reflectPoint([sourceNow[0], sourceNow[1]], a, b));
            nearPoint(entity(solver, copy).params.slice(2), reflectPoint([sourceNow[2], sourceNow[3]], a, b));
        } finally {
            solver.dispose();
        }
    });

    test("skips an entity that is its own mirror", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // along the axis, and bisected by it at right angles: both reflect onto themselves
            const along = solver.addLine(-5, 0, 5, 0);
            const bisected = solver.addLine(0, -3, 0, 3);
            const genuine = solver.addLine(1, 2, 4, 3);
            const before = solver.toData().entities.length;

            const result = mirrorEntities(solver, [along, bisected, genuine], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            if (!result.isOk) return;
            expect(result.value.skippedSelfMirror.sort()).toEqual([along, bisected].sort());
            expect(result.value.createdEntityIds).toHaveLength(1);
            // one copy only — nothing was laid on top of the two self-mirrors
            expect(solver.toData().entities.length).toBe(before + 1);
        } finally {
            solver.dispose();
        }
    });

    test("skips a selection that is its own reflection", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a V whose apex sits on the axis: each arm mirrors exactly onto the other,
            // so copies of them would only be laid over the arms already there
            const left = solver.addLine(2, 0, 5, 3);
            const right = solver.addLine(2, 0, 5, -3);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: left, pointIndex: 0 },
                    { entityId: right, pointIndex: 0 },
                ],
            });
            const before = JSON.stringify(solver.toData());

            const result = mirrorEntities(solver, [left, right], DATUM_AXIS, 1e-6);

            expect(result.isOk).toBe(true);
            expect(result.isOk ? result.value.createdEntityIds : undefined).toEqual([]);
            expect(result.isOk ? result.value.skippedSelfMirror.slice().sort() : undefined).toEqual(
                [left, right].sort(),
            );
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("a source that is already symmetric about the axis is reported, not an error", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            solver.addLine(-5, 0, 5, 0);
            const before = JSON.stringify(solver.toData());

            const result = mirrorEntities(solver, [1], DATUM_AXIS, 1e-6);

            // it is a real answer — the caller says which entities it covered — and the
            // sketch is untouched
            expect(result.isOk).toBe(true);
            expect(result.isOk ? result.value.createdEntityIds : undefined).toEqual([]);
            expect(result.isOk ? result.value.skippedSelfMirror : undefined).toEqual([1]);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test.each([
        ["an axis that is not a line", (solver: SketchSolver) => solver.addCircle(0, 5, 2), "a line"],
        ["a degenerate axis", (solver: SketchSolver) => solver.addLine(1, 1, 1, 1), "too short"],
    ])("refuses %s", (_name, makeAxis, message) => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            const result = mirrorEntities(solver, [source], makeAxis(solver), 1e-6);
            expect(result.isOk).toBe(false);
            expect(result.isOk ? "" : result.error).toContain(message);
            // the source is still the only entity
            expect(solver.toData().entities).toHaveLength(2);
        } finally {
            solver.dispose();
        }
    });

    test("an external reference is not mirrored", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a datum entity answers `entity()` but is never a source
            const result = mirrorEntities(solver, [SKETCH_X_AXIS_ID], DATUM_AXIS, 1e-6);
            expect(result.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("mirrorPreview", () => {
    test("previews the same geometry the op would add, and nothing for a self-mirror", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            const along = solver.addLine(-5, 0, 5, 0);

            const preview = mirrorPreview(solver, [source, along], DATUM_AXIS, 1e-6);

            expect(preview).toHaveLength(1);
            nearPoint(preview[0].params, [1, -2]);
            nearPoint(preview[0].params.slice(2), [4, -3]);
            // a preview changes nothing
            expect(solver.toData().entities).toHaveLength(2);
        } finally {
            solver.dispose();
        }
    });

    test("previews a construction source's copy as construction", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            solver.setConstruction(source, true);

            const preview = mirrorPreview(solver, [source], DATUM_AXIS, 1e-6);

            expect(preview).toHaveLength(1);
            expect(preview[0].construction).toBe(true);
        } finally {
            solver.dispose();
        }
    });

    test("previews nothing when the axis cannot mirror", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            expect(mirrorPreview(solver, [source], solver.addCircle(0, 5, 2), 1e-6)).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});

describe("mirror and dimensions", () => {
    test("a dimension on a mirrored copy drives the source it is tied to", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addLine(1, 2, 4, 3);
            const result = mirrorEntities(solver, [source], DATUM_AXIS, 1e-6);
            expect(result.isOk).toBe(true);
            const [copy] = result.isOk ? result.value.createdEntityIds : [];

            solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: copy, pointIndex: 0 },
                    { entityId: copy, pointIndex: 1 },
                ],
                datum: 5,
            });
            expect(solver.solve(true).result).not.toBe("Conflicting");

            // the copy has no length of its own to give, so the source takes the new one
            const copyParams = entity(solver, copy).params;
            near(Math.hypot(copyParams[2] - copyParams[0], copyParams[3] - copyParams[1]), 5);
            const sourceParams = entity(solver, source).params;
            near(Math.hypot(sourceParams[2] - sourceParams[0], sourceParams[3] - sourceParams[1]), 5);
            expect(solver.diagnose().redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});

/** Two lines meeting at a corner, joined there by a coincidence like the editor's own. */
function connectedPair(solver: SketchSolver): [number, number] {
    const first = solver.addLine(1, 2, 4, 3);
    const second = solver.addLine(4, 3, 6, 7);
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: first, pointIndex: 1 },
            { entityId: second, pointIndex: 0 },
        ],
    });
    return [first, second];
}

/** Four lines closed into a rectangle from (x, y), joined corner to corner. */
function rectangle(solver: SketchSolver, x: number, y: number): number[] {
    const corners: Point[] = [
        [x, y],
        [x + 3, y],
        [x + 3, y + 2],
        [x, y + 2],
    ];
    const sides = corners.map((corner, i) => {
        const next = corners[(i + 1) % corners.length];
        return solver.addLine(corner[0], corner[1], next[0], next[1]);
    });
    for (let i = 0; i < sides.length; i++) {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: sides[i], pointIndex: 1 },
                { entityId: sides[(i + 1) % sides.length], pointIndex: 0 },
            ],
        });
    }
    return sides;
}

/** Largest gap between consecutive copies' touching endpoints — 0 when they form a loop. */
function cornerGap(solver: SketchSolver, copies: readonly number[]): number {
    let worst = 0;
    for (let i = 0; i < copies.length; i++) {
        const end = entity(solver, copies[i]).params.slice(2);
        const nextStart = entity(solver, copies[(i + 1) % copies.length]).params;
        worst = Math.max(worst, Math.hypot(end[0] - nextStart[0], end[1] - nextStart[1]));
    }
    return worst;
}

/** A point on an arc's span — its midpoint angle, for comparing reflections. */
function arcMidpoint(params: readonly number[]): Point {
    const [cx, cy] = [params[0], params[1]];
    const radius = Math.hypot(params[2] - cx, params[3] - cy);
    const start = Math.atan2(params[3] - cy, params[2] - cx);
    const end = Math.atan2(params[5] - cy, params[4] - cx);
    const sum = (end - start) % (Math.PI * 2);
    const sweep = sum > 0 ? sum : sum + Math.PI * 2;
    const angle = start + sweep / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}
