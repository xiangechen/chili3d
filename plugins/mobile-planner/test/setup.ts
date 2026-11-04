// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { initWasm } from "@chili3d/wasm";

const wasmPath = path.resolve(import.meta.dirname, "../../../packages/wasm/lib/chili-wasm.wasm");
const WASM_BINARY = readFileSync(wasmPath);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
});
