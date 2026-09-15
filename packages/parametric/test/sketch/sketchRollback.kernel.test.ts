// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type ICameraController,
    type IEdge,
    type IFace,
    Plane,
    type PropertyHistoryRecord,
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
import { captureEdgeRef } from "../../src/features/edgeRef";
import { captureProfileRef } from "../../src/features/profileRef";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../../src/sketch";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { captureExternalRef } from "../../src/sketch/externalRef";
import { captureFaceRef, type PlaneFaceRef, sketchPlaneOfFace } from "../../src/sketch/planeRef";
import "./setup";

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
        { id: 1, type: "line", params: [-20, -20, 20, -20] },
        { id: 2, type: "line", params: [20, -20, 20, 20] },
        { id: 3, type: "line", params: [20, 20, -20, 20] },
        { id: 4, type: "line", params: [-20, 20, -20, -20] },
    ],
    constraints: [],
};

/** Editor environment: camera, view and visual mocks, mirroring the app shell. */
function setupEditorEnvironment() {
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
    return doc;
}

function faceCount(body: ParametricBodyNode): number {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face).length;
}

/** The box's top face (normal +Z) and its index on the body's current shape. */
function topFace(body: ParametricBodyNode): { face: IFace; index: number } {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => {
        if (!face.surface().isPlanar()) return false;
        const [, normal] = face.normal(0, 0);
        return normal.z > 1 - 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return { face: faces[index], index };
}

/**
 * A 40x40x20 box extruded from sketch1, plus sketch2 on its top face exactly as the
 * create-sketch command captures it: plane ref with faceId, the face's boundary
 * edges as reference-role external refs, and the timeline anchor (1 feature).
 */
function boxWithTopSketch(doc: TestDocument) {
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: RECT });
    doc.modelManager.addNode(sketch1);
    const profiles = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles.length).toBe(1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 20,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    const { face, index } = topFace(body);
    const plane = sketchPlaneOfFace(face);
    const planeRef: PlaneFaceRef = captureFaceRef(body.id, face);
    const faceId = body.faceIdAt(index);
    expect(faceId).toBeDefined();
    planeRef.faceId = faceId;

    // The top face's boundary edges, taken from the body's own edge list so the
    // tracked edge ids line up (face sub-edges do not isEqual the body's edges).
    const bodyEdges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const externalRefs: NonNullable<SketchData["externalRefs"]> = [];
    let nextId = -100;
    bodyEdges.forEach((edge, edgeIndex) => {
        if (edge.curve.basisCurve.curveType !== "line") return;
        if (Math.abs(edge.startPoint().z - 20) > 1e-6 || Math.abs(edge.endPoint().z - 20) > 1e-6) return;
        const ref = captureExternalRef(nextId--, body.id, plane, edge, body.edgeIdAt(edgeIndex), "reference");
        expect(ref).toBeDefined();
        externalRefs.push(ref!);
    });
    expect(externalRefs.length).toBe(4);

    const sketch2 = new SketchNode({
        document: doc,
        plane,
        planeRef,
        data: {
            entities: [{ id: 1, type: "circle", params: [0, 0, 5] }],
            constraints: [],
            externalRefs,
            refPositions: { [body.id]: 1 },
        },
    });
    doc.modelManager.addNode(sketch2);
    return { sketch1, body, sketch2 };
}

/** Join-extrudes sketch2's circle onto the box, as the extrude command in join mode. */
function joinExtrudeCircle(body: ParametricBodyNode, sketch2: SketchNode): void {
    const faces = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(faces.length).toBe(1);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: 10,
            operation: "fuse",
            profiles: [captureProfileRef(faces[0].shape as unknown as IFace)],
        },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
}

/** Fillets one of the top face's boundary edges — an edge sketch2 references. */
function filletReferencedTopEdge(body: ParametricBodyNode, sketch2: SketchNode): void {
    const ref = sketch2.data.externalRefs![0];
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    let index = ref.edge.edgeId === undefined ? undefined : body.edgeIndexById(ref.edge.edgeId);
    if (index === undefined) {
        // every top boundary edge is referenced, so any of them will do
        index = edges.findIndex((edge) => {
            if (edge.curve.basisCurve.curveType !== "line") return false;
            return Math.abs(edge.startPoint().z - 20) < 1e-6 && Math.abs(edge.endPoint().z - 20) < 1e-6;
        });
    }
    expect(index).toBeGreaterThanOrEqual(0);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "f1",
            type: "fillet",
            radius: 1,
            edges: [captureEdgeRef(edges[index!], body.edgeIdAt(index!))],
        },
    ]);
    expect(body.featureItems().every((x) => x.error === undefined)).toBe(true);
}

test("entering a consumed sketch rolls the body back to the sketch's timeline position", () => {
    const doc = setupEditorEnvironment();
    const { body, sketch2 } = boxWithTopSketch(doc);
    joinExtrudeCircle(body, sketch2);
    filletReferencedTopEdge(body, sketch2);
    expect(faceCount(body)).toBeGreaterThan(6);
    // the fillet consumed the referenced edge, but at the sketch's timeline anchor
    // (before the consuming extrude and the fillet) it still exists in full: the
    // anchored resolution keeps the ref resolved even off-session
    expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    const undoCount = doc.history.undoCount();

    const editor = SketchEditor.enter(sketch2);
    try {
        // rolled back to the anchor: only the box feature stays evaluated — the
        // consuming extrude and the fillet are hidden, the referenced edge is back
        expect(body.rollbackIndex).toBe(1);
        expect(faceCount(body)).toBe(6);
        expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    } finally {
        editor.exit();
    }

    expect(body.rollbackIndex).toBeUndefined();
    expect(faceCount(body)).toBeGreaterThan(6);
    // off-session semantics match the session's: refs still resolve at the anchor
    expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    // enter/exit leave no history records behind
    expect(doc.history.undoCount()).toBe(undoCount);
});

test("an unconsumed sketch hides features added after its creation via the anchor", () => {
    const doc = setupEditorEnvironment();
    const { body, sketch2 } = boxWithTopSketch(doc);
    // no feature consumes sketch2; a fillet was appended after its creation
    filletReferencedTopEdge(body, sketch2);
    expect(faceCount(body)).toBeGreaterThan(6);

    const editor = SketchEditor.enter(sketch2);
    try {
        expect(body.rollbackIndex).toBe(1);
        expect(faceCount(body)).toBe(6);
        expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    } finally {
        editor.exit();
    }

    expect(body.rollbackIndex).toBeUndefined();
    expect(faceCount(body)).toBeGreaterThan(6);
});

test("the rolled-back state reflects edits of earlier features, not a creation snapshot", () => {
    const doc = setupEditorEnvironment();
    const { body, sketch2 } = boxWithTopSketch(doc);
    joinExtrudeCircle(body, sketch2);

    // A feature BEFORE the sketch's anchor is edited: the face moves rigidly and
    // the refs follow off-session (the established follow behavior).
    body.setFeatureParameter("e1", "depth", 30);
    expect(body.shape.unchecked()!.boundingBox().max.z).toBeCloseTo(40, 1);
    expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);

    const editor = SketchEditor.enter(sketch2);
    try {
        expect(body.rollbackIndex).toBe(1);
        // rolled back to the anchor but WITH the updated depth — z=30, not the
        // creation-time 20: the rollback re-evaluates, it does not restore a snapshot
        expect(faceCount(body)).toBe(6);
        expect(body.shape.unchecked()!.boundingBox().max.z).toBeCloseTo(30, 1);
        expect(sketch2.data.externalRefs!.every((ref) => ref.dangling !== true)).toBe(true);
    } finally {
        editor.exit();
    }

    expect(body.rollbackIndex).toBeUndefined();
    expect(body.shape.unchecked()!.boundingBox().max.z).toBeCloseTo(40, 1);
});

test("a source edit mid-session re-resolves the refs and re-seeds the live solver", () => {
    const doc = setupEditorEnvironment();
    const { sketch1, body, sketch2 } = boxWithTopSketch(doc);
    // The viewport renders a visible sketch, which is what subscribes the
    // source-node watch (lazy, on first shape evaluation) — simulate the render.
    expect(sketch2.shape.isOk).toBe(true);
    // a feature added after the sketch's creation, so the session rolls back to it
    filletReferencedTopEdge(body, sketch2);
    const editor = SketchEditor.enter(sketch2);
    try {
        expect(body.rollbackIndex).toBe(1);

        // Shrink the base rectangle mid-session: the rolled-back body rebuilds, the
        // top face and its boundary edges move, and the refs must follow — through
        // the untransacted dataJson write and the editor's reseed + re-solve.
        const add = rs.spyOn(doc.history, "add");
        sketch1.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [-10, -10, 10, -10] },
                { id: 2, type: "line", params: [10, -10, 10, 10] },
                { id: 3, type: "line", params: [10, 10, -10, 10] },
                { id: 4, type: "line", params: [-10, 10, -10, -10] },
            ],
            constraints: [],
        });

        expect(body.shape.unchecked()!.boundingBox().max.x).toBeCloseTo(10, 6);
        const refs = sketch2.data.externalRefs!;
        expect(refs.length).toBe(4);
        expect(refs.every((ref) => ref.dangling !== true)).toBe(true);
        // every ref edge re-matched the smaller box's top boundary (edge length 20)
        for (const ref of refs) {
            const [x0, y0, x1, y1] = ref.snapshot;
            expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(20, 6);
            // the live solver was re-seeded with the same geometry
            expect(editor.solver.entity(ref.entityId)?.params).toEqual(ref.snapshot);
        }
        // the follow write is untransacted: history gained the user's own sketch1
        // edit, but not a single record targeting the edited sketch
        const followRecords = add.mock.calls.filter(
            (call) => (call[0] as unknown as PropertyHistoryRecord).object === sketch2,
        );
        expect(followRecords.length).toBe(0);
        add.mockRestore();
    } finally {
        editor.exit();
    }

    expect(body.rollbackIndex).toBeUndefined();
    expect(body.shape.unchecked()!.boundingBox().max.x).toBeCloseTo(10, 6);
});
