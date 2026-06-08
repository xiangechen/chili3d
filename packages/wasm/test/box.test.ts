// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Plane } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { describe, expect, test } from "@rstest/core";

// Under Node there is no fetch for the .wasm; read it from disk (tests run from
// the repo root) and hand the bytes to Emscripten via Module.wasmBinary.
const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

// The make-or-break test for the whole MCP effort: prove the OCCT WebAssembly
// kernel loads in plain Node and can build + tessellate a solid with no browser,
// no UI, and no Three.js. If this passes, the headless modeling pipeline is viable.
//
// Named `*.wasm.test.ts` so the default `npm test` (happy-dom) config excludes it
// and only `npm run test:wasm` (node env) runs it.
describe("OCCT WASM in Node (headless smoke)", () => {
    test("loads the kernel and builds a box solid with a non-empty mesh", async () => {
        await initWasm({ wasmBinary: WASM_BINARY });

        const factory = new ShapeFactory();
        const box = factory.box(Plane.XY, 10, 20, 30);
        expect(box.isOk).toBe(true);

        const faces = box.value.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.position.length).toBeGreaterThan(0);
        expect(faces!.index.length).toBeGreaterThan(0);
        // indices come in triangles
        expect(faces!.index.length % 3).toBe(0);
    });
});
