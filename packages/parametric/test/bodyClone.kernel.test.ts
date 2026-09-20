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

const RECT: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 40, 0] },
        { id: 2, type: "line", params: [40, 0, 40, 20] },
        { id: 3, type: "line", params: [40, 20, 0, 20] },
        { id: 4, type: "line", params: [0, 20, 0, 0] },
    ],
    constraints: [],
};

function scenario() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: RECT });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, body };
}

/**
 * A copy of a parametric body is currently NOT independent, and that is deliberate here only
 * in the sense that it is pinned: `VisualNode.clone` regenerates the node's own id and copies
 * `featuresJson` verbatim, so the copy keeps the ORIGINAL `sketchId` — and every id inside
 * `featuresJson`, which embeds `<nodeId>` as its scope, still names the original sketch too.
 *
 * The two agree, which is exactly why the copy rebuilds correctly today. What it means:
 *
 * - a copy rides on the sketch it was copied from — edit that sketch and every copy follows;
 * - copies of one body carry the SAME sub-shape ids, because those name the sketch, not the
 *   body. Nothing resolves refs across bodies today, so this is harmless; it will not stay
 *   harmless for an assembly, or for a boolean between two copies of one sketch.
 *
 * When copy/paste lands and a copy is meant to become independent, this is the test to change:
 * it needs the caller (not `clone`) to remap `sketchId` and every id embedding it, because
 * `clone` on its own cannot know which node the copy's sketch became.
 */
test("a cloned parametric body rides on the sketch it was cloned from", () => {
    const { sketch, body } = scenario();

    const clone = body.clone();

    expect(clone.id).not.toBe(body.id);
    expect((clone.features[0] as ExtrudeFeatureData).sketchId).toBe(sketch.id);
    expect(clone.shape.isOk).toBe(true);
    // The ids name the original sketch's entities, so the copy's edge ids are the body's own.
    expect(clone.edgeIdAt(0)).toBe(body.edgeIdAt(0));
});
