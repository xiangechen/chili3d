// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncController, Matrix4, Plane, type ShapeMeshData, ShapeTypes, XYZ } from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { PressPullHandler } from "../../src/commands/pressPullStep";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "../sketch/setup";

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

const RECT: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 40, 0] },
        { id: 2, type: "line", params: [40, 0, 40, 20] },
        { id: 3, type: "line", params: [40, 20, 0, 20] },
        { id: 4, type: "line", params: [0, 20, 0, 0] },
    ],
    constraints: [],
};

describe("PressPullHandler's profile preview", () => {
    /** The handler with the sketch's own profile face picked, as a click would leave it. */
    function profileDrag(distance: number) {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        // The handler tracks the camera through the view, so it needs a view that answers.
        (app as any).activeView = createHandlerMockView({ document: doc });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: RECT });
        doc.modelManager.addNode(sketch);
        const profile = (sketch.mesh.faces?.range ?? []).find((x) => x.shape.shapeType === ShapeTypes.face);
        expect(profile).toBeDefined();

        const handler = new PressPullHandler(doc, new AsyncController(), distance, () => {});
        (handler as any).picked.push({
            shape: profile!.shape,
            owner: { node: sketch },
            transform: Matrix4.identity(),
            indexes: [0],
            point: XYZ.zero,
        });
        return handler;
    }

    test("a drag on a sketch profile previews the prism it would make", () => {
        // A profile is EXTRUDED, not offset: a drag on one used to show nothing at all, because an
        // offset of a lone face is not a solid to move — and nothing is exactly what the user saw.
        const handler = profileDrag(5);
        try {
            const meshes = (handler as any).previewMeshes() as ShapeMeshData[];

            expect(meshes).toBeDefined();
            expect(meshes.length).toBeGreaterThan(0);
            // The prism stands 5 tall on the sketch's plane.
            const zs = meshes[0].position.filter((_, index) => index % 3 === 2);
            expect(Math.min(...zs)).toBeCloseTo(0, 6);
            expect(Math.max(...zs)).toBeCloseTo(5, 6);
        } finally {
            handler.dispose();
        }
    });

    test("dragging the other way previews the prism on the other side", () => {
        const handler = profileDrag(-5);
        try {
            const meshes = (handler as any).previewMeshes() as ShapeMeshData[];

            const zs = meshes[0].position.filter((_, index) => index % 3 === 2);
            expect(Math.min(...zs)).toBeCloseTo(-5, 6);
            expect(Math.max(...zs)).toBeCloseTo(0, 6);
        } finally {
            handler.dispose();
        }
    });
});
