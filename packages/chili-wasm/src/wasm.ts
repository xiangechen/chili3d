import MainModuleFactory, { MainModule } from "../lib/chili-wasm";

declare global {
    var wasm: MainModule;
}

export async function initWasm() {
    global.wasm = await MainModuleFactory();
    return global.wasm;
}
