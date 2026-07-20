// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Loading } from "../src/loading";

describe("Loading custom element", () => {
    test("should be defined as a custom element", () => {
        expect(customElements.get("chili-loading")).toBe(Loading);
    });

    test("should create an instance", () => {
        const el = new Loading();
        expect(el).toBeInstanceOf(HTMLElement);
        expect(el).toBeInstanceOf(Loading);
    });

    test("should have fixed positioning style", () => {
        const el = new Loading();
        expect(el.style.position).toBe("fixed");
        expect(el.style.zIndex).toBe("9999");
        expect(el.style.width).toBe("100%");
        expect(el.style.height).toBe("100%");
    });

    test("should contain a spinner element", () => {
        const el = new Loading();
        const spinner = el.querySelector("div");
        expect(spinner).not.toBeNull();
        // The first child div should be the spinner
        const firstChild = el.children[0] as HTMLElement;
        expect(firstChild.tagName).toBe("DIV");
        expect(firstChild.style.borderRadius).toBe("50%");
    });

    test("should contain a label with 'Loading...' text", () => {
        const el = new Loading();
        const labels = Array.from(el.querySelectorAll("div")).filter((d) => d.textContent === "Loading...");
        expect(labels.length).toBeGreaterThanOrEqual(1);
    });

    test("should inject keyframes animation into document head", () => {
        // Save the current head content
        const initialStyleCount = document.head.querySelectorAll("style").length;
        new Loading();
        const newStyleCount = document.head.querySelectorAll("style").length;
        // Each Loading instance appends a style element with @keyframes
        expect(newStyleCount).toBeGreaterThanOrEqual(initialStyleCount + 1);
    });

    test("should have spinner with animation style", () => {
        const el = new Loading();
        const spinner = el.children[0] as HTMLElement;
        expect(spinner.style.animation).toContain("spin");
    });

    test("should have semi-transparent dark background", () => {
        const el = new Loading();
        expect(el.style.backgroundColor).toBe("rgba(0, 0, 0, 0.5)");
    });

    test("second instance should also work", () => {
        const el1 = new Loading();
        const el2 = new Loading();
        expect(el1).not.toBe(el2);
        expect(el2.children.length).toBeGreaterThan(0);
    });
});
