// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Headless demo: build a parametric box with the shared geometry core and write
// both an STL and the editable .cd document — no browser, no UI. Also doubles as a
// smoke test that the package runs unbundled under tsx/Node (the real MCP runtime).
//
//   npx tsx packages/mcp/scripts/demo-box.ts

import "../src/globals";

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    addBox,
    createHeadlessApplication,
    documentToStl,
    initHeadlessWasm,
    serializeDocument,
} from "../src/index";

const wasmBytes = readFileSync(fileURLToPath(new URL("../../wasm/lib/chili-wasm.wasm", import.meta.url)));
await initHeadlessWasm(wasmBytes);

const app = createHeadlessApplication();
const document = await app.newDocument("demo");
addBox(document, { dx: 10, dy: 20, dz: 30 });

const stl = documentToStl(app, document, { binary: true });
const stlPath = path.join(os.tmpdir(), "chili3d-demo-box.stl");
const cdPath = path.join(os.tmpdir(), "chili3d-demo-box.cd");
writeFileSync(stlPath, stl);
writeFileSync(cdPath, JSON.stringify(serializeDocument(document)));

console.log(`STL: ${stlPath} (${stl.byteLength} bytes)`);
console.log(`CD : ${cdPath}`);
