// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@rstest/core";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { documentToStl } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";
import type { Program } from "../src/program/schema";

const WASM = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

function trianglesOf(app: ReturnType<typeof createHeadlessApplication>, doc: any): number {
    const stl = documentToStl(app, doc, { binary: true });
    return new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
}

// Ground-truth check (headless, no MCP/stdout in the loop): does boolean fuse
// actually union the two operands, or does it drop one?
describe("boolean fuse (ground truth)", () => {
    test("fusing two overlapping boxes unions them — more faces than a single box", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();

        const fusedDoc = await app.newDocument("fused");
        const fusedProgram: Program = {
            ops: [
                { op: "box", id: "a", dx: 20, dy: 20, dz: 20 },
                { op: "box", id: "b", dx: 20, dy: 20, dz: 20, at: { x: 10, y: 10, z: 10 } },
                { op: "boolean", id: "f", kind: "fuse", a: { ref: "a" }, b: { ref: "b" } },
            ],
        };
        runProgram(fusedDoc, fusedProgram);

        const singleDoc = await app.newDocument("single");
        runProgram(singleDoc, { ops: [{ op: "box", id: "a", dx: 20, dy: 20, dz: 20 }] });

        const fusedTris = trianglesOf(app, fusedDoc);
        const singleTris = trianglesOf(app, singleDoc);
        console.error(`[fuse] fused=${fusedTris} single=${singleTris}`);

        // a real union of two offset boxes has more faces than one box (12 tris).
        // if fuse dropped an operand, fused would equal a single box.
        expect(fusedTris).toBeGreaterThan(singleTris);
    });

    test("fusing a box and an overlapping cylinder keeps both", async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();

        const doc = await app.newDocument("box-cyl");
        runProgram(doc, {
            ops: [
                { op: "box", id: "blk", dx: 30, dy: 30, dz: 10 },
                { op: "cylinder", id: "cyl", radius: 6, height: 20, at: { x: 15, y: 15, z: 0 } },
                { op: "boolean", id: "f", kind: "fuse", a: { ref: "blk" }, b: { ref: "cyl" } },
            ],
        });
        const boxOnly = await app.newDocument("box-only");
        runProgram(boxOnly, { ops: [{ op: "box", id: "blk", dx: 30, dy: 30, dz: 10 }] });

        const fusedTris = trianglesOf(app, doc);
        const boxTris = trianglesOf(app, boxOnly);
        console.error(`[fuse] box+cyl=${fusedTris} boxOnly=${boxTris}`);
        expect(fusedTris).toBeGreaterThan(boxTris);
    });
});
