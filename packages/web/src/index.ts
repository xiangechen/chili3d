// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "@chili3d/builder";
import { type IApplication, Logger, PubSub, pendingWork, quietFrames } from "@chili3d/core";
import { Loading } from "./loading";
import { parseStartupParams } from "./startupParams";

const loading = new Loading();
document.body.appendChild(loading);

/**
 * The handle a scripted run drives the app through (`scripts/scenario.mjs`). Only the dev
 * and preview builds have it: the runner asks the page whether anything is still in
 * flight instead of sleeping on a guess, and there is no reason for a production build to
 * carry the door.
 */
function exposeTestSurface(): void {
    if (__IS_PRODUCTION__) return;
    Object.defineProperty(globalThis, "__chiliTest", {
        value: {
            pendingWork,
            quietFrames,
            settled: () => pendingWork.whenIdle().then(() => quietFrames()),
            // The same door a ribbon button knocks on. A scripted run names commands
            // rather than hunting for the button, so re-arranging the ribbon cannot break
            // a scenario that was not about the ribbon.
            dispatch: (commandName: string) => PubSub.default.pub("executeCommand", commandName as never),
        },
        configurable: true,
    });
}

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    const { plugins, fileUrl } = parseStartupParams(window.location.search);
    // A `?url=`/`?plugin=` load is async work like a command's, so it is marked BEFORE the
    // test surface appears: a scripted run that starts on such a page would otherwise ask
    // a page whose document is still loading and be told it had settled.
    const released = pendingWork.begin();
    try {
        exposeTestSurface();
        for (const plugin of plugins) {
            Logger.info(`loading plugin from: ${plugin}`);
            await app.pluginManager.loadFromUrl(plugin);
        }
        if (fileUrl) {
            Logger.info(`loading file from: ${fileUrl}`);
            await app.loadFileFromUrl(fileUrl);
        }
    } finally {
        released();
    }
}

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useParametric()
    .useThree()
    .useUI()
    .build()
    .then(handleApplicaionBuilt)
    .catch((err) => {
        alert(err.message);
    });
