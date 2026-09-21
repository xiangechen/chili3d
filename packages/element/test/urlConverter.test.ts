// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { UrlStringConverter } from "../src/converters/urlConverter";

describe("UrlStringConverter", () => {
    test("should convert string to CSS url format", () => {
        const converter = new UrlStringConverter();
        const result = converter.convert("https://example.com/image.png");
        expect(result.value).toBe("url('https://example.com/image.png')");
    });

    test("should handle empty string", () => {
        const converter = new UrlStringConverter();
        const result = converter.convert("");
        expect(result.value).toBe("url('')");
    });

    test("should handle special characters", () => {
        const converter = new UrlStringConverter();
        const result = converter.convert("image with spaces.png");
        expect(result.value).toBe("url('image with spaces.png')");
    });

    // An SVG data URL carries a single quote on every attribute; left alone the first of them
    // ends the CSS string and the browser drops the whole declaration, so the texture shows on
    // the model but nowhere the panel paints it as a background.
    test("should escape the quotes inside an SVG data URL", () => {
        const converter = new UrlStringConverter();
        const result = converter.convert("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'>");
        expect(result.value).toBe(
            "url('data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\'>')",
        );
    });

    test("should escape a backslash, which CSS would otherwise read as an escape", () => {
        const converter = new UrlStringConverter();
        const result = converter.convert("C:\\images\\a.png");
        expect(result.value).toBe("url('C:\\\\images\\\\a.png')");
    });
});
