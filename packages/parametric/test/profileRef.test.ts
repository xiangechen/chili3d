// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IEdge, type IFace, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { registerProfileEntities } from "../src/features/profileEntities";
import { matchProfileIndexes } from "../src/features/profileMatcher";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";

function lineEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: { x: x2 - x1, y: y2 - y1, z: 0 } } },
        startPoint: () => ({ x: x1, y: y1, z: 0 }) as XYZ,
        endPoint: () => ({ x: x2, y: y2, z: 0 }) as XYZ,
    } as unknown as IEdge;
}

function faceOf(
    edges: IEdge[],
    holes: IEdge[] = [],
    box?: BoundingBox,
    area?: number,
    normalVec?: { x: number; y: number; z: number },
): IFace {
    return {
        shapeType: ShapeTypes.face,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [...edges, ...holes] : []),
        outerWire: () => ({
            shapeType: ShapeTypes.wire,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
        normal: () => [XYZ.zero, new XYZ(normalVec ?? { x: 0, y: 0, z: 1 })],
        // Zero defaults disable the region-similarity fallback in matching.
        boundingBox: () => box ?? BoundingBox.zero,
        area: () => area ?? 0,
    } as unknown as IFace;
}

/** Bounding box spanning the given 2D corners, at z=0. */
function boxOf(x1: number, y1: number, x2: number, y2: number): BoundingBox {
    return new BoundingBox({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 });
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

    test("fingerprints only the outer boundary, ignoring holes", () => {
        const ref = captureProfileRef(faceOf(SQUARE_A, [circleEdge(0.5, 0.5, 0.2)]));

        expect(ref.edges.length).toBe(4);
    });

    test("re-matches a profile that gained a hole after the ref was captured", () => {
        // Regression: a loop drawn inside the profile becomes a hole of its face
        // (even-odd semantics); the extra hole edges must not break the match.
        const ref = captureProfileRef(faceOf(SQUARE_A));
        const rebuilt = [faceOf([...SQUARE_A], [circleEdge(0.5, 0.5, 0.2)])];

        const result = matchProfileIndexes(rebuilt, [ref]);

        expect(result).toMatchObject({ isOk: true, value: [0] });
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

    test("fails when no face has the ref's edge count and the ref has no usable region fingerprint", () => {
        // The mock faces carry area 0, which disables the region-similarity fallback.
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

describe("region-similarity fallback (crossing sketches)", () => {
    /** SQUARE_B with its bottom edge split in two — a 5-edge boundary of the same region. */
    const RESPLIT_B = [
        lineEdge(5, 5, 6, 5),
        lineEdge(6, 5, 7, 5),
        lineEdge(7, 5, 7, 7),
        lineEdge(7, 7, 5, 7),
        lineEdge(5, 7, 5, 5),
    ];

    test("records the region fingerprint (bbox center and area)", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4));

        expect(ref.center).toEqual({ x: 6, y: 6, z: 0 });
        expect(ref.area).toBe(4);
    });

    test("re-matches a region whose boundary re-split into a different edge count", () => {
        // A crossing sketch re-splits the region boundary on rebuild, so the per-edge
        // fingerprints no longer apply; the region identity must carry the match.
        const ref = captureProfileRef(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4));
        const faces = [
            faceOf(RESPLIT_B, [], boxOf(5, 5, 7, 7), 4),
            faceOf(squareAt(20, 20).concat(lineEdge(21, 20, 21, 21)), [], boxOf(20, 20, 22, 22), 4),
        ];

        const result = matchProfileIndexes(faces, [ref]);

        expect(result).toMatchObject({ isOk: true, value: [0] });
    });

    test("rejects a candidate changed beyond the region's characteristic size", () => {
        // area 4 → 16: drift 6 exceeds twice the characteristic length (2·2).
        const ref = captureProfileRef(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4));

        const result = matchProfileIndexes([faceOf(RESPLIT_B, [], boxOf(5, 5, 9, 9), 16)], [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile not found after rebuild");
    });

    test("reports ambiguity between two equally similar re-split regions", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4));
        const faces = [
            faceOf(RESPLIT_B, [], boxOf(5, 5, 7, 7), 4),
            faceOf([...RESPLIT_B], [], boxOf(5, 5, 7, 7), 4),
        ];

        const result = matchProfileIndexes(faces, [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile match is ambiguous after rebuild");
    });

    test("a legacy ref without center/area keeps the strict edge-count behavior", () => {
        const {
            center: _center,
            area: _area,
            ...legacy
        } = captureProfileRef(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4));

        const result = matchProfileIndexes([faceOf(RESPLIT_B, [], boxOf(5, 5, 7, 7), 4)], [legacy]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile not found after rebuild");
    });
});

describe("entity-set matching (crossing sketches)", () => {
    /** SQUARE_B with its bottom edge split in two — a 5-edge boundary of the same region. */
    const RESPLIT_B = [
        lineEdge(5, 5, 6, 5),
        lineEdge(6, 5, 7, 5),
        lineEdge(7, 5, 7, 7),
        lineEdge(7, 7, 5, 7),
        lineEdge(5, 7, 5, 5),
    ];

    function refWithEntities(face: IFace, entities: number[]): ProfileRef {
        return { ...captureProfileRef(face), entities };
    }

    test("attaches registered entity ids at capture time", () => {
        const face = faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4);
        registerProfileEntities(face, [2, 3, 4]);

        expect(captureProfileRef(face).entities).toEqual([2, 3, 4]);
    });

    test("attaches entity ids through a sub-shape parent chain", () => {
        // Viewport picks hand captureProfileRef the mesh range's sub-shape wrapper,
        // not the registered region face itself.
        const face = faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4);
        registerProfileEntities(face, [7]);
        const subShape = { ...faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4), parent: face } as unknown as IFace;

        expect(captureProfileRef(subShape).entities).toEqual([7]);
    });

    test("entity sets disambiguate regions with identical boundary geometry", () => {
        // Adjacent minimal regions share complementary segments of the same entities,
        // so their geometric fingerprints can be identical; the entity sets separate them.
        const faceA = faceOf([...SQUARE_A], [], boxOf(0, 0, 1, 1), 1);
        const faceB = faceOf([...SQUARE_A], [], boxOf(0, 0, 1, 1), 1);
        const refs = [refWithEntities(faceA, [3, 4]), refWithEntities(faceB, [1, 2])];

        const result = matchProfileIndexes([faceA, faceB], refs, [
            [1, 2],
            [3, 4],
        ]);

        expect(result).toMatchObject({ isOk: true, value: [1, 0] });
    });

    test("tiebreaks regions of the same entity set by the region fingerprint", () => {
        // Two crossing circles produce three lens regions, all bounded by the same two
        // entities; after a move the closest region fingerprint wins.
        const faces = [
            faceOf([circleEdge(0, 0, 5)], [], boxOf(-5, -1, 0, 1), 3),
            faceOf([circleEdge(0, 0, 5)], [], boxOf(1, -2, 4, 2), 8),
            faceOf([circleEdge(0, 0, 5)], [], boxOf(10, -1, 14, 1), 3),
        ];
        const ref = refWithEntities(faceOf([circleEdge(5, 0, 5)], [], boxOf(9.5, -1, 13.5, 1), 3), [1, 2]);

        const result = matchProfileIndexes(
            faces,
            [ref],
            [
                [1, 2],
                [1, 2],
                [1, 2],
            ],
        );

        expect(result).toMatchObject({ isOk: true, value: [2] });
    });

    test("reports ambiguity between same-set regions with equal region fingerprints", () => {
        const ref = refWithEntities(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4), [1, 2]);
        const faces = [
            faceOf(RESPLIT_B, [], boxOf(5, 5, 7, 7), 4),
            faceOf([...RESPLIT_B], [], boxOf(5, 5, 7, 7), 4),
        ];

        const result = matchProfileIndexes(
            faces,
            [ref],
            [
                [1, 2],
                [1, 2],
            ],
        );

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile match is ambiguous after rebuild");
    });

    test("falls back to geometric matching when no candidate carries the entity set", () => {
        // The crossing is gone: the connectivity path rebuilt the sketch, so no face
        // carries an entity set — the region fingerprint re-matches as before.
        const ref = refWithEntities(faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4), [1, 2, 3, 4, 5]);

        const result = matchProfileIndexes([faceOf(RESPLIT_B, [], boxOf(5, 5, 7, 7), 4)], [ref], [undefined]);

        expect(result).toMatchObject({ isOk: true, value: [0] });
    });

    test("a legacy ref without entities keeps geometric matching when candidates carry sets", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B));

        const result = matchProfileIndexes([faceOf([...SQUARE_A]), faceOf([...SQUARE_B])], [ref], [[9], [8]]);

        expect(result).toMatchObject({ isOk: true, value: [1] });
    });
});

describe("source-face normal gate (press-pull refs)", () => {
    const UP = { x: 0, y: 0, z: 1 };
    const DOWN = { x: 0, y: 0, z: -1 };

    test("captureProfileRef records the outward normal only when asked", () => {
        const ref = captureProfileRef(
            faceOf(SQUARE_A, [], undefined, undefined, UP),
            undefined,
            undefined,
            true,
        );
        expect(ref.normal).toEqual(UP);
        // Sketch-side captures (no flag) keep the older serialized ref shape.
        expect(captureProfileRef(faceOf(SQUARE_A)).normal).toBeUndefined();
    });

    test("a candidate facing the opposite way is not the moved face", () => {
        // The groove ceiling (-z) consumed by a deeper cut: its floor (+z) has the
        // same boundary fingerprint and must not claim the ref.
        const ref = captureProfileRef(
            faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, DOWN),
            "face:1",
            undefined,
            true,
        );

        const result = matchProfileIndexes([faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, UP)], [ref]);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile not found after rebuild");
    });

    test("the gate disambiguates otherwise identical candidates", () => {
        const ref = captureProfileRef(
            faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, UP),
            "face:1",
            undefined,
            true,
        );
        const faces = [
            faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, DOWN),
            faceOf([...SQUARE_B], [], boxOf(5, 5, 7, 7), 4, UP),
        ];

        const result = matchProfileIndexes(faces, [ref]);

        expect(result).toMatchObject({ isOk: true, value: [1] });
    });

    test("a perpendicular face is rejected; a draft-angle tilt passes", () => {
        const ref = captureProfileRef(
            faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, UP),
            undefined,
            undefined,
            true,
        );

        const wall = matchProfileIndexes(
            [faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, { x: 1, y: 0, z: 0 })],
            [ref],
        );
        expect(wall.isOk).toBe(false);

        const tilted = matchProfileIndexes(
            [faceOf(SQUARE_B, [], boxOf(5, 5, 7, 7), 4, { x: 0, y: 0.5, z: Math.sqrt(0.75) })],
            [ref],
        );
        expect(tilted).toMatchObject({ isOk: true, value: [0] });
    });
});

describe("the allow predicate (dead-id refs vs live-id faces)", () => {
    test("a ref whose candidates are all disallowed is not found", () => {
        const ref = captureProfileRef(faceOf(SQUARE_B));

        const result = matchProfileIndexes([faceOf([...SQUARE_B])], [ref], undefined, () => false);

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Sketch profile not found after rebuild");
    });

    test("a disallowed exact hit is skipped, not claimed", () => {
        // The press-pull fallback lets a dead-id ref compete only for faces without
        // a live id: the exact face is out of bounds, the id-less leftover claims it.
        const ref = captureProfileRef(faceOf(SQUARE_B));
        const faces = [faceOf([...SQUARE_A]), faceOf([...SQUARE_B])];

        const result = matchProfileIndexes(faces, [ref], undefined, (_ref, face) => face === 0);

        expect(result).toMatchObject({ isOk: true, value: [0] });
    });
});
