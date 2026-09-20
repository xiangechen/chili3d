// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IShape, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "../src/features/edgeMatcher";
import {
    bestEdgeScore,
    captureEdgeRef,
    type EdgeRef,
    edgeMatchesRefInvariant,
    refScore,
} from "../src/features/edgeRef";
import { completeEdgeHistory } from "../src/features/historyCompletion";
import { idIsShared } from "../src/features/trackedId";

/** Indexes-only projection of `matchEdgesAnchored` — the matching rules are asserted through it. */
function matchEdgeIndexesTracked(shape: IShape, refs: EdgeRef[], inputEdgeIds: readonly string[]) {
    const matched = matchEdgesAnchored(shape, refs, inputEdgeIds);
    return matched.isOk ? Result.ok(matched.value.indexes) : Result.err(matched.error);
}

function xyz(x: number, y: number, z: number) {
    return new XYZ({ x, y, z });
}

function lineEdge(x1: number, y1: number, x2: number, y2: number) {
    const [start, end] = [xyz(x1, y1, 0), xyz(x2, y2, 0)];
    return {
        curve: { basisCurve: { direction: end.sub(start).normalize() } },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        length: () => start.distanceTo(end),
    } as unknown as IEdge;
}

function circleEdge(cx: number, cy: number, radius: number) {
    return {
        curve: { basisCurve: { center: xyz(cx, cy, 0), radius, axis: XYZ.unitZ } },
        startPoint: () => xyz(cx + radius, cy, 0),
        endPoint: () => xyz(cx + radius, cy, 0),
        firstParameter: () => 0,
        lastParameter: () => Math.PI * 2,
        pointAt: (t: number) => xyz(cx + radius * Math.cos(t), cy + radius * Math.sin(t), 0),
        length: () => 2 * Math.PI * radius,
    } as unknown as IEdge;
}

function splineEdge() {
    return {
        curve: { basisCurve: {} },
        startPoint: () => xyz(0, 0, 0),
        endPoint: () => xyz(2, 2, 0),
        firstParameter: () => 0,
        lastParameter: () => 4,
        pointAt: (t: number) => xyz(t / 2, t / 2, 0),
        length: () => Math.hypot(2, 2),
    } as unknown as IEdge;
}

/** A free-form edge with a fixed mid point and length — the "other" fingerprint fields. */
function spline(mid: XYZ, length: number) {
    return {
        curve: { basisCurve: {} },
        startPoint: () => xyz(0, 0, 0),
        endPoint: () => xyz(1, 1, 0),
        firstParameter: () => 0,
        lastParameter: () => 4,
        pointAt: () => mid,
        length: () => length,
    } as unknown as IEdge;
}

/** An edge whose every kernel query throws — a degenerate (zero-length / no-curve) edge. */
function degenerateEdge(): IEdge {
    const fail = (): never => {
        throw new Error("degenerate edge");
    };
    return {
        get curve() {
            throw new Error("degenerate edge");
        },
        startPoint: fail,
        endPoint: fail,
        firstParameter: fail,
        lastParameter: fail,
        pointAt: fail,
        length: fail,
    } as unknown as IEdge;
}

/** The length query works (the "other" invariant passes) but the capture's pointAt throws. */
function uncapturableSpline(length: number): IEdge {
    return {
        curve: { basisCurve: {} },
        startPoint: () => xyz(0, 0, 0),
        endPoint: () => xyz(1, 1, 0),
        firstParameter: () => 0,
        lastParameter: () => 4,
        pointAt: () => {
            throw new Error("degenerate edge");
        },
        length: () => length,
    } as unknown as IEdge;
}

function shapeWith(...edges: IEdge[]): IShape {
    return {
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    } as unknown as IShape;
}

describe("captureEdgeRef", () => {
    test("captures line endpoints", () => {
        const ref = captureEdgeRef(lineEdge(1, 2, 3, 4));
        expect(ref).toEqual({ kind: "line", start: { x: 1, y: 2, z: 0 }, end: { x: 3, y: 4, z: 0 } });
    });

    test("captures circle center, radius and axis", () => {
        const ref = captureEdgeRef(circleEdge(1, 2, 5));
        expect(ref).toEqual({
            kind: "circle",
            center: { x: 1, y: 2, z: 0 },
            radius: 5,
            axis: { x: 0, y: 0, z: 1 },
        });
    });

    test("captures midpoint and length for other curves", () => {
        const ref = captureEdgeRef(splineEdge());
        expect(ref.kind).toBe("other");
        const other = ref as Extract<EdgeRef, { kind: "other" }>;
        expect(other.mid).toEqual({ x: 1, y: 1, z: 0 });
        expect(other.length).toBeCloseTo(Math.hypot(2, 2));
    });
});

describe("matchEdgeIndexes", () => {
    test("matches the exact edge and returns its position", () => {
        const target = lineEdge(0, 0, 1, 0);
        const shape = shapeWith(lineEdge(5, 5, 6, 5), target);
        const result = matchEdgeIndexes(shape, [captureEdgeRef(lineEdge(0, 0, 1, 0))]);

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toEqual([1]);
    });

    test("matches a flipped line", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const shape = shapeWith(lineEdge(1, 0, 0, 0));

        expect(matchEdgeIndexes(shape, [ref]).unchecked()).toEqual([0]);
    });

    test("matches a circle with a flipped axis", () => {
        const ref = captureEdgeRef(circleEdge(1, 2, 5));
        const edge = circleEdge(1, 2, 5);
        (edge.curve.basisCurve as any).axis = new XYZ({ x: 0, y: 0, z: -1 });

        expect(matchEdgeIndexes(shapeWith(edge), [ref]).unchecked()).toEqual([0]);
    });

    test("accepts the only candidate of the ref's type even when it moved far", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(lineEdge(10, 10, 11, 10)), [ref]);

        expect(result.unchecked()).toEqual([0]);
    });

    test("accepts a moved edge when it is clearly the closest", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(lineEdge(0, 2, 1, 2), lineEdge(0, 20, 1, 20)), [ref]);

        expect(result.unchecked()).toEqual([0]);
    });

    test("rejects a moved edge when a rival is similarly close", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(lineEdge(0, 2, 1, 2), lineEdge(0, 3, 1, 3)), [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge not found after rebuild");
    });

    test("fails when the best match is ambiguous", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)), [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });

    test("fails when the only candidate has the wrong curve type", () => {
        const ref = captureEdgeRef(circleEdge(0, 0, 5));
        const result = matchEdgeIndexes(shapeWith(lineEdge(0, 0, 1, 0)), [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge not found after rebuild");
    });

    test("fails when two refs collapse onto the same rebuilt edge", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(lineEdge(0, 0, 1, 0)), [ref, ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });

    test("fails when the shape has no edges", () => {
        const result = matchEdgeIndexes(shapeWith(), [captureEdgeRef(lineEdge(0, 0, 1, 0))]);

        expect(result.error).toBe("Shape has no edges");
    });

    test("skips a degenerate edge instead of throwing", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const shape = shapeWith(degenerateEdge(), lineEdge(0, 0, 1, 0));

        expect(matchEdgeIndexes(shape, [ref]).unchecked()).toEqual([1]);
    });

    test("fails when the only candidate is degenerate", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexes(shapeWith(degenerateEdge()), [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge not found after rebuild");
    });
});

describe("matchEdgeIndexesTracked", () => {
    test("resolves a surviving edge id exactly, ignoring the fingerprint", () => {
        // The id points at edge 1 even though the fingerprint matches edge 0 — the id wins.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:1" };
        const shape = shapeWith(lineEdge(0, 0, 1, 0), lineEdge(5, 5, 6, 5));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("falls back to the fingerprint for an unknown edge id", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "gone:3" };
        const shape = shapeWith(lineEdge(5, 5, 6, 5), lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("mixes id hits and fingerprint matches without stealing each other's edges", () => {
        const withId: EdgeRef = { ...captureEdgeRef(lineEdge(9, 9, 10, 9)), edgeId: "f1:1" };
        const withoutId = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const shape = shapeWith(lineEdge(0, 0, 1, 0), lineEdge(5, 5, 6, 5));
        const result = matchEdgeIndexesTracked(shape, [withId, withoutId], ["f1:0", "f1:1"]);

        expect(result.unchecked()?.sort()).toEqual([0, 1]);
    });

    test("fails when a fingerprint lands on an edge an id already resolved", () => {
        const withId: EdgeRef = { ...captureEdgeRef(lineEdge(9, 9, 10, 9)), edgeId: "f1:0" };
        const rival = captureEdgeRef(lineEdge(5, 5, 6, 5));
        const shape = shapeWith(lineEdge(5, 5, 6, 5));
        const result = matchEdgeIndexesTracked(shape, [withId, rival], ["f1:0"]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });
});

describe("edgeMatchesRefInvariant", () => {
    test("a rigidly moved line keeps the invariant", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        expect(edgeMatchesRefInvariant(lineEdge(5, 5, 6, 5), ref)).toBe(true);
    });

    test("a direction change breaks the line invariant", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        expect(edgeMatchesRefInvariant(lineEdge(5, 5, 5, 6), ref)).toBe(false);
    });

    test("a radius change keeps the circle invariant (the axis is intact)", () => {
        const ref = captureEdgeRef(circleEdge(1, 2, 5));
        expect(edgeMatchesRefInvariant(circleEdge(1, 2, 8), ref)).toBe(true);
    });

    test("an axis change breaks the circle invariant", () => {
        const ref = captureEdgeRef(circleEdge(1, 2, 5));
        const tilted = circleEdge(1, 2, 5);
        (tilted.curve.basisCurve as any).axis = new XYZ({ x: 0, y: 1, z: 0 });
        expect(edgeMatchesRefInvariant(tilted, ref)).toBe(false);
    });

    test("a curve kind mismatch breaks the invariant", () => {
        const ref = captureEdgeRef(circleEdge(1, 2, 5));
        expect(edgeMatchesRefInvariant(lineEdge(0, 0, 1, 0), ref)).toBe(false);
    });

    test("a length change breaks the other-curve invariant", () => {
        const ref = captureEdgeRef(splineEdge());
        const longer = { ...splineEdge(), length: () => 10 } as unknown as IEdge;
        expect(edgeMatchesRefInvariant(longer, ref)).toBe(false);
    });
});

describe("matchEdgeIndexesTracked — invariant verification and splits", () => {
    test("demotes an id hit whose direction no longer matches the fingerprint", () => {
        // The id points at edge 0, now vertical — a positional id realigned onto another
        // edge. The fingerprint still matches edge 1 exactly and takes over.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:0" };
        const shape = shapeWith(lineEdge(5, 5, 5, 6), lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("keeps an id hit that moved rigidly with its direction intact", () => {
        // Edge 1 moved far from the fingerprint but kept its direction: moving IS the
        // edit, so the id still wins over the unmoved look-alike at edge 0.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:1" };
        const shape = shapeWith(lineEdge(0, 0, 1, 0), lineEdge(5, 5, 6, 5));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("demotes an other-curve id hit whose length changed", () => {
        const ref: EdgeRef = { ...captureEdgeRef(splineEdge()), edgeId: "f1:0" };
        const longer = { ...splineEdge(), length: () => 10 } as unknown as IEdge;
        const shape = shapeWith(longer, splineEdge());
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("adopts every piece of an edge split into fragments sharing one id", () => {
        // A boolean split the referenced [0,10] edge into [0,4]+[4,10]; both pieces
        // inherit the id, and the edge feature applies to the whole original span.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 10, 0)), edgeId: "f1:0" };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 10, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()?.sort()).toEqual([0, 1]);
    });

    test("adopts only the split pieces that keep the invariant", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 10, 0)), edgeId: "f1:0" };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 4, 5));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()).toEqual([0]);
    });

    test("adopts only the exactly matching piece when the ref was captured from one piece", () => {
        // The referenced edge was ALREADY split when the user picked [0,4]: both
        // pieces carry the id, but the fingerprint singles out the picked piece —
        // adopting the whole span would silently widen the feature to [0,10].
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "f1:0" };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 10, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()).toEqual([0]);
    });

    test("adopts the whole span for an unflagged ref when no piece matches exactly", () => {
        // Same already-split shape as above, but the edges moved: no piece matches the
        // fingerprint exactly. The ref carries no splitPiece flag (an older document,
        // or a pick of the whole edge), so the id's current span is the intent again.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "f1:0" };
        const shape = shapeWith(lineEdge(0, 0, 5, 0), lineEdge(5, 0, 11, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()?.sort()).toEqual([0, 1]);
    });

    test("a splitPiece ref adopts the clearly closest piece when none matches exactly", () => {
        // The ref was flagged as one piece of a split edge at capture time, so it
        // never widens: the moved pieces score 1 vs 12 and the clear winner is adopted.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "f1:0", splitPiece: true };
        const shape = shapeWith(lineEdge(0, 0, 5, 0), lineEdge(5, 0, 11, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()).toEqual([0]);
    });

    test("a splitPiece ref fails as ambiguous when the moved pieces tie", () => {
        // Both pieces are equally close to the stale fingerprint — there is no honest
        // winner, so the feature reports ambiguity instead of widening or guessing.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(2, 0, 6, 0)), edgeId: "f1:0", splitPiece: true };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 8, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });

    test("a splitPiece ref fails as ambiguous when several pieces match exactly", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "f1:0", splitPiece: true };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(0, 0, 4, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });

    test("fails when another ref's fingerprint lands on a resolved split piece", () => {
        const withId: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 10, 0)), edgeId: "f1:0" };
        const rival = captureEdgeRef(lineEdge(0, 0, 4, 0));
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 10, 0));
        const result = matchEdgeIndexesTracked(shape, [withId, rival], ["f1:0", "f1:0"]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Edge match is ambiguous after rebuild");
    });

    test("demotes an id hit on an edge-less shape instead of trusting it", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:0" };
        const result = matchEdgeIndexesTracked(shapeWith(), [ref], ["f1:0"]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Shape has no edges");
    });

    test("excludes a degenerate edge carrying the ref's id from the hits", () => {
        // The id overlaps, but the degenerate edge's invariant probe throws — it is
        // no hit, and the fingerprint recovers the healthy edge instead.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:0" };
        const shape = shapeWith(degenerateEdge(), lineEdge(0, 0, 1, 0));
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()).toEqual([1]);
    });

    test("a hit whose fingerprint capture throws scores as no exact match", () => {
        // Both hits keep the length invariant; the first throws when its fingerprint
        // is captured for scoring, so only the healthy piece can match exactly.
        const ref: EdgeRef = { ...captureEdgeRef(splineEdge()), edgeId: "f1:0", splitPiece: true };
        const shape = shapeWith(uncapturableSpline(Math.hypot(2, 2)), splineEdge());
        const result = matchEdgeIndexesTracked(shape, [ref], ["f1:0", "f1:0"]);

        expect(result.unchecked()).toEqual([1]);
    });
});

describe("completeEdgeHistory", () => {
    test("fills an unmapped output with the geometrically identical input", () => {
        const inputs = [lineEdge(0, 0, 1, 0), lineEdge(5, 5, 6, 5)];
        const outputs = [lineEdge(0, 0, 1, 0), lineEdge(9, 9, 10, 9), lineEdge(5, 5, 6, 5)];

        expect(completeEdgeHistory(inputs, outputs, [0, -1, -1])).toEqual([0, -1, 1]);
    });

    test("matches a flipped identical edge", () => {
        const inputs = [lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(1, 0, 0, 0)];

        expect(completeEdgeHistory(inputs, outputs, [-1])).toEqual([0]);
    });

    test("does not fill when two unclaimed inputs are identical", () => {
        const inputs = [lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(0, 0, 1, 0)];

        expect(completeEdgeHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("does not steal an input already claimed by the kernel history", () => {
        const inputs = [lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)];

        expect(completeEdgeHistory(inputs, outputs, [0, -1])).toEqual([0, -1]);
    });

    test("pairs identical outputs with distinct identical inputs", () => {
        const inputs = [lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)];

        expect(completeEdgeHistory(inputs, outputs, [0, -1])).toEqual([0, 1]);
    });

    test("leaves genuinely new edges unmapped", () => {
        const inputs = [lineEdge(0, 0, 1, 0)];
        const outputs = [circleEdge(0, 0, 5)];

        expect(completeEdgeHistory(inputs, outputs, [-1])).toEqual([-1]);
    });

    test("skips edges whose kernel queries fail without losing the healthy matches", () => {
        const degenerate = {} as IEdge;
        const inputs = [degenerate, lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(0, 0, 1, 0), degenerate];

        expect(completeEdgeHistory(inputs, outputs, [-1, -1])).toEqual([1, -1]);
    });

    test("captures each output edge's fingerprint once regardless of candidate count", () => {
        // Every candidate scoring must go through the single captured fingerprint —
        // scoring the live edge per candidate would multiply kernel queries.
        let startQueries = 0;
        const [start, end] = [xyz(0, 0, 0), xyz(1, 0, 0)];
        const output = {
            curve: { basisCurve: { direction: xyz(1, 0, 0) } },
            startPoint: () => {
                startQueries++;
                return start;
            },
            endPoint: () => end,
        } as unknown as IEdge;
        // Identical unclaimed inputs keep the output unmapped (ambiguity) while
        // maximizing the number of scorings.
        const inputs = [lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0), lineEdge(0, 0, 1, 0)];

        expect(completeEdgeHistory(inputs, [output], [-1])).toEqual([-1]);
        expect(startQueries).toBe(1);
    });

    test("captures nothing when every output is already mapped", () => {
        let queries = 0;
        const probe = {
            curve: { basisCurve: { direction: xyz(1, 0, 0) } },
            startPoint: () => {
                queries++;
                return xyz(0, 0, 0);
            },
            endPoint: () => xyz(1, 0, 0),
        } as unknown as IEdge;

        expect(completeEdgeHistory([probe], [probe], [0])).toEqual([0]);
        expect(queries).toBe(0);
    });

    test("skips fingerprint capture for inputs already claimed by the kernel history", () => {
        let queries = 0;
        const claimedProbe = {
            curve: { basisCurve: { direction: xyz(1, 0, 0) } },
            startPoint: () => {
                queries++;
                return xyz(9, 9, 0);
            },
            endPoint: () => xyz(10, 9, 0),
        } as unknown as IEdge;
        const inputs = [claimedProbe, lineEdge(0, 0, 1, 0)];
        const outputs = [lineEdge(9, 9, 10, 9), lineEdge(0, 0, 1, 0)];

        expect(completeEdgeHistory(inputs, outputs, [0, -1])).toEqual([0, 1]);
        expect(queries).toBe(0);
    });
});

describe("matchEdgesAnchored", () => {
    test("passes id-hit refs through unchanged — a live id is already the freshest anchor", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "f1:1" };
        const shape = shapeWith(lineEdge(5, 5, 6, 5), lineEdge(0, 0, 1, 0));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()!.indexes).toEqual([1]);
        expect(result.unchecked()!.anchors).toEqual([ref]);
    });

    test("re-anchors a dead id onto the edge the fingerprint recovered", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "gone:3" };
        const shape = shapeWith(lineEdge(5, 5, 6, 5), lineEdge(0, 0, 1, 0));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:1"]);

        const { indexes, anchors } = result.unchecked()!;
        expect(indexes).toEqual([1]);
        expect(anchors[0]).toEqual({
            kind: "line",
            start: { x: 0, y: 0, z: 0 },
            end: { x: 1, y: 0, z: 0 },
            edgeId: "f1:1",
        });
    });

    test("marks the anchor splitPiece when the recovered id is shared by several edges", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "gone:3" };
        // Two collinear pieces of a split edge share one id; the [0,4] piece is the
        // exact fingerprint hit.
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 10, 0), lineEdge(0, 5, 1, 5));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:0", "f1:2"]);

        const { indexes, anchors } = result.unchecked()!;
        expect(indexes).toEqual([0]);
        expect(anchors[0]!.edgeId).toBe("f1:0");
        expect(anchors[0]!.splitPiece).toBe(true);
    });

    test("marks the anchor splitPiece when the recovered id is shared through a compound", () => {
        // One piece of the split edge merged with a collinear neighbor and carries
        // the compound "f1:0|f1:1"; the untouched sibling keeps "f1:0". Textually
        // distinct, but the ids overlap — the recovered anchor must not widen later.
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 4, 0)), edgeId: "gone:3" };
        const shape = shapeWith(lineEdge(0, 0, 4, 0), lineEdge(4, 0, 10, 0), lineEdge(0, 5, 1, 5));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:0|f1:1", "f1:2"]);

        const { indexes, anchors } = result.unchecked()!;
        expect(indexes).toEqual([0]);
        expect(anchors[0]!.edgeId).toBe("f1:0");
        expect(anchors[0]!.splitPiece).toBe(true);
    });

    test("upgrades a legacy id-less ref with the matched edge's id", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        const shape = shapeWith(lineEdge(5, 5, 6, 5), lineEdge(0, 0, 1, 0));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:1"]);

        expect(result.unchecked()!.anchors[0]!.edgeId).toBe("f1:1");
    });

    test("keeps the matching failures of the indexes-only variant", () => {
        const ref: EdgeRef = { ...captureEdgeRef(lineEdge(0, 0, 1, 0)), edgeId: "gone:3" };
        expect(matchEdgesAnchored(shapeWith(), [ref], ["f1:0"]).error).toBe("Shape has no edges");
        const rivals = shapeWith(lineEdge(0, 2, 1, 2), lineEdge(0, 3, 1, 3));
        expect(matchEdgesAnchored(rivals, [ref], ["f1:0", "f1:1"]).error).toBe(
            "Edge not found after rebuild",
        );
    });

    test("keeps the user's ref when its id is alive but failed the invariant check", () => {
        // A free-form ref (length invariant) whose id survived on an edge whose
        // length changed — the id is alive, only the invariant demoted it. The
        // fingerprint recovers another edge, but the anchor must stay the user's
        // ref: the original edge can claim it back once the invariant holds again,
        // and rewriting would lose the live id.
        const ref: EdgeRef = { ...captureEdgeRef(spline(xyz(3, 3, 0), 5)), edgeId: "f1:0" };
        const shape = shapeWith(spline(xyz(9, 9, 0), 10), spline(xyz(3, 3, 0), 5));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:1"]);

        const { indexes, anchors } = result.unchecked()!;
        expect(indexes).toEqual([1]);
        expect(anchors[0]).toBe(ref);
    });

    test("re-anchors when the stored id died even though its invariant would have failed too", () => {
        // Same geometry as above, but the stored id is gone from the rebuilt shape —
        // the re-anchor contract applies.
        const ref: EdgeRef = { ...captureEdgeRef(spline(xyz(3, 3, 0), 5)), edgeId: "gone:3" };
        const shape = shapeWith(spline(xyz(9, 9, 0), 10), spline(xyz(3, 3, 0), 5));
        const result = matchEdgesAnchored(shape, [ref], ["f1:0", "f1:1"]);

        const { indexes, anchors } = result.unchecked()!;
        expect(indexes).toEqual([1]);
        expect(anchors[0]!.edgeId).toBe("f1:1");
    });
});

describe("idIsShared", () => {
    test("exact duplicates are shared", () => {
        expect(idIsShared(["f1:0", "f1:0", "f1:2"], "f1:0")).toBe(true);
    });

    test("a lone id is not shared", () => {
        expect(idIsShared(["f1:0", "f1:1"], "f1:0")).toBe(false);
    });

    test("textually different but overlapping ids are shared", () => {
        // One split piece merged with a collinear neighbor and carries the compound.
        expect(idIsShared(["f1:0", "f1:0|f1:1", "f1:2"], "f1:0")).toBe(true);
        expect(idIsShared(["f1:0", "f1:0|f1:1", "f1:2"], "f1:0|f1:1")).toBe(true);
    });

    test("disjoint ids are not shared", () => {
        expect(idIsShared(["f1:0", "f1:1|f1:2"], "f1:0")).toBe(false);
    });

    test("undefined is never shared", () => {
        expect(idIsShared(["f1:0", "f1:0"], undefined)).toBe(false);
    });
});

describe("refScore with degenerate edges", () => {
    test("returns Infinity for a degenerate edge instead of throwing", () => {
        expect(refScore(captureEdgeRef(lineEdge(0, 0, 1, 0)), degenerateEdge())).toBe(Infinity);
    });

    test("bestEdgeScore never lets a degenerate edge win", () => {
        const ref = captureEdgeRef(lineEdge(0, 0, 1, 0));
        expect(bestEdgeScore([degenerateEdge()], ref)).toBe(Infinity);
        expect(bestEdgeScore([degenerateEdge(), lineEdge(0, 0, 1, 0)], ref)).toBe(0);
    });
});
