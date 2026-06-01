// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@rstest/core";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { addBox, collectShapes, documentToStl, serializeDocument } from "../src/pipeline";

const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

describe("headless modeling pipeline", () => {
    test("builds a box, exports STL, and serializes a reopenable .cd", async () => {
        await initHeadlessWasm(WASM_BINARY);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("box-doc");

        const node = addBox(doc, { dx: 10, dy: 20, dz: 30 });
        expect(node.shape.isOk).toBe(true);
        // regression guard: nodes must carry a valid material id, or the browser
        // renderer throws "Material not found" and nothing displays.
        expect(node.materialId).toBeTruthy();

        const stl = documentToStl(app, doc, { binary: true });
        const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
        const tris = view.getUint32(80, true);
        expect(tris).toBeGreaterThanOrEqual(12);
        expect(stl.length).toBe(84 + 50 * tris);

        const cd = serializeDocument(doc);
        expect(cd["__cla$$__"]).toBe("Document");
        expect(JSON.stringify(cd)).toContain("BoxNode");
        expect(JSON.stringify(cd)).toContain("Material"); // material travels in the .cd for the app to render
    });

    test("round-trip: a serialized .cd reloads and regenerates geometry", async () => {
        await initHeadlessWasm(WASM_BINARY);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("rt-doc");
        addBox(doc, { dx: 5, dy: 5, dz: 5 });
        const cd = serializeDocument(doc);

        const reloaded = await app.loadDocument(cd);
        expect(reloaded).toBeDefined();

        const shapes = collectShapes(reloaded!);
        expect(shapes.length).toBe(1);
        expect(shapes[0].mesh.faces!.index.length).toBeGreaterThan(0);
    });
});
