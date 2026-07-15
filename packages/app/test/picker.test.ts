// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys, IDocument, IEventHandler, IPicker, IVisual } from "@chili3d/core";
import { AsyncController, PubSub } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { Picker } from "../src/picker";
import { createMockDocument, createMockVisual } from "./_helpers";

function createMockHandler(): IEventHandler {
    return {
        isEnabled: true,
        pointerMove: () => {},
        pointerDown: () => {},
        pointerUp: () => {},
        keyDown: () => {},
        dispose: () => {},
    };
}

describe("Picker", () => {
    let document: IDocument;
    let visual: IVisual;
    let picker: Picker;
    let oldEventHandler: IEventHandler;
    let collectedEvents: { event: string; args: any[] }[];
    let cleanupFns: (() => void)[];

    beforeEach(() => {
        collectedEvents = [];
        cleanupFns = [];

        // Collect events via subscription instead of spying on pub (avoids nesting)
        const eventsToTrack = [
            "viewCursor",
            "statusBarTip",
            "showSelectionControl",
            "clearSelectionControl",
            "clearStatusBarTip",
        ];
        for (const evt of eventsToTrack) {
            const cb = (...args: any[]) => {
                collectedEvents.push({ event: evt, args });
            };
            (PubSub.default as any).sub(evt, cb);
            cleanupFns.push(() => (PubSub.default as any).remove(evt, cb));
        }

        document = createMockDocument({ id: "picker-test", name: "picker-test" });
        visual = createMockVisual(document);
        // readonly properties need any-cast for reassignment in tests
        const docAny = document as any;
        (visual as any).document = document;
        docAny.visual = visual;
        // Capture the actual event handler on the visual for restore assertions
        oldEventHandler = visual.eventHandler;
        docAny.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [],
            setSelectedNodes: () => 0,
            setSelectedShapes: () => 0,
            getSelectedNodeLength: () => 0,
            getSelectedVisualNodes: () => [],
            clearSelection: () => {},
            onNodeChanged: {
                sub: () => {},
                remove: () => {},
                emit: () => {},
                dispose: () => {},
            },
            onShapeChanged: {
                sub: () => {},
                remove: () => {},
                emit: () => {},
                dispose: () => {},
            },
            dispose: () => {},
        } as any;
        docAny.picker = {} as IPicker;

        picker = new Picker(document);
    });

    afterEach(() => {
        for (const fn of cleanupFns) {
            fn();
        }
    });

    // ── constructor ───────────────────────────────────────────────

    describe("constructor", () => {
        test("should store document reference", () => {
            expect(picker.document).toBe(document);
        });
    });

    // ── pickAsync ─────────────────────────────────────────────────

    describe("pickAsync", () => {
        test("should swap document event handler to the provided handler", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const pickPromise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);

            expect(document.visual.eventHandler).toBe(handler);

            controller.success();
            await pickPromise;
        });

        test("should restore original event handler on completion", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.success();
            await promise;

            expect(document.visual.eventHandler).toBe(oldEventHandler);
        });

        test("should publish viewCursor event", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(
                handler,
                "common.ok" as I18nKeys,
                controller,
                false,
                "select.default",
            );
            controller.success();
            await promise;

            const cursorEvents = collectedEvents.filter((e) => e.event === "viewCursor");
            expect(cursorEvents.length).toBeGreaterThanOrEqual(1);
            // The first viewCursor should have the custom cursor type
            const firstCursorEvent = cursorEvents.find((e) => e.args[0] !== "default");
            expect(firstCursorEvent).toBeDefined();
            expect(firstCursorEvent!.args[0]).toBe("select.default");
        });

        test("should publish statusBarTip with prompt", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "command.box" as I18nKeys, controller, false);
            controller.success();
            await promise;

            const tipEvents = collectedEvents.filter((e) => e.event === "statusBarTip");
            expect(tipEvents.length).toBeGreaterThanOrEqual(1);
            expect(tipEvents[0].args[0]).toBe("command.box");
        });

        test("should resolve when controller completes successfully", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.success();
            await expect(promise).resolves.toBeUndefined();
        });

        test("should resolve when controller is cancelled (no throw)", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.cancel();
            await expect(promise).resolves.toBeUndefined();
        });

        test("should restore event handler after cancellation", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.cancel();
            await promise;

            expect(document.visual.eventHandler).toBe(oldEventHandler);
        });

        test("should reset cursor to default in finally block", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.success();
            await promise;

            const lastCursorEvent = collectedEvents.filter((e) => e.event === "viewCursor").at(-1);
            expect(lastCursorEvent!.args[0]).toBe("default");
        });

        test("should show selection control when showControl is true", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, true);
            controller.success();
            await promise;

            const showControlEvents = collectedEvents.filter((e) => e.event === "showSelectionControl");
            expect(showControlEvents.length).toBe(1);
        });

        test("should not show selection control when showControl is false", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.success();
            await promise;

            const showControlEvents = collectedEvents.filter((e) => e.event === "showSelectionControl");
            expect(showControlEvents.length).toBe(0);
        });

        test("should clear selection control in finally when showControl is true", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, true);
            controller.success();
            await promise;

            const clearEvents = collectedEvents.filter((e) => e.event === "clearSelectionControl");
            expect(clearEvents.length).toBe(1);
        });

        test("should clear status bar tip in finally block", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, false);
            controller.cancel();
            await promise;

            const clearTipEvents = collectedEvents.filter((e) => e.event === "clearStatusBarTip");
            expect(clearTipEvents.length).toBe(1);
        });
    });

    // ── pickNode ──────────────────────────────────────────────────

    describe("pickNode", () => {
        test("should return selected nodes from document selection", async () => {
            const controller = new AsyncController();

            picker.pickAsync = async () => {
                document.visual.eventHandler = oldEventHandler;
            };

            const result = await picker.pickNode("common.ok" as I18nKeys, controller);
            expect(Array.isArray(result)).toBe(true);
        });

        test("should use multi=false (showControl=false) by default", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickNode("common.ok" as I18nKeys, controller);

            expect(pickAsyncArgs[3]).toBe(false);
        });

        test("should pass multi=true (showControl=true) when options.multi is true", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickNode("common.ok" as I18nKeys, controller, { multi: true });

            expect(pickAsyncArgs[3]).toBe(true);
        });
    });

    // ── pickShape ─────────────────────────────────────────────────

    describe("pickShape", () => {
        test("should return selected shapes from document selection", async () => {
            const controller = new AsyncController();

            picker.pickAsync = async () => {
                document.visual.eventHandler = oldEventHandler;
            };

            const result = await picker.pickShape("common.ok" as I18nKeys, controller);
            expect(Array.isArray(result)).toBe(true);
        });

        test("should pass multi=false as default showControl", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller);

            expect(pickAsyncArgs[3]).toBe(false);
        });

        test("should pass multi=true as showControl when options.multi is true", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, { multi: true });

            expect(pickAsyncArgs[3]).toBe(true);
        });
    });
});
