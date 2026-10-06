// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { ConstraintKind, originRef, type SketchEntityData } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { centerRef, lineRefs } from "../../src/sketch/solverEntities";
import {
    isIdentityTransform,
    type SketchTransform,
    transformBase,
    transformEntities,
    transformParams,
    transformPoint,
    transformPreview,
} from "../../src/sketch/transformOps";
import "./setup";

const HALF_PI = Math.PI / 2;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const nearPoint = (got: readonly number[], want: readonly number[]) => {
    near(got[0], want[0]);
    near(got[1], want[1]);
};

/** A transform that does nothing but what the case under test asks of it. */
function move(overrides: Partial<SketchTransform> = {}): SketchTransform {
    return { du: 0, dv: 0, angle: 0, scale: 1, ...overrides };
}

function entity(solver: SketchSolver, id: number): SketchEntityData {
    const data = solver.entity(id);
    if (data === undefined) throw new Error(`no entity ${id}`);
    return data;
}

/** The triad's base, which every case here has to have: nothing movable would be a bug of its own. */
function baseOf(solver: SketchSolver, ids: readonly number[]): [number, number] {
    const base = transformBase(solver, ids);
    if (base === undefined) throw new Error("no base for the selection");
    return base;
}

/** Kinds of every constraint the sketch holds, so a swap or a drop shows in one read. */
function constraintIds(solver: SketchSolver): number[] {
    return solver.toData().constraints.map((constraint) => constraint.id);
}

describe("transformPoint", () => {
    test("shifts by the translation alone", () => {
        expect(transformPoint([1, 2], [0, 0], move({ du: 3, dv: -1 }))).toEqual([4, 1]);
    });

    test("scales about the base, then turns, then shifts", () => {
        // (2, 1) scaled by 2 about the origin is (4, 2); a quarter turn takes it to (-2, 4)
        const [u, v] = transformPoint([2, 1], [0, 0], move({ angle: HALF_PI, scale: 2, du: 1, dv: 1 }));
        near(u, -1);
        near(v, 5);
    });

    test("leaves the base itself where it is", () => {
        const [u, v] = transformPoint([3, -2], [3, -2], move({ angle: HALF_PI, scale: 2, du: 5, dv: 5 }));
        near(u, 8);
        near(v, 3);
    });
});

describe("transformBase", () => {
    test("is the centre of the selection's bounding box", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const circle = solver.addCircle(10, 4, 2);
            // x spans 0..12, y spans 0..6
            expect(baseOf(solver, [line, circle])).toEqual([6, 3]);
        } finally {
            solver.dispose();
        }
    });

    test("sits on a half-turn arc's reach, not on its chord", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // counter-clockwise from (10, 0) to (-10, 0), so the bow tops out at (0, 10):
            // the bound is x −10..10 and y 0..10, not the flat line the ends alone describe
            const arc = solver.addArc(0, 0, 10, 0, -10, 0);
            expect(baseOf(solver, [arc])).toEqual([0, 5]);
        } finally {
            solver.dispose();
        }
    });

    test("bounds a quarter arc no farther than its ends already do", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the sweep crosses no cardinal extreme its centre and ends do not already bound
            const arc = solver.addArc(0, 0, 10, 0, 0, 10);
            expect(baseOf(solver, [arc])).toEqual([5, 5]);
        } finally {
            solver.dispose();
        }
    });

    test("is undefined when nothing in the selection can move", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            expect(transformBase(solver, [])).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });
});

describe("transformParams", () => {
    test("moves a line's two ends", () => {
        const line: SketchEntityData = { id: 1, type: "line", params: [1, 1, 3, 1] };
        expect(transformParams(line, [0, 0], move({ du: 5 }))).toEqual([6, 1, 8, 1]);
    });

    test("moves a circle's centre and scales its own radius", () => {
        const circle: SketchEntityData = { id: 1, type: "circle", params: [2, 2, 3] };
        const params = transformParams(circle, [2, 2], move({ scale: 2 }));
        nearPoint(params, [2, 2]);
        near(params[2], 6);
    });

    test("moves an arc's centre and both ends, keeping its orientation", () => {
        // a quarter arc about the origin, from (1, 0) to (0, 1)
        const arc: SketchEntityData = { id: 1, type: "arc", params: [0, 0, 1, 0, 0, 1] };
        const params = transformParams(arc, [0, 0], move({ scale: 2 }));
        nearPoint(params, [0, 0]);
        nearPoint(params.slice(2), [2, 0]);
        nearPoint(params.slice(4), [0, 2]);
    });
});

/**
 * A rectangle built the way the rectangle tool builds one: four edges, an axis-aligned
 * relation on each, and a coincidence at every corner.
 */
function rectangleEdges(solver: SketchSolver, corners: readonly [number, number][]): number[] {
    const edges = corners.map((corner, i) => {
        const next = corners[(i + 1) % corners.length];
        return solver.addLine(corner[0], corner[1], next[0], next[1]);
    });
    const kinds = [ConstraintKind.Horizontal, ConstraintKind.Vertical];
    edges.forEach((edge, i) => {
        solver.addConstraint({ kind: kinds[i % 2], refs: lineRefs(edge) });
    });
    edges.forEach((edge, i) => {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: edge, pointIndex: 1 },
                { entityId: edges[(i + 1) % edges.length], pointIndex: 0 },
            ],
        });
    });
    return edges;
}

/** The length of each edge, so a moved rectangle can be checked for having kept its sides. */
function edgeLengths(solver: SketchSolver, edges: readonly number[]): number[] {
    return edges.map((id) => {
        const [, x1, y1, x2, y2] = [0, ...entity(solver, id).params];
        return Math.hypot(x2 - x1, y2 - y1);
    });
}

/** The cosine of the angle between each edge and the next — zero when the corner is square. */
function cornerCosines(solver: SketchSolver, edges: readonly number[]): number[] {
    return edges.map((id, i) => {
        const [x1, y1, x2, y2] = entity(solver, id).params;
        const [x3, y3, x4, y4] = entity(solver, edges[(i + 1) % edges.length]).params;
        const first = [x2 - x1, y2 - y1];
        const second = [x4 - x3, y4 - y3];
        return (first[0] * second[0] + first[1] * second[1]) / (Math.hypot(...first) * Math.hypot(...second));
    });
}

describe("transformEntities", () => {
    test("turns a rectangle off the axes, keeping it the rectangle it was", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const edges = rectangleEdges(solver, [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
            ]);

            const moved = transformEntities(
                solver,
                edges,
                baseOf(solver, edges),
                move({ du: 5, angle: 0.4847 }),
            );

            expect(moved.isOk).toBe(true);
            // a turn off the axes takes the four axis-aligned relations and nothing else
            expect(moved.isOk && moved.value.removedConstraintIds).toHaveLength(4);
            expect(solver.diagnose().conflicting).toEqual([]);
            // …and what is left is still the rectangle, turned: same sides, same square corners
            for (const length of edgeLengths(solver, edges)) near(length, 10);
            for (const cosine of cornerCosines(solver, edges)) near(cosine, 0);
        } finally {
            solver.dispose();
        }
    });

    test("moves a line to where the transform says", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(1, 1, 3, 1);
            const result = transformEntities(solver, [line], baseOf(solver, [line]), move({ du: 5 }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.movedEntityIds).toEqual([line]);
            nearPoint(entity(solver, line).params, [6, 1]);
            nearPoint(entity(solver, line).params.slice(2), [8, 1]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a dimensioned sketch's constraints when it is only translated", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            solver.addConstraint({ kind: ConstraintKind.Horizontal, refs: lineRefs(line) });
            solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs: lineRefs(line), datum: 4 });

            const result = transformEntities(solver, [line], baseOf(solver, [line]), move({ dv: 7 }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toEqual([]);
            expect(result.isOk && result.value.swappedConstraintIds).toEqual([]);
            const diagnostics = solver.diagnose();
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.redundant).toEqual([]);
            nearPoint(entity(solver, line).params, [0, 7]);
            nearPoint(entity(solver, line).params.slice(2), [4, 7]);
        } finally {
            solver.dispose();
        }
    });

    test("swaps a Horizontal for a Vertical on a quarter turn, keeping the constraint's id", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const constraint = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });

            const result = transformEntities(
                solver,
                [line],
                baseOf(solver, [line]),
                move({ angle: HALF_PI }),
            );

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.swappedConstraintIds).toEqual([constraint]);
            const kinds = solver
                .toData()
                .constraints.filter((c) => c.id === constraint)
                .map((c) => c.kind);
            expect(kinds).toEqual([ConstraintKind.Vertical]);
            expect(solver.diagnose().conflicting).toEqual([]);
            // the line really did turn: it is now upright about the base, not pulled back
            const params = entity(solver, line).params;
            near(params[0], params[2]);
            near(params[0], 2);
        } finally {
            solver.dispose();
        }
    });

    test("leaves the axis-aligned relation alone on a half turn", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const constraint = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(line),
            });

            const result = transformEntities(
                solver,
                [line],
                baseOf(solver, [line]),
                move({ angle: Math.PI }),
            );

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.swappedConstraintIds).toEqual([]);
            const kinds = solver
                .toData()
                .constraints.filter((c) => c.id === constraint)
                .map((c) => c.kind);
            expect(kinds).toEqual([ConstraintKind.Horizontal]);
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("drops a directed dimension a turn takes the geometry off the axis of", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const horizontal = solver.addConstraint({
                kind: ConstraintKind.HorizontalDistance,
                refs: lineRefs(line),
                datum: 4,
            });

            const result = transformEntities(
                solver,
                [line],
                baseOf(solver, [line]),
                move({ angle: HALF_PI }),
            );

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toContain(horizontal);
            expect(constraintIds(solver)).not.toContain(horizontal);
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a tie to the datum a turn about it still satisfies", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            // the start sits on the sketch's own origin, which is what the turn is about
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: line, pointIndex: 0 }, originRef()],
            });

            const result = transformEntities(solver, [line], [0, 0], move({ angle: HALF_PI }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toEqual([]);
            expect(solver.diagnose().conflicting).toEqual([]);
            // the pinned end did not move, and the line turned about it
            nearPoint(entity(solver, line).params, [0, 0]);
            nearPoint(entity(solver, line).params.slice(2), [0, 4]);
        } finally {
            solver.dispose();
        }
    });

    test("scales a circle and drops the radius dimension the new size contradicts", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 3);
            const radius = solver.addConstraint({
                kind: ConstraintKind.Radius,
                refs: [centerRef(circle)],
                datum: 3,
            });

            const result = transformEntities(solver, [circle], baseOf(solver, [circle]), move({ scale: 2 }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toContain(radius);
            expect(constraintIds(solver)).not.toContain(radius);
            near(entity(solver, circle).params[2], 6);
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("drops a Fix that pins a point the transform moves", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const pin = solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [{ entityId: line, pointIndex: 0 }],
                datums: [0, 0],
            });

            const result = transformEntities(solver, [line], baseOf(solver, [line]), move({ du: 10 }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toContain(pin);
            expect(solver.diagnose().conflicting).toEqual([]);
            const params = entity(solver, line).params;
            near(params[0], 10);
            near(params[2], 14);
        } finally {
            solver.dispose();
        }
    });

    test("carries an unselected entity along when a coincidence ties it to the move", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const moved = solver.addLine(0, 0, 2, 0);
            const tied = solver.addLine(2, 0, 4, 0);
            // the shared corner: moved's end sits on tied's start
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: moved, pointIndex: 1 },
                    { entityId: tied, pointIndex: 0 },
                ],
            });

            const result = transformEntities(solver, [moved], baseOf(solver, [moved]), move({ dv: 5 }));

            expect(result.isOk).toBe(true);
            // nothing was dropped: the coincidence is not the moved line's alone to keep
            expect(result.isOk && result.value.removedConstraintIds).toEqual([]);
            const movedParams = entity(solver, moved).params;
            const tiedParams = entity(solver, tied).params;
            // the coincidence still holds: the solver carried the neighbour rather than break it,
            // and where it settled it is the solver's answer, not the transform's
            near(movedParams[2], tiedParams[0]);
            near(movedParams[3], tiedParams[1]);
            expect(tiedParams[1]).toBeGreaterThan(0);
        } finally {
            solver.dispose();
        }
    });

    test("moves construction geometry and leaves its flag alone", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 3, 0);
            solver.setConstruction(line, true);

            const result = transformEntities(solver, [line], baseOf(solver, [line]), move({ du: 2, dv: 2 }));

            expect(result.isOk).toBe(true);
            expect(solver.isConstruction(line)).toBe(true);
            expect(solver.entities()).toHaveLength(1);
            nearPoint(entity(solver, line).params, [2, 2]);
        } finally {
            solver.dispose();
        }
    });

    test("leaves a conflict the sketch already had alone, and reports none of it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const broken = solver.addLine(0, 0, 8, 0);
            const first = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(broken),
                datum: 10,
            });
            const second = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(broken),
                datum: 12,
            });
            const line = solver.addLine(0, 5, 4, 5);

            const result = transformEntities(solver, [line], baseOf(solver, [line]), move({ du: 3 }));

            // the move is not the conflict's author: nothing of it is dropped, forgotten or
            // counted, and a sketch that came in broken is not the transform's failure either
            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toEqual([]);
            expect(constraintIds(solver)).toContain(first);
            expect(constraintIds(solver)).toContain(second);
            expect(solver.diagnose().conflicting).toEqual([first, second]);
            nearPoint(entity(solver, line).params, [3, 5]);
        } finally {
            solver.dispose();
        }
    });

    test("still drops what the move breaks when the sketch was already broken", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const broken = solver.addLine(0, 0, 8, 0);
            const first = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(broken),
                datum: 10,
            });
            const second = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(broken),
                datum: 12,
            });
            const moved = solver.addLine(0, 5, 4, 5);
            const pin = solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [{ entityId: moved, pointIndex: 0 }],
                datums: [0, 5],
            });

            // the Fix lives wholly inside the moved set, so the move takes it — that drop is
            // the move's own doing and is reported, broken baseline or no; the pair the
            // sketch already had is neither dropped nor counted
            const result = transformEntities(solver, [moved], baseOf(solver, [moved]), move({ du: 10 }));

            expect(result.isOk).toBe(true);
            expect(result.isOk && result.value.removedConstraintIds).toEqual([pin]);
            expect(constraintIds(solver)).toContain(first);
            expect(constraintIds(solver)).toContain(second);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a scale of zero or below, leaving the sketch untouched", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 3);
            const before = JSON.stringify(solver.toData());

            const result = transformEntities(solver, [circle], [0, 0], move({ scale: 0 }));

            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a transform that changes nothing", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            const before = JSON.stringify(solver.toData());

            const result = transformEntities(solver, [line], [2, 0], move());

            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("refuses an empty selection", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            solver.addLine(0, 0, 4, 0);
            const before = JSON.stringify(solver.toData());

            const result = transformEntities(solver, [], [0, 0], move({ du: 1 }));

            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a scale that would collapse a radius", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 3);
            const before = JSON.stringify(solver.toData());

            const result = transformEntities(solver, [circle], [0, 0], move({ scale: 1e-9 }));

            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });
});

describe("isIdentityTransform", () => {
    test("is true only when every part of the transform is a no-op", () => {
        expect(isIdentityTransform(move())).toBe(true);
        expect(isIdentityTransform(move({ du: 1 }))).toBe(false);
        expect(isIdentityTransform(move({ angle: HALF_PI }))).toBe(false);
        expect(isIdentityTransform(move({ scale: 2 }))).toBe(false);
    });
});

describe("transformPreview", () => {
    test("shows the params the op would write, and moves nothing", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(2, 2, 3);
            const base = baseOf(solver, [circle]);
            const transform = move({ angle: HALF_PI, scale: 2 });
            const before = JSON.stringify(solver.toData());

            const preview = transformPreview(solver, [circle], base, transform);
            expect(JSON.stringify(solver.toData())).toBe(before);

            const result = transformEntities(solver, [circle], base, transform);
            expect(result.isOk).toBe(true);
            expect(preview).toHaveLength(1);
            expect(preview[0].id).toBe(circle);
            nearPoint(entity(solver, circle).params, preview[0].params);
            near(entity(solver, circle).params[2], preview[0].params[2]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps the construction flag on a previewed copy", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 3, 0);
            solver.setConstruction(line, true);

            const preview = transformPreview(solver, [line], [0, 0], move({ du: 1 }));

            expect(preview[0].construction).toBe(true);
        } finally {
            solver.dispose();
        }
    });
});
