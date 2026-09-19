// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys, INode } from "@chili3d/core";
// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument } from "@chili3d/core/test-utils";
import { afterEach, describe, expect, rs, test } from "@rstest/core";

// CSS modules under test
rs.mock("../src/project/tree/treeItem.module.css", () => ({
    name: "ti-name",
    icon: "ti-icon",
    "parent-hidden": "ti-parent-hidden",
    hidden: "ti-hidden",
    warning: "ti-warning",
    typeIcon: "ti-type-icon",
}));

rs.mock("../src/project/tree/treeModel.module.css", () => ({
    panel: "tm-panel",
}));

// Mock core: no-op Binding, immediate Transaction
import "./_helpers/mockCoreBinding";

// Mock element helpers
import "./_helpers/mockElement";

import { FolderNode, I18n } from "@chili3d/core";
import { TreeModel } from "../src/project/tree/treeModel";

type PropertyHandler = (property: string, model: unknown) => void;

class MockNode {
    name = "mock-node";
    visible = true;
    parentVisible: boolean | undefined = true;
    parent: MockNode | undefined;
    /** Present only on warning-capable nodes (the `isNodeWarning` guard needs both). */
    warningCount?: number;
    warningTooltip?: string;
    /** Present only on nodes opting into the `INodeIcon` contract. */
    icon?: string;
    private handlers = new Set<PropertyHandler>();

    onPropertyChanged(handler: PropertyHandler) {
        this.handlers.add(handler);
    }
    removePropertyChanged(handler: PropertyHandler) {
        this.handlers.delete(handler);
    }
    emit(property: string) {
        this.handlers.forEach((h) => h(property, this));
    }
    handlerCount() {
        return this.handlers.size;
    }
}

function makeDoc() {
    const doc = createMockDocument();
    doc.visual.update = rs.fn(() => {});
    return doc;
}

const fakeEvent = { stopPropagation: () => {} } as MouseEvent;

describe("TreeModel (TreeItem)", () => {
    let node: MockNode;
    let doc: ReturnType<typeof makeDoc>;

    afterEach(() => {
        document.body.innerHTML = "";
    });

    function createItem(overrides: Partial<MockNode> = {}) {
        node = new MockNode();
        Object.assign(node, overrides);
        doc = makeDoc();
        return new TreeModel(doc, node as unknown as INode);
    }

    describe("rendering", () => {
        test("should render name label and visible icon", () => {
            const item = createItem();
            expect(item.name.tagName).toBe("LABEL");
            expect(item.name.className).toBe("ti-name");
            expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye");
            expect(item.visibleIcon.classList.contains("ti-icon")).toBe(true);
        });

        test("should append name and visible icon to itself with panel class", () => {
            const item = createItem();
            expect(item.classList.contains("tm-panel")).toBe(true);
            expect(item.children[0]).toBe(item.name);
            expect(item.children[1]).toBe(item.visibleIcon);
        });

        test("should lead with the type icon a node declares", () => {
            const item = createItem({ icon: "icon-sketchNew" });
            const icon = item.children[0] as SVGSVGElement;
            expect(icon.classList.contains("ti-type-icon")).toBe(true);
            expect(icon.getAttribute("icon")).toBe("icon-sketchNew");
            // Ahead of the name, not after it.
            expect(item.children[1]).toBe(item.name);
        });

        test("should render no type icon for a node that declares none", () => {
            const item = createItem();
            expect(item.children[0]).toBe(item.name);
        });

        test("should be draggable", () => {
            const item = createItem();
            expect(item.draggable).toBe(true);
        });

        test("should use eye-slash icon when node is invisible", () => {
            const item = createItem({ visible: false });
            expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye-slash");
        });

        test.each([
            { parentVisible: true, hasClass: false },
            { parentVisible: false, hasClass: true },
            { parentVisible: undefined, hasClass: true },
        ])("should set parent-hidden class when parentVisible=$parentVisible", ({
            parentVisible,
            hasClass,
        }) => {
            const item = createItem({ parentVisible });
            expect(item.visibleIcon.classList.contains("ti-parent-hidden")).toBe(hasClass);
        });

        test("mainElement should return itself", () => {
            const item = createItem();
            expect(item.mainElement()).toBe(item);
        });

        test("should hide the visible icon for children of a non-folder parent (consumed tools)", () => {
            const item = createItem({ parent: new MockNode() });
            expect(item.visibleIcon.classList.contains("ti-hidden")).toBe(true);
        });

        test("should show the visible icon for children of a folder", () => {
            const folder = new MockNode();
            Object.setPrototypeOf(folder, FolderNode.prototype);
            const item = createItem({ parent: folder });
            expect(item.visibleIcon.classList.contains("ti-hidden")).toBe(false);
        });

        test("refreshVisibleIcon follows parent changes", () => {
            const item = createItem();
            expect(item.visibleIcon.classList.contains("ti-hidden")).toBe(false);

            node.parent = new MockNode();
            item.refreshVisibleIcon();
            expect(item.visibleIcon.classList.contains("ti-hidden")).toBe(true);

            node.parent = undefined;
            item.refreshVisibleIcon();
            expect(item.visibleIcon.classList.contains("ti-hidden")).toBe(false);
        });
    });

    describe("style helpers", () => {
        test("addStyle/removeStyle should toggle classes on mainElement", () => {
            const item = createItem();
            item.addStyle("extra-style");
            expect(item.classList.contains("extra-style")).toBe(true);
            item.removeStyle("extra-style");
            expect(item.classList.contains("extra-style")).toBe(false);
        });
    });

    describe("visible icon click", () => {
        test("should toggle node visibility and update visual", () => {
            const item = createItem({ visible: true });
            (item.visibleIcon as unknown as { _onclick: (e: MouseEvent) => void })._onclick(fakeEvent);
            expect(node.visible).toBe(false);
            expect(doc.visual.update).toHaveBeenCalledTimes(1);
        });

        test("should toggle invisible node back to visible", () => {
            const item = createItem({ visible: false });
            (item.visibleIcon as unknown as { _onclick: (e: MouseEvent) => void })._onclick(fakeEvent);
            expect(node.visible).toBe(true);
        });
    });

    describe("property changed", () => {
        test("should register handler on connect and unregister on disconnect", () => {
            const item = createItem();
            expect(node.handlerCount()).toBe(0);
            document.body.appendChild(item);
            expect(node.handlerCount()).toBe(1);
            item.remove();
            expect(node.handlerCount()).toBe(0);
        });

        test("should swap visible icon when node visible property changes", () => {
            const item = createItem({ visible: true });
            document.body.appendChild(item);

            node.visible = false;
            node.emit("visible");
            expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye-slash");

            node.visible = true;
            node.emit("visible");
            expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye");
        });

        test("should update parent-hidden style when parentVisible property changes", () => {
            const item = createItem({ parentVisible: true });
            document.body.appendChild(item);
            expect(item.visibleIcon.classList.contains("ti-parent-hidden")).toBe(false);

            node.parentVisible = false;
            node.emit("parentVisible");
            expect(item.visibleIcon.classList.contains("ti-parent-hidden")).toBe(true);
        });

        test("should not react to property changes after dispose", () => {
            const item = createItem({ visible: true });
            document.body.appendChild(item);
            item.dispose();

            node.visible = false;
            node.emit("visible");
            expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye");
        });
    });

    describe("warning badge", () => {
        test("should render a hidden badge after the visible icon for a node without warnings", () => {
            const item = createItem();
            expect(item.warningBadge.textContent).toBe("!");
            expect(item.warningBadge.classList.contains("ti-warning")).toBe(true);
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(true);
            expect(item.children[2]).toBe(item.warningBadge);
        });

        test("should show the badge with a count tooltip when the node reports warnings", () => {
            const item = createItem({ warningCount: 2, warningTooltip: "sketch.externalRefsLost{0}" });
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(false);
            expect(item.warningBadge.title).toBe(I18n.translate("sketch.externalRefsLost{0}" as I18nKeys, 2));
        });

        test("a warning count without a tooltip key fails the guard and stays hidden", () => {
            const item = createItem({ warningCount: 2 });
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(true);
        });

        test("should toggle the badge and refresh the tooltip on warningCount property changes", () => {
            const item = createItem({ warningCount: 0, warningTooltip: "sketch.externalRefsLost{0}" });
            document.body.appendChild(item);
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(true);

            node.warningCount = 1;
            node.emit("warningCount");
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(false);
            expect(item.warningBadge.title).toBe(I18n.translate("sketch.externalRefsLost{0}" as I18nKeys, 1));

            node.warningCount = 3;
            node.emit("warningCount");
            expect(item.warningBadge.title).toBe(I18n.translate("sketch.externalRefsLost{0}" as I18nKeys, 3));

            node.warningCount = 0;
            node.emit("warningCount");
            expect(item.warningBadge.classList.contains("ti-hidden")).toBe(true);
        });
    });
});
