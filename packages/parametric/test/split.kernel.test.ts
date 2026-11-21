// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditableShapeNode, type IFace, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import type { SplitFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
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

const BOX_VOLUME = 40 * 40 * 20;

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function boxBody(doc: TestDocument): ParametricBodyNode {
    const sketch = new SketchNode({
        document: doc,
        id: "sk1",
        plane: Plane.XY,
        data: rect(-20, -20, 20, 20),
    });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

/** A 40×40×20 box centred on the XY origin; the ZX datum (normal +Y) halves it. */
function setup(extra?: Partial<SplitFeatureData>, transform?: Matrix4) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const body = boxBody(doc);
    // A transform alone does not re-run the chain (it is normally local-space invariant);
    // the feature append right after is what rebuilds against it.
    if (transform !== undefined) body.transform = transform;
    const feature: SplitFeatureData = {
        id: "s1",
        type: "split",
        tool: { kind: "datum", name: "ZX" },
        ...extra,
    };
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    return { doc, body };
}

function setupSurface(keepSide?: "positive" | "negative") {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc);
    const cylinder = shapeFactory.cylinder(XYZ.unitZ, XYZ.zero, 10, 20);
    expect(cylinder.isOk).toBe(true);
    if (!cylinder.isOk) throw new Error("Cylinder creation failed");
    const tool = new EditableShapeNode({ document: doc, id: "tool", name: "tool", shape: cylinder.value });
    doc.modelManager.addNode(tool);
    const face = (cylinder.value.findSubShapes(ShapeTypes.face) as IFace[]).find(
        (candidate) => !candidate.surface().isPlanar(),
    );
    expect(face).toBeDefined();
    if (face === undefined) throw new Error("Cylinder side face not found");

    const body = boxBody(doc);
    const feature: SplitFeatureData = {
        id: "s1",
        type: "split",
        tool: { kind: "surface", nodeId: tool.id, profiles: [captureProfileRef(face)] },
        keepSide,
    };
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    return { body };
}

function setupTrackedSurface() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc);
    const sketch = new SketchNode({
        document: doc,
        id: "source-sketch",
        plane: Plane.XY,
        data: { entities: [{ id: 1, type: "circle", params: [0, 0, 10] }], constraints: [] },
    });
    doc.modelManager.addNode(sketch);
    const source = new ParametricBodyNode({
        document: doc,
        id: "source",
        features: [{ id: "c1", type: "extrude", sketchId: sketch.id, depth: 20 }],
    });
    doc.modelManager.addNode(source);
    expect(source.shape.isOk).toBe(true);
    const sourceShape = source.shape.unchecked();
    expect(sourceShape).toBeDefined();
    if (sourceShape === undefined) throw new Error("Cylinder creation failed");
    const faces = sourceShape.findSubShapes(ShapeTypes.face) as IFace[];
    const sideIndex = faces.findIndex((face) => !face.surface().isPlanar());
    expect(sideIndex).toBeGreaterThanOrEqual(0);
    const originalId = source.faceIdAt(sideIndex);
    expect(originalId).toBeDefined();
    if (originalId === undefined) throw new Error("Cylinder side has no tracked id");
    const profile = captureProfileRef(faces[sideIndex], originalId, source.faceIdIsShared(originalId), true);

    const body = boxBody(doc);
    const feature: SplitFeatureData = {
        id: "s1",
        type: "split",
        tool: { kind: "surface", nodeId: source.id, profiles: [profile] },
    };
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    expect(body.shape.isOk).toBe(true);
    return { doc, source, body, originalId };
}

function surfaceProfiles(body: ParametricBodyNode) {
    const feature = body.features.find((candidate) => candidate.id === "s1");
    if (feature?.type !== "split" || feature.tool.kind !== "surface") {
        throw new Error("Split surface feature not found");
    }
    return feature.tool.profiles;
}

describe("split feature", () => {
    test("keepSide both keeps two halves whose volumes sum to the box", () => {
        const { body } = setup();
        expect(body.shape.isOk).toBe(true);
        const shape = body.shape.unchecked()!;
        expect(shape.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME, 3);
    });

    test("positive keeps the half on the plane normal's side", () => {
        const { body } = setup({ keepSide: "positive" });
        const shape = body.shape.unchecked()!;
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME / 2, 3);
        expect(shape.boundingBox().min.y).toBeGreaterThan(-1e-6);
    });

    test("negative keeps the opposite half", () => {
        const { body } = setup({ keepSide: "negative" });
        const shape = body.shape.unchecked()!;
        expect(shape.volume()).toBeCloseTo(BOX_VOLUME / 2, 3);
        expect(shape.boundingBox().max.y).toBeLessThan(1e-6);
    });

    test("a kept side nothing sits on is an error, not a silent empty", () => {
        // The whole box sits on the datum's positive side; the negative half is empty.
        // The failed feature keeps the last good shape and reports on the row.
        const { body } = setup({ keepSide: "negative" }, Matrix4.fromTranslation(0, 100, 0));
        expect(body.featureItems()[1].error).toContain("nothing remains on the kept side");
    });

    test("the split reports no tracked ids — references degrade to geometric matching", () => {
        const { body } = setup();
        expect(body.shape.isOk).toBe(true);
        expect(body.faceIdAt(0)).toBeUndefined();

        // A rebuild after an upstream parameter edit still evaluates the split cleanly.
        body.setFeatureParameter("e1", "depth", 30);
        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(40 * 40 * 30, 3);
    });

    test("a hand-written invalid keepSide is a rebuild error", () => {
        const { body } = setup({ keepSide: "sideways" as never });
        expect(body.featureItems()[1].error).toBe("Invalid keep side: sideways");
    });

    test("split as the first feature requires a preceding feature", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [{ id: "s1", type: "split", tool: { kind: "datum", name: "ZX" } }],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Split requires a preceding feature");
    });

    test("a cylindrical surface splits the box without losing volume", () => {
        const { body } = setupSurface();
        expect(body.shape.isOk).toBe(true);
        const shape = body.shape.unchecked();
        expect(shape?.findSubShapes(ShapeTypes.solid).length).toBe(2);
        expect(shape?.volume()).toBeCloseTo(BOX_VOLUME, 3);
    });

    test.each([
        ["positive", BOX_VOLUME - Math.PI * 10 * 10 * 20],
        ["negative", Math.PI * 10 * 10 * 20],
    ] as const)("a cylindrical surface keeps the %s side", (keepSide, expected) => {
        const { body } = setupSurface(keepSide);
        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()?.volume()).toBeCloseTo(expected, 3);
    });

    test("a source face split after the pick cuts with every piece and re-anchors each", () => {
        const { doc, source, body, originalId } = setupTrackedSurface();
        const slot = shapeFactory.box(Plane.XY.translateTo(new XYZ(-1, -15, -1)), 2, 30, 22);
        expect(slot.isOk).toBe(true);
        if (!slot.isOk) throw new Error("Slot creation failed");
        const tool = new EditableShapeNode({ document: doc, id: "slot", name: "slot", shape: slot.value });
        doc.modelManager.addNode(tool);

        source.setFeaturesEmitShapeChanged([
            ...source.features,
            { id: "cut", type: "boolean", operation: "cut", toolIds: [tool.id], consumeTools: false },
        ]);
        body.setFeaturesEmitShapeChanged([...body.features]);

        expect(source.shape.isOk).toBe(true);
        const sourceShape = source.shape.unchecked();
        expect(sourceShape).toBeDefined();
        if (sourceShape === undefined) throw new Error("Slotted cylinder creation failed");
        const sourceFaces = sourceShape.findSubShapes(ShapeTypes.face) as IFace[];
        const matchedIndexes = source.faceIndexesOfId(originalId);
        expect(matchedIndexes.length).toBeGreaterThan(1);
        expect(matchedIndexes.every((index) => !sourceFaces[index].surface().isPlanar())).toBe(true);
        const profiles = surfaceProfiles(body);
        expect(profiles).toHaveLength(matchedIndexes.length);
        expect(profiles.every((profile) => profile.id === originalId)).toBe(true);
        expect(body.featureItems()[1].error).toBeUndefined();
        expect(body.shape.unchecked()?.volume()).toBeCloseTo(BOX_VOLUME, 3);
    });

    test("a rebuilt source re-matches by geometry when its tracked ids are unavailable", () => {
        const { source, body, originalId } = setupTrackedSurface();
        expect(surfaceProfiles(body)[0].id).toBe(originalId);
        const previousArea = surfaceProfiles(body)[0].area;
        expect(previousArea).toBeDefined();
        if (previousArea === undefined) throw new Error("Surface profile has no area");
        const faceIdAt = rs.spyOn(source, "faceIdAt").mockReturnValue(undefined);
        try {
            source.setFeatureParameter("c1", "depth", 30);
            body.setFeaturesEmitShapeChanged([...body.features]);

            expect(source.shape.isOk).toBe(true);
            expect(body.featureItems()[1].error).toBeUndefined();
            expect(body.shape.unchecked()?.findSubShapes(ShapeTypes.solid)).toHaveLength(2);
            expect(body.shape.unchecked()?.volume()).toBeCloseTo(BOX_VOLUME, 3);
            const profiles = surfaceProfiles(body);
            expect(profiles).toHaveLength(1);
            expect(profiles[0].id).toBeUndefined();
            expect(profiles[0].area).toBeGreaterThan(previousArea);
        } finally {
            faceIdAt.mockRestore();
        }
    });
});
