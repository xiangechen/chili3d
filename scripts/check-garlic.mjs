// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Build-time guard: the sketch constraint solver garlic lives in its own repo and is consumed
// here as vendored wasm-pack output (packages/parametric/lib/). Copying pkg/* over by hand is
// the whole workflow — there is nothing that notices when a rebuild over there never made it
// over here, and a half-copied set (a new garlic.js against an old garlic_bg.wasm) fails at
// runtime with wasm-bindgen's "function not found", which reads like a chili3d bug.
//
// The garlic checkout is a sibling directory, so CI does not have it: a missing checkout is
// reported and exits 0, not a failure. Only a *present but different* set is drift.
//
// Run: node scripts/check-garlic.mjs            (or `npm run check:garlic`)
//      GARLIC_DIR=/path/to/garlic node scripts/check-garlic.mjs
//      node scripts/check-garlic.mjs --garlic /path/to/garlic
//
// Exit: 0 in sync (or nothing to compare against), 1 drift, 2 bad usage.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

/** The files chili3d vendors out of garlic's `pkg/`. LICENSE/README/package.json are not vendored. */
const VENDORED_FILES = ["garlic.d.ts", "garlic.js", "garlic_bg.wasm", "garlic_bg.wasm.d.ts"];

function parseGarlicDir(argv) {
    const flagIndex = argv.indexOf("--garlic");
    if (flagIndex !== -1) {
        const value = argv[flagIndex + 1];
        if (value === undefined || value.startsWith("--")) {
            console.error("check-garlic: --garlic needs a directory");
            process.exit(2);
        }
        return resolve(value);
    }
    return resolve(process.env.GARLIC_DIR ?? resolve(repoRoot, "..", "garlic"));
}

const garlicDir = parseGarlicDir(process.argv.slice(2));
const garlicPkg = resolve(garlicDir, "pkg");
const vendoredDir = resolve(repoRoot, "packages", "parametric", "lib");

if (!existsSync(garlicDir) || !existsSync(garlicPkg) || !statSync(garlicPkg).isDirectory()) {
    console.log(`check-garlic: no garlic checkout at ${garlicDir} — skipping (nothing to compare).`);
    process.exit(0);
}

const drift = [];
for (const file of VENDORED_FILES) {
    const source = resolve(garlicPkg, file);
    const vendored = resolve(vendoredDir, file);
    if (!existsSync(source)) {
        drift.push(`${file}: missing from ${garlicPkg}`);
        continue;
    }
    if (!existsSync(vendored)) {
        drift.push(`${file}: missing from packages/parametric/lib`);
        continue;
    }
    // Compared as bytes: a rebuild changes the wasm and the glue together, and a truncated
    // copy is exactly the case this guard exists for a size/date check to miss.
    if (!readFileSync(source).equals(readFileSync(vendored))) {
        drift.push(`${file}: differs`);
    }
}

if (drift.length === 0) {
    console.log(`check-garlic: packages/parametric/lib matches ${garlicPkg}.`);
    process.exit(0);
}

console.error(
    [
        `check-garlic: the vendored garlic does not match ${garlicPkg}:`,
        ...drift.map((d) => `  - ${d}`),
        "",
        "Re-vendor it (all four files together, never a subset):",
        `  cd ${garlicDir} && wasm-pack build --target web --release --features wasm`,
        `  cp pkg/{${VENDORED_FILES.join(",")}} ${vendoredDir}/`,
        "",
        "If the drift is intentional (garlic built from a different commit), re-vendor before committing.",
    ].join("\n"),
);
process.exit(1);
