// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import myinit from "../occ-wasm/chili_occ.js";
import mywasm from "../occ-wasm/chili_occ.wasm";
import init from "../occ-wasm/initOpenCascade";

export async function initMyOcc({ worker = undefined, libs = [], module = {} } = {}) {
    let oc = await init({
        mainJS: myinit,
        mainWasm: mywasm,
        worker,
        libs,
        module,
    });
    global.occ = oc;
    return oc;
}
