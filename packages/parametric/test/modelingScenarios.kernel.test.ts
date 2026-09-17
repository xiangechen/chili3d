// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * End-to-end walkthroughs of common modeling flows — the COMBINATIONS the focused suites
 * each cover only in isolation. Every scenario is asserted on the same three practical
 * invariants, because a parametric feature chain can be wrong without failing:
 *
 * 1. no feature row reports an error;
 * 2. an upstream edit carries the whole chain — the geometry follows, nothing is stranded;
 * 3. undoing that edit by a second one leaves no residue: the geometry returns to exactly
 *    where it started, which catches re-anchoring drift a single edit hides.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    BoundingBox,
    type IEdge,
    type IFace,
    Matrix4,
    Plane,
    Serializer,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type {
    BooleanFeatureData,
    BooleanOperation,
    ExtrudeFeatureData,
    FeatureData,
} from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureFaceRef, sketchPlaneOfFace } from "../src/sketch/planeRef";
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

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** A parametric body extruded from a rectangle on the XY plane: a `size` cube at the origin. */
function boxBody(doc: TestDocument, size: number): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, size, size) });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: size,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

/** The body's face whose outward normal is +`axis`, with the pick-time ref a command would store. */
function outwardFace(source: ParametricBodyNode, axis: "x" | "y" | "z") {
    const faces = source.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => face.normal(0, 0)[1][axis] > 1 - 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    const id = source.faceIdAt(index);
    return { face: faces[index], ref: captureProfileRef(faces[index], id, source.faceIdIsShared(id), true) };
}

/** A press-pull of `source`'s +`axis` face. `source` may be the consuming body itself. */
function pressPullFeature(
    id: string,
    source: ParametricBodyNode,
    axis: "x" | "y" | "z",
    depth: number,
    operation?: BooleanOperation,
): ExtrudeFeatureData {
    return {
        id,
        type: "extrude",
        depth,
        ...(operation === undefined ? {} : { operation }),
        source: { nodeId: source.id, profiles: [outwardFace(source, axis).ref] },
    };
}

/** A boolean feature reading the given tool bodies. */
function booleanFeature(
    id: string,
    operation: BooleanOperation,
    toolIds: string[],
    consumeTools = true,
): BooleanFeatureData {
    return { id, type: "boolean", operation, toolIds, consumeTools };
}

function append(body: ParametricBodyNode, ...features: FeatureData[]): void {
    body.setFeaturesEmitShapeChanged([...body.features, ...features]);
}

/** Fillet an edge of the body's current shape, chosen by the caller's predicate. */
function fillet(body: ParametricBodyNode, id: string, pick: (edge: IEdge) => boolean): void {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edge = edges.find(pick);
    expect(edge).toBeDefined();
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id, type: "fillet", radius: 2, edges: [captureEdgeRef(edge!)] },
    ]);
}

/** Chamfer an edge of the body's current shape, by the same predicate rule. */
function chamfer(body: ParametricBodyNode, id: string, pick: (edge: IEdge) => boolean): void {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edge = edges.find(pick);
    expect(edge).toBeDefined();
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id, type: "chamfer", distance: 2, edges: [captureEdgeRef(edge!)] },
    ]);
}

/** Picks mid-edge of the body face at `axis = offset` — edge bounds carry an OCCT gap. */
function atPlane(axis: "x" | "y" | "z", offset: number) {
    return (edge: IEdge) => round(BoundingBox.center(edge.boundingBox())[axis]) === offset;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** The axis-aligned extent of a body — the coarsest shape fingerprint worth asserting. */
function extent(body: ParametricBodyNode): number[] {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

/** Fails with the offending row when any feature of any body reports an error. */
function expectClean(...bodies: ParametricBodyNode[]): void {
    const broken = bodies
        .flatMap((body) => body.featureItems().map((item) => ({ body: body.id, item })))
        .filter((x) => x.item.error !== undefined)
        .map((x) => `${x.item.id}: ${x.item.error}`);
    expect(broken).toEqual([]);
}

/** Extent with a tolerance — revolved/cylindrical faces are B-spline approximations. */
function expectExtent(body: ParametricBodyNode, expected: number[], digits = 1): void {
    extent(body).forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
}

function setDepth(body: ParametricBodyNode, featureId: string, depth: number): void {
    body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === featureId ? { ...f, depth } : f)));
}

describe("press-pull flows", () => {
    test("a fillet on an edge the press-pull created follows the upstream depth", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        // The far face of the swept prism — the edge set the press-pull created.
        fillet(body, "f1", atPlane("x", 50));
        expectClean(body);

        setDepth(body, "e1", 20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 20]);

        // Undone by a second edit: no re-anchoring drift from the round trip.
        setDepth(body, "e1", 40);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("a chamfer down the press-pull's seam follows the same way", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        chamfer(body, "c1", atPlane("x", 50));
        expectClean(body);

        setDepth(body, "e1", 20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 20]);

        setDepth(body, "e1", 40);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("a press-pull whose source body is gone reports the loss", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        const { ref } = outwardFace(body, "x");
        append(body, {
            id: "e2",
            type: "extrude",
            depth: 10,
            source: { nodeId: "no-such-body", profiles: [ref] },
        } as ExtrudeFeatureData);

        expect(body.featureItems()[1].error).toBe("Extrude source body not found");
        // The failed chain keeps the last good shape rather than showing nothing.
        expect(body.shape.isOk).toBe(true);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);
    });

    test("a press-pull onto a face a previous press-pull created (chained)", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        expectClean(body);
        append(body, pressPullFeature("e3", body, "x", 10, "fuse"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 40]);

        setDepth(body, "e1", 20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 20]);
        setDepth(body, "e1", 40);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 40]);
    });

    test("editing a mid-chain press-pull's depth carries its own downstream", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        append(body, pressPullFeature("e3", body, "x", 10, "fuse"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 40]);

        // The first press-pull grows: the second is recorded on ITS face, so it rides along.
        setDepth(body, "e2", 20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 70, 40, 40]);

        setDepth(body, "e2", 10);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 40]);
    });

    test("a press-pull cutting into the body it is sourced on", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        // Cut inward from the top: the swept prism goes -10 along the face normal, so the
        // whole 10 mm slab above the remaining box is removed.
        append(body, pressPullFeature("e2", body, "z", -10, "cut"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 30]);

        setDepth(body, "e2", -20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 20]);
        setDepth(body, "e2", -10);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 30]);
    });

    test("moving the body a press-pull is sourced on carries the swept solid", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 10)],
        });
        doc.modelManager.addNode(tool);
        expectClean(host, tool);
        expect(extent(tool)).toEqual([40, 0, 0, 50, 40, 40]);

        host.transform = Matrix4.fromTranslation(5, 0, 0);
        expectClean(host, tool);
        expect(extent(tool)).toEqual([45, 0, 0, 55, 40, 40]);

        host.transform = Matrix4.identity();
        expectClean(host, tool);
        expect(extent(tool)).toEqual([40, 0, 0, 50, 40, 40]);
    });
});

describe("boolean flows", () => {
    test("fusing a press-pulled body back, then filleting the fused result", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        expectClean(host, tool);

        append(host, booleanFeature("b1", "fuse", [tool.id], true));
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        // A downstream feature on the fused solid, over a tool that keeps rebuilding.
        fillet(host, "f1", atPlane("x", 60));
        expectClean(host, tool);

        setDepth(host, "e1", 20);
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 20]);
    });

    test("one boolean consuming two moved tool bodies", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const left = boxBody(doc, 40);
        const right = boxBody(doc, 40);
        left.transform = Matrix4.fromTranslation(-40, 0, 0);
        right.transform = Matrix4.fromTranslation(40, 0, 0);
        expectClean(host, left, right);

        append(host, booleanFeature("b1", "fuse", [left.id, right.id], true));
        expectClean(host, left, right);
        expect(extent(host)).toEqual([-40, 0, 0, 80, 40, 40]);

        // Editing one consumed tool still drives the host's fuse: the moved box shortens in
        // z, but the host itself is 40 tall, so the fused extent keeps that height.
        setDepth(left, "e1", 20);
        expectClean(host, left, right);
        expect(extent(host)).toEqual([-40, 0, 0, 80, 40, 40]);
    });

    test("a press-pull chain across three bodies, outermost fused back into the base", () => {
        const doc = newDoc();
        const base = boxBody(doc, 40);
        const middle = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", base, "x", 10)],
        });
        doc.modelManager.addNode(middle);
        const outer = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e3", middle, "x", 10)],
        });
        doc.modelManager.addNode(outer);
        expectClean(base, middle, outer);
        expect(extent(outer)).toEqual([50, 0, 0, 60, 40, 40]);

        // Both layers come home: the base swallows the middle, which the outer is built on —
        // a base ← middle ← outer ← base cycle that the refresh hook has to unwind.
        append(base, booleanFeature("b1", "fuse", [middle.id, outer.id], true));
        expectClean(base, middle, outer);
        expect(extent(base)).toEqual([0, 0, 0, 60, 40, 40]);

        // The base's upstream grows: both layers ride along, and the fuse re-settles.
        setDepth(base, "e1", 20);
        expectClean(base, middle, outer);
        expect(extent(base)).toEqual([0, 0, 0, 60, 40, 20]);
    });

    test("a cut whose tool is a separately built body", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = boxBody(doc, 10);
        tool.transform = Matrix4.fromTranslation(-5, -5, 30);
        append(host, booleanFeature("b1", "cut", [tool.id], false));
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 40, 40, 40]);

        // The tool stays in the scene (consumeTools off) and still cuts when it moves.
        tool.transform = Matrix4.fromTranslation(-5, -5, 30);
        expectClean(host, tool);
    });
});

describe("expression and history flows", () => {
    test("a variable drives a press-pull chain and re-driving it carries every body", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "v1", type: "variable", name: "w", expression: "40" },
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: "w",
                    profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        append(body, {
            ...pressPullFeature("e2", body, "x", 10, "fuse"),
            depth: "w / 4",
        } as ExtrudeFeatureData);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        // Only the height follows the variable: the rectangle stays 40×40, so the swept
        // prism reaches x = 40 + 20/4.
        body.setFeatureParameter("v1", "expression", "20");
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 45, 40, 20]);

        body.setFeatureParameter("v1", "expression", "40");
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("undo and redo of an edit restore the fused pair exactly", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        append(host, booleanFeature("b1", "fuse", [tool.id], true));
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        Transaction.execute(doc, "edit extrude", () => setDepth(host, "e1", 20));
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 20]);

        doc.history.undo();
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        doc.history.redo();
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 20]);
    });

    test("press-pulling the round top of a boss built on the body", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const top = faces.find((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        expect(top).toBeDefined();
        const boss = new SketchNode({
            document: doc,
            plane: sketchPlaneOfFace(top!),
            // Without the ref the plane is a snapshot and the boss would stay at z=40 when
            // the box below it shrinks.
            planeRef: captureFaceRef(body.id, top!),
            data: {
                entities: [{ id: 1, type: "circle", params: [20, 20, 8] }],
                constraints: [],
                // The command records where the source body stood when the sketch was made;
                // without it the plane falls back to the body's FINAL shape and stops following.
                refPositions: { [body.id]: 1 },
            },
        });
        doc.modelManager.addNode(boss);
        const bossProfiles =
            boss.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        append(body, {
            id: "e2",
            type: "extrude",
            sketchId: boss.id,
            depth: 10,
            operation: "fuse",
            profiles: [captureProfileRef(bossProfiles[0].shape as unknown as IFace)],
        } as ExtrudeFeatureData);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 50]);

        // The boss's flat round top, pressed 5 further along its own normal. It has to be
        // named explicitly: the box's own top face shares the +z direction.
        const bossFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const bossTopIndex = bossFaces.findIndex((face) => Math.abs(face.normal(0, 0)[0].z - 50) < 1e-6);
        expect(bossTopIndex).toBeGreaterThanOrEqual(0);
        const bossId = body.faceIdAt(bossTopIndex);
        append(body, {
            id: "e3",
            type: "extrude",
            depth: 5,
            operation: "fuse",
            source: {
                nodeId: body.id,
                profiles: [
                    captureProfileRef(bossFaces[bossTopIndex], bossId, body.faceIdIsShared(bossId), true),
                ],
            },
        } as ExtrudeFeatureData);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 55]);

        setDepth(body, "e1", 20);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 35]);
    });
});

describe("feature-list editing", () => {
    test("suppressing a press-pull drops it from the result, restoring brings it back", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        body.setFeatureSuppressed("e2", true);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);

        body.setFeatureSuppressed("e2", false);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("deleting features off the end leaves the rest consistent", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        append(body, pressPullFeature("e3", body, "x", 10, "fuse"));
        expect(extent(body)).toEqual([0, 0, 0, 60, 40, 40]);

        body.removeFeature("e3");
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        body.removeFeature("e2");
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);
    });

    test("a chain that goes upstream → downstream → up again settles", () => {
        // Edit the base, then edit the press-pull that reads it, then the base again —
        // each step must leave every body error-free and consistent.
        const doc = newDoc();
        const base = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", base, "x", 10)],
        });
        doc.modelManager.addNode(tool);
        const edits: [ParametricBodyNode, string, number][] = [
            [base, "e1", 30],
            [tool, "e2", 5],
            [base, "e1", 50],
            [tool, "e2", 20],
            [base, "e1", 40],
            [tool, "e2", 10],
        ];
        for (const [body, featureId, depth] of edits) {
            setDepth(body, featureId, depth);
            expectClean(base, tool);
        }
        expect(extent(base)).toEqual([0, 0, 0, 40, 40, 40]);
        expect(extent(tool)).toEqual([40, 0, 0, 50, 40, 40]);
    });
});

describe("revolve flows", () => {
    /** The profile plane: u → x, v → z, revolving around Z (as in revolveFaceId.kernel.test.ts). */
    const XZ_PLANE = new Plane({
        origin: XYZ.zero,
        normal: new XYZ({ x: 0, y: -1, z: 0 }),
        xvec: XYZ.unitX,
    });

    test("press-pulling a revolved ring's top face, then editing the profile", () => {
        const doc = newDoc();
        // A ring 10…20 wide, 30 tall.
        const sketch = new SketchNode({ document: doc, plane: XZ_PLANE, data: rect(10, 0, 20, 30) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                    angle: 360,
                },
            ],
        });
        doc.modelManager.addNode(body);
        expectClean(body);
        expectExtent(body, [-20, -20, 0, 20, 20, 30]);

        append(body, pressPullFeature("e2", body, "z", 5, "fuse"));
        expectClean(body);
        expectExtent(body, [-20, -20, 0, 20, 20, 35]);

        // The profile gets shorter: the ring and the press-pull above it both follow.
        sketch.setDataEmitShapeChanged(rect(10, 0, 20, 20));
        expectClean(body);
        expectExtent(body, [-20, -20, 0, 20, 20, 25]);

        sketch.setDataEmitShapeChanged(rect(10, 0, 20, 30));
        expectClean(body);
        expectExtent(body, [-20, -20, 0, 20, 20, 35]);
    });

    test("filleting the revolved ring where the press-pull leaves it", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: XZ_PLANE, data: rect(10, 0, 20, 30) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                    angle: 360,
                },
            ],
        });
        doc.modelManager.addNode(body);
        append(body, pressPullFeature("e2", body, "z", 5, "fuse"));
        expectClean(body);

        // The outer rim of the new top face — a circle of radius ~20 lying at z=35.
        fillet(body, "f1", (edge) => {
            const box = edge.boundingBox();
            return Math.abs(box.min.z - 35) < 0.5 && Math.abs(box.max.z - 35) < 0.5 && box.max.x > 19;
        });
        expectClean(body);

        sketch.setDataEmitShapeChanged(rect(10, 0, 20, 20));
        expectClean(body);
        expectExtent(body, [-20, -20, 0, 20, 20, 25]);
    });
});

describe("serialization flows", () => {
    test("a press-pulled tool and its consuming host survive a save/load round trip", async () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        append(host, booleanFeature("b1", "fuse", [tool.id], true));
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        // A real save/load, not a hand-rebuilt document: the tree comes back whole and
        // every shape is resolved lazily, in tree order, on the first read.
        const saved = doc.modelManager.serialize();
        const reloaded = newDoc();
        await reloaded.modelManager.deserialize(saved);

        const bodies = reloaded.modelManager.findNodes(
            (n) => n instanceof ParametricBodyNode,
        ) as ParametricBodyNode[];
        expect(bodies).toHaveLength(2);
        const host2 = bodies.find((b) => b.featureCount === 2);
        const tool2 = bodies.find((b) => b.featureCount === 1);
        expect(host2).toBeDefined();
        expect(tool2).toBeDefined();

        // The consumer needs the tool's shape and the tool needs the consumer's chain
        // state, so this deadlocks unless the consumed-tool path resolves without the
        // source having a final shape yet (see `sourceNodeFaces` in sourceFaceMatcher.ts).
        expectClean(host2!, tool2!);
        expect(extent(host2!)).toEqual([0, 0, 0, 60, 40, 40]);
        expect(extent(tool2!)).toEqual([40, 0, 0, 60, 40, 40]);

        // ...and the reloaded pair keeps editing like the original.
        setDepth(host2!, "e1", 20);
        expectClean(host2!, tool2!);
        expect(extent(host2!)).toEqual([0, 0, 0, 60, 40, 20]);
    });

    test("a reloaded chain follows its sketch, not just its stored refs", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        const fresh = newDoc();
        const reloaded = Serializer.deserializeObject(
            fresh,
            Serializer.serializeObject(body),
        ) as ParametricBodyNode;
        fresh.modelManager.addNode(reloaded);
        // The sketch it extrudes is not in the fresh document, so the reload cannot resolve
        // it — the row reports it rather than throwing.
        expect(reloaded.shape.isOk).toBe(false);
        expect(reloaded.featureItems()[0].error).toBe("Sketch not found");
    });
});

describe("transform flows", () => {
    test("rotating the body carries the press-pull around with it", () => {
        const doc = newDoc();
        // 60×20×10 slab, so a quarter turn is visible in the extent.
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 60, 20) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const host = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 10,
                    profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(host);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 10)],
        });
        doc.modelManager.addNode(tool);
        expectClean(host, tool);
        expect(extent(tool)).toEqual([60, 0, 0, 70, 20, 10]);

        host.transform = Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2);
        expectClean(host, tool);
        // The slab's 10×20 footprint becomes 20×10; the swept solid rides along.
        const turned = extent(tool);
        expect([
            round(turned[3] - turned[0]),
            round(turned[4] - turned[1]),
            round(turned[5] - turned[2]),
        ]).toEqual([20, 10, 10]);

        host.transform = Matrix4.identity();
        expectClean(host, tool);
        expect(extent(tool)).toEqual([60, 0, 0, 70, 20, 10]);
    });
});

describe("dependency edge cases", () => {
    test("a four-layer press-pull stack fused in reverse order", () => {
        const doc = newDoc();
        const base = boxBody(doc, 40);
        const l1 = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", base, "x", 10)],
        });
        doc.modelManager.addNode(l1);
        const l2 = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e3", l1, "x", 10)],
        });
        doc.modelManager.addNode(l2);
        const l3 = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e4", l2, "x", 10)],
        });
        doc.modelManager.addNode(l3);
        expectClean(base, l1, l2, l3);
        expect(extent(l3)).toEqual([60, 0, 0, 70, 40, 40]);

        // Reverse order on purpose: the layer needing the most upstream work comes first,
        // so resolving them in list order can only settle if the watch chain re-drags them.
        append(base, booleanFeature("b1", "fuse", [l3.id, l2.id, l1.id]));
        expectClean(base, l1, l2, l3);
        expect(extent(base)).toEqual([0, 0, 0, 70, 40, 40]);

        setDepth(base, "e1", 20);
        expectClean(base, l1, l2, l3);
        expect(extent(base)).toEqual([0, 0, 0, 70, 40, 20]);
        expect(extent(l3)).toEqual([60, 0, 0, 70, 40, 20]);

        setDepth(base, "e1", 40);
        expectClean(base, l1, l2, l3);
        expect(extent(base)).toEqual([0, 0, 0, 70, 40, 40]);
    });

    test("one tool body consumed by two hosts at once", () => {
        const doc = newDoc();
        const a = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", a, "x", 10)],
        });
        doc.modelManager.addNode(tool);
        const b = boxBody(doc, 40);

        append(a, booleanFeature("b1", "fuse", [tool.id]));
        expectClean(a, tool, b);
        expect(extent(a)).toEqual([0, 0, 0, 50, 40, 40]);

        // The second consumer takes the tool under itself (consumeTools). The first
        // consumer's boolean still has to find it by id, and both must stay consistent.
        append(b, booleanFeature("b2", "fuse", [tool.id]));
        expectClean(a, tool, b);
        expect(extent(a)).toEqual([0, 0, 0, 50, 40, 40]);
        expect(tool.parent).toBeDefined();

        setDepth(a, "e1", 20);
        expectClean(a, tool, b);
        expect(extent(a)).toEqual([0, 0, 0, 50, 40, 20]);
        expect(extent(tool)).toEqual([40, 0, 0, 50, 40, 20]);
    });

    test("suppressing a press-pull that a downstream feature is built on", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        fillet(body, "f1", atPlane("x", 50));
        expectClean(body);

        // The filleted edge is born from e2, so suppressing e2 strands it.
        body.setFeatureSuppressed("e2", true);
        const during = body.featureItems().map((x) => x.error);
        expect(during[0]).toBeUndefined();
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);

        // Restoring must heal the fillet rather than leave it stranded.
        body.setFeatureSuppressed("e2", false);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("a wrecked expression reports and heals", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "v1", type: "variable", name: "w", expression: "40" },
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: "w",
                    profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        append(body, {
            ...pressPullFeature("e2", body, "x", 10, "fuse"),
            depth: "w / 4",
        } as ExtrudeFeatureData);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        for (const broken of ["1 / 0", "nope * 2", "w +", "(w"]) {
            body.setFeatureParameter("v1", "expression", broken);
            expect(body.featureItems()[0].error).toBeDefined();
            // The failed chain keeps the last good shape rather than blanking the body.
            expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
        }

        body.setFeatureParameter("v1", "expression", "40");
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });

    test("undoing a run of edits one by one unwinds to the original geometry", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        const original = extent(body);

        const depths = [30, 20, 50, 15];
        for (const depth of depths) {
            Transaction.execute(doc, "edit extrude", () => setDepth(body, "e1", depth));
        }
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 15]);

        for (let i = depths.length - 1; i >= 0; i--) {
            doc.history.undo();
            expectClean(body);
        }
        expect(extent(body)).toEqual(original);

        for (let i = 0; i < depths.length; i++) doc.history.redo();
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 15]);
    });
});

describe("referenced-node damage", () => {
    test("two bodies extruding the same sketch both follow it", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const ref = [captureProfileRef(profiles[0].shape as unknown as IFace)];
        const a = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 40, profiles: ref }],
        });
        doc.modelManager.addNode(a);
        const b = new ParametricBodyNode({
            document: doc,
            features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20, profiles: ref }],
        });
        b.transform = Matrix4.fromTranslation(60, 0, 0);
        doc.modelManager.addNode(b);
        expectClean(a, b);
        expect(extent(a)).toEqual([0, 0, 0, 40, 40, 40]);
        expect(extent(b)).toEqual([0, 0, 0, 40, 40, 20]);

        sketch.setDataEmitShapeChanged(rect(0, 0, 30, 30));
        expectClean(a, b);
        expect(extent(a)).toEqual([0, 0, 0, 30, 30, 40]);
        expect(extent(b)).toEqual([0, 0, 0, 30, 30, 20]);
    });

    test("removing a boolean's tool body reports it, and putting it back heals", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        append(host, booleanFeature("b1", "fuse", [tool.id], false));
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        tool.parent?.remove(tool);
        expect(host.featureItems()[1].error).toBe("Boolean tool not found");
        // The failed chain keeps the last good shape.
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        doc.modelManager.addNode(tool);
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);
    });

    test("removing the sketch an extrude reads reports it, and putting it back heals", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        // Resolve once first: the "keeps the last good shape" contract below only means
        // something for a body that had one.
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);
        const sketchId = (body.features[0] as ExtrudeFeatureData).sketchId!;
        const sketch = doc.modelManager.findNode((n) => n.id === sketchId);
        expect(sketch).toBeDefined();

        sketch!.parent?.remove(sketch!);
        expect(body.featureItems()[0].error).toBe("Sketch not found");
        expect(body.shape.isOk).toBe(true);

        doc.modelManager.addNode(sketch!);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 40, 40]);
    });

    test("reordering features surfaces the dependency error instead of mangling geometry", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        append(body, pressPullFeature("e2", body, "x", 10, "fuse"));
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);

        // The press-pull needs a preceding feature; moved to the front it has none.
        body.moveFeature("e2", -1);
        const errors = body.featureItems().map((x) => x.error);
        expect(errors.filter((x) => x !== undefined)).toHaveLength(1);

        body.moveFeature("e2", 1);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 50, 40, 40]);
    });
});

describe("cloned bodies", () => {
    test("cloning an extrude body keeps it reading the original sketch", () => {
        const doc = newDoc();
        const body = boxBody(doc, 40);
        const clone = body.clone();
        clone.transform = Matrix4.fromTranslation(60, 0, 0);
        doc.modelManager.addNode(clone);
        expectClean(body, clone);
        expect(extent(clone)).toEqual([0, 0, 0, 40, 40, 40]);

        // The clone carries the same sketchId, so an edit lands on both.
        const sketchId = (body.features[0] as ExtrudeFeatureData).sketchId!;
        const sketch = doc.modelManager.findNode((n) => n.id === sketchId) as SketchNode;
        sketch.setDataEmitShapeChanged(rect(0, 0, 30, 30));
        expectClean(body, clone);
        expect(extent(body)).toEqual([0, 0, 0, 30, 30, 40]);
        expect(extent(clone)).toEqual([0, 0, 0, 30, 30, 40]);
    });

    test("cloning a press-pull body keeps its own refs and follows the host", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        const clone = tool.clone();
        clone.transform = Matrix4.fromTranslation(0, 100, 0);
        doc.modelManager.addNode(clone);
        expectClean(host, tool, clone);
        expect(extent(clone)).toEqual([40, 0, 0, 60, 40, 40]);

        setDepth(host, "e1", 20);
        expectClean(host, tool, clone);
        expect(extent(tool)).toEqual([40, 0, 0, 60, 40, 20]);
        expect(extent(clone)).toEqual([40, 0, 0, 60, 40, 20]);
    });

    test("cloning a body that consumes a tool keeps sharing that tool", () => {
        const doc = newDoc();
        const host = boxBody(doc, 40);
        const tool = new ParametricBodyNode({
            document: doc,
            features: [pressPullFeature("e2", host, "x", 20)],
        });
        doc.modelManager.addNode(tool);
        append(host, booleanFeature("b1", "fuse", [tool.id]));
        expectClean(host, tool);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);

        // The clone carries the SAME toolId, so both hosts keep consuming one tool — and
        // the copy's own transform is what that tool is mapped through, the established
        // contract for a moved consumer (`toolShapesInHostSpace`). The copy is therefore
        // NOT a translated twin of the original: the tool sits 100 below it.
        const clone = host.clone();
        clone.transform = Matrix4.fromTranslation(0, 100, 0);
        doc.modelManager.addNode(clone);
        expectClean(host, tool, clone);
        expect(extent(host)).toEqual([0, 0, 0, 60, 40, 40]);
        expect(extent(clone)).toEqual([0, -100, 0, 60, 40, 40]);
    });
});
