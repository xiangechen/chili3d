// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Matrix4, Plane, ShapeTypes, VisualStates, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import type { ShellFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";

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

/** A plate whose top face is opened by a shell — the feature the re-pick edits. */
function shelledPlate() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    (doc.application as any).activeView = { document: doc };

    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const top = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "s1",
            type: "shell",
            faces: [captureProfileRef(faces[top], body.faceIdAt(top))],
            thickness: 2,
        } satisfies ShellFeatureData,
    ]);

    const selection = {
        clearSelection: rs.fn(),
        setSelectedShapes: rs.fn(),
        setSelectedNodes: rs.fn(),
        onShapeChanged: { sub: rs.fn(), remove: rs.fn() },
    };
    doc.selection = selection as any;
    const owner = { node: body, worldTransform: () => Matrix4.identity() };
    doc.visual.context.getVisual = (() => owner) as any;
    (doc.visual as any).highlighter = { addState: rs.fn(), removeState: rs.fn() };
    doc.visual.context.displayMesh = rs.fn(() => 1) as any;
    doc.visual.context.removeMesh = rs.fn() as any;
    return { doc, body, selection, owner };
}

const shellFeature = (body: ParametricBodyNode) => body.features[1] as ShellFeatureData;

describe("re-picking a shell's open faces", () => {
    test("the confirmed faces replace the feature's own", async () => {
        const { doc, body } = shelledPlate();
        const before = shellFeature(body).faces;
        const undoCount = doc.history.undoCount();
        let bottomIndex = -1;

        // The pick runs against the ROLLED-BACK plate, whose bottom face is what gets opened.
        doc.picker.pickShape = rs.fn(() => {
            const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
            bottomIndex = faces.findIndex((face) => face.normal(0, 0)[1].z < -1 + 1e-6);
            return Promise.resolve([
                {
                    shape: faces[bottomIndex],
                    owner: { node: body, worldTransform: () => Matrix4.identity() },
                    transform: Matrix4.identity(),
                    indexes: [bottomIndex],
                    point: XYZ.zero,
                },
            ]);
        }) as any;

        await body.reselectShapes("s1");

        const after = shellFeature(body).faces;
        expect(after).toHaveLength(1);
        expect(after[0].id).not.toBe(before[0].id);
        expect(after[0].id).toBeDefined();
        // The rebuilt body is the plate hollowed from the other end, and nothing else moved.
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(body.shape.unchecked()!.boundingBox().max.z).toBe(20);
        // One undo step for the pair, and undo brings the original opening back.
        expect(doc.history.undoCount()).toBe(undoCount + 1);
        doc.history.undo();
        expect(shellFeature(body).faces[0].id).toBe(before[0].id);
    });

    test("the pick runs on the rolled-back chain, and the full chain comes back after", async () => {
        const { doc, body } = shelledPlate();
        let rollbackWhilePicking: number | undefined;
        let featuresWhilePicking: unknown;

        doc.picker.pickShape = rs.fn(() => {
            rollbackWhilePicking = body.rollbackIndex;
            featuresWhilePicking = body.features;
            return Promise.resolve([]);
        }) as any;

        await body.reselectShapes("s1");

        // The faces the feature names belong to its INPUT, so the replay is truncated at the
        // shell for the whole pick — runtime only, the feature list is never rewritten.
        expect(rollbackWhilePicking).toBe(1);
        expect(featuresWhilePicking).toMatchObject([{ id: "e1" }, { id: "s1" }]);
        expect(body.rollbackIndex).toBeUndefined();
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    });

    test("cancelling keeps the stored faces", async () => {
        const { doc, body } = shelledPlate();
        const before = shellFeature(body).faces;
        const undoCount = doc.history.undoCount();
        // Nothing picked: there is no "no faces" answer, so the confirm is a cancel.
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;

        await body.reselectShapes("s1");

        expect(shellFeature(body).faces).toEqual(before);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("the session opens with the referenced faces already selected", async () => {
        const { doc, body, selection, owner } = shelledPlate();
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;

        await body.reselectShapes("s1");

        const call = (selection.setSelectedShapes as any).mock.calls[0] as [any[], any, boolean];
        expect(call).toBeDefined();
        expect(call[0]).toHaveLength(1);
        expect(call[0][0].owner).toBe(owner);
        expect(call[1]).toBe(VisualStates.faceSelected);
        // The body is ghosted for the session so its faces do not fight the preview mesh.
        expect((doc.visual.highlighter as any).addState).toHaveBeenCalledWith(
            owner,
            VisualStates.faceTransparent,
            ShapeTypes.solid,
        );
        // Re-selected afterwards so the feature panel stays open.
        expect(selection.setSelectedNodes).toHaveBeenCalledWith([body], false);
    });

    test("a thicken's source faces are re-picked the same way, into `source.profiles`", async () => {
        const { doc, body } = shelledPlate();
        // A thicken over the shell — its refs live one level deeper, which is the point.
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const top = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "t1",
                type: "thicken",
                source: { nodeId: body.id, profiles: [captureProfileRef(faces[top], body.faceIdAt(top))] },
                thickness: 2,
            },
        ]);
        const before = (body.features[2] as any).source.profiles;

        let pickedIndex = -1;
        doc.picker.pickShape = rs.fn(() => {
            const rolled = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
            pickedIndex = rolled.findIndex((face) => face.normal(0, 0)[1].z < -1 + 1e-6);
            return Promise.resolve([
                {
                    shape: rolled[pickedIndex],
                    owner: { node: body, worldTransform: () => Matrix4.identity() },
                    transform: Matrix4.identity(),
                    indexes: [pickedIndex],
                    point: XYZ.zero,
                },
            ]);
        }) as any;

        await body.reselectShapes("t1");

        const after = (body.features[2] as any).source.profiles;
        expect(after).toHaveLength(1);
        expect(after[0].id).not.toBe(before[0].id);
    });
});
