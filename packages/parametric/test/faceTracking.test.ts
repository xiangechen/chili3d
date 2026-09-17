// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    EditableShapeNode,
    type IEdge,
    type IFace,
    type IShape,
    Plane,
    Result,
    Serializer,
    type ShapeType,
    ShapeTypes,
    Signal,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { EdgeRef } from "../src/features/edgeRef";
import { type ExtrudeFeatureData, type FeatureData, featureHandler } from "../src/features/feature";
import { matchSourceFaceIndexes } from "../src/features/pressPull";
import type { ProfileRef } from "../src/features/profileRef";
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

/** A line edge with real XYZ endpoints — the id-invariant check reads its direction. */
function mockLine(start: XYZ, end: XYZ) {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: end.sub(start).normalize() } },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        length: () => start.distanceTo(end),
        isEqual: () => false,
    } as unknown as IEdge;
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

/** Sketch-side mocks: sampling-capable line edges, edge-carrying wires, plain faces. */
function sketchShapeMocks() {
    return {
        line: rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
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
                        {
                            x: Math.min(start.x, end.x),
                            y: Math.min(start.y, end.y),
                            z: Math.min(start.z, end.z),
                        },
                        {
                            x: Math.max(start.x, end.x),
                            y: Math.max(start.y, end.y),
                            z: Math.max(start.z, end.z),
                        },
                    ),
            }),
        ),
        wire: rs.fn((edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges })),
        face: rs.fn((_wires: any[]) => Result.ok({ shapeType: ShapeTypes.face })),
        combine: rs.fn((edges: any[]) =>
            Result.ok({
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
        ),
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
    // Distinct boundary edges of the unit-square profile — geometry completion tells
    // them apart, and the id-invariant check reads their directions.
    const subEdges = [
        mockLine(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 0, z: 0 })),
        mockLine(new XYZ({ x: 1, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 0 })),
        mockLine(new XYZ({ x: 1, y: 1, z: 0 }), new XYZ({ x: 0, y: 1, z: 0 })),
        mockLine(new XYZ({ x: 0, y: 1, z: 0 }), new XYZ({ x: 0, y: 0, z: 0 })),
    ];
    // Fresh per call: profile entity registration is keyed on the face instance, so
    // two profiles must not share one.
    const profileFace = () =>
        ({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? subEdges : []),
        }) as unknown as IFace;
    const prismShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) =>
            type === ShapeTypes.face ? faces : type === ShapeTypes.edge ? subEdges : [],
        mesh: { edges: { range: subEdges.map((shape) => ({ shape })) } },
    } as unknown as IShape;
    const filletedShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    } as unknown as IShape;
    const mocks = {
        line: rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
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
                        {
                            x: Math.min(start.x, end.x),
                            y: Math.min(start.y, end.y),
                            z: Math.min(start.z, end.z),
                        },
                        {
                            x: Math.max(start.x, end.x),
                            y: Math.max(start.y, end.y),
                            z: Math.max(start.z, end.z),
                        },
                    ),
            }),
        ),
        wire: rs.fn((edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges })),
        face: rs.fn((_wires: any[]) => Result.ok(profileFace())),
        combine: rs.fn((edges: any[]) =>
            Result.ok({
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
        ),
    };
    // Bottom face keeps the profile id, the five remaining faces are new. The kernel
    // history reports only edge 0 as identical; geometric completion recovers the
    // other three bottom edges (the prism edges ARE the profile edges here).
    const prismTracked = rs.fn((_face: any, _vec: XYZ) =>
        Result.ok({ shape: prismShape, faceMap: [0, -1, -1, -1, -1, -1], edgeMap: [0, -1, -1, -1] }),
    );
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
        // ReselectFeatureCommand.execute requires an active view to run against.
        doc.application.activeView = { document: doc } as any;
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
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prismTracked).toHaveBeenCalledTimes(1);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(1)).toBe("f1:1");
        expect(body.faceIndexById(`sketch:${sketch.id}:e1.2.3.4`)).toBe(0);
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
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(1)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
        expect(body.faceIdAt(4)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent4`);
        // the top face has no sweep history; with no cap channel in this mock the
        // unique-history-less-face fallback seeds it
        expect(body.faceIdAt(5)).toBe(`sketch:${sketch.id}:e1.2.3.4:top`);
    });

    test("the kernel-reported top face wins over an ambiguous history-less heuristic", () => {
        mocks.prismTracked.mockImplementation((_face: any, _vec: XYZ) =>
            Result.ok({
                shape: mocks.prismShape,
                // Only the bottom has history: five history-less faces are ambiguous
                // to the heuristic, but the kernel's cap channel names the top.
                faceMap: [0, -1, -1, -1, -1, -1],
                edgeMap: [0, -1, -1, -1],
                capFaces: [5],
            }),
        );
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(5)).toBe(`sketch:${sketch.id}:e1.2.3.4:top`);
        expect(body.faceIndexById(`sketch:${sketch.id}:e1.2.3.4:top`)).toBe(5);
        // The other history-less faces keep positional ids — the heuristic did not run.
        expect(body.faceIdAt(1)).toBe("f1:1");
    });

    test("an empty cap channel keeps the history-less heuristic and its ambiguity guard", () => {
        mocks.prismTracked.mockImplementation((_face: any, _vec: XYZ) =>
            Result.ok({
                shape: mocks.prismShape,
                faceMap: [0, -1, -1, -1, -1, -1],
                edgeMap: [0, -1, -1, -1],
                // A kernel predating the channel reports nothing: five history-less
                // faces stay ambiguous, so no :top is seeded (positional fallback).
                capFaces: [],
            }),
        );
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(5)).toBe("f1:5");
    });

    test("revolve: the kernel-reported end cap wins over the history-less heuristic", () => {
        mocks.restore();
        const revolvedShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: () => [],
            mesh: { edges: { range: [] } },
        } as unknown as IShape;
        const revolveTracked = rs.fn((_face: any, _axis: any, _angle: number) =>
            Result.ok({
                shape: revolvedShape,
                // The start face is identical to the profile; the four remaining
                // faces are new — ambiguous to the history-less heuristic.
                faceMap: [0, -1, -1, -1, -1],
                edgeMap: [0, -1, -1, -1],
                capFaces: [4],
            }),
        );
        mocks = setupTrackedMocks([], { revolveTracked });
        const body = bodyWith([
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                angle: 90,
            },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(revolveTracked).toHaveBeenCalledTimes(1);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(4)).toBe(`sketch:${sketch.id}:e1.2.3.4:cap`);
        // The other new faces keep positional ids — the heuristic did not run.
        expect(body.faceIdAt(1)).toBe("r1:1");
    });

    test("fillet propagates input ids and adds a feature-scoped id for the new face", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.filletTracked).toHaveBeenCalledTimes(1);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(5)).toBe("f1:5");
        expect(body.faceIdAt(6)).toBe("f2:6");
    });

    test("editing a later feature keeps the cached prefix ids", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);
        expect(body.shape.isOk).toBe(true);
        mocks.prismTracked.mockClear();

        Transaction.execute(doc, "edit feature", () => body.setFeatureParameter("f2", "radius", 5));

        expect(mocks.prismTracked).not.toHaveBeenCalled();
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
    });

    test("face ids stay undefined when the kernel lacks tracked methods", () => {
        mocks.restore();
        const prism = rs.fn(() =>
            Result.ok({ shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() }),
        );
        const restore = mockShapeFactory({
            ...sketchShapeMocks(),
            prism,
        });
        try {
            const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

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
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);
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
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);
        expect(body.shape.isOk).toBe(true);

        const ref = { nodeId: body.id, normal: { x: 0, y: 0, z: 1 }, offset: 5, faceId: "gone:0" };
        expect(resolveFacePlane(doc, ref)?.origin.z).toBe(5);
    });

    test("Serializer round-trips the plane reference with its face id", () => {
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);
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
        const body = bodyWith([{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 }]);

        expect(body.shape.isOk).toBe(true);
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
        // The kernel history reported only edge 0; geometric identity completion
        // recovered the other bottom edges, so they keep the sketch-scoped ids too.
        expect(body.edgeIdAt(1)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent2`);
        expect(body.edgeIndexById(`sketch:${sketch.id}:e1.2.3.4:ent2`)).toBe(1);
        expect(body.edgeIndexById("unknown")).toBeUndefined();
    });

    test("fillet propagates edge ids and adds a feature-scoped id for the new edge", () => {
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
        expect(body.edgeIdAt(3)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent4`);
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
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "fillet", radius: 2, edges: [EDGE_REF] },
        ]);
        expect(body.shape.isOk).toBe(true);
        doc.selection = {
            clearSelection: rs.fn(),
            setSelectedShapes: rs.fn(),
            setSelectedNodes: rs.fn(),
            onShapeChanged: new Signal<(selected: any[]) => void>(),
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

        // Edge 1 of the pre-fillet shape carries the sketch-scoped id; the permuted
        // fillet list would have produced ":ent3" for the same index.
        expect(body.features[1]).toMatchObject({ edges: [{ edgeId: `sketch:${sketch.id}:e1.2.3.4:ent2` }] });
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
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "boolean", operation: "cut", toolIds: [tool.id] },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(1)).toBe(`tool:${tool.id}:0`);
        expect(body.faceIdAt(2)).toBe("f2:2");
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
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
            ...sketchShapeMocks(),
            prism,
            booleanCutTracked,
        });
        mocks = { ...mocks, restore };
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
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

    test("a join extrude tracks ids through the boolean with the chain input", () => {
        mocks.restore();
        // Faces 0..5 / edges 0..3 are the chain input's; the tool prism's follow.
        const booleanFuseTracked = rs.fn((_args: any[], _tools: any[]) =>
            Result.ok({
                shape: {
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: () => [],
                },
                faceMap: [0, 6, 7, -1],
                edgeMap: [0, 4, -1],
            }),
        );
        mocks = setupTrackedMocks([], { booleanFuseTracked });
        const body = bodyWith([
            { id: "f1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "f2", type: "extrude", sketchId: sketch.id, depth: 2, operation: "fuse" },
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.prismTracked).toHaveBeenCalledTimes(2);
        expect(booleanFuseTracked).toHaveBeenCalledTimes(1);
        // Input hits keep the input ids, tool hits take the sweep's sketch-scoped ids,
        // boolean-born sub-shapes are feature-scoped.
        expect(body.faceIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(1)).toBe(`sketch:${sketch.id}:e1.2.3.4`);
        expect(body.faceIdAt(2)).toBe("f2:1");
        expect(body.faceIdAt(3)).toBe("f2:3");
        expect(body.edgeIdAt(0)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
        expect(body.edgeIdAt(1)).toBe(`sketch:${sketch.id}:e1.2.3.4:ent1`);
        expect(body.edgeIdAt(2)).toBe("f2:2");
    });

    describe("multi-profile fusion", () => {
        /** Overlaps SQUARE without sharing endpoints, so the loops stay separate groups. */
        const OVERLAPPING_SQUARE: SketchData["entities"] = [
            { id: 5, type: "line", params: [0.5, -0.5, 2, -0.5] },
            { id: 6, type: "line", params: [2, -0.5, 2, 1.5] },
            { id: 7, type: "line", params: [2, 1.5, 0.5, 1.5] },
            { id: 8, type: "line", params: [0.5, 1.5, 0.5, -0.5] },
        ];
        const DISJOINT_SQUARE: SketchData["entities"] = [
            { id: 5, type: "line", params: [5, 5, 7, 5] },
            { id: 6, type: "line", params: [7, 5, 7, 7] },
            { id: 7, type: "line", params: [7, 7, 5, 7] },
            { id: 8, type: "line", params: [5, 7, 5, 5] },
        ];

        function solidWithBox(min: [number, number, number], max: [number, number, number]) {
            return {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: () => [],
                boundingBox: () =>
                    new BoundingBox(
                        new XYZ({ x: min[0], y: min[1], z: min[2] }),
                        new XYZ({ x: max[0], y: max[1], z: max[2] }),
                    ),
            } as unknown as IShape;
        }

        function twoLoopSketch(second: SketchData["entities"]) {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [...SQUARE.entities, ...second], constraints: [] },
            });
            doc.modelManager.addNode(node);
            return node;
        }

        /** Re-mocks the factory: per-profile prisms with the given boxes, plus the fuse under test. */
        function setupFusion(booleanFuseTracked: (...args: any[]) => any, touching: boolean) {
            mocks.restore();
            const boxes: [[number, number, number], [number, number, number]][] = touching
                ? [
                      [
                          [0, 0, 0],
                          [1, 1, 5],
                      ],
                      [
                          [0.5, -0.5, 0],
                          [2, 1.5, 5],
                      ],
                  ]
                : [
                      [
                          [0, 0, 0],
                          [1, 1, 5],
                      ],
                      [
                          [5, 5, 0],
                          [7, 7, 5],
                      ],
                  ];
            const prismShapes = boxes.map(([min, max]) => solidWithBox(min, max));
            let call = 0;
            mocks = setupTrackedMocks([], {
                booleanFuseTracked,
                prismTracked: rs.fn(() => {
                    const shape = prismShapes[call++];
                    return Result.ok({ shape, faceMap: [0, -1], edgeMap: [0, -1] });
                }),
            });
            return prismShapes;
        }

        test("touching profiles fuse and the ids map through the fuse history", () => {
            const fusedShape = {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: () => [],
            } as unknown as IShape;
            // Output faces: 0,1 from profile 0; 2 from profile 1 (input 2); 3 is fuse-born.
            const booleanFuseTracked = rs.fn((_args: any[], _tools: any[]) =>
                Result.ok({ shape: fusedShape, faceMap: [0, 1, 2, -1], edgeMap: [0, 2, -1] }),
            );
            const prismShapes = setupFusion(booleanFuseTracked, true);
            const two = twoLoopSketch(OVERLAPPING_SQUARE);
            const body = bodyWith([{ id: "f1", type: "extrude", sketchId: two.id, depth: 5 }]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()).toBe(fusedShape);
            expect(booleanFuseTracked).toHaveBeenCalledTimes(1);
            expect(body.faceIdAt(0)).toBe(`sketch:${two.id}:e1.2.3.4`);
            expect(body.faceIdAt(1)).toBe(`sketch:${two.id}:e1.2.3.4:top`);
            expect(body.faceIdAt(2)).toBe(`sketch:${two.id}:e5.6.7.8`);
            expect(body.faceIdAt(3)).toBe("f1:3");
            expect(body.edgeIdAt(0)).toBe(`sketch:${two.id}:e1.2.3.4:ent1`);
            expect(body.edgeIdAt(1)).toBe(`sketch:${two.id}:e5.6.7.8:e0`);
            expect(body.edgeIdAt(2)).toBe("f1:2");
            // The fuse copies the geometry; the intermediate prisms are disposed.
            expect(prismShapes[0].dispose).toHaveBeenCalled();
            expect(prismShapes[1].dispose).toHaveBeenCalled();
        });

        test("disjoint profiles skip the fuse and keep the flat per-profile ids", () => {
            const booleanFuseTracked = rs.fn();
            setupFusion(booleanFuseTracked, false);
            const two = twoLoopSketch(DISJOINT_SQUARE);
            const body = bodyWith([{ id: "f1", type: "extrude", sketchId: two.id, depth: 5 }]);

            expect(body.shape.isOk).toBe(true);
            expect(booleanFuseTracked).not.toHaveBeenCalled();
            expect(body.faceIdAt(0)).toBe(`sketch:${two.id}:e1.2.3.4`);
            expect(body.faceIdAt(2)).toBe(`sketch:${two.id}:e5.6.7.8`);
        });

        test("a failed fuse falls back to the compound with flat per-profile ids", () => {
            const booleanFuseTracked = rs.fn(() => Result.err("fuse failed"));
            setupFusion(booleanFuseTracked, true);
            const two = twoLoopSketch(OVERLAPPING_SQUARE);
            const body = bodyWith([{ id: "f1", type: "extrude", sketchId: two.id, depth: 5 }]);

            expect(body.shape.isOk).toBe(true);
            expect(booleanFuseTracked).toHaveBeenCalledTimes(1);
            expect(body.faceIdAt(0)).toBe(`sketch:${two.id}:e1.2.3.4`);
            expect(body.faceIdAt(2)).toBe(`sketch:${two.id}:e5.6.7.8`);
        });

        test("a symmetric extrude suffixes the mirrored half's ids", () => {
            mocks.restore();
            const fusedShape = {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: () => [],
            } as unknown as IShape;
            // The two halves (positive/mirrored) each report faceMap [0, -1] /
            // edgeMap [0, -1]; the fuse keeps both bottom faces and adds a born face.
            const booleanFuseTracked = rs.fn((_args: any[], _tools: any[]) =>
                Result.ok({ shape: fusedShape, faceMap: [0, 1, 2, -1], edgeMap: [0, 2, -1] }),
            );
            const halves = [solidWithBox([0, 0, 0], [1, 1, 5]), solidWithBox([0, 0, -5], [1, 1, 0.1])];
            let call = 0;
            const prismTracked = rs.fn(() => {
                const shape = halves[call++];
                return Result.ok({ shape, faceMap: [0, -1], edgeMap: [0, -1] });
            });
            mocks = setupTrackedMocks([], { booleanFuseTracked, prismTracked });
            const fresh = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
            doc.modelManager.addNode(fresh);
            const body = bodyWith([
                { id: "f1", type: "extrude", sketchId: fresh.id, depth: 5, symmetric: true },
            ]);

            expect(body.shape.isOk).toBe(true);
            expect(prismTracked).toHaveBeenCalledTimes(2);
            expect(booleanFuseTracked).toHaveBeenCalledTimes(1);
            expect(body.faceIdAt(0)).toBe(`sketch:${fresh.id}:e1.2.3.4`);
            expect(body.faceIdAt(1)).toBe(`sketch:${fresh.id}:e1.2.3.4:top`);
            expect(body.faceIdAt(2)).toBe(`sketch:${fresh.id}:e1.2.3.4:neg`);
            expect(body.faceIdAt(3)).toBe("f1:3");
            expect(body.edgeIdAt(0)).toBe(`sketch:${fresh.id}:e1.2.3.4:ent1`);
            expect(body.edgeIdAt(1)).toBe(`sketch:${fresh.id}:e1.2.3.4:neg:ent1`);
            expect(body.edgeIdAt(2)).toBe("f1:2");
        });
    });
});

describe("matchSourceFaceIndexes (press-pull face claiming)", () => {
    /** A rect piece of a split face: x∈[0,40], y∈[y0,y1] on the z=40 plane, 4 boundary edges. */
    function rectPiece(y0: number, y1: number): IFace {
        const corners = [
            new XYZ({ x: 0, y: y0, z: 40 }),
            new XYZ({ x: 40, y: y0, z: 40 }),
            new XYZ({ x: 40, y: y1, z: 40 }),
            new XYZ({ x: 0, y: y1, z: 40 }),
        ];
        const edges = [
            mockLine(corners[0], corners[1]),
            mockLine(corners[1], corners[2]),
            mockLine(corners[2], corners[3]),
            mockLine(corners[3], corners[0]),
        ];
        return {
            boundingBox: () => ({ min: corners[0], max: corners[2] }),
            area: () => 40 * (y1 - y0),
            outerWire: () => ({ findSubShapes: () => edges }),
        } as unknown as IFace;
    }

    /** The press-pull ref of `rectPiece(y0, y1)` — edge fingerprints + region + tracked id. */
    function pieceRef(y0: number, y1: number, id: string): ProfileRef {
        return {
            edges: [
                { kind: "line", start: { x: 0, y: y0, z: 40 }, end: { x: 40, y: y0, z: 40 } },
                { kind: "line", start: { x: 40, y: y0, z: 40 }, end: { x: 40, y: y1, z: 40 } },
                { kind: "line", start: { x: 40, y: y1, z: 40 }, end: { x: 0, y: y1, z: 40 } },
                { kind: "line", start: { x: 0, y: y1, z: 40 }, end: { x: 0, y: y0, z: 40 } },
            ],
            center: { x: 20, y: (y0 + y1) / 2, z: 40 },
            area: 40 * (y1 - y0),
            id,
        };
    }

    function claimed(faces: IFace[], ids: (string | undefined)[], refs: ProfileRef[]): number[] {
        const matched = matchSourceFaceIndexes(faces, ids, refs);
        expect(matched.isOk).toBe(true);
        return matched.unchecked()!.indexes;
    }

    test("several id hits narrow to the one piece matching the fingerprint", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40), rectPiece(50, 60)];
        expect(claimed(faces, ["top", "top", "top"], [pieceRef(0, 10, "top")])).toEqual([0]);
    });

    test("a stale fingerprint keeps the whole-span adoption (zero exact pieces)", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40), rectPiece(50, 60)];
        expect(claimed(faces, ["top", "top", "top"], [pieceRef(5, 15, "top")])).toEqual([0, 1, 2]);
    });

    test("several exact pieces keeps the whole-span adoption (coincident pieces)", () => {
        const faces = [rectPiece(0, 10), rectPiece(0, 10), rectPiece(30, 40)];
        expect(claimed(faces, ["top", "top", "top"], [pieceRef(0, 10, "top")])).toEqual([0, 1, 2]);
    });

    test("per-piece refs each adopt their own piece", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40)];
        const refs = [pieceRef(0, 10, "top"), pieceRef(30, 40, "top")];
        const matched = matchSourceFaceIndexes(faces, ["top", "top"], refs);
        expect(matched.isOk).toBe(true);
        expect(matched.unchecked()!.indexes).toEqual([0, 1]);
        // Each adopted face carries the position of the ref that adopted it, so the
        // re-anchor can keep that ref's `splitPiece`.
        expect(matched.unchecked()!.refIndexes).toEqual([0, 1]);
    });

    test("a single id hit is adopted without fingerprint scoring", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40)];
        expect(claimed(faces, ["top", "other"], [pieceRef(0, 10, "top")])).toEqual([0]);
    });

    test("a flagged ref narrows to the one piece matching the fingerprint", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40), rectPiece(50, 60)];
        const ref: ProfileRef = { ...pieceRef(0, 10, "top"), splitPiece: true };
        expect(claimed(faces, ["top", "top", "top"], [ref])).toEqual([0]);
    });

    test("a flagged ref with a stale fingerprint adopts the clear nearest piece", () => {
        const faces = [rectPiece(0, 10), rectPiece(30, 40)];
        const ref: ProfileRef = { ...pieceRef(5, 15, "top"), splitPiece: true };
        expect(claimed(faces, ["top", "top"], [ref])).toEqual([0]);
    });

    test("a flagged ref with several exact pieces fails ambiguous", () => {
        const faces = [rectPiece(0, 10), rectPiece(0, 10)];
        const ref: ProfileRef = { ...pieceRef(0, 10, "top"), splitPiece: true };
        const result = matchSourceFaceIndexes(faces, ["top", "top"], [ref]);
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Face match is ambiguous after rebuild");
    });

    test("a flagged ref with an evenly mirrored stale fingerprint fails ambiguous", () => {
        // rectPiece(10, 20) is exactly between the two pieces (a ±10 y-translate of
        // each), so both score the same — no clear nearest piece to adopt.
        const faces = [rectPiece(0, 10), rectPiece(20, 30)];
        const ref: ProfileRef = { ...pieceRef(10, 20, "top"), splitPiece: true };
        const result = matchSourceFaceIndexes(faces, ["top", "top"], [ref]);
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Face match is ambiguous after rebuild");
    });

    test("applyResolvedRefs keeps the flag on the re-anchored source profiles", () => {
        const feature: FeatureData = {
            id: "e3",
            type: "extrude",
            depth: 5,
            source: { nodeId: "body", profiles: [pieceRef(0, 10, "top")] },
        };
        const flagged: ProfileRef = { ...pieceRef(0, 10, "top"), splitPiece: true };
        const updated = featureHandler("extrude")!.applyResolvedRefs!(feature, {
            resolvedProfiles: [flagged],
        }) as ExtrudeFeatureData;
        expect(updated.source?.profiles[0]?.splitPiece).toBe(true);
    });
});
