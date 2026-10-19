// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { splitDataUrl } from "../src/llm/imageData";

describe("splitDataUrl", () => {
    test("splits a base64 data URL", () => {
        expect(splitDataUrl("data:image/png;base64,AAAA")).toEqual({
            mediaType: "image/png",
            data: "AAAA",
        });
    });

    test("splits a header without parameters", () => {
        // No `;` at all: the old slice(indexOf(";")) parsed almost the whole URL as the type.
        expect(splitDataUrl("data:image/svg+xml,<svg/>")).toEqual({
            mediaType: "image/svg+xml",
            data: "<svg/>",
        });
    });

    test("keeps only the media type from a parameterized header", () => {
        expect(splitDataUrl("data:text/plain;charset=utf-8,hi")).toEqual({
            mediaType: "text/plain",
            data: "hi",
        });
    });

    test("leaves a value that is not a data URL as payload", () => {
        expect(splitDataUrl("raw-bytes")).toEqual({ mediaType: "", data: "raw-bytes" });
    });
});
