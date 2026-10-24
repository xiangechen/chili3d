// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    AsyncController,
    type IFace,
    Matrix4,
    Plane,
    type ShapeMeshData,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { gripOf, PressPullHandler } from "../../src/commands/pressPullStep";
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

describe("gripOf on a real cylinder wall", () => {
    test("the arrow answers on the side the pointer landed, not the seam's", () => {
        const rod = shapeFactory.cylinder({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 10, 30);
        expect(rod.isOk).toBe(true);
        const wall = (rod.value.findSubShapes(ShapeTypes.face) as IFace[]).find(
            (face) => !face.surface().isPlanar(),
        );
        expect(wall).toBeDefined();
        // A viewport pick reports the MESH intersection, off the analytic surface by the
        // deflection (0.011 mm measured on this r=10 wall) — an analytically exact point
        // like (-10, 0, 15) would take the direct `parameter` path and test nothing. Take
        // the triangle centroid deepest on the -X side instead: past the 1e-3 tolerance,
        // exactly what the viewport hands over. The seam sits at u = 0 (+X side).
        const mesh = wall!.mesh.faces!;
        let point: XYZ | undefined;
        for (let t = 0; t + 2 < mesh.index.length; t += 3) {
            const [a, b, c] = [mesh.index[t] * 3, mesh.index[t + 1] * 3, mesh.index[t + 2] * 3];
            const centroid = new XYZ({
                x: (mesh.position[a] + mesh.position[b] + mesh.position[c]) / 3,
                y: (mesh.position[a + 1] + mesh.position[b + 1] + mesh.position[c + 1]) / 3,
                z: (mesh.position[a + 2] + mesh.position[b + 2] + mesh.position[c + 2]) / 3,
            });
            if (point === undefined || centroid.x < point.x) point = centroid;
        }
        expect(point).toBeDefined();
        expect(point!.x).toBeLessThan(-9.9);
        // The premise: this pick does NOT meet the direct parameter tolerance.
        expect(wall!.surface().parameter(point!, 1e-3)).toBeUndefined();

        const grip = gripOf({
            shape: wall!,
            owner: {} as any,
            transform: Matrix4.identity(),
            indexes: [0],
            point: point!,
        });

        expect(grip).toBeDefined();
        expect(grip!.origin).toBe(point!);
        expect(grip!.direction.length()).toBeCloseTo(1, 6);
        // The radial at the pick, not the seam's (+1, 0, 0) — which would read dot ≈ -1 here.
        const radial = new XYZ({ x: point!.x, y: point!.y, z: 0 }).normalize()!;
        expect(grip!.direction.dot(radial)).toBeGreaterThan(0.99);
    });
});
