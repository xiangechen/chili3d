// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IFace,
    type IShape,
    Plane,
    Result,
    Serializer,
    type ShapeType,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { EdgeRef } from "../src/features/edgeRef";
import type { FeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
import { resolveFacePlane } from "../src/sketch/planeRef";

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 1, 0] },
        { id: 2, type: "line", params: [1, 0, 1, 1] },
        { id: 3, type: "line", params: [1, 1, 0, 1] },
        { id: 4, type: "line", params: [0, 1, 0, 0] },
    ],
    constraints: [],
};

const EDGE_REF: EdgeRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } };

function planarFace(point: XYZ, normal: XYZ): IFace {
    return {
        shapeType: ShapeTypes.face,
        normal: () => [point, normal],
        surface: () => ({ isPlanar: () => true }),
        transformedMul: () => planarFace(point, normal),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IFace;
}

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

interface TrackedMocks {
    prismShape: IShape;
    filletedShape: IShape;
    prismTracked: ReturnType<typeof rs.fn>;
    filletTracked: ReturnType<typeof rs.fn>;
    restore: () => void;
}

/** Wire/line/combine mocks for the sketch profile, plus tracked prism/fillet. */
function setupTrackedMocks(
    faces: IFace[] = [],
    extra: Record<string, (...args: any[]) => any> = {},
): TrackedMocks {
    const sub = {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: { x: 1, y: 0, z: 0 } } },
        startPoint: () => ({ x: 0, y: 0, z: 0 }) as XYZ,
        endPoint: () => ({ x: 1, y: 0, z: 0 }) as XYZ,
        isEqual: () => false,
    };
    const profileFace = {
        shapeType: ShapeTypes.face,
        isEqual: () => false,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [sub, sub, sub, sub] : []),
    };
    const prismShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) =>
            type === ShapeTypes.face ? faces : type === ShapeTypes.edge ? [sub] : [],
        mesh: { edges: { range: [{ shape: sub }] } },
    } as unknown as IShape;
    const filletedShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    } as unknown as IShape;
    const mocks = {
        line: rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({ shapeType: ShapeTypes.edge, startPoint: () => start, endPoint: () => end }),
        ),
        wire: rs.fn((edges: any[]) =>
            Result.ok({ isClosed: () => edges.length > 1, toFace: () => Result.ok(profileFace) }),
        ),
        combine: rs.fn((edges: any[]) =>
            Result.ok({
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
        ),
    };
    // Bottom face keeps the profile id, the five remaining faces are new. Edge 0 keeps
    // the profile edge id, the other three prism edges are new.
    const prismTracked = rs.fn((_face: any, _vec: XYZ) =>
        Result.ok({ shape: prismShape, faceMap: [0, -1, -1, -1, -1, -1], edgeMap: [0, -1, -1, -1] }),
    );
    // Every input face survives identically; one new fillet face appears at the end.
    // Every input face/edge survives identically; one new fillet face and edge appear.
    const filletTracked = rs.fn((_shape: any, _indexes: number[], _radius: number) =>
        Result.ok({
            shape: filletedShape,
            faceMap: [0, 1, 2, 3, 4, 5, -1],
            edgeMap: [0, 1, 2, 3, -1],
        }),
    );
    const restore = mockShapeFactory({ ...mocks, prismTracked, filletTracked, ...extra });
    return { prismShape, filletedShape, prismTracked, filletTracked, restore };
}

describe("ParametricBodyNode face tracking", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: TrackedMocks;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupTrackedMocks();
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    test("extrude seeds the profile face id and scopes new faces to the feature", () => {
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prismTracked).toHaveBeenCalledTimes(1);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:0`);
        expect(body.faceIdAt(1)).toBe("f1:1");
        expect(body.faceIndexById(`sketch:${sketch.id}:0`)).toBe(0);
        expect(body.faceIndexById("f1:1")).toBe(1);
        expect(body.faceIndexById("unknown")).toBeUndefined();
    });

    test("side faces take the generating profile edge's id when the kernel reports it", () => {
        mocks.prismTracked.mockImplementation((_face: any, _vec: XYZ) =>
            Result.ok({
                shape: mocks.prismShape,
                faceMap: [0, -1, -1, -1, -1, -1],
                edgeMap: [0, -1, -1, -1],
                // side faces 1..4 are generated from profile edges 0..3
                faceEdgeMap: [-1, 0, 1, 2, 3, -1],
            }),
        );
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:0`);
        expect(body.faceIdAt(1)).toBe(`sketch:${sketch.id}:0:e0`);
        expect(body.faceIdAt(4)).toBe(`sketch:${sketch.id}:0:e3`);
        // the top face has no edge origin and stays feature-scoped
        expect(body.faceIdAt(5)).toBe("f1:5");
    });

    test("fillet propagates input ids and adds a feature-scoped id for the new face", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.filletTracked).toHaveBeenCalledTimes(1);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:0`);
        expect(body.faceIdAt(5)).toBe("f1:5");
        expect(body.faceIdAt(6)).toBe("f2:6");
    });

    test("editing a later feature keeps the cached prefix ids", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);
        expect(body.shape.isOk).toBe(true);
        mocks.prismTracked.mockClear();

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f2", "radius", 5));

        expect(mocks.prismTracked).not.toHaveBeenCalled();
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:0`);
    });

    test("face ids stay undefined when the kernel lacks tracked methods", () => {
        mocks.restore();
        const prism = rs.fn(() =>
            Result.ok({ shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() }),
        );
        const restore = mockShapeFactory({
            line: rs.fn((start: XYZ, end: XYZ) =>
                Result.ok({ shapeType: ShapeTypes.edge, startPoint: () => start, endPoint: () => end }),
            ),
            wire: rs.fn((edges: any[]) =>
                Result.ok({
                    isClosed: () => edges.length > 1,
                    toFace: () => Result.ok({ shapeType: ShapeTypes.face }),
                }),
            ),
            combine: rs.fn((edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            ),
            prism,
        });
        try {
            const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);

            expect(body.shape.isOk).toBe(true);
            expect(prism).toHaveBeenCalledTimes(1);
            expect(body.faceIdAt(0)).toBeUndefined();
            expect(body.faceIndexById("f1:0")).toBeUndefined();
        } finally {
            restore();
        }
    });

    test("resolveFacePlane prefers the stored face id over the geometric fingerprint", () => {
        const faceA = planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ);
        const faceB = planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ);
        mocks.restore();
        mocks = setupTrackedMocks([faceA, faceB]);
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);
        expect(body.shape.isOk).toBe(true);

        // faceIdAt(1) is "f1:1" — geometrically offset 5 would match faceA (index 0),
        // but the stored id must hit faceB (index 1) exactly.
        const ref = { nodeId: body.id, normal: { x: 0, y: 0, z: 1 }, offset: 5, faceId: "f1:1" };
        expect(resolveFacePlane(doc, ref)?.origin.z).toBe(10);
    });

    test("resolveFacePlane falls back to the fingerprint for an unknown face id", () => {
        const faceA = planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ);
        const faceB = planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ);
        mocks.restore();
        mocks = setupTrackedMocks([faceA, faceB]);
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);
        expect(body.shape.isOk).toBe(true);

        const ref = { nodeId: body.id, normal: { x: 0, y: 0, z: 1 }, offset: 5, faceId: "gone:0" };
        expect(resolveFacePlane(doc, ref)?.origin.z).toBe(5);
    });

    test("Serializer round-trips the plane reference with its face id", () => {
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);
        expect(body.shape.isOk).toBe(true);
        const sketchOnBody = new SketchNode({
            document: doc,
            plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z: 5 })),
            planeRef: { nodeId: body.id, normal: { x: 0, y: 0, z: 1 }, offset: 5, faceId: "f1:1" },
        });
        doc.modelManager.addNode(sketchOnBody);

        const serialized = Serializer.serializeObject(sketchOnBody);
        const restored = Serializer.deserializeObject(doc, serialized) as SketchNode;

        expect(restored.planeRef).toEqual({
            nodeId: body.id,
            normal: { x: 0, y: 0, z: 1 },
            offset: 5,
            faceId: "f1:1",
        });
    });

    test("extrude seeds sketch-scoped edge ids", () => {
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, length: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:0:e0`);
        expect(body.edgeIdAt(1)).toBe("f1:1");
        expect(body.edgeIndexById("f1:1")).toBe(1);
        expect(body.edgeIndexById("unknown")).toBeUndefined();
    });

    test("fillet propagates edge ids and adds a feature-scoped id for the new edge", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:0:e0`);
        expect(body.edgeIdAt(3)).toBe("f1:3");
        expect(body.edgeIdAt(4)).toBe("f2:4");
    });

    test("reselectShapes captures edge ids from the rolled-back shape, not the restored one", async () => {
        mocks.restore();
        // The fillet's output edge order is permuted relative to its input — OCCT's
        // really is (see edgeHistoryProbe). A capture that runs after the feature list
        // is restored would read this permuted list and tag the wrong edge.
        const filletedShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: () => [],
        } as unknown as IShape;
        const permutedFilletTracked = rs.fn((_shape: any, _indexes: number[], _radius: number) =>
            Result.ok({
                shape: filletedShape,
                faceMap: [0, 1, 2, 3, 4, 5, -1],
                edgeMap: [1, 2, 3, 0, -1],
            }),
        );
        mocks = setupTrackedMocks([], { filletTracked: permutedFilletTracked });
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);
        expect(body.shape.isOk).toBe(true);
        doc.selection = {
            clearSelection: rs.fn(),
            setSelectedShapes: rs.fn(),
            setSelectedNodes: rs.fn(),
        } as any;
        const pickedEdge = {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: { x: 0, y: 1, z: 0 } } },
            startPoint: () => new XYZ({ x: 5, y: 5, z: 0 }),
            endPoint: () => new XYZ({ x: 5, y: 6, z: 0 }),
        };
        doc.picker.pickShape = rs.fn(() =>
            Promise.resolve([{ shape: pickedEdge, indexes: [1] } as any]),
        ) as any;

        await body.reselectShapes("f2");

        // Edge 1 of the pre-fillet shape carries the extrude-scoped id; the permuted
        // fillet list would have produced "f1:2" for the same index.
        expect(body.features[1]).toMatchObject({ edges: [{ edgeId: "f1:1" }] });
        // And the re-evaluated fillet is applied to that exact edge (id hit), not a
        // fingerprint guess.
        const [, indexes] = permutedFilletTracked.mock.calls.at(-1) as unknown as [any, number[], number];
        expect(indexes).toEqual([1]);
    });

    test("boolean maps tool sub-shapes to tool-scoped ids", () => {
        const toolFace = planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ);
        const toolShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [toolFace] : []),
        } as unknown as IShape;
        const tool = new EditableShapeNode({ document: doc, name: "tool", shape: Result.ok(toolShape) });
        doc.modelManager.addNode(tool);
        mocks.restore();
        // Input faces 0..5 are the body's, face 6 is the tool's only face.
        const booleanCutTracked = rs.fn((_args: any[], _tools: any[]) =>
            Result.ok({
                shape: {
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: () => [],
                },
                faceMap: [0, 6, -1],
                edgeMap: [0, -1],
            }),
        );
        mocks = setupTrackedMocks([], { booleanCutTracked });
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "boolean", operation: "cut", toolIds: [tool.id] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:0`);
        expect(body.faceIdAt(1)).toBe(`tool:${tool.id}:0`);
        expect(body.faceIdAt(2)).toBe("f2:2");
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:0:e0`);
        expect(body.edgeIdAt(1)).toBe("f2:1");
    });

    test("boolean keeps untracked main-body sub-shapes out of the tool ranges", () => {
        const toolFace = planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ);
        const toolShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [toolFace] : []),
        } as unknown as IShape;
        const tool = new EditableShapeNode({ document: doc, name: "tool", shape: Result.ok(toolShape) });
        doc.modelManager.addNode(tool);
        mocks.restore();
        // Untracked extrude (no prismTracked): input ids are empty, but the input
        // shape has two faces / one edge, so boolean hits 0..1 are the main body's.
        const face = { shapeType: ShapeTypes.face, isEqual: () => false };
        const sub = { shapeType: ShapeTypes.edge, isEqual: () => false };
        const prism = rs.fn(() =>
            Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) =>
                    type === ShapeTypes.face ? [face, face] : type === ShapeTypes.edge ? [sub] : [],
            }),
        );
        const booleanCutTracked = rs.fn((_args: any[], _tools: any[]) =>
            Result.ok({
                shape: {
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: () => [],
                },
                faceMap: [0, 2, -1],
                edgeMap: [0, -1],
            }),
        );
        const restore = mockShapeFactory({
            line: rs.fn((start: XYZ, end: XYZ) =>
                Result.ok({ shapeType: ShapeTypes.edge, startPoint: () => start, endPoint: () => end }),
            ),
            wire: rs.fn((edges: any[]) =>
                Result.ok({
                    isClosed: () => edges.length > 1,
                    toFace: () => Result.ok({ shapeType: ShapeTypes.face }),
                }),
            ),
            combine: rs.fn((edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            ),
            prism,
            booleanCutTracked,
        });
        mocks = { ...mocks, restore };
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, length: 5 },
            { id: "f2", type: "boolean", operation: "cut", toolIds: [tool.id] },
        ]);

        expect(body.shape.isOk).toBe(true);
        // Main-body hit 0 is feature-scoped — without the input-shape boundary it
        // would leak into the tool's range and come out as `tool:<id>:0`.
        expect(body.faceIdAt(0)).toBe("f2:0");
        expect(body.faceIdAt(1)).toBe(`tool:${tool.id}:0`);
        expect(body.faceIdAt(2)).toBe("f2:2");
        expect(body.edgeIdAt(0)).toBe("f2:0");
    });
});
