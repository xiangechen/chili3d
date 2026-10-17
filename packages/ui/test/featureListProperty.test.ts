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
    variableSuppressed: "fl-variable-suppressed",
    suppressInvert: "fl-suppress-invert",
    header: "fl-header",
    expander: "fl-expander",
    icon: "fl-icon",
    name: "fl-name",
    more: "fl-more",
    body: "fl-body",
    errorText: "fl-error-text",
    warningText: "fl-warning-text",
    missingInput: "fl-missing-input",
    missingInputAction: "fl-missing-input-action",
    param: "fl-param",
    groupMembers: "fl-group-members",
    groupMember: "fl-group-member",
    groupMemberLabel: "fl-group-member-label",
    reference: "fl-reference",
    menu: "fl-menu",
    menuItem: "fl-menu-item",
    menuIcon: "fl-menu-icon",
    dropBefore: "fl-drop-before",
    dropAfter: "fl-drop-after",
    rowsDragging: "fl-rows-dragging",
    rollbackSlot: "fl-rollback-slot",
    rollbackActive: "fl-rollback-active",
    rollbackDrop: "fl-rollback-drop",
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
        reselectShapes: rs.fn((_featureId: string) => {}),
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

    test("hides a parameter whose `visibleWhen` does not hold, and shows it when it does", () => {
        const doc = createMockDocument();
        const render = (midplane: boolean) => {
            const node = featureNode([
                { key: "midplane", display: "option.command.symmetric", value: midplane },
                {
                    key: "thickness2",
                    display: "option.command.thickness2",
                    value: 3,
                    visibleWhen: [{ key: "midplane", value: false }],
                },
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);
            return prop;
        };

        // Midplane on: the second thickness answers to nothing, so its row is gone — and the
        // one left is the toggle itself, not the number field it displaced.
        const withMidplane = render(true);
        expect(withMidplane.querySelectorAll(".fl-param")).toHaveLength(1);
        expect(mustQuery<HTMLInputElement>(withMidplane, "input[type='checkbox']").checked).toBe(true);
        expect(withMidplane.querySelector("input.ip-box")).toBeNull();

        expect(render(false).querySelectorAll(".fl-param")).toHaveLength(2);
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

    const joinTypeParameter = (value: string): FeatureItem["parameters"][number] => ({
        key: "joinType",
        display: "option.command.joinType",
        value,
        choices: [
            { value: "arc", display: "option.command.joinType.arc" },
            { value: "tangent", display: "option.command.joinType.tangent" },
            { value: "intersection", display: "option.command.joinType.intersection" },
        ],
    });

    test("renders a dropdown for a parameter with choices, and no text box", () => {
        const doc = createMockDocument();
        const node = featureNode([joinTypeParameter("arc")]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const options = Array.from(mustQuery<HTMLSelectElement>(prop, "select").querySelectorAll("option"));
        expect(options).toHaveLength(3);
        // Every other parameter is a text box; a choice must not be one, or the value is typable.
        expect(prop.querySelector("input.ip-box")).toBeNull();
        // Happy-DOM scrambles `option.selected` once the options are appended, so the raw flag
        // the row passed in is what to read.
        expect(options.map((x) => (x as unknown as { _selected: boolean })._selected)).toEqual([
            true,
            false,
            false,
        ]);
    });

    test("a chosen option applies the handler's value, not the DOM string", () => {
        const doc = createMockDocument();
        let visualUpdated = false;
        doc.visual.update = () => {
            visualUpdated = true;
        };
        const node = featureNode([joinTypeParameter("arc")]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const select = mustQuery<HTMLSelectElement>(prop, "select");
        select.value = "2";
        (select as unknown as { _onchange: (e: { target: HTMLSelectElement }) => void })._onchange({
            target: select,
        });

        // The third choice's value — the row maps the option back through `choices` rather than
        // trusting the element's string.
        expect(node.setFeatureParameter).toHaveBeenCalledWith("b1", "joinType", "intersection");
        expect(visualUpdated).toBe(true);
    });

    test("a choice with no label of its own shows its value", () => {
        const doc = createMockDocument();
        const node = featureNode([
            {
                key: "continuity",
                display: "option.command.continuity",
                value: "g1",
                choices: [{ value: "c0" }, { value: "g1" }],
            },
        ]);
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        // A token that reads the same in every language is its own label, uppercased.
        const options = Array.from(mustQuery<HTMLSelectElement>(prop, "select").querySelectorAll("option"));
        expect(options.map((x) => x.textContent)).toEqual(["C0", "G1"]);
        expect((options[1] as unknown as { _selected: boolean })._selected).toBe(true);
    });

    describe("parameter groups", () => {
        const ORIGIN = { id: "origin", display: "common.origin" } as const;
        const coord = (
            key: "origin.x" | "origin.y" | "origin.z",
            value: number,
            extra?: Partial<FeatureItem["parameters"][number]>,
        ): FeatureItem["parameters"][number] => ({
            key,
            display:
                key === "origin.x" ? "common.coordX" : key === "origin.y" ? "common.coordY" : "common.coordZ",
            value,
            group: ORIGIN,
            ...extra,
        });

        test("adjacent members of a group render as ONE row with a labelled input each", () => {
            const doc = createMockDocument();
            const node = featureNode([
                coord("origin.x", 1),
                coord("origin.y", 2),
                coord("origin.z", 3),
                { key: "radius", display: "circle.radius", value: 5 },
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            // The three coordinates merge into one row; the radius keeps its own.
            const rows = prop.querySelectorAll(".fl-param");
            expect(rows.length).toBe(2);
            // The row label is the group's; each member demotes to a small in-row label.
            expect(mustQuery(rows[0], ".cm-property-name")).not.toBeNull();
            expect(rows[0].querySelectorAll(".fl-group-member-label").length).toBe(3);
            const members = rows[0].querySelectorAll(".fl-group-member");
            expect(members.length).toBe(3);
            const boxes = Array.from(rows[0].querySelectorAll<HTMLInputElement>("input.ip-box"));
            expect(boxes.map((x) => x.value)).toEqual(["1", "2", "3"]);
            // The standalone row is untouched: no group wrapper, one full-width box.
            expect(rows[1].querySelector(".fl-group-members")).toBeNull();
            expect(rows[1].querySelectorAll("input.ip-box").length).toBe(1);
        });

        test("editing a member commits under the member's own key", () => {
            const doc = createMockDocument();
            let visualUpdated = false;
            doc.visual.update = () => {
                visualUpdated = true;
            };
            const node = featureNode([coord("origin.x", 1), coord("origin.y", 2), coord("origin.z", 3)]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            const boxes = Array.from(prop.querySelectorAll<HTMLInputElement>("input.ip-box"));
            boxes[1].value = "20";
            (boxes[1] as any)._onkeydown({ key: "Enter", stopPropagation: () => {}, target: boxes[1] });

            expect(node.setFeatureParameter).toHaveBeenCalledWith("b1", "origin.y", 20);
            expect(visualUpdated).toBe(true);
        });

        test("a member hidden by visibleWhen drops out of the row; the rest stay grouped", () => {
            const doc = createMockDocument();
            const node = featureNode([
                coord("origin.x", 1),
                coord("origin.y", 2, { visibleWhen: [{ key: "gone", value: true }] }),
                coord("origin.z", 3),
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            const rows = prop.querySelectorAll(".fl-param");
            expect(rows.length).toBe(1);
            const boxes = Array.from(rows[0].querySelectorAll<HTMLInputElement>("input.ip-box"));
            expect(boxes.map((x) => x.value)).toEqual(["1", "3"]);
        });

        test("a group whose members are all hidden renders no row", () => {
            const doc = createMockDocument();
            const hidden = { visibleWhen: [{ key: "gone", value: true }] };
            const node = featureNode([
                coord("origin.x", 1, hidden),
                coord("origin.y", 2, hidden),
                coord("origin.z", 3, hidden),
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            expect(prop.querySelector(".fl-param")).toBeNull();
        });

        test("a group id split by another parameter starts a second row", () => {
            const doc = createMockDocument();
            const node = featureNode([
                coord("origin.x", 1),
                { key: "radius", display: "circle.radius", value: 5 },
                coord("origin.z", 3),
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            const rows = prop.querySelectorAll(".fl-param");
            expect(rows.length).toBe(3);
            expect(rows[0].querySelectorAll(".fl-group-member").length).toBe(1);
            expect(rows[1].querySelector(".fl-group-members")).toBeNull();
            expect(rows[2].querySelectorAll(".fl-group-member").length).toBe(1);
        });

        test("a boolean member keeps its checkbox inside the group row", () => {
            const doc = createMockDocument();
            const node = featureNode([
                coord("origin.x", 1),
                { key: "flag", display: "common.coordY", value: true, group: ORIGIN },
            ]);
            const prop = new FeatureListProperty(doc, node);
            expandFirstRow(prop);

            const rows = prop.querySelectorAll(".fl-param");
            expect(rows.length).toBe(1);
            expect(rows[0].querySelectorAll("input.ip-box").length).toBe(1);
            expect(rows[0].querySelector("input[type='checkbox']")).not.toBeNull();
        });
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

    test("a pick the feature lost stands in for itself, in the row's own body", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "depth", display: "option.command.depth", value: 5 }], {
            warning: "Missing inputs: 1",
            missingInputs: [{ key: "profiles", refIndex: 1, label: "Missing input #2" }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        // A warning does not force expansion, so this is the visible outcome only after
        // the user opens the row — the placeholder is where the pick itself would be.
        const rows = Array.from(mustQuery<HTMLElement>(prop, ".fl-body").children);
        expect(rows.length).toBe(3);
        expect(rows[0].className).toBe("fl-warning-text");
        expect(rows[1].className).toBe("fl-missing-input");
        expect(rows[1].textContent).toBe("Missing input #2");
        expect(rows[2].className).toBe("fl-param");
    });

    test("the placeholder is the re-pick's door on a feature that can re-pick", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "depth", display: "option.command.depth", value: 5 }], {
            reselectable: true,
            warning: "Missing inputs: 1",
            missingInputs: [{ key: "profiles", refIndex: 1, label: "Missing input #2" }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        const row = mustQuery<HTMLElement>(prop, ".fl-missing-input");
        expect(row.className).toContain("fl-missing-input-action");

        // The action goes through the node's own contract method — the same door the row
        // menu's re-pick uses — so the panel does not need to know what a feature picks.
        (row as unknown as { _onclick: () => void })._onclick();
        expect(node.reselectShapes).toHaveBeenCalledWith("b1");
    });

    test("the placeholder is plain text on a feature that cannot re-pick", () => {
        const doc = createMockDocument();
        const node = featureNode([{ key: "depth", display: "option.command.depth", value: 5 }], {
            warning: "Missing inputs: 1",
            missingInputs: [{ key: "toolIds", refIndex: 0, label: "Missing input #1" }],
        });
        const prop = new FeatureListProperty(doc, node);
        expandFirstRow(prop);

        // Nothing to offer a re-pick (a boolean whose tool node was deleted): the slot is
        // still named, but the row must not look clickable.
        const row = mustQuery<HTMLElement>(prop, ".fl-missing-input");
        expect(row.className).not.toContain("fl-missing-input-action");
        expect(row.textContent).toBe("Missing input #1");
        expect(node.reselectShapes).not.toHaveBeenCalled();
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

    test("a row drag marks the list so rollback slots go inert until the drag clears", () => {
        const doc = createMockDocument();
        const items: FeatureItem[] = [
            { id: "f1", display: "command.feature.fuse", parameters: [] },
            { id: "f2", display: "command.feature.fuse", parameters: [] },
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
        expect(prop.classList.contains("fl-rows-dragging")).toBe(true);

        // The drop path clears it…
        rows[1].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
        expect(prop.classList.contains("fl-rows-dragging")).toBe(false);

        // …and so does a drag that ends without a drop.
        headers[0].dispatchEvent(new Event("dragstart"));
        expect(prop.classList.contains("fl-rows-dragging")).toBe(true);
        headers[0].dispatchEvent(new Event("dragend"));
        expect(prop.classList.contains("fl-rows-dragging")).toBe(false);
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

    describe("rollback bar", () => {
        /** A node with the rollback-bar contract: `bar` holds the position the panel last set. */
        function rollbackNode(
            itemCount: number,
            options?: { bar?: number; dependents?: Record<string, string[]>; suppressed?: string[] },
        ) {
            const items: FeatureItem[] = Array.from({ length: itemCount }, (_, i) => ({
                id: `f${i}`,
                display: "command.feature.fuse" as const,
                name: `Feature ${i}`,
                suppressed: options?.suppressed?.includes(`f${i}`) ? true : undefined,
                parameters: [],
            }));
            let bar = options?.bar;
            const node = {
                featureItems: () => items,
                setFeatureParameter: rs.fn(),
                setFeatureSuppressed: rs.fn(),
                moveFeature: rs.fn(),
                removeFeature: rs.fn(),
                setRollbackBar: rs.fn((index: number | undefined) => {
                    bar = index;
                }),
                featureDependents: rs.fn((id: string) => options?.dependents?.[id]),
            };
            Object.defineProperty(node, "rollbackBarIndex", { get: () => bar });
            return node as unknown as INode & IFeatureListNode;
        }

        function slots(prop: FeatureListProperty) {
            return prop.querySelectorAll<HTMLElement>(".fl-rollback-slot");
        }

        test("renders a slot between every two rows and past the ends", () => {
            const prop = new FeatureListProperty(createMockDocument(), rollbackNode(3));

            expect(slots(prop)).toHaveLength(4);
            expect(prop.querySelector(".fl-rollback-active")).toBeNull();
        });

        test("a node without the rollback contract renders no slots", () => {
            const prop = new FeatureListProperty(createMockDocument(), featureNode([]));

            expect(prop.querySelector(".fl-rollback-slot")).toBeNull();
        });

        test("the active slot renders the bar, and rows at and after it dim like suppressed ones", () => {
            const prop = new FeatureListProperty(createMockDocument(), rollbackNode(3, { bar: 1 }));

            const rows = prop.querySelectorAll(".fl-item");
            expect(rows[0].classList.contains("fl-suppressed")).toBe(false);
            expect(rows[1].classList.contains("fl-suppressed")).toBe(true);
            expect(rows[2].classList.contains("fl-suppressed")).toBe(true);
            expect(slots(prop)[1].classList.contains("fl-rollback-active")).toBe(true);
        });

        test("clicking a slot moves the bar there", () => {
            const node = rollbackNode(3);
            const prop = new FeatureListProperty(createMockDocument(), node);

            (slots(prop)[1] as unknown as { _onclick: (e: MouseEvent) => void })._onclick({
                stopPropagation: () => {},
            } as MouseEvent);

            expect(node.setRollbackBar).toHaveBeenCalledWith(1);
        });

        test("clicking the active slot releases the bar", () => {
            const node = rollbackNode(3, { bar: 1 });
            const prop = new FeatureListProperty(createMockDocument(), node);

            (slots(prop)[1] as unknown as { _onclick: (e: MouseEvent) => void })._onclick({
                stopPropagation: () => {},
            } as MouseEvent);

            expect(node.setRollbackBar).toHaveBeenCalledWith(undefined);
        });

        test("dropping the dragged bar on a slot moves it; past the last feature releases it", () => {
            const node = rollbackNode(3, { bar: 1 });
            const prop = new FeatureListProperty(createMockDocument(), node);

            slots(prop)[1].dispatchEvent(new Event("dragstart"));
            slots(prop)[2].dispatchEvent(new MouseEvent("dragover", { bubbles: true, cancelable: true }));
            expect(slots(prop)[2].classList.contains("fl-rollback-drop")).toBe(true);
            slots(prop)[2].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
            expect(node.setRollbackBar).toHaveBeenCalledWith(2);
            expect(slots(prop)[2].classList.contains("fl-rollback-drop")).toBe(false);

            slots(prop)[1].dispatchEvent(new Event("dragstart"));
            slots(prop)[3].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
            expect(node.setRollbackBar).toHaveBeenCalledWith(undefined);
        });

        test("dragging the bar itself does not mark the list as a row drag", () => {
            const prop = new FeatureListProperty(createMockDocument(), rollbackNode(3, { bar: 1 }));

            slots(prop)[1].dispatchEvent(new Event("dragstart"));
            expect(prop.classList.contains("fl-rows-dragging")).toBe(false);

            slots(prop)[1].dispatchEvent(new Event("dragend"));
            expect(prop.classList.contains("fl-rows-dragging")).toBe(false);
        });
    });

    describe("suppress by variable", () => {
        function variableNode(item?: Partial<FeatureItem>) {
            return {
                featureItems: () => [{ id: "b1", display: "command.feature.fuse", parameters: [], ...item }],
                setFeatureParameter: rs.fn(),
                setFeatureSuppressed: rs.fn(),
                setFeatureSuppressVariable: rs.fn(),
                moveFeature: rs.fn(),
                removeFeature: rs.fn(),
            } as unknown as INode & IFeatureListNode;
        }

        test("the menu offers the entry only when the node supports it", () => {
            const withSupport = new FeatureListProperty(createMockDocument(), variableNode());
            const menu = openMenu(withSupport);
            // rename, suppress, suppress-by-variable, delete
            expect(menu.querySelectorAll(".fl-menu-item").length).toBe(4);
            document.body.querySelectorAll(".fl-menu").forEach((x) => x.remove());

            const withoutSupport = new FeatureListProperty(createMockDocument(), featureNode([]));
            expect(openMenu(withoutSupport).querySelectorAll(".fl-menu-item").length).toBe(3);
        });

        test("confirming the dialog sets the variable and invert flag; an empty name clears", () => {
            const node = variableNode({ suppressVariable: "sup", suppressVariableInvert: true });
            const prop = new FeatureListProperty(createMockDocument(), node);
            const menu = openMenu(prop);

            clickMenuItem(menu, 2);
            expect(showDialogMock.calls.length).toBe(1);
            const content = showDialogMock.calls[0][1];
            const name = mustQuery<HTMLInputElement>(content, "input.ip-box");
            const invert = mustQuery<HTMLInputElement>(content, "input[type='checkbox']");
            expect(name.value).toBe("sup");
            expect(invert.checked).toBe(true);

            name.value = " gap ";
            invert.checked = false;
            showDialogMock.lastConfirm!();
            expect(node.setFeatureSuppressVariable).toHaveBeenCalledWith("b1", {
                variable: "gap",
                invert: undefined,
            });

            name.value = "   ";
            showDialogMock.lastConfirm!();
            expect(node.setFeatureSuppressVariable).toHaveBeenCalledWith("b1", undefined);
        });

        test("a variable-suppressed row gets the distinct style and a tooltip naming the variable", () => {
            const node = variableNode({ suppressVariable: "sup", suppressedByVariable: true });
            const prop = new FeatureListProperty(createMockDocument(), node);
            const row = mustQuery<HTMLElement>(prop, ".fl-item");

            expect(row.classList.contains("fl-variable-suppressed")).toBe(true);
            expect(row.classList.contains("fl-suppressed")).toBe(false);
            // The I18n stub returns the key with placeholders filled by the argument.
            expect(row.title).toBe("features.suppressedByVariablesup");
        });

        test("manual suppression wins the row style when both hold", () => {
            const node = variableNode({
                suppressVariable: "sup",
                suppressedByVariable: true,
                suppressed: true,
            });
            const prop = new FeatureListProperty(createMockDocument(), node);
            const row = mustQuery<HTMLElement>(prop, ".fl-item");

            expect(row.classList.contains("fl-suppressed")).toBe(true);
            expect(row.classList.contains("fl-variable-suppressed")).toBe(false);
            // The tooltip names the same source the style shows.
            expect(row.title).toBe("features.suppressedManually");
        });
    });

    describe("suppress cascade hint", () => {
        function cascadeNode(dependents?: Record<string, string[]>, suppressed?: string[]) {
            const items: FeatureItem[] = [
                {
                    id: "f0",
                    display: "command.feature.fuse",
                    name: "Boss",
                    suppressed: suppressed?.includes("f0") ? true : undefined,
                    parameters: [],
                },
                { id: "f1", display: "command.feature.fuse", name: "Cut", parameters: [] },
            ];
            return {
                featureItems: () => items,
                setFeatureParameter: rs.fn(),
                setFeatureSuppressed: rs.fn(),
                moveFeature: rs.fn(),
                removeFeature: rs.fn(),
                featureDependents: rs.fn((id: string) => dependents?.[id]),
            } as unknown as INode & IFeatureListNode;
        }

        test("suppressing a feature with dependents asks first, naming them", () => {
            const node = cascadeNode({ f0: ["f1"] });
            const prop = new FeatureListProperty(createMockDocument(), node);
            const menu = openMenu(prop);

            clickMenuItem(menu, 1);
            expect(showDialogMock.calls.length).toBe(1);
            expect(node.setFeatureSuppressed).not.toHaveBeenCalled();
            expect(showDialogMock.calls[0][1].textContent).toContain("Cut");

            showDialogMock.lastConfirm!();
            expect(node.setFeatureSuppressed).toHaveBeenCalledWith("f0", true);
        });

        test("suppressing without dependents applies immediately", () => {
            const node = cascadeNode({ f0: [] });
            const prop = new FeatureListProperty(createMockDocument(), node);
            const menu = openMenu(prop);

            clickMenuItem(menu, 1);

            expect(showDialogMock.calls.length).toBe(0);
            expect(node.setFeatureSuppressed).toHaveBeenCalledWith("f0", true);
        });

        test("unsuppressing never asks, even with dependents", () => {
            const node = cascadeNode({ f0: ["f1"] }, ["f0"]);
            const prop = new FeatureListProperty(createMockDocument(), node);
            const menu = openMenu(prop);

            clickMenuItem(menu, 1);

            expect(showDialogMock.calls.length).toBe(0);
            expect(node.setFeatureSuppressed).toHaveBeenCalledWith("f0", false);
        });
    });

    describe("dependency display", () => {
        function graphNode() {
            const items: FeatureItem[] = [
                { id: "f0", display: "command.feature.fuse", name: "Boss", parameters: [] },
                { id: "f1", display: "command.feature.fuse", name: "Cut", parameters: [] },
            ];
            return {
                featureItems: rs.fn((): FeatureItem[] => items),
                setFeatureParameter: rs.fn(),
                setFeatureSuppressed: rs.fn(),
                moveFeature: rs.fn(),
                removeFeature: rs.fn(),
                featureDependencies: rs.fn((id: string) => (id === "f1" ? ["f0"] : [])),
                featureDependents: rs.fn((id: string) => (id === "f0" ? ["f1"] : [])),
            } as unknown as INode & IFeatureListNode;
        }

        test("an expanded row lists depends-on and used-by names", () => {
            const prop = new FeatureListProperty(createMockDocument(), graphNode());
            const rows = prop.querySelectorAll(".fl-item");

            // f0 collapsed: nothing yet. Expand it — its body names the user ("Cut").
            (rows[0].querySelector(".fl-header") as unknown as { _onclick: () => void })._onclick();
            // The Localize labels render empty under the element mock; the dependency
            // row is identified by its clickable name spans.
            const body0 = prop.querySelectorAll(".fl-body")[0];
            const names0 = [...body0.querySelectorAll(".fl-reference")].map((x) => x.textContent);
            expect(names0).toEqual(["Cut"]);

            const rows1 = prop.querySelectorAll(".fl-item");
            (rows1[1].querySelector(".fl-header") as unknown as { _onclick: () => void })._onclick();
            const body1 = prop.querySelectorAll(".fl-body")[1];
            const names1 = [...body1.querySelectorAll(".fl-reference")].map((x) => x.textContent);
            expect(names1).toEqual(["Boss"]);
        });

        test("clicking a dependency name expands the target row", () => {
            const prop = new FeatureListProperty(createMockDocument(), graphNode());
            (prop.querySelector(".fl-header") as unknown as { _onclick: () => void })._onclick();
            const link = mustQuery<HTMLElement>(prop, ".fl-body .fl-reference");
            (link as unknown as { _onclick: () => void })._onclick();

            // The jump expanded "Cut" (f1): both rows now show a body.
            expect(prop.querySelectorAll(".fl-body").length).toBe(2);
        });

        test("no dependency lines when the lists are empty", () => {
            const node = graphNode();
            (node as { featureDependencies: (id: string) => string[] }).featureDependencies = () => [];
            (node as { featureDependents: (id: string) => string[] }).featureDependents = () => [];
            const prop = new FeatureListProperty(createMockDocument(), node);
            (prop.querySelector(".fl-header") as unknown as { _onclick: () => void })._onclick();

            const body = mustQuery<HTMLElement>(prop, ".fl-body");
            expect(body.querySelectorAll(".fl-reference").length).toBe(0);
        });

        test("dependency rows reuse the render's item list instead of re-reading it per row", () => {
            const node = graphNode();
            const prop = new FeatureListProperty(createMockDocument(), node);
            const rows = prop.querySelectorAll(".fl-item");
            (rows[0].querySelector(".fl-header") as unknown as { _onclick: () => void })._onclick();
            (
                prop.querySelectorAll(".fl-item")[1].querySelector(".fl-header") as unknown as {
                    _onclick: () => void;
                }
            )._onclick();

            // Three renders ran (initial + one per expansion), each fetching the items
            // once; the dependency rows read the render's own list.
            expect(node.featureItems).toHaveBeenCalledTimes(3);
        });
    });
});
