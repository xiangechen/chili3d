// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Plane } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { describe, expect, test } from "@rstest/core";

const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

// Integration proof for Phase 2: a real OCCT solid -> headless STL bytes, with no
// Three.js / visual layer involved. This is the export the MCP server will reuse.
describe("headless STL export (OCCT)", () => {
    test("exports a box to a valid, non-empty binary STL", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();
        const box = factory.box(Plane.XY, 10, 20, 30);
        expect(box.isOk).toBe(true);

        const stl = factory.converter.convertToSTL([box.value], { binary: true });
        expect(stl.isOk).toBe(true);

        const bytes = stl.value;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const tris = view.getUint32(80, true);
        expect(tris).toBeGreaterThanOrEqual(12); // a box is at least 12 triangles
        expect(bytes.length).toBe(84 + 50 * tris);
    });

    test("ascii export is well-formed", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });
        const factory = new ShapeFactory();
        const box = factory.box(Plane.XY, 10, 20, 30);

        const stl = factory.converter.convertToSTL([box.value], { binary: false });
        expect(stl.isOk).toBe(true);

        const text = new TextDecoder().decode(stl.value);
        expect(text.startsWith("solid")).toBe(true);
        expect(text).toContain("facet normal");
        expect(text.trimEnd().endsWith("endsolid chili3d")).toBe(true);
    });
});
