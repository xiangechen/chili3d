// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    I18nKeys,
    IDocument,
    IEventHandler,
    IHighlighter,
    INode,
    IVisual,
    IVisualContext,
    IVisualObject,
    VisualShapeData,
} from "@chili3d/core";
import { BoundingBox, VisualNode } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { SelectionManager } from "../src/selectionManager";

// A concrete VisualNode subclass so instanceof checks pass.
class TestNode extends VisualNode {
    constructor() {
        // biome-ignore lint/suspicious/noExplicitAny: constructor args not needed for test
        super(null as any, "test", "test-id");
    }
    display(): I18nKeys {
        return "common.ok" as I18nKeys;
    }
    boundingBox() {
        return new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
}

function createMockDocument(): IDocument {
    const mockVisualNode = {} as unknown as IVisualObject;

    const highlighter: IHighlighter = {
        addState() {},
        removeState() {},
        clear() {},
        getState() {
            return undefined;
        },
        resetState() {},
        highlightMesh() {
            return 0;
        },
        removeHighlightMesh() {},
    };

    const context: IVisualContext = {
        getVisual() {
            return mockVisualNode;
        },
    } as unknown as IVisualContext;

    const visual: IVisual = {
        highlighter,
        context,
        update() {},
        eventHandler: null as unknown as IEventHandler,
    } as unknown as IVisual;

    return { visual } as unknown as IDocument;
}

function createVisualNode(): VisualNode {
    return new TestNode();
}

function createPlainNode(): INode {
    return {} as unknown as INode;
}

describe("SelectionManager", () => {
    let selection: SelectionManager;
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
        selection = new SelectionManager(doc);
    });

    afterEach(() => {
        selection.dispose();
    });

    // ── setSelection ────────────────────────────────────────────────

    describe("setSelection", () => {
        test("should set selected nodes", () => {
            const node = createVisualNode();
            const count = selection.setSelectedNodes([node], false);

            expect(count).toBe(1);
            expect(selection.getSelectedNodes()).toEqual([node]);
        });

        test("getSelectedNodes should return a copy", () => {
            const node = createVisualNode();
            selection.setSelectedNodes([node], false);
            const nodes = selection.getSelectedNodes();
            nodes.push(createVisualNode());

            expect(selection.getSelectedNodes()).toHaveLength(1);
        });

        test("should toggle nodes individually when toggle=true", () => {
            const a = createVisualNode();
            const b = createVisualNode();
            selection.setSelectedNodes([a], false);

            // toggle [a,b]: a was selected→deselected, b was unselected→selected
            selection.setSelectedNodes([a, b], true);
            expect(selection.getSelectedNodes()).toHaveLength(1);
            expect(selection.getSelectedNodes()).toEqual([b]);
        });

        test("should replace nodes when toggle=false", () => {
            const a = createVisualNode();
            const b = createVisualNode();
            selection.setSelectedNodes([a], false);
            selection.setSelectedNodes([b], false);

            expect(selection.getSelectedNodes()).toEqual([b]);
        });
    });

    // ── getSelectedVisualNodes ──────────────────────────────────────

    describe("getSelectedVisualNodes", () => {
        test("should return only VisualNode instances", () => {
            const a = createVisualNode();
            const b = createPlainNode();

            selection.setSelectedNodes([a, b], false);
            const visualNodes = selection.getSelectedVisualNodes();

            expect(visualNodes).toHaveLength(1);
            expect(visualNodes[0]).toBe(a);
        });

        test("should return a copy", () => {
            const a = createVisualNode();
            selection.setSelectedNodes([a], false);
            const nodes = selection.getSelectedVisualNodes();
            nodes.length = 0;

            expect(selection.getSelectedVisualNodes()).toHaveLength(1);
        });
    });

    // ── clearSelection ──────────────────────────────────────────────

    describe("clearSelection", () => {
        test("should remove all selected nodes", () => {
            const a = createVisualNode();
            const b = createVisualNode();
            selection.setSelectedNodes([a, b], false);
            expect(selection.getSelectedNodes()).toHaveLength(2);

            selection.clearSelection();
            expect(selection.getSelectedNodes()).toHaveLength(0);
        });

        test("should clear sub-shapes", () => {
            const a = createVisualNode();
            selection.setSelectedNodes([a], false);
            selection.clearSelection();

            expect(selection.getSelectedShapes()).toHaveLength(0);
        });
    });

    // ── getSelectedShapes ───────────────────────────────────────────

    describe("getSelectedShapes", () => {
        test("should return empty array initially", () => {
            expect(selection.getSelectedShapes()).toEqual([]);
        });

        test("should return a copy", () => {
            const shapes = selection.getSelectedShapes();
            shapes.push({} as VisualShapeData);
            expect(selection.getSelectedShapes()).toHaveLength(0);
        });
    });

    // ── onChanged event ─────────────────────────────────────────────

    describe("onChanged", () => {
        test("should emit when selection changes", () => {
            let emitted = false;
            selection.onNodeChanged.sub(() => {
                emitted = true;
            });

            const node = createVisualNode();
            selection.setSelectedNodes([node], false);

            expect(emitted).toBe(true);
        });

        test("should emit copies (mutation safety)", () => {
            let receivedSelected: INode[] = [];

            selection.onNodeChanged.sub((selected) => {
                receivedSelected = selected;
            });

            const node = createVisualNode();
            selection.setSelectedNodes([node], false);

            // Mutating received array should not affect internal state
            receivedSelected.length = 0;

            expect(selection.getSelectedNodes()).toHaveLength(1);
        });

        test("should allow removing a listener", () => {
            let count = 0;
            const listener = () => {
                count++;
            };
            selection.onNodeChanged.sub(listener);

            const a = createVisualNode();
            selection.setSelectedNodes([a], false);
            expect(count).toBe(1);

            selection.onNodeChanged.remove(listener);
            selection.setSelectedNodes([createVisualNode()], false);
            expect(count).toBe(1);
        });
    });

    // ── dispose ─────────────────────────────────────────────────────

    describe("dispose", () => {
        test("should clear internal state", () => {
            const node = createVisualNode();
            selection.setSelectedNodes([node], false);

            selection.dispose();

            expect(selection.getSelectedNodes()).toHaveLength(0);
            expect(selection.getSelectedShapes()).toHaveLength(0);
        });
    });
});
