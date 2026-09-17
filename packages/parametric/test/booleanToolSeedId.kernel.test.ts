// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function extrude(sketch: SketchNode, depth: number): ExtrudeFeatureData {
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    return {
        id: "e1",
        type: "extrude",
        sketchId: sketch.id,
        depth,
        profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
    };
}

function addSketch(doc: TestDocument, bounds: [number, number, number, number]): SketchNode {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(...bounds) });
    doc.modelManager.addNode(sketch);
    return sketch;
}

/**
 * U is fused into N coplanar-flush (same height, sharing a side plane), so N's top and
 * bottom faces merge with U's into L-shaped faces and the collinear front edges into
 * 60-long edges — all carrying compound ids with a `tool:${U.id}:` leaf. When a host
 * body then booleans N as ITS tool, the tool-scoped seed for such a sub-shape must
 * prefix EVERY leaf of the compound id: prefixing only the first leaks the remaining
 * leaves into the host's id space as bare ids — and a bare `tool:${U.id}:...` leaf is
 * exactly the seed the host generates when booleaning U directly, so `idsOverlap`
 * matches unrelated sub-shapes (press-pull would silently sweep extra faces).
 */
function buildScenario() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const u = new ParametricBodyNode({
        document: doc,
        features: [extrude(addSketch(doc, [20, -20, 40, 0]), 20)],
    });
    doc.modelManager.addNode(u);

    const tool = new ParametricBodyNode({
        document: doc,
        features: [
            extrude(addSketch(doc, [-20, -20, 20, 20]), 20),
            { id: "b1", type: "boolean", operation: "fuse", toolIds: [u.id] },
        ],
    });
    doc.modelManager.addNode(tool);

    // The host box is disjoint from the tool body, so every tool sub-shape survives
    // the fuse singly and enters the host's id space through the tool-scoped seeds.
    const host = new ParametricBodyNode({
        document: doc,
        features: [
            extrude(addSketch(doc, [-100, -20, -60, 20]), 20),
            { id: "b1", type: "boolean", operation: "fuse", toolIds: [tool.id] },
        ],
    });
    doc.modelManager.addNode(host);
    return { u, tool, host };
}

function topFaceIndex(body: ParametricBodyNode): number {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
}

function faceIds(body: ParametricBodyNode): (string | undefined)[] {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face);
    return faces.map((_, index) => body.faceIdAt(index));
}

function edgeIds(body: ParametricBodyNode): (string | undefined)[] {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge);
    return edges.map((_, index) => body.edgeIdAt(index));
}

test("a boolean tool's compound tracked ids keep the tool prefix on every leaf", () => {
    const { u, tool, host } = buildScenario();
    expect(tool.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    expect(host.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // Preconditions: the flush fuse merged sub-shapes inside the tool body, so it owns
    // compound face AND edge ids whose leaves carry U's tool scope.
    const toolTopId = tool.faceIdAt(topFaceIndex(tool));
    expect(toolTopId?.includes("|")).toBe(true);
    expect(toolTopId?.split("|").some((leaf) => leaf.startsWith(`tool:${u.id}:`))).toBe(true);
    expect(edgeIds(tool).some((id) => id?.includes("|"))).toBe(true);

    // Every leaf of every compound id the host tracked must carry the tool's scope.
    // A bare leaf (e.g. `tool:${u.id}:...`) is the seed a DIRECT boolean against U
    // would legitimately generate — the collision this fix removes.
    for (const ids of [faceIds(host), edgeIds(host)]) {
        const compounds = ids.filter((id): id is string => id?.includes("|") ?? false);
        expect(compounds.length).toBeGreaterThan(0);
        for (const id of compounds) {
            const leaves = id.split("|");
            expect(leaves.every((leaf) => leaf.startsWith(`tool:${tool.id}:`))).toBe(true);
            expect(leaves.some((leaf) => leaf.startsWith(`tool:${u.id}:`))).toBe(false);
        }
    }

    // The leaked leaf would claim identity with a direct-boolean seed: pin the exact
    // string the host's id space must NOT contain at compound-leaf level.
    const uTopId = faceIds(u)[topFaceIndex(u)];
    expect(typeof uTopId).toBe("string");
    const collisionLeaf = `tool:${u.id}:${uTopId}`;
    for (const ids of [faceIds(host), edgeIds(host)]) {
        const leaves = ids.filter((id): id is string => id !== undefined).flatMap((id) => id.split("|"));
        expect(leaves).not.toContain(collisionLeaf);
    }
});

test("the host's compound id still intersects the tool's own compound id leaf-wise", () => {
    const { u, tool, host } = buildScenario();
    expect(host.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // Semantics preserved: re-splitting the stored compound yields `tool:${tool.id}:X`
    // leaves that still cover the tool's own compound id one scope deeper — the same
    // genealogy set, so tracking through the nested boolean keeps intersecting it.
    const toolTopId = tool.faceIdAt(topFaceIndex(tool));
    expect(typeof toolTopId).toBe("string");
    const hostTopId = faceIds(host).find((id) => id?.includes("|") && id.includes(`tool:${u.id}:`));
    expect(typeof hostTopId).toBe("string");
    const hostLeaves = new Set(hostTopId!.split("|"));
    const covered = toolTopId!.split("|").filter((leaf) => hostLeaves.has(`tool:${tool.id}:${leaf}`));
    expect(covered).toEqual(toolTopId!.split("|"));
});
