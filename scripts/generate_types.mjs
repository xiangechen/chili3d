// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execAsync } from "./common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");
const typesDir = path.join(rootDir, "types");

async function generateDeclarations() {
    console.log("Generating TypeScript declarations...");
    await execAsync("npx tsc -d --emitDeclarationOnly --skipLibCheck --outDir types");
    console.log("Declarations generated.");
}

function getPackages() {
    const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function copyPackageJson(pkgName) {
    const srcPkgJson = path.join(packagesDir, pkgName, "package.json");
    const pkgJson = JSON.parse(fs.readFileSync(srcPkgJson, "utf-8"));

    const newPkgJson = {
        name: pkgJson.name,
        version: pkgJson.version,
        description: pkgJson.description,
        main: pkgJson.main,
        types: "src/index.d.ts",
        files: ["src", "package.json"],
    };

    const destPkgJson = path.join(typesDir, pkgName, "package.json");
    fs.mkdirSync(path.dirname(destPkgJson), { recursive: true });
    fs.writeFileSync(destPkgJson, JSON.stringify(newPkgJson, null, 2));
    console.log(`Created package.json for ${pkgName}`);
}

async function main() {
    console.log("Starting types generation...\n");

    await generateDeclarations();

    console.log("\nCopying and updating package.json files...\n");

    const packages = getPackages();
    for (const pkgName of packages) {
        copyPackageJson(pkgName);
    }

    console.log("\nAll types generated successfully!");
}

await main();
