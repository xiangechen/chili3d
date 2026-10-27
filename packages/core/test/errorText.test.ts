// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { errorText } from "../src";

describe("errorText", () => {
    test("should use the message of an Error", () => {
        expect(errorText(new Error("disk full"))).toBe("disk full");
    });

    test("should use the message of an Error-like DOMException", () => {
        const error = { name: "QuotaExceededError", message: "The quota has been exceeded." };

        expect(errorText(error)).toBe("The quota has been exceeded.");
    });

    test("should unwrap the error an IndexedDB request event carries", () => {
        const event = { target: { error: new Error("connection refused") } };

        expect(errorText(event)).toBe("connection refused");
    });

    test("should pass a rejected string through", () => {
        expect(errorText("nope")).toBe("nope");
    });

    test("should fall back to the name, then to the value itself", () => {
        expect(errorText({ name: "AbortError" })).toBe("AbortError");
        expect(errorText(undefined)).toBe("undefined");
        expect(errorText({})).toBe("[object Object]");
    });
});
