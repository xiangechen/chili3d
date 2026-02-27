// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

function parseArgs(argv) {
    const args = new Map();
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i];
        const value = argv[i + 1];
        if (!key?.startsWith("--") || value === undefined) {
            continue;
        }
        args.set(key.slice(2), value);
    }
    return {
        entry: args.get("entry"),
        output: args.get("output"),
    };
}

async function addDirectory(zip, rootDir, zipDir) {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const abs = path.join(rootDir, entry.name);
        const zipPath = `${zipDir}/${entry.name}`;
        if (entry.isDirectory()) {
            await addDirectory(zip, abs, zipPath);
            continue;
        }
        if (entry.isFile()) {
            const content = await readFile(abs);
            zip.file(zipPath, content);
        }
    }
}

async function exists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const { entry, output } = parseArgs(process.argv.slice(2));
    if (!entry || !output) {
        throw new Error("Missing required args: --entry <path> --output <path>");
    }

    const zip = new JSZip();
    zip.file("manifest.json", await readFile("manifest.json"));
    zip.file("extension.js", await readFile(entry));

    if (await exists("icons")) {
        await addDirectory(zip, "icons", "icons");
    }

    await rm("dist", { recursive: true, force: true });
    await mkdir(path.dirname(output), { recursive: true });
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await writeFile(output, data);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
