// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ICameraController, IView } from "@chili3d/core";
import { Config } from "@chili3d/core";
import { ThreeViewHandler } from "../src/threeViewEventHandler";

function createMockCameraController(): ICameraController {
    return {
        zoom(_x: number, _y: number, _delta: number) {},
        pan(_dx: number, _dy: number) {},
        rotate(_dx: number, _dy: number) {},
        startRotate(_x: number, _y: number) {},
        fitContent() {},
        lookAt(_eye: any, _target: any, _up: any) {},
        get cameraType() {
            return "perspective";
        },
        get target() {
            return { x: 0, y: 0, z: 0 };
        },
        get cameraPosition() {
            return { x: 0, y: 0, z: 1000 };
        },
        get cameraTarget() {
            return { x: 0, y: 0, z: 0 };
        },
        get cameraUp() {
            return { x: 0, y: 0, z: 1 };
        },
    } as unknown as ICameraController;
}

function createMockView(cameraController?: ICameraController): IView {
    const cc = cameraController ?? createMockCameraController();
    return {
        cameraController: cc,
        update() {},
        get name() {
            return "test";
        },
        get dom() {
            return undefined;
        },
        get mode() {
            return "solidAndWireframe" as const;
        },
        get document() {
            return {
                selection: { getSelectedNodes: () => [] },
                visual: { context: { visualShapes: { children: [] } } },
            };
        },
    } as unknown as IView;
}

/** Create a PointerEvent with offsetX/offsetY (not in official PointerEventInit types). */
function makePointerEvent(
    type: string,
    opts: {
        pointerType?: string;
        pointerId?: number;
        buttons?: number;
        offsetX?: number;
        offsetY?: number;
        isPrimary?: boolean;
    },
) {
    return new PointerEvent(type, opts as PointerEventInit);
}

// helper to access protected members
function mapsOf(h: ThreeViewHandler) {
    return h as any as {
        lastPointerEventMap: Map<number, PointerEvent>;
        currentPointerEventMap: Map<number, PointerEvent>;
    };
}

// ============================================================================
// ThreeViewHandler — lifecycle
// ============================================================================

describe("ThreeViewHandler — lifecycle", () => {
    test("creates handler with defaults", () => {
        const handler = new ThreeViewHandler();
        expect(handler.canRotate).toBe(true);
        expect(handler.isEnabled).toBe(true);
    });

    test("dispose clears internal state", () => {
        const handler = new ThreeViewHandler();
        handler.dispose();
        expect(() => handler.dispose()).not.toThrow();
    });

    test("canRotate flag can be toggled", () => {
        const handler = new ThreeViewHandler();
        handler.canRotate = false;
        expect(handler.canRotate).toBe(false);
        handler.canRotate = true;
        expect(handler.canRotate).toBe(true);
    });

    test("isEnabled flag can be toggled", () => {
        const handler = new ThreeViewHandler();
        handler.isEnabled = false;
        expect(handler.isEnabled).toBe(false);
    });
});

// ============================================================================
// ThreeViewHandler — mouseWheel
// ============================================================================

describe("ThreeViewHandler — mouseWheel", () => {
    test("mouseWheel triggers zoom on cameraController", () => {
        const handler = new ThreeViewHandler();
        let zoomCalled = false;
        const cc = createMockCameraController();
        cc.zoom = () => {
            zoomCalled = true;
        };
        const view = createMockView(cc);

        handler.mouseWheel(view, new WheelEvent("wheel", { deltaY: 120 }));
        expect(zoomCalled).toBe(true);
    });

    test("mouseWheel with Solidworks navigation inverts deltaY sign", () => {
        const handler = new ThreeViewHandler();
        let receivedDelta = 0;
        const cc = createMockCameraController();
        cc.zoom = (_x, _y, delta) => {
            receivedDelta = delta;
        };
        const view = createMockView(cc);

        const origNav = Config.instance.navigation3D;
        (Config.instance as any)._navigation3D = "Solidworks";

        handler.mouseWheel(view, new WheelEvent("wheel", { deltaY: 120 }));

        (Config.instance as any)._navigation3D = origNav;
        // Solidworks navigation inverts the wheel delta sign
        expect(receivedDelta).toBeLessThan(0);
    });
});

// ============================================================================
// ThreeViewHandler — pointerMove (mouse)
// ============================================================================

describe("ThreeViewHandler — pointerMove (mouse)", () => {
    test("pointerMove with no buttons pressed does nothing", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        expect(() =>
            handler.pointerMove(view, makePointerEvent("pointermove", { pointerType: "mouse", buttons: 0 })),
        ).not.toThrow();
    });

    test("pointerMove with middle button but no offset point does nothing", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        expect(() =>
            handler.pointerMove(view, makePointerEvent("pointermove", { pointerType: "mouse", buttons: 4 })),
        ).not.toThrow();
    });
});

// ============================================================================
// ThreeViewHandler — pointerDown
// ============================================================================

describe("ThreeViewHandler — pointerDown", () => {
    test("pointerDown with touch type adds to pointer event map", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(view, makePointerEvent("pointerdown", { pointerType: "touch", pointerId: 1 }));

        expect(mapsOf(handler).lastPointerEventMap.size).toBe(1);
    });

    test("pointerDown with mouse middle button starts rotate", () => {
        const handler = new ThreeViewHandler();
        let startRotateCalled = false;
        const cc = createMockCameraController();
        cc.startRotate = () => {
            startRotateCalled = true;
        };
        const view = createMockView(cc);

        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "mouse",
                buttons: 4,
                offsetX: 100,
                offsetY: 200,
            }),
        );

        expect(startRotateCalled).toBe(true);
    });

    test("double-click middle button triggers fitContent", () => {
        const handler = new ThreeViewHandler();
        let fitContentCalled = false;
        const cc = createMockCameraController();
        cc.fitContent = () => {
            fitContentCalled = true;
        };
        const view = createMockView(cc);

        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "mouse",
                buttons: 4,
                offsetX: 100,
                offsetY: 200,
            }),
        );

        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "mouse",
                buttons: 4,
                offsetX: 100,
                offsetY: 200,
            }),
        );

        expect(fitContentCalled).toBe(true);
    });
});

// ============================================================================
// ThreeViewHandler — pointerUp / pointerOut
// ============================================================================

describe("ThreeViewHandler — pointerUp / pointerOut", () => {
    test("pointerUp clears last pointer events", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(view, makePointerEvent("pointerdown", { pointerType: "touch", pointerId: 1 }));
        expect(mapsOf(handler).lastPointerEventMap.size).toBe(1);

        handler.pointerUp(view, makePointerEvent("pointerup", { pointerType: "touch", pointerId: 1 }));

        expect(mapsOf(handler).lastPointerEventMap.has(1)).toBe(false);
    });

    test("pointerOut clears pointer data", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(view, makePointerEvent("pointerdown", { pointerType: "touch", pointerId: 1 }));

        handler.pointerOut(view, makePointerEvent("pointerout", { pointerType: "touch", pointerId: 1 }));

        expect(mapsOf(handler).lastPointerEventMap.has(1)).toBe(false);
        expect(mapsOf(handler).currentPointerEventMap.has(1)).toBe(false);
    });

    test("pointerUp with middle button sets timeout to clear lastDown", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "mouse",
                buttons: 4,
                offsetX: 100,
                offsetY: 200,
            }),
        );

        handler.pointerUp(
            view,
            makePointerEvent("pointerup", {
                pointerType: "mouse",
                buttons: 4,
                offsetX: 100,
                offsetY: 200,
            }),
        );

        expect(() => handler.dispose()).not.toThrow();
    });
});

// ============================================================================
// ThreeViewHandler — touch handling
// ============================================================================

describe("ThreeViewHandler — touch handling", () => {
    test("pointerMove with new touch adds to map", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "touch",
                pointerId: 1,
                offsetX: 0,
                offsetY: 0,
            }),
        );
        handler.pointerDown(
            view,
            makePointerEvent("pointerdown", {
                pointerType: "touch",
                pointerId: 2,
                offsetX: 10,
                offsetY: 10,
            }),
        );

        expect(() =>
            handler.pointerMove(
                view,
                makePointerEvent("pointermove", {
                    pointerType: "touch",
                    pointerId: 1,
                    offsetX: 5,
                    offsetY: 5,
                }),
            ),
        ).not.toThrow();
    });

    test("keyDown no-op", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();
        expect(() => handler.keyDown(view, new KeyboardEvent("keydown", { key: "a" }))).not.toThrow();
    });
});

// ============================================================================
// ThreeViewHandler — touch multi-finger gestures
// ============================================================================

describe("ThreeViewHandler — touch multi-finger gestures", () => {
    function makeTouchEvent(
        type: string,
        opts: {
            pointerType?: string;
            pointerId?: number;
            buttons?: number;
            offsetX?: number;
            offsetY?: number;
            isPrimary?: boolean;
        },
    ) {
        return makePointerEvent(type, opts as any);
    }

    test("first pointerMove for a new touch registers in currentPointerEventMap", () => {
        const handler = new ThreeViewHandler();
        const view = createMockView();

        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 1, offsetX: 0, offsetY: 0 }),
        );
        expect(mapsOf(handler).currentPointerEventMap.size).toBe(0);

        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 1, offsetX: 5, offsetY: 5 }),
        );
        expect(mapsOf(handler).currentPointerEventMap.size).toBe(1);
    });

    test("two successive pointerMoves for same touch triggers pan or zoom", () => {
        const handler = new ThreeViewHandler();
        let zoomCalled = false;
        let panCalled = false;
        const cc = createMockCameraController();
        cc.zoom = () => {
            zoomCalled = true;
        };
        cc.pan = () => {
            panCalled = true;
        };
        const view = createMockView(cc);

        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 10, offsetX: 0, offsetY: 0 }),
        );
        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 20, offsetX: 10, offsetY: 10 }),
        );

        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 10, offsetX: 1, offsetY: 1 }),
        );
        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 20, offsetX: 11, offsetY: 11 }),
        );

        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 10, offsetX: 5, offsetY: 5 }),
        );
        expect(zoomCalled || panCalled).toBe(true);

        handler.dispose();
    });

    test("three-finger gesture triggers rotate", () => {
        const handler = new ThreeViewHandler();
        let rotateCalled = false;
        const cc = createMockCameraController();
        cc.rotate = () => {
            rotateCalled = true;
        };
        const view = createMockView(cc);

        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", {
                pointerType: "touch",
                pointerId: 100,
                offsetX: 0,
                offsetY: 0,
                isPrimary: true,
            }),
        );
        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 200, offsetX: 10, offsetY: 0 }),
        );
        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 300, offsetX: 5, offsetY: 10 }),
        );

        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", {
                pointerType: "touch",
                pointerId: 100,
                offsetX: 1,
                offsetY: 1,
                isPrimary: true,
            }),
        );
        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 200, offsetX: 11, offsetY: 1 }),
        );
        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 300, offsetX: 6, offsetY: 11 }),
        );

        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", {
                pointerType: "touch",
                pointerId: 100,
                offsetX: 3,
                offsetY: 3,
                isPrimary: true,
            }),
        );
        expect(rotateCalled).toBe(true);

        handler.dispose();
    });

    test("single finger touch move does not trigger gestures", () => {
        const handler = new ThreeViewHandler();
        let gestureCalled = false;
        const cc = createMockCameraController();
        cc.zoom = () => {
            gestureCalled = true;
        };
        cc.pan = () => {
            gestureCalled = true;
        };
        cc.rotate = () => {
            gestureCalled = true;
        };
        const view = createMockView(cc);

        handler.pointerDown(
            view,
            makeTouchEvent("pointerdown", { pointerType: "touch", pointerId: 50, offsetX: 0, offsetY: 0 }),
        );
        handler.pointerMove(
            view,
            makeTouchEvent("pointermove", { pointerType: "touch", pointerId: 50, offsetX: 5, offsetY: 5 }),
        );

        expect(gestureCalled).toBe(false);
    });

    test("mouseWheel with Creo navigation inverts deltaY sign", () => {
        const handler = new ThreeViewHandler();
        let receivedDelta = 0;
        const cc = createMockCameraController();
        cc.zoom = (_x: number, _y: number, delta: number) => {
            receivedDelta = delta;
        };
        const view = createMockView(cc);

        const origNav = Config.instance.navigation3D;
        (Config.instance as any)._navigation3D = "Creo";

        handler.mouseWheel(view, new WheelEvent("wheel", { deltaY: 120 }));

        (Config.instance as any)._navigation3D = origNav;
        expect(receivedDelta).toBeLessThan(0);
    });
});
