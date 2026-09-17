// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    type INode,
    isCancelableCommand,
    Matrix4,
    NodeUtils,
    Plane,
    Result,
    Serializer,
    type ShapeType,
    ShapeTypes,
    Signal,
    Transaction,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockCancelableCommand,
    createMockCommand,
    nearestOnSegment,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ReselectFeatureCommand } from "../src/commands/reselectCommand";
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
        curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: () => [],
        boundingBox: () =>
            new BoundingBox(
                { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) },
            ),
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
    const wire = rs.fn((edges: any[]) =>
        Result.ok({
            isClosed: () => edges.length > 1,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
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

function extrudeFeature(sketchId: string, depth = 5): ExtrudeFeatureData {
    return { id: "f1", type: "extrude", sketchId, depth };
}

describe("ParametricBodyNode", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        // ReselectFeatureCommand.execute requires an active view to run against.
        doc.application.activeView = { document: doc } as any;
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
            onShapeChanged: new Signal<(selected: any[]) => void>(),
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

    test("follows a sketch referenced by several features only once per chain run", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "extrude", sketchId: sketch.id, depth: 3 },
        ]);
        expect(body.shape.isOk).toBe(true);
        const follow = rs.spyOn(sketch, "followExternalRefs");
        try {
            sketch.setDataEmitShapeChanged({
                entities: [
                    { id: 1, type: "line", params: [0, 0, 2, 0] },
                    { id: 2, type: "line", params: [2, 0, 2, 2] },
                    { id: 3, type: "line", params: [2, 2, 0, 2] },
                    { id: 4, type: "line", params: [0, 2, 0, 0] },
                ],
                constraints: [],
            });

            expect(follow).toHaveBeenCalledTimes(1);
        } finally {
            follow.mockRestore();
        }
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

    test("keeps unrelated feature warnings when the chain fails", () => {
        // A dangling profile-role external ref: the sketch degrades to frozen
        // geometry instead of failing, and the consuming feature row gets a warning.
        sketch.setDataEmitShapeChanged({
            ...SQUARE,
            externalRefs: [
                {
                    entityId: -100,
                    nodeId: "missing-source",
                    edge: {
                        kind: "line",
                        start: { x: 2, y: 2, z: 0 },
                        end: { x: 4, y: 2, z: 0 },
                    },
                    role: "profile",
                    snapshot: [2, 2, 4, 2],
                    type: "line",
                    dangling: true,
                },
            ],
        });
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].warning).toBe("Sketch has unresolved external references");

        // A failure in a later, unrelated feature must not wipe that warning.
        body.setFeaturesEmitShapeChanged([
            extrudeFeature(sketch.id),
            { id: "f2", type: "extrude", sketchId: "missing-sketch", depth: 5 },
        ]);

        const items = body.featureItems();
        expect(items[1].error).toBe("Sketch not found");
        expect(items[0].warning).toBe("Sketch has unresolved external references");
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

    test("setFeatureParameter updates the depth and rebuilds", () => {
        const body = bodyWith([extrudeFeature(sketch.id)]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "depth", 12));

        const vec = (mocks.prism.mock.calls[0] as unknown as [any, XYZ])[1];
        expect(vec.z).toBe(12);
        expect(body.features[0]).toMatchObject({ depth: 12 });
    });

    test("feature edits undo and redo as one step", () => {
        const body = bodyWith([extrudeFeature(sketch.id, 5)]);

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "depth", 12));
        doc.history.undo();
        expect(body.features[0]).toMatchObject({ depth: 5 });
        doc.history.redo();
        expect(body.features[0]).toMatchObject({ depth: 12 });
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
            { key: "depth", display: "option.command.depth", value: 7 },
            { key: "startOffset", display: "option.command.startOffset", value: 0 },
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
            // The rebuilt prism's single edge is the only candidate, so the moved
            // edge re-matches to it — and the stored ref is re-anchored to that
            // match (ShapeTracking.resolvedEdges), the same contract as the
            // profile re-anchoring below.
            edges: [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }],
        });
        // ...and the fillet applies without an error row.
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
        const addState = rs.fn();
        const removeState = rs.fn();
        (doc.visual as any).highlighter = { addState, removeState } as any;
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
        // The body's faces are transparent for the session (so they do not fight the
        // preview mesh) and restored afterwards.
        expect(addState).toHaveBeenCalledWith(owner, VisualStates.faceTransparent, ShapeTypes.solid);
        expect(removeState).toHaveBeenCalledWith(owner, VisualStates.faceTransparent, ShapeTypes.solid);
        // After the pick the body node is selected again so the feature panel reopens.
        expect(selection.setSelectedNodes).toHaveBeenCalledWith([body], false);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes rolls the list back while picking and restores it on cancel", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        let rollbackWhilePicking: number | undefined;
        let featuresWhilePicking: unknown;
        doc.picker.pickShape = rs.fn(() => {
            rollbackWhilePicking = body.rollbackIndex;
            featuresWhilePicking = body.features;
            return Promise.resolve([]);
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        // The runtime-only rollback truncates the replay at the fillet while picking
        // (the view shows its input shape); the feature list itself is never
        // rewritten, and the full chain is restored afterwards — no history either way.
        expect(rollbackWhilePicking).toBe(1);
        expect(featuresWhilePicking).toMatchObject([{ id: "f1" }, { id: "f2", edges: [EDGE_REF] }]);
        expect(body.rollbackIndex).toBeUndefined();
        expect(body.features).toMatchObject([{ id: "f1" }, { id: "f2", edges: [EDGE_REF] }]);
        expect(body.shape.isOk).toBe(true);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes previews the rebuilt body live while picking edges", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        const selection = mockSelection();
        const displayMesh = rs.fn((_datas: any, _option: any) => 42);
        const removeMesh = rs.fn();
        doc.visual.context.displayMesh = displayMesh as any;
        doc.visual.context.removeMesh = removeMesh as any;
        // The picked edge matches the rolled-back prism's only sub-edge, so the
        // preview chain evaluates successfully.
        const pickedEdge = {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: { x: 1, y: 0, z: 0 } } },
            startPoint: () => ({ x: 0, y: 0, z: 0 }),
            endPoint: () => ({ x: 1, y: 0, z: 0 }),
        };
        const owner = { node: body, worldTransform: () => Matrix4.identity() };
        doc.picker.pickShape = rs.fn(async () => {
            selection.onShapeChanged.emit([{ shape: pickedEdge, owner, indexes: [0] } as any]);
            // Let the debounced preview run before the session ends.
            await new Promise((resolve) => setTimeout(resolve, 40));
            return [{ shape: pickedEdge, owner, indexes: [0] } as any];
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        // The preview showed the full chain with the picked edges as an opaque temp
        // mesh (the body's own faces are transparent for the session), cleaned up
        // when the session ended ...
        expect(displayMesh).toHaveBeenCalledTimes(1);
        expect(displayMesh.mock.calls[0][1]).toBeUndefined();
        expect(removeMesh).toHaveBeenCalledWith(42);
        // ... and the body's own list stayed rolled back for the whole session —
        // the committed edges equal the stored ones, so no history was recorded.
        expect(body.features).toMatchObject([{ id: "f1" }, { id: "f2", edges: [EDGE_REF] }]);
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes shows the edge preview from the start", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        const selection = mockSelection();
        const owner = { node: body, worldTransform: () => Matrix4.identity() };
        doc.visual.context.getVisual = () => owner as any;
        (doc.visual as any).highlighter = { addState: rs.fn(), removeState: rs.fn() } as any;
        const displayMesh = rs.fn((_datas: any) => 42);
        const removeMesh = rs.fn();
        doc.visual.context.displayMesh = displayMesh as any;
        doc.visual.context.removeMesh = removeMesh as any;
        // The real selection manager emits on every setSelectedShapes, so the
        // preselection at session start triggers the preview without user input.
        selection.setSelectedShapes = rs.fn((shapes: any[]) => selection.onShapeChanged.emit(shapes));
        doc.picker.pickShape = rs.fn(async () => {
            // Let the debounced preview run before the session ends.
            await new Promise((resolve) => setTimeout(resolve, 40));
            return [];
        }) as any;

        await body.reselectShapes("f2");

        expect(displayMesh).toHaveBeenCalledTimes(1);
        expect(removeMesh).toHaveBeenCalledWith(42);
    });

    test("reselectShapes edge preview failure shows no temp mesh", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        const selection = mockSelection();
        const displayMesh = rs.fn((_datas: any, _option: any) => 42);
        doc.visual.context.displayMesh = displayMesh as any;
        // A circle ref never matches the rolled-back prism's line edge — the
        // preview chain fails.
        const oddEdge = {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { center: { x: 9, y: 9, z: 0 }, radius: 3, axis: { x: 0, y: 0, z: 1 } } },
            startPoint: () => ({ x: 9, y: 9, z: 0 }),
            endPoint: () => ({ x: 9, y: 10, z: 0 }),
        };
        const owner = { node: body, worldTransform: () => Matrix4.identity() };
        doc.picker.pickShape = rs.fn(async (_prompt: any, controller: any) => {
            selection.onShapeChanged.emit([{ shape: oddEdge, owner, indexes: [0] } as any]);
            await new Promise((resolve) => setTimeout(resolve, 40));
            controller.cancel();
            return [];
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f2");

        expect(displayMesh).not.toHaveBeenCalled();
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
            outerWire: () => ({
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [subEdge()] : []),
            }),
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
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
    test("reselectShapes previews the rebuilt body live while picking profiles", async () => {
        const extrude: ExtrudeFeatureData = {
            ...extrudeFeature(sketch.id),
            profiles: [{ edges: [EDGE_REF] }],
        };
        const body = bodyWith([extrude]);
        const selection = mockSelection();
        const movedEdge = {
            ...subEdge(),
            startPoint: () => ({ x: 1, y: 0, z: 0 }) as XYZ,
            endPoint: () => ({ x: 1, y: 1, z: 0 }) as XYZ,
        };
        const pickedFace = {
            shapeType: ShapeTypes.face,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [movedEdge] : []),
            outerWire: () => ({
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [movedEdge] : []),
            }),
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        };
        const owner = { node: sketch, worldTransform: () => Matrix4.identity() };
        const picked = [{ shape: pickedFace, owner, indexes: [0] } as any];
        const expectedProfiles = [
            { edges: [{ kind: "line", start: { x: 1, y: 0, z: 0 }, end: { x: 1, y: 1, z: 0 } }] },
        ];
        let featuresWhilePicking: unknown;
        doc.picker.pickShape = rs.fn(() => {
            selection.onShapeChanged.emit(picked);
            featuresWhilePicking = body.features;
            return Promise.resolve(picked);
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f1");

        // The selection change rebuilt the body with the new profiles mid-pick ...
        expect(featuresWhilePicking).toMatchObject([{ id: "f1", profiles: expectedProfiles }]);
        // ... and confirming commits the same refs without recording the preview.
        expect(body.features[0]).toMatchObject({ profiles: expectedProfiles });
        expect(doc.history.undoCount()).toBe(undoCount + 1);
    });

    test("reselectShapes cancel restores the body after a live preview", async () => {
        const extrude: ExtrudeFeatureData = {
            ...extrudeFeature(sketch.id),
            profiles: [{ edges: [EDGE_REF] }],
        };
        const body = bodyWith([extrude]);
        const selection = mockSelection();
        const movedEdge = {
            ...subEdge(),
            startPoint: () => ({ x: 1, y: 0, z: 0 }) as XYZ,
            endPoint: () => ({ x: 1, y: 1, z: 0 }) as XYZ,
        };
        const pickedFace = {
            shapeType: ShapeTypes.face,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [movedEdge] : []),
            outerWire: () => ({
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [movedEdge] : []),
            }),
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        };
        const owner = { node: sketch, worldTransform: () => Matrix4.identity() };
        let featuresWhilePicking: unknown;
        doc.picker.pickShape = rs.fn((_prompt: any, controller: any) => {
            selection.onShapeChanged.emit([{ shape: pickedFace, owner, indexes: [0] } as any]);
            featuresWhilePicking = body.features;
            controller.cancel();
            return Promise.resolve([]);
        }) as any;
        const undoCount = doc.history.undoCount();

        await body.reselectShapes("f1");

        // The preview changed the profiles mid-pick, and cancelling restored them.
        expect(featuresWhilePicking).not.toMatchObject({ profiles: [{ edges: [EDGE_REF] }] });
        expect(body.features[0]).toMatchObject({ profiles: [{ edges: [EDGE_REF] }] });
        expect(doc.history.undoCount()).toBe(undoCount);
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

    test("reselectShapes runs as the application's executing command", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        let commandWhilePicking: unknown;
        doc.picker.pickShape = rs.fn(() => {
            commandWhilePicking = doc.application.executingCommand;
            return Promise.resolve([]);
        }) as any;

        await body.reselectShapes("f2");

        expect(commandWhilePicking).toBeInstanceOf(ReselectFeatureCommand);
        expect(doc.application.executingCommand).toBeUndefined();
    });

    test("a command starting mid-pick cancels the reselect and restores rollback and history", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        // Like the real picker, the pick promise resolves when the controller is cancelled.
        doc.picker.pickShape = rs.fn(
            (_prompt: any, controller: AsyncController) =>
                new Promise<any[]>((resolve) => controller.onCancelled(() => resolve([]))),
        ) as any;
        const undoCount = doc.history.undoCount();

        const session = body.reselectShapes("f2");

        // The pick installs synchronously: the session holds the executing-command
        // slot, the body shows the pre-feature rollback, and the history is disabled.
        const running = doc.application.executingCommand;
        expect(running).toBeInstanceOf(ReselectFeatureCommand);
        // CommandService reaches the session's cancel through this exact predicate.
        expect(isCancelableCommand(running as ReselectFeatureCommand)).toBe(true);
        expect(body.rollbackIndex).toBe(1);
        expect(doc.history.disabled).toBe(true);

        // This is what CommandService.checking awaits when a ribbon command starts.
        await (running as ReselectFeatureCommand).cancel();
        await session;

        // The cleanup completed before the (simulated) new command proceeds: the
        // rollback preview is gone, the feature is unchanged, nothing was written
        // while the history was disabled, and model changes are undoable again.
        expect(body.rollbackIndex).toBeUndefined();
        expect(doc.history.disabled).toBe(false);
        expect(doc.application.executingCommand).toBeUndefined();
        expect(body.features).toMatchObject([{ id: "f1" }, { id: "f2", edges: [EDGE_REF] }]);
        expect(doc.history.undoCount()).toBe(undoCount);
        Transaction.execute(doc, "edit feature", () => body.setFeatureSuppressed("f2", true));
        expect(doc.history.undoCount()).toBe(undoCount + 1);
    });

    test("cancelling the reselect command mid profile-pick restores the feature and the history", async () => {
        const extrude: ExtrudeFeatureData = {
            ...extrudeFeature(sketch.id),
            profiles: [{ edges: [EDGE_REF] }],
        };
        const body = bodyWith([extrude]);
        mockSelection();
        doc.picker.pickShape = rs.fn(
            (_prompt: any, controller: AsyncController) =>
                new Promise<any[]>((resolve) => controller.onCancelled(() => resolve([]))),
        ) as any;
        const undoCount = doc.history.undoCount();

        const session = body.reselectShapes("f1");

        const running = doc.application.executingCommand;
        expect(running).toBeInstanceOf(ReselectFeatureCommand);
        expect(doc.history.disabled).toBe(true);

        await (running as ReselectFeatureCommand).cancel();
        await session;

        expect(body.features[0]).toMatchObject({ profiles: [{ edges: [EDGE_REF] }] });
        expect(doc.history.disabled).toBe(false);
        expect(doc.application.executingCommand).toBeUndefined();
        expect(doc.history.undoCount()).toBe(undoCount);
    });

    test("reselectShapes cancels a running command before starting", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        const cancel = rs.fn(async () => {});
        doc.application.executingCommand = createMockCancelableCommand({ cancel });
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;

        await body.reselectShapes("f2");

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(doc.application.executingCommand).toBeUndefined();
    });

    test("reselectShapes refuses to start while a non-cancelable command runs", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        const blocker = createMockCommand();
        doc.application.executingCommand = blocker;
        const pickShape = rs.fn(() => Promise.resolve([]));
        doc.picker.pickShape = pickShape as any;

        await body.reselectShapes("f2");

        expect(pickShape).not.toHaveBeenCalled();
        expect(doc.application.executingCommand).toBe(blocker);
    });

    test("reselecting twice cancels the first session and keeps one executing command", async () => {
        const fillet: FilletFeatureData = { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrudeFeature(sketch.id), fillet]);
        expect(body.shape.isOk).toBe(true);
        mockSelection();
        const sessions: AsyncController[] = [];
        doc.picker.pickShape = rs.fn(
            (_prompt: any, controller: AsyncController) =>
                new Promise<any[]>((resolve) => {
                    sessions.push(controller);
                    controller.onCancelled(() => resolve([]));
                }),
        ) as any;

        const first = body.reselectShapes("f2");
        const firstCommand = doc.application.executingCommand;
        expect(firstCommand).toBeInstanceOf(ReselectFeatureCommand);

        // The second start must cancel the first session before its own pick opens.
        const second = body.reselectShapes("f2");
        await rs.waitFor(() => expect(sessions.length).toBe(2));
        expect(sessions[0].result?.status).toBe("cancel");
        const secondCommand = doc.application.executingCommand;
        expect(secondCommand).toBeInstanceOf(ReselectFeatureCommand);
        expect(secondCommand).not.toBe(firstCommand);
        await first;

        await (secondCommand as ReselectFeatureCommand).cancel();
        await second;

        expect(sessions[1].result?.status).toBe("cancel");
        expect(doc.application.executingCommand).toBeUndefined();
        expect(body.rollbackIndex).toBeUndefined();
        expect(doc.history.disabled).toBe(false);
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

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f1", "depth", 12));

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
        // ReselectFeatureCommand.execute requires an active view to run against.
        doc.application.activeView = { document: doc } as any;
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
