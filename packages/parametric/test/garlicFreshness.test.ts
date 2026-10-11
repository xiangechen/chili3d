// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const checkScript = path.join(repoRoot, "scripts/check-garlic.mjs");
const garlicDir = path.resolve(repoRoot, "..", "garlic");

/**
 * garlic is consumed as vendored wasm-pack output (`packages/parametric/lib/`), copied by hand
 * from a sibling checkout. Nothing else notices when a rebuild over there never made it over
 * here — the app would just fail at runtime inside wasm-bindgen, which reads like a chili3d bug.
 *
 * CI has no garlic checkout (it is a sibling directory), so an absent one skips instead of
 * failing; only a present-but-different set is drift. Same shape as
 * `packages/ai/test/capabilitiesFreshness.test.ts`: shell out to the shared script rather than
 * reimplement the comparison here, so `npm run check:garlic` and the suite agree.
 *
 * The absent case is a `skipIf` rather than a `return`: an early return reports a pass with
 * nothing compared, so a green run reads as "garlic was checked" when nothing was.
 */
const hasGarlic = existsSync(path.join(garlicDir, "pkg"));

test.skipIf(!hasGarlic)("the vendored garlic wasm matches the garlic checkout it was built from", () => {
    let stdout = "";
    try {
        stdout = execFileSync("node", [checkScript], { cwd: repoRoot, encoding: "utf8" });
    } catch (error) {
        const failure = error as { stderr?: string };
        throw new Error(`The vendored garlic is out of date. ${failure.stderr?.trim() ?? ""}`);
    }
    expect(stdout).toContain("matches");
});
