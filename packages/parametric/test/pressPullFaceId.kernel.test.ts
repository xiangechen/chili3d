// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { sketchPlaneOfFace } from "../src/sketch/planeRef";
import { type SketchData, toUV } from "../src/sketch/sketchModel";
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

function sketchOnFace(doc: TestDocument, face: IFace, corners: XYZ[]): SketchNode {
    const plane = sketchPlaneOfFace(face);
    const uv = corners.map((p) => toUV(plane, p));
    return new SketchNode({
        document: doc,
        plane,
        data: {
            entities: [
                { id: 1, type: "line", params: [...uv[0], ...uv[1]] },
                { id: 2, type: "line", params: [...uv[1], ...uv[2]] },
                { id: 3, type: "line", params: [...uv[2], ...uv[3]] },
                { id: 4, type: "line", params: [...uv[3], ...uv[0]] },
            ],
            constraints: [],
        },
    });
}

function topFacesOf(body: ParametricBodyNode): { area: number; z: number }[] {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const round = (x: number) => Math.round(x * 1e6) / 1e6;
    return faces
        .filter((face) => face.normal(0, 0)[1].z > 1 - 1e-6)
        .map((face) => ({ area: round(face.area()), z: round(face.boundingBox().min.z) }))
        .sort((a, b) => b.area - a.area);
}

function extrudeFeatures(body: ParametricBodyNode) {
    return body.features.filter((f) => f.type === "extrude");
}

/**
 * Box (e1) + side boss fused onto it (e2) so the box top and boss top merge into one
 * T-shaped face; e3 press-pulls that face (tracked id + fingerprint, as the command
 * captures it). The merged face's id is a compound of both ancestors' ids
 * (`combineIds` over the kernel's multi-valued history), so when deepening e1
 * re-splits the face into a box-top piece and a boss-top piece, each piece's id still
 * intersects the ref.
 */
function buildBody(): ParametricBodyNode {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketch1);
    const profiles1 = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 20,
                profiles: [captureProfileRef(profiles1[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const front = faces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6)!;
    const sketch2 = sketchOnFace(doc, front, [
        new XYZ({ x: -10, y: -20, z: 12 }),
        new XYZ({ x: 10, y: -20, z: 12 }),
        new XYZ({ x: 10, y: -20, z: 20 }),
        new XYZ({ x: -10, y: -20, z: 20 }),
    ]);
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];

    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: 10,
            operation: "fuse",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);

    const allFaces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const topIndex = allFaces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
    const ref = captureProfileRef(allFaces[topIndex], body.faceIdAt(topIndex));
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e3",
            type: "extrude",
            depth: 5,
            operation: "fuse",
            source: { nodeId: body.id, profiles: [ref] },
        },
    ]);
    return body;
}

const setDepth = (body: ParametricBodyNode, depth: number): void => {
    body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "e1" ? { ...f, depth } : f)));
};

describe("press-pull face-id tracking", () => {
    test("a merged face re-split by an upstream edit sweeps every piece", () => {
        const body = buildBody();
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        // The press-pull fused the swept T-face: one T-shaped top at z = 25.
        expect(topFacesOf(body)).toEqual([{ area: 1800, z: 25 }]);
        const picked = extrudeFeatures(body)[2];
        expect(picked.type === "extrude" && typeof picked.source?.profiles[0]?.id).toBe("string");

        setDepth(body, 40);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        // Box top (40×40, swept to z = 45) and boss top (20×10, swept to z = 25) —
        // both pieces of the re-split merge carry the compound id's components.
        expect(topFacesOf(body)).toEqual([
            { area: 1600, z: 45 },
            { area: 200, z: 25 },
        ]);
        // Re-anchored: one ref per swept piece, each carrying the piece's id.
        const e3 = extrudeFeatures(body)[2];
        const profiles = e3.type === "extrude" ? e3.source?.profiles : undefined;
        expect(profiles?.length).toBe(2);
        expect(profiles?.every((ref) => typeof ref.id === "string")).toBe(true);

        // Deepening back re-merges the pieces into the T-face: both piece refs
        // intersect the re-merged compound id, so the face is swept once (deduped)
        // and the refs heal back to a single one.
        setDepth(body, 20);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        expect(topFacesOf(body)).toEqual([{ area: 1800, z: 25 }]);
        const healed = extrudeFeatures(body)[2];
        expect(healed.type === "extrude" ? healed.source?.profiles.length : undefined).toBe(1);
    });

    test("a shallow edit sweeps the split-off boss piece too", () => {
        const body = buildBody();
        // 20 → 25 splits the merged T-face into non-coplanar pieces: a fingerprint-
        // only match scored every face of the body and reported "Sketch profile match
        // is ambiguous after rebuild" (or silently picked a wrong face); the compound
        // id pins both successors.
        setDepth(body, 25);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        expect(topFacesOf(body)).toEqual([
            { area: 1600, z: 30 },
            { area: 200, z: 25 },
        ]);
    });

    test("a press-pull join keeps face ids alive for a second press-pull", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;

        const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
        doc.modelManager.addNode(sketch1);
        const profiles1 =
            sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch1.id,
                    depth: 20,
                    profiles: [captureProfileRef(profiles1[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        // Press-pull the box top with a join — captured as the command captures it.
        const pressPullTop = (id: string, depth: number): void => {
            const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
            const topIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
            const ref = captureProfileRef(faces[topIndex], body.faceIdAt(topIndex));
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id,
                    type: "extrude",
                    depth,
                    operation: "fuse",
                    source: { nodeId: body.id, profiles: [ref] },
                },
            ]);
        };
        pressPullTop("e2", 5);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(topFacesOf(body)).toEqual([{ area: 1600, z: 25 }]);

        // The tracked boolean kept face ids alive past the press-pull: the raised pad
        // top carries an id a second press-pull can capture (it was undefined when the
        // operation path was plain).
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const padTopIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        const padTopId = body.faceIdAt(padTopIndex);
        expect(typeof padTopId).toBe("string");

        pressPullTop("e3", 3);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        expect(topFacesOf(body)).toEqual([{ area: 1600, z: 28 }]);

        // Deepen sketch1: the first press-pull's ref re-matches the raised box top by
        // its profile-seeded id, the rebuilt pad top keeps its id, and the second
        // press-pull follows — 40 + 5 + 3.
        body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "e1" ? { ...f, depth: 40 } : f)));
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        expect(topFacesOf(body)).toEqual([{ area: 1600, z: 48 }]);
    });
});
