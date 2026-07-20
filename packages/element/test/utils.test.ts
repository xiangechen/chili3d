// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PathBinding } from "@chili3d/core";
import { rs } from "@rstest/core";
import { setProperties, toBase64Img } from "../src/utils";

describe("setProperties", () => {
    test("should set plain string values", () => {
        const target = document.createElement("div");
        setProperties(target, { id: "test-id", className: "my-class" });
        expect(target.id).toBe("test-id");
        expect(target.className).toBe("my-class");
    });

    test("should set number values", () => {
        const target = document.createElement("div");
        setProperties(target, { tabIndex: 1, title: "test" });
        expect(target.tabIndex).toBe(1);
        expect(target.title).toBe("test");
    });

    test("should set boolean values", () => {
        const target = document.createElement("input");
        setProperties(target, { disabled: true, hidden: false });
        expect(target.disabled).toBe(true);
        expect(target.hidden).toBe(false);
    });

    test("should set function values (event handlers)", () => {
        const handler = rs.fn();
        const target = document.createElement("div");
        setProperties(target, { onclick: handler });
        expect(target.onclick).toBe(handler);
    });

    test("should detect Localize for textContent (instanceof check passes even without I18n)", () => {
        const target = document.createElement("div");
        setProperties(target, { textContent: "plain text" });
        expect(target.textContent).toBe("plain text");
    });

    test("should set title as plain string", () => {
        const target = document.createElement("div");
        setProperties(target, { title: "plain title" });
        expect(target.title).toBe("plain title");
    });

    test("should handle PathBinding by calling setBinding", () => {
        const target = document.createElement("div");
        const source = {
            onPropertyChanged: rs.fn(),
            removePropertyChanged: rs.fn(),
            clearPropertyChanged: rs.fn(),
            dispose: rs.fn(),
        };
        const binding = new PathBinding(source, "testProp");
        const setBindingSpy = rs.spyOn(binding, "setBinding");
        // title is a valid property of HTMLDivElement
        setProperties(target, { title: binding } as any);
        expect(setBindingSpy).toHaveBeenCalledWith(target, "title");
        setBindingSpy.mockRestore();
    });

    test("should handle nested object properties", () => {
        const target = document.createElement("div");
        target.style.cssText = "";
        setProperties(target, {
            style: {
                color: "red",
                fontSize: "14px",
            },
        });
        expect(target.style.color).toBe("red");
        expect(target.style.fontSize).toBe("14px");
    });

    test("should handle empty props", () => {
        const target = document.createElement("div");
        target.title = "original";
        setProperties(target, {} as any);
        expect(target.title).toBe("original");
    });
});

describe("toBase64Img", () => {
    test("should create png data URL", () => {
        const result = toBase64Img("icon.png", "abc123");
        expect(result).toBe("data:image/png;base64,abc123");
    });

    test("should create svg data URL", () => {
        const result = toBase64Img("icon.svg", "xyz789");
        expect(result).toBe("data:image/svg+xml;base64,xyz789");
    });

    test("should create jpg data URL", () => {
        const result = toBase64Img("icon.jpg", "jpg456");
        expect(result).toBe("data:image/jpeg;base64,jpg456");
    });

    test("should not match uppercase extension (endsWith is case-sensitive)", () => {
        expect(() => toBase64Img("icon.PNG", "data")).toThrow("Unsupported icon format");
    });

    test("should throw for unsupported format", () => {
        expect(() => toBase64Img("icon.gif", "data")).toThrow("Unsupported icon format");
    });

    test("should throw for format without image extension", () => {
        expect(() => toBase64Img("readme.txt", "data")).toThrow("Unsupported icon format");
    });
});
