// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * What the SKETCH EDITOR does to the features downstream of the sketch it is editing —
 * the drags, constraint edits and deletions a user performs in the sketch session, driven
 * through the real `SketchEditor` + solver rather than by replacing the sketch data.
 *
 * The session is what makes this a separate concern from `extrudeFollow.kernel.test.ts`:
 * while it is open the owning bodies are rolled back to their pre-sketch state, so every
 * assertion here is about what the committed edit leaves behind once the session exits —
 * whether the downstream chain re-resolves onto the edited geometry, or reports honestly
 * when the edit destroyed what it referenced.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ICameraController, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { SketchEditor } from "../src/sketch/editor/sketchEditor";
import { ConstraintKind, type SketchData } from "../src/sketch/sketchModel";
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

/** A document with an active view — `SketchEditor.enter` needs one. */
function editorDoc(): TestDocument {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc, { viewHandler: { canRotate: true } as any }) as any;
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    (app as any).activeView = createMockView({
        document: doc,
        cameraController: camera as unknown as ICameraController,
    });
    return doc;
}

/** A rectangle whose corners are actually constrained together, as the editor draws it. */
function constrainedRect(x1: number, y1: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, x1, 0] },
            { id: 2, type: "line", params: [x1, 0, x1, y1] },
            { id: 3, type: "line", params: [x1, y1, 0, y1] },
            { id: 4, type: "line", params: [0, y1, 0, 0] },
        ],
        constraints: [
            {
                id: 1,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 2, pointIndex: 0 },
                ],
            },
            {
                id: 2,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 2, pointIndex: 1 },
                    { entityId: 3, pointIndex: 0 },
                ],
            },
            {
                id: 3,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 3, pointIndex: 1 },
                    { entityId: 4, pointIndex: 0 },
                ],
            },
            {
                id: 4,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 4, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
        ],
    };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function extent(body: ParametricBodyNode): number[] {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

function expectClean(...bodies: ParametricBodyNode[]): void {
    const broken = bodies
        .flatMap((body) => body.featureItems().map((item) => ({ body: body.id, item })))
        .filter((x) => x.item.error !== undefined)
        .map((x) => `${x.item.id}: ${x.item.error}`);
    expect(broken).toEqual([]);
}

/** A box extruded from the sketch, plus a press-pull off its +x face. */
function boxWithPressPull(doc: TestDocument, sketch: SketchNode): ParametricBodyNode {
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => face.normal(0, 0)[1].x > 1 - 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    const id = body.faceIdAt(index);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            depth: 10,
            operation: "fuse",
            source: {
                nodeId: body.id,
                profiles: [captureProfileRef(faces[index], id, body.faceIdIsShared(id), true)],
            },
        },
    ]);
    return body;
}

describe("sketch editor interactions", () => {
    test("dragging a corner carries the extrude and the press-pull on its face", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        // Drag the top-right corner out along +x, the way a pointer drag does.
        const editor = SketchEditor.enter(sketch);
        editor.solver.beginDrag([{ entityId: 2, pointIndex: 0 }]);
        editor.solver.dragTo({ entityId: 2, pointIndex: 0 }, 60, 0);
        editor.solver.endDrag();
        editor.commit();
        editor.exit();

        expectClean(body);
        const box = extent(body);
        expect(box[3]).toBeGreaterThan(50);
        expect(round(box[1])).toBe(0);
    });

    test("consecutive drags accumulate, and dragging back leaves no residue", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);

        const dragCornerTo = (u: number) => {
            const editor = SketchEditor.enter(sketch);
            editor.solver.beginDrag([{ entityId: 2, pointIndex: 0 }]);
            editor.solver.dragTo({ entityId: 2, pointIndex: 0 }, u, 0);
            editor.solver.endDrag();
            editor.commit();
            editor.exit();
        };

        dragCornerTo(60);
        expectClean(body);
        const wider = extent(body)[3];
        expect(wider).toBeGreaterThan(50);

        dragCornerTo(80);
        expectClean(body);
        expect(extent(body)[3]).toBeGreaterThan(wider);

        // Back to where it started: the press-pull must land exactly where it began,
        // not on a drifted re-anchor of its face.
        dragCornerTo(40);
        expectClean(body);
        extent(body).forEach((value, index) => {
            expect(value).toBeCloseTo([0, 0, 0, 50, 40, 40][index], 1);
        });
    });

    test("deleting a profile entity strands the downstream chain, restoring it heals", () => {
        const doc = editorDoc();
        const data = constrainedRect(40, 40);
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);

        // Opening the outline strands the extrude: there is no closed profile left.
        const open = { ...data, entities: data.entities.slice(0, 3) };
        sketch.setDataEmitShapeChanged(open);
        expect(body.featureItems()[0].error).toBeDefined();
        // The failed chain keeps the last good shape rather than blanking the body.
        expect(body.shape.isOk).toBe(true);

        sketch.setDataEmitShapeChanged(data);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });
});

/**
 * The TNP scenarios FreeCAD's `TestTopologicalNamingProblem.py` pins that this codebase
 * can reproduce — reached by REWRITING the sketch data, since the editor has no split or
 * trim operation. The point in each is the same one FreeCAD asserts: the outline's
 * geometry is unchanged or barely changed, but the entity list re-enumerates, so anything
 * downstream that anchored by index rather than by identity would silently move.
 */
describe("sketch geometry rewrites", () => {
    const coincident = (id: number, a: number, aPoint: number, b: number, bPoint: number) => ({
        id,
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: a, pointIndex: aPoint },
            { entityId: b, pointIndex: bPoint },
        ],
    });

    // The sweep's face ids are PREFIXED by the sketch's entity-id set — `...:e1.2.3.4:ent2` —
    // so rewriting the outline rewrites every face id at once (`e1.2.3.4.5:ent2`) even when the
    // geometry is untouched. FreeCAD's TNP suite pins this scenario; the matcher falls back to
    // the id's entity segment, which survives the rewrite (see `matchFingerprintRefs`).
    test("splitting one outline edge into two keeps the downstream chain resolving", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        // The bottom edge becomes two segments at x=20 — the outline is identical, but
        // the entity list gained an entry and its ids no longer run 1..4.
        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [0, 0, 20, 0] },
                { id: 5, type: "line", params: [20, 0, 40, 0] },
                { id: 2, type: "line", params: [40, 0, 40, 40] },
                { id: 3, type: "line", params: [40, 40, 0, 40] },
                { id: 4, type: "line", params: [0, 40, 0, 0] },
            ],
            constraints: [
                coincident(1, 1, 1, 5, 0),
                coincident(2, 5, 1, 2, 0),
                coincident(3, 2, 1, 3, 0),
                coincident(4, 3, 1, 4, 0),
                coincident(5, 4, 1, 1, 0),
            ],
        });

        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("translating the whole outline carries the extrude and the press-pull", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        /** The whole outline shifted along +u, as the editor's move-geometry does. */
        const slid = (dx: number): SketchData => {
            const base = constrainedRect(40, 40);
            return {
                entities: base.entities.map((e) => ({
                    ...e,
                    params: e.params.map((value, index) => (index % 2 === 0 ? value + dx : value)),
                })),
                constraints: base.constraints,
            };
        };

        sketch.setDataEmitShapeChanged(slid(100));
        expectClean(body);
        expect(extent(body)).toEqual([100, 0, 0, 150, 40, 40]);

        // Sliding back must land exactly where it started — the press-pull's face is
        // re-found by identity, not re-anchored somewhere along the way.
        sketch.setDataEmitShapeChanged(slid(0));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("rotating the whole outline about the sketch origin", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);

        // A quarter turn: (u,v) -> (-v,u), so the box's +x face becomes its y=0 side.
        const turned = (): SketchData => {
            const base = constrainedRect(40, 40);
            return {
                entities: base.entities.map((e) => {
                    const rotated: number[] = [];
                    for (let i = 0; i < e.params.length; i += 2) {
                        rotated.push(-e.params[i + 1], e.params[i]);
                    }
                    return { ...e, params: rotated };
                }),
                constraints: base.constraints,
            };
        };

        sketch.setDataEmitShapeChanged(turned());
        expectClean(body);
        // The outline's +x edge (entity 2) lands on y=40, so the press-pull follows the
        // SAME outline edge to its new direction rather than staying on the x axis.
        const box = extent(body);
        expect(round(box[0])).toBe(-40);
        expect(round(box[1])).toBe(0);
        expect(round(box[3])).toBe(0);
        expect(round(box[4])).toBe(50);
        expect(round(box[5])).toBe(40);
    });

    test("turning the top edge into an arc keeps the chain resolving", () => {
        const doc = editorDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: constrainedRect(40, 40) });
        doc.modelManager.addNode(sketch);
        const body = boxWithPressPull(doc, sketch);
        expectClean(body);

        // The top edge is replaced by a half-circle bulging to z=60: a different curve
        // KIND on a boundary the extrude's profile and the press-pull's face both name.
        sketch.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [0, 0, 40, 0] },
                { id: 2, type: "line", params: [40, 0, 40, 40] },
                // centre (20,40), start (40,40), end (0,40) — counter-clockwise over the top.
                { id: 3, type: "arc", params: [20, 40, 40, 40, 0, 40] },
                { id: 4, type: "line", params: [0, 40, 0, 0] },
            ],
            constraints: [
                coincident(1, 1, 1, 2, 0),
                coincident(2, 2, 1, 3, 0),
                coincident(3, 3, 2, 4, 0),
                coincident(4, 4, 1, 1, 0),
            ],
        });

        expectClean(body);
        const box = extent(body);
        expect(round(box[2])).toBe(0);
        expect(round(box[5])).toBe(40);
        // The bulge is along the sketch's v axis (y), where the arc bulges out.
        expect(round(box[4])).toBe(60);
        expect(round(box[3])).toBe(50);
    });
});
