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
