// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@rstest/core";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { addBox } from "../src/pipeline";
import { documentMeshes, renderPreview, renderViews } from "../src/render/preview";
import { renderMeshesToRgba } from "../src/render/raster";

const WASM = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

describe("render_preview (OCCT)", () => {
    test("renders a box to a valid PNG that is not blank", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("preview");
        addBox(doc, { dx: 10, dy: 20, dz: 30 });

        const png = renderPreview(doc, { width: 256, height: 256 });
        expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]); // PNG magic
        expect(png.readUInt32BE(16)).toBe(256);
        expect(png.byteLength).toBeGreaterThan(100);

        // the model actually painted pixels (not an empty frame)
        const { width, height, rgba } = renderMeshesToRgba(documentMeshes(doc), { width: 256, height: 256 });
        let drawn = 0;
        for (let i = 0; i < width * height; i++) {
            if (!(rgba[i * 4] === 240 && rgba[i * 4 + 1] === 240 && rgba[i * 4 + 2] === 245)) drawn++;
        }
        expect(drawn).toBeGreaterThan(1000);
    });

    test("render_views produces a 2x2 sheet PNG whose four views differ", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("views");
        // a deliberately non-cubic box so front/top/right project to different shapes
        addBox(doc, { dx: 10, dy: 20, dz: 30 });

        const size = 128;
        const png = renderViews(doc, { size });
        expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]); // PNG magic
        // 2x2 grid with a 1px divider between cells
        expect(png.readUInt32BE(16)).toBe(size * 2 + 1); // width
        expect(png.readUInt32BE(20)).toBe(size * 2 + 1); // height

        // the orthographic views are genuinely different camera directions
        const meshes = documentMeshes(doc);
        const front = renderMeshesToRgba(meshes, { width: size, height: size, view: "front" });
        const top = renderMeshesToRgba(meshes, { width: size, height: size, view: "top" });
        expect(Buffer.compare(Buffer.from(front.rgba), Buffer.from(top.rgba))).not.toBe(0);
    });
});
