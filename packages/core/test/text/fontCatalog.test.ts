// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { FontCatalog, MAX_FONT_BYTES } from "../../src/text/fontCatalog";

describe("FontCatalog", () => {
    test("offers a font to fetch", () => {
        expect(FontCatalog.length).toBeGreaterThan(0);
    });

    test("names every font once, so a document cannot hold two of the same", () => {
        const families = FontCatalog.map((font) => font.family);

        expect(new Set(families).size).toBe(families.length);
    });

    test("takes its fonts from one commit rather than a branch", () => {
        // A branch would let a font change under a document drawn in it, and
        // jsDelivr serves whatever the branch points at that moment.
        const pin = /cdn\.jsdelivr\.net\/gh\/google\/fonts@([0-9a-f]{40})\//;

        for (const font of FontCatalog) {
            expect(font.url).toMatch(pin);
            expect(font.url).toMatch(/^https:/);
        }
    });

    test("stays inside what the serving CDN will hand over", () => {
        // jsDelivr answers 403 for a file over its limit — Noto Serif SC is one, so
        // a font that is too large cannot be listed here at all.
        for (const font of FontCatalog) {
            expect(font.size).toBeGreaterThan(0);
            expect(font.size).toBeLessThan(MAX_FONT_BYTES);
        }
    });

    test("states a size big enough to be worth warning about", () => {
        // Every size is shown to the user before they pay the download, so a size
        // that is off by more than half is worse than no size at all.
        for (const font of FontCatalog) {
            expect(font.size).toBeGreaterThan(100_000);
        }
    });
});
