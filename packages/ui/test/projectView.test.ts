// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// CSS modules
rs.mock("../src/project/projectView.module.css", () => ({
    root: "pj-root",
    headerPanel: "pj-header-panel",
    header: "pj-header",
    itemsPanel: "pj-items-panel",
}));

rs.mock("../src/project/toolBar.module.css", () => ({
    panel: "tb-panel",
    svg: "tb-svg",
}));

rs.mock("../src/project/tree/tree.module.css", () => ({
    panel: "tree-panel",
    current: "tree-current",
}));

rs.mock("../src/project/tree/treeItem.module.css", () => ({
    item: "ti-item",
    icon: "ti-icon",
    label: "ti-label",
}));

rs.mock("../src/project/tree/treeItemGroup.module.css", () => ({
    group: "tig-group",
    header: "tig-header",
    children: "tig-children",
}));

rs.mock("../src/project/tree/treeModel.module.css", () => ({
    model: "tm-model",
}));

// Track PubSub subscriptions
// biome-ignore lint/suspicious/noExplicitAny: test pubsub helper
const pubSubSubscriptions = new Map<string, (...args: any[]) => void>();

// Mock core
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        Localize: class {
            private key: unknown;
            constructor(key: unknown) {
                this.key = key;
            }
            toString() {
                return String(this.key);
            }
        },
        I18n: { translate: (key: unknown) => String(key) },
        PubSub: {
            default: {
                // biome-ignore lint/suspicious/noExplicitAny: test mock
                sub: (topic: string, handler: (...args: any[]) => void) => {
                    pubSubSubscriptions.set(topic, handler);
                },
                pub: () => {},
            },
        },
        Binding: class {
            constructor(_v: unknown, _p?: string, _c?: unknown) {}
        },
        Transaction: { execute: (_d: unknown, _s: string, fn: () => void) => fn() },
        NodeUtils: {
            isLinkedListNode: () => false,
        },
    };
});

// Mock element helpers — all models defined inline to avoid hoisting issues
rs.mock("@chili3d/element", () => {
    function createEl(
        tag: string,
        props: Record<string, unknown> | null,
        ...children: unknown[]
    ): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props["className"]) el.className = String(props["className"]);
            if (props["title"]) el.title = String(props["title"]);
            if (props["textContent"] && typeof props["textContent"] !== "object") {
                el.textContent = String(props["textContent"]);
            }
            if (props["onclick"]) (el as unknown as Record<string, unknown>)["_onclick"] = props["onclick"];
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
            else if (typeof c === "string") el.appendChild(document.createTextNode(c));
        }
        return el;
    }

    return {
        div: (props: Record<string, unknown> | null, ...children: unknown[]) =>
            createEl("div", props, ...children),
        span: (props: Record<string, unknown>) => createEl("span", props),
        a: (props: Record<string, unknown>, ...children: unknown[]) => createEl("a", props, ...children),
        svg: (props: Record<string, unknown>) => {
            const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            if (props) {
                if (props["className"]) el.setAttribute("class", String(props["className"]));
                if (props["icon"]) el.setAttribute("icon", String(props["icon"]));
                if (props["onclick"])
                    (el as unknown as Record<string, unknown>)["_onclick"] = props["onclick"];
            }
            return el;
        },
    };
});

// Mock tree/index.ts — use plain classes (not extending HTMLElement) since Happy-DOM
// forbids `new` on custom elements registered via customElements.define().
rs.mock("../src/project/tree/index", () => {
    class TreeItem {
        _doc: unknown;
        constructor(doc: unknown) {
            this._doc = doc;
        }
        remove() {}
        dispose() {}
    }

    class TreeModel {
        constructor() {}
    }

    class Tree {
        _doc: unknown;
        disposed = false;
        removed = false;
        constructor(doc: unknown) {
            this._doc = doc;
        }
        remove() {
            this.removed = true;
        }
        dispose() {
            this.disposed = true;
        }
        treeItem(_node: unknown) {
            return undefined;
        }
    }

    return { Tree, TreeItem, TreeModel };
});

// treeItemGroup is imported by toolBar.ts — define inline
rs.mock("../src/project/tree/treeItemGroup", () => ({
    TreeGroup: class {
        isExpanded = false;
    },
}));

import { ProjectView } from "../src/project/projectView";

describe("ProjectView", () => {
    beforeEach(() => {
        pubSubSubscriptions.clear();
    });

    describe("constructor", () => {
        test("should apply provided className and root style", () => {
            const pv = new ProjectView({ className: "test-panel" });
            expect(pv.className).toContain("test-panel");
        });

        test("should subscribe to activeViewChanged", () => {
            new ProjectView({ className: "test-panel" });
            expect(pubSubSubscriptions.has("activeViewChanged")).toBe(true);
        });

        test("should subscribe to documentClosed", () => {
            new ProjectView({ className: "test-panel" });
            expect(pubSubSubscriptions.has("documentClosed")).toBe(true);
        });

        test("should render header and items panel", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const toolbar = pv.querySelector("chili-toolbar");
            expect(toolbar).not.toBeNull();
        });
    });

    describe("activeTree", () => {
        test("should return undefined when no active document", () => {
            const pv = new ProjectView({ className: "test-panel" });
            expect(pv.activeTree()).toBeUndefined();
        });
    });

    describe("activeDocument", () => {
        test("should return undefined initially", () => {
            const pv = new ProjectView({ className: "test-panel" });
            expect(pv.activeDocument).toBeUndefined();
        });
    });

    function makeDoc() {
        return {
            modelManager: {
                rootNode: { firstChild: null },
                addNodeObserver: () => {},
                onPropertyChanged: () => {},
                removeNodeObserver: () => {},
                removePropertyChanged: () => {},
            },
            selection: {
                onNodeChanged: { sub: () => {}, remove: () => {} },
            },
        };
    }

    describe("handleActiveViewChanged", () => {
        test("should set activeDocument and create tree when view is provided", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            handler({ document: doc });

            expect(pv.activeDocument).toBe(doc);
            expect(pv.activeTree()).toBeDefined();
        });

        test("should handle undefined view without error", () => {
            new ProjectView({ className: "test-panel" });
            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            expect(() => handler(undefined)).not.toThrow();
        });

        test("should not recreate tree for same document", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            handler({ document: doc });
            const tree1 = pv.activeTree();
            handler({ document: doc });
            const tree2 = pv.activeTree();

            expect(tree1).toBe(tree2);
        });

        test("should switch active tree for different document", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc1 = makeDoc();
            const doc2 = makeDoc();

            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            handler({ document: doc1 });
            handler({ document: doc2 });

            expect(pv.activeDocument).toBe(doc2);
        });
    });

    describe("handleDocumentClosed", () => {
        test("should clean up when document closed", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const activeHandler = pubSubSubscriptions.get("activeViewChanged")!;
            activeHandler({ document: doc });
            expect(pv.activeTree()).toBeDefined();

            const closeHandler = pubSubSubscriptions.get("documentClosed")!;
            closeHandler(doc);

            expect(pv.activeTree()).toBeUndefined();
        });

        test("should handle document close for unknown document silently", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const closeHandler = pubSubSubscriptions.get("documentClosed")!;
            expect(() => closeHandler({})).not.toThrow();
        });
    });
});
