// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IShape, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import {
    captureEdgeRef,
    type EdgeRef,
    matchEdgeIndexes,
    matchEdgeIndexesTracked,
} from "../src/features/edgeRef";

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
