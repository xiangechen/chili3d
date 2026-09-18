// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedPath = path.join(repoRoot, "packages/ai/src/tools/capabilities.generated.ts");

/**
 * The catalog and the query doc are generated from core's shape API, but nothing else notices
 * when a core edit makes them stale — the model would simply keep reading a catalog that no
 * longer matches the factory. The generator is cheap (~0.7s), so the check runs with the suite.
 */
test("capabilities.generated.ts is what the generator produces from the current core sources", () => {
    const before = readFileSync(generatedPath, "utf8");
    execFileSync("node", ["scripts/generate-shape-capabilities.mjs"], { cwd: repoRoot });
    const after = readFileSync(generatedPath, "utf8");

    // Compared as strings, not with toBe: a stale catalog differs by hundreds of lines and the
    // useful message is the instruction, not the diff.
    if (after !== before) {
        throw new Error(
            `capabilities.generated.ts was stale — it has just been regenerated from core's shape API. ` +
                `Re-run the suite to confirm, then commit the regenerated file. ` +
                `(core changed the shape factory or the IShape/ICurve/ISurface families without a re-run of ` +
                `npm run generate:capabilities)`,
        );
    }
});
