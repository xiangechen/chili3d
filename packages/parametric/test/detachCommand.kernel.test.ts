// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type BodyInstanceNode,
    FaceMaterialPair,
    type IFace,
    type INode,
    Matrix4,
    Mesh,
    MeshInstanceNode,
    MeshNode,
    Plane,
    PubSub,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { DetachCommand } from "../src/commands/detachCommand";
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

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function extent(node: { boundingBox(): any }): number[] {
    const box = node.boundingBox();
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

function scene() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc) as any;
    const selected: INode[] = [];
    doc.selection = {
        getSelectedShapes: () => [],
        getSelectedNodes: () => [],
        setSelectedShapes: () => {},
        setSelectedNodes: (nodes: INode[]) => selected.push(...nodes),
        clearSelection: () => {},
        onShapeChanged: { sub: () => {}, remove: () => {} },
    } as any;

    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 10, 10) });
    doc.modelManager.addNode(sketch);
    const faces = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: [captureProfileRef(faces[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const instance = body.cloneForCopy(Matrix4.fromTranslation(100, 0, 0)) as BodyInstanceNode;
    doc.modelManager.addNode(instance);

    return { app, doc, sketch, body, instance, selected };
}

function detach(app: any, doc: TestDocument, instance: INode): void {
    const command = new DetachCommand();
    (command as any)._application = app;
    (command as any).stepDatas = [{ nodes: [instance], shapes: [], type: "node" }];
    (command as any).executeMainTask();
    doc.visual.update();
}

describe("DetachCommand", () => {
    test("replaces the instance with an independent body at the same placement", () => {
        const { app, doc, body, instance, selected } = scene();
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);

        detach(app, doc, instance);

        expect(doc.modelManager.findNode((x) => x.id === instance.id)).toBeUndefined();
        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        expect(selected).toEqual([copy]);
        expect(copy).toBeInstanceOf(ParametricBodyNode);
        expect(extent(copy)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(copy.features.at(-1)!.type).toBe("transform");
        expect(copy.transform.equals(Matrix4.identity())).toBe(true);
    });

    test("keeps the instance's own paint instead of the source's", () => {
        const { app, doc, body, instance } = scene();
        body.materialId = "source-material";
        Transaction.execute(doc, "paint instance", () => {
            instance.materialId = ["instance-material"];
            instance.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })];
        });

        detach(app, doc, instance);

        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        expect(copy.materialId).toEqual(["instance-material"]);
        expect(copy.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex])).toEqual([[0, 0]]);
        expect(copy.faceMaterialPair[0]).not.toBe(instance.faceMaterialPair[0]);
        expect(body.materialId).toBe("source-material");
    });

    test("copies the sketch, so editing the source no longer reaches the copy", () => {
        const { app, doc, sketch, body, instance } = scene();
        detach(app, doc, instance);
        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        const copiedFeature = copy.features[0] as ExtrudeFeatureData;
        expect(copiedFeature.sketchId).not.toBe(sketch.id);

        Transaction.execute(doc, "edit source sketch", () => {
            sketch.setDataEmitShapeChanged(rect(0, 0, 20, 20));
        });

        expect(extent(body)).toEqual([0, 0, 0, 20, 20, 10]);
        expect(extent(copy)).toEqual([100, 0, 0, 110, 10, 10]);
    });

    test("materializes the rollback bar so the copy shows what the instance showed", () => {
        const { app, doc, body, instance } = scene();
        const boss = new SketchNode({
            document: doc,
            plane: new Plane({
                origin: new XYZ({ x: 0, y: 0, z: 10 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            }),
            data: rect(2, 2, 4, 4),
        });
        doc.modelManager.addNode(boss);
        const bossFace = boss.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        Transaction.execute(doc, "add boss", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id: "e2",
                    type: "extrude",
                    sketchId: boss.id,
                    depth: 5,
                    operation: "fuse",
                    profiles: [captureProfileRef(bossFace[0].shape as unknown as IFace)],
                },
            ]);
        });
        Transaction.execute(doc, "rollback", () => {
            body.rollbackBarIndex = 1;
        });
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);

        detach(app, doc, instance);

        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        expect(extent(copy)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(copy.features.some((x) => x.id === "e2")).toBe(false);
        expect(copy.rollbackBarIndex).toBeUndefined();
    });

    test("does not replay the features the rollback bar hides", () => {
        const { app, doc, body, instance } = scene();
        // A second valid feature makes the bar position 1 reachable.
        const boss = new SketchNode({
            document: doc,
            plane: new Plane({
                origin: new XYZ({ x: 0, y: 0, z: 10 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            }),
            data: rect(2, 2, 4, 4),
        });
        doc.modelManager.addNode(boss);
        const bossFace = boss.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        Transaction.execute(doc, "add boss", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id: "e2",
                    type: "extrude",
                    sketchId: boss.id,
                    depth: 5,
                    operation: "fuse",
                    profiles: [captureProfileRef(bossFace[0].shape as unknown as IFace)],
                },
            ]);
        });
        Transaction.execute(doc, "rollback", () => {
            body.rollbackBarIndex = 1;
        });
        // A hidden feature that cannot evaluate: clearing the bar through the property
        // setter would rebuild the full chain and surface its error.
        Transaction.execute(doc, "hide a broken feature", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                { id: "bad", type: "transform", matrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
            ]);
        });
        expect(body.rollbackBarIndex).toBe(1);

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            detach(app, doc, instance);
            const errors = pub.mock.calls.filter(([topic]) => topic === "displayError");
            expect(errors).toHaveLength(0);
        } finally {
            pub.mockRestore();
        }

        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        expect(copy.features.some((x) => x.id === "bad")).toBe(false);
        expect(copy.rollbackBarIndex).toBeUndefined();
    });

    test("copies consumed tools so the copy survives deleting the source", () => {
        const { app, doc, body, instance } = scene();
        const toolSketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(5, 5, 15, 15) });
        doc.modelManager.addNode(toolSketch);
        const faces = toolSketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const tool = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "t1",
                    type: "extrude",
                    sketchId: toolSketch.id,
                    depth: 10,
                    profiles: [captureProfileRef(faces[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(tool);
        Transaction.execute(doc, "cut", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                { id: "b1", type: "boolean", operation: "cut", toolIds: [tool.id] },
            ]);
        });

        detach(app, doc, instance);

        // The detach also clones the tool body; pick the copy by its boolean feature.
        const copy = doc.modelManager.findNode(
            (x) =>
                x instanceof ParametricBodyNode &&
                x.id !== body.id &&
                x.features.some((f) => f.type === "boolean"),
        ) as ParametricBodyNode;
        const boolean = copy.features.find((x) => x.type === "boolean");
        expect(boolean?.type).toBe("boolean");
        const copiedToolId = (boolean as { toolIds: string[] }).toolIds[0];
        expect(copiedToolId).not.toBe(tool.id);
        // The copy adopts the tool as a consumed child, so it stays hidden in the tree.
        const copiedTool = doc.modelManager.findNode((x) => x.id === copiedToolId)!;
        expect(copiedTool.parent).toBe(copy);
        // The tool's own sketch is copied too, not shared with the source's tool.
        const copiedToolFeature = (copiedTool as ParametricBodyNode).features[0] as ExtrudeFeatureData;
        expect(copiedToolFeature.sketchId).not.toBe(toolSketch.id);
        expect(doc.modelManager.findNodeDeep((x) => x.id === copiedToolFeature.sketchId)).toBeInstanceOf(
            SketchNode,
        );

        // The source and its consumed tool go away; the copy keeps working.
        body.parent?.remove(body);
        toolSketch.parent?.remove(toolSketch);
        expect(doc.modelManager.findNode((x) => x.id === copiedToolId)).toBe(copiedTool);
        expect(copiedTool.parent).toBe(copy);
        // Force a rebuild: a shared tool sketch would fail once the original is gone.
        Transaction.execute(doc, "rebuild copy", () => {
            copy.setFeaturesEmitShapeChanged([...copy.features]);
        });
        expect(copy.shape.isOk).toBe(true);
        const items = copy.featureItems();
        expect(items.map((x) => x.id).slice(0, 2)).toEqual(["e1", "b1"]);
        for (const item of items) expect(item.error).toBeUndefined();
    });

    test("keeps an unconsumed boolean tool shared instead of cloning it", () => {
        const { app, doc, body, instance } = scene();
        const toolSketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(5, 5, 15, 15) });
        doc.modelManager.addNode(toolSketch);
        const faces = toolSketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const tool = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "t1",
                    type: "extrude",
                    sketchId: toolSketch.id,
                    depth: 10,
                    profiles: [captureProfileRef(faces[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(tool);
        Transaction.execute(doc, "cut", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id: "b1",
                    type: "boolean",
                    operation: "cut",
                    toolIds: [tool.id],
                    consumeTools: false,
                },
            ]);
        });

        detach(app, doc, instance);

        const copy = doc.modelManager.findNode(
            (x) =>
                x instanceof ParametricBodyNode &&
                x.id !== body.id &&
                x.features.some((f) => f.type === "boolean"),
        ) as ParametricBodyNode;
        const boolean = copy.features.find((x) => x.type === "boolean") as { toolIds: string[] };
        expect(boolean.toolIds).toEqual([tool.id]);
        expect(
            doc.modelManager
                .findNodes((x) => x instanceof ParametricBodyNode)
                .map((x) => x.id)
                .sort(),
        ).toEqual([body.id, tool.id, copy.id].sort());
    });

    test("detaches a mesh instance into an independent mesh node", () => {
        const { app, doc } = scene();
        const mesh = new Mesh({
            meshType: "surface",
            position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
            uv: new Float32Array([0, 0, 1, 0, 0, 1]),
            index: new Uint32Array([0, 1, 2]),
        });
        const meshSource = new MeshNode({ document: doc, name: "mesh", mesh });
        doc.modelManager.addNode(meshSource);
        const instance = MeshInstanceNode.fromSource(meshSource, Matrix4.fromTranslation(50, 0, 0));
        instance.materialId = "instance-material";
        doc.modelManager.addNode(instance);

        detach(app, doc, instance);

        expect(doc.modelManager.findNode((x) => x.id === instance.id)).toBeUndefined();
        const copy = doc.modelManager.findNode(
            (x) => x instanceof MeshNode && x.id !== meshSource.id,
        ) as MeshNode;
        expect(copy.transform.equals(Matrix4.fromTranslation(50, 0, 0))).toBe(true);
        expect(copy.materialId).toBe("instance-material");
        expect(copy.mesh).not.toBe(meshSource.mesh);
        expect(doc.modelManager.findNode((x) => x.id === meshSource.id)).toBe(meshSource);
    });

    test("detaches a body with no feature chain as a plain copy", () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.visual = createMockVisualWithDocument(doc) as any;
        const selected: INode[] = [];
        doc.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [],
            setSelectedShapes: () => {},
            setSelectedNodes: (nodes: INode[]) => selected.push(...nodes),
            clearSelection: () => {},
            onShapeChanged: { sub: () => {}, remove: () => {} },
        } as any;

        const body = new ParametricBodyNode({ document: doc, features: [] });
        body.transform = Matrix4.fromTranslation(30, 0, 0);
        doc.modelManager.addNode(body);
        const instance = body.cloneForCopy(Matrix4.fromTranslation(0, 20, 0)) as BodyInstanceNode;
        doc.modelManager.addNode(instance);

        detach(app, doc, instance);

        expect(doc.modelManager.findNode((x) => x.id === instance.id)).toBeUndefined();
        const copy = doc.modelManager.findNode(
            (x) => x instanceof ParametricBodyNode && x.id !== body.id,
        ) as ParametricBodyNode;
        expect(copy.features).toHaveLength(0);
        expect(copy.transform.equals(Matrix4.fromTranslation(30, 20, 0))).toBe(true);
        expect(doc.modelManager.findNode((x) => x.id === body.id)).toBe(body);
    });

    test("refuses an instance whose placement is not rigid", () => {
        const { app, doc, instance } = scene();
        instance.transform = Matrix4.fromScale(2, 1, 1);

        detach(app, doc, instance);

        expect(doc.modelManager.findNode((x) => x.id === instance.id)).toBe(instance);
    });

    test("the source body stays in the document", () => {
        const { app, doc, body, instance } = scene();

        detach(app, doc, instance);

        expect(doc.modelManager.findNode((x) => x.id === body.id)).toBe(body);
        expect(body.features.some((x) => x.type === "transform")).toBe(false);
    });
});
