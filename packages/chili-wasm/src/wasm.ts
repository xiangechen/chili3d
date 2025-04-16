// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import MainModuleFactory, { MainModule } from "../lib/chili-wasm";

declare global {
    var wasm: MainModule;
}

export async function initWasm() {
    global.wasm = await MainModuleFactory();
    return global.wasm;
}
