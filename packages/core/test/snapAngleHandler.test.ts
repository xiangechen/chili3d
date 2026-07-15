// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, XYZ } from "../src";
import { Plane } from "../src/math";
import { AngleSnapEventHandler } from "../src/snap/handlers/angleSnapEventHandler";
import type { PointSnapData } from "../src/snap/handlers/pointSnapEventHandler";
import { createHandlerMockView, createPointerEvent, TestDocument } from "./mocks";

// ============================================================================
// AngleSnapEventHandler
// ============================================================================

describe("AngleSnapEventHandler", () => {
    const center = () => XYZ.zero;
    const p1 = XYZ.unitX;

    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should require a plane in snap point data", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        expect(handler).toBeDefined();
    });

    test("should throw if plane is not provided", () => {
        const snapPointData: PointSnapData = {};

        expect(() => {
            new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        }).toThrow("AngleSnapEventHandler: no plane");
    });

    test("should cancel on Escape key", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(gotCancelled).toBe(true);
    });

    test("should enter inputing state on numeric keyDown", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        handler.keyDown(view, { key: "4" } as KeyboardEvent);

        expect(handler.state).toBe("inputing");
    });

    test("should handle mouse wheel without error", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        expect(() => {
            handler.mouseWheel(view, { deltaY: 120 } as WheelEvent);
        }).not.toThrow();
    });

    test("should clear snapped on pointerOut", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        // Prime the snapped state so the test can actually verify it was cleared
        (handler as unknown as { _snaped: unknown })._snaped = { point: XYZ.zero };
        expect(handler.snaped).toBeDefined();

        handler.pointerOut(view, createPointerEvent());

        expect(handler.snaped).toBeUndefined();
    });

    test("should handle dispose", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };

        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// AngleSnapEventHandler — getPointFromInput + inputError
// ============================================================================

describe("AngleSnapEventHandler — getPointFromInput", () => {
    const center = () => XYZ.zero;
    const p1 = XYZ.unitX;

    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should calculate point at 90 degrees from P1 around center", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "90");
        expect(result.point).toBeDefined();
        // At 90 degrees, x should be ~0, y should be ~1 (rotated from X unit vector)
        expect(result.point!.x).toBeCloseTo(0, 5);
        expect(result.point!.y).toBeCloseTo(1, 5);
    });

    test("should calculate point at 180 degrees", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "180");
        expect(result.point).toBeDefined();
        expect(result.point!.x).toBeCloseTo(-1, 5);
        expect(result.point!.y).toBeCloseTo(0, 5);
    });

    test("should calculate point at 0 degrees (same as P1)", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "0");
        expect(result.point).toBeDefined();
        expect(result.point!.x).toBeCloseTo(1, 5);
        expect(result.point!.y).toBeCloseTo(0, 5);
    });
});

describe("AngleSnapEventHandler — inputError", () => {
    const center = () => XYZ.zero;
    const p1 = XYZ.unitX;

    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should return error for non-numeric angle input", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        expect(handler["inputError"]("abc")).toBe("error.input.invalidNumber");
    });

    test("should return no error for valid angle input", () => {
        const snapPointData: PointSnapData = {
            plane: () => Plane.XY,
        };
        const handler = new AngleSnapEventHandler(document, controller, center, p1, snapPointData);
        expect(handler["inputError"]("45")).toBeUndefined();
        expect(handler["inputError"]("-30.5")).toBeUndefined();
    });
});
