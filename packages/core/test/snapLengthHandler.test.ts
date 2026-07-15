// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, XYZ } from "../src";
import { Plane } from "../src/math";
import {
    type LengthAtAxisSnapData,
    SnapLengthAtAxisHandler,
    type SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "../src/snap/handlers/lengthSnapEventHandler";
import { createHandlerMockView, TestDocument } from "./mocks";

// ============================================================================
// SnapLengthAtAxisHandler
// ============================================================================

describe("SnapLengthAtAxisHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should be created with length data", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };

        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        expect(handler).toBeDefined();
        expect(handler.isEnabled).toBe(true);
    });

    test("should cancel on Escape key", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };
        const view = createHandlerMockView();

        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(gotCancelled).toBe(true);
    });

    test("should enter inputing state on numeric keyDown", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };
        const view = createHandlerMockView();

        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        handler.keyDown(view, { key: "1" } as KeyboardEvent);

        expect(handler.state).toBe("inputing");
    });

    test("should handle mouse wheel without error", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };
        const view = createHandlerMockView();

        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        expect(() => {
            handler.mouseWheel(view, { deltaY: 120 } as WheelEvent);
        }).not.toThrow();
    });

    test("should handle dispose", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };

        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// SnapLengthAtPlaneHandler
// ============================================================================

describe("SnapLengthAtPlaneHandler", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should be created with length data", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };

        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        expect(handler).toBeDefined();
        expect(handler.isEnabled).toBe(true);
    });

    test("should cancel on Escape key", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        let gotCancelled = false;
        controller.onCancelled(() => {
            gotCancelled = true;
        });

        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        handler.keyDown(view, { key: "Escape" } as KeyboardEvent);

        expect(gotCancelled).toBe(true);
    });

    test("should handle mouse wheel without error", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };
        const view = createHandlerMockView();

        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        expect(() => {
            handler.mouseWheel(view, { deltaY: 120 } as WheelEvent);
        }).not.toThrow();
    });

    test("should handle dispose", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };

        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        handler.dispose();
        expect(handler.state).toBe("completed");
    });
});

// ============================================================================
// SnapLengthAtAxisHandler — getPointFromInput
// ============================================================================

describe("SnapLengthAtAxisHandler — getPointFromInput", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should calculate point along positive direction for positive input", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };
        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "10");
        expect(result.point!.x).toBe(10);
        expect(result.point!.y).toBe(0);
        expect(result.point!.z).toBe(0);
        expect(result.distance).toBe(10);
    });

    test("should calculate point with negative distance when snapped is on negative side", () => {
        const lengthData: LengthAtAxisSnapData = {
            point: XYZ.zero,
            direction: XYZ.unitX,
        };
        const handler = new SnapLengthAtAxisHandler(document, controller, lengthData);
        // Set snapped point on negative X side
        (handler as unknown as { _snaped: { point: XYZ } })._snaped = {
            point: new XYZ({ x: -1, y: 0, z: 0 }),
        };
        const view = createHandlerMockView();
        const result = handler["getPointFromInput"](view, "10");
        expect(result.point!.x).toBe(-10);
        // distance should be the absolute value
        expect(Math.abs(result.distance!)).toBe(10);
    });
});

// ============================================================================
// SnapLengthAtAxisHandler — inputError
// ============================================================================

describe("SnapLengthAtAxisHandler — inputError", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should return error for non-numeric input", () => {
        const handler = new SnapLengthAtAxisHandler(document, controller, {
            point: XYZ.zero,
            direction: XYZ.unitX,
        });
        expect(handler["inputError"]("abc")).toBe("error.input.invalidNumber");
    });

    test("should return no error for valid numeric input", () => {
        const handler = new SnapLengthAtAxisHandler(document, controller, {
            point: XYZ.zero,
            direction: XYZ.unitX,
        });
        expect(handler["inputError"]("10")).toBeUndefined();
        expect(handler["inputError"]("-5.5")).toBeUndefined();
    });
});

// ============================================================================
// SnapLengthAtPlaneHandler — getPointFromInput + inputError
// ============================================================================

describe("SnapLengthAtPlaneHandler — getPointFromInput", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should calculate point from single distance", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };
        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        (handler as unknown as { _snaped: { point: XYZ } })._snaped = {
            point: new XYZ({ x: 10, y: 0, z: 0 }),
        };
        const view = createHandlerMockView({ workplane: Plane.XY });
        const result = handler["getPointFromInput"](view, "5");
        expect(result.point).toBeDefined();
        expect(result.plane).toBeDefined();
    });

    test("should calculate point from two coordinates", () => {
        const lengthData: SnapLengthAtPlaneData = {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        };
        const handler = new SnapLengthAtPlaneHandler(document, controller, lengthData);
        const view = createHandlerMockView({ workplane: Plane.XY });
        const result = handler["getPointFromInput"](view, "10,20");
        expect(result.point).toBeDefined();
        expect(result.point!.x).toBe(10);
        expect(result.point!.y).toBe(20);
    });
});

describe("SnapLengthAtPlaneHandler — inputError", () => {
    let document: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        document = new TestDocument();
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    test("should return error for non-numeric input", () => {
        const handler = new SnapLengthAtPlaneHandler(document, controller, {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        expect(handler["inputError"]("abc")).toBe("error.input.invalidNumber");
    });

    test("should return error for three numbers (unsupported)", () => {
        const handler = new SnapLengthAtPlaneHandler(document, controller, {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        expect(handler["inputError"]("1,2,3")).toBe("error.input.invalidNumber");
    });

    test("should return no error for single number", () => {
        const handler = new SnapLengthAtPlaneHandler(document, controller, {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        expect(handler["inputError"]("10")).toBeUndefined();
    });

    test("should return no error for two numbers", () => {
        const handler = new SnapLengthAtPlaneHandler(document, controller, {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        expect(handler["inputError"]("10,20")).toBeUndefined();
    });
});
