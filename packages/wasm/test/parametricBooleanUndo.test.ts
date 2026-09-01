// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Reproduction for "redo after a consumed boolean reports: null is not a valid
// TopoDS_Shape" — the derived `shape` property is recorded in history, so redo
// re-applies a stale snapshot whose wasm shape cache eviction already disposed.

import { Plane, Transaction } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { ShapeFactory } from "@chili3d/wasm";
import "../../parametric/src/features"; // registers all feature handlers
import { ParametricBodyNode } from "../../parametric/src/parametricBodyNode";
import { type SketchData, SketchNode } from "../../parametric/src/sketch";
import "./setup";

// The global `shapeFactory` resolves through the current application — stub it.
const factory = new ShapeFactory();
Object.defineProperty(globalThis, "app", {
    configurable: true,
    get: () => ({ shapeProvider: { factory } }),
});

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 10, 0] },
        { id: 2, type: "line", params: [10, 0, 10, 10] },
        { id: 3, type: "line", params: [10, 10, 0, 10] },
        { id: 4, type: "line", params: [0, 10, 0, 0] },
    ],
    constraints: [],
};

function makeBody(doc: TestDocument, name: string) {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, length: 5 } as never],
    });
    body.setPrivateValue("name", name);
    doc.modelManager.addNode(body);
    return body;
}

describe("parametric boolean undo/redo with real OCCT shapes", () => {
    test("redo after undo of a consuming boolean does not crash and keeps a valid shape", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = makeBody(doc, "body1");
        const tool = makeBody(doc, "body2");

        Transaction.execute(doc, "fuse", () =>
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id: "b1",
                    type: "boolean",
                    operation: "fuse",
                    toolIds: [tool.id],
                    consumeTools: true,
                } as never,
            ]),
        );
        expect(tool.parent).toBe(body);
        expect(body.shape.isOk).toBe(true);
        const fusedShape = body.shape.unchecked();

        doc.history.undo();
        expect(tool.parent).toBe(doc.modelManager.rootNode);
        expect(body.shape.isOk).toBe(true);

        doc.history.redo();
        expect(tool.parent).toBe(body);
        expect(body.shape.isOk).toBe(true);
        // Redo must evaluate a fresh shape — re-applying the recorded (already
        // cache-evicted and disposed) snapshot crashes the kernel.
        expect(body.shape.unchecked()).not.toBe(fusedShape);
    });
});
