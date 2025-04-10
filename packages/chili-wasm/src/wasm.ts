// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import MainModuleFactory, { MainModule } from "../lib/chili-wasm";

declare global {
    var wasm: MainModule;
}

export async function initWasm() {
    global.wasm = await MainModuleFactory();
    return global.wasm;
}
