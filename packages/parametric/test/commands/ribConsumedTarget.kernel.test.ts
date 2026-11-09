// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTO_TARGETS, BoundingBox, type IEdge, Plane, Precision, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { commitBooleanTargets, resolveTargetBodies } from "../../src/commands/booleanTargets";
import type {
    BooleanFeatureData,
    FeatureData,
    PrimitiveFeatureData,
    RibFeatureData,
} from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

/** Ø100 × 100 boss on an XY circle sketch, standing on a 200 × 300 × 70.9 plate beside it. */
const CIRCLE: SketchData = { entities: [{ id: 1, type: "circle", params: [0, 0, 50] }], constraints: [] };
const BOX: PrimitiveFeatureData = {
    id: "box",
    type: "primitive",
    primitive: "box",
    origin: { x: -64.81987883497175, y: 150, z: 0 },
    dx: 200,
    dy: 300,
    dz: 70.90207028120736,
    axis: { x: 0, y: 0, z: -1 },
};
/** From the plate's top (y = 103.37, z = 0) into the boss (−1.55 of overshoot), in the YZ plane. */
const CHAIN: SketchData = {
    entities: [
        { id: 1, type: "line", params: [103.36880974293557, 0, 48.44945353505801, 57.52285372301863] },
    ],
    constraints: [],
};

const worldChainBox = (sketch: SketchNode) => {
    const edges = sketch.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.map((edge) => edge.boundingBox()).reduce((a, b) => BoundingBox.combine(a, b)!);
};

describe("rib after the plate was fused into the boss", () => {
    test("is committed to the host only, leaving the consumed tool clean", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const circleNode = new SketchNode({ document: doc, plane: Plane.XY, data: CIRCLE });
        const chainNode = new SketchNode({ document: doc, plane: Plane.YZ, data: CHAIN });
        doc.modelManager.addNode(circleNode);
        doc.modelManager.addNode(chainNode);
        const host = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: circleNode.id, depth: 100 }],
        });
        doc.modelManager.addNode(host);
        const plate = new ParametricBodyNode({ document: doc, features: [BOX as FeatureData] });
        doc.modelManager.addNode(plate);

        // What `FuseFeatureCommand` commits: consumed tools (the default) are moved under the host.
        host.setFeaturesEmitShapeChanged([
            ...host.features,
            {
                id: "b1",
                type: "boolean",
                operation: "fuse",
                toolIds: [plate.id],
                consumeTools: true,
            } satisfies BooleanFeatureData,
        ]);
        expect(plate.parent).toBe(host);

        // The chain's box meets the plate as well — the second target is what put the rib onto
        // the hidden body too, where its own chain reported "The rib does not reach the body".
        // Asserted first, so a moved number cannot quietly turn this into a one-target test.
        const chainBox = worldChainBox(chainNode);
        expect(BoundingBox.isIntersect(chainBox, plate.shape.unchecked()!.boundingBox())).toBe(true);
        const targets = resolveTargetBodies(doc, chainBox, AUTO_TARGETS);
        expect(targets).toEqual([host]);

        commitBooleanTargets(
            doc,
            {
                id: "r1",
                type: "rib",
                sketchId: chainNode.id,
                entityIds: [1],
                thickness: 8,
                operation: "fuse",
            } satisfies RibFeatureData,
            "fuse",
            targets,
        );

        expect(host.features.map((feature) => feature.type)).toEqual(["extrude", "boolean", "rib"]);
        expect(plate.features.map((feature) => feature.type)).toEqual(["primitive"]);
        expect(host.featureItems().map((item) => item.error)).toEqual([undefined, undefined, undefined]);
        expect(plate.featureItems().map((item) => item.error)).toEqual([undefined]);
        // The gusset fills the corner between the plate's top and the boss's side.
        expect(
            host.shape.unchecked()!.containsPoint(new XYZ({ x: 0, y: 70, z: 10 }), false, Precision.Distance),
        ).toBe(true);
    });
});
