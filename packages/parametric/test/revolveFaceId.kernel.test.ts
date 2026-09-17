// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";

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

// The profile sketch lives in the XZ plane (u → x, v → z) and revolves around Z.
const XZ_PLANE = new Plane({
    origin: XYZ.zero,
    normal: new XYZ({ x: 0, y: -1, z: 0 }),
    xvec: XYZ.unitX,
});

const rect = (u0: number, v0: number, u1: number, v1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [u0, v0, u1, v0] },
        { id: 2, type: "line", params: [u1, v0, u1, v1] },
        { id: 3, type: "line", params: [u1, v1, u0, v1] },
        { id: 4, type: "line", params: [u0, v1, u0, v0] },
    ],
    constraints: [],
});

// Same content, reversed winding — re-enumerates the swept faces without changing
// the profile's seed, so a stable id must keep indexing the same geometric face.
const rectMirrored = (u0: number, v0: number, u1: number, v1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [u0, v0, u0, v1] },
        { id: 2, type: "line", params: [u0, v1, u1, v1] },
        { id: 3, type: "line", params: [u1, v1, u1, v0] },
        { id: 4, type: "line", params: [u1, v0, u0, v0] },
    ],
    constraints: [],
});

function setup(angle: number) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
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
                angle,
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, body };
}

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

/** Planar faces whose normal is horizontal — the end rings of a full turn. */
function ringIndexes(body: ParametricBodyNode): number[] {
    return facesOf(body).flatMap((face, index) => {
        if (!face.surface().isPlanar()) return [];
        return Math.abs(face.normal(0, 0)[1].z) > 0.9 ? [index] : [];
    });
}

/** The 270° end cap: the planar radial face perpendicular to the start cap. */
function endCapIndex(body: ParametricBodyNode): number {
    return facesOf(body).findIndex((face) => {
        if (!face.surface().isPlanar()) return false;
        const normal = face.normal(0, 0)[1];
        return Math.abs(normal.z) < 0.5 && Math.abs(normal.x) > 0.9;
    });
}

describe("revolve face-id seeding (real kernel)", () => {
    test("a partial revolve's end cap carries a synthetic seed across a mirrored rebuild", () => {
        const { sketch, body } = setup(270);
        const before = endCapIndex(body);
        expect(before).toBeGreaterThanOrEqual(0);
        const capId = body.faceIdAt(before);
        // The kernel's revolve history never reports the end cap — a positional id
        // (`r1:5`) would realign onto another face when the face order changes.
        expect(capId).toMatch(/^sketch:.+:e[\d.]+:cap$/);

        sketch.setDataEmitShapeChanged(rectMirrored(10, 0, 20, 30));

        const after = endCapIndex(body);
        expect(after).toBeGreaterThanOrEqual(0);
        expect(body.faceIdAt(after)).toBe(capId);
        expect(body.faceIndexById(capId!)).toBe(after);
    });

    test("a full turn's end rings take the sweeping edges' seeds", () => {
        const { sketch, body } = setup(360);
        const before = ringIndexes(body);
        expect(before).toHaveLength(2);
        const ringIds = before.map((index) => body.faceIdAt(index)!);
        // The kernel drops both rings at 360°; geometric attribution seeds them from
        // the profile edges that swept them, not positional `r1:1` / `r1:3`.
        for (const id of ringIds) expect(id).toMatch(/^sketch:.+:e[\d.]+:ent\d+$/);
        expect(new Set(ringIds).size).toBe(2);

        sketch.setDataEmitShapeChanged(rectMirrored(10, 0, 20, 30));

        // The mirrored rebuild re-enumerates the profile wire, but seeds attach by
        // entity attribution, not wire position — what must hold is that both rings
        // still carry edge seeds (never positional `r1:N`) and each id resolves to
        // a ring face.
        const after = ringIndexes(body);
        expect(after).toHaveLength(2);
        const afterIds = after.map((index) => body.faceIdAt(index)!);
        for (const id of afterIds) expect(id).toMatch(/^sketch:.+:e[\d.]+:ent\d+$/);
        expect(new Set(afterIds).size).toBe(2);
        for (const id of afterIds) expect(after).toContain(body.faceIndexById(id));
    });
});
