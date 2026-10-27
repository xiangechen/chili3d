// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { redactDataUrls } from "../src/llm/redact";

describe("redactDataUrls", () => {
    test("leaves a swatch-sized data URL alone", () => {
        const small = `data:image/png;base64,${"A".repeat(64)}`;
        expect(redactDataUrls(small)).toBe(small);
    });

    test("summarizes a long base64 payload by its decoded size", () => {
        const data = "A".repeat(4096);
        const redacted = redactDataUrls(JSON.stringify({ texture: `data:image/png;base64,${data}` }));

        expect(redacted).toContain("data:image/png;base64,<3 KB omitted");
        expect(redacted).not.toContain(data);
    });
});
