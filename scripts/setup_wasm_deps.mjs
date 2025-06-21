// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execAsync } from "./common.mjs";

const CPP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cpp/");
const BUILD_DIR = path.resolve(CPP_ROOT, "build");

const EMSDK_DIR_NAME = "emsdk";
const EMSDK_DIR = path.resolve(BUILD_DIR, EMSDK_DIR_NAME);

const OCCT_DIR_NAME = "occt";
const OCCT_DIR = path.resolve(BUILD_DIR, OCCT_DIR_NAME);

/**
 * Due to a WebXR error, we need to use --skipLibCheck
 */
async function fixEmscripten() {
    let file = path.resolve(EMSDK_DIR, "upstream/emscripten/tools/emscripten.py");
    let contents = fs.readFileSync(file, "utf8");
    contents = contents.replace(
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--emitDeclarationOnly', '--allowJs', js_doc_file]`,
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--skipLibCheck', '--emitDeclarationOnly', '--allowJs', js_doc_file]`,
    );
    fs.writeFileSync(file, contents, "utf8");

    console.log(`Fixed emscripten.py`);
}

const libs = [
    {
        name: "emscripten",
        url: "https://github.com/emscripten-core/emsdk.git",
        tag: "4.0.8",
        dir: EMSDK_DIR,
        actions: [fixEmscripten],
        commands: [
            `${EMSDK_DIR}/emsdk install latest`,
            `${EMSDK_DIR}/emsdk activate --embedded latest`,
            `cd ${EMSDK_DIR}/upstream/emscripten && npm i`,
        ],
    },
    {
        name: "occt",
        url: "https://github.com/Open-Cascade-SAS/OCCT.git",
        tag: "V7_9_1",
        dir: OCCT_DIR,
        actions: [],
        commands: [],
    },
];

async function setupLibs() {
    for (const lib of libs) {
        await cloneLibIfNotExists(lib);

        console.log(`Seting up ${lib.name}...`);

        for (const command of lib.commands) {
            await execAsync(command);
        }
        for (const action of lib.actions) {
            await action();
        }
    }
}

async function cloneLibIfNotExists(lib) {
    if (!fs.existsSync(lib.dir)) {
        console.log(`Cloning ${lib.name}...`);
        await execAsync(`git clone --depth=1 -b ${lib.tag} ${lib.url} ${lib.dir}`);

        if (!fs.existsSync(lib.dir)) {
            console.error(`Failed to clone ${lib.name}`);
            process.exit(1);
        }
    }
}

function main() {
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR);
    }

    setupLibs()
        .then((e) => {
            console.log("Setup complete");
        })
        .catch((err) => {
            console.error(err);
        });
}

main();
