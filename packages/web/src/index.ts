// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger } from "@chili3d/core";
import { Loading } from "./loading";

const loading = new Loading();
document.body.appendChild(loading);

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const params = new URLSearchParams(window.location.search);
    const plugin = params.get("plugin");
    if (plugin) {
        Logger.info(`loading plugin from: ${plugin}`);
        await app.pluginManager.loadFromUrl(plugin);
    }
    const url = params.get("url") ?? params.get("model");
    if (url) {
        Logger.info(`loading file from: ${url}`);
        await app.loadFileFromUrl(url);
    }

    // ?live (optionally ?live=ws://host:port) connects this session to the MCP live
    // bridge so an AI can edit the model the user is looking at. Lazy-loaded so it
    // adds nothing to the normal bundle path.
    const live = params.get("live");
    if (live !== null) {
        const { connectLive } = await import("./live");
        connectLive(app, live || "ws://localhost:8765");
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
