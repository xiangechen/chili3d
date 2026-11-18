// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Run: node scripts/finalize-pwa.mjs [--dist <dir>] [--template <file>]
// Both paths may be absolute or relative to the current working directory. They default to
// this package's dist and public/sw.js, so the engine's own build needs no arguments; a
// downstream app that extends this config passes `--dist <its own output>`.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        dist: { type: "string" },
        template: { type: "string" },
    },
});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.resolve(process.cwd(), values.dist ?? path.join(rootDir, "dist"));
const templatePath = path.resolve(process.cwd(), values.template ?? path.join(rootDir, "public", "sw.js"));

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
if (!files.includes("index.html")) {
    throw new Error(`Cannot generate PWA manifest: ${path.join(distDir, "index.html")} not found`);
}

const template = await readFile(templatePath, "utf8");
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
