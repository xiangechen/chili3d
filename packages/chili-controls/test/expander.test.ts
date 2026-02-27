// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import type { I18nKeys } from "chili-core";
import { Expander } from "../src/expander";
import style from "../src/expander/expander.module.css";

describe("Expander", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    describe("constructor", () => {
        test("should create expander with header", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            const headerText = expander.querySelector(`.${style.headerText}`);
            expect(headerText).toBeDefined();
        });

        test("should create expander with expander icon", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`);
            expect(icon).toBeDefined();
            expect(icon?.tagName).toBe("svg");
        });

        test("should create expander with content panel", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            expect(expander.contenxtPanel).toBeDefined();
            expect(expander.contenxtPanel.className).toBe(style.contextPanel);
        });

        test("should have correct root class", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            expect(expander.className).toBe(style.rootPanel);
        });

        test("should start in expanded state", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`);
            const useElement = icon?.firstChild as SVGUseElement;
            const href = useElement?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
            expect(href).toBe("#icon-angle-down");
        });

        test("should show content panel when expanded", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(false);
        });

        test("should have header panel with correct class", () => {
            const expander = new Expander("test.header" as I18nKeys);

            container.appendChild(expander);

            const headerPanel = expander.querySelector(`.${style.headerPanel}`);
            expect(headerPanel).toBeDefined();
        });
    });

    describe("expand/collapse toggle", () => {
        test("should collapse when expander icon is clicked", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            const useElement = icon.firstChild as SVGUseElement;
            const href = useElement.getAttributeNS("http://www.w3.org/1999/xlink", "href");
            expect(href).toBe("#icon-angle-right");
        });

        test("should hide content panel when collapsed", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(true);
        });

        test("should expand when collapsed icon is clicked again", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            const useElement = icon.firstChild as SVGUseElement;
            const href = useElement.getAttributeNS("http://www.w3.org/1999/xlink", "href");
            expect(href).toBe("#icon-angle-down");
        });

        test("should show content panel when expanded again", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(false);
        });

        test("should toggle multiple times correctly", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;

            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(true);

            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(false);

            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(expander.contenxtPanel.classList.contains(style.hidden)).toBe(true);
        });

        test("should stop propagation on click event", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            let propagationStopped = false;
            container.addEventListener("click", () => {
                propagationStopped = true;
            });

            const icon = expander.querySelector(`.${style.expanderIcon}`) as HTMLElement;
            icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(propagationStopped).toBe(false);
        });
    });

    describe("appendChild", () => {
        test("should add child to content panel", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child = document.createElement("div");
            expander.appendChild(child);

            expect(expander.contenxtPanel.contains(child)).toBe(true);
        });

        test("should return the appended child", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child = document.createElement("div");
            const result = expander.appendChild(child);

            expect(result).toBe(child);
        });

        test("should allow multiple children", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child1 = document.createElement("div");
            const child2 = document.createElement("span");
            const child3 = document.createElement("p");

            expander.appendChild(child1);
            expander.appendChild(child2);
            expander.appendChild(child3);

            expect(expander.contenxtPanel.children.length).toBe(3);
            expect(expander.contenxtPanel.contains(child1)).toBe(true);
            expect(expander.contenxtPanel.contains(child2)).toBe(true);
            expect(expander.contenxtPanel.contains(child3)).toBe(true);
        });
    });

    describe("append", () => {
        test("should add multiple nodes to content panel", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child1 = document.createElement("div");
            const child2 = document.createElement("span");
            expander.append(child1, child2);

            expect(expander.contenxtPanel.contains(child1)).toBe(true);
            expect(expander.contenxtPanel.contains(child2)).toBe(true);
        });

        test("should handle empty append", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            expander.append();

            expect(expander.contenxtPanel.children.length).toBe(0);
        });

        test("should handle single node append", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child = document.createElement("div");
            expander.append(child);

            expect(expander.contenxtPanel.contains(child)).toBe(true);
        });
    });

    describe("removeChild", () => {
        test("should remove child from content panel", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child = document.createElement("div");
            expander.appendChild(child);
            const result = expander.removeChild(child);

            expect(expander.contenxtPanel.contains(child)).toBe(false);
            expect(result).toBe(child);
        });

        test("should handle removing non-existent child", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child = document.createElement("div");
            expect(() => expander.removeChild(child)).toThrow();
        });
    });

    describe("addItem", () => {
        test("should add items to content panel", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const child1 = document.createElement("div");
            const child2 = document.createElement("span");
            expander.addItem(child1, child2);

            expect(expander.contenxtPanel.contains(child1)).toBe(true);
            expect(expander.contenxtPanel.contains(child2)).toBe(true);
        });

        test("should return expander instance for chaining", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const result = expander.addItem(document.createElement("div"));

            expect(result).toBe(expander);
        });

        test("should support method chaining", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            expander
                .addItem(document.createElement("div"))
                .addItem(document.createElement("span"))
                .addItem(document.createElement("p"));

            expect(expander.contenxtPanel.children.length).toBe(3);
        });
    });

    describe("customElements.define", () => {
        test("should define custom element", () => {
            expect(customElements.get("chili-expander")).toBe(Expander);
        });
    });

    describe("structure", () => {
        test("should have two direct children (header and content)", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            expect(expander.children.length).toBe(2);
        });

        test("should have header panel with correct class", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const headerPanel = expander.querySelector(`.${style.headerPanel}`);
            expect(headerPanel).toBeDefined();
        });

        test("should have context panel with correct class", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const contextPanel = expander.querySelector(`.${style.contextPanel}`);
            expect(contextPanel).toBeDefined();
        });

        test("should have header panel containing icon and text", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const headerPanel = expander.querySelector(`.${style.headerPanel}`);
            const icon = headerPanel?.querySelector(`.${style.expanderIcon}`);
            const text = headerPanel?.querySelector(`.${style.headerText}`);

            expect(icon).toBeDefined();
            expect(text).toBeDefined();
        });

        test("should have correct expander icon class", () => {
            const expander = new Expander("test.header" as I18nKeys);
            container.appendChild(expander);

            const icon = expander.querySelector(`.${style.expanderIcon}`);
            expect(icon?.className).toBe(style.expanderIcon);
        });
    });
});
