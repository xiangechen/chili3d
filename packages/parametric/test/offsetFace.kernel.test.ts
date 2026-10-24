// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { offsetPreview } from "../src/commands/offsetFaceCommand";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FeatureData, FilletFeatureData, OffsetFaceFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
/** The +z face — the face every case here moves. */
const topIndex = (faces: readonly IFace[]) => faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);

function scene(sketch: SketchData = rect(-20, -20, 20, 20)) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: sketch });
    doc.modelManager.addNode(sketchNode);
    return { doc, sketchNode };
}

/** The 40×40 plate an offset is applied to: the sketch extruded `height` up. */
function plate(
    { doc, sketchNode }: ReturnType<typeof scene>,
    height = 20,
): { body: ParametricBodyNode; top: { face: IFace; id: string | undefined } } {
    const profiles = sketchNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketchNode.id,
                depth: height,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    const faces = facesOf(body);
    const index = topIndex(faces);
    return { body, top: { face: faces[index], id: body.faceIdAt(index) } };
}

/** Appends the offset, moving the plate's top face by `distance`. */
function withOffset(
    { body, top }: ReturnType<typeof plate>,
    distance: number,
    patch: Partial<OffsetFaceFeatureData> = {},
): ParametricBodyNode {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "o1",
            type: "offsetFace",
            faces: [captureProfileRef(top.face, top.id, body.faceIdIsShared(top.id))],
            distance,
            ...patch,
        } satisfies OffsetFaceFeatureData,
    ]);
    return body;
}

const setDistance = (body: ParametricBodyNode, distance: number) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map(
            (f): FeatureData => (f.id === "o1" && f.type === "offsetFace" ? { ...f, distance } : f),
        ),
    );

/** The plate with its four vertical edges rounded R3, plus the flat +x face to move. */
function roundedPlate(): { body: ParametricBodyNode; wall: IFace } {
    const body = plate(scene()).body;
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const vertical = edges
        .map((_, index) => index)
        .filter((index) => {
            const box = edges[index].boundingBox();
            return box.max.z - box.min.z > 10;
        });
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "f1",
            type: "fillet",
            radius: 3,
            edges: vertical.map((index) => captureEdgeRef(edges[index], body.edgeIdAt(index))),
        } satisfies FilletFeatureData,
    ]);
    // Planar only: `normal()` is unnormalized on a curved face, so a round at the corner would
    // answer a huge dot product for "points at +x".
    const wall = facesOf(body).find(
        (face) => face.surface().isPlanar() && face.normal(0, 0)[1].dot(XYZ.unitX) > 0.99,
    );
    if (wall === undefined) throw new Error("the plate has no +x face");
    return { body, wall };
}

/** Appends the offset with `keepRounds` set either way. */
function offsetWith(body: ParametricBodyNode, wall: IFace, distance: number, keepRounds: boolean) {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "o1",
            type: "offsetFace",
            faces: [captureProfileRef(wall, body.faceIdAt(facesOf(body).indexOf(wall)))],
            distance,
            keepRounds,
        } satisfies OffsetFaceFeatureData,
    ]);
    return body;
}

describe("offset face — the rebuilt body", () => {
    test("moving the top face out grows the plate, and names every face it builds", () => {
        const body = withOffset(plate(scene()), 5);

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 25);
        expect(faceIdsOf(body).filter((id) => id === undefined)).toEqual([]);
    });

    test("the moved face keeps the id of the face it was", () => {
        // The whole reason an offset needs no `<id>:offset` naming of its own, unlike a thicken:
        // the kernel derives a moved face from the face it moved from, and the id travels with it.
        // A reference onto "the top face" goes on finding it.
        const built = plate(scene());
        const body = withOffset(built, 5);

        expect(built.top.id).toBeDefined();
        expect(faceIdsOf(body)).toContain(built.top.id);
    });

    test("a negative distance pulls the top face in", () => {
        const body = withOffset(plate(scene()), -8);

        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 12);
    });

    test("editing the distance re-evaluates the chain", () => {
        const body = withOffset(plate(scene()), 5);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 25);

        setDistance(body, 2);

        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 22);
    });

    test("a distance the plate cannot take reports how far it would go", () => {
        // Past the plate's own height, so the kernel's bisection finds the bound and the message
        // carries it, rather than the user being told only that it did not work.
        const body = withOffset(plate(scene()), -30);

        expect(errors(body)[1]).toContain("max ≈");
    });
});

describe("offset face — keepRounds", () => {
    /** Every id whose leaves all end in `:f` — what a Fillet's faces are named with. */
    const roundNames = (body: ParametricBodyNode) =>
        facesOf(body)
            .map((_, index) => body.faceIdAt(index))
            .filter((id) => id !== undefined && id.split("|").every((leaf) => leaf.endsWith(":f")));

    test("the fillet's rounds are named the way the feature looks for them", () => {
        // The whole `keepRounds` path rests on this: the feature finds the rounds by name, and
        // nothing tells it which faces a Fillet made other than the names the Fillet gave them.
        const { body } = roundedPlate();

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(roundNames(body)).toHaveLength(4);
    });

    test("a round beside the moved wall keeps its radius, and the faces past it stay put", () => {
        const { body, wall } = roundedPlate();

        offsetWith(body, wall, 4, true);

        expect(errors(body)[2]).toBeUndefined();
        // The plate is 40 × 40 in plan with R3 rounds at its corners: keeping them means the
        // body only grows along +x, and the faces across from the wall never move.
        expect(body.shape.unchecked()!.boundingBox().max.y).toBeCloseTo(20, 2);
    });

    test("without it the rounds travel with the wall and drag those faces out", () => {
        const { body, wall } = roundedPlate();

        offsetWith(body, wall, 4, false);

        // OCCT offsets a round with the face it runs into: it comes back 3 + 4 wide, pushing the
        // face it meets out by the same 4 mm.
        expect(body.shape.unchecked()!.boundingBox().max.y).toBeCloseTo(24, 1);
    });

    /** The plate with EVERY edge rounded R3 — the corner patches defeat the reblend. */
    function allRoundedPlate() {
        const made = plate(scene(rect(-20, -15, 20, 15)));
        const edges = made.body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        made.body.setFeaturesEmitShapeChanged([
            ...made.body.features,
            {
                id: "f1",
                type: "fillet",
                radius: 3,
                edges: edges.map((edge, index) => captureEdgeRef(edge, made.body.edgeIdAt(index))),
            } satisfies FilletFeatureData,
        ]);
        const faces = facesOf(made.body);
        const index = topIndex(faces);
        return { body: made.body, top: { face: faces[index], id: made.body.faceIdAt(index) } };
    }

    test("a round it cannot keep is a refusal, not a body at another radius", () => {
        const { body, top } = allRoundedPlate();

        withOffset({ body, top }, -2.5, { keepRounds: true });

        // The plain path would answer — with every 3 mm round turned into 0.5. `keepRounds` is a
        // requirement now, so the feature reports the refusal instead of silently re-radiusing.
        expect(errors(body)[2]).toContain("can't be re-made at their radius");
    });

    test("too far still reports the distance bound, not the rounds", () => {
        const { body, top } = allRoundedPlate();

        withOffset({ body, top }, -30, { keepRounds: true });

        // The reblend fails here for a distance reason too, but so does the plain path — the
        // actionable answer is the bound, and "turn Keep rounds off" would lead straight back.
        expect(errors(body)[2]).toContain("max ≈");
    });

    test("the preview asks for the same rounds policy the feature commits with", () => {
        const { body, wall } = roundedPlate();
        const branch = shapeFactory.offsetFacesTracked!;
        const spy = rs.fn((...args: Parameters<typeof branch>) => branch.apply(shapeFactory, args));
        (shapeFactory as any).offsetFacesTracked = spy;
        try {
            const picked = [
                {
                    shape: wall,
                    owner: { node: body },
                    transform: Matrix4.identity(),
                    indexes: [facesOf(body).indexOf(wall)],
                },
            ] as any;

            expect(offsetPreview(body, picked, 4, true)).toBeDefined();
            expect(offsetPreview(body, picked, 4, false)).toBeDefined();
        } finally {
            (shapeFactory as any).offsetFacesTracked = branch;
        }

        expect(spy.mock.calls[0][4]).toBe(true);
        expect(spy.mock.calls[1][4]).toBe(false);
    });

    test("an offset saved before the option reads as off, and keeps its old shape", () => {
        // No `keepRounds` field at all — every document written before this option. Reading it as
        // ON would recompute the offset into a shape the file never held.
        const { body, wall } = roundedPlate();
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "o1",
                type: "offsetFace",
                faces: [captureProfileRef(wall, body.faceIdAt(facesOf(body).indexOf(wall)))],
                distance: 4,
            } satisfies OffsetFaceFeatureData,
        ]);

        expect(body.shape.unchecked()!.boundingBox().max.y).toBeCloseTo(24, 1);
    });
});
