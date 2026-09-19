// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { INodeLinkedList } from "@chili3d/core";
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

rs.mock("../src/project/tree/treeItemGroup.module.css", () => ({
    container: "tig-container",
    left16px: "tig-left16",
    row: "tig-row",
    header: "tig-header",
    expanderIcon: "tig-expander",
    toolExpanderIcon: "tig-tool-expander",
    hide: "tig-hide",
}));

// Mock core: no-op Binding, immediate Transaction
import "./_helpers/mockCoreBinding";

// Mock element helpers
import "./_helpers/mockElement";

import { FolderNode } from "@chili3d/core";
import type { TreeItem } from "../src/project/tree/treeItem";
import { TreeGroup } from "../src/project/tree/treeItemGroup";
import { TreeModel } from "../src/project/tree/treeModel";

rs.mock("../src/project/tree/treeModel.module.css", () => ({
    panel: "tm-panel",
}));

class MockGroupNode {
    name = "group-node";
    visible = true;
    parentVisible: boolean | undefined = true;
    parent: unknown;
    firstChild: unknown;
    nextSibling: unknown;
    /** Present only on nodes opting into the `INodeIcon` contract. */
    icon?: string;
    onPropertyChanged(_handler: unknown) {}
    removePropertyChanged(_handler: unknown) {}
}

function makeDoc() {
    return createMockDocument();
}

const fakeEvent = { stopPropagation: () => {} } as MouseEvent;

// Happy-DOM's Element.prototype.append routes through the overridable appendChild,
// which conflicts with TreeGroup's appendChild override: the constructor appends the
// container that already holds `items`, and the override would re-insert it into
// `items` itself (a cycle real browsers never hit). Patch to the native
// implementation during construction only.
function createGroup(node = new MockGroupNode()) {
    const override = TreeGroup.prototype.appendChild;
    TreeGroup.prototype.appendChild = HTMLElement.prototype.appendChild;
    try {
        const group = new TreeGroup(makeDoc(), node as unknown as INodeLinkedList);
        return { node, group };
    } finally {
        TreeGroup.prototype.appendChild = override;
    }
}

describe("TreeGroup", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("rendering", () => {
        test("should render header with expander icon, name and visible icon", () => {
            const { group } = createGroup();
            expect(group.header.className).toBe("tig-row tig-header");
            expect(group.header.children[0]).toBe(group.expanderIcon);
            expect(group.header.children[1]).toBe(group.name);
            expect(group.header.children[2]).toBe(group.visibleIcon);
        });

        test("should place the group's type icon between the expander and the name", () => {
            const node = new MockGroupNode();
            node.icon = "icon-folder";
            const { group } = createGroup(node);
            expect(group.header.children[0]).toBe(group.expanderIcon);
            const icon = group.header.children[1] as SVGSVGElement;
            expect(icon.classList.contains("ti-type-icon")).toBe(true);
            expect(icon.getAttribute("icon")).toBe("icon-folder");
            expect(group.header.children[2]).toBe(group.name);
        });

        test("should badge the header when the group node reports warnings", () => {
            const node = new MockGroupNode();
            const { group } = createGroup(node);
            expect(group.header.children[3]).toBe(group.warningBadge);
            expect(group.warningBadge.classList.contains("ti-hidden")).toBe(true);

            (node as any).warningCount = 1;
            (node as any).warningTooltip = "sketch.externalRefsLost{0}";
            const warned = createGroup(node);
            expect(warned.group.warningBadge.classList.contains("ti-hidden")).toBe(false);
        });

        test("should render items container with indentation classes", () => {
            const { group } = createGroup();
            expect(group.items.className).toBe("tig-container tig-left16");
        });

        test("should start expanded with angle-down icon", () => {
            const { group } = createGroup();
            expect(group.isExpanded).toBe(true);
            expect(group.expanderIcon.getAttribute("icon")).toBe("icon-angle-down");
            expect(group.items.classList.contains("tig-hide")).toBe(false);
        });

        test("mainElement should return header", () => {
            const { group } = createGroup();
            expect(group.mainElement()).toBe(group.header);
        });

        test("should use the muted tool expander style for non-folder groups", () => {
            const { group } = createGroup();
            expect(group.expanderIcon.getAttribute("class")).toContain("tig-expander");
            expect(group.expanderIcon.getAttribute("class")).toContain("tig-tool-expander");
        });

        test("should keep the plain expander style for folder groups", () => {
            const node = new MockGroupNode();
            Object.setPrototypeOf(node, FolderNode.prototype);
            const { group } = createGroup(node);
            expect(group.expanderIcon.getAttribute("class")).toBe("tig-expander");
        });
    });

    describe("expand / collapse", () => {
        test("should collapse on expander icon click", () => {
            const { group } = createGroup();
            (group.expanderIcon as unknown as { _onclick: (e: MouseEvent) => void })._onclick(fakeEvent);
            expect(group.isExpanded).toBe(false);
            expect(group.expanderIcon.getAttribute("icon")).toBe("icon-angle-right");
            expect(group.items.classList.contains("tig-hide")).toBe(true);
        });

        test("should expand again on second click", () => {
            const { group } = createGroup();
            const onclick = (group.expanderIcon as unknown as { _onclick: (e: MouseEvent) => void })._onclick;
            onclick(fakeEvent);
            onclick(fakeEvent);
            expect(group.isExpanded).toBe(true);
            expect(group.expanderIcon.getAttribute("icon")).toBe("icon-angle-down");
            expect(group.items.classList.contains("tig-hide")).toBe(false);
        });

        test("setting isExpanded should swap icon and toggle hide class", () => {
            const { group } = createGroup();
            group.isExpanded = false;
            expect(group.expanderIcon.getAttribute("icon")).toBe("icon-angle-right");
            expect(group.items.classList.contains("tig-hide")).toBe(true);

            group.isExpanded = true;
            expect(group.expanderIcon.getAttribute("icon")).toBe("icon-angle-down");
            expect(group.items.classList.contains("tig-hide")).toBe(false);
        });
    });

    describe("expander visibility", () => {
        test("should show the expander for an empty folder", () => {
            const node = new MockGroupNode();
            Object.setPrototypeOf(node, FolderNode.prototype);
            const { group } = createGroup(node);
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(false);
        });

        test("should hide the expander for a childless non-folder group", () => {
            const { group } = createGroup();
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(true);
        });

        test("should show the expander for a non-folder group with children", () => {
            const node = new MockGroupNode();
            node.firstChild = new MockGroupNode();
            const { group } = createGroup(node);
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(false);
        });

        test("refreshExpander should follow child changes", () => {
            const { node, group } = createGroup();
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(true);

            node.firstChild = new MockGroupNode();
            group.refreshExpander();
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(false);

            node.firstChild = undefined;
            group.refreshExpander();
            expect(group.expanderIcon.classList.contains("tig-hide")).toBe(true);
        });
    });

    describe("child delegation", () => {
        function createModelItem(name: string) {
            const node = new MockGroupNode();
            node.name = name;
            return new TreeModel(makeDoc(), node as unknown as INodeLinkedList);
        }

        test("appendChild should delegate to items container", () => {
            const { group } = createGroup();
            const child = createModelItem("child");
            group.appendChild(child as unknown as Node);
            expect(child.parentNode).toBe(group.items);
            expect(Array.from(group.children)).not.toContain(child);
        });

        test("append should delegate to items container", () => {
            const { group } = createGroup();
            const child = createModelItem("child");
            group.append(child as unknown as Node);
            expect(child.parentNode).toBe(group.items);
        });

        test("removeChild should remove delegated child from items container", () => {
            const { group } = createGroup();
            const child = createModelItem("child");
            group.appendChild(child as unknown as Node);
            group.removeChild(child as unknown as Node);
            expect(child.parentNode).toBeNull();
        });

        test("addItem should append items and return the group for chaining", () => {
            const { group } = createGroup();
            const child = createModelItem("child");
            const result = group.addItem(child as unknown as Node);
            expect(result).toBe(group);
            expect(child.parentNode).toBe(group.items);
        });

        test("insertAfter with null reference should insert at the beginning", () => {
            const { group } = createGroup();
            const first = createModelItem("first");
            const second = createModelItem("second");
            group.appendChild(first as unknown as Node);
            group.insertAfter(second, null);
            expect(group.items.children[0]).toBe(second);
            expect(group.items.children[1]).toBe(first);
        });

        test("insertAfter with reference should insert after the reference item", () => {
            const { group } = createGroup();
            const first = createModelItem("first");
            const middle = createModelItem("middle");
            const last = createModelItem("last");
            group.appendChild(first as unknown as Node);
            group.appendChild(last as unknown as Node);
            group.insertAfter(middle, first);
            expect(group.items.children[0]).toBe(first);
            expect(group.items.children[1]).toBe(middle);
            expect(group.items.children[2]).toBe(last);
        });
    });
});
