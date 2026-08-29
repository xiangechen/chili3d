// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import __wbg_init, { initSync, WasmSystem } from "../../lib/garlic";
import wasmUrl from "../../lib/garlic_bg.wasm";

let initialized = false;
let initPromise: Promise<unknown> | undefined;

/**
 * Initialize the garlic constraint-solver WASM in the browser.
 * Safe to call multiple times — subsequent calls reuse the first initialization.
 */
export function initGarlic(): Promise<void> {
    if (initialized) return Promise.resolve();
    initPromise ??= __wbg_init({ module_or_path: wasmUrl }).then(() => {
        initialized = true;
    });
    return initPromise.then(() => undefined);
}

/**
 * Synchronous initialization from raw WASM bytes — used by node tests.
 */
export function initGarlicSync(bytes: BufferSource): void {
    if (initialized) return;
    initSync({ module: bytes });
    initialized = true;
}

export function isGarlicInitialized(): boolean {
    return initialized;
}

/**
 * Create a fresh solver system. Throws when the WASM module is not initialized yet.
 */
export function newGarlicSystem(): WasmSystem {
    if (!initialized) {
        throw new Error(
            "Garlic WASM is not initialized. Call initGarlic() in the browser or initGarlicSync() in node tests first.",
        );
    }
    return new WasmSystem();
}
