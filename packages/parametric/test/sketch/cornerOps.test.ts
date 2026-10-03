// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type EvaluatedValue, LENGTH_UNITS, Plane, type Scope } from "@chili3d/core";
import { applyCornerOps, findCorners, type SketchCorner } from "../../src/sketch/cornerOps";
import {
    arcAngles,
    ConstraintKind,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const TOLERANCE = 1e-6;

const length = (value: number): EvaluatedValue => ({ value, unit: LENGTH_UNITS });
const scopeOf = (entries: Record<string, EvaluatedValue>): Scope => new Map(Object.entries(entries));

/** Horizontal (0,0)→(10,0) meeting vertical (0,0)→(0,y2) at the origin, joined by a coincidence. */
function rightAngleSolver(y2 = 10) {
    const solver = new SketchSolver(Plane.XY);
    const horizontal = solver.addLine(0, 0, 10, 0);
    const vertical = solver.addLine(0, 0, 0, y2);
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: horizontal, pointIndex: 0 },
            { entityId: vertical, pointIndex: 0 },
        ],
    });
    return { solver, horizontal, vertical };
}

/** A 10×10 rectangle of four lines, each pair of neighbours joined by a coincidence. */
function rectangleSolver() {
    const solver = new SketchSolver(Plane.XY);
    const bottom = solver.addLine(0, 0, 10, 0);
    const right = solver.addLine(10, 0, 10, 10);
    const top = solver.addLine(10, 10, 0, 10);
    const left = solver.addLine(0, 10, 0, 0);
    const corners: [number, number, number, number][] = [
        [bottom, 1, right, 0],
        [right, 1, top, 0],
        [top, 1, left, 0],
        [left, 1, bottom, 0],
    ];
    for (const [a, ai, b, bi] of corners) {
        solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [ref(a, ai), ref(b, bi)] });
    }
    return { solver, lines: [bottom, right, top, left] };
}

function cornerOf(solver: SketchSolver, line1: number, line2: number): SketchCorner {
    const found = findCorners(solver, [line1, line2], TOLERANCE);
    expect(found.isOk).toBe(true);
    expect(found.value.length).toBe(1);
    return found.value[0];
}

function arcEntity(solver: SketchSolver): SketchEntityData {
    const arcs = solver.entities().filter((e) => e.type === "arc");
    expect(arcs.length).toBe(1);
    return arcs[0];
}

function kindsOf(solver: SketchSolver, kind: ConstraintKind): number {
    return solver.toData().constraints.filter((c) => c.kind === kind).length;
}

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** Distance from a point to the infinite line an entity's params describe. */
function distanceToLine(center: [number, number], params: number[]): number {
    const [x1, y1, x2, y2] = params;
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.abs(dx * (center[1] - y1) - dy * (center[0] - x1)) / Math.hypot(dx, dy);
}

/** What a fillet must keep true: arc radius and tangency to both trimmed lines. */
function filletInvariants(solver: SketchSolver, line1: number, line2: number, arc: number) {
    const params = solver.entity(arc)!.params;
    const center: [number, number] = [params[0], params[1]];
    return {
        radius: Math.hypot(params[2] - params[0], params[3] - params[1]),
        toLine1: distanceToLine(center, solver.entity(line1)!.params),
        toLine2: distanceToLine(center, solver.entity(line2)!.params),
    };
}

describe("findCorners", () => {
    test("finds the shared endpoint and both far ends", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            expect(cornerOf(solver, horizontal, vertical)).toEqual({
                line1: horizontal,
                line2: vertical,
                ref1: ref(horizontal, 0),
                ref2: ref(vertical, 0),
                far1: ref(horizontal, 1),
                far2: ref(vertical, 1),
                jointIds: [1],
            });
        } finally {
            solver.dispose();
        }
    });

    test("is empty for lines that share no endpoint", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const a = solver.addLine(0, 0, 10, 0);
            const b = solver.addLine(0, 5, 10, 5);
            const found = findCorners(solver, [a, b], TOLERANCE);
            expect(found.isOk).toBe(true);
            expect(found.value).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("falls back to geometry when the lines were never constrained together", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const a = solver.addLine(0, 0, 10, 0);
            const b = solver.addLine(0, 0, 0, 10);
            const found = findCorners(solver, [a, b], TOLERANCE);
            expect(found.isOk).toBe(true);
            expect(found.value.length).toBe(1);
            expect(found.value[0].jointIds).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a corner that joins a third entity", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            const third = solver.addLine(0, 0, -5, -5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(horizontal, 0), ref(third, 0)],
            });
            const found = findCorners(solver, [horizontal, vertical], TOLERANCE);
            expect(found.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });

    // The same junction, but on the corner's *other* endpoint and with nothing holding
    // the two lines together: the corner comes from the geometry, so the two refs are in
    // separate coincident groups and the trim would drag the third line along.
    test("refuses a positional corner whose other endpoint joins a third entity", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const a = solver.addLine(0, 0, 10, 0);
            const b = solver.addLine(0, 0, 0, 10);
            const third = solver.addLine(0, 0, -5, -5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(b, 0), ref(third, 0)],
            });
            const found = findCorners(solver, [a, b], TOLERANCE);
            expect(found.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("applyCornerOps fillet", () => {
    test("rounds the corner: tangent arc, trimmed lines and the driving constraints", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            const result = applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                method: "fillet",
                radius: 2,
            });
            expect(result.isOk).toBe(true);

            const arc = arcEntity(solver);
            // right angle, r = 2: center (2,2), tangent points (2,0) and (0,2)
            expect(arc.params[0]).toBeCloseTo(2, 6);
            expect(arc.params[1]).toBeCloseTo(2, 6);
            const radius = Math.hypot(arc.params[2] - arc.params[0], arc.params[3] - arc.params[1]);
            expect(radius).toBeCloseTo(2, 6);

            // both lines are cut back to their tangent points
            expect(solver.entity(horizontal)!.params[0]).toBeCloseTo(2, 6);
            expect(solver.entity(horizontal)!.params[1]).toBeCloseTo(0, 6);
            expect(solver.entity(vertical)!.params[0]).toBeCloseTo(0, 6);
            expect(solver.entity(vertical)!.params[1]).toBeCloseTo(2, 6);

            expect(kindsOf(solver, ConstraintKind.P2PCoincident)).toBe(2);
            expect(kindsOf(solver, ConstraintKind.TangentLineArc)).toBe(2);
            expect(kindsOf(solver, ConstraintKind.Radius)).toBe(1);
            expect(kindsOf(solver, ConstraintKind.PointOnArc)).toBe(1);
        } finally {
            solver.dispose();
        }
    });

    test.each([
        { name: "the second side turns counter-clockwise", y2: 10 },
        { name: "the second side turns clockwise", y2: -10 },
    ])("$name — the arc is the minor sweep π−θ", ({ y2 }) => {
        const { solver, horizontal, vertical } = rightAngleSolver(y2);
        try {
            const result = applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                method: "fillet",
                radius: 2,
            });
            expect(result.isOk).toBe(true);

            const [cx, cy, sx, sy, ex, ey] = arcEntity(solver).params;
            const [, sweep] = arcAngles([cx, cy, sx, sy, ex, ey]);
            // θ = 90°, so the fillet arc sweeps π−θ = π/2, never π+θ
            expect(sweep).toBeCloseTo(Math.PI / 2, 6);
        } finally {
            solver.dispose();
        }
    });

    // The fillet's constraint set is DOF-neutral: two corner endpoints are freed and
    // six arc params + eight equations arrive in their place, so a filleted corner
    // must read the same six DOF the bare corner did — with no constraint flagged as
    // redundant. Both used to fail here: at the exactly-solved tangent configuration
    // the whole fillet came back redundant with the DOF over-counted by two, and only
    // cleared once the geometry was dragged (the singular-point recheck in garlic's
    // `diagnose` is what fixed it; see its `tests/fillet_redundant.rs`).
    test("flags nothing, and reads the same DOF as the bare corner", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            solver.solve(true);
            const bare = solver.diagnose().dofs;

            expect(
                applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                    method: "fillet",
                    radius: 2,
                }).isOk,
            ).toBe(true);
            solver.solve(true);

            // Nothing about a freshly built fillet is redundant: at the exactly-solved
            // tangent configuration garlic used to flag every one of its constraints
            // (and only dragging the geometry cleared them), which is what put the amber
            // "redundant" badges on a brand-new fillet. The DOF is the same six the bare
            // corner has — a fillet swaps the corner joint for the arc without changing
            // how freely the sketch can move.
            const diagnostics = solver.diagnose();
            expect(diagnostics.redundant).toEqual([]);
            expect(diagnostics.conflicting).toEqual([]);
            expect(diagnostics.dofs).toBe(bare);
        } finally {
            solver.dispose();
        }
    });

    // Rigidity is asserted through the geometry as well: the invariants must survive an
    // arbitrary perturbation, which is the property the DOF count is meant to capture.
    test("stays tangent and keeps its radius when the geometry is perturbed", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            expect(
                applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                    method: "fillet",
                    radius: 2,
                }).isOk,
            ).toBe(true);
            solver.solve(true);

            // throw the centre far off and let the solver put it back
            const arc = arcEntity(solver);
            solver.setPointPosition(ref(arc.id, 0), 7, 9);
            expect(["Ok", "OkUnderconstrained"]).toContain(solver.solve(true).result);

            const invariants = filletInvariants(solver, horizontal, vertical, arc.id);
            expect(invariants.radius).toBeCloseTo(2, 6);
            expect(invariants.toLine1).toBeCloseTo(2, 6);
            expect(invariants.toLine2).toBeCloseTo(2, 6);
        } finally {
            solver.dispose();
        }
    });

    test("follows its radius dimension when it is edited", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            expect(
                applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                    method: "fillet",
                    radius: 2,
                }).isOk,
            ).toBe(true);
            const radiusConstraint = solver
                .toData()
                .constraints.find((c) => c.kind === ConstraintKind.Radius)!;
            solver.setDatum(radiusConstraint.id, 3);
            expect(["Ok", "OkUnderconstrained"]).toContain(solver.solve(true).result);

            const arc = arcEntity(solver);
            const invariants = filletInvariants(solver, horizontal, vertical, arc.id);
            expect(invariants.radius).toBeCloseTo(3, 6);
            expect(invariants.toLine1).toBeCloseTo(3, 6);
            expect(invariants.toLine2).toBeCloseTo(3, 6);
        } finally {
            solver.dispose();
        }
    });

    test("rounds every corner of a rectangle in one batch", () => {
        const { solver, lines } = rectangleSolver();
        try {
            const found = findCorners(solver, lines, TOLERANCE);
            expect(found.isOk).toBe(true);
            expect(found.value.length).toBe(4);

            const result = applyCornerOps(solver, found.value, { method: "fillet", radius: 1 });
            expect(result.isOk).toBe(true);
            expect(solver.entities().filter((e) => e.type === "arc").length).toBe(4);
            expect(kindsOf(solver, ConstraintKind.Radius)).toBe(4);
            expect(solver.solve(true).result).not.toBe("Conflicting");
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    // A filleted corner leaves a `TangentLineArc` on each of its two lines, and that
    // row's line endpoints include the *far* corner of each — precisely the point a
    // later fillet trims. The pre-flight used to refuse it, so a profile could only be
    // rounded one pass at a time (round two corners, end the command, round a third →
    // "the corner carries a TangentLineArc constraint that the trim would break").
    // Tangency measures the distance to the line's infinite extent, which cutting the
    // line short along itself leaves alone.
    test("rounds a rectangle over two passes, keeping the first arcs tangent", () => {
        const { solver, lines } = rectangleSolver();
        try {
            const first = findCorners(solver, lines.slice(0, 3), TOLERANCE, "fillet");
            expect(first.isOk).toBe(true);
            expect(first.value.length).toBe(2);
            expect(applyCornerOps(solver, first.value, { method: "fillet", radius: 1 }).isOk).toBe(true);
            solver.solve(true);

            const second = findCorners(solver, lines.slice(2), TOLERANCE, "fillet");
            expect(second.isOk).toBe(true);
            expect(second.value.length).toBe(1);
            expect(applyCornerOps(solver, second.value, { method: "fillet", radius: 1 }).isOk).toBe(true);
            solver.solve(true);

            const arcs = solver.entities().filter((e) => e.type === "arc");
            expect(arcs.length).toBe(3);
            for (const arc of arcs) {
                const center: [number, number] = [arc.params[0], arc.params[1]];
                const radius = Math.hypot(arc.params[2] - center[0], arc.params[3] - center[1]);
                expect(radius).toBeCloseTo(1, 6);
                // still tangent to exactly two of the four edges, the later trim included
                const tangent = lines.filter(
                    (id) => Math.abs(distanceToLine(center, solver.entity(id)!.params) - 1) < 1e-6,
                );
                expect(tangent.length).toBe(2);
            }
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("rejects a radius that does not fit and leaves the sketch untouched", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            const corner = cornerOf(solver, horizontal, vertical);
            const before = JSON.stringify(solver.toData());
            const result = applyCornerOps(solver, [corner], { method: "fillet", radius: 20 });
            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("rejects a corner that carries a dimension", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(horizontal, 0), ref(horizontal, 1)],
                datum: 10,
            });
            const found = findCorners(solver, [horizontal, vertical], TOLERANCE);
            expect(found.isOk).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("applyCornerOps chamfer", () => {
    test("cuts the corner: connecting line, trimmed edges and the driving lengths", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            const result = applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                method: "chamfer",
                distance: 3,
            });
            expect(result.isOk).toBe(true);

            const lines = solver.entities().filter((e) => e.type === "line");
            expect(lines.length).toBe(3);
            const chamfer = lines.find((e) => e.id !== horizontal && e.id !== vertical)!;
            // (3,0) → (0,3)
            expect(chamfer.params[0]).toBeCloseTo(3, 6);
            expect(chamfer.params[1]).toBeCloseTo(0, 6);
            expect(chamfer.params[2]).toBeCloseTo(0, 6);
            expect(chamfer.params[3]).toBeCloseTo(3, 6);

            // the trimmed edges keep their new lengths as driving dimensions
            expect(solver.entity(horizontal)!.params[0]).toBeCloseTo(3, 6);
            expect(solver.entity(vertical)!.params[1]).toBeCloseTo(3, 6);
            // two trimmed lengths and the chamfer's own span, which is the one that
            // stops the two cut ends from pulling apart
            expect(kindsOf(solver, ConstraintKind.P2PDistance)).toBe(3);
            expect(kindsOf(solver, ConstraintKind.P2PCoincident)).toBe(2);
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    // The same cross-pass case as the fillet above, one step further along: a chamfer
    // leaves a length dimension on each edge it cuts, and that dimension is a blocker
    // for a *fillet* (nothing would re-dimension it) but not for another chamfer, which
    // re-dimensions the edge as it trims. So the pre-flight lets a chamfer through and
    // the trimmed lengths must come out right across the two passes.
    test("chamfers a rectangle over two passes, re-dimensioning the shared edges", () => {
        const { solver, lines } = rectangleSolver();
        try {
            const first = findCorners(solver, lines.slice(0, 3), TOLERANCE, "chamfer");
            expect(first.isOk).toBe(true);
            expect(applyCornerOps(solver, first.value, { method: "chamfer", distance: 1 }).isOk).toBe(true);
            solver.solve(true);

            const second = findCorners(solver, lines.slice(2), TOLERANCE, "chamfer");
            expect(second.isOk).toBe(true);
            expect(applyCornerOps(solver, second.value, { method: "chamfer", distance: 1 }).isOk).toBe(true);
            solver.solve(true);

            const spanOf = (id: number) => {
                const p = solver.entity(id)!.params;
                return Math.hypot(p[2] - p[0], p[3] - p[1]);
            };
            // bottom and left meet one cut (10−1), right and top meet two (10−2)
            expect(spanOf(lines[0])).toBeCloseTo(9, 6);
            expect(spanOf(lines[1])).toBeCloseTo(8, 6);
            expect(spanOf(lines[2])).toBeCloseTo(8, 6);
            expect(spanOf(lines[3])).toBeCloseTo(9, 6);
            // four edges + three cuts, each with exactly one dimension
            expect(solver.entities().filter((e) => e.type === "line").length).toBe(7);
            expect(kindsOf(solver, ConstraintKind.P2PDistance)).toBe(7);
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    // Every line of a rectangle belongs to two corners, so a batch trims each of them
    // from both ends and the second corner has to re-dimension the length the first
    // one pinned. Rejecting that repeat instead rolled the whole batch back — a
    // fillet-and-four-corners sketch looked fine while the chamfer silently did nothing.
    test("cuts every corner of a rectangle in one batch", () => {
        const { solver, lines } = rectangleSolver();
        try {
            const found = findCorners(solver, lines, TOLERANCE);
            expect(found.isOk).toBe(true);
            expect(found.value.length).toBe(4);

            const result = applyCornerOps(solver, found.value, { method: "chamfer", distance: 2 });
            expect(result.isOk).toBe(true);

            // four originals plus four chamfer lines: one length dim per original
            // (shared lines are re-dimensioned, not doubled) and one span per chamfer
            const all = solver.entities().filter((e) => e.type === "line");
            expect(all.length).toBe(8);
            expect(kindsOf(solver, ConstraintKind.P2PDistance)).toBe(8);
            expect(kindsOf(solver, ConstraintKind.P2PCoincident)).toBe(8);
            for (const line of lines) {
                const params = solver.entity(line)!.params;
                expect(Math.hypot(params[2] - params[0], params[3] - params[1])).toBeCloseTo(6, 6);
            }
            for (const line of all.filter((e) => !lines.includes(e.id))) {
                const params = line.params;
                expect(Math.hypot(params[2] - params[0], params[3] - params[1])).toBeCloseTo(
                    2 * Math.SQRT2,
                    6,
                );
            }
            expect(solver.solve(true).result).not.toBe("Conflicting");
            expect(solver.diagnose().conflicting).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("holds its shape when the cuts are pushed around", () => {
        const { solver, lines } = rectangleSolver();
        try {
            const found = findCorners(solver, lines, TOLERANCE);
            expect(applyCornerOps(solver, found.value, { method: "chamfer", distance: 2 }).isOk).toBe(true);
            solver.solve(true);
            const cuts = solver.entities().filter((e) => e.type === "line" && !lines.includes(e.id));
            const spanOf = (id: number) => {
                const p = solver.entity(id)!.params;
                return Math.hypot(p[2] - p[0], p[3] - p[1]);
            };

            // shove one cut end off its corner and let the solver put it back: with the
            // spans pinned every cut must come back to its chamfer length, and the
            // trimmed edges to theirs
            const first = cuts[0].id;
            solver.setPointPosition(
                ref(first, 0),
                solver.entity(first)!.params[0] + 3,
                solver.entity(first)!.params[1] + 3,
            );
            expect(["Ok", "OkUnderconstrained"]).toContain(solver.solve(true).result);
            for (const cut of cuts) expect(spanOf(cut.id)).toBeCloseTo(2 * Math.SQRT2, 6);
            for (const line of lines) expect(spanOf(line)).toBeCloseTo(6, 6);
        } finally {
            solver.dispose();
        }
    });

    test("rejects a distance that does not fit and leaves the sketch untouched", () => {
        const { solver, horizontal, vertical } = rightAngleSolver();
        try {
            const before = JSON.stringify(solver.toData());
            const result = applyCornerOps(solver, [cornerOf(solver, horizontal, vertical)], {
                method: "chamfer",
                distance: 30,
            });
            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    // Two collinear lines meet at 180°, which reads as a corner only because they share
    // an endpoint. Cutting it would lay the connecting segment back along the geometry
    // already there — a fillet refuses this, and a chamfer must too.
    test("rejects two collinear lines and leaves the sketch untouched", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const a = solver.addLine(0, 0, 10, 0);
            const b = solver.addLine(0, 0, -10, 0);
            const before = JSON.stringify(solver.toData());
            const result = applyCornerOps(solver, [cornerOf(solver, a, b)], {
                method: "chamfer",
                distance: 2,
            });
            expect(result.isOk).toBe(false);
            expect(JSON.stringify(solver.toData())).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    // A chamfer re-dimensions the edge it trims, which is fine for a literal but would
    // overwrite the user's formula with a plain number.
    test("rejects an edge whose length is written as an expression", () => {
        const solver = new SketchSolver(Plane.XY, undefined, scopeOf({ w: length(20) }));
        try {
            const horizontal = solver.addLine(0, 0, 10, 0);
            const vertical = solver.addLine(0, 0, 0, 10);
            const dim = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(horizontal, 0), ref(horizontal, 1)],
                datum: 10,
            });
            expect(solver.setDatumSource(dim, "w / 2").isOk).toBe(true);

            const found = findCorners(solver, [horizontal, vertical], TOLERANCE, "chamfer");
            expect(found.isOk).toBe(false);
            // the formula is untouched, not replaced by the 8 the cut would leave
            expect(solver.toData().constraints.find((c) => c.id === dim)?.datum).toBe("w / 2");
        } finally {
            solver.dispose();
        }
    });
});
