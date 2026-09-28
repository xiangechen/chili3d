// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DefaultFont, type FontOutline, rememberOutline } from "@chili3d/core";
import { initGarlicSync } from "../../src/sketch/garlic";

// Load the garlic constraint-solver WASM synchronously from bytes for node tests.
initGarlicSync(readFileSync(path.resolve(import.meta.dirname, "..", "..", "lib", "garlic_bg.wasm")));

// Dimension text draws as mesh glyphs laid out from the default font, which is
// fetched from the network in the app. Tests get a fixed triangle-per-character
// font instead — one triangle, advance 1, em size 1, so mesh sizes stay countable.
const testFont: FontOutline = {
    familyName: "test",
    unitsPerEm: 1,
    missingAdvance: 1,
    glyph: () => ({
        advance: 1,
        contours: [
            {
                start: { x: 0, y: 0 },
                segments: [
                    { kind: "line", to: { x: 1, y: 0 } },
                    { kind: "line", to: { x: 0, y: 1 } },
                ],
            },
        ],
    }),
};
rememberOutline(DefaultFont.family, DefaultFont.url, testFont);
