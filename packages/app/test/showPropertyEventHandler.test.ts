// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INode, type ISelection, PubSub, type Signal } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
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
