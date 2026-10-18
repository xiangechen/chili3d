// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockApplication } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { Document } from "../src/document";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
    documentVersion: string;
};

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * `documentVersion` is the gate that rejects a document written by a different schema
 * (`Document.load` compares it for equality and refuses anything else — there is no
 * migration, by design). It is deliberately NOT `version`: a release bumps `version`
 * alone (`scripts/release.mjs`), and `documentVersion` moves only when the persisted
 * shape changes. That is a manual step, so what can be checked mechanically is checked
 * here: that both fields exist as semver, and that the build's injected constant is
 * actually the one the package declares.
 */
describe("document version", () => {
    test("version and documentVersion are both semver", () => {
        expect(pkg.version).toMatch(SEMVER);
        expect(pkg.documentVersion).toMatch(SEMVER);
    });

    test("the build injects the documentVersion the package declares", () => {
        // rspack's DefinePlugin (and rstest's) feeds `__DOCUMENT_VERSION__` from this
        // field. A typo there would silently let every document load under a version
        // nobody wrote down, which is the one failure this gate exists to prevent.
        expect(Document.version).toBe(pkg.documentVersion);
        expect(__DOCUMENT_VERSION__).toBe(pkg.documentVersion);
    });

    test("a document serializes the version it was built under", () => {
        const document = new Document(createMockApplication(), "version test");
        expect(document.serialize()["version"]).toBe(pkg.documentVersion);
    });

    test("a payload from an older documentVersion is refused", async () => {
        const alertFn = rs.fn();
        rs.stubGlobal("alert", alertFn);
        try {
            const loaded = await Document.load(createMockApplication(), {
                version: "0.12.0",
                name: "old",
                id: "old",
                acts: [],
                variables: [],
            } as never);

            expect(loaded).toBeUndefined();
            expect(alertFn).toHaveBeenCalledTimes(1);
        } finally {
            rs.unstubAllGlobals();
        }
    });
});
