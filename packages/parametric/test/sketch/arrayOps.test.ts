// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EMPTY_SCOPE, Plane } from "@chili3d/core";
import {
    arrayInstanceTotal,
    arrayPreview,
    instanceIndexOf,
    liveInstanceIds,
    MAX_ARRAY_COUNT,
    type ResolvedArray,
    resolveArray,
} from "../../src/sketch/arrayOps";
import {
    ConstraintKind,
    originRef,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    type SketchArrayCenter,
    type SketchArrayPattern,
    type SketchEntityData,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const DEGREE = Math.PI / 180;

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

function entity(solver: SketchSolver, id: number): SketchEntityData {
    const data = solver.entity(id);
    if (data === undefined) throw new Error(`no entity ${id}`);
    return data;
}

/** Every point of every generated instance, in instance order — what the cases assert on. */
function instancePoints(solver: SketchSolver, ids: readonly number[]): [number, number][][] {
    return ids.map((id) => solver.entityPoints(id));
}

function resolved(
    solver: SketchSolver,
    pattern: SketchArrayPattern,
    sourceIds: readonly number[] = [],
): ResolvedArray {
    const result = resolveArray(solver, pattern, sourceIds, EMPTY_SCOPE);
    if (!result.isOk) throw new Error(result.error);
    return result.value;
}

function errorOf(solver: SketchSolver, pattern: SketchArrayPattern): string {
    const result = resolveArray(solver, pattern, [], EMPTY_SCOPE);
    if (result.isOk) throw new Error("expected the array to be refused");
    return result.error;
}

/**
 * A pattern along the sketch's own two axes. The cases that read one direction only leave the
 * second at a single instance, which is what "this direction lays down nothing" means.
 */
function linear(
    spacing: number,
    count: number,
    second: { count: number; spacing: number } = { count: 1, spacing: 0 },
): SketchArrayPattern {
    return { type: "linear", x: { count, spacing }, y: second };
}

/** A turn about a centre — the sketch's own origin unless a case names another. */
function circular(
    twist: number,
    count: number,
    equalSpacing: boolean,
    center: SketchArrayCenter = { type: "ref", ref: originRef() },
): SketchArrayPattern {
    return { type: "circular", center, count, twist, equalSpacing };
}

function curve(curveId: number, spacing: number, count: number): SketchArrayPattern {
    return { type: "curve", curveId, count, spacing };
}

/** A sketch with one line and one circle, both off the origin, so a pattern has somewhere to go. */
function solverWithGeometry(): { solver: SketchSolver; lineId: number; circleId: number } {
    const solver = new SketchSolver(Plane.XY);
    return { solver, lineId: solver.addLine(0, 0, 10, 0), circleId: solver.addCircle(20, 0, 2) };
}

describe("resolveArray", () => {
    test("lays a linear pattern out along the sketch's own X axis", () => {
        const { solver } = solverWithGeometry();
        const pattern = linear(5, 4);
        const placements = resolved(solver, pattern).placements;
        expect(placements.map((placement) => placement.index)).toEqual([1, 2, 3]);
        near(placements[0].transform.du, 5);
        near(placements[2].transform.du, 15);
        // a linear pattern only ever shifts: nothing about the seed turns
        expect(placements[1].transform.dv).toBe(0);
        expect(placements[1].transform.angle).toBe(0);
        expect(placements[1].transform.scale).toBe(1);
    });

    test("takes a negative spacing as running the other way", () => {
        const { solver } = solverWithGeometry();
        const placements = resolved(solver, linear(-5, 3)).placements;
        near(placements[0].transform.du, -5);
        near(placements[1].transform.du, -10);
    });

    test("fills a grid when the second direction has instances of its own", () => {
        const { solver, lineId } = solverWithGeometry();
        // three along X and two along Y: six instances, the seed among them
        const placements = resolved(solver, linear(10, 3, { count: 2, spacing: 7 }), [lineId]).placements;
        expect(placements.map((placement) => placement.index)).toEqual([1, 2, 3, 4, 5]);
        // instance k is (i, j) with i = k % x.count and j = k / x.count — a row at a time
        expect(placements.map((placement) => [placement.transform.du, placement.transform.dv])).toEqual([
            [10, 0],
            [20, 0],
            [0, 7],
            [10, 7],
            [20, 7],
        ]);
    });

    test("lays nothing along a direction that asks for a single instance", () => {
        const { solver, lineId } = solverWithGeometry();
        // a count of one is "this direction lays down nothing", so its spacing is not even
        // read — and the seed is instance 0, so three in all is two placements
        const placements = resolved(solver, linear(10, 1, { count: 3, spacing: 7 }), [lineId]).placements;
        expect(placements.map((placement) => [placement.transform.du, placement.transform.dv])).toEqual([
            [0, 7],
            [0, 14],
        ]);
    });

    test("spreads an even circular pattern over the whole turn", () => {
        const { solver } = solverWithGeometry();
        const pattern = circular(360, 4, true);
        const placements = resolved(solver, pattern).placements;
        near(placements[0].transform.angle, 90 * DEGREE);
        near(placements[1].transform.angle, 180 * DEGREE);
        // the last instance closes the ring: three quarters of the way round, not all of it
        near(placements[2].transform.angle, 270 * DEGREE);
        expect(resolved(solver, pattern).base).toEqual([0, 0]);
    });

    test("lands the last instance on the asked-for turn without even spacing", () => {
        const { solver } = solverWithGeometry();
        const pattern = circular(90, 4, false);
        const placements = resolved(solver, pattern).placements;
        near(placements[0].transform.angle, 30 * DEGREE);
        near(placements[2].transform.angle, 90 * DEGREE);
    });

    test("pivots a circular pattern about the picked centre", () => {
        const { solver, circleId } = solverWithGeometry();
        const pattern = circular(180, 2, false, { type: "ref", ref: { entityId: circleId, pointIndex: 0 } });
        expect(resolved(solver, pattern).base).toEqual([20, 0]);
    });

    test("follows a curve, turning the seed onto its tangent", () => {
        const { solver, circleId } = solverWithGeometry();
        // a quarter arc of radius 10 about the origin, from (10,0) to (0,10). The seed
        // circle sits at (20,0), whose own angle about the centre is 0, so it walks the arc
        // from its start — spacing 2.5π of arc length is a 45° step at that radius
        const arcId = solver.addArc(0, 0, 10, 0, 0, 10);
        const placements = resolved(solver, curve(arcId, Math.PI * 2.5, 3), [circleId]).placements;
        near(placements[0].transform.angle, 45 * DEGREE);
        near(placements[1].transform.angle, 90 * DEGREE);
        // the seed's own centre sits at (20, 0) — ten clear of the arc — and the instance
        // carries that offset along rather than swinging onto the arc: 45° round the run is
        // 20 out at 45°, the seed's own radius, not the arc's 10
        const half = Math.PI / 4;
        near(placements[0].transform.du, 20 * Math.cos(half) - 20);
        near(placements[0].transform.dv, 20 * Math.sin(half));
        expect(Math.hypot(20 + placements[0].transform.du, placements[0].transform.dv)).toBeCloseTo(20, 9);
    });

    test("carries each direction's numbers, and the run they are taken along", () => {
        const { solver, lineId } = solverWithGeometry();
        // a direction reads as its spacing and its count, and walks the line between them: the
        // seed's own centre is (5, 0), three at 20 apart puts the last one at (45, 0)
        const straight = resolved(solver, linear(20, 3), [lineId]);
        expect(straight.runs).toHaveLength(1);
        expect(straight.runs[0].spacing).toMatchObject({ field: "spacingX", value: 20, measure: "length" });
        expect(straight.runs[0].count).toMatchObject({ field: "countX", value: 3 });
        // the spacing reads halfway to the *first* copy, and the count at the far end
        expect(straight.runs[0].spacing.at).toEqual([15, 0]);
        expect(straight.runs[0].count.at).toEqual([45, 0]);
        expect(straight.runs[0].path).toEqual([
            [5, 0],
            [45, 0],
        ]);

        // a second direction is a second run, its own two numbers and all
        const grid = resolved(solver, linear(20, 3, { count: 2, spacing: 7 }), [lineId]);
        expect(grid.runs.map((run) => run.spacing.field)).toEqual(["spacingX", "spacingY"]);
        expect(grid.runs[1].count.at).toEqual([5, 7]);

        // a turn reads as the whole angle in degrees, and walks the arc it turns through
        const round = resolved(solver, circular(90, 3, false), [lineId]);
        expect(round.runs[0].spacing).toMatchObject({ field: "twist", value: 90, measure: "angle" });
        // the turn is 90° over two gaps, so one step is 45°: the spacing reads half a step
        // round from the seed, and the count where the last instance landed — a quarter turn
        const radius = 5;
        near(round.runs[0].spacing.at[0], radius * Math.cos(Math.PI / 8));
        near(round.runs[0].spacing.at[1], radius * Math.sin(Math.PI / 8));
        near(round.runs[0].count.at[0], radius * Math.cos(Math.PI / 2));
        near(round.runs[0].count.at[1], radius * Math.sin(Math.PI / 2));

        // a curve reads as its spacing too, and walks the curve rather than the chord. The
        // line's own centre is (5, 0) — five clear of the radius-10 arc — so the run is the
        // radius-5 circle that centre traces, and starts on the seed's own place
        const arcId = solver.addArc(0, 0, 10, 0, 0, 10);
        const along = resolved(solver, curve(arcId, Math.PI * 5, 3), [lineId]);
        expect(along.runs[0].spacing).toMatchObject({ field: "spacing", value: Math.PI * 5 });
        expect(along.runs[0].path[0]).toEqual([5, 0]);
        // the run covers the whole direction — two steps of 5π each is half a turn, so it
        // carries on past the arc's own end (the curve is what is followed, and a curve
        // pattern follows the circle it lies on)
        near(along.runs[0].count.at[0], -5);
        near(along.runs[0].count.at[1], 0);
    });

    test("leaves the runs empty when there is no seed to march from", () => {
        const { solver } = solverWithGeometry();
        // a caller with no geometry in hand gets no run to draw — the placements are shifts,
        // and know nothing of where the seed sits
        const placements = resolved(solver, linear(20, 3)).placements;
        expect(placements.map((placement) => placement.transform.du)).toEqual([20, 40]);
        expect(resolved(solver, linear(20, 3)).runs).toEqual([]);
    });

    test("leaves out the run of a direction that lays down nothing, whichever one it is", () => {
        const { solver, lineId } = solverWithGeometry();
        // the second direction read as an unrun is the ordinary case a fresh pattern opens on;
        // the first is the same statement about the other axis, and it has to read the same —
        // a run drawn for it would put a spacing and a "×1" on the canvas for an axis that
        // places no instance at all
        const across = resolved(solver, linear(20, 1, { count: 3, spacing: 7 }), [lineId]);
        expect(across.runs.map((run) => run.spacing.field)).toEqual(["spacingY"]);
        expect(across.runs[0].count.at).toEqual([5, 14]);
    });

    test("refuses a count outside what a pattern can hold", () => {
        const { solver } = solverWithGeometry();
        // one instance in all is the seed alone, which is not a pattern
        expect(errorOf(solver, linear(5, 1))).toBe("An array needs at least two instances");
        // and the bound is on the *total* the two directions make between them
        expect(errorOf(solver, linear(5, MAX_ARRAY_COUNT, { count: 2, spacing: 5 }))).toBe(
            `An array holds at most ${MAX_ARRAY_COUNT} instances`,
        );
    });

    test("refuses a pattern that would pile its instances on top of each other", () => {
        const { solver } = solverWithGeometry();
        expect(errorOf(solver, linear(0, 3))).toBe("The array spacing is too small to place an instance");
    });

    test("refuses a turn of nothing", () => {
        const { solver } = solverWithGeometry();
        expect(errorOf(solver, circular(0, 3, false))).toBe(
            "The array turn is too small to place an instance",
        );
    });

    test("refuses a curve that is not sketch geometry, or has no length", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.setPointPosition({ entityId: lineId, pointIndex: 1 }, 0, 0);
        expect(errorOf(solver, curve(lineId, 5, 3))).toBe("The array curve is too short to follow");
        expect(errorOf(solver, curve(SKETCH_ORIGIN_ID, 5, 3))).toBe("The array curve is not sketch geometry");
    });
});

describe("arrayPreview", () => {
    test("shows the copies the op would make, in sketch coordinates", () => {
        const { solver, lineId } = solverWithGeometry();
        const solved = resolved(solver, linear(10, 3));
        const preview = arrayPreview(solver, [lineId], solved);
        expect(preview.map((copy) => copy.params)).toEqual([
            [10, 0, 20, 0],
            [20, 0, 30, 0],
        ]);
        // a preview copy answers to its source's id: nothing addresses one, it is only meshed
        expect(preview.every((copy) => copy.id === lineId)).toBe(true);
    });

    test("keeps the seed's construction flag", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.setConstruction(lineId, true);
        const preview = arrayPreview(solver, [lineId], resolved(solver, linear(10, 3)));
        expect(preview.every((copy) => copy.construction === true)).toBe(true);
    });
});

describe("SketchSolver arrays", () => {
    test("lays the instances out as ordinary entities", () => {
        const { solver, lineId } = solverWithGeometry();
        const added = solver.addArray(linear(10, 3), [lineId]);
        expect(added.isOk).toBe(true);
        const [array] = solver.arrays();
        expect(array.sourceIds).toEqual([lineId]);
        expect(arrayInstanceTotal(array.pattern)).toBe(3);
        expect(liveInstanceIds(array)).toHaveLength(2);
        expect(instancePoints(solver, liveInstanceIds(array))).toEqual([
            [
                [10, 0],
                [20, 0],
            ],
            [
                [20, 0],
                [30, 0],
            ],
        ]);
        // the instances are real entities, not solver-only rows
        expect(solver.entities().map((e) => e.id)).toEqual(expect.arrayContaining(liveInstanceIds(array)));
    });

    test("re-derives the instances when the seed moves", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 2), [lineId]);
        const [array] = solver.arrays();
        solver.setPointPosition({ entityId: lineId, pointIndex: 0 }, 0, 5);
        solver.setPointPosition({ entityId: lineId, pointIndex: 1 }, 10, 5);
        solver.solve(true);
        expect(solver.entityPoints(liveInstanceIds(array)[0])).toEqual([
            [10, 5],
            [20, 5],
        ]);
    });

    test("keeps an array's definition and instances across a round trip", () => {
        const { solver, lineId, circleId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        solver.addArray(circular(90, 4, false), [circleId]);
        solver.solve(true);
        const data = solver.toData();
        const reloaded = new SketchSolver(Plane.XY, data);
        expect(reloaded.arrays()).toEqual(solver.arrays());
        expect(reloaded.toData()).toEqual(data);
        const [array] = reloaded.arrays();
        expect(reloaded.entityPoints(liveInstanceIds(array)[0])).toEqual([
            [10, 0],
            [20, 0],
        ]);
    });

    test("re-derives an instance whose stored row drifted from the record", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 2), [lineId]);
        const data = solver.toData();
        // an instance's row is written by the same commit as the record, so the two only drift
        // in a hand-edited document — and the record is what wins when they do
        const instance = data.entities.find((entity) => entity.id === liveInstanceIds(data.arrays![0])[0]);
        expect(instance).toBeDefined();
        instance!.params = [500, 500, 510, 500];

        const reloaded = new SketchSolver(Plane.XY, data);

        expect(reloaded.entityPoints(liveInstanceIds(data.arrays![0])[0])).toEqual([
            [10, 0],
            [20, 0],
        ]);
        // and the drift is gone from what the next commit writes
        expect(reloaded.toData()).toEqual({ ...data, entities: solver.toData().entities });
    });

    test("answers the array an instance belongs to", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 2), [lineId]);
        const [array] = solver.arrays();
        expect(solver.arrayOf(liveInstanceIds(array)[0])?.id).toBe(array.id);
        expect(solver.arrayOf(lineId)).toBeUndefined();
    });

    test("refuses to move, retype or remove an instance by hand", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 2), [lineId]);
        const instanceId = liveInstanceIds(solver.arrays()[0])[0];
        expect(solver.isDerived(instanceId)).toBe(true);
        expect(solver.isFixed(instanceId)).toBe(true);
        expect(() => solver.setPointPosition({ entityId: instanceId, pointIndex: 0 }, 1, 1)).toThrow(
            "An array instance is placed by its array",
        );
        expect(() => solver.removeEntity(instanceId)).toThrow("An array instance is removed with its array");
        expect(solver.retypeEntity(instanceId, "circle", [0, 0, 1], () => undefined).isOk).toBe(false);
    });

    test("counts an instance as placed rather than as a free one", () => {
        const { solver, lineId } = solverWithGeometry();
        const before = solver.dofs();
        const beforeReported = solver.diagnose().dofs;
        solver.addArray(linear(10, 5), [lineId]);
        const instanceId = liveInstanceIds(solver.arrays()[0])[0];
        expect(solver.dofs()).toBe(before);
        // and the count the status bar shows, which reads garlic's own report rather than
        // `dofs()`, agrees with it — a pattern is not four more things to place
        expect(solver.diagnose().dofs).toBe(beforeReported);
        expect(solver.fullyConstrainedEntities().has(instanceId)).toBe(true);
    });

    test("drops the instances of a source that is deleted", () => {
        const { solver, lineId, circleId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId, circleId]);
        const [array] = solver.arrays();
        expect(liveInstanceIds(array)).toHaveLength(4);
        expect(solver.removeEntity(circleId)).toEqual([]);
        const [remaining] = solver.arrays();
        expect(remaining.sourceIds).toEqual([lineId]);
        expect(liveInstanceIds(remaining)).toHaveLength(2);
        const survivor = liveInstanceIds(remaining)[0];
        expect(solver.entityPoints(survivor)).toEqual([
            [10, 0],
            [20, 0],
        ]);
    });

    test("drops the whole array when its last source goes", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        const instanceIds = liveInstanceIds(solver.arrays()[0]);
        solver.removeEntity(lineId);
        expect(solver.arrays()).toEqual([]);
        expect(instanceIds.map((id) => solver.entity(id))).toEqual([undefined, undefined]);
    });

    test("drops the whole array when its reference goes", () => {
        const { solver, lineId } = solverWithGeometry();
        // a turn whose centre is a point of another entity: that entity is what the pattern
        // reads, and losing it leaves the pattern with nothing to turn about
        const anchor = solver.addLine(30, 0, 30, 10);
        const center: SketchArrayCenter = { type: "ref", ref: { entityId: anchor, pointIndex: 0 } };
        solver.addArray(circular(180, 3, false, center), [lineId]);
        const instanceIds = liveInstanceIds(solver.arrays()[0]);
        solver.removeEntity(anchor);
        expect(solver.arrays()).toEqual([]);
        expect(instanceIds.map((id) => solver.entity(id))).toEqual([undefined, undefined]);
    });

    test("keeps the instances' ids when only the count changes", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 4), [lineId]);
        const [array] = solver.arrays();
        const kept = liveInstanceIds(array).slice(0, 2);
        expect(solver.updateArray(array.id, { pattern: linear(20, 3) }).isOk).toBe(true);
        expect(liveInstanceIds(solver.arrays()[0])).toEqual(kept);
    });

    test("removes the array when the count drops to the seed alone", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        const id = solver.arrays()[0].id;
        expect(solver.updateArray(id, { pattern: linear(10, 1) }).isOk).toBe(true);
        expect(solver.arrays()).toEqual([]);
    });

    test("re-lays a pattern whose source list changed", () => {
        const { solver, lineId, circleId } = solverWithGeometry();
        solver.addArray(linear(10, 2), [lineId]);
        const id = solver.arrays()[0].id;
        expect(solver.updateArray(id, { sourceIds: [lineId, circleId] }).isOk).toBe(true);
        expect(solver.arrays()[0].sourceIds).toEqual([lineId, circleId]);
        expect(liveInstanceIds(solver.arrays()[0])).toHaveLength(2);
        expect(solver.entityPoints(liveInstanceIds(solver.arrays()[0])[1])).toEqual([[30, 0]]);
    });

    test("refuses to pattern the datum, an external ref, or an instance", () => {
        const { solver, lineId } = solverWithGeometry();
        expect(solver.addArray(linear(10, 3), [SKETCH_X_AXIS_ID]).isOk).toBe(false);
        solver.addArray(linear(10, 2), [lineId]);
        const instanceId = liveInstanceIds(solver.arrays()[0])[0];
        expect(solver.addArray(linear(10, 2), [instanceId]).isOk).toBe(false);
    });

    test("removes an array on request, taking its instances with it", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        const { id } = solver.arrays()[0];
        const instanceEntityIds = liveInstanceIds(solver.arrays()[0]);
        solver.removeArray(id);
        expect(solver.arrays()).toEqual([]);
        expect(instanceEntityIds.map((entityId) => solver.isDerived(entityId))).toEqual([false, false]);
        expect(instanceEntityIds.map((entityId) => solver.entity(entityId))).toEqual([undefined, undefined]);
        expect(entity(solver, lineId).params).toEqual([0, 0, 10, 0]);
    });
});

describe("SketchSolver dissolving an array", () => {
    /** A square drawn the way the tool draws it: four lines, joined at the corners. */
    function squareWithRelations(solver: SketchSolver): number[] {
        const corners: [number, number][] = [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ];
        const lines = corners.map((corner, index) => {
            const next = corners[(index + 1) % corners.length];
            return solver.addLine(corner[0], corner[1], next[0], next[1]);
        });
        for (let index = 0; index < lines.length; index++) {
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: lines[index], pointIndex: 1 },
                    { entityId: lines[(index + 1) % lines.length], pointIndex: 0 },
                ],
            });
        }
        solver.addConstraint({
            kind: ConstraintKind.Horizontal,
            refs: [
                { entityId: lines[0], pointIndex: 0 },
                { entityId: lines[0], pointIndex: 1 },
            ],
        });
        solver.addConstraint({
            kind: ConstraintKind.Vertical,
            refs: [
                { entityId: lines[1], pointIndex: 0 },
                { entityId: lines[1], pointIndex: 1 },
            ],
        });
        return lines;
    }

    test("leaves the copies behind, and tells each of them the seed's own shape relations", () => {
        const solver = new SketchSolver(Plane.XY);
        const seed = squareWithRelations(solver);
        solver.addArray(linear(40, 3), seed);
        solver.solve(true);
        const copies = liveInstanceIds(solver.arrays()[0]);
        const relationsOf = (ids: readonly number[]) =>
            solver
                .toData()
                .constraints.filter((constraint) => constraint.refs.every((r) => ids.includes(r.entityId)));
        // the seed holds six relations of its own: four joins, a horizontal and a vertical
        expect(relationsOf(seed)).toHaveLength(6);
        const before = solver.dofs();

        const added = solver.dissolveArray(solver.arrays()[0].id);

        // one copy's worth of relations, said again about the second copy: 6 × 2
        expect(added).toBe(12);
        expect(solver.arrays()).toEqual([]);
        // every entity stays — the copies are the sketch's own geometry now
        expect(copies.every((id) => solver.entity(id) !== undefined)).toBe(true);
        expect(solver.entities().map((entity) => entity.id)).toEqual(expect.arrayContaining(copies));
        // each copy carries the seed's structure, remapped onto its own entities
        const second = copies.slice(4, 8);
        expect(relationsOf(second)).toHaveLength(6);
        expect(relationsOf(second).flatMap((c) => c.refs.map((r) => r.entityId))).toEqual(
            expect.arrayContaining(second),
        );
        // the seed's own relations are untouched, and each copy is now free exactly as much
        // as the seed is: a copy *is* the seed's shape, so what the record used to place, the
        // copy has to place for itself
        expect(relationsOf(seed)).toHaveLength(6);
        expect(solver.dofs()).toBe(before * 3);
        // and they are the user's to edit now — nothing refuses them any more
        expect(copies.some((id) => solver.isDerived(id))).toBe(false);
        expect(() => solver.setPointPosition({ entityId: copies[0], pointIndex: 0 }, 1, 1)).not.toThrow();
        solver.dispose();
    });

    test("says nothing to an instance the user had taken out", () => {
        const solver = new SketchSolver(Plane.XY);
        const seed = squareWithRelations(solver);
        solver.addArray(linear(40, 3), seed);
        solver.solve(true);
        const copies = liveInstanceIds(solver.arrays()[0]);
        solver.skipInstance(copies[0]);

        const added = solver.dissolveArray(solver.arrays()[0].id);

        // the second copy is the only one left to tell: a hole has no geometry to hold anything
        expect(added).toBe(6);
        expect(solver.arrays()).toEqual([]);
        expect(solver.entities()).toHaveLength(8);
        solver.dispose();
    });

    test("leaves a dimension out of what it tells the copies", () => {
        const solver = new SketchSolver(Plane.XY);
        const seed = squareWithRelations(solver);
        solver.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs: [
                { entityId: seed[0], pointIndex: 0 },
                { entityId: seed[0], pointIndex: 1 },
            ],
            datum: 10,
        });
        solver.addArray(linear(40, 2), seed);
        solver.solve(true);

        const added = solver.dissolveArray(solver.arrays()[0].id);

        // the size the seed is dimensioned to is a reading of *its* size, not something its
        // copies inherit: six relations, no dimension among them
        expect(added).toBe(6);
        expect(solver.toData().constraints.filter((c) => c.kind === ConstraintKind.P2PDistance)).toHaveLength(
            1,
        );
        solver.dispose();
    });
});

describe("SketchSolver array instances taken out of the pattern", () => {
    test("takes one instance out and leaves the others' identities alone", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 4), [lineId]);
        const before = solver.arrays()[0];
        const [first, second, third] = liveInstanceIds(before);
        expect(instanceIndexOf(before, third)).toBe(3);

        expect(solver.skipInstance(third)).toBe(3);

        // the count is untouched, and the hole is a hole rather than a shift: the instances
        // before and after it keep their own ids *and* their own places
        const after = solver.arrays()[0];
        expect(arrayInstanceTotal(after.pattern)).toBe(4);
        expect(after.instanceEntityIds).toEqual([first, second, null]);
        expect(solver.entity(third)).toBeUndefined();
        expect(solver.entityPoints(first)).toEqual([
            [10, 0],
            [20, 0],
        ]);
        expect(solver.entityPoints(second)).toEqual([
            [20, 0],
            [30, 0],
        ]);
        expect(solver.isDerived(third)).toBe(false);
    });

    test("leaves the hole empty when the count grows past it", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 4), [lineId]);
        const [first, second, third] = liveInstanceIds(solver.arrays()[0]);
        solver.skipInstance(second);
        expect(solver.updateArray(solver.arrays()[0].id, { pattern: linear(10, 5) }).isOk).toBe(true);

        // the new instance lands at the end, where the count asked for it — the space the
        // deleted one left stays empty, which is Onshape's own rule for a removed occurrence
        const after = solver.arrays()[0];
        expect(after.instanceEntityIds).toEqual([first, null, third, liveInstanceIds(after)[2]]);
        expect(solver.entityPoints(liveInstanceIds(after)[2])).toEqual([
            [40, 0],
            [50, 0],
        ]);
    });

    test("keeps the hole across a round trip, and rebuilds the rest around it", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 4), [lineId]);
        const [first, second, third] = liveInstanceIds(solver.arrays()[0]);
        solver.skipInstance(second);
        const data = solver.toData();

        const reloaded = new SketchSolver(Plane.XY, data);

        expect(reloaded.arrays()[0].instanceEntityIds).toEqual([first, null, third]);
        expect(reloaded.entity(second)).toBeUndefined();
        expect(reloaded.entityPoints(third)).toEqual([
            [30, 0],
            [40, 0],
        ]);
        expect(reloaded.toData()).toEqual(data);
    });

    test("answers nothing for an entity that is not one of its instances", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        expect(solver.skipInstance(lineId)).toBeUndefined();
        expect(liveInstanceIds(solver.arrays()[0])).toHaveLength(2);
    });

    test("drops a taken-out instance from the preview", () => {
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        const [, second] = liveInstanceIds(solver.arrays()[0]);
        solver.skipInstance(second);
        const record = solver.arrays()[0];
        const solved = resolved(solver, record.pattern);
        expect(arrayPreview(solver, [lineId], solved, record)).toEqual([
            { id: lineId, type: "line", params: [10, 0, 20, 0] },
        ]);
    });

    test("shows a re-pointed pattern whole, having no holes that mean anything in it", () => {
        // The holes are slots of the record's own source list — one run of them per instance.
        // Read against the geometry a re-point resolved instead, they would take out whichever
        // instances happened to sit in those positions.
        const { solver, lineId } = solverWithGeometry();
        const other = solver.addLine(0, 50, 10, 50);
        solver.addArray(linear(10, 3), [lineId, other]);
        const [, second] = liveInstanceIds(solver.arrays()[0]);
        solver.skipInstance(second);
        const record = solver.arrays()[0];
        const solved = resolved(solver, record.pattern);

        expect(record.sourceIds).toEqual([lineId, other]);
        expect(arrayPreview(solver, [other], solved, record).map((copy) => copy.params)).toEqual([
            [10, 50, 20, 50],
            [20, 50, 30, 50],
        ]);
    });
});

describe("SketchSolver's two readings of its arrays", () => {
    test("one is the live row, the other a copy nothing reaches through", () => {
        // The per-frame readers — the canvas annotations and the array tool's preview — read a
        // record on every frame of a drag, so they take `liveArrays` and pay no copy. What a
        // caller *keeps* takes `arrays`, whose copy is the whole point of it.
        const { solver, lineId } = solverWithGeometry();
        solver.addArray(linear(10, 3), [lineId]);
        const live = solver.liveArrays()[0];
        const copy = solver.arrays()[0];

        solver.skipInstance(liveInstanceIds(copy)[0]);

        expect(liveInstanceIds(live)).toHaveLength(1);
        expect(liveInstanceIds(copy)).toHaveLength(2);
    });
});

describe("SketchSolver arrays over an external reference", () => {
    test("goes with the reference it turns about", () => {
        // A circular pattern's centre can be snapped onto an external ref's own point, and an
        // external is dropped by a path of its own (`removeExternalEntity`) whose constraint
        // cascade does not reach a record that names the id. Left pointing at geometry that is
        // gone, the record throws on the next solve rather than reading as something to drop.
        const external = {
            entityId: -100,
            nodeId: "src",
            edge: { kind: "line" as const, start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
            role: "reference" as const,
            snapshot: [0, 0, 10, 0],
            type: "line" as const,
        };
        const solver = new SketchSolver(Plane.XY, {
            entities: [],
            constraints: [],
            externalRefs: [{ ...external }],
        });
        try {
            const lineId = solver.addLine(20, 0, 30, 0);
            const added = solver.addArray(
                circular(90, 3, false, {
                    type: "ref",
                    ref: { entityId: external.entityId, pointIndex: 0 },
                }),
                [lineId],
            );
            expect(added.isOk).toBe(true);
            const instances = liveInstanceIds(solver.arrays()[0]);
            expect(instances).toHaveLength(2);

            solver.removeExternalEntity(external.entityId);

            expect(solver.arrays()).toEqual([]);
            expect(instances.map((id) => solver.entity(id))).toEqual([undefined, undefined]);
            expect(["Ok", "OkUnderconstrained"]).toContain(solver.solve(true).result);
        } finally {
            solver.dispose();
        }
    });
});
