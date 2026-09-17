// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Regression suite for a press-pull whose SOURCE body later swallows it.
 *
 * The user-reported scenario: extrude a rectangle into body1, press-pull one of body1's
 * side faces into a separate body2, then fuse body2 back into body1. The fuse succeeds,
 * but body2's press-pull feature reported "Face not found after rebuild". The picked face
 * is by then an INTERIOR face of the fused solid, so re-matching it against body1's final
 * shape asks body1 to contain itself — the reference is circular, and no amount of
 * fingerprinting can find the face.
 *
 * The fix resolves those refs against body1's chain state entering the boolean that
 * consumed body2: the shape body1 still had while the two bodies were separate, which is
 * exactly what was picked. Same timeline-anchor idea sketch external refs use
 * (`SketchData.refPositions`). The pressed body therefore also keeps following edits to
 * body1's upstream features instead of freezing.
 *
 * A source face that genuinely vanished — an upstream edit consumed it, with no boolean
 * involved — still fails loudly; see pressPullVanishedFace.kernel.test.ts. That is the
 * line this suite must not blur: the anchor applies to the consuming boolean only.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData } from "../src/features/feature";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);

/** The extent of a body along x — what the pressed prism displaces when the box grows. */
function xExtent(body: ParametricBodyNode): [number, number] {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.min.x, box.max.x];
}

interface ConsumedPair {
    /** The box that consumed the pressed body. */
    readonly host: ParametricBodyNode;
    /** The press-pulled body, still alive under `host` as its boolean tool. */
    readonly tool: ParametricBodyNode;
}

/**
 * A 40-cube extruded from a rectangle, then the cube's x=40 face pressed `depth` along
 * its own outward normal into a separate body, then that body combined back into the
 * cube by `operation`. `consumeTools` is on, exactly as `FuseFeatureCommand` commits it.
 */
function buildConsumedPressPull(operation: "fuse" | "cut", depth: number): ConsumedPair {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const host = new ParametricBodyNode({
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
    doc.modelManager.addNode(host);
    expect(host.shape.isOk).toBe(true);

    const faces = host.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const index = faces.findIndex((face) => face.normal(0, 0)[1].x > 1 - 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    const id = host.faceIdAt(index);
    const tool = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e2",
                type: "extrude",
                depth,
                source: {
                    nodeId: host.id,
                    profiles: [captureProfileRef(faces[index], id, host.faceIdIsShared(id), true)],
                },
            } as ExtrudeFeatureData,
        ],
    });
    doc.modelManager.addNode(tool);
    expect(errors(host)).toEqual([undefined]);
    expect(errors(tool)).toEqual([undefined]);

    host.setFeaturesEmitShapeChanged([
        ...host.features,
        { id: "b1", type: "boolean", operation, toolIds: [tool.id], consumeTools: true },
    ]);
    return { host, tool };
}

function setBoxDepth(host: ParametricBodyNode, depth: number): void {
    const e1 = host.features.find((f) => f.id === "e1") as ExtrudeFeatureData;
    host.setFeaturesEmitShapeChanged([{ ...e1, depth }, ...host.features.slice(1)]);
}

describe("a press-pulled body its source later consumes", () => {
    test("fusing it back leaves the pressed feature clean instead of 'Face not found'", () => {
        const { host, tool } = buildConsumedPressPull("fuse", 20);
        // The fuse landed: the cube and the pressed prism form one 0…60 long solid.
        expect(errors(host)).toEqual([undefined, undefined]);
        expect(xExtent(host)).toEqual([0, 60]);
        // The pressed body is consumed — a child of the host, still listed and editable —
        // and its own feature resolves against the pre-boolean shape instead of failing.
        expect(tool.parent).toBe(host);
        expect(errors(tool)).toEqual([undefined]);
        expect(xExtent(tool)).toEqual([40, 60]);
    });

    test("the anchor is the pre-boolean shape, so the picked ref keeps its tracked id", () => {
        const { tool } = buildConsumedPressPull("fuse", 20);
        const ref = (tool.features[0] as ExtrudeFeatureData).source?.profiles[0];
        // Still naming the cube's x=40 face — the id captured at the pick, not a
        // re-anchor onto whatever face the fused solid happened to offer.
        expect(ref?.id).toContain(":ent");
        expect(ref?.normal?.x).toBeCloseTo(1, 6);
    });

    test("cutting it back resolves the same way", () => {
        // Swept inward, so the cut really removes material from the cube.
        const { host, tool } = buildConsumedPressPull("cut", -20);
        expect(errors(host)).toEqual([undefined, undefined]);
        expect(xExtent(host)).toEqual([0, 20]);
        expect(errors(tool)).toEqual([undefined]);
        expect(xExtent(tool)).toEqual([20, 40]);
    });

    test("editing the host's upstream feature carries the consumed body along", () => {
        const { host, tool } = buildConsumedPressPull("fuse", 20);
        // The box grows along z; the source face is a side face, so the pressed prism
        // must be re-swept from the new, taller face — not left at its old size.
        setBoxDepth(host, 50);
        expect(errors(host)).toEqual([undefined, undefined]);
        expect(errors(tool)).toEqual([undefined]);
        const toolBox = tool.shape.unchecked()!.boundingBox();
        expect([toolBox.min.z, toolBox.max.z]).toEqual([0, 50]);
        expect(xExtent(host)).toEqual([0, 60]);
    });

    test("editing the consumed body's own depth still drives the host", () => {
        const { host, tool } = buildConsumedPressPull("fuse", 20);
        // The host's boolean reads the tool's shape, so a deeper press must lengthen the
        // fused solid — the round trip through the boolean must settle, not oscillate.
        const e2 = tool.features[0] as ExtrudeFeatureData;
        tool.setFeaturesEmitShapeChanged([{ ...e2, depth: 30 }]);
        expect(errors(tool)).toEqual([undefined]);
        expect(errors(host)).toEqual([undefined, undefined]);
        expect(xExtent(tool)).toEqual([40, 70]);
        expect(xExtent(host)).toEqual([0, 70]);
    });

    test("dropping the boolean releases the pressed body back to its own shape", () => {
        const { host, tool } = buildConsumedPressPull("fuse", 20);
        // Restore the host's pre-fuse feature list: the host is a plain cube again and
        // the pressed body is a standalone prism, its refs resolving off the live shape.
        setBoxDepth(host, 40);
        host.setFeaturesEmitShapeChanged(host.features.slice(0, 1));
        expect(errors(host)).toEqual([undefined]);
        expect(errors(tool)).toEqual([undefined]);
        expect(xExtent(host)).toEqual([0, 40]);
        expect(xExtent(tool)).toEqual([40, 60]);
    });
});
