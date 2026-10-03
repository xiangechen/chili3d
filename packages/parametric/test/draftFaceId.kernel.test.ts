// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { DraftFeatureData, FeatureData, NeutralPlaneRef } from "../src/features/feature";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const edgeIdsOf = (body: ParametricBodyNode) => edgesOf(body).map((_, i) => body.edgeIdAt(i));
const widthOf = (body: ParametricBodyNode) => {
    const box = body.shape.unchecked()!.boundingBox();
    return round(box.max.x - box.min.x);
};

/** Indexes of the plate's four upright faces — what a mould draft tapers. */
const sideIndexes = (faces: readonly IFace[]) =>
    faces
        .map((face, index) => ({ face, index }))
        .filter(({ face }) => Math.abs(face.normal(0, 0)[1].z) < 1e-6)
        .map(({ index }) => index);

/** The plate's two horizontal faces: its bottom (outward −Z) and its top (outward +Z). */
function bottomIndex(faces: readonly IFace[]): number {
    return faces.findIndex((face) => face.normal(0, 0)[1].z < -1 + 1e-6);
}

function topIndex(faces: readonly IFace[]): number {
    return faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
}

function scene(sketch: SketchData = rect(-20, -20, 20, 20)) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketchNode = new SketchNode({ document: doc, plane: Plane.XY, data: sketch });
    doc.modelManager.addNode(sketchNode);
    return { doc, sketchNode };
}

/** The plate a draft is applied to: `sketch` extruded `height` up. */
function plate({ doc, sketchNode }: ReturnType<typeof scene>, height = 20): ParametricBodyNode {
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
    return body;
}

/**
 * The neutral plane as a reference to one of `body`'s own faces — the ref kind the command
 * captures from a viewport pick. The test bodies sit at the identity transform, so a local face is
 * its own world face, which is the frame `captureFaceRef` fingerprints in.
 */
function hostFacePlane(body: ParametricBodyNode, index: number): NeutralPlaneRef {
    const ref = captureFaceRef(body.id, facesOf(body)[index]);
    const faceId = body.faceIdAt(index);
    if (faceId !== undefined) {
        ref.faceId = faceId;
    }
    return { kind: "face", ref };
}

type NeutralPick = "XY" | "hostBottom" | "hostTop";

/**
 * Appends a draft tapering the plate's four upright faces. The neutral plane defaults to the XY
 * datum — the pick that needs no reference plumbing, and the one whose +Z normal makes a positive
 * angle taper the plate INWARD, the mould convention.
 */
function withDraft(
    body: ParametricBodyNode,
    neutral: NeutralPick = "XY",
    patch: Partial<DraftFeatureData> = {},
): ParametricBodyNode {
    const faces = facesOf(body);
    const index = neutral === "hostBottom" ? bottomIndex(faces) : topIndex(faces);
    const neutralPlane: NeutralPlaneRef =
        neutral === "XY" ? { kind: "datum", name: "XY" } : hostFacePlane(body, index);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "d1",
            type: "draft",
            faces: sideIndexes(faces).map((faceIndex) =>
                captureProfileRef(
                    faces[faceIndex],
                    body.faceIdAt(faceIndex),
                    body.faceIdIsShared(body.faceIdAt(faceIndex)),
                ),
            ),
            neutralPlane,
            angle: 5,
            ...patch,
        } satisfies DraftFeatureData,
    ]);
    return body;
}

/** The plate a draft was applied to, in one call — what the single-body cases need. */
function drafted(neutral: NeutralPick = "XY", patch: Partial<DraftFeatureData> = {}, sketch?: SketchData) {
    return withDraft(plate(scene(sketch)), neutral, patch);
}

const setDraft = (body: ParametricBodyNode, patch: Partial<DraftFeatureData>) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map((f): FeatureData => (f.id === "d1" && f.type === "draft" ? { ...f, ...patch } : f)),
    );

describe("draft sub-shape ids", () => {
    test("a tapered plate keeps every face id, and the sides really do lean", () => {
        const body = drafted();

        expect(errors(body)).toEqual([undefined, undefined]);
        // A taper MODIFIES the solid: no face or edge is created or destroyed.
        expect(facesOf(body)).toHaveLength(6);
        expect(edgesOf(body)).toHaveLength(12);
        expect(faceIdsOf(body).filter((id) => id === undefined)).toEqual([]);
        expect(edgeIdsOf(body).filter((id) => id === undefined)).toEqual([]);
        // Measured: with the neutral plane's normal pointing up, a positive angle takes material
        // off the top, so the plate holds less than the 40×40×20 it started as...
        expect(round(body.shape.unchecked()!.volume())).toBeLessThan(40 * 40 * 20);
        // ...while the base it tapers FROM is untouched: still 40 across, still on z = 0. (The
        // bounding box cannot show the taper itself — an inward taper leaves the base as the
        // widest part — which is why the volume is what carries the assertion.)
        expect(widthOf(body)).toBe(40);
        expect(round(body.shape.unchecked()!.boundingBox().min.z)).toBe(0);
    });

    test("the tapered faces inherit the ids of the faces they were", () => {
        const built = plate(scene());
        const before = facesOf(built).map((_, index) => built.faceIdAt(index));
        expect(before.filter((id) => id !== undefined)).toHaveLength(6);
        const body = withDraft(built);

        expect(errors(body)).toEqual([undefined, undefined]);
        // Every tapered face is the SAME face, tilted — so a reference to it must keep resolving.
        // This works through the kernel's `Generated` channel: the algorithm answers `Modified`
        // only for faces whose geometry it did NOT recompute.
        for (const index of sideIndexes(facesOf(body))) {
            expect(faceIdsOf(body)[index]).toBe(before[index]);
        }
    });

    test("the ids survive an angle edit — including the edges the kernel reports nothing for", () => {
        const body = drafted();
        const before = [...faceIdsOf(body), ...edgeIdsOf(body)].sort();
        const shallow = round(body.shape.unchecked()!.volume());

        // Measured: `BRepOffsetAPI_DraftAngle` overrides `Modified`/`Generated` to answer for FACES
        // only, so every output EDGE arrives with no ancestor at all (`edgeAncestors` is empty).
        // Eight of the plate's twelve are named by the two faces they join instead — which is why
        // this edit is the test that matters: a name derived from geometry rather than from the
        // kernel's history is only usable if it is the SAME name at every angle.
        setDraft(body, { angle: 8 });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(round(body.shape.unchecked()!.volume())).toBeLessThan(shallow);
        expect([...faceIdsOf(body), ...edgeIdsOf(body)].sort()).toEqual(before);
    });

    test("a face picked as the neutral plane reaches the kernel as the plane a datum names", () => {
        // The bottom face's outward normal is −Z and the XY datum's is +Z: the SAME plane, seen
        // from opposite sides. So the fixture's datum pick with `reverse` has to build what the
        // bottom-face pick builds without it. That is what proves both reference kinds resolve to
        // one plane rather than two that merely look alike.
        const aboutBottom = drafted("hostBottom");
        const aboutDatum = drafted("XY", { reverse: true });

        expect(errors(aboutBottom)).toEqual([undefined, undefined]);
        expect(errors(aboutDatum)).toEqual([undefined, undefined]);
        expect(round(aboutBottom.shape.unchecked()!.volume())).toBe(
            round(aboutDatum.shape.unchecked()!.volume()),
        );
        // Tapering about the bottom flares the top, the opposite of the default datum pick.
        expect(widthOf(aboutBottom)).toBeGreaterThan(40);
    });

    test("the neutral plane follows the face it was picked on through an upstream edit", () => {
        const { doc, sketchNode } = scene();
        const body = plate({ doc, sketchNode });
        // The TOP face, so the plane the draft tapers about is one an extrude-depth edit moves.
        withDraft(body, "hostTop");
        expect(errors(body)).toEqual([undefined, undefined]);
        const shallow = round(body.shape.unchecked()!.volume());

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (f): FeatureData => (f.id === "e1" && f.type === "extrude" ? { ...f, depth: 30 } : f),
            ),
        );
        expect(errors(body)).toEqual([undefined, undefined]);
        // 20 → 30 deep is half again the volume; a stale plane would leave it near where it was.
        expect(round(body.shape.unchecked()!.volume())).toBeGreaterThan(shallow * 1.4);
    });
});

describe("the draft's abort guards", () => {
    test("a face the kernel cannot taper fails the op instead of taking the module down", () => {
        // THE abort-safety case. `AddDone()` is false for a face that is not planar, cylindrical
        // or conical, and `Build()` calls `Perform()`, which RAISES while a face is problematic —
        // with exception catching disabled that would kill the whole wasm module. So the op has to
        // report before it ever builds.
        const body = plate(scene());
        const sphere = shapeFactory.sphere(new XYZ(20, 0, 10), 10).unchecked()!;
        const fused = shapeFactory.booleanFuse([body.shape.unchecked()!], [sphere], false).unchecked()!;
        const fusedFaces = fused.findSubShapes(ShapeTypes.face) as IFace[];
        const planar = fusedFaces.findIndex((face) => face.surface().isPlanar());
        const spherical = fusedFaces.findIndex((face) => !face.surface().isPlanar());
        expect(planar).toBeGreaterThanOrEqual(0);
        expect(spherical).toBeGreaterThanOrEqual(0);

        // Both orders: the failing face has to stop the loop whether it comes first or second,
        // because a SECOND Add after a failed one raises inside the algorithm itself.
        for (const faces of [
            [fusedFaces[planar], fusedFaces[spherical]],
            [fusedFaces[spherical], fusedFaces[planar]],
        ]) {
            const tapered = shapeFactory.draft!(fused, faces, new XYZ(0, 0, 1), 5, Plane.XY);
            expect(tapered.isOk).toBe(false);
            if (!tapered.isOk) expect(tapered.error).toContain("planar, cylindrical and conical");
        }
        // The module is still alive, which is the whole point of returning before `Build()`.
        expect(shapeFactory.box(Plane.XY, 1, 1, 1).isOk).toBe(true);
    });

    test("a face of another shape is refused rather than reaching the algorithm's edge index", () => {
        // Measured guard: the algorithm never checks that a face belongs to the shape it was
        // initialised with, and walks that face's edges through an index built from the SHAPE's —
        // a missing key raises Standard_NoSuchObject, which aborts the module just as surely.
        const shape = shapeFactory.box(Plane.XY, 40, 40, 20).unchecked()!;
        const foreign = shapeFactory.box(Plane.XY, 5, 5, 5).unchecked()!;
        const foreignFaces = foreign.findSubShapes(ShapeTypes.face) as IFace[];

        const crossed = shapeFactory.draft(shape, [foreignFaces[0]], new XYZ(0, 0, 1), 5, Plane.XY);
        expect(crossed.isOk).toBe(false);
        if (!crossed.isOk) expect(crossed.error).toContain("does not belong");
        expect(shapeFactory.box(Plane.XY, 1, 1, 1).isOk).toBe(true);
    });

    test("an empty face set and a zero direction are refused before the kernel sees them", () => {
        const shape = shapeFactory.box(Plane.XY, 40, 40, 20).unchecked()!;
        const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];

        // `gp_Dir` raises on a null vector — a direct route to the same module-wide abort.
        expect(shapeFactory.draft(shape, [faces[0]], XYZ.zero, 5, Plane.XY).isOk).toBe(false);
        expect(shapeFactory.draft(shape, [], new XYZ(0, 0, 1), 5, Plane.XY).isOk).toBe(false);
    });
});

describe("draft on a cylindrical face", () => {
    test("a cylinder's lateral face cones out, which is what the feature is for", () => {
        const cylinder = shapeFactory.cylinder(new XYZ(0, 0, 1), XYZ.zero, 10, 20).unchecked()!;
        const faces = cylinder.findSubShapes(ShapeTypes.face) as IFace[];
        const lateral = faces.findIndex((face) => !face.surface().isPlanar());
        expect(lateral).toBeGreaterThanOrEqual(0);

        const tapered = shapeFactory.draft(cylinder, [faces[lateral]], new XYZ(0, 0, 1), 5, Plane.XY);
        expect(tapered.isOk).toBe(true);
        // Measured: the 5° taper takes the cylinder from r=10 at its base to a smaller radius
        // higher up, so it holds less than the plain cylinder's π·10²·20.
        expect(tapered.unchecked()!.volume()).toBeLessThan(cylinder.volume());
        expect(tapered.unchecked()!.volume()).toBeGreaterThan(0);
    });
});
