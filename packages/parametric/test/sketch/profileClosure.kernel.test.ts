// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Profile closure when a sketch reuses a body edge as a profile-role external ref
// (e.g. sketch2 on a side face of body1, one rectangle side being body1's edge).
// These run the real kernel because the routing decision depends on what
// `IEdge.intersect` reports: it sees a T-junction's endpoint contact (and, being a
// fuzzy extrema query, a hair-off near-miss too), but reports nothing for collinear
// overlapping edges — those are caught by the endpoint-on-interior probe instead.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, Result, XYZ } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { sketchProfiles } from "../../src/features/profileBuilder";
import type { ExternalRefData, SketchData } from "../../src/sketch/sketchModel";
import type { SketchNode } from "../../src/sketch/sketchNode";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

let factory: ShapeFactory;

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    factory = new ShapeFactory();
    Object.defineProperty(globalThis, "shapeFactory", {
        value: factory,
        writable: true,
        configurable: true,
    });
});

function line(x1: number, y1: number, x2: number, y2: number): IEdge {
    const result = factory.line(new XYZ({ x: x1, y: y1, z: 0 }), new XYZ({ x: x2, y: y2, z: 0 }));
    if (!result.isOk) throw new Error(result.error);
    return result.value;
}

/** body1's side-face edge, captured into the sketch as a profile-role external ref. */
const EXTERNAL: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
    role: "profile",
    snapshot: [0, 0, 10, 0],
    type: "line",
};

/** Stubs the parts of SketchNode that sketchProfiles reads: shape, plane, data. */
function sketchOf(edges: IEdge[], data: SketchData): SketchNode {
    const combined = factory.combine(edges);
    if (!combined.isOk) throw new Error(combined.error);
    return {
        shape: Result.ok(combined.value),
        plane: Plane.XY,
        data,
    } as unknown as SketchNode;
}

/** data.entities holds the drawn lines; the external edge rides as a profile-role ref. */
function dataOf(drawn: [number, number, number, number][]): SketchData {
    return {
        entities: drawn.map(([x1, y1, x2, y2], i) => ({ id: i + 1, type: "line", params: [x1, y1, x2, y2] })),
        constraints: [],
        externalRefs: [{ ...EXTERNAL }],
    };
}

/** Drawn lines plus the external edge, in generateShape order (entities, then externals). */
function edgesOf(drawn: [number, number, number, number][]): IEdge[] {
    return [...drawn.map(([x1, y1, x2, y2]) => line(x1, y1, x2, y2)), line(0, 0, 10, 0)];
}

function profilesOf(drawn: [number, number, number, number][]) {
    const result = sketchProfiles(sketchOf(edgesOf(drawn), dataOf(drawn)));
    if (!result.isOk) throw new Error(result.error);
    return result.value;
}

describe("profile closure on an external edge", () => {
    test("T-junction: drawn lines landing mid-span on the external edge close via the kernel", () => {
        const drawn: [number, number, number, number][] = [
            [2, 0, 2, 5],
            [2, 5, 8, 5],
            [8, 5, 8, 0],
        ];
        const profiles = profilesOf(drawn);

        expect(profiles.outer.length).toBe(1);
        // The region's entity-id set (its ProfileRef identity) includes the external edge.
        expect(profiles.outerEntities).toEqual([[-100, 1, 2, 3]]);
    });

    test("a solver-residual near-miss on the external edge still closes", () => {
        // The corners stopped 5e-8 short of the edge (solver residual scale). The
        // kernel's fuzzy extrema still reports the near-miss as a non-vertex contact,
        // so the sketch routes through the kernel, whose splitter absorbs the gap.
        const drawn: [number, number, number, number][] = [
            [2, 5e-8, 2, 5],
            [2, 5, 8, 5],
            [8, 5, 8, 5e-8],
        ];
        const profiles = profilesOf(drawn);

        expect(profiles.outer.length).toBe(1);
        expect(profiles.outerEntities).toEqual([[-100, 1, 2, 3]]);
    });

    test("a 4th line drawn exactly on top of the external edge still closes", () => {
        // Collinear duplicates report no intersection (the kernel skips parallel
        // curves); the shared endpoints form a branch vertex that routes the group
        // through the kernel.
        const drawn: [number, number, number, number][] = [
            [0, 0, 10, 0],
            [0, 0, 0, 5],
            [0, 5, 10, 5],
            [10, 5, 10, 0],
        ];
        const profiles = profilesOf(drawn);

        expect(profiles.outer.length).toBe(1);
        // Source attribution after the split is lossy: BOTH coincident edges are
        // credited with the doubled side, while the unsplit left edge (id 2) is not
        // credited at all. Pinned as a characterization of current OCCT behavior —
        // it may legitimately shift across kernel versions, not a contract.
        expect(profiles.outerEntities).toEqual([[-100, 1, 3, 4]]);
    });

    test("the duplicate 4th line closes in either draw direction", () => {
        const drawn: [number, number, number, number][] = [
            [10, 0, 0, 0],
            [0, 0, 0, 5],
            [0, 5, 10, 5],
            [10, 5, 10, 0],
        ];
        const profiles = profilesOf(drawn);

        expect(profiles.outer.length).toBe(1);
        // same lossy-attribution characterization as above
        expect(profiles.outerEntities).toEqual([[-100, 1, 3, 4]]);
    });

    test("a 4th line partially overlapping the external edge still closes", () => {
        // The drawn bottom's endpoints sit on the external edge's interior — a
        // collinear overlap `intersect` cannot see — so the endpoint probe routes
        // the sketch through the kernel, which attributes the doubled side to the
        // drawn line.
        const drawn: [number, number, number, number][] = [
            [2, 0, 2, 5],
            [2, 5, 8, 5],
            [8, 5, 8, 0],
            [2, 0, 8, 0],
        ];
        const profiles = profilesOf(drawn);

        expect(profiles.outer.length).toBe(1);
        expect(profiles.outerEntities).toEqual([[1, 2, 3, 4]]);
    });
});
