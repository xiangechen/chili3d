// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, PubSub, XYZ } from "../src";
import { Line, Plane } from "../src/math";
import type {
    PointSnapData,
    SnapPointOnAxisData,
    SnapPointOnCurveData,
} from "../src/snap/handlers/pointSnapEventHandler";
import {
    PointSnapEventHandler,
    SnapPointOnAxisEventHandler,
    SnapPointOnCurveEventHandler,
    SnapPointPlaneEventHandler,
} from "../src/snap/handlers/pointSnapEventHandler";
import { createHandlerMockView, createMockCurve, createPointerEvent, TestDocument } from "./mocks";

// ============================================================================
// PointSnapEventHandler
// ============================================================================

describe("PointSnapEventHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should be created with document, controller, and point data", () => {
        const pointData: PointSnapData = {
            dimension: 0b011,
            refPoint: () => XYZ.zero,
        };

        const handler = new PointSnapEventHandler(document, controller, pointData);
        expect(handler.state).toBe("idle");
        expect(handler.isEnabled).toBe(true);
    });

    test("should update state to snapping on pointerMove", () => {
        const pointData: PointSnapData = {};
        const view = createHandlerMockView();

        const handler = new PointSnapEventHandler(document, controller, pointData);
        handler.pointerMove(view, createPointerEvent());
        expect(handler.state).toBe("snapping");
    });

    test("should handle cancel on Escape key", () => {
        const pointData: PointSnapData = {};

        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new PointSnapEventHandler(document, controller, pointData);
        const view = createHandlerMockView();

        handler.pointerMove(view, createPointerEvent());
        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(handler.state).toBe("cancelled");
        expect(gotCancelled).toBe(true);
    });

    test("should handle success on pointerDown with snapped point", () => {
        // Feature point at world (-300, -100, 0) maps to screen (100, 200)
        const pointData: PointSnapData = {
            featurePoints: [
                {
                    point: new XYZ({ x: -300, y: -100, z: 0 }),
                    prompt: "test point",
                },
            ],
        };

        let gotSuccess = false;
        controller.onCompleted(() => {
            gotSuccess = true;
        });

        const handler = new PointSnapEventHandler(document, controller, pointData);
        const view = createHandlerMockView();

        handler.pointerMove(view, createPointerEvent());
        handler.pointerDown(view, createPointerEvent({ button: 0 }));

        expect(handler.state).toBe("completed");
        expect(gotSuccess).toBe(true);
    });

    test("should show toast when pointerDown without snapped point", () => {
        const pointData: PointSnapData = {};

        let toastMessage: string | undefined;
        PubSub.default.sub("showToast", (message: string) => {
            toastMessage = message;
        });

        const handler = new PointSnapEventHandler(document, controller, pointData);
        const view = createHandlerMockView();

        handler.pointerDown(view, createPointerEvent({ button: 0 }));

        expect(toastMessage).toBe("toast.snap.notFoundValidPoint");
    });

    test("should handle pointerUp for non-mouse (touch) events", () => {
        const pointData: PointSnapData = {
            featurePoints: [
                {
                    point: new XYZ({ x: -300, y: -100, z: 0 }),
                    prompt: "test",
                },
            ],
        };

        let gotSuccess = false;
        controller.onCompleted(() => {
            gotSuccess = true;
        });

        const handler = new PointSnapEventHandler(document, controller, pointData);
        const view = createHandlerMockView();

        handler.pointerMove(view, createPointerEvent());
        handler.pointerUp(view, createPointerEvent({ pointerType: "touch", isPrimary: true }));

        expect(gotSuccess).toBe(true);
    });

    test("should handle dispose correctly", () => {
        const pointData: PointSnapData = {};

        const handler = new PointSnapEventHandler(document, controller, pointData);
        expect(() => handler.dispose()).not.toThrow();
        expect(handler.state).toBe("completed");
    });

    test("should handle pointerOut by clearing snapped", () => {
        const pointData: PointSnapData = {};
        const view = createHandlerMockView();

        const handler = new PointSnapEventHandler(document, controller, pointData);
        handler.pointerMove(view, createPointerEvent());
        handler.pointerOut(view, createPointerEvent());

        expect(handler.snaped).toBeUndefined();
    });

    test("should cancel on Enter key", () => {
        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new PointSnapEventHandler(document, controller, {});
        const view = createHandlerMockView();

        handler.keyDown(view, {
            key: "Enter",
            preventDefault: () => {},
            stopImmediatePropagation: () => {},
        } as unknown as KeyboardEvent);

        expect(gotCancelled).toBe(true);
    });

    test("should handle numeric input keyDown", () => {
        const pointData: PointSnapData = {
            dimension: 0b111,
            refPoint: () => XYZ.zero,
        };
        const view = createHandlerMockView();

        const handler = new PointSnapEventHandler(document, controller, pointData);
        handler.keyDown(view, { key: "5" } as KeyboardEvent);

        expect(handler.state).toBe("inputing");
    });
});

// ============================================================================
// SnapPointOnCurveEventHandler
// ============================================================================

describe("SnapPointOnCurveEventHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should be created with curve snap data", () => {
        const curve = createMockCurve();
        const pointData: SnapPointOnCurveData = { curve };

        const handler = new SnapPointOnCurveEventHandler(document, controller, pointData);
        expect(handler.isEnabled).toBe(true);
    });

    test("should handle pointer events without error", () => {
        const curve = createMockCurve();
        const pointData: SnapPointOnCurveData = { curve };
        const view = createHandlerMockView();

        const handler = new SnapPointOnCurveEventHandler(document, controller, pointData);
        expect(() => handler.pointerMove(view, createPointerEvent())).not.toThrow();
    });

    test("should handle dispose", () => {
        const curve = createMockCurve();
        const pointData: SnapPointOnCurveData = { curve };

        const handler = new SnapPointOnCurveEventHandler(document, controller, pointData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// SnapPointOnAxisEventHandler
// ============================================================================

describe("SnapPointOnAxisEventHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should be created with axis snap data", () => {
        const ray = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const pointData: SnapPointOnAxisData = { ray };

        const handler = new SnapPointOnAxisEventHandler(document, controller, pointData);
        expect(handler).toBeDefined();
    });

    test("should handle pointerMove without error", () => {
        const ray = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const pointData: SnapPointOnAxisData = { ray };
        const view = createHandlerMockView();

        const handler = new SnapPointOnAxisEventHandler(document, controller, pointData);
        expect(() => handler.pointerMove(view, createPointerEvent())).not.toThrow();
    });

    test("should cancel on Escape key", () => {
        const ray = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const pointData: SnapPointOnAxisData = { ray };
        const view = createHandlerMockView();

        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new SnapPointOnAxisEventHandler(document, controller, pointData);
        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(gotCancelled).toBe(true);
    });

    test("should handle dispose", () => {
        const ray = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const pointData: SnapPointOnAxisData = { ray };

        const handler = new SnapPointOnAxisEventHandler(document, controller, pointData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// SnapPointPlaneEventHandler
// ============================================================================

describe("SnapPointPlaneEventHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should require a plane in point data", () => {
        const pointData: PointSnapData = {
            plane: () => Plane.XY,
        };

        const handler = new SnapPointPlaneEventHandler(document, controller, pointData);
        expect(handler).toBeDefined();
    });

    test("should throw if plane is not provided", () => {
        const pointData: PointSnapData = {};

        expect(() => {
            new SnapPointPlaneEventHandler(document, controller, pointData);
        }).toThrow("plane is required");
    });

    test("should project snapped point onto plane", () => {
        const pointData: PointSnapData = {
            plane: () => Plane.XY,
            featurePoints: [
                {
                    point: new XYZ({ x: -300, y: -100, z: 0 }),
                    prompt: "test",
                },
            ],
        };
        const view = createHandlerMockView();

        const handler = new SnapPointPlaneEventHandler(document, controller, pointData);
        handler.pointerMove(view, createPointerEvent());

        const snaped = handler.snaped;
        expect(snaped).toBeDefined();
        if (snaped?.point) {
            // Should be projected to XY plane (z=0)
            expect(snaped.point.z).toBe(0);
        }
    });

    test("should handle dispose", () => {
        const pointData: PointSnapData = { plane: () => Plane.XY };

        const handler = new SnapPointPlaneEventHandler(document, controller, pointData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// PointSnapEventHandler — getPointFromInput
// ============================================================================

describe("PointSnapEventHandler — getPointFromInput", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should parse absolute coordinates with # prefix", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
        });
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "#10,20,30");
        expect(result.point!.x).toBe(10);
        expect(result.point!.y).toBe(20);
        expect(result.point!.z).toBe(30);
        expect(result.type).toBe("input");
    });

    test("should parse relative 2D coordinates from plane", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b011,
            refPoint: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        const view = createHandlerMockView({ workplane: Plane.XY });
        const result = handler["getPointFromInput"](view, "10,5");
        expect(result.point!.x).toBe(10);
        expect(result.point!.y).toBe(5);
        expect(result.point!.z).toBe(0);
    });

    test("should parse relative 3D coordinates from plane", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
            refPoint: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        const view = createHandlerMockView({ workplane: Plane.XY });
        const result = handler["getPointFromInput"](view, "10,5,20");
        expect(result.point!.z).toBe(20);
    });

    test("should calculate point from single distance along snapped direction", () => {
        // Set up handler with a snapped point
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
            refPoint: () => XYZ.zero,
        });
        const view = createHandlerMockView();
        // Manually set snapped
        (handler as unknown as { _snaped: { point: XYZ } })._snaped = {
            point: new XYZ({ x: 10, y: 0, z: 0 }),
        };
        const result = handler["getPointFromInput"](view, "20");
        expect(result.point!.x).toBeCloseTo(20, 5);
    });
});

// ============================================================================
// PointSnapEventHandler — inputError
// ============================================================================

describe("PointSnapEventHandler — inputError", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should return error for absolute coordinates that are not 3 numbers", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
        });
        expect(handler["inputError"]("#10,20")).toBe("error.input.threeNumberCanBeInput");
    });

    test("should return no error for valid absolute 3D coordinates", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
        });
        expect(handler["inputError"]("#10,20,30")).toBeUndefined();
    });

    test("should return error for unsupported dimension", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b001, // Only D1
            refPoint: () => XYZ.zero,
        });
        // Input "10,20" is D1D2, but handler only allows D1
        expect(handler["inputError"]("10,20")).toBe("error.input.unsupportedInputs");
    });

    test("should return error for NaN input", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111,
        });
        expect(handler["inputError"]("abc,def")).toBe("error.input.invalidNumber");
    });

    test("should return error when no refPoint and input has not 3 numbers", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b111, // Allow D1
        });
        // Input "10" is valid D1 dimension, but requiresThreeNumbers triggers because refPoint is undefined
        expect(handler["inputError"]("10")).toBe("error.input.threeNumberCanBeInput");
    });

    test("should return error for single number when snapped equals refPoint", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b001,
            refPoint: () => XYZ.zero,
        });
        (handler as unknown as { _snaped: { refPoint: XYZ; point: XYZ } })._snaped = {
            refPoint: XYZ.zero,
            point: XYZ.zero,
        };
        expect(handler["inputError"]("10")).toBe("error.input.cannotInputANumber");
    });

    test("should return no error for valid single number with snapped different from refPoint", () => {
        const handler = new PointSnapEventHandler(document, controller, {
            dimension: 0b001,
            refPoint: () => XYZ.zero,
        });
        (handler as unknown as { _snaped: { refPoint: XYZ; point: XYZ } })._snaped = {
            refPoint: XYZ.zero,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
        };
        expect(handler["inputError"]("10")).toBeUndefined();
    });
});
