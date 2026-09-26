// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ArrayRecord,
    DimensionAnnotation,
    type IDocument,
    type IHistoryRecord,
    type INode,
    type ISelection,
    type IView,
    type IVisualObject,
    type ObjectSnap,
    PubSub,
    type Signal,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, createMockView } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ShowPropertyEventHandler } from "../src/showPropertyEventHandler";

describe("ShowPropertyEventHandler", () => {
    let document: IDocument;
    let listeners: ((selected: INode[]) => void)[];
    let collectedEvents: { event: string; args: any[] }[];
    let handler: ShowPropertyEventHandler;

    beforeEach(() => {
        listeners = [];
        collectedEvents = [];

        // Collect events via subscription
        const cb = (...args: any[]) => {
            collectedEvents.push({ event: "showProperties", args });
        };
        PubSub.default.sub("showProperties", cb);

        const onNodeChangedSignal: Signal<(selected: INode[]) => void> = {
            sub: (listener: (selected: INode[]) => void) => {
                listeners.push(listener);
            },
            remove: (listener: (selected: INode[]) => void) => {
                listeners = listeners.filter((l) => l !== listener);
            },
            emit: (..._args: any[]) => {},
            dispose: () => {
                listeners = [];
            },
        } as unknown as Signal<(selected: INode[]) => void>;

        document = {
            id: "test-doc",
            name: "test",
            selection: {
                onNodeChanged: onNodeChangedSignal,
            } as unknown as ISelection,
            visual: {
                update: () => {},
                eventHandler: {
                    isEnabled: true,
                    pointerMove: () => {},
                    pointerDown: () => {},
                    pointerUp: () => {},
                    keyDown: () => {},
                    dispose: () => {},
                },
                context: {} as any,
                highlighter: {} as any,
                meshExporter: {} as any,
                viewHandler: {} as any,
                defaultEventHandler: {} as any,
                createView: () => ({}) as any,
                dispose: () => {},
                document: undefined as unknown as IDocument,
            },
        } as unknown as IDocument;

        (document.visual as any).document = document;

        handler = new ShowPropertyEventHandler(document);
    });

    afterEach(() => {
        handler.dispose();
        PubSub.default.removeAll("showProperties");
    });

    // ── constructor ───────────────────────────────────────────────

    describe("constructor", () => {
        test("should subscribe to selection.onNodeChanged", () => {
            expect(listeners.length).toBe(1);
        });

        test("should be an instance of ShowPropertyEventHandler", () => {
            expect(handler).toBeInstanceOf(ShowPropertyEventHandler);
        });
    });

    // ── handleSelectionChanged ────────────────────────────────────

    describe("handleSelectionChanged", () => {
        test("should publish showProperties event when selection changes", () => {
            const selectedNodes: INode[] = [{ id: "node-1" } as INode];

            // Trigger the subscription callback
            listeners[0](selectedNodes);

            // We should have received at least 1 showProperties event
            const showPropsEvents = collectedEvents.filter((e) => e.event === "showProperties");
            expect(showPropsEvents.length).toBeGreaterThanOrEqual(1);

            // The latest event should have the right args
            const latest = showPropsEvents.at(-1)!;
            expect(latest.args[0]).toBe(document);
            expect(latest.args[1]).toBe(selectedNodes);
        });

        test("should publish showProperties with all selected nodes", () => {
            const nodes: INode[] = [{ id: "a" } as INode, { id: "b" } as INode, { id: "c" } as INode];

            listeners[0](nodes);

            const showPropsEvents = collectedEvents.filter((e) => e.event === "showProperties");
            const latest = showPropsEvents.at(-1)!;
            expect(latest.args[1]).toEqual(nodes);
            expect(latest.args[1].length).toBe(3);
        });

        test("should handle empty selection", () => {
            listeners[0]([]);

            const showPropsEvents = collectedEvents.filter((e) => e.event === "showProperties");
            const latest = showPropsEvents.at(-1)!;
            expect(latest.args[1]).toEqual([]);
        });

        test("should publish event each time selection changes", () => {
            const before = collectedEvents.length;

            listeners[0]([{ id: "1" } as INode]);
            listeners[0]([{ id: "2" } as INode]);
            listeners[0]([{ id: "3" } as INode]);

            const newEvents = collectedEvents.length - before;
            expect(newEvents).toBe(3);
        });
    });

    // ── disposeInternal ───────────────────────────────────────────

    describe("disposeInternal", () => {
        test("should remove onNodeChanged listener on dispose", () => {
            expect(listeners.length).toBe(1);

            handler.dispose();

            expect(listeners.length).toBe(0);
        });

        test("should not keep any listeners after dispose", () => {
            handler.dispose();

            expect(listeners.length).toBe(0);
        });
    });
});

describe("ShowPropertyEventHandler dimension dragging", () => {
    // The mock view maps screen (mx,my) to world (mx-400, 300-my, 0) on the z=0 plane,
    // which is exactly the plane this annotation lies in.
    const start = new XYZ(0, 0, 0);
    const end = new XYZ(10, 0, 0);
    const text = new XYZ(5, 8, 0);
    const GRIP_START = { x: 400, y: 300 };

    let document: IDocument;
    let view: IView;
    let handler: ShowPropertyEventHandler;
    let node: DimensionAnnotation;
    let historyAdds: IHistoryRecord[];
    let updateCalls: number;
    let clearSelectionCalls: number;

    const pointer = (x: number, y: number) =>
        ({
            button: 0,
            isPrimary: true,
            offsetX: x,
            offsetY: y,
            pointerId: 1,
            preventDefault: () => {},
        }) as unknown as PointerEvent;

    beforeEach(() => {
        historyAdds = [];
        updateCalls = 0;
        clearSelectionCalls = 0;
        document = createMockDocument({
            history: { add: (record: IHistoryRecord) => void historyAdds.push(record) },
            selection: { clearSelection: () => clearSelectionCalls++ },
        });
        node = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dim",
            startPoint: start,
            endPoint: end,
            textPoint: text,
        });
        const visualObj = {} as IVisualObject;
        document.visual.context.getNode = (v) => (v === visualObj ? node : undefined);
        view = createMockView({
            document,
            detectVisual: () => [visualObj],
            update: () => updateCalls++,
        });
        handler = new ShowPropertyEventHandler(document);
    });

    afterEach(() => {
        handler.dispose();
    });

    test("drags the text point when the press misses both grips", () => {
        handler.pointerDown(view, pointer(500, 400));
        handler.pointerMove(view, pointer(520, 380));
        handler.pointerUp(view, pointer(520, 380));

        expect(node.textPoint).toEqual(new XYZ(120, -80, 0));
        expect(node.startPoint).toEqual(start);
        expect(updateCalls).toBeGreaterThan(0);
    });

    test("drags the start grip when the press lands on it", () => {
        handler.pointerDown(view, pointer(GRIP_START.x + 2, GRIP_START.y - 1));
        handler.pointerMove(view, pointer(450, 350));
        handler.pointerUp(view, pointer(450, 350));

        expect(node.startPoint).toEqual(new XYZ(50, -50, 0));
        expect(node.endPoint).toEqual(end);
        expect(node.textPoint).toEqual(text);
    });

    test("a press without movement stays a plain click: no drag, no history", () => {
        handler.pointerDown(view, pointer(500, 400));
        handler.pointerUp(view, pointer(500, 400));

        expect(node.textPoint).toEqual(text);
        expect(historyAdds).toHaveLength(0);
        // the normal selection path still ran
        expect(clearSelectionCalls).toBe(1);
    });

    test("a drag commits as a single undo step that restores the original point", () => {
        handler.pointerDown(view, pointer(500, 400));
        handler.pointerMove(view, pointer(520, 380));
        handler.pointerMove(view, pointer(540, 360));
        handler.pointerMove(view, pointer(560, 340));
        handler.pointerUp(view, pointer(560, 340));

        expect(node.textPoint).toEqual(new XYZ(160, -40, 0));
        expect(historyAdds).toHaveLength(1);
        expect(historyAdds[0]).toBeInstanceOf(ArrayRecord);

        document.history.disabled = true;
        (historyAdds[0] as ArrayRecord).undo();
        document.history.disabled = false;
        expect(node.textPoint).toEqual(text);
    });

    test("Escape mid-drag rolls back and records nothing", () => {
        handler.pointerDown(view, pointer(500, 400));
        handler.pointerMove(view, pointer(520, 380));
        expect(node.textPoint).not.toEqual(text);

        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);
        handler.pointerUp(view, pointer(520, 380));

        expect(node.textPoint).toEqual(text);
        expect(historyAdds).toHaveLength(0);
    });

    test("a degenerate dimension cannot be dragged and falls back to selection", () => {
        const flat = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "flat",
            startPoint: XYZ.zero,
            endPoint: XYZ.zero,
            textPoint: XYZ.zero,
        });
        document.visual.context.getNode = () => flat;

        handler.pointerDown(view, pointer(400, 300));
        handler.pointerMove(view, pointer(450, 350));
        handler.pointerUp(view, pointer(450, 350));

        expect(flat.startPoint).toEqual(XYZ.zero);
        expect(historyAdds).toHaveLength(0);
    });

    test("dispose mid-drag rolls back", () => {
        handler.pointerDown(view, pointer(500, 400));
        handler.pointerMove(view, pointer(520, 380));
        expect(node.textPoint).not.toEqual(text);

        handler.dispose();

        expect(node.textPoint).toEqual(text);
        expect(historyAdds).toHaveLength(0);
    });

    /** A handler whose object snap is a scripted stub: `point` is the snap it reports. */
    function handlerWithSnap(point: XYZ | undefined) {
        const clear = rs.fn();
        const snap = rs.fn(() => (point ? { view, point, shapes: [], type: "end" as const } : undefined));
        const stub = { snap, clear, removeDynamicObject: () => {} } as unknown as ObjectSnap;
        const h = new (class extends ShowPropertyEventHandler {
            protected override createObjectSnap(): ObjectSnap {
                return stub;
            }
        })(document);
        return { h, snap, clear };
    }

    test("an endpoint drag lands on the snapped feature point, not the plane", () => {
        const snapPoint = new XYZ(99, 88, 7);
        const { h, snap, clear } = handlerWithSnap(snapPoint);

        h.pointerDown(view, pointer(GRIP_START.x + 2, GRIP_START.y - 1));
        h.pointerMove(view, pointer(450, 350));
        h.pointerUp(view, pointer(450, 350));

        expect(snap).toHaveBeenCalled();
        expect(node.startPoint).toEqual(snapPoint);
        expect(clear).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    test("an endpoint drag falls back to the drag plane when nothing is snapped", () => {
        const { h } = handlerWithSnap(undefined);

        h.pointerDown(view, pointer(GRIP_START.x + 2, GRIP_START.y - 1));
        h.pointerMove(view, pointer(450, 350));
        h.pointerUp(view, pointer(450, 350));

        expect(node.startPoint).toEqual(new XYZ(50, -50, 0));
        h.dispose();
    });

    test("a text drag never consults the object snap", () => {
        const createSnap = rs.fn();
        const h = new (class extends ShowPropertyEventHandler {
            protected override createObjectSnap(): ObjectSnap {
                createSnap();
                return super.createObjectSnap();
            }
        })(document);

        h.pointerDown(view, pointer(500, 400));
        h.pointerMove(view, pointer(520, 380));
        h.pointerUp(view, pointer(520, 380));

        expect(createSnap).not.toHaveBeenCalled();
        expect(node.textPoint).toEqual(new XYZ(120, -80, 0));
        h.dispose();
    });

    test("the object snap is cleared when a drag is cancelled", () => {
        const { h, clear } = handlerWithSnap(undefined);

        h.pointerDown(view, pointer(GRIP_START.x + 2, GRIP_START.y - 1));
        h.pointerMove(view, pointer(450, 350));
        h.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(clear).toHaveBeenCalledTimes(1);
        h.dispose();
    });
});
