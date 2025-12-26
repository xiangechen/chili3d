// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "chili-builder";
import { Logger } from "chili-core";
import { Loading } from "./loading";

let loading = new Loading();
document.body.appendChild(loading);

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(async (app) => {
        document.body.removeChild(loading);

        const params = new URLSearchParams(window.location.search);
        const modelUrl = params.get("model");
        if (modelUrl) {
            try {
                const response = await fetch(modelUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch model: ${response.statusText}`);
                }
                const blob = await response.blob();
                let filename = modelUrl.substring(modelUrl.lastIndexOf("/") + 1);
                if (filename.includes("?")) {
                    filename = filename.split("?")[0];
                }
                if (!filename) filename = "model.stp";

                const file = new File([blob], filename, { type: blob.type });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);

                if (typeof (app as any).importFiles === "function") {
                    await (app as any).importFiles(dataTransfer.files);
                } else {
                    Logger.error("Application does not support importFiles");
                }
            } catch (err) {
                Logger.error(err);
            }
        }
    })
    .catch((err) => {
        Logger.error(err);
    });
