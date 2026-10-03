// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FeatureData, FilletFeatureData, ShellFeatureData } from "../src/features/feature";
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
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const edgeIdsOf = (body: ParametricBodyNode) => edgesOf(body).map((_, i) => body.edgeIdAt(i));
/** The +z face — the opening every case here uses. */
const topIndex = (faces: readonly IFace[]) => faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);

/** A document and a sketch to extrude; shared by the cases that compare two bodies. */
function scene(sketch: SketchData = rect(-20, -20, 20, 20)) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: sketch });
    doc.modelManager.addNode(sketchNode);
    return { doc, sketchNode };
}

/**
 * The plate a shell is applied to: `sketch` extruded `height` up, with the top face's ref
 * captured BEFORE any shell runs — after one, that face is gone and its index names the rim.
 */
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

/** Appends the shell, opening the plate's top face. */
function withShell(
    { body, top }: ReturnType<typeof plate>,
    patch: Partial<ShellFeatureData> = {},
): ParametricBodyNode {
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "s1",
            type: "shell",
            faces: [captureProfileRef(top.face, top.id, body.faceIdIsShared(top.id))],
            thickness: 2,
            ...patch,
        } satisfies ShellFeatureData,
    ]);
    return body;
}

/** The plate a shell was applied to, in one call — what the single-body cases need. */
function shelled(patch: Partial<ShellFeatureData> = {}, sketch?: SketchData) {
    const built = plate(scene(sketch));
    return withShell(built, patch);
}

const setShell = (body: ParametricBodyNode, patch: Partial<ShellFeatureData>) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map((f): FeatureData => (f.id === "s1" && f.type === "shell" ? { ...f, ...patch } : f)),
    );

describe("shell sub-shape ids", () => {
    test("a hollow plate names every face and edge it builds, under the default arc join", () => {
        const body = shelled();

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(facesOf(body)).toHaveLength(11);
        expect(edgesOf(body)).toHaveLength(24);
        // The 40×40×20 plate minus the 36×36×18 cavity its 2mm wall leaves.
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 20 - 36 * 36 * 18);
        expect(faceIdsOf(body).filter((id) => id === undefined)).toEqual([]);
        expect(edgeIdsOf(body).filter((id) => id === undefined)).toEqual([]);
    });

    test("the rim is named after the opening, never after the face the user deleted", () => {
        const built = plate(scene());
        const body = withShell(built);

        // The plate's own top face is gone; a reference to it must not silently land on the band
        // the opening left, so no output may carry its id.
        expect(built.top.id).toBeDefined();
        expect(faceIdsOf(body)).not.toContain(built.top.id);
        // The rim IS named — after the opening, under the shell's own marker.
        expect(faceIdsOf(body)).toContain(`shell&${built.top.id}`);
    });

    test("the ids do not depend on the join type, a styling choice", () => {
        // One scene, so the two bodies' ids share a sketch and are comparable verbatim.
        const shared = scene();
        const arc = withShell(plate(shared), { joinType: "arc" });
        const sharp = withShell(plate(shared), { joinType: "intersection" });

        expect(errors(arc)).toEqual([undefined, undefined]);
        expect(errors(sharp)).toEqual([undefined, undefined]);
        // Sorted, not per-edge: the two joins place the inner edges the same way but the kernel
        // may enumerate them in a different order.
        expect([...edgeIdsOf(arc)].sort()).toEqual([...edgeIdsOf(sharp)].sort());
        expect([...faceIdsOf(arc)].sort()).toEqual([...faceIdsOf(sharp)].sort());
    });

    test("a thickness edit rebuilds cleanly and keeps every id", () => {
        const body = shelled();
        const before = [...faceIdsOf(body), ...edgeIdsOf(body)].sort();

        setShell(body, { thickness: 3 });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBe(40 * 40 * 20 - 34 * 34 * 17);
        expect([...faceIdsOf(body), ...edgeIdsOf(body)].sort()).toEqual(before);
    });

    test("a fillet on an inner edge survives a thickness edit", () => {
        const body = shelled();
        // The cavity's bottom, where the inner walls meet — the edge kind the kernel's own
        // history does NOT report under a rounded join, so it is named by the faces it joins.
        const index = edgesOf(body).findIndex(
            (edge) => edge.startPoint().z === 2 && edge.endPoint().z === 2 && edge.length() < 40,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const inner = edgesOf(body)[index];
        expect(body.edgeIdAt(index)).toBeDefined();

        const fillet: FilletFeatureData = {
            id: "f1",
            type: "fillet",
            radius: 1,
            edges: [captureEdgeRef(inner, body.edgeIdAt(index))],
        };
        body.setFeaturesEmitShapeChanged([...body.features, fillet]);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        setShell(body, { thickness: 3 });
        // The fillet's ref has to keep resolving by id — a loss is a test failure, see
        // `test/setup.ts`.
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        const healed = body.features[2];
        expect(healed.type === "fillet" ? typeof healed.edges[0]?.edgeId : undefined).toBe("string");
    });

    test("outward puts the wall outside the input's boundary instead of carving it out", () => {
        const inward = shelled();
        const outward = shelled({ outward: true });

        expect(errors(outward)).toEqual([undefined, undefined]);
        // Both are hollow, so the wall's side is what tells them apart: inward keeps the input's
        // outer boundary, outward grows past it.
        expect(outward.shape.unchecked()!.boundingBox().min.z).toBeLessThan(
            inward.shape.unchecked()!.boundingBox().min.z,
        );
        expect(outward.shape.unchecked()!.boundingBox().max.x).toBeGreaterThan(20);
        // An arc join rounds the outer corners into bands, which the kernel reports as generated
        // by the input edge they turn on. What is left is the sphere patch at each of the input's
        // bottom vertices and its three boundary edges — sub-shapes nothing derives and no face
        // pair names (see the module doc of `shellTracked`), 4 and 12 of them on this plate.
        expect(faceIdsOf(outward).filter((id) => id === undefined)).toHaveLength(4);
        expect(edgeIdsOf(outward).filter((id) => id === undefined)).toHaveLength(12);
    });

    test("a six-sided plate keeps its ids too", () => {
        // Slanted walls the box case cannot exercise: no face is parallel to another.
        const hex: SketchData = {
            entities: [
                { id: 1, type: "line", params: [-20, -10, 0, -20] },
                { id: 2, type: "line", params: [0, -20, 20, -10] },
                { id: 3, type: "line", params: [20, -10, 20, 10] },
                { id: 4, type: "line", params: [20, 10, 0, 20] },
                { id: 5, type: "line", params: [0, 20, -20, 10] },
                { id: 6, type: "line", params: [-20, 10, -20, -10] },
            ],
            constraints: [],
        };
        const body = shelled({}, hex);

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(faceIdsOf(body).filter((id) => id === undefined)).toEqual([]);
    });
});

describe("the kernel's offset channel and the openings", () => {
    test("an opened face reports no parallel copy", () => {
        const shape = shapeFactory.box(Plane.XY, 40, 40, 20).unchecked()!;
        const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
        const index = topIndex(faces);

        const tracked = shapeFactory.makeThickSolidByJoinTracked!(
            shape,
            [faces[index]],
            -2,
            "arc",
        ).unchecked()!;

        // A removed face has no copy: the channel may only hold the surviving faces' copies.
        expect(tracked.offsetFaceMap?.some((inputIndex) => inputIndex === index)).toBe(false);
        expect(tracked.offsetFaceMap?.filter((x) => x >= 0)).toHaveLength(faces.length - 1);
    });

    test("a thicken's channel is untouched by that (the same helper serves both)", () => {
        const shape = shapeFactory.box(Plane.XY, 40, 40, 20).unchecked()!;
        const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
        const top = faces[topIndex(faces)];

        // A thicken has no closing faces, so nothing is skipped and the copy is still reported.
        const tracked = shapeFactory.makeThickSolidBySimpleTracked!(top, -2).unchecked()!;
        expect(tracked.offsetFaceMap).toContain(0);
    });
});
