// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type ShapeType, ShapeTypes, type XYZ } from "@chili3d/core";
import { captureProfileRef, matchProfileIndexes, type ProfileRef } from "../src/features/profileRef";

function lineEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: { x: x2 - x1, y: y2 - y1, z: 0 } } },
        startPoint: () => ({ x: x1, y: y1, z: 0 }) as XYZ,
        endPoint: () => ({ x: x2, y: y2, z: 0 }) as XYZ,
    } as unknown as IEdge;
}

function faceOf(edges: IEdge[]): IFace {
    return {
        shapeType: ShapeTypes.face,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    } as unknown as IFace;
}

function circleEdge(cx: number, cy: number, radius: number): IEdge {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { center: { x: cx, y: cy, z: 0 }, radius, axis: { x: 0, y: 0, z: 1 } } },
    } as unknown as IEdge;
}

const SQUARE_A = [lineEdge(0, 0, 1, 0), lineEdge(1, 0, 1, 1), lineEdge(1, 1, 0, 1), lineEdge(0, 1, 0, 0)];
const SQUARE_B = [lineEdge(5, 5, 7, 5), lineEdge(7, 5, 7, 7), lineEdge(7, 7, 5, 7), lineEdge(5, 7, 5, 5)];

function squareAt(x: number, y: number): IEdge[] {
    return [
        lineEdge(x, y, x + 1, y),
        lineEdge(x + 1, y, x + 1, y + 1),
        lineEdge(x + 1, y + 1, x, y + 1),
        lineEdge(x, y + 1, x, y),
    ];
}

describe("captureProfileRef", () => {
    test("fingerprints every boundary edge", () => {
        const ref = captureProfileRef(faceOf(SQUARE_A));

        expect(ref.edges.length).toBe(4);
        expect(ref.edges[0]).toEqual({
            kind: "line",
            start: { x: 0, y: 0, z: 0 },
            end: { x: 1, y: 0, z: 0 },
            edgeId: undefined,
        });
    });
});

describe("matchProfileIndexes", () => {
    test("re-matches a profile on the rebuilt sketch", () => {
        const rebuilt = [faceOf([...SQUARE_A]), faceOf([...SQUARE_B])];
        const ref = captureProfileRef(faceOf(SQUARE_B));

        const result = matchProfileIndexes(rebuilt, [ref]);

        expect(result).toMatchObject({ isOk: true, value: [1] });
    });

    test("keeps the ref order when matching several profiles", () => {
        const rebuilt = [faceOf([...SQUARE_A]), faceOf([...SQUARE_B])];
        const refs = [captureProfileRef(faceOf(SQUARE_B)), captureProfileRef(faceOf(SQUARE_A))];

        const result = matchProfileIndexes(rebuilt, refs);

        expect(result).toMatchObject({ isOk: true, value: [1, 0] });
    });

    test("distinguishes two disjoint circles of the same radius", () => {
        // Regression: per-face independent matching accepted a sole candidate, so one
        // circle ref "matched" both faces and reported a false ambiguity.
        const faces = [faceOf([circleEdge(0, 0, 5)]), faceOf([circleEdge(20, 0, 5)])];
        const ref = captureProfileRef(faceOf([circleEdge(20, 0, 5)]));

        const result = matchProfileIndexes(faces, [ref]);

        expect(result).toMatchObject({ isOk: true, value: [1] });
    });

    test("fails when no face has the ref's edge count", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B));

        const result = matchProfileIndexes([faceOf(SQUARE_B.slice(0, 3))], [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile not found after rebuild");
    });

    test("fails when no candidate is clearly closest", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B));
        // Two unit squares placed symmetrically around the ref — equally poor matches.
        const faces = [faceOf(squareAt(0, 0)), faceOf(squareAt(0, 10))];

        const result = matchProfileIndexes(faces, [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile match is ambiguous after rebuild");
    });

    test("fails when two rebuilt profiles are identical", () => {
        const ref = captureProfileRef(faceOf(SQUARE_A));

        const result = matchProfileIndexes([faceOf([...SQUARE_A]), faceOf([...SQUARE_A])], [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile match is ambiguous after rebuild");
    });

    test("fails when two refs resolve to the same profile", () => {
        const ref: ProfileRef = captureProfileRef(faceOf(SQUARE_A));

        const result = matchProfileIndexes([faceOf([...SQUARE_A])], [ref, ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile match is ambiguous after rebuild");
    });

    test("a moved circle adopts the leftover face after identical siblings lock in", () => {
        // Regression: three same-radius circles, one moved by more than the clearance
        // rule allows against the old neighbors — the per-ref matching failed as
        // ambiguous, the rebuild kept the last shape, and the extrude appeared not to
        // follow the sketch edit.
        const faces = [
            faceOf([circleEdge(15, 0, 5)]),
            faceOf([circleEdge(20, 0, 5)]),
            faceOf([circleEdge(40, 0, 5)]),
        ];
        const refs = [
            captureProfileRef(faceOf([circleEdge(0, 0, 5)])), // moved 0 → 15
            captureProfileRef(faceOf([circleEdge(20, 0, 5)])),
            captureProfileRef(faceOf([circleEdge(40, 0, 5)])),
        ];

        const result = matchProfileIndexes(faces, refs);

        expect(result).toMatchObject({ isOk: true, value: [0, 1, 2] });
    });

    test("moved profiles re-match to the closest candidate", () => {
        const movedB = SQUARE_B.map((e) => {
            const start = e.startPoint();
            const end = e.endPoint();
            return lineEdge(start.x + 0.001, start.y, end.x + 0.001, end.y);
        });
        const ref = captureProfileRef(faceOf(SQUARE_B));

        const result = matchProfileIndexes([faceOf([...SQUARE_A]), faceOf(movedB)], [ref]);

        expect(result).toMatchObject({ isOk: true, value: [1] });
    });
});
