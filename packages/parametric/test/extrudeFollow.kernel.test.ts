// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    BoundingBox,
    type ICameraController,
    type ICircle,
    type IEdge,
    type IFace,
    type IShape,
    Plane,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { captureEdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
import { SketchEditor } from "../src/sketch/editor/sketchEditor";
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

function threeCircles(x1: number): SketchData {
    return {
        entities: [
            { id: 1, type: "circle", params: [x1, 0, 5] },
            { id: 2, type: "circle", params: [30, 0, 5] },
            { id: 3, type: "circle", params: [60, 0, 5] },
        ],
        constraints: [],
    };
}

test("an extrude of three picked circles follows when one circle moves", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: threeCircles(0) });
    doc.modelManager.addNode(sketch);

    // Capture refs from the displayed profile faces, exactly as a viewport pick does.
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(3);
    const profiles = faceRanges.map((x) => captureProfileRef(x.shape as unknown as IFace));

    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 10, profiles }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    expect(body.shape.unchecked()!.boundingBox().min.x).toBeCloseTo(-5, 1);

    // Move the first circle; the body must rebuild with the moved profile.
    sketch.setDataEmitShapeChanged(threeCircles(15));

    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
    expect(body.shape.unchecked()!.boundingBox().min.x).toBeCloseTo(10, 1);
});

test("an extrude follows a circle dragged in the sketch editor", () => {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc, { viewHandler: { canRotate: true } as any }) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: threeCircles(0) });
    doc.modelManager.addNode(sketch);
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(3);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: faceRanges.map((x) => captureProfileRef(x.shape as unknown as IFace)),
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Drag the first circle's center in the editor, exactly like the pointer flow does.
    const editor = SketchEditor.enter(sketch);
    editor.solver.beginDrag([{ entityId: 1, pointIndex: 0 }]);
    editor.solver.dragTo({ entityId: 1, pointIndex: 0 }, 15, 0);
    editor.solver.endDrag();
    editor.commit();
    editor.exit();

    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
    expect(body.shape.unchecked()!.boundingBox().min.x).toBeCloseTo(10, 1);
});

test("an extrude follows two circles dragged close together in consecutive edits", () => {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc, { viewHandler: { canRotate: true } as any }) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: threeCircles(0) });
    doc.modelManager.addNode(sketch);
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(3);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: faceRanges.map((x) => captureProfileRef(x.shape as unknown as IFace)),
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    const undoCount = doc.history.undoCount();

    // Drag the first circle to x=15, then the second next to it (x=25, tangent —
    // overlapping circles would cross and fall under the crossing-regions path). Against
    // the original pick-time refs both read as moved and compete ambiguously;
    // the refs must re-anchor after each successful rebuild ("Sketch profile
    // match is ambiguous after rebuild" was the user-reported failure).
    let editor = SketchEditor.enter(sketch);
    editor.solver.beginDrag([{ entityId: 1, pointIndex: 0 }]);
    editor.solver.dragTo({ entityId: 1, pointIndex: 0 }, 15, 0);
    editor.solver.endDrag();
    editor.commit();
    editor.exit();
    expect(body.featureItems()[0].error).toBeUndefined();

    editor = SketchEditor.enter(sketch);
    editor.solver.beginDrag([{ entityId: 2, pointIndex: 0 }]);
    editor.solver.dragTo({ entityId: 2, pointIndex: 0 }, 25, 0);
    editor.solver.endDrag();
    editor.commit();
    editor.exit();

    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
    const box = body.shape.unchecked()!.boundingBox();
    expect(box.min.x).toBeCloseTo(10, 1);
    expect(box.max.x).toBeCloseTo(65, 1);

    // The stored refs re-anchored to the last matched geometry...
    const stored = (body.features[0] as { profiles: { edges: { center: { x: number } }[] }[] }).profiles;
    const centers = stored.map((ref) => ref.edges[0].center.x).sort((a, b) => a - b);
    expect(centers).toEqual([15, 25, 60]);
    // ...without polluting the undo history: only the two editor commits record.
    expect(doc.history.undoCount()).toBe(undoCount + 2);
});

/** Rectangle 40x20 plus a vertical line on x=20 spanning y1..y2. */
function rectWithVerticalLine(y1: number, y2: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 40, 0] },
            { id: 2, type: "line", params: [40, 0, 40, 20] },
            { id: 3, type: "line", params: [40, 20, 0, 20] },
            { id: 4, type: "line", params: [0, 20, 0, 0] },
            { id: 5, type: "line", params: [20, y1, 20, y2] },
        ],
        constraints: [],
    };
}

test("an extrude of a crossing region survives the crossing line leaving the rectangle", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    // The line crosses the bottom edge and dangles inside the rectangle: the crossing
    // path yields one region whose boundary has 5 segments (the bottom edge is split).
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rectWithVerticalLine(10, -5) });
    doc.modelManager.addNode(sketch);
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(1);

    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: faceRanges.map((x) => captureProfileRef(x.shape as unknown as IFace)),
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Drag the line out of the rectangle: the crossing is gone, so the rebuilt profile
    // is the connectivity-path loop with a 4-edge boundary. The stored ref's 5-edge
    // fingerprint cannot apply — only the region fingerprint (center/area) re-matches.
    sketch.setDataEmitShapeChanged(rectWithVerticalLine(-15, -5));

    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
    const box = body.shape.unchecked()!.boundingBox();
    expect(box.min.x).toBeCloseTo(0, 1);
    expect(box.max.x).toBeCloseTo(40, 1);
    expect(box.max.y).toBeCloseTo(20, 1);
    expect(box.max.z).toBeCloseTo(10, 1);
});

/** Rectangle 40x40 with an off-center circle (radius 5) inside. */
function rectWithCircle(cx: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [-20, -20, 20, -20] },
            { id: 2, type: "line", params: [20, -20, 20, 20] },
            { id: 3, type: "line", params: [20, 20, -20, 20] },
            { id: 4, type: "line", params: [-20, 20, -20, -20] },
            { id: 5, type: "circle", params: [cx, 0, 5] },
        ],
        constraints: [],
    };
}

/** Rectangle 40x40 without inner loops. */
function rectOnly(): SketchData {
    return { entities: rectWithCircle(0).entities.slice(0, 4), constraints: [] };
}

/** Centers of the profile circles (radius > 2 excludes the fillet cross-section arcs). */
function circleCenters(shape: IShape): { x: number; y: number; z: number }[] {
    return (shape.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((e) => e.curve.basisCurve)
        .filter((c): c is ICircle => c.curveType === "circle" && (c as ICircle).radius > 2)
        .map((c) => ({ x: c.center.x, y: c.center.y, z: c.center.z }));
}

test.each([
    { symmetric: false },
    { symmetric: true },
])("a join-extruded inner circle and its fillet follow when the sketch circle moves (symmetric: $symmetric)", ({
    symmetric,
}) => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rectWithCircle(10) });
    doc.modelManager.addNode(sketch);

    // Outer profile (rect with the circular hole) first, then the inner circle.
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faceRanges.length).toBe(2);

    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(faceRanges[0].shape as unknown as IFace)],
            },
            {
                id: "e2",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                operation: "fuse",
                symmetric,
                profiles: [captureProfileRef(faceRanges[1].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Fillet the cylinder's top circular edge (z=10), captured like the command does.
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const topIndex = edges.findIndex((e) => {
        const curve = e.curve.basisCurve;
        return curve.curveType === "circle" && Math.abs((curve as ICircle).center.z - 10) < 1e-6;
    });
    expect(topIndex).toBeGreaterThanOrEqual(0);
    // The tracked operation path gives the edge a stable id, which is what lets
    // the fillet survive an arbitrarily large sketch edit.
    expect(body.edgeIdAt(topIndex)).toBeDefined();
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "f1",
            type: "fillet",
            radius: 1,
            edges: [captureEdgeRef(edges[topIndex], body.edgeIdAt(topIndex))],
        },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(body.shape.isOk).toBe(true);
    for (const center of circleCenters(body.shape.unchecked()!)) {
        expect(center.x).toBeCloseTo(10, 1);
    }

    // Move the sketch circle; the joined extrude and the fillet must follow.
    sketch.setDataEmitShapeChanged(rectWithCircle(0));

    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(body.shape.isOk).toBe(true);
    const centers = circleCenters(body.shape.unchecked()!);
    expect(centers.length).toBeGreaterThan(0);
    for (const center of centers) {
        expect(center.x).toBeCloseTo(0, 1);
    }
});

test("an extrude survives a circle drawn inside its profile, then the circle join-extrudes", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rectOnly() });
    doc.modelManager.addNode(sketch);

    // Extrude the rectangle first, as picked in the viewport.
    const rectFaces = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(rectFaces.length).toBe(1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(rectFaces[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Draw a circle inside the rectangle: it becomes a hole of the rectangle profile,
    // so the rebuilt profile face has more edges than the stored ref. The match must
    // survive (previously "Sketch profile not found after rebuild").
    sketch.setDataEmitShapeChanged(rectWithCircle(10));
    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);

    // Join-extrude the circle, as the command does in join mode.
    const faces = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faces.length).toBe(2);
    const circleFace = faces.find(
        (x) => (x.shape as unknown as IFace).findSubShapes(ShapeTypes.edge).length === 1,
    );
    expect(circleFace).toBeDefined();
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch.id,
            depth: 10,
            operation: "fuse",
            profiles: [captureProfileRef(circleFace!.shape as unknown as IFace)],
        },
    ]);

    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    expect(body.shape.isOk).toBe(true);
    // The joined cylinder's top circle at z=10 proves the fuse really happened.
    const centers = circleCenters(body.shape.unchecked()!);
    expect(centers.some((c) => Math.abs(c.z - 10) < 1e-6)).toBe(true);
});

/**
 * Two overlapping rectangles plus a horizontal line crossing both. Entities 1-4: rect A
 * (0,0)-(40,30); 5-8: rect B (20,10)-(50,35); 9: the crossing line. `lineY` shifts the
 * line's far endpoint, `corner` moves B's bottom-left corner — both keep every crossing.
 */
function twoRectsWithCrossingLine(lineY: number, corner: [number, number]): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 40, 0] },
            { id: 2, type: "line", params: [40, 0, 40, 30] },
            { id: 3, type: "line", params: [40, 30, 0, 30] },
            { id: 4, type: "line", params: [0, 30, 0, 0] },
            { id: 5, type: "line", params: [corner[0], corner[1], 50, 10] },
            { id: 6, type: "line", params: [50, 10, 50, 35] },
            { id: 7, type: "line", params: [50, 35, corner[0], 35] },
            { id: 8, type: "line", params: [corner[0], 35, corner[0], corner[1]] },
            { id: 9, type: "line", params: [-5, 15, 55, lineY] },
        ],
        constraints: [],
    };
}

test("an extrude of a minimal crossing region survives dragging the crossing line and a rectangle corner", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: twoRectsWithCrossingLine(15, [20, 10]),
    });
    doc.modelManager.addNode(sketch);

    // Pick the minimal region [20,40]x[10,15]: bounded by segments of entities 2 (A
    // right), 5 (B bottom), 8 (B left) and 9 (the line). Neighboring regions own
    // complementary segments of the same entities, so their geometric fingerprints
    // are near-identical — the entity-id set is the identity that survives the drag.
    const faceRanges = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const picked = faceRanges.find((x) => {
        const center = BoundingBox.center((x.shape as unknown as IFace).boundingBox());
        return Math.abs(center.x - 30) < 1e-6 && Math.abs(center.y - 12.5) < 1e-6;
    });
    expect(picked).toBeDefined();
    const ref = captureProfileRef(picked!.shape as unknown as IFace);
    // Verifies the edge-index → entity-id correspondence AND that the mesh range's
    // sub-shape wrapper resolves to the registered region face.
    expect(ref.entities).toEqual([2, 5, 8, 9]);

    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 10, profiles: [ref] }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Drag the line's endpoint and B's bottom-left corner, staying crossing. The
    // region re-splits its boundary, but its entity set is unchanged. (Without the
    // entity-set identity this exact edit fails: the rebuilt regions compete as
    // "Sketch profile match is ambiguous after rebuild".)
    sketch.setDataEmitShapeChanged(twoRectsWithCrossingLine(19, [5, 12]));

    expect(body.featureItems()[0].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
    // The rebuilt prism still spans the picked region — between B's moved left side
    // (x=5) and A's right side (x=40), from B's bottom edge (y≈10.4 at x=40) up to
    // the slanted line (y=18 at x=40). A wrong-region match would extrude a neighbor.
    const box = body.shape.unchecked()!.boundingBox();
    expect(box.min.x).toBeCloseTo(5, 1);
    expect(box.max.x).toBeCloseTo(40, 1);
    expect(box.min.y).toBeCloseTo(10.4, 1);
    expect(box.max.y).toBeCloseTo(18, 1);
    expect(box.max.z).toBeCloseTo(10, 1);

    // The re-anchored ref keeps the same entity set.
    const stored = (body.features[0] as { profiles: { entities?: number[] }[] }).profiles;
    expect(stored[0].entities).toEqual([2, 5, 8, 9]);
});
