// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, Config, PubSub, XYZ } from "../src";
import { Plane } from "../src/math";
import type { PointSnapData } from "../src/snap";
import { PointSnapEventHandler } from "../src/snap";
import { createHandlerMockView, createPointerEvent, TestDocument } from "./mocks";

// ============================================================================
// SnapEventHandler base class logic (tested via PointSnapEventHandler)
// ============================================================================

describe("SnapEventHandler — base class behaviour", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    // --------------------------------------------------------------------------
    // State machine
    // --------------------------------------------------------------------------

    describe("state machine", () => {
        test("should start in idle state", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            expect(handler.state).toBe("idle");
        });

        test("should transition to snapping on pointerMove", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());
            expect(handler.state).toBe("snapping");
        });

        test("should transition to completed on pointerDown with snapped point", () => {
            const pointData: PointSnapData = {
                featurePoints: [
                    {
                        point: new XYZ({ x: -300, y: -100, z: 0 }),
                        prompt: "test",
                    },
                ],
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());
            handler.pointerDown(view, createPointerEvent({ button: 0 }));
            expect(handler.state).toBe("completed");
        });

        test("should transition to cancelled on Escape", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "Escape" } as KeyboardEvent);
            expect(handler.state).toBe("cancelled");
        });

        test("should not re-trigger success when already completed", () => {
            let successCount = 0;
            controller.onCompleted(() => {
                successCount++;
            });

            const pointData: PointSnapData = {
                featurePoints: [{ point: new XYZ({ x: -300, y: -100, z: 0 }), prompt: "test" }],
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());
            handler.pointerDown(view, createPointerEvent({ button: 0 }));
            // Second pointerDown should not re-trigger success
            handler.pointerDown(view, createPointerEvent({ button: 0 }));
            expect(successCount).toBe(1);
        });

        test("should not re-trigger cancel when already cancelled", () => {
            let cancelCount = 0;
            controller.onCancelled(() => {
                cancelCount++;
            });

            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "Escape" } as KeyboardEvent);
            handler.keyDown(view, { key: "Escape" } as KeyboardEvent);
            expect(cancelCount).toBe(1);
        });

        test("dispose should set state to completed", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            handler.dispose();
            expect(handler.state).toBe("completed");
        });
    });

    // --------------------------------------------------------------------------
    // Cancel via Enter/Space
    // --------------------------------------------------------------------------

    describe("keyDown cancel", () => {
        test("should cancel on Enter key", () => {
            let cancelled = false;
            controller.onCancelled(() => {
                cancelled = true;
            });
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.keyDown(view, {
                key: "Enter",
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as unknown as KeyboardEvent);
            expect(cancelled).toBe(true);
        });

        test("should cancel on Space key", () => {
            let cancelled = false;
            controller.onCancelled(() => {
                cancelled = true;
            });
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.keyDown(view, {
                key: " ",
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as unknown as KeyboardEvent);
            expect(cancelled).toBe(true);
        });
    });

    // --------------------------------------------------------------------------
    // Numeric input
    // --------------------------------------------------------------------------

    describe("numeric input", () => {
        test("should enter inputing state on digit key", () => {
            const handler = new PointSnapEventHandler(document, controller, {
                dimension: 0b111,
                refPoint: () => XYZ.zero,
            });
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "5" } as KeyboardEvent);
            expect(handler.state).toBe("inputing");
        });

        test("should enter inputing state on hash key", () => {
            const handler = new PointSnapEventHandler(document, controller, {
                dimension: 0b111,
                refPoint: () => XYZ.zero,
            });
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "#" } as KeyboardEvent);
            expect(handler.state).toBe("inputing");
        });

        test("should enter inputing state on minus key", () => {
            const handler = new PointSnapEventHandler(document, controller, {
                dimension: 0b111,
                refPoint: () => XYZ.zero,
            });
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "-" } as KeyboardEvent);
            expect(handler.state).toBe("inputing");
        });

        test("should not enter inputing state on letter key", () => {
            const handler = new PointSnapEventHandler(document, controller, {
                dimension: 0b111,
                refPoint: () => XYZ.zero,
            });
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "a" } as KeyboardEvent);
            expect(handler.state).toBe("idle");
        });
    });

    // --------------------------------------------------------------------------
    // Pointer events
    // --------------------------------------------------------------------------

    describe("pointer events", () => {
        test("should call showToast when pointerDown without snapped point", () => {
            let toastMsg = "";
            PubSub.default.sub("showToast", (msg: string) => {
                toastMsg = msg;
            });

            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.pointerDown(view, createPointerEvent({ button: 0 }));
            expect(toastMsg).toBe("toast.snap.notFoundValidPoint");
        });

        test("should not trigger success on right button pointerDown", () => {
            let succeeded = false;
            controller.onCompleted(() => {
                succeeded = true;
            });

            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();
            handler.pointerDown(view, createPointerEvent({ button: 2 }));
            expect(succeeded).toBe(false);
        });

        test("should trigger success on touch pointerUp", () => {
            let succeeded = false;
            controller.onCompleted(() => {
                succeeded = true;
            });

            const pointData: PointSnapData = {
                featurePoints: [{ point: new XYZ({ x: -300, y: -100, z: 0 }), prompt: "test" }],
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());
            handler.pointerUp(view, createPointerEvent({ pointerType: "touch", isPrimary: true }));
            expect(succeeded).toBe(true);
        });

        test("pointerOut should clear snapped", () => {
            const pointData: PointSnapData = {
                featurePoints: [{ point: new XYZ({ x: -300, y: -100, z: 0 }), prompt: "test" }],
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());
            expect(handler.snaped).toBeDefined();
            handler.pointerOut(view, createPointerEvent());
            expect(handler.snaped).toBeUndefined();
        });

        test("mouseWheel should call view.update", () => {
            let updated = false;
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView({
                update: () => {
                    updated = true;
                },
            });
            handler.mouseWheel(view, { deltaY: 120 } as WheelEvent);
            expect(updated).toBe(true);
        });
    });

    // --------------------------------------------------------------------------
    // Feature point filtering
    // --------------------------------------------------------------------------

    describe("feature point filtering", () => {
        test("should skip feature points when when() returns false", () => {
            // Point A with when: false, Point B with when: undefined → only B matches
            const pointData: PointSnapData = {
                featurePoints: [
                    {
                        point: new XYZ({ x: 100, y: 0, z: 0 }),
                        prompt: "skipped",
                        when: () => false,
                    },
                    {
                        point: new XYZ({ x: -300, y: -100, z: 0 }),
                        prompt: "selected",
                    },
                ],
            };

            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());

            const snaped = handler.snaped;
            expect(snaped).toBeDefined();
            expect(snaped!.info).toBe("selected");
        });

        test("should include feature points when when() returns true", () => {
            const pointData: PointSnapData = {
                featurePoints: [
                    {
                        point: new XYZ({ x: -300, y: -100, z: 0 }),
                        prompt: "included",
                        when: () => true,
                    },
                ],
            };

            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.pointerMove(view, createPointerEvent());

            expect(handler.snaped).toBeDefined();
            expect(handler.snaped!.info).toBe("included");
        });
    });

    // --------------------------------------------------------------------------
    // onKeyDown callback
    // --------------------------------------------------------------------------

    describe("onKeyDown callback", () => {
        test("should call data.onKeyDown on key press", () => {
            let callbackCalled = false;
            const pointData: PointSnapData = {
                onKeyDown: () => {
                    callbackCalled = true;
                },
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();
            handler.keyDown(view, { key: "Tab" } as KeyboardEvent);
            expect(callbackCalled).toBe(true);
        });
    });

    // --------------------------------------------------------------------------
    // Snap prompt formatting
    // --------------------------------------------------------------------------

    describe("snap prompt formatting", () => {
        test("should format prompt from data.prompt callback", () => {
            const pointData: PointSnapData = {
                prompt: () => "custom prompt",
            };
            const handler = new PointSnapEventHandler(document, controller, pointData);
            const view = createHandlerMockView();

            const result = handler["formatSnapPrompt"]({
                view,
                point: XYZ.zero,
                shapes: [],
                type: "vertex",
                info: "test info",
            });

            expect(result).toBeDefined();
            if (result && typeof result === "object" && "msg" in result) {
                expect(result.msg).toContain("custom prompt");
            }
        });

        test("should include distance in prompt when no custom prompt", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            const view = createHandlerMockView();

            const result = handler["formatSnapPrompt"]({
                view,
                point: XYZ.zero,
                shapes: [],
                type: "vertex",
                info: "test info",
                distance: 42.5,
            });

            expect(result).toBeDefined();
            if (result && typeof result === "object" && "msg" in result) {
                expect(result.msg).toContain("42.50");
            }
        });
    });

    // --------------------------------------------------------------------------
    // isEnabled
    // --------------------------------------------------------------------------

    describe("isEnabled", () => {
        test("should be enabled by default", () => {
            const handler = new PointSnapEventHandler(document, controller, {});
            expect(handler.isEnabled).toBe(true);
        });
    });
});
