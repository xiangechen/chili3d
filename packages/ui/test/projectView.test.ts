// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// CSS modules — shared ones via helper, file-specific ones inline
import "./_helpers/cssMocks";

rs.mock("../src/project/projectView.module.css", () => ({
    root: "pj-root",
    headerPanel: "pj-header-panel",
    header: "pj-header",
    itemsPanel: "pj-items-panel",
}));

rs.mock("../src/project/tree/tree.module.css", () => ({
    panel: "tree-panel",
    current: "tree-current",
}));

rs.mock("../src/project/tree/treeItem.module.css", () => ({
    item: "ti-item",
    icon: "ti-icon",
    label: "ti-label",
    typeIcon: "ti-type-icon",
}));

rs.mock("../src/project/tree/treeModel.module.css", () => ({
    model: "tm-model",
}));

// Track PubSub subscriptions via the shared recorder
const pubSubRecorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./_helpers/coreMocks");
    return createPubSubRecorder();
});

// Mock core
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { I18nMock, LocalizeMock, BindingMock, TransactionMock } = rs.hoisted(() =>
        require("./_helpers/coreMocks"),
    );
    return {
        ...actual,
        Localize: LocalizeMock,
        I18n: I18nMock,
        PubSub: pubSubRecorder.stub,
        Binding: BindingMock,
        Transaction: TransactionMock,
        NodeUtils: {
            isLinkedListNode: () => false,
        },
    };
});

// Mock element helpers
import "./_helpers/mockElement";

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
import { Tree } from "../src/project/tree";

describe("ProjectView", () => {
    beforeEach(() => {
        pubSubRecorder.reset();
    });

    describe("constructor", () => {
        test("should apply provided className and root style", () => {
            const pv = new ProjectView({ className: "test-panel" });
            expect(pv.className).toContain("test-panel");
        });

        test("should subscribe to activeViewChanged", () => {
            new ProjectView({ className: "test-panel" });
            expect(pubSubRecorder.handlers.has("activeViewChanged")).toBe(true);
        });

        test("should subscribe to documentClosed", () => {
            new ProjectView({ className: "test-panel" });
            expect(pubSubRecorder.handlers.has("documentClosed")).toBe(true);
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

            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();
            handler!({ document: doc });

            expect(pv.activeDocument).toBe(doc);
            expect(pv.activeTree()).toBeInstanceOf(Tree);
        });

        test("should ignore an undefined view", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();

            handler!(undefined);

            expect(pv.activeDocument).toBeUndefined();
            expect(pv.activeTree()).toBeUndefined();
        });

        test("should not recreate tree for same document", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();
            handler!({ document: doc });
            const tree1 = pv.activeTree();
            handler!({ document: doc });
            const tree2 = pv.activeTree();

            expect(tree1).toBe(tree2);
        });

        test("should switch active tree for different document", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc1 = makeDoc();
            const doc2 = makeDoc();

            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();
            handler!({ document: doc1 });
            handler!({ document: doc2 });

            expect(pv.activeDocument).toBe(doc2);
        });
    });

    describe("handleDocumentClosed", () => {
        test("should clean up when document closed", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const activeHandler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(activeHandler).toBeDefined();
            activeHandler!({ document: doc });
            expect(pv.activeTree()).toBeInstanceOf(Tree);

            const closeHandler = pubSubRecorder.handlers.get("documentClosed");
            expect(closeHandler).toBeDefined();
            closeHandler!(doc);

            expect(pv.activeTree()).toBeUndefined();
        });

        test("should leave existing trees untouched when an unknown document closes", () => {
            const pv = new ProjectView({ className: "test-panel" });
            const doc = makeDoc();

            const activeHandler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(activeHandler).toBeDefined();
            activeHandler!({ document: doc });
            const tree = pv.activeTree();
            expect(tree).toBeInstanceOf(Tree);

            const closeHandler = pubSubRecorder.handlers.get("documentClosed");
            expect(closeHandler).toBeDefined();
            closeHandler!({});

            expect(pv.activeTree()).toBe(tree);
        });
    });
});
