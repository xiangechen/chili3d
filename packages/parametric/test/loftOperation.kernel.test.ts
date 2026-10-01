// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A solid loft carrying a join/cut/intersect combines with the chain input of the body
 * it is appended to (the extrude/sweep contract). Two paths need locking against the
 * real kernel:
 *
 * - the plain cut/fuse itself, and
 * - a section taken from the HOST body's own face — the loft is then no longer the
 *   first feature of its body, so `resolveSourceFaces` dispatches to its `hostInputFaces`
 *   branch and matches the pick against the feature's input rather than the committed
 *   shape (`sourceFaceMatcher.ts`). Nothing produced that shape before, since the loft
 *   command only ever built standalone bodies.
 *
 * A shell loft must IGNORE a stored operation (no volume to combine with) — the same
 * rule the command applies by dropping it at commit time (`loft.ts`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { LoftFeatureData, LoftSectionData } from "../src/features/feature";
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

/** A `size`×`size` square centred on the origin, in the sketch's own plane. */
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

const planeAt = (z: number) =>
    new Plane({ origin: new XYZ({ x: 0, y: 0, z }), normal: XYZ.unitZ, xvec: XYZ.unitX });

/** The single sketch-space profile of `sketch`, as the section a pick would store. */
function sketchSection(sketch: SketchNode): LoftSectionData {
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const all = allProfiles(profiles.value);
    expect(all).toHaveLength(1);
    return { kind: "profile", nodeId: sketch.id, profile: captureProfileRef(all[0]) };
}

/** The body's face whose outward normal is +Z, fingerprinted in world coords (the press-pull contract). */
function topFaceSection(body: ParametricBodyNode): LoftSectionData {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    const id = body.faceIdAt(index);
    return {
        kind: "profile",
        nodeId: body.id,
        profile: captureProfileRef(faces[index], id, body.faceIdIsShared(id), true),
    };
}

/** A 40×40×40 box, extruded from a sketch so the box's faces carry tracked ids. */
function box(doc: TestDocument): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: square(40) });
    doc.modelManager.addNode(sketch);
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [captureProfileRef(allProfiles(profiles.value)[0])],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

function info(body: ParametricBodyNode): {
    errors: (string | undefined)[];
    box: ReturnType<IFace["boundingBox"]>;
} {
    return {
        errors: body.featureItems().map((x) => x.error),
        box: body.shape.unchecked()!.boundingBox(),
    };
}

describe("a loft carrying an operation (real kernel)", () => {
    test("cut removes the lofted solid from the body it is appended to", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        const low = new SketchNode({ document: doc, id: "sk2", plane: planeAt(20), data: square(40) });
        const high = new SketchNode({ document: doc, id: "sk3", plane: planeAt(100), data: square(40) });
        doc.modelManager.addNode(low, high);

        const feature: LoftFeatureData = {
            id: "l1",
            type: "loft",
            sections: [sketchSection(low), sketchSection(high)],
            // Ruled: the two identical sections then sweep an exact 40×40 prism.
            isSolid: true,
            isRuled: true,
            continuity: "c2",
            operation: "cut",
        };
        body.setFeaturesEmitShapeChanged([...body.features, feature]);

        const { errors, box: result } = info(body);
        expect(errors).toEqual([undefined, undefined]);
        // Everything above z=20 is gone; below it the box is untouched.
        expect(result.min.z).toBeCloseTo(0, 1);
        expect(result.max.z).toBeCloseTo(20, 1);
        expect(result.max.x).toBeCloseTo(20, 1);
    });

    test("a section taken from the host body's own face resolves against the feature's input", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        const top = new SketchNode({ document: doc, id: "sk2", plane: planeAt(60), data: square(20) });
        doc.modelManager.addNode(top);

        // The loft is a feature OF the box and its first section is one of that box's
        // own faces — the self-source branch of `resolveSourceFaces`.
        const feature: LoftFeatureData = {
            id: "l1",
            type: "loft",
            sections: [topFaceSection(body), sketchSection(top)],
            isSolid: true,
            isRuled: false,
            continuity: "c2",
            operation: "fuse",
        };
        const section = feature.sections[0];
        expect(section.nodeId).toBe(body.id);
        body.setFeaturesEmitShapeChanged([...body.features, feature]);

        const { errors, box: result } = info(body);
        expect(errors).toEqual([undefined, undefined]);
        // The box grew a frustum up to the 20×20 section at z=60.
        expect(result.min.z).toBeCloseTo(0, 1);
        expect(result.max.z).toBeCloseTo(60, 1);
        // The fused body's ids stay queryable through the boolean.
        expect(body.hasTrackedIds("face")).toBe(true);
    });

    test("a stored operation on a shell loft fails instead of silently replacing the body", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        const low = new SketchNode({ document: doc, id: "sk2", plane: planeAt(20), data: square(40) });
        const high = new SketchNode({ document: doc, id: "sk3", plane: planeAt(100), data: square(40) });
        doc.modelManager.addNode(low, high);

        // Reachable from the feature panel: toggling `isSolid` off on a joined loft (the
        // command itself drops the operation for a shell, see `loftCommand.commitLoft`).
        const feature: LoftFeatureData = {
            id: "l1",
            type: "loft",
            sections: [sketchSection(low), sketchSection(high)],
            isSolid: false,
            isRuled: true,
            continuity: "c2",
            operation: "cut",
        };
        body.setFeaturesEmitShapeChanged([...body.features, feature]);

        expect(body.featureItems()[1].error).toBe("A shell loft cannot join/cut/intersect");
        // The failed feature leaves the last good shape on screen — the box, not the shell.
        expect(info(body).box.max.z).toBeCloseTo(40, 1);
    });

    test("an operation on a loft that is the first feature surfaces as an error", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const low = new SketchNode({ document: doc, id: "sk1", plane: planeAt(20), data: square(40) });
        const high = new SketchNode({ document: doc, id: "sk2", plane: planeAt(100), data: square(40) });
        doc.modelManager.addNode(low, high);

        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "l1",
                    type: "loft",
                    sections: [sketchSection(low), sketchSection(high)],
                    isSolid: true,
                    isRuled: true,
                    continuity: "c2",
                    operation: "cut",
                } satisfies LoftFeatureData,
            ],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Loft join/cut/intersect requires a preceding feature");
    });
});
