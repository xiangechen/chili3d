// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type INode,
    Matrix4,
    NodeUtils,
    Plane,
    Result,
    Serializer,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { EdgeRef } from "../src/features/edgeRef";
import type {
    BooleanFeatureData,
    ExtrudeFeatureData,
    FeatureData,
    FilletFeatureData,
    RevolveFeatureData,
} from "../src/features/feature";

import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 1, 0] },
        { id: 2, type: "line", params: [1, 0, 1, 1] },
        { id: 3, type: "line", params: [1, 1, 0, 1] },
        { id: 4, type: "line", params: [0, 1, 0, 0] },
    ],
    constraints: [],
};

function edge(start: XYZ, end: XYZ) {
    return {
        shapeType: ShapeTypes.edge,
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        isEqual: () => false,
    };
}

const EDGE_REF: EdgeRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } };

function subEdge() {
    return {
        shapeType: ShapeTypes.edge,
        index: 3,
        curve: { basisCurve: { direction: { x: 1, y: 0, z: 0 } } },
        startPoint: () => ({ x: 0, y: 0, z: 0 }) as XYZ,
        endPoint: () => ({ x: 1, y: 0, z: 0 }) as XYZ,
        isEqual: () => false,
    };
}

function setupMocks() {
    const filletSub = subEdge();
    const filletedShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [filletSub] : []),
        mesh: { edges: { range: [{ shape: filletSub }] } },
    };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
    const combine = rs.fn((edges: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const wire = rs.fn((edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }));
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
        }),
    );
    // A rebuild produces fresh shape objects, like the real OCCT factory does.
    const prismShapes: any[] = [];
    const prism = rs.fn((_face: any, _vec: XYZ) => {
        const sub = subEdge();
        const shape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [sub] : []),
            mesh: { edges: { range: [{ shape: sub }] } },
        };
        prismShapes.push(shape);
        return Result.ok(shape);
    });
    const fillet = rs.fn((_shape: any, _indexes: number[], _radius: number) => Result.ok(filletedShape));
    const restore = mockShapeFactory({ line, combine, wire, face, prism, fillet });
    return { line, combine, wire, face, prism, fillet, prismShapes, filletedShape, restore };
}

function extrudeFeature(sketchId: string, length = 5): ExtrudeFeatureData {
    return { id: "f1", type: "extrude", sketchId, length };
}

describe("ParametricBodyNode", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    function mockSelection() {
        const selection = {
            clearSelection: rs.fn(),
            setSelectedShapes: rs.fn(),
            setSelectedNodes: rs.fn(),
        };
        doc.selection = selection as any;
        return selection;
    }

    test("extrudes the sketch profile along its plane normal", () => {
        const body = bodyWith([extrudeFeature(sketch.id, 5)]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.prismShapes[0]);
        const vec = (mocks.prism.mock.calls[0] as unknown as [any, XYZ])[1];
        expect([vec.x, vec.y, vec.z]).toEqual([0, 0, 5]);
    });

    test("rebuilds when the referenced sketch changes", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();

        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [0, 0, 2, 0] },
                { id: 2, type: "line", params: [2, 0, 2, 2] },
                { id: 3, type: "line", params: [2, 2, 0, 2] },
                { id: 4, type: "line", params: [0, 2, 0, 0] },
            ],
            constraints: [],
        });

        expect(mocks.prism).toHaveBeenCalledTimes(1);
    });

    test("keeps the last good shape when a rebuild triggered by the sketch fails", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        const lastGood = body.shape.unchecked();
        mocks.prism.mockClear();

        // Single line = open profile, so the rebuild fails
        sketch.setDataEmitShapeChanged({
            entities: [{ id: 1, type: "line", params: [0, 0, 1, 0] }],
            constraints: [],
        });

        expect(mocks.prism).not.toHaveBeenCalled();
        expect(body.shape.unchecked()).toBe(lastGood);
        expect(body.featureItems()[0].error).toBe("Sketch profile is not closed");
    });

    test("fails when the referenced sketch is missing", () => {
        const body = bodyWith([extrudeFeature("no-such-sketch")]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Sketch not found");
        expect(body.featureItems()[0].error).toBe("Sketch not found");
    });

    test("a persisted failure is not re-evaluated on every shape read", () => {
        // The circle ref can never match the prism's line edges, so the fillet —
        // and the whole chain — fails deterministically after the extrude ran.
        const circleRef: EdgeRef = {
            kind: "circle",
            center: { x: 0, y: 0, z: 0 },
            radius: 1,
            axis: { x: 0, y: 0, z: 1 },
        };
        const body = bodyWith([
            extrudeFeature(sketch.id),
            { id: "f2", type: "fillet", radius: 2, edges: [circleRef] },
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(mocks.prism).toHaveBeenCalledTimes(1);

        void body.shape;
        void body.shape;
        expect(mocks.prism).toHaveBeenCalledTimes(1);
    });

    test("retries when a missing reference appears later", () => {
        const body = bodyWith([extrudeFeature("late-sketch")]);
        expect(body.shape.isOk).toBe(false);

        doc.modelManager.addNode(
            new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE, id: "late-sketch" }),
        );

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prism).toHaveBeenCalledTimes(1);
    });

    test("setFeatureParameter updates the length and rebuilds", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "length", 12));

        const vec = (mocks.prism.mock.calls[0] as unknown as [any, XYZ])[1];
        expect(vec.z).toBe(12);
        expect(body.features[0]).toMatchObject({ length: 12 });
    });

    test("feature edits undo and redo as one step", () => {
        const body = bodyWith([extrudeFeature(sketch.id, 5)]);

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "length", 12));
        doc.history.undo();
        expect(body.features[0]).toMatchObject({ length: 5 });
        doc.history.redo();
        expect(body.features[0]).toMatchObject({ length: 12 });
    });

    test("removeFeature with no features left yields an empty compound", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        mocks.combine.mockClear();

        Transaction.execute(doc, "remove feature", () => body.removeFeature("f1"));

        expect(body.features).toEqual([]);
        expect(body.shape.isOk).toBe(true);
        expect(mocks.combine).toHaveBeenCalledTimes(1);
        expect((mocks.combine.mock.calls[0] as unknown as [any[]])[0]).toEqual([]);
    });

    test("unknown feature types fail with a clear error", () => {
        const body = new ParametricBodyNode({
            document: doc,
            featuresJson: JSON.stringify([{ id: "f9", type: "loft" }]),
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Unknown feature type: loft");
        expect(body.featureItems()[0].error).toBe("Unknown feature type: loft");
    });

    test("featureItems exposes localized display and parameters", () => {
        const body = bodyWith([extrudeFeature(sketch.id, 7)]);
        expect(body.shape.isOk).toBe(true);

        const items = body.featureItems();

        expect(items.length).toBe(1);
        expect(items[0].display).toBe("command.feature.extrude");
        expect(items[0].icon).toBe("icon-prism");
        expect(items[0].error).toBeUndefined();
        expect(items[0].parameters).toEqual([
            { key: "length", display: "common.length", value: 7 },
            { key: "symmetric", display: "option.command.symmetric", value: false },
        ]);
    });

    test("Serializer round-trips the feature list", () => {
        const body = bodyWith([extrudeFeature(sketch.id, 9)]);

        const serialized = Serializer.serializeObject(body);
        const restored = Serializer.deserializeObject(doc, serialized) as ParametricBodyNode;

        expect(restored).toBeInstanceOf(ParametricBodyNode);
        expect(restored.features).toEqual(body.features);
    });

    test("suppressed features are skipped during evaluation", () => {
        const fillet: FilletFeatureData = {
            id: "f2",
            type: "fillet",
            radius: 2,
            edges: [EDGE_REF],
            suppressed: true,
        };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.prismShapes[0]);
        expect(mocks.fillet).not.toHaveBeenCalled();
        expect(body.featureItems()[1].suppressed).toBe(true);
    });

    test("unsuppressing a feature re-evaluates the chain", () => {
        const fillet: FilletFeatureData = {
            id: "f2",
            type: "fillet",
            radius: 2,
            edges: [EDGE_REF],
            suppressed: true,
        };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mocks.fillet.mockClear();

        Transaction.execute(doc, "unsuppress", () => body.setFeatureSuppressed("f2", false));

        expect(mocks.fillet).toHaveBeenCalledTimes(1);
        expect(body.shape.unchecked()).toBe(mocks.filletedShape);
    });

    test("moveFeature swaps the feature order and rebuilds", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        const lastGood = body.shape.unchecked();

        Transaction.execute(doc, "reorder", () => body.moveFeature("f2", -1));

        expect(body.features.map((f) => f.id)).toEqual(["f2", "f1"]);
        // Fillet now runs first with no preceding shape; the failed rebuild keeps the
        // last good shape and surfaces the error in the feature panel instead.
        expect(body.shape.unchecked()).toBe(lastGood);
        expect(body.featureItems()[0].error).toBe("fillet requires a preceding feature");
    });

    test("moveFeature ignores out-of-range moves", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);

        body.moveFeature("f1", -1);

        expect(body.features.map((f) => f.id)).toEqual(["f1"]);
    });

    test("moveFeatureTo moves a feature to an absolute index", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const fillet2: FilletFeatureData = { id: "f3", type: "fillet", radius: 1, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet, fillet2]);

        Transaction.execute(doc, "reorder", () => body.moveFeatureTo("f1", 2));

        expect(body.features.map((f) => f.id)).toEqual(["f2", "f3", "f1"]);

        doc.history.undo();
        expect(body.features.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    });

    test("moveFeatureTo clamps out-of-range indexes", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);

        body.moveFeatureTo("f1", 99);
        expect(body.features.map((f) => f.id)).toEqual(["f2", "f1"]);

        body.moveFeatureTo("f1", -3);
        expect(body.features.map((f) => f.id)).toEqual(["f1", "f2"]);
    });

    test("renameFeature sets and clears a custom name without rebuilding", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        const lastGood = body.shape.unchecked();

        Transaction.execute(doc, "rename", () => body.renameFeature("f1", "Main extrude"));

        expect(body.featureItems()[0].name).toBe("Main extrude");
        expect(body.shape.unchecked()).toBe(lastGood);

        body.renameFeature("f1", "");
        expect(body.featureItems()[0].name).toBeUndefined();

        doc.history.undo();
        expect(body.featureItems()[0].name).toBe("Main extrude");
    });

    test("reselectShapes replaces the feature edges", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();

        const pickedEdge = {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: { x: 0, y: 1, z: 0 } } },
            startPoint: () => ({ x: 5, y: 5, z: 0 }),
            endPoint: () => ({ x: 5, y: 6, z: 0 }),
        };
        doc.picker.pickShape = rs.fn(() =>
            Promise.resolve([{ shape: pickedEdge, indexes: [0] } as any]),
        ) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        expect(body.features[1]).toMatchObject({
            edges: [{ kind: "line", start: { x: 5, y: 5, z: 0 }, end: { x: 5, y: 6, z: 0 } }],
        });
        // The rebuilt prism's single edge is the only candidate, so the moved edge
        // re-matches to it and the fillet applies without an error row.
        expect(body.featureItems()[1].error).toBeUndefined();
        expect(mocks.fillet).toHaveBeenCalled();
        // Only the final edge replacement is recorded — the rollback preview is not.
        expect(doc.history.undoCount()).toBe(undoCount + 1);
        doc.history.undo();
        expect(body.features[1]).toMatchObject({ edges: [EDGE_REF] });
    });

    test("reselectShapes pre-selects the currently referenced edges", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        const selection = mockSelection();
        const owner = { worldTransform: () => Matrix4.identity() };
        doc.visual.context.getVisual = () => owner as any;
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;
        // Node additions are already on the history; the pick session must not add more.
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        expect(selection.clearSelection).toHaveBeenCalledTimes(1);
        const call = selection.setSelectedShapes.mock.calls[0] as unknown as [any[], any, boolean];
        expect(call).toBeDefined();
        expect(call[0].length).toBe(1);
        expect(call[0][0].owner).toBe(owner);
        expect(call[0][0].indexes).toEqual([0]);
        expect(call[2]).toBe(false);
        // After the pick the body node is selected again so the feature panel reopens.
        expect(selection.setSelectedNodes).toHaveBeenCalledWith([body], false);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes rolls the list back while picking and restores it on cancel", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        let featuresWhilePicking: unknown;
        doc.picker.pickShape = rs.fn(() => {
            featuresWhilePicking = body.features;
            return Promise.resolve([]);
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        // The fillet is suppressed while picking (the view shows its input shape),
        // and the original list is restored afterwards without touching the history.
        expect(featuresWhilePicking).toMatchObject([{ id: "f1" }, { id: "f2", suppressed: true }]);
        expect(body.features).toMatchObject([{ id: "f1" }, { id: "f2", edges: [EDGE_REF] }]);
        expect(body.shape.isOk).toBe(true);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes ignores features without shape references", async () => {
        const body = bodyWith([{ id: "v1", type: "variable", name: "a", expression: "1" }]);
        const pickShape = rs.fn(() => Promise.resolve([]));
        doc.picker.pickShape = pickShape as any;

        await body.reselectShapes("v1");

        expect(pickShape).not.toHaveBeenCalled();
    });

    test("reselectShapes replaces the extrude profiles", async () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        mockSelection();
        const pickedFace = {
            shapeType: ShapeTypes.face,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [subEdge()] : []),
        };
        doc.picker.pickShape = rs.fn(() =>
            Promise.resolve([{ shape: pickedFace, indexes: [0] } as any]),
        ) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f1");

        // The sketch's profile faces stay shown; the pick no longer toggles them.
        expect(sketch.showProfileFaces).toBe(true);
        expect(body.features[0]).toMatchObject({
            profiles: [{ edges: [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }] }],
        });
        expect(doc.history.undoCount()).toBe(undoCount + 1);
    });
    test("reselectShapes with an empty pick clears the extrude profiles", async () => {
        const extrude: ExtrudeFeatureData = {
            ...extrudeFeature(sketch.id),
            profiles: [{ edges: [EDGE_REF] }],
        };
        const body = bodyWith([extrude]);
        mockSelection();
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;

        await body.reselectShapes("f1");

        expect((body.features[0] as ExtrudeFeatureData).profiles).toBeUndefined();
    });

    test("reselectShapes cancel keeps the extrude profiles unchanged", async () => {
        const extrude: ExtrudeFeatureData = {
            ...extrudeFeature(sketch.id),
            profiles: [{ edges: [EDGE_REF] }],
        };
        const body = bodyWith([extrude]);
        mockSelection();
        doc.picker.pickShape = rs.fn((_prompt: any, controller: any) => {
            controller.cancel();
            return Promise.resolve([]);
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f1");

        expect(body.features[0]).toMatchObject({ profiles: [{ edges: [EDGE_REF] }] });
        expect(doc.history.undoCount()).toBe(undoCount);
        expect(sketch.showProfileFaces).toBe(true);
    });

    test("editing a later feature reuses cached prefix results", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();
        mocks.fillet.mockClear();

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f2", "radius", 5));

        expect(mocks.prism).not.toHaveBeenCalled();
        expect(mocks.fillet).toHaveBeenCalledTimes(1);
        const [, , radius] = mocks.fillet.mock.calls[0] as unknown as [any, number[], number];
        expect(radius).toBe(5);
    });

    test("a sketch change invalidates the whole chain", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();
        mocks.fillet.mockClear();

        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [0, 0, 2, 0] },
                { id: 2, type: "line", params: [2, 0, 2, 2] },
                { id: 3, type: "line", params: [2, 2, 0, 2] },
                { id: 4, type: "line", params: [0, 2, 0, 0] },
            ],
            constraints: [],
        });

        expect(mocks.prism).toHaveBeenCalledTimes(1);
        expect(mocks.fillet).toHaveBeenCalledTimes(1);
    });

    test("evaluates each feature once even when the sketch generates mid-evaluation", () => {
        // No warm-up: the sketch shape is generated lazily during the body evaluation
        // and notifies the body — the re-entrancy guard keeps this a single pass.
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prism).toHaveBeenCalledTimes(1);
        expect(mocks.fillet).toHaveBeenCalledTimes(1);
    });

    test("evicted intermediate shapes are disposed, the current shape is kept", () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "length", 12));

        expect(mocks.prismShapes[0].dispose).toHaveBeenCalledTimes(1);
        expect(mocks.filletedShape.dispose).not.toHaveBeenCalled();
    });

    test("a document reload resolves sketch references after the tree is attached", async () => {
        bodyWith([extrudeFeature(sketch.id, 9)]);
        const data = doc.modelManager.serialize();

        const reloaded = new TestDocument({ application: createMockApplication() });
        // Mimic ThreeVisualContext: evaluate the shape of every displayed node as
        // node-change notifications arrive.
        reloaded.modelManager.addNodeObserver((records) => {
            const nodes: INode[] = [];
            records.forEach((r) => {
                if (r.action === "add") NodeUtils.nodeOrChildrenAppendToNodes(nodes, r.node);
            });
            nodes.forEach((n) => {
                if (n instanceof ParametricBodyNode) void n.shape;
            });
        });
        await reloaded.modelManager.deserialize(data);

        const body = reloaded.modelManager.findNode(
            (n) => n instanceof ParametricBodyNode,
        ) as ParametricBodyNode;
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].error).toBeUndefined();
    });
});

describe("ParametricBodyNode.referencedNodes", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    function revolveFeature(sketchId: string): RevolveFeatureData {
        return {
            id: "f2",
            type: "revolve",
            sketchId,
            axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
            angle: 90,
        };
    }

    test("should return the sketch referenced by an extrude feature", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.referencedNodes()).toEqual([sketch]);
    });

    test("should return sketches of extrude and revolve features in feature order", () => {
        const second = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(second);
        const body = bodyWith([extrudeFeature(sketch.id), revolveFeature(second.id)]);
        expect(body.referencedNodes()).toEqual([sketch, second]);
    });

    test("should dedupe a sketch referenced by multiple features", () => {
        const body = bodyWith([extrudeFeature(sketch.id), revolveFeature(sketch.id)]);
        expect(body.referencedNodes()).toEqual([sketch]);
    });

    test("should exclude boolean tool nodes", () => {
        const tool = bodyWith([extrudeFeature(sketch.id)]);
        const booleanFeature: BooleanFeatureData = {
            id: "f3",
            type: "boolean",
            operation: "fuse",
            toolIds: [tool.id],
        };
        const body = bodyWith([extrudeFeature(sketch.id), booleanFeature]);
        expect(body.referencedNodes()).toEqual([sketch]);
    });

    test("should exclude references that no longer resolve to a sketch", () => {
        const body = bodyWith([extrudeFeature("missing-sketch")]);
        expect(body.referencedNodes()).toEqual([]);
    });
});
