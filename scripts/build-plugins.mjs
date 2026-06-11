// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execSync } from "node:child_process";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse CLI arguments of the form --key value or -k value.
 * @returns {Record<string, string>}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if ((arg === "--input" || arg === "-i") && i + 1 < args.length) {
            opts.input = path.resolve(args[++i]);
        } else if ((arg === "--output" || arg === "-o") && i + 1 < args.length) {
            opts.output = path.resolve(args[++i]);
        }
    }
    return opts;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cliOpts = parseArgs();

const pluginsBase = cliOpts.input || path.join(rootDir, "plugins");
const targetBase = cliOpts.output || path.join(rootDir, "dist", "plugins");

const PLUGINS = [
    { name: "macro", dir: path.join(pluginsBase, "macro") },
    { name: "visual-programming", dir: path.join(pluginsBase, "visual-programming") },
];

/**
 * Copy a directory recursively from src to dest.
 */
async function copyDir(src, dest) {
    const srcStat = await stat(src);
    if (!srcStat.isDirectory()) {
        throw new Error(`${src} is not a directory`);
    }
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            await cp(srcPath, destPath);
        }
    }
}

async function main() {
    console.log(`[build-plugins] Plugins source: ${pluginsBase}`);
    console.log(`[build-plugins] Output target:  ${targetBase}`);
    console.log("[build-plugins] Building plugins...\n");

    for (const plugin of PLUGINS) {
        console.log(`[build-plugins] Building plugin: ${plugin.name}`);

        // 1. Run rspack build inside the plugin directory
        try {
            execSync("npx rspack build", {
                cwd: plugin.dir,
                stdio: "inherit",
                env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
            });
        } catch (err) {
            console.error(`[build-plugins] ❌ Build failed for ${plugin.name}`);
            process.exit(1);
        }

        // 2. Copy build output to root dist/plugins/<plugin-name>/
        const pluginDist = path.join(plugin.dir, "dist");
        const manifest = path.join(plugin.dir, "manifest.json");
        const icons = path.join(plugin.dir, "icons");
        const targetDir = path.join(targetBase, plugin.name);
        console.log(`[build-plugins] Copying ${plugin.dir} → ${targetDir}`);
        try {
            await copyDir(pluginDist, path.join(targetDir, "dist"));
            await copyDir(icons, path.join(targetDir, "icons"));
            await cp(manifest, path.join(targetDir, "manifest.json"));
            console.log(`[build-plugins] ✅ ${plugin.name} built and copied\n`);
        } catch (err) {
            console.error(`[build-plugins] ❌ Failed to copy output for ${plugin.name}: ${err.message}`);
            process.exit(1);
        }
    }

    console.log("[build-plugins] All plugins built successfully.");
}

await main().catch((err) => {
    console.error(err);
    process.exit(1);
});
