// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FeatureItem, IFeatureListNode, INode } from "@chili3d/core";
import { afterEach, describe, expect, rs, test } from "@rstest/core";

// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument } from "./_helpers/propertyTestHelpers";

// Shared mocks: CSS modules, element helpers, core services
import "./_helpers/cssMocks";
import "./_helpers/mockElement";
import "./_helpers/mockCoreProperty";

rs.mock("../src/property/featureListProperty.module.css", () => ({
    root: "fl-root",
    item: "fl-item",
    error: "fl-error",
    warning: "fl-warning",
    suppressed: "fl-suppressed",
    header: "fl-header",
    expander: "fl-expander",
    icon: "fl-icon",
    name: "fl-name",
    more: "fl-more",
    body: "fl-body",
    errorText: "fl-error-text",
    warningText: "fl-warning-text",
    param: "fl-param",
    reference: "fl-reference",
    menu: "fl-menu",
    menuItem: "fl-menu-item",
    menuIcon: "fl-menu-icon",
    dropBefore: "fl-drop-before",
    dropAfter: "fl-drop-after",
}));

const { showDialogMock } = rs.hoisted(() => {
    const fn = (_title: string, _content: HTMLElement, onConfirm?: () => void) => {
        fn.calls.push([_title, _content, onConfirm]);
        fn.lastConfirm = onConfirm;
    };
    fn.calls = [] as [string, HTMLElement, (() => void) | undefined][];
    fn.lastConfirm = undefined as (() => void) | undefined;
    fn.clear = () => {
        fn.calls.length = 0;
        fn.lastConfirm = undefined;
    };
    return { showDialogMock: fn };
});

rs.mock("../src/dialog", () => ({
    showDialog: showDialogMock,
}));

import { FeatureListProperty } from "../src/property/featureListProperty";
import { mustQuery } from "./_helpers/domHelpers";

function featureNode(parameters: FeatureItem["parameters"], item?: Partial<FeatureItem>) {
    return {
        featureItems: () => [{ id: "b1", display: "command.feature.fuse", parameters, ...item }],
        setFeatureParameter: rs.fn((_id: string, _key: string, _value: number | string | boolean) => {}),
        setFeatureSuppressed: rs.fn(),
        moveFeature: rs.fn(),
        moveFeatureTo: rs.fn(),
        renameFeature: rs.fn(),
        removeFeature: rs.fn(),
        activateReference: rs.fn((_featureId: string, _key: string) => {}),
    } as unknown as INode & IFeatureListNode;
}

function expandFirstRow(prop: FeatureListProperty) {
    const header = mustQuery<HTMLElement>(prop, ".fl-header");
    (header as unknown as { _onclick: () => void })._onclick();
}

function openMenu(prop: FeatureListProperty) {
    const more = mustQuery<HTMLElement>(prop, ".fl-more");
    (more as unknown as { _onclick: (e: MouseEvent) => void })._onclick({
        stopPropagation: () => {},
    } as MouseEvent);
    return mustQuery<HTMLElement>(document.body, ".fl-menu");
}

function clickMenuItem(menu: HTMLElement, index: number) {
    const items = menu.querySelectorAll(".fl-menu-item");
    (items[index] as unknown as { _onclick: (e: MouseEvent) => void })._onclick({
        stopPropagation: () => {},
    } as MouseEvent);
}

describe("FeatureListProperty", () => {
    afterEach(() => {
        document.body.querySelectorAll(".fl-menu").forEach((x) => x.remove());
        showDialogMock.clear();
    });

    test("renders rows collapsed and expands them on header click", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "length", display: "common.name", value: 12 }]);
        const prop = new FeatureListProperty(doc, node);

        expect(prop.querySelector(".fl-param")).toBeNull();
        expandFirstRow(prop);
        expect(prop.querySelector(".fl-param")).not.toBeNull();

        expandFirstRow(prop);
        expect(prop.querySelector(".fl-param")).toBeNull();
    });

    test("renders a checkbox for boolean parameters", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "consumeTools", display: "features.consumeTools", value: true }]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const checkbox = mustQuery<HTMLInputElement>(prop, "input[type='checkbox']");
        expect(checkbox.checked).toBe(true);
        expect(prop.querySelector("input.ip-box")).toBeNull();
    });

    test("renders a text input for numeric parameters", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "length", display: "common.name", value: 12.34567 }]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const box = mustQuery<HTMLInputElement>(prop, "input.ip-box");
        expect(box.value).toBe("12.3457");
        expect(prop.querySelector("input[type='checkbox']")).toBeNull();
    });

    test("toggling the checkbox applies the boolean parameter", () => {
        const doc = createMockDocument();
        let visualUpdated = false;
        doc.visual.update = () => {
            visualUpdated = true;
        };
        const node = featureNode([{ key: "consumeTools", display: "features.consumeTools", value: true }]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const checkbox = mustQuery<HTMLInputElement>(prop, "input[type='checkbox']");
        checkbox.checked = false;
        const onclick = (checkbox as any)._onclick as (e: { target: HTMLInputElement }) => void;
        onclick({ target: checkbox });

        expect(node.setFeatureParameter).toHaveBeenCalledWith("b1", "consumeTools", false);
        expect(visualUpdated).toBe(true);
    });

    test("shows the custom name instead of the localized display when renamed", () => {
        const doc = createMockDocument();
        const node = featureNode([], { name: "My fillet" });
        const prop = new FeatureListProperty(doc, node);

        expect(mustQuery(prop, ".fl-name").textContent).toBe("My fillet");
    });

    test("errored rows render expanded with the error text", () => {
        const doc = createMockDocument();
        const node = featureNode([], { error: "Edge not found after rebuild" });
        const prop = new FeatureListProperty(doc, node);

        expect(mustQuery(prop, ".fl-error-text").textContent).toBe("Edge not found after rebuild");
    });

    test("warning rows render tinted without forcing expansion", () => {
        const doc = createMockDocument();
        const node = featureNode([], { warning: "Sketch has unresolved external references" });
        const prop = new FeatureListProperty(doc, node);

        const row = mustQuery<HTMLElement>(prop, ".fl-item");
        expect(row.className).toContain("fl-warning");
        expect(row.className).not.toContain("fl-error");
        expect(row.title).toBe("Sketch has unresolved external references");
        // no forced expansion: the text appears only once the user expands the row
        expect(prop.querySelector(".fl-warning-text")).toBeNull();

        expandFirstRow(prop);
        expect(mustQuery(prop, ".fl-warning-text").textContent).toBe(
            "Sketch has unresolved external references",
        );
    });

    test("renders the feature's reference above its parameters", () => {
        const doc = createMockDocument();
        const sketch = { id: "sketch-1", name: "Sketch 1" } as unknown as INode;
        const node = featureNode([{ key: "depth", display: "option.command.depth", value: 5 }], {
            references: [{ key: "sketchId", display: "body.sketch", node: sketch }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        // Both rows carry the `.fl-param` wrapper; the link span is what marks a reference.
        const rows = Array.from(mustQuery<HTMLElement>(prop, ".fl-body").children);
        expect(rows.length).toBe(2);
        expect(rows[0].querySelector(".fl-reference")).not.toBeNull();
        expect(rows[1].querySelector(".fl-reference")).toBeNull();
    });

    test("clicking a reference row selects the referenced node", () => {
        const doc = createMockDocument();
        const selected: INode[][] = [];
        doc.selection.setSelectedNodes = (nodes) => {
            selected.push(nodes);
            return nodes.length;
        };
        const sketch = { id: "sketch-1", name: "Sketch 1" } as unknown as INode;
        const node = featureNode([], {
            references: [{ key: "sketchId", display: "body.sketch", node: sketch }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const name = mustQuery<HTMLElement>(prop, ".fl-reference");
        (name as unknown as { _onclick: () => void })._onclick();

        expect(selected).toEqual([[sketch]]);
    });

    test("double-clicking a reference row asks the node to open the reference", () => {
        const doc = createMockDocument();
        const sketch = { id: "sketch-1", name: "Sketch 1" } as unknown as INode;
        const node = featureNode([], {
            references: [{ key: "sketchId", display: "body.sketch", node: sketch }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const name = mustQuery<HTMLElement>(prop, ".fl-reference");
        (name as unknown as { _ondblclick: () => void })._ondblclick();

        expect(node.activateReference).toHaveBeenCalledWith("b1", "sketchId");
    });

    test("the more menu opens with rename/suppress/delete entries", () => {
        const doc = createMockDocument();
        const node = featureNode([]);
        const prop = new FeatureListProperty(doc, node);
        const menu = openMenu(prop);

        expect(menu.querySelectorAll(".fl-menu-item").length).toBe(3);

        clickMenuItem(menu, 2);
        expect(node.removeFeature).toHaveBeenCalledWith("b1");
        expect(document.body.querySelector(".fl-menu")).toBeNull();
    });

    test("the suppress menu entry toggles the feature", () => {
        const doc = createMockDocument();
        const node = featureNode([]);
        const prop = new FeatureListProperty(doc, node);
        const menu = openMenu(prop);

        clickMenuItem(menu, 1);
        expect(node.setFeatureSuppressed).toHaveBeenCalledWith("b1", true);
    });

    test("rename opens a dialog and applies the new name on confirm", () => {
        const doc = createMockDocument();
        const node = featureNode([]);
        const prop = new FeatureListProperty(doc, node);
        const menu = openMenu(prop);

        clickMenuItem(menu, 0);
        expect(showDialogMock.calls.length).toBe(1);
        const dialogInput = showDialogMock.calls[0][1] as HTMLInputElement;
        dialogInput.value = "  Boss  ";
        showDialogMock.lastConfirm!();

        expect(node.renameFeature).toHaveBeenCalledWith("b1", "Boss");
    });

    test("dropping a row after another reorders via moveFeatureTo", () => {
        const doc = createMockDocument();
        const items: FeatureItem[] = [
            { id: "f1", display: "command.feature.fuse", parameters: [] },
            { id: "f2", display: "command.feature.fuse", parameters: [] },
            { id: "f3", display: "command.feature.fuse", parameters: [] },
        ];
        const node = {
            featureItems: () => items,
            setFeatureParameter: rs.fn(),
            setFeatureSuppressed: rs.fn(),
            moveFeature: rs.fn(),
            moveFeatureTo: rs.fn(),
            removeFeature: rs.fn(),
        } as unknown as INode & IFeatureListNode;
        const prop = new FeatureListProperty(doc, node);
        const rows = prop.querySelectorAll(".fl-item");
        const headers = prop.querySelectorAll(".fl-header");

        headers[0].dispatchEvent(new Event("dragstart"));
        rows[2].dispatchEvent(new MouseEvent("dragover", { bubbles: true, cancelable: true }));
        expect(rows[2].classList.contains("fl-drop-after")).toBe(true);
        rows[2].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));

        expect(node.moveFeatureTo).toHaveBeenCalledWith("f1", 2);
        expect(rows[2].classList.contains("fl-drop-after")).toBe(false);
    });

    describe("menu positioning", () => {
        /** Overrides the anchor rect, menu size and viewport, then opens the menu. */
        function openMenuWithGeometry(
            prop: FeatureListProperty,
            anchorRect: { top: number; bottom: number; left: number; right: number },
            menuSize: { width: number; height: number },
            viewport: { width: number; height: number },
        ) {
            const more = mustQuery<HTMLElement>(prop, ".fl-more");
            more.getBoundingClientRect = () => anchorRect as DOMRect;
            const descriptors = [
                Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
                Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
            ];
            Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
                configurable: true,
                get: () => menuSize.width,
            });
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
                configurable: true,
                get: () => menuSize.height,
            });
            const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
            const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
            Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport.width });
            Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport.height });
            try {
                return openMenu(prop);
            } finally {
                Object.defineProperty(HTMLElement.prototype, "offsetWidth", descriptors[0]!);
                Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptors[1]!);
                Object.defineProperty(window, "innerWidth", innerWidth!);
                Object.defineProperty(window, "innerHeight", innerHeight!);
            }
        }

        test("opens below the anchor when there is room", () => {
            const prop = new FeatureListProperty(createMockDocument(), featureNode([]));
            const menu = openMenuWithGeometry(
                prop,
                { top: 100, bottom: 124, left: 50, right: 70 },
                { width: 140, height: 120 },
                { width: 1024, height: 768 },
            );

            expect(menu.style.top).toBe("126px"); // bottom + 2
            expect(menu.style.left).toBe("50px");
        });

        test("flips above the anchor when it would overflow the viewport bottom", () => {
            const prop = new FeatureListProperty(createMockDocument(), featureNode([]));
            const menu = openMenuWithGeometry(
                prop,
                { top: 680, bottom: 704, left: 50, right: 70 },
                { width: 140, height: 120 },
                { width: 1024, height: 720 },
            );

            // 704 + 2 + 120 > 720 → flip: top(680) - height(120) - 2
            expect(menu.style.top).toBe("558px");
        });

        test("clamps the left edge when the menu would overflow the viewport right", () => {
            const prop = new FeatureListProperty(createMockDocument(), featureNode([]));
            const menu = openMenuWithGeometry(
                prop,
                { top: 100, bottom: 124, left: 950, right: 970 },
                { width: 140, height: 120 },
                { width: 1024, height: 768 },
            );

            // max(950, 970-140) = 950 → clamp to 1024 - 140 - 4
            expect(menu.style.left).toBe("880px");
        });
    });
});
