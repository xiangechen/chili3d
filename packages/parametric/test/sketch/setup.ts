// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { initGarlicSync } from "../../src/sketch/garlic";

// Load the garlic constraint-solver WASM synchronously from bytes for node tests.
initGarlicSync(readFileSync(path.resolve(import.meta.dirname, "..", "..", "lib", "garlic_bg.wasm")));
