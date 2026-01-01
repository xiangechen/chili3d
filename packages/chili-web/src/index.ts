// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "chili-builder";
import { type IApplication, Logger } from "chili-core";
import { Loading } from "./loading";

const loading = new Loading();
document.body.appendChild(loading);

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const params = new URLSearchParams(window.location.search);
    const url = params.get("url") ?? params.get("model");
    if (url) {
        Logger.info(`load file from url: ${url}`);

        await app.loadFileFromUrl(url);
    }
}

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(handleApplicaionBuilt)
    .catch((err) => {
        alert(err.message);
    });
