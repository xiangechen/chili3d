// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");

async function assetFiles(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            if (entry.name.startsWith(".")) return [];
            const name = `${prefix}${entry.name}`;
            if (entry.isDirectory()) return assetFiles(path.join(directory, entry.name), `${name}/`);
            return name === "sw.js" || name.endsWith(".map") ? [] : [name];
        }),
    );
    return files.flat().sort();
}

function replaceRequired(source, placeholder, value) {
    if (!source.includes(placeholder)) throw new Error(`Missing PWA placeholder: ${placeholder}`);
    return source.replace(placeholder, () => value);
}

const files = await assetFiles(distDir);
if (!files.includes("index.html")) throw new Error("Cannot generate PWA manifest without index.html");

const template = await readFile(path.join(rootDir, "public", "sw.js"), "utf8");
const hash = createHash("sha256");
hash.update(template);
for (const file of files) {
    hash.update(file);
    hash.update(await readFile(path.join(distDir, file)));
}

let source = replaceRequired(template, '"__PRECACHE_MANIFEST__"', JSON.stringify(files));
source = replaceRequired(source, '"__BUILD_HASH__"', JSON.stringify(hash.digest("hex").slice(0, 16)));
await writeFile(path.join(distDir, "sw.js"), source);
console.log(`[pwa] Generated service worker with ${files.length} precached assets.`);
