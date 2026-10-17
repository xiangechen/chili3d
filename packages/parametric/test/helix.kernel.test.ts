// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { HelixFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";
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

function setup(feature: Partial<HelixFeatureData> & Pick<HelixFeatureData, "radius">) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [{ id: "h1", type: "helix", ...feature }],
    });
    doc.modelManager.addNode(body);
    return { doc, body };
}

/**
 * The two readouts a built coil offers. The kernel segments one b-spline edge per turn, so
 * the edge count IS the turns; the climb is the bbox's z span — a conservative control-point
 * hull, so it always overshoots the exact length by a fraction of a percent.
 */
function coilOf(body: ParametricBodyNode) {
    const shape = body.shape.unchecked()!;
    return {
        turns: shape.findSubShapes(ShapeTypes.edge).length,
        climb: shape.boundingBox().max.z - shape.boundingBox().min.z,
    };
}

/** The bbox spans along x/y/z, for coils climbing an axis other than +Z. */
function spansOf(body: ParametricBodyNode) {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
}

describe("helix feature", () => {
    test("length and pitch build a coil climbing the axis", () => {
        const { body } = setup({ radius: 5, pitch: 2, length: 10 });
        expect(body.shape.isOk).toBe(true);
        const { turns, climb } = coilOf(body);
        expect(turns).toBe(5);
        expect(climb).toBeGreaterThanOrEqual(10);
        expect(climb).toBeLessThan(10.2);
        const box = body.shape.unchecked()!.boundingBox();
        // Radius 5 around the z axis: the coil hull stays near the ±5 xy square.
        expect(box.max.x).toBeLessThan(5.2);
        expect(box.min.x).toBeGreaterThan(-5.2);
    });

    test("the segments carry the content-seeded ids", () => {
        const { body } = setup({ radius: 5, pitch: 2, length: 10 });
        expect(body.shape.isOk).toBe(true);
        expect(body.edgeIdAt(0)).toBe("helix:h1:coil.0");
        expect(body.edgeIdAt(4)).toBe("helix:h1:coil.4");
    });

    test("the origin coordinates share one grouped panel row", () => {
        const { body } = setup({ radius: 5, pitch: 2, length: 10 });
        const parameters = body.featureItems()[0].parameters;

        expect(parameters.slice(0, 3).map((x) => x.key)).toEqual(["origin.x", "origin.y", "origin.z"]);
        expect(parameters.slice(0, 3).map((x) => x.display)).toEqual([
            "common.coordX",
            "common.coordY",
            "common.coordZ",
        ]);
        expect(parameters.slice(0, 3).map((x) => x.group)).toEqual([
            { id: "origin", display: "common.origin" },
            { id: "origin", display: "common.origin" },
            { id: "origin", display: "common.origin" },
        ]);
        expect(parameters[3].group).toBeUndefined();
    });

    test("turns and length derive the pitch", () => {
        const { body } = setup({ radius: 5, turns: 5, length: 10 });
        expect(body.shape.isOk).toBe(true);
        const { turns, climb } = coilOf(body);
        expect(turns).toBe(5);
        expect(climb).toBeGreaterThanOrEqual(10);
        expect(climb).toBeLessThan(10.2);
    });

    test("pitch and turns derive the length", () => {
        const { body } = setup({ radius: 5, pitch: 3, turns: 4 });
        expect(body.shape.isOk).toBe(true);
        const { turns, climb } = coilOf(body);
        expect(turns).toBe(4);
        expect(climb).toBeGreaterThanOrEqual(12);
        expect(climb).toBeLessThan(12.2);
    });

    test("with all three stored, length and pitch win over a stale turns", () => {
        const { body } = setup({ radius: 5, pitch: 3, length: 12, turns: 99 });
        expect(body.shape.isOk).toBe(true);
        // Turns is re-derived as length/pitch = 4 — a stale 99 would build 99 segments.
        expect(coilOf(body).turns).toBe(4);
    });

    test("fewer than two of the coil trio is a rebuild error", () => {
        const { body } = setup({ radius: 5, pitch: 2 });
        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Helix needs two of length, pitch, turns");
    });

    test("a non-positive stored value is a rebuild error", () => {
        const { body } = setup({ radius: 0, pitch: 2, length: 10 });
        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Helix radius must be positive");
    });

    test("an edited pitch rebuilds the coil, and the surviving segments keep their ids", () => {
        const { body } = setup({ radius: 5, pitch: 2, length: 10 });
        expect(body.shape.isOk).toBe(true);
        body.setFeatureParameter("h1", "pitch", 5);
        expect(body.shape.isOk).toBe(true);
        const { turns, climb } = coilOf(body);
        // Same length with a wider pitch: two turns instead of five, same climb.
        expect(turns).toBe(2);
        expect(climb).toBeGreaterThanOrEqual(10);
        expect(climb).toBeLessThan(10.2);
        expect(body.edgeIdAt(0)).toBe("helix:h1:coil.0");
    });

    test("the stored axis drives the build when there is no direction override", () => {
        const { body } = setup({ radius: 2, pitch: 2, length: 10, axis: { x: 1, y: 0, z: 0 } });
        expect(body.shape.isOk).toBe(true);
        const [xSpan, ySpan, zSpan] = spansOf(body);
        // The coil climbs +X now; its radius-2 rings stand in the yz plane.
        expect(xSpan).toBeGreaterThanOrEqual(10);
        expect(xSpan).toBeLessThan(10.2);
        expect(ySpan).toBeLessThan(4.5);
        expect(zSpan).toBeLessThan(4.5);
    });

    test("a degenerate stored axis is treated as absent and falls back to +Z", () => {
        const { body } = setup({ radius: 2, pitch: 2, length: 10, axis: { x: 0, y: 0, z: 0 } });
        expect(body.shape.isOk).toBe(true);
        const [xSpan, ySpan, zSpan] = spansOf(body);
        expect(zSpan).toBeGreaterThanOrEqual(10);
        expect(zSpan).toBeLessThan(10.2);
        expect(xSpan).toBeLessThan(4.5);
        expect(ySpan).toBeLessThan(4.5);
    });

    test("the direction override wins over the stored axis", () => {
        const { body } = setup({
            radius: 2,
            pitch: 2,
            length: 10,
            axis: { x: 1, y: 0, z: 0 },
            direction: {
                nodeId: "deleted",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 1, z: 0 } },
            },
        });
        expect(body.shape.isOk).toBe(true);
        // The frozen fingerprint's line is +Y: the coil climbs Y, not the stored +X.
        const [xSpan, ySpan, zSpan] = spansOf(body);
        expect(ySpan).toBeGreaterThanOrEqual(10);
        expect(ySpan).toBeLessThan(10.2);
        expect(xSpan).toBeLessThan(4.5);
        expect(zSpan).toBeLessThan(4.5);
        // The lost pick is reported on the row, same as any lost direction.
        expect(body.featureItems()[0].missingInputs?.[0].key).toBe("direction");
    });
});
