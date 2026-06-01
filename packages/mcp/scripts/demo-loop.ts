// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Closed-loop demo of the headless pipeline an AI drives through MCP:
//   run a CAD program -> render a PNG preview -> export STL + the editable .cd.
// Run bundled:  npm run demo -w @chili3d/mcp

import "../src/globals";

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { documentToStl, serializeDocument } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";
import { renderPreview } from "../src/render/preview";

const wasmBytes = readFileSync(fileURLToPath(new URL("../../wasm/lib/chili-wasm.wasm", import.meta.url)));
await initHeadlessWasm(wasmBytes);

const app = createHeadlessApplication();
const document = await app.newDocument("loop-demo");

// A 40×40×40 block with a Ø24 bore cut through it.
runProgram(document, {
    ops: [
        { op: "rect", id: "base", dx: 40, dy: 40 },
        { op: "extrude", id: "block", section: { ref: "base" }, length: 40 },
        { op: "cylinder", id: "bore", radius: 12, height: 60, at: { x: 20, y: 20, z: -10 } },
        { op: "boolean", id: "result", kind: "cut", a: { ref: "block" }, b: { ref: "bore" } },
    ],
});

const stl = documentToStl(app, document, { binary: true });
const png = renderPreview(document, { width: 512, height: 512 });
const cd = JSON.stringify(serializeDocument(document));

const out = (name: string) => path.join(os.tmpdir(), name);
writeFileSync(out("chili3d-loop.stl"), stl);
writeFileSync(out("chili3d-loop.png"), png);
writeFileSync(out("chili3d-loop.cd"), cd);

console.log(`STL: ${out("chili3d-loop.stl")} (${stl.byteLength} bytes)`);
console.log(`PNG: ${out("chili3d-loop.png")} (${png.byteLength} bytes)`);
console.log(
    `CD : ${out("chili3d-loop.cd")} (${cd.length} bytes) — open this in the Chili3D app to keep editing`,
);
