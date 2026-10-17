// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BoundingBox, type IEdge, type IFace, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { FeatureData, MirrorFeatureData, NeutralPlaneRef } from "../src/features/feature";
import "../src/features"; // registers all feature handlers
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { captureFaceRef } from "../src/sketch/planeRef";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";

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

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0; // `|| 0` folds -0 into +0
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const edgeIdsOf = (body: ParametricBodyNode) => edgesOf(body).map((_, i) => body.edgeIdAt(i));
const boundsOf = (body: ParametricBodyNode) => body.shape.unchecked()!.boundingBox();

/** A plate touching the YZ datum: x ∈ [0, 40], y ∈ [−20, 20], z ∈ [0, depth]. */
function plate(depth = 20) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, -20, 40, 20) });
    doc.modelManager.addNode(sketchNode);
    const profiles = sketchNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketchNode.id,
                depth,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

function withMirror(
    body: ParametricBodyNode,
    plane: NeutralPlaneRef,
    patch: Partial<MirrorFeatureData> = {},
) {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "m1", type: "mirror", plane, ...patch } satisfies MirrorFeatureData,
    ]);
    return body;
}

/** The mirror plane as a reference to one of the body's own faces — the pick the command captures. */
function hostFacePlane(body: ParametricBodyNode, index: number): NeutralPlaneRef {
    const ref = captureFaceRef(body.id, facesOf(body)[index]);
    const faceId = body.faceIdAt(index);
    if (faceId !== undefined) ref.faceId = faceId;
    return { kind: "face", ref };
}

const topIndex = (faces: readonly IFace[]) => faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);

describe("transformedMul keeps the sub-shape enumeration parallel", () => {
    test("a mirrored box enumerates its faces and edges in the input's own order", () => {
        // THE fact the mirror feature's id naming stands on: the copy's sub-shape i must be the
        // reflection of the input's sub-shape i, for every i. `BRepBuilderAPI_Transform` rebuilds
        // the topology tree without reordering it; this test fails loudly if that ever changes.
        const box = shapeFactory.box(Plane.XY, 40, 30, 20).unchecked()!;
        const copy = box.transformedMul(Matrix4.createMirrorWithPlane(Plane.YZ));
        try {
            for (const type of [ShapeTypes.face, ShapeTypes.edge]) {
                const inputs = box.findSubShapes(type);
                const copies = copy.findSubShapes(type);
                expect(copies.length).toBe(inputs.length);
                for (const [index, input] of inputs.entries()) {
                    const a = (input as IEdge).boundingBox();
                    const b = (copies[index] as IEdge).boundingBox();
                    // Mirroring about YZ flips x and keeps y and z — per index, not as a set.
                    expect(round(b.min.x)).toBe(round(-a.max.x));
                    expect(round(b.max.x)).toBe(round(-a.min.x));
                    expect(round(b.min.y)).toBe(round(a.min.y));
                    expect(round(b.min.z)).toBe(round(a.min.z));
                    expect(round(b.max.z)).toBe(round(a.max.z));
                }
            }
        } finally {
            copy.dispose();
        }
    });
});

describe("mirror feature ids", () => {
    test("a plate mirrored about the YZ datum fuses into one symmetric body, every sub-shape named", () => {
        const body = withMirror(plate(), { kind: "datum", name: "YZ" });

        expect(errors(body)).toEqual([undefined, undefined]);
        // 40×40×20 twice — the two halves share only the plane face, fused into one solid.
        expect(round(body.shape.unchecked()!.volume())).toBe(2 * 40 * 40 * 20);
        const bounds = boundsOf(body);
        expect(round(bounds.min.x)).toBe(-40);
        expect(round(bounds.max.x)).toBe(40);
        expect(facesOf(body)).toHaveLength(6);
        const faceIds = faceIdsOf(body);
        const edgeIds = edgeIdsOf(body);
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        expect(edgeIds.filter((id) => id === undefined)).toEqual([]);
        // The fuse merged the coincident coplanar pairs (top, bottom, the two y sides): each
        // merged face carries the input's id AND the copy's `mirror:m1:`-scoped one combined.
        expect(faceIds.some((id) => id!.includes("mirror:m1:"))).toBe(true);
        expect(faceIds.some((id) => !id!.includes("mirror:m1:"))).toBe(true);
    });

    test("the ids survive an upstream depth edit — the copy really does follow", () => {
        const body = withMirror(plate(), { kind: "datum", name: "YZ" });
        const before = [...faceIdsOf(body), ...edgeIdsOf(body)].sort();

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 30 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(80 * 40 * 30);
        expect([...faceIdsOf(body), ...edgeIdsOf(body)].sort()).toEqual(before);
    });

    test("a mirror about the body's own top face follows that face through a depth edit", () => {
        const body = plate();
        const plane = hostFacePlane(body, topIndex(facesOf(body)));
        withMirror(body, plane);
        expect(errors(body)).toEqual([undefined, undefined]);
        // Mirroring z ∈ [0, 20] about z = 20 stacks the copy above: one 40×40×40 block.
        expect(round(boundsOf(body).max.z)).toBe(40);

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 30 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        // The plane re-resolved on the REBUILT input's top face (z = 30), so the copy reaches 60 —
        // a plane frozen at the pick's height would still cap the body at 40.
        expect(round(boundsOf(body).max.z)).toBe(60);
    });

    test("merge: false keeps the halves side by side, the copy's ids scoped under the feature", () => {
        const body = withMirror(plate(), { kind: "datum", name: "YZ" }, { merge: false });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(body.shape.unchecked()!.shapeType).toBe(ShapeTypes.compound);
        expect(facesOf(body)).toHaveLength(12);
        expect(round(boundsOf(body).min.x)).toBe(-40);
        const faceIds = faceIdsOf(body);
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
        // The compound enumerates the input's sub-shapes first, then the copy's (combine appends
        // in argument order, TopExp explores in insertion order) — so the first six ids are the
        // extrude's own and the last six are theirs under the feature's scope, EVERY leaf named.
        expect(faceIds.slice(0, 6).every((id) => !id!.includes("mirror:m1"))).toBe(true);
        expect(
            faceIds.slice(6).every((id) => id!.split("|").every((leaf) => leaf.startsWith("mirror:m1:"))),
        ).toBe(true);
    });
});
