// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Concentric loops at the kernel: every loop must become the ring it bounds. A hole
// loop used to be built as a solid face of its own, so the ring between two circles
// picked as the disc of the middle circle — the pick covered the centre too, and
// extruding it filled what should have stayed a hole. Runs on a real SketchNode
// because the report came from a sketch of plain circle entities.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Plane } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import type { SketchEntityData } from "../src/sketch/sketchModel";
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

/** A sketch node of concentric circles at the origin, as the sketch editor would build it. */
function concentricSketch(radii: number[]): SketchNode {
    const entities: SketchEntityData[] = radii.map((radius, index) => ({
        id: index + 1,
        type: "circle",
        params: [0, 0, radius],
    }));
    const node = new SketchNode({
        document: createMockDocument(),
        plane: Plane.XY,
        data: { entities, constraints: [] },
    });
    const shape = node.generateShape();
    if (!shape.isOk) throw new Error(shape.error);
    node.shape = shape;
    return node;
}

function sortedAreas(sketch: SketchNode): number[] {
    const result = sketchProfiles(sketch);
    expect(result.isOk).toBe(true);
    return allProfiles(result.unchecked()!)
        .map((face) => face.area())
        .sort((a, b) => a - b);
}

const annulus = (outer: number, inner: number) => Math.PI * (outer * outer - inner * inner);

describe("concentric sketch profiles", () => {
    // One profile per band, innermost first: the disc inside the smallest circle, then the
    // ring between each pair of neighbours. Nothing may swallow the loop it encloses.
    test.each([
        { radii: [100, 200] },
        { radii: [100, 150, 200] },
        { radii: [100, 150, 200, 250] },
    ])("circles $radii give one profile per band", ({ radii }) => {
        const areas = sortedAreas(concentricSketch(radii));
        const bounds = [0, ...radii];

        expect(areas.length).toBe(radii.length);
        radii.forEach((radius, index) => {
            expect(areas[index]).toBeCloseTo(annulus(radius, bounds[index]), 0);
        });
    });
});
