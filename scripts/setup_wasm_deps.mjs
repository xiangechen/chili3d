import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execAsync } from './common.mjs';

const CPP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../cpp/')
const BUILD_DIR = path.resolve(CPP_ROOT, 'build');
const INSTALL_DIR = path.resolve(BUILD_DIR, 'target');

const EMSDK_DIR_NAME = 'emsdk';
const EMSDK_DIR = path.resolve(BUILD_DIR, EMSDK_DIR_NAME);
const EMSDK_TOOLCHAIN_FILE = path.resolve(EMSDK_DIR, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake');

const OCCT_DIR_NAME = 'occt';
const OCCT_DIR = path.resolve(BUILD_DIR, OCCT_DIR_NAME);
const OCCT_BUILD_DIR = path.resolve(OCCT_DIR, "build");

/**
 * Due to a WebXR error, we need to use --skipLibCheck
 */
async function fixEmscripten() {
    let file = path.resolve(EMSDK_DIR, 'upstream/emscripten/tools/emscripten.py');
    let contents = fs.readFileSync(file, 'utf8');
    contents = contents.replace(
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--emitDeclarationOnly', '--allowJs', js_doc_file]`,
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--skipLibCheck', '--emitDeclarationOnly', '--allowJs', js_doc_file]`
    );
    fs.writeFileSync(file, contents, 'utf8');

    console.log(`Fixed emscripten.py`);
}

const libs = [
    {
        name: 'emscripten',
        url: 'https://github.com/emscripten-core/emsdk.git',
        tag: '3.1.65',
        dir: EMSDK_DIR,
        action: [fixEmscripten],
        command: `${EMSDK_DIR}/emsdk install latest && ${EMSDK_DIR}/emsdk activate --embedded latest && cd ${EMSDK_DIR}/upstream/emscripten && npm i`
    },
    {
        name: 'occt',
        url: 'https://github.com/Open-Cascade-SAS/OCCT.git',
        tag: 'V7_8_1',
        dir: OCCT_DIR,
        action: [],
        command: [
            "cmake",
            "-B", OCCT_BUILD_DIR,
            `-DCMAKE_TOOLCHAIN_FILE=${EMSDK_TOOLCHAIN_FILE}`,
            `-DCMAKE_INSTALL_PREFIX=${INSTALL_DIR}/${OCCT_DIR_NAME}`,
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_CPP_STANDARD=c++17",
            "-DBUILD_LIBRARY_TYPE=Static",
            "-DBUILD_MODULE_ApplicationFramework=ON",
            "-DBUILD_MODULE_DETools=OFF",
            "-DBUILD_MODULE_DataExchange=ON",
            "-DBUILD_MODULE_Draw=OFF",
            "-DBUILD_MODULE_FoundationClasses=ON",
            "-DBUILD_MODULE_ModelingAlgorithms=ON",
            "-DBUILD_MODULE_ModelingData=ON",
            "-DBUILD_MODULE_Visualization=ON",
            "-DBUILD_DOC_Overview=OFF",
            "-DBUILD_SAMPLES_QT=OFF",
            "-DUSE_FREETYPE=OFF",
            "-DUSE_TBB=OFF",
            "-DUSE_OPENGL=OFF",
            "-DUSE_TK=OFF",
            OCCT_DIR,
            "&&",
            `cmake --build ${OCCT_BUILD_DIR} --target install`
        ].join(" ")
    }
]

async function setupLibs() {
    for (const lib of libs) {
        if (!fs.existsSync(lib.dir)) {
            console.log(`Cloning ${lib.name}...`);
            await execAsync(`git clone --depth=1 -b ${lib.tag} ${lib.url} ${lib.dir}`);

            if (!fs.existsSync(lib.dir)) {
                console.error(`Failed to clone ${lib.name}`);
                process.exit(1);
            }
        }

        console.log(`Building ${lib.name}...`);
        await execAsync(lib.command);

        for (const action of lib.action) {
            await action();
        }
    }
}

function main() {
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR);
    }

    setupLibs()
        .then(e => {
            console.log('Setup complete');
        })
        .catch(err => {
            console.error(err);
        });
}

main();
