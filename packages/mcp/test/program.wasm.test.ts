// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@rstest/core";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { collectShapes, documentToStl, serializeDocument } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";

const WASM = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

describe("CAD program interpreter (OCCT)", () => {
    test("rect -> extrude -> box -> cut yields a valid STL; only the result is a node", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("prog");

        const { addedNodeIds } = runProgram(doc, {
            ops: [
                { op: "rect", id: "base", dx: 20, dy: 20 },
                { op: "extrude", id: "block", section: { ref: "base" }, length: 20 },
                { op: "box", id: "tool", dx: 10, dy: 10, dz: 30, at: { x: 5, y: 5, z: -5 } },
                { op: "boolean", id: "result", kind: "cut", a: { ref: "block" }, b: { ref: "tool" } },
            ],
        });

        expect(addedNodeIds).toEqual(["result"]); // base/block/tool are consumed inputs

        const stl = documentToStl(app, doc, { binary: true });
        const tris = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
        expect(tris).toBeGreaterThan(0);

        expect(serializeDocument(doc)["__cla$$__"]).toBe("Document");
    });

    test("primitives stay parametric and round-trip through .cd", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("prims");

        runProgram(doc, {
            ops: [
                { op: "box", id: "b", dx: 10, dy: 10, dz: 10 },
                { op: "sphere", id: "s", radius: 6, at: { x: 5, y: 5, z: 5 } },
                { op: "cylinder", id: "c", radius: 3, height: 12 },
            ],
        });

        const json = JSON.stringify(serializeDocument(doc));
        expect(json).toContain("BoxNode");
        expect(json).toContain("SphereNode");
        expect(json).toContain("CylinderNode");

        const reloaded = await app.loadDocument(serializeDocument(doc));
        expect(collectShapes(reloaded!).length).toBe(3);
    });

    test("throws on an unknown ref", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const doc = await app.newDocument("err");
        expect(() =>
            runProgram(doc, { ops: [{ op: "extrude", id: "e", section: { ref: "missing" }, length: 5 }] }),
        ).toThrow(/unknown ref/);
    });
});
