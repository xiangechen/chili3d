// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, Precision, XYZ } from "../../src";
import { Plane } from "../../src/math";
import type { PointSnapData, SnapPointOnAxisData, SnapPointOnCurveData } from "../../src/snap";
import {
    PointSnapEventHandler,
    SnapPointOnAxisEventHandler,
    SnapPointOnCurveEventHandler,
    SnapPointPlaneEventHandler,
} from "../../src/snap";
import { PointOnAxisStep, PointOnCurveStep, PointOnPlaneStep, PointStep } from "../../src/step";
import { TestDocument } from "../mocks";

function tip(): string {
    return "test.tip" as unknown as string;
}

// ============================================================================
// PointStep
// ============================================================================

describe("PointStep", () => {
    test("should use default dimension D1 | D1D2D3", () => {
        const step = new PointStep(tip() as never);
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, {});
        expect(handler).toBeInstanceOf(PointSnapEventHandler);
        controller.dispose();
    });

    test("validator should return true when refPoint is undefined", () => {
        const step = new PointStep(tip() as never);
        const data: PointSnapData = {};
        const point = new XYZ({ x: 0, y: 0, z: 0 });
        expect(step["validator"](data, point)).toBe(true);
    });

    test("validator should return true when distance > Precision.Distance", () => {
        const step = new PointStep(tip() as never);
        const refPoint = () => XYZ.zero;
        const data: PointSnapData = { refPoint };
        const farPoint = new XYZ({ x: 100, y: 0, z: 0 });
        expect(step["validator"](data, farPoint)).toBe(true);
    });

    test("validator should return false when distance <= Precision.Distance", () => {
        const step = new PointStep(tip() as never);
        const refPoint = () => XYZ.zero;
        const data: PointSnapData = { refPoint };
        const nearPoint = new XYZ({ x: Precision.Distance / 2, y: 0, z: 0 });
        expect(step["validator"](data, nearPoint)).toBe(false);
    });

    test("getEventHandler should return PointSnapEventHandler", () => {
        const step = new PointStep(tip() as never);
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, {});
        expect(handler).toBeInstanceOf(PointSnapEventHandler);
        controller.dispose();
    });
});

// ============================================================================
// PointOnCurveStep
// ============================================================================

describe("PointOnCurveStep", () => {
    test("validator should always return true", () => {
        const curve = {} as never;
        const step = new PointOnCurveStep(tip() as never, () => ({ curve }));
        const data: SnapPointOnCurveData = { curve };
        expect(step["validator"](data, XYZ.zero)).toBe(true);
        expect(step["validator"](data, new XYZ({ x: 100, y: 200, z: 300 }))).toBe(true);
    });

    test("getEventHandler should return SnapPointOnCurveEventHandler", () => {
        const curve = {} as never;
        const step = new PointOnCurveStep(tip() as never, () => ({ curve }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, { curve });
        expect(handler).toBeInstanceOf(SnapPointOnCurveEventHandler);
        controller.dispose();
    });
});

// ============================================================================
// PointOnAxisStep
// ============================================================================

describe("PointOnAxisStep", () => {
    test("validator should always return true", () => {
        const ray = { point: XYZ.zero, direction: XYZ.unitX } as never;
        const step = new PointOnAxisStep(tip() as never, () => ({ ray }));
        const data: SnapPointOnAxisData = { ray };
        expect(step["validator"](data, XYZ.zero)).toBe(true);
        expect(step["validator"](data, new XYZ({ x: 50, y: 50, z: 0 }))).toBe(true);
    });

    test("getEventHandler should return SnapPointOnAxisEventHandler", () => {
        const ray = { point: XYZ.zero, direction: XYZ.unitX } as never;
        const step = new PointOnAxisStep(tip() as never, () => ({ ray }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, { ray });
        expect(handler).toBeInstanceOf(SnapPointOnAxisEventHandler);
        controller.dispose();
    });
});

// ============================================================================
// PointOnPlaneStep
// ============================================================================

describe("PointOnPlaneStep", () => {
    test("validator should always return true", () => {
        const step = new PointOnPlaneStep(tip() as never, () => ({}));
        const data: PointSnapData = {};
        expect(step["validator"](data, XYZ.zero)).toBe(true);
        expect(step["validator"](data, new XYZ({ x: 10, y: 20, z: 30 }))).toBe(true);
    });

    test("getEventHandler should return SnapPointPlaneEventHandler", () => {
        const step = new PointOnPlaneStep(tip() as never, () => ({ plane: () => Plane.XY }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, {
            plane: () => Plane.XY,
            curve: {} as never,
        });
        expect(handler).toBeInstanceOf(SnapPointPlaneEventHandler);
        controller.dispose();
    });
});
