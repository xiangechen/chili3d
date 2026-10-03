// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Matrix4, Plane, ShapeTypes, VisualStates, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
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

const square = (size: number): SketchData => {
    const h = size / 2;
    return {
        entities: [
            { id: 1, type: "line", params: [-h, -h, h, -h] },
            { id: 2, type: "line", params: [h, -h, h, h] },
            { id: 3, type: "line", params: [h, h, -h, h] },
            { id: 4, type: "line", params: [-h, h, -h, -h] },
        ],
        constraints: [],
    };
};

/** A 40×40×40 box (local: x,y ∈ [-20,20], z ∈ [0,40]) extruded from its own sketch. */
function boxBody(doc: TestDocument, id: string): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, id: `${id}-sk`, plane: Plane.XY, data: square(40) });
    doc.modelManager.addNode(sketch);
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const body = new ParametricBodyNode({
        document: doc,
        id,
        features: [
            {
                id: `${id}-e1`,
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [captureProfileRef(allProfiles(profiles.value)[0] as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

const faceIndexFacing = (body: ParametricBodyNode, z: 1 | -1) => {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => face.normal(0, 0)[1].z * z > 1 - 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    return { faces, index };
};

/**
 * A standalone body holding one thicken whose `source` names another body's top face — the shape
 * `thickenCommand` commits when the user asks for a new body instead of joining one. Its
 * `source.nodeId` is therefore NOT the host's own id, which is the case the re-pick has to reach.
 */
function thickenOver(source: ParametricBodyNode, doc: TestDocument): ParametricBodyNode {
    const { faces, index } = faceIndexFacing(source, 1);
    // Captured in WORLD coordinates, exactly as `thickenCommand.buildFeature` does — the refs of
    // a `source` face are matched against the source node's world geometry.
    const world = faces[index].transformedMul(source.worldTransform()) as IFace;
    try {
        const host = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                {
                    id: "t1",
                    type: "thicken",
                    source: {
                        nodeId: source.id,
                        profiles: [captureProfileRef(world, source.faceIdAt(index))],
                    },
                    thickness: 2,
                },
            ],
        });
        doc.modelManager.addNode(host);
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined]);
        return host;
    } finally {
        world.dispose();
    }
}

function scenario(placeSourceAt = Matrix4.identity(), dropIds = false) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    (doc.application as any).activeView = { document: doc };

    const source = boxBody(doc, "b2");
    source.transform = placeSourceAt;
    // A document whose tracking is gone — a legacy file, say. Nothing then matches by id and the
    // geometric fingerprint is all there is, which is where the refs' FRAME starts to matter.
    if (dropIds) {
        rs.spyOn(source, "faceIdAt").mockReturnValue(undefined);
        // Both, so this reads as the designed degradation rather than a tracking BUG: a chain
        // that cannot track reports nothing (`reportSilentIdLoss`).
        rs.spyOn(source, "hasTrackedIds").mockReturnValue(false);
    }
    const host = thickenOver(source, doc);

    const selection = {
        clearSelection: rs.fn(),
        setSelectedShapes: rs.fn(),
        setSelectedNodes: rs.fn(),
        onShapeChanged: { sub: rs.fn(), remove: rs.fn() },
    };
    doc.selection = selection as any;
    // The owner of each body carries that body's own transform, as a real visual does. Read off
    // `transform` directly: `node.worldTransform()` asks the visual back and would recurse.
    const owners = new Map<any, any>();
    for (const node of [source, host]) {
        owners.set(node, { node, worldTransform: () => node.transform });
    }
    doc.visual.context.getVisual = ((node: any) => owners.get(node)) as any;
    (doc.visual as any).highlighter = { addState: rs.fn(), removeState: rs.fn() };
    doc.visual.context.displayMesh = rs.fn(() => 1) as any;
    doc.visual.context.removeMesh = rs.fn() as any;

    return { doc, source, host, selection, owners };
}

/** The other end face of the source, reported the way a viewport pick does: local + transform. */
function pickFaceOn(source: ParametricBodyNode, doc: TestDocument, z: 1 | -1) {
    let rollbackWhilePicking: number | undefined;
    let sourceRollbackWhilePicking: number | undefined;
    doc.picker.pickShape = rs.fn(() => {
        rollbackWhilePicking = (doc.modelManager.findNode((n) => n.id === "b1") as any)?.rollbackIndex;
        sourceRollbackWhilePicking = source.rollbackIndex;
        const { faces, index } = faceIndexFacing(source, z);
        return Promise.resolve([
            {
                shape: faces[index],
                owner: { node: source, worldTransform: () => source.worldTransform() },
                transform: source.worldTransform(),
                indexes: [index],
                point: XYZ.zero,
            },
        ]);
    }) as any;
    return () => ({ rollbackWhilePicking, sourceRollbackWhilePicking });
}

const storedRefs = (host: ParametricBodyNode) => (host.features[0] as any).source.profiles;

describe("re-picking a thicken's faces on ANOTHER body (real kernel)", () => {
    test("the source's faces are pickable even though the thicken lives on its own body", async () => {
        const { doc, source, host } = scenario();
        const before = storedRefs(host);
        const undoCount = doc.history.undoCount();
        const whilePicking = pickFaceOn(source, doc, -1);

        await host.reselectShapes("t1");

        const after = storedRefs(host);
        expect(after).toHaveLength(1);
        expect(after[0].id).not.toBe(before[0].id);
        // The thicken still builds, now standing under the bottom face it was re-picked on.
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(host.shape.unchecked()!.boundingBox().min.z).toBeCloseTo(-2, 6);
        expect(doc.history.undoCount()).toBe(undoCount + 1);
        // The pick runs on the SOURCE body; the rollback is the HOST's (the feature list it
        // holds is what the preview rebuilds), and the source is left alone.
        expect(whilePicking().rollbackWhilePicking).toBe(0);
        expect(whilePicking().sourceRollbackWhilePicking).toBeUndefined();
    });

    test("a moved source body still stores refs that re-match", async () => {
        const { doc, source, host } = scenario(Matrix4.fromTranslation(100, 0, 0));
        const whilePicking = pickFaceOn(source, doc, -1);

        await host.reselectShapes("t1");

        const after = storedRefs(host);
        expect(after).toHaveLength(1);
        // `source` refs are matched against the source's WORLD geometry, so that is the frame the
        // re-pick has to capture in. Captured node-local, the centre would sit near x=0 and the
        // next rebuild would have nothing to match.
        expect(after[0].center?.x).toBeCloseTo(100, 6);
        expect(after[0].center?.z).toBeCloseTo(0, 6);
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(whilePicking().rollbackWhilePicking).toBe(0);
    });

    test("with the tracked ids gone, the re-picked ref still matches — only its FRAME can carry it", async () => {
        const { doc, source, host } = scenario(Matrix4.fromTranslation(100, 0, 0), true);
        pickFaceOn(source, doc, -1);

        await host.reselectShapes("t1");

        const after = storedRefs(host);
        expect(after).toHaveLength(1);
        expect(after[0].id).toBeUndefined();
        // No id to hit, so the match is purely geometric — and the fingerprint it scores is the
        // one the capture wrote. Captured node-local while the candidates are world faces, it
        // scores nothing and the feature errors out; captured in world, it matches and rebuilds.
        expect(after[0].center?.x).toBeCloseTo(100, 6);
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect(host.shape.unchecked()!.boundingBox().min.z).toBeCloseTo(-2, 6);
    });

    test("the session preselects and highlights on the source body, not the host", async () => {
        const { doc, source, host, owners, selection } = scenario(Matrix4.fromTranslation(100, 0, 0));
        doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;

        await host.reselectShapes("t1");

        // Ghosted with its own shape type, on the body the user is picking from.
        expect((doc.visual.highlighter as any).addState).toHaveBeenCalledWith(
            owners.get(source),
            VisualStates.faceTransparent,
            ShapeTypes.solid,
        );
        const preselect = (selection.setSelectedShapes as any).mock.calls.at(-1) as [any[], any, boolean];
        expect(preselect[0]).toHaveLength(1);
        expect(preselect[0][0].owner).toBe(owners.get(source));
        // Re-selected afterwards so the feature panel — which belongs to the HOST — stays open.
        expect(selection.setSelectedNodes).toHaveBeenCalledWith([host], false);
    });
});
