// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { ObservableCollection } from "chili-core";
import { Collection } from "../src/collection";

describe("Collection", () => {
    let container: HTMLElement;
    let templateCallCount: number;
    let templateItems: { item: string; index: number }[];

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        templateCallCount = 0;
        templateItems = [];
    });

    const createTemplate = (): ((item: string, index: number) => HTMLElement) => {
        return (item: string, index: number) => {
            templateCallCount++;
            templateItems.push({ item, index });
            const div = document.createElement("div");
            div.textContent = item;
            div.dataset["testid"] = `item-${item}`;
            return div;
        };
    };

    describe("with plain array", () => {
        test("should render all items from array", () => {
            const items = ["a", "b", "c"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            expect(collection.children.length).toBe(3);
            expect(templateCallCount).toBe(3);
            expect(templateItems.map((x) => x.item)).toEqual(["a", "b", "c"]);
        });

        test("should pass correct index to template", () => {
            const items = ["first", "second", "third"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            expect(templateItems.map((x) => x.index)).toEqual([0, 1, 2]);
        });

        test("should get item element by item value", () => {
            const items = ["a", "b", "c"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            const element = collection.getItem("b");
            expect(element).toBeDefined();
            expect(element?.textContent).toBe("b");
        });

        test("should return undefined for non-existent item", () => {
            const items = ["a", "b", "c"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            const element = collection.getItem("z");
            expect(element).toBeUndefined();
        });

        test("should handle empty array", () => {
            const items: string[] = [];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            expect(collection.children.length).toBe(0);
            expect(templateCallCount).toBe(0);
        });

        test("should handle single item", () => {
            const items = ["only"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            expect(collection.children.length).toBe(1);
            expect(templateCallCount).toBe(1);
        });
    });

    describe("with ObservableCollection", () => {
        test("should render initial items", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            expect(collection.children.length).toBe(3);
            expect(templateCallCount).toBe(3);
        });

        test("should get item element by item value", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            const element = collection.getItem("b");
            expect(element).not.toBeUndefined();
            expect(element?.textContent).toBe("b");
        });

        test("should handle add action", () => {
            const sources = new ObservableCollection("a", "b");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.push("c");

            expect(collection.children.length).toBe(3);
            expect(templateCallCount).toBe(3);
            expect(collection.getItem("c")).toBeDefined();
        });

        test("should handle remove action", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.remove("b");

            expect(collection.children.length).toBe(2);
            expect(collection.getItem("b")).toBeUndefined();
            expect(collection.getItem("a")).toBeDefined();
            expect(collection.getItem("c")).toBeDefined();
        });

        test("should handle move action", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.move(0, 2);

            expect(collection.children.length).toBe(3);
            expect(collection.children[0].textContent).toBe("b");
            expect(collection.children[1].textContent).toBe("a");
            expect(collection.children[2].textContent).toBe("c");
        });

        test("should handle replace action", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.replace(1, "x", "y");

            expect(collection.children.length).toBe(4);
            expect(collection.children[0].textContent).toBe("a");
            expect(collection.children[1].textContent).toBe("x");
            expect(collection.children[2].textContent).toBe("y");
            expect(collection.children[3].textContent).toBe("c");
        });

        test("should handle clear action", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.clear();

            expect(collection.children.length).toBe(0);
            expect(templateCallCount).toBe(3);
        });

        test("should handle multiple add operations", () => {
            const sources = new ObservableCollection("a");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.push("b");
            sources.push("c", "d");

            expect(collection.children.length).toBe(4);
            expect(collection.getItem("a")).toBeDefined();
            expect(collection.getItem("b")).toBeDefined();
            expect(collection.getItem("c")).toBeDefined();
            expect(collection.getItem("d")).toBeDefined();
        });

        test("should handle multiple remove operations", () => {
            const sources = new ObservableCollection("a", "b", "c", "d");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            sources.remove("b");
            sources.remove("d");

            expect(collection.children.length).toBe(2);
            expect(collection.getItem("a")).not.toBeUndefined();
            expect(collection.getItem("c")).not.toBeUndefined();
            expect(collection.getItem("b")).toBeUndefined();
            expect(collection.getItem("d")).toBeUndefined();
        });
    });

    describe("disconnectedCallback", () => {
        test("should remove all child elements when disconnected", () => {
            const sources = new ObservableCollection("a", "b", "c");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);
            expect(collection.children.length).toBe(3);

            collection.remove();

            expect(collection.children.length).toBe(0);
        });

        test("should clear item map when disconnected", () => {
            const items = ["a", "b", "c"];
            const template = createTemplate();
            const collection = new Collection({ sources: items, template });

            container.appendChild(collection);

            expect(collection.getItem("a")).not.toBeUndefined();
            expect(collection.getItem("b")).not.toBeUndefined();

            collection.remove();

            expect(collection.getItem("a")).toBeUndefined();
            expect(collection.getItem("b")).toBeUndefined();
        });

        test("should not receive collection changes after disconnect", () => {
            const sources = new ObservableCollection("a", "b");
            const template = createTemplate();
            const collection = new Collection({ sources, template });

            container.appendChild(collection);

            collection.remove();

            sources.push("c");

            expect(collection.children.length).toBe(0);
        });
    });

    describe("customElements.define", () => {
        test("should define custom element", () => {
            expect(customElements.get("chili-collection")).toBe(Collection);
        });
    });
});
