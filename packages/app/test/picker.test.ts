// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys, IDocument, IEventHandler, IPicker, IVisual, VisualShapeData } from "@chili3d/core";
import { AsyncController, PubSub, ShapeTypes, VisualStates } from "@chili3d/core";
import {
    createMockDocument,
    createMockVisualWithDocument as createMockVisual,
} from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { Picker } from "../src/picker";

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
            "showConfirmControl",
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

            const pickPromise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");

            expect(document.visual.eventHandler).toBe(handler);

            controller.success();
            await pickPromise;
        });

        test("should restore original event handler on completion", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.success();
            await promise;

            expect(document.visual.eventHandler).toBe(oldEventHandler);
        });

        test("should leave a handler that was installed while the session was open", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();
            const replacement = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            // Something else takes the viewport over mid-pick — a sketch session tearing
            // down under a nested drag does exactly this. Its handler is the live one.
            document.visual.eventHandler = replacement;
            controller.success();
            await promise;

            expect(document.visual.eventHandler).toBe(replacement);
        });

        test("should publish viewCursor event", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(
                handler,
                "common.ok" as I18nKeys,
                controller,
                "none",
                "select.default",
            );
            controller.success();
            await promise;

            const cursorEvents = collectedEvents.filter((e) => e.event === "viewCursor");
            expect(cursorEvents.length).toBeGreaterThanOrEqual(1);
            // The first viewCursor should have the custom cursor type
            const firstCursorEvent = cursorEvents.find((e) => e.args[0] !== "default");
            expect(firstCursorEvent).not.toBeNull();
            expect(firstCursorEvent!.args[0]).toBe("select.default");
        });

        test("should publish statusBarTip with prompt", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "command.box" as I18nKeys, controller, "none");
            controller.success();
            await promise;

            const tipEvents = collectedEvents.filter((e) => e.event === "statusBarTip");
            expect(tipEvents.length).toBeGreaterThanOrEqual(1);
            expect(tipEvents[0].args[0]).toBe("command.box");
        });

        test("should resolve when controller completes successfully", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.success();
            await expect(promise).resolves.toBeUndefined();
        });

        test("should resolve when controller is cancelled (no throw)", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.cancel();
            await expect(promise).resolves.toBeUndefined();
        });

        test("should restore event handler after cancellation", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.cancel();
            await promise;

            expect(document.visual.eventHandler).toBe(oldEventHandler);
        });

        test("should reset cursor to default in finally block", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.success();
            await promise;

            const lastCursorEvent = collectedEvents.filter((e) => e.event === "viewCursor").at(-1);
            expect(lastCursorEvent!.args[0]).toBe("default");
        });

        test("should show the count bar for a selection control", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "selection");
            controller.success();
            await promise;

            const showControlEvents = collectedEvents.filter((e) => e.event === "showSelectionControl");
            expect(showControlEvents.length).toBe(1);
        });

        test("should show no bar for a none control", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
            controller.success();
            await promise;

            const showControlEvents = collectedEvents.filter((e) => e.event === "showSelectionControl");
            expect(showControlEvents.length).toBe(0);
        });

        test("should clear the bar in finally when a control was shown", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "selection");
            controller.success();
            await promise;

            const clearEvents = collectedEvents.filter((e) => e.event === "clearSelectionControl");
            expect(clearEvents.length).toBe(1);
        });

        test("should publish the confirm bar for a confirm control", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "confirm");
            controller.success();
            await promise;

            expect(collectedEvents.filter((e) => e.event === "showConfirmControl").length).toBe(1);
            expect(collectedEvents.filter((e) => e.event === "showSelectionControl").length).toBe(0);
            // Both bars come down through the one clear event.
            expect(collectedEvents.filter((e) => e.event === "clearSelectionControl").length).toBe(1);
        });

        test("should clear status bar tip in finally block", async () => {
            const controller = new AsyncController();
            const handler = createMockHandler();

            const promise = picker.pickAsync(handler, "common.ok" as I18nKeys, controller, "none");
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

        test("should use the none control by default", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickNode("common.ok" as I18nKeys, controller);

            expect(pickAsyncArgs[3]).toBe("none");
        });

        test("should use the selection control when options.multi is true", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickNode("common.ok" as I18nKeys, controller, { multi: true });

            expect(pickAsyncArgs[3]).toBe("selection");
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

        test("should use the none control for a single pick by default", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller);

            expect(pickAsyncArgs[3]).toBe("none");
        });

        test("should use the selection control when options.multi is true", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, { multi: true });

            expect(pickAsyncArgs[3]).toBe("selection");
        });

        test("should use the confirm bar for a single pick that asks for one", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, { showConfirmControl: true });

            expect(pickAsyncArgs[3]).toBe("confirm");
        });

        test("should keep the count bar for a multi pick even when the confirm bar is asked for", async () => {
            let pickAsyncArgs: any[] = [];
            picker.pickAsync = async (...args: any[]) => {
                pickAsyncArgs = args;
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, {
                multi: true,
                showConfirmControl: true,
            });

            expect(pickAsyncArgs[3]).toBe("selection");
        });

        test("should wire canFinish onto the selection handler", async () => {
            let handler: any;
            picker.pickAsync = async (...args: any[]) => {
                handler = args[0];
            };

            const controller = new AsyncController();
            const canFinish = () => true;
            await picker.pickShape("common.ok" as I18nKeys, controller, { canFinish });

            expect(handler.canFinish).toBe(canFinish);
        });

        test("should wire sortDetected onto the selection handler", async () => {
            let handler: any;
            picker.pickAsync = async (...args: any[]) => {
                handler = args[0];
            };

            const controller = new AsyncController();
            const sortDetected = (detected: VisualShapeData[]) => detected;
            await picker.pickShape("common.ok" as I18nKeys, controller, { sortDetected });

            expect(handler.sortDetected).toBe(sortDetected);
        });

        test("should default to filled-face states when picking faces", async () => {
            let handler: any;
            picker.pickAsync = async (...args: any[]) => {
                handler = args[0];
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, { shapeType: ShapeTypes.face });

            expect(handler.selectedState).toBe(VisualStates.faceSelected);
            expect(handler.highlightState).toBe(VisualStates.faceHighlight);
        });

        test("should keep edge states for non-face picks", async () => {
            let handler: any;
            picker.pickAsync = async (...args: any[]) => {
                handler = args[0];
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, { shapeType: ShapeTypes.edge });

            expect(handler.selectedState).toBe(VisualStates.edgeSelected);
            expect(handler.highlightState).toBe(VisualStates.edgeHighlight);
        });

        test("should prefer explicitly provided states over the face defaults", async () => {
            let handler: any;
            picker.pickAsync = async (...args: any[]) => {
                handler = args[0];
            };

            const controller = new AsyncController();
            await picker.pickShape("common.ok" as I18nKeys, controller, {
                shapeType: ShapeTypes.face,
                selectedState: VisualStates.faceTransparent,
                highlightState: VisualStates.edgeHighlight,
            });

            expect(handler.selectedState).toBe(VisualStates.faceTransparent);
            expect(handler.highlightState).toBe(VisualStates.edgeHighlight);
        });
    });
});
