// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Generate a hollow-cube .cd (30x30x30 with 3mm walls, open top) for verifying
// that an MCP-generated document opens in the browser app.
//   node dist/gen-cube.mjs <outPath>

import "../src/globals";

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { serializeDocument } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";

const wasmBytes = readFileSync(fileURLToPath(new URL("../../wasm/lib/chili-wasm.wasm", import.meta.url)));
await initHeadlessWasm(wasmBytes);

const app = createHeadlessApplication();
const document = await app.newDocument("hollow-cube");
runProgram(document, {
    ops: [
        { op: "box", id: "outer", dx: 30, dy: 30, dz: 30 },
        // inner cavity pokes through the top (z 3..40) -> an open hollow box with 3mm walls
        { op: "box", id: "inner", dx: 24, dy: 24, dz: 40, at: { x: 3, y: 3, z: 3 } },
        { op: "boolean", id: "hollow", kind: "cut", a: { ref: "outer" }, b: { ref: "inner" } },
    ],
});

const outPath = process.argv[2] ?? "hollow-cube.cd";
writeFileSync(outPath, JSON.stringify(serializeDocument(document)));
console.log(`wrote ${outPath}`);
