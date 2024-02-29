// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import myinit, { OpenCascadeInstance } from "../occ-wasm/chili_occ";
import mywasm from "../occ-wasm/chili_occ.wasm";
import init from "../occ-wasm/initOpenCascade";

declare global {
    var occ: OpenCascadeInstance;
}

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
