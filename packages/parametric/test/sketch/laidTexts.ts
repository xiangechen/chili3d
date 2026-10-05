// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { defaultFontService } from "@chili3d/core";
import { rs } from "@rstest/core";

/**
 * Runs `body` with the strings the annotation text is laid out from collected — what a dimension
 * *reads* is only ever that now: mesh glyphs, drawn from the font, with no badge element to ask.
 * The substrings a value's affixes (`R`, `Ø`, `°`, parentheses) put in front of it are part of the
 * string, so they are asserted here too.
 */
export function laidTexts(body: () => void): string[] {
    const laid: string[] = [];
    const real = defaultFontService.layout.bind(defaultFontService);
    const spy = rs.spyOn(defaultFontService, "layout").mockImplementation((text: string) => {
        laid.push(text);
        return real(text);
    });
    try {
        body();
    } finally {
        spy.mockRestore();
    }
    return laid;
}
