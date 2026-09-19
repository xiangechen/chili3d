// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode, INodeLinkedList, NodeRecord } from "@chili3d/core";
// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument, type MockDocumentOverrides } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";

// CSS modules under test
rs.mock("../src/project/tree/tree.module.css", () => ({
    panel: "tree-panel",
    selected: "tree-selected",
    current: "tree-current",
    dragging: "tree-dragging",
    dropTarget: "tree-drop-target",
}));

rs.mock("../src/project/tree/treeItem.module.css", () => ({
    name: "ti-name",
    icon: "ti-icon",
    "parent-hidden": "ti-parent-hidden",
    hidden: "ti-hidden",
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

rs.mock("../src/project/tree/treeModel.module.css", () => ({
    panel: "tm-panel",
}));

// Mock core: marker classes for instanceof checks, immediate Transaction, no-op Binding
import "./_helpers/mockCoreTree";

// Mock element helpers
import "./_helpers/mockElement";

// Core value imports must come AFTER the mock helper — importing them earlier would
// load the real "@chili3d/core" before the mock registers.
import { NodeSelectionHandler, VisualNode } from "@chili3d/core";
import { Tree } from "../src/project/tree/tree";
import { TreeGroup } from "../src/project/tree/treeItemGroup";
import { TreeModel } from "../src/project/tree/treeModel";
import { getPubSubPubs } from "./_helpers/mockCoreTree";

type PropertyHandler = (property: string, model: unknown) => void;

class MockNode {
    isGroup = false;
    isFolder = false;
    visible = true;
    parentVisible: boolean | undefined = true;
    parent: MockNode | undefined;
    firstChild: MockNode | undefined;
    nextSibling: MockNode | undefined;

    constructor(readonly name: string) {}

    private handlers = new Set<PropertyHandler>();
    onPropertyChanged(handler: PropertyHandler) {
        this.handlers.add(handler);
    }
    removePropertyChanged(handler: PropertyHandler) {
        this.handlers.delete(handler);
    }

    move = rs.fn((_child: unknown, _newParent: unknown, _previousSibling?: unknown) => {});
}

// tree.ts checks `node instanceof VisualNode` against the mocked class; link the
// prototype chain at runtime instead of extending it, because tsc still sees the
// real VisualNode type (with required constructor args and accessors).
Object.setPrototypeOf(MockNode.prototype, VisualNode.prototype);

/** A parametric-body-like node: linked list plus the real feature-list contract. */
class MockBodyNode extends MockNode {
    featureItems() {
        return [];
    }
    setFeatureParameter() {}
    removeFeature() {}
}

function withId(node: MockNode, id: string) {
    (node as unknown as { id: string }).id = id;
    return node;
}

type NodeObserver = (records: NodeRecord[]) => void;

// The shared core mock document hosts the observer registry via overrides; the
// emit* helpers let tests fire node/property/selection changes on demand.
type DocHarness = IDocument & {
    emitNodeChanged: (records: NodeRecord[]) => void;
    emitPropChanged: (prop: string, oldValue: unknown) => void;
    emitSelection: (nodes: INode[]) => void;
};

function makeDoc(rootNode: MockNode): DocHarness {
    const nodeObservers = new Set<NodeObserver>();
    const propHandlers = new Set<(prop: string, source: unknown, oldValue: unknown) => void>();
    const selectionHandlers = new Set<(nodes: INode[]) => void>();
    const doc = createMockDocument({
        modelManager: {
            rootNode,
            addNodeObserver: (h: NodeObserver) => nodeObservers.add(h),
            removeNodeObserver: (h: NodeObserver) => nodeObservers.delete(h),
            onPropertyChanged: (h: (prop: string, source: unknown, oldValue: unknown) => void) =>
                propHandlers.add(h),
            removePropertyChanged: (h: (prop: string, source: unknown, oldValue: unknown) => void) =>
                propHandlers.delete(h),
        } as unknown as MockDocumentOverrides["modelManager"],
        selection: {
            onNodeChanged: {
                sub: (h: (nodes: INode[]) => void) => selectionHandlers.add(h),
                remove: (h: (nodes: INode[]) => void) => selectionHandlers.delete(h),
            },
            setSelectedNodes: rs.fn((_nodes: INode[], _ctrl: boolean) => 0),
        } as unknown as MockDocumentOverrides["selection"],
    });
    return Object.assign(doc, {
        emitNodeChanged: (records: NodeRecord[]) => nodeObservers.forEach((h) => h(records)),
        emitPropChanged: (prop: string, oldValue: unknown) =>
            propHandlers.forEach((h) => h(prop, doc.modelManager, oldValue)),
        emitSelection: (nodes: INode[]) => selectionHandlers.forEach((h) => h(nodes)),
    });
}

interface Fixture {
    doc: ReturnType<typeof makeDoc>;
    root: MockNode;
    groupA: MockNode;
    model1: MockNode;
    model2: MockNode;
    tree: Tree;
}

// Happy-DOM's Element.prototype.append routes through the overridable appendChild.
// TreeGroup's constructor calls super.append() with a container that already holds
// its `items` div; the appendChild override would re-insert that container into
// `items` itself — a cycle real browsers never hit. Patch the override to fall back
// to the native appendChild only for that self-containing case; every other call
// keeps the real delegation behavior.
const originalAppendChild = TreeGroup.prototype.appendChild;
TreeGroup.prototype.appendChild = function <T extends Node>(this: TreeGroup, child: T): T {
    if (child instanceof Element && child.contains(this.items)) {
        return HTMLElement.prototype.appendChild.call(this, child) as T;
    }
    return originalAppendChild.call(this, child) as T;
};

function createFixture(): Fixture {
    const root = new MockNode("root");
    root.isGroup = true;
    root.isFolder = true;
    const groupA = new MockNode("groupA");
    groupA.isGroup = true;
    groupA.isFolder = true;
    groupA.parent = root;
    const model1 = new MockNode("model1");
    const model2 = new MockNode("model2");
    model1.parent = groupA;
    model2.parent = groupA;
    model1.nextSibling = model2;
    root.firstChild = groupA;
    groupA.firstChild = model1;

    const doc = makeDoc(root);
    const tree = new Tree(doc);
    document.body.appendChild(tree);
    return { doc, root, groupA, model1, model2, tree };
}

describe("Tree", () => {
    let fixture: Fixture;
    let originalScrollIntoView: unknown;

    beforeEach(() => {
        originalScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = () => {};
    });

    afterEach(() => {
        Element.prototype.scrollIntoView = originalScrollIntoView as typeof Element.prototype.scrollIntoView;
        // Remove before dispose: disconnectedCallback needs a live document reference
        fixture?.tree.remove();
        fixture?.tree.dispose();
        document.body.innerHTML = "";
    });

    describe("data to tree mapping", () => {
        test("should build tree-group and tree-model elements from node hierarchy", () => {
            fixture = createFixture();
            expect(fixture.tree.className).toBe("tree-panel");
            expect(fixture.tree.querySelectorAll("tree-group").length).toBe(2);
            expect(fixture.tree.querySelectorAll("tree-model").length).toBe(2);
        });

        test("should map every node to its tree item", () => {
            fixture = createFixture();
            expect(fixture.tree.treeItem(fixture.root as unknown as INode)).toBeInstanceOf(TreeGroup);
            expect(fixture.tree.treeItem(fixture.groupA as unknown as INode)).toBeInstanceOf(TreeGroup);
            expect(fixture.tree.treeItem(fixture.model1 as unknown as INode)).toBeInstanceOf(TreeModel);
        });

        test("should nest model items inside their group items container", () => {
            fixture = createFixture();
            const groupEl = fixture.tree.treeItem(fixture.groupA as unknown as INode) as TreeGroup;
            const modelEl = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;
            expect(modelEl.parentElement).toBe(groupEl.items);
        });

        test("should add a new node element on node-added record", () => {
            fixture = createFixture();
            const model3 = new MockNode("model3");
            model3.parent = fixture.groupA;

            fixture.doc.emitNodeChanged([
                {
                    node: model3,
                    newParent: fixture.groupA,
                    newPrevious: fixture.model1,
                } as unknown as NodeRecord,
            ]);

            const model3El = fixture.tree.treeItem(model3 as unknown as INode);
            expect(model3El).toBeInstanceOf(TreeModel);

            // inserted after model1 (newPrevious)
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;
            expect(model1El.nextSibling).toBe(model3El);
        });

        test("should remove node element on node-removed record", () => {
            fixture = createFixture();
            const model2El = fixture.tree.treeItem(fixture.model2 as unknown as INode)!;
            expect(model2El.parentElement).not.toBeNull();

            fixture.doc.emitNodeChanged([
                { node: fixture.model2, newParent: undefined } as unknown as NodeRecord,
            ]);

            expect(model2El.parentElement).toBeNull();
        });
    });

    describe("selection", () => {
        test("should add selected style to newly selected nodes and remove from previous", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;
            const model2El = fixture.tree.treeItem(fixture.model2 as unknown as INode)!;

            fixture.doc.emitSelection([fixture.model1 as unknown as INode]);
            expect(model1El.classList.contains("tree-selected")).toBe(true);

            fixture.doc.emitSelection([fixture.model2 as unknown as INode]);
            expect(model1El.classList.contains("tree-selected")).toBe(false);
            expect(model2El.classList.contains("tree-selected")).toBe(true);
        });

        test("should select node via click when node selection handler is active", () => {
            fixture = createFixture();
            // NodeSelectionHandler is a zero-arg class in the core mock above
            fixture.doc.visual.eventHandler = new (
                NodeSelectionHandler as unknown as new () => unknown
            )() as typeof fixture.doc.visual.eventHandler;
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode) as HTMLElement;

            model1El.click();

            expect(fixture.doc.selection.setSelectedNodes).toHaveBeenCalledWith([fixture.model1], false);
            // current node becomes the clicked model's parent group
            expect(fixture.doc.modelManager.currentNode).toBe(fixture.groupA);
        });

        test("should not select via click without an active selection handler", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode) as HTMLElement;

            model1El.click();

            expect(fixture.doc.selection.setSelectedNodes).not.toHaveBeenCalled();
        });
    });

    describe("double-click", () => {
        test("should publish nodeDoubleClicked with the document and node", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode) as HTMLElement;

            model1El.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

            expect(getPubSubPubs()).toEqual([{ topic: "nodeDoubleClicked", args: [fixture.model1] }]);
        });
    });

    describe("current node", () => {
        test("should move current style when currentNode changes", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;
            const model2El = fixture.tree.treeItem(fixture.model2 as unknown as INode)!;

            fixture.doc.modelManager.currentNode = fixture.model1 as unknown as INodeLinkedList;
            fixture.doc.emitPropChanged("currentNode", undefined);
            expect(model1El.classList.contains("tree-current")).toBe(true);

            fixture.doc.modelManager.currentNode = fixture.model2 as unknown as INodeLinkedList;
            fixture.doc.emitPropChanged("currentNode", fixture.model1);
            expect(model1El.classList.contains("tree-current")).toBe(false);
            expect(model2El.classList.contains("tree-current")).toBe(true);
        });

        test("should set a clicked folder as current node", () => {
            fixture = createFixture();
            fixture.doc.visual.eventHandler = new (
                NodeSelectionHandler as unknown as new () => unknown
            )() as typeof fixture.doc.visual.eventHandler;
            const groupEl = fixture.tree.treeItem(fixture.groupA as unknown as INode) as HTMLElement;

            groupEl.click();

            expect(fixture.doc.modelManager.currentNode).toBe(fixture.groupA);
        });

        test("should keep the parent as current node when clicking a non-folder group", () => {
            fixture = createFixture();
            fixture.doc.visual.eventHandler = new (
                NodeSelectionHandler as unknown as new () => unknown
            )() as typeof fixture.doc.visual.eventHandler;
            // A parametric body renders as a group (consumed tools) but is not a folder.
            const body = new MockNode("body");
            body.isGroup = true;
            body.parent = fixture.root;
            fixture.doc.emitNodeChanged([{ node: body, newParent: fixture.root } as unknown as NodeRecord]);
            const bodyEl = fixture.tree.treeItem(body as unknown as INode) as HTMLElement;

            bodyEl.click();

            expect(fixture.doc.modelManager.currentNode).toBe(fixture.root);
        });

        test("should climb to the nearest folder when clicking a consumed tool under a body", () => {
            fixture = createFixture();
            fixture.doc.visual.eventHandler = new (
                NodeSelectionHandler as unknown as new () => unknown
            )() as typeof fixture.doc.visual.eventHandler;
            const body = new MockNode("body");
            body.isGroup = true;
            body.parent = fixture.root;
            fixture.doc.emitNodeChanged([{ node: body, newParent: fixture.root } as unknown as NodeRecord]);
            const tool = new MockNode("tool");
            tool.parent = body;
            body.firstChild = tool;
            fixture.doc.emitNodeChanged([{ node: tool, newParent: body } as unknown as NodeRecord]);
            const toolEl = fixture.tree.treeItem(tool as unknown as INode) as HTMLElement;

            toolEl.click();

            expect(fixture.doc.modelManager.currentNode).toBe(fixture.root);
        });
    });

    describe("drop validation", () => {
        const fireDrag = (target: HTMLElement, type: string) => {
            target.dispatchEvent(new Event(type, { bubbles: true }));
        };

        test("should move node when dropping onto a valid sibling", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;
            const model2El = fixture.tree.treeItem(fixture.model2 as unknown as INode)!;

            fireDrag(model1El, "dragstart");
            fireDrag(model2El, "drop");

            expect(fixture.groupA.move).toHaveBeenCalledWith(fixture.model1, fixture.groupA, fixture.model2);
        });

        test("should not move when dropping onto the dragged node itself", () => {
            fixture = createFixture();
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;

            fireDrag(model1El, "dragstart");
            fireDrag(model1El, "drop");

            expect(fixture.groupA.move).not.toHaveBeenCalled();
        });

        test("should not move when dropping onto a descendant of a dragged group", () => {
            fixture = createFixture();
            const groupAEl = fixture.tree.treeItem(fixture.groupA as unknown as INode)!;
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;

            fireDrag(groupAEl, "dragstart");
            fireDrag(model1El, "drop");

            expect(fixture.root.move).not.toHaveBeenCalled();
            expect(fixture.groupA.move).not.toHaveBeenCalled();
        });

        test("should drop next to a non-folder group instead of into it", () => {
            fixture = createFixture();
            const body = new MockNode("body");
            body.isGroup = true;
            body.parent = fixture.root;
            fixture.doc.emitNodeChanged([{ node: body, newParent: fixture.root } as unknown as NodeRecord]);
            const bodyEl = fixture.tree.treeItem(body as unknown as INode)!;
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;

            fireDrag(model1El, "dragstart");
            fireDrag(bodyEl, "drop");

            // Sibling insert at the root, not into the body.
            expect(fixture.groupA.move).toHaveBeenCalledWith(fixture.model1, fixture.root, body);
        });

        /** A parametric body (linked list, not a folder) holding a consumed tool. */
        const addConsumedTool = () => {
            const body = new MockNode("body");
            body.isGroup = true;
            body.parent = fixture.root;
            const tool = new MockNode("tool");
            tool.parent = body;
            body.firstChild = tool;
            fixture.doc.emitNodeChanged([
                { node: body, newParent: fixture.root } as unknown as NodeRecord,
                { node: tool, newParent: body } as unknown as NodeRecord,
            ]);
            return { body, tool };
        };

        test("should not drag a consumed tool out of its body", () => {
            fixture = createFixture();
            const { tool } = addConsumedTool();
            const toolEl = fixture.tree.treeItem(tool as unknown as INode)!;
            const rootEl = fixture.tree.treeItem(fixture.root as unknown as INode)!;

            fireDrag(toolEl, "dragstart");
            fireDrag(rootEl, "drop");

            expect(fixture.root.move).not.toHaveBeenCalled();
        });

        test("should not drop onto a row under a non-folder group", () => {
            fixture = createFixture();
            const { body, tool } = addConsumedTool();
            const toolEl = fixture.tree.treeItem(tool as unknown as INode)!;
            const model1El = fixture.tree.treeItem(fixture.model1 as unknown as INode)!;

            fireDrag(model1El, "dragstart");
            fireDrag(toolEl, "drop");

            expect(fixture.groupA.move).not.toHaveBeenCalled();
            expect(body.move).not.toHaveBeenCalled();
        });
    });
});
