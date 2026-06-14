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
        const pluginUrl = new URL(plugin, window.location.href);
        if (pluginUrl.origin !== window.location.origin || pluginUrl.protocol !== window.location.protocol) {
            throw new Error(`Refusing to load plugin from untrusted origin: ${pluginUrl.origin}`);
        }
        if (window.confirm(`Load plugin from ${pluginUrl.href}?`)) {
            Logger.info(`loading plugin from: ${pluginUrl.href}`);
            await app.pluginManager.loadFromUrl(pluginUrl.href);
        }
    }
    const url = params.get("url") ?? params.get("model");
    if (url) {
        Logger.info(`loading file from: ${url}`);
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
