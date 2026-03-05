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
});
