// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ANGLE_UNITS, type EvaluatedValue, LENGTH_UNITS, Plane, type Scope } from "@chili3d/core";
import {
    ConstraintKind,
    resolveDatumSource,
    toDatumSource,
    toStorageDatum,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const length = (value: number): EvaluatedValue => ({ value, unit: LENGTH_UNITS });
const angle = (value: number): EvaluatedValue => ({ value, unit: ANGLE_UNITS });
const scopeOf = (entries: Record<string, EvaluatedValue>): Scope => new Map(Object.entries(entries));

function distance(a: [number, number], b: [number, number]) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

const START = { entityId: 1, pointIndex: 0 };
const END = { entityId: 1, pointIndex: 1 };

/** A horizontal line of length 10 from the origin, dimensioned by `datum`. */
function dimensionedLine(scope: Scope, datum: number | string) {
    const solver = new SketchSolver(Plane.XY, undefined, scope);
    // entity ids are solver-owned; the line added first is the one the refs point at.
    const line = solver.addLine(0, 0, 10, 0);
    const id = solver.addConstraint({
        kind: ConstraintKind.P2PDistance,
        refs: [
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ],
        datum,
    });
    return { solver, refs: [START, END], id, line };
}

function measuredLength(solver: SketchSolver, line: number): number {
    return distance(
        solver.pointOf({ entityId: line, pointIndex: 0 }),
        solver.pointOf({ entityId: line, pointIndex: 1 }),
    );
}

describe("datum unit conversion", () => {
    test("a literal input is converted into storage units right away", () => {
        expect(toDatumSource(ConstraintKind.Angle, 90)).toBeCloseTo(Math.PI / 2);
        expect(toDatumSource(ConstraintKind.P2LDistance, 5)).toBe(-5);
        expect(toDatumSource(ConstraintKind.P2PDistance, 5)).toBe(5);
    });

    test("an expression is stored verbatim and only converted after it resolves", () => {
        expect(toDatumSource(ConstraintKind.Angle, "a")).toBe("a");
        const resolved = resolveDatumSource(ConstraintKind.Angle, "a", scopeOf({ a: angle(90) })).unchecked();
        expect(resolved).toBeCloseTo(Math.PI / 2);
    });

    test("a stored literal passes through untouched — old documents change not at all", () => {
        const stored = toStorageDatum(ConstraintKind.P2LDistance, 7);
        expect(stored).toBe(-7);
        expect(resolveDatumSource(ConstraintKind.P2LDistance, stored, scopeOf({})).unchecked()).toBe(-7);
    });

    test("an expression of the wrong unit is rejected", () => {
        const result = resolveDatumSource(ConstraintKind.Angle, "w", scopeOf({ w: length(5) }));
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Dimension mismatch: expected angle, got length");
    });
});

describe("SketchSolver expression datums", () => {
    test("a datum written as an expression resolves against the scope", () => {
        const { solver, line } = dimensionedLine(scopeOf({ w: length(20) }), "w / 2");
        solver.solve(true);
        expect(measuredLength(solver, line)).toBeCloseTo(10);
    });

    test("the expression is persisted verbatim, not its current value", () => {
        const { solver, id } = dimensionedLine(scopeOf({ w: length(20) }), "w / 2");
        solver.solve(true);
        // A literal is read back from garlic (that is where normalization lands); an
        // expression must survive the round trip or every commit would erase it.
        const constraint = solver.toData().constraints.find((x) => x.id === id);
        expect(constraint?.datum).toBe("w / 2");
    });

    test("a literal datum is still read back from the solver", () => {
        const { solver, id } = dimensionedLine(scopeOf({}), 10);
        solver.solve(true);
        const constraint = solver.toData().constraints.find((x) => x.id === id);
        expect(constraint?.datum).toBeCloseTo(10);
    });

    test("loads a document whose datums are plain numbers", () => {
        const solver = new SketchSolver(
            Plane.XY,
            {
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [
                    {
                        id: 2,
                        kind: ConstraintKind.P2PDistance,
                        refs: [START, END],
                        datum: 5,
                    },
                ],
            },
            scopeOf({}),
        );
        expect(solver.datumErrors.size).toBe(0);
        expect(measuredLength(solver, 1)).toBeCloseTo(5);
    });

    test("an expression that resolves against nothing is reported and keeps the geometry", () => {
        const { solver, id, line } = dimensionedLine(scopeOf({}), "nope");
        solver.solve(true);
        expect(solver.datumErrors.get(id)).toBe("Unknown identifier: nope");
        // The sketch stays usable: the dimension falls back to the measured geometry.
        expect(measuredLength(solver, line)).toBeCloseTo(10);
    });

    test("an expression of the wrong unit is reported too", () => {
        const { solver, id } = dimensionedLine(scopeOf({ a: angle(30) }), "a");
        solver.solve(true);
        expect(solver.datumErrors.get(id)).toBe("Dimension mismatch: expected length, got angle");
    });

    test("setScope re-drives the datums, and reports whether anything moved", () => {
        const { solver, line } = dimensionedLine(scopeOf({ w: length(20) }), "w");
        solver.solve(true);
        expect(measuredLength(solver, line)).toBeCloseTo(20);

        expect(solver.setScope(scopeOf({ w: length(40) }))).toBe(true);
        solver.solve(true);
        expect(measuredLength(solver, line)).toBeCloseTo(40);

        expect(solver.setScope(scopeOf({ w: length(40) }))).toBe(false);
    });

    test("setScope re-reports an unresolvable datum", () => {
        const { solver, id } = dimensionedLine(scopeOf({ w: length(20) }), "w * 2");
        solver.solve(true);
        expect(solver.datumErrors.size).toBe(0);

        solver.setScope(scopeOf({}));
        expect(solver.datumErrors.get(id)).toBe("Unknown identifier: w");
    });

    test("setDatumSource stores what the user typed and pushes its value", () => {
        const { solver, line, id } = dimensionedLine(scopeOf({ w: length(15) }), 10);
        solver.solve(true);

        const result = solver.setDatumSource(id, "w * 2");
        expect(result.isOk).toBe(true);
        solver.solve(true);
        expect(measuredLength(solver, line)).toBeCloseTo(30);
        expect(solver.toData().constraints.find((x) => x.id === id)?.datum).toBe("w * 2");
    });

    test("setDatumSource rejects an unresolvable input without touching the datum", () => {
        const { solver, line, id } = dimensionedLine(scopeOf({}), 10);
        solver.solve(true);

        const result = solver.setDatumSource(id, "nope");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Unknown identifier: nope");
        expect(solver.toData().constraints.find((x) => x.id === id)?.datum).toBeCloseTo(10);
        expect(measuredLength(solver, line)).toBeCloseTo(10);
    });
});
