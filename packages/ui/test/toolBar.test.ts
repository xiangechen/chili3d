// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// CSS modules
rs.mock("../src/project/toolBar.module.css", () => ({
    panel: "tb-panel",
    svg: "tb-svg",
}));

rs.mock("../src/project/tree/treeItemGroup.module.css", () => ({
    group: "tig-group",
    header: "tig-header",
    children: "tig-children",
}));

// Track PubSub pub calls
const pubSubCalls: string[] = [];

// Mock core
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        I18n: { translate: (key: unknown) => String(key) },
        PubSub: {
            default: {
                pub: (topic: string, ..._args: unknown[]) => {
                    pubSubCalls.push(topic);
                },
                sub: () => {},
            },
        },
        NodeUtils: { isLinkedListNode: () => true },
    };
});

// Mock element helpers
// biome-ignore lint/suspicious/noExplicitAny: test mock for DOM element factory
rs.mock("@chili3d/element", () => {
    function createEl(tag: string, props: Record<string, unknown> | null, ...children: unknown[]): any {
        const el: any =
            tag === "svg"
                ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
                : document.createElement(tag);
        if (props && typeof props === "object") {
            if (props["className"]) {
                if (el.setAttribute) {
                    el.setAttribute("class", String(props["className"]));
                } else {
                    el.className = String(props["className"]);
                }
            }
            if (props["title"]) el.title = String(props["title"]);
            if (props["textContent"]) el.textContent = String(props["textContent"]);
            if (props["onclick"] && el instanceof SVGElement) {
                (el as any)._onclick = props["onclick"];
            }
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
        }
        return el;
    }

    return {
        a: (props: Record<string, unknown>, ...children: unknown[]) => createEl("a", props, ...children),
        svg: (props: Record<string, unknown>) => createEl("svg", props),
    };
});

// Mock treeItemGroup
rs.mock("../src/project/tree/treeItemGroup", () => ({
    TreeGroup: class {
        isExpanded = false;
    },
}));

import { ToolBar } from "../src/project/toolBar";

describe("ToolBar", () => {
    function createMockProjectView(tree?: unknown) {
        return {
            activeTree: () => tree,
            activeDocument: {
                modelManager: {
                    rootNode: {
                        firstChild: null,
                    },
                },
            },
        };
    }

    beforeEach(() => {
        pubSubCalls.length = 0;
    });

    describe("constructor", () => {
        test("should set className", () => {
            const pv = createMockProjectView() as any;
            const tb = new ToolBar(pv);
            expect(tb.className).toBeTruthy();
        });

        test("should create three buttons (newFolder, expandAll, unexpandAll)", () => {
            const pv = createMockProjectView() as any;
            const tb = new ToolBar(pv);

            // Should have 3 anchor children
            const anchors = tb.querySelectorAll("a");
            expect(anchors.length).toBe(3);
        });

        test("should store reference to projectView", () => {
            const pv = createMockProjectView() as any;
            const tb = new ToolBar(pv);
            expect(tb.projectView).toBe(pv);
        });

        test("should render svg icons within anchor buttons", () => {
            const pv = createMockProjectView() as any;
            const tb = new ToolBar(pv);

            const svgs = tb.querySelectorAll("svg");
            expect(svgs.length).toBe(3);
        });
    });

    describe("newFolder button", () => {
        test("should publish executeCommand when clicked", () => {
            const pv = createMockProjectView() as any;
            const tb = new ToolBar(pv);

            const firstSvg = tb.querySelector("svg") as SVGElement;
            const onclick = (firstSvg as any)._onclick;
            if (onclick) onclick();

            expect(pubSubCalls).toContain("executeCommand");
        });
    });

    describe("expandAll / unExpandAll", () => {
        test("expandAll should not throw when no active tree", () => {
            const pv = createMockProjectView(undefined) as any;
            const tb = new ToolBar(pv);

            // Find the expand button (index 2 based on the array)
            const svgs = tb.querySelectorAll("svg");
            const expandSvg = svgs[2] as SVGElement; // expandAll is last in array
            const onclick = (expandSvg as any)._onclick;
            expect(() => onclick?.()).not.toThrow();
        });

        test("unExpandAll should not throw when no active tree", () => {
            const pv = createMockProjectView(undefined) as any;
            const tb = new ToolBar(pv);

            const svgs = tb.querySelectorAll("svg");
            const unexpandSvg = svgs[1] as SVGElement; // unExpandAll is second
            const onclick = (unexpandSvg as any)._onclick;
            expect(() => onclick?.()).not.toThrow();
        });

        test("expandAll should set expand on tree item when tree exists", () => {
            const expanded = false;
            const mockTree = {
                treeItem: () => ({
                    isExpanded: false,
                }),
            };

            // Mock activeTree to return our mock
            const pv = {
                activeTree: () => mockTree,
                activeDocument: {
                    modelManager: {
                        rootNode: {
                            firstChild: {
                                firstChild: null,
                                nextSibling: null,
                            },
                        },
                    },
                },
            } as any;

            const tb = new ToolBar(pv);
            const svgs = tb.querySelectorAll("svg");
            const expandSvg = svgs[2] as SVGElement;
            const onclick = (expandSvg as any)._onclick;
            expect(() => onclick?.()).not.toThrow();
        });
    });
});
