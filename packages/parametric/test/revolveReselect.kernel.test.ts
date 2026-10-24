// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Kernel-level coverage of the revolve reselect flow (`ParametricBodyNode.reselectSession`
 * on a revolve): real sketch decomposition, real region identity, real revolve — the
 * parts the mocked `features.test.ts` cannot see.
 *
 * Scenario G pins down the case behind "Sketch profile match is ambiguous after rebuild":
 * a crossing sketch whose regions all share one entity set (the two circles bound every
 * region) still re-picks unambiguously, because the region fingerprint tells them apart.
 * Scenario H produces the error itself (the stored region is gone and two equal
 * candidates remain) and shows the reselect repairing it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type AsyncController,
    CurveUtils,
    type I18nKeys,
    type IEdge,
    Matrix4,
    Plane,
    ShapeTypes,
    type VisualShapeData,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockSelection,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import "../src/features";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import type { RevolveFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { plainVec } from "../src/features/refGeometry";
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

const loop = (x1: number, y1: number, x2: number, y2: number, base = 1): SketchData => ({
    entities: [
        { id: base, type: "line", params: [x1, y1, x2, y1] },
        { id: base + 1, type: "line", params: [x2, y1, x2, y2] },
        { id: base + 2, type: "line", params: [x2, y2, x1, y2] },
        { id: base + 3, type: "line", params: [x1, y2, x1, y1] },
    ],
    constraints: [],
});

/** The axis snapshot of a straight edge, captured the way `AxisReselectSession` captures it. */
function axisOf(edge: IEdge): RevolveFeatureData["axis"] {
    const basis = edge.curve.basisCurve;
    if (!CurveUtils.isLine(basis)) throw new Error("a box edge is a line");
    return { point: plainVec(edge.startPoint()), direction: plainVec(basis.direction) };
}

function sketchFaces(sketch: SketchNode) {
    return sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
}

function sketchEdges(sketch: SketchNode) {
    return sketch.mesh.edges?.range.filter((x) => x.shape.shapeType === ShapeTypes.edge) ?? [];
}

const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);

describe("revolve reselect (kernel)", () => {
    test("A: separate axis sketch, re-pick same profile + same axis", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: loop(0, 0, 10, 10) });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 1, type: "line", params: [-5, 0, -5, 10] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const face = sketchFaces(sketch)[0].shape;
        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
            profiles: [captureProfileRef(face as any)],
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            const picked: VisualShapeData[] =
                picks === 1
                    ? [
                          {
                              shape: face,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: sketch },
                          } as any,
                      ]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          } as any,
                      ];
            return Promise.resolve(picked);
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(face as any).center);
        expect(stored.axisSource).toEqual({ nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) });
        expect(stored.axis).toEqual({ point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } });
    });

    test("B: axis line inside the profile sketch (not touching)", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [...loop(0, 0, 10, 10).entities, { id: 5, type: "line", params: [-5, 0, -5, 10] }],
                constraints: [],
            },
        });
        doc.modelManager.addNode(sketch);

        const face = sketchFaces(sketch)[0].shape;
        const edges = sketchEdges(sketch);
        const axisEdge = edges[4].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: sketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
            profiles: [captureProfileRef(face as any)],
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [{ shape: face, transform: Matrix4.identity(), indexes: [0], owner: { node: sketch } }]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [4],
                              owner: { node: sketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(face as any).center);
        expect(stored.axisSource).toEqual({ nodeId: sketch.id, edge: captureEdgeRef(axisEdge as any) });
        expect(stored.axis).toEqual({ point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } });
    });

    test("C: axis line CROSSES the profile — re-pick one region", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        // Rectangle (0,0)-(10,10) crossed vertically by the axis line x=5.
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [...loop(0, 0, 10, 10).entities, { id: 5, type: "line", params: [5, 0, 5, 10] }],
                constraints: [],
            },
        });
        doc.modelManager.addNode(sketch);

        const faces = sketchFaces(sketch);
        // The axis line x = 5 splits the rectangle into two regions.
        expect(faces.length).toBe(2);
        const face = faces[0].shape;
        const edges = sketchEdges(sketch);
        const axisEdge = edges[4].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: 5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: sketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
            profiles: [captureProfileRef(face as any)],
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [{ shape: face, transform: Matrix4.identity(), indexes: [0], owner: { node: sketch } }]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [4],
                              owner: { node: sketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(face as any).center);
        expect(stored.axisSource).toEqual({ nodeId: sketch.id, edge: captureEdgeRef(axisEdge as any) });
        expect(stored.axis).toEqual({ point: { x: 5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } });
    });

    test("D: whole-sketch revolve (no profiles), then pick one profile", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: loop(0, 0, 10, 10) });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 1, type: "line", params: [-5, 0, -5, 10] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        const face = sketchFaces(sketch)[0].shape;
        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [{ shape: face, transform: Matrix4.identity(), indexes: [0], owner: { node: sketch } }]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        // The feature had NO profiles before (whole sketch): the re-pick must actually store
        // the picked one — a silent bail would leave both this and the axis untouched.
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(face as any).center);
        expect(stored.axisSource).toEqual({ nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) });
    });

    test("E: duplicate coincident loops — whole-sketch revolve, then pick the face", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        // The same rectangle drawn twice (ids 1-4 and 5-8, coincident geometry).
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [...loop(0, 0, 10, 10, 1).entities, ...loop(0, 0, 10, 10, 5).entities],
                constraints: [],
            },
        });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 9, type: "line", params: [-5, 0, -5, 10] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        const faces = sketchFaces(sketch);
        // Two coincident loops still decompose to ONE region — bounded by a doubled entity set.
        expect(faces.length).toBe(1);
        const face = faces[0].shape;
        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [{ shape: face, transform: Matrix4.identity(), indexes: [0], owner: { node: sketch } }]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(face as any).center);
        expect(stored.axisSource).toEqual({ nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) });
    });

    test("F: sketch edited to two same-size circles — re-pick one circle", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 1, type: "circle", params: [5, 5, 3] }], constraints: [] },
        });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 2, type: "line", params: [-5, 0, -5, 10] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const face0 = sketchFaces(sketch)[0].shape;
        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
            profiles: [captureProfileRef(face0 as any)],
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        // Edit: add a second circle of the SAME size at another spot.
        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "circle", params: [5, 5, 3] },
                { id: 3, type: "circle", params: [20, 5, 3] },
            ],
            constraints: [],
        });
        expect(errors(body)).toEqual([undefined]);
        const faces = sketchFaces(sketch);
        expect(faces.length).toBe(2);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [
                          {
                              shape: faces[0].shape,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: sketch },
                          },
                      ]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        expect(errors(body)).toEqual([undefined]);
        const stored = body.features[0] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(faces[0].shape as any).center);
        expect(stored.axisSource).toEqual({ nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) });
    });

    /**
     * Two circles overlapping their radii: the kernel path splits them into regions that
     * ALL share the one entity set {1, 2}, so matching rests on the region fingerprint
     * alone. Every region must still re-pick unambiguously.
     */
    test("G: overlapping circles — every region of the shared entity set re-picks cleanly", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [
                    { id: 1, type: "circle", params: [0, 0, 3] },
                    { id: 2, type: "circle", params: [4, 0, 3] },
                ],
                constraints: [],
            },
        });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 3, type: "line", params: [-5, -5, -5, 5] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const faces = sketchFaces(sketch);
        // Two crescents and the lens between them.
        expect(faces.length).toBe(3);
        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const axis = { point: { x: -5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } };

        // Every region on its own is a clean profile for a fresh revolve.
        for (const face of faces) {
            const body = new ParametricBodyNode({
                document: doc,
                features: [
                    {
                        id: `r-${faces.indexOf(face)}`,
                        type: "revolve",
                        sketchId: sketch.id,
                        axis,
                        axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
                        angle: 270,
                        profiles: [captureProfileRef(face.shape as any)],
                    },
                ],
            });
            doc.modelManager.addNode(body);
            // Forces the first build (the shape is lazy) and with it the sketch watch.
            expect(body.shape.isOk).toBe(true);
            expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        }

        // And re-picking one region for another through the session follows.
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis,
                    axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
                    angle: 270,
                    profiles: [captureProfileRef(faces[0].shape as any)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [
                          {
                              shape: faces[1].shape,
                              transform: Matrix4.identity(),
                              indexes: [1],
                              owner: { node: sketch },
                          },
                      ]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(errors(body)).toEqual([undefined]);
        const stored = (body.features[0] as RevolveFeatureData).profiles!;
        expect(stored).toHaveLength(1);
        expect(stored[0].center).toEqual(captureProfileRef(faces[1].shape as any).center);
    });

    /**
     * The error itself: the stored profile's region is gone (its entity deleted) and two
     * equal candidates remain — the matcher refuses to guess. The reselect is the repair:
     * picking one of the candidates rebuilds the feature clean.
     */
    test("H: a lost region with two equal candidates is ambiguous, and reselecting repairs it", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 1, type: "circle", params: [0, 0, 3] }], constraints: [] },
        });
        doc.modelManager.addNode(sketch);
        const axisSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [{ id: 9, type: "line", params: [10, 20, 10, 30] }], constraints: [] },
        });
        doc.modelManager.addNode(axisSketch);

        const axisEdge = sketchEdges(axisSketch)[0].shape;
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: { point: { x: 10, y: 20, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: axisSketch.id, edge: captureEdgeRef(axisEdge as any) },
            angle: 270,
            profiles: [captureProfileRef(sketchFaces(sketch)[0].shape as any)],
        };
        const body = new ParametricBodyNode({ document: doc, features: [feature] });
        doc.modelManager.addNode(body);
        // Forces the first build (the shape is lazy) and with it the sketch watch.
        expect(body.shape.isOk).toBe(true);
        expect(errors(body)).toEqual([undefined]);

        // Delete the circle and draw two identical ones beside the old spot. The stored
        // ref's entity is gone, and the two survivors tie geometrically.
        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 2, type: "circle", params: [-10, 0, 3] },
                { id: 3, type: "circle", params: [10, 0, 3] },
            ],
            constraints: [],
        });
        expect(errors(body)).toEqual(["Sketch profile match is ambiguous after rebuild"]);

        const faces = sketchFaces(sketch);
        expect(faces.length).toBe(2);
        const left = faces.find((x) => (captureProfileRef(x.shape as any).center?.x ?? 0) < 0);
        expect(left).toBeDefined();
        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            return Promise.resolve(
                (picks === 1
                    ? [
                          {
                              shape: left!.shape,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: sketch },
                          },
                      ]
                    : [
                          {
                              shape: axisEdge,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              owner: { node: axisSketch },
                          },
                      ]) as any,
            );
        });

        await body.reselectShapes("r1");
        expect(errors(body)).toEqual([undefined]);
        const stored = (body.features[0] as RevolveFeatureData).profiles!;
        expect(stored).toHaveLength(1);
        expect(stored[0].center?.x).toBeCloseTo(-10);
    });

    /**
     * The axis edge lives on the HOST body itself: `axisSource.nodeId === host.id`, resolved by
     * `axisFromInput` against the revolve's input on every rebuild. Every other scenario sources
     * the axis from a sketch; this one pins the self-source path AND the rollback the axis pick
     * needs for it — the pick must run against the bare box (the revolve's input), not the
     * revolved result.
     */
    test("I: axis re-picked on the host body itself", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: loop(0, 0, 10, 10) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 10 }],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        // The bare box's X-parallel edges: the original axis is the bottom one at
        // y=10 (z=0); the re-pick moves it to the top one at z=10 (y=0).
        const boxEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        expect(boxEdges.length).toBe(12);
        const onAxis = (edge: IEdge, y: number, z: number) =>
            [edge.startPoint(), edge.endPoint()].every(
                (p) => Math.abs(p.y - y) < 1e-6 && Math.abs(p.z - z) < 1e-6,
            );
        const oldAxisIndex = boxEdges.findIndex((edge) => onAxis(edge, 10, 0));
        expect(oldAxisIndex).toBeGreaterThanOrEqual(0);
        const oldAxisId = body.edgeIdAt(oldAxisIndex);
        const oldAxisRef = captureEdgeRef(boxEdges[oldAxisIndex], oldAxisId, body.edgeIdIsShared(oldAxisId));

        // The profile sketch sits clear of the box (x∈[20,30]) in the old axis's own
        // plane (z=0); the new axis stays parallel to that plane, so both revolves build.
        const profileSketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: loop(20, 0, 30, 10),
        });
        doc.modelManager.addNode(profileSketch);
        const profileFace = sketchFaces(profileSketch)[0].shape;

        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: profileSketch.id,
            axis: axisOf(boxEdges[oldAxisIndex]),
            axisSource: { nodeId: body.id, edge: oldAxisRef },
            angle: 270,
            profiles: [captureProfileRef(profileFace as any)],
        };
        body.setFeaturesEmitShapeChanged([...body.features, feature]);
        expect(errors(body)).toEqual([undefined, undefined]);

        doc.application.activeView = { document: doc } as any;
        doc.selection = createMockSelection();
        let picks = 0;
        let edgesAtAxisPick = -1;
        let newAxisRef: EdgeRef | undefined;
        doc.picker.pickShape = rs.fn((_prompt: I18nKeys, _controller: AsyncController) => {
            picks++;
            if (picks === 1) {
                return Promise.resolve([
                    {
                        shape: profileFace,
                        transform: Matrix4.identity(),
                        indexes: [0],
                        owner: { node: profileSketch },
                    },
                ] as any);
            }
            // Read LIVE: the session must have rolled the body back to just before the
            // revolve, so the pick sees the bare box — not the revolved shape.
            const liveEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
            edgesAtAxisPick = liveEdges.length;
            const index = liveEdges.findIndex((edge) => onAxis(edge, 0, 10));
            expect(index).toBeGreaterThanOrEqual(0);
            const edgeId = body.edgeIdAt(index);
            newAxisRef = captureEdgeRef(liveEdges[index], edgeId, body.edgeIdIsShared(edgeId));
            return Promise.resolve([
                {
                    shape: liveEdges[index],
                    transform: Matrix4.identity(),
                    indexes: [index],
                    owner: { node: body },
                },
            ] as any);
        });

        await body.reselectShapes("r1");
        expect(picks).toBe(2);
        // Rolled back at the axis pick: the bare box, not the revolved result.
        expect(edgesAtAxisPick).toBe(boxEdges.length);
        expect(errors(body)).toEqual([undefined, undefined]);
        const stored = body.features[1] as RevolveFeatureData;
        expect(stored.profiles).toHaveLength(1);
        expect(stored.profiles![0].center).toEqual(captureProfileRef(profileFace as any).center);
        // Stored as a SELF-source with the ref captured at pick time: from now on the axis
        // resolves against the revolve's input (`axisFromInput`), not a sketch node.
        expect(stored.axisSource).toEqual({ nodeId: body.id, edge: newAxisRef });
        // The world-space snapshot moved too (y=0, z=10, ±X; the old axis sat at y=10, z=0).
        expect(stored.axis.point.y).toBeCloseTo(0);
        expect(stored.axis.point.z).toBeCloseTo(10);
        expect(Math.abs(stored.axis.direction.x)).toBeCloseTo(1);
    });
});
