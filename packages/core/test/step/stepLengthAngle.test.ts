// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, Precision, XYZ } from "../../src";
import { Plane } from "../../src/math";
import type { LengthAtAxisSnapData, PointSnapData, SnapLengthAtPlaneData } from "../../src/snap";
import { AngleSnapEventHandler, SnapLengthAtAxisHandler, SnapLengthAtPlaneHandler } from "../../src/snap";
import { AngleStep, LengthAtAxisStep, LengthAtPlaneStep } from "../../src/step";
import { TestDocument } from "../mocks";

function tip(): string {
    return "test.tip" as unknown as string;
}

// ============================================================================
// LengthAtAxisStep
// ============================================================================

describe("LengthAtAxisStep", () => {
    test("validator should return true when dot product > Precision.Distance", () => {
        const step = new LengthAtAxisStep(tip() as never, () => ({
            point: XYZ.zero,
            direction: XYZ.unitX,
        }));
        const data: LengthAtAxisSnapData = { point: XYZ.zero, direction: XYZ.unitX };
        const farPoint = new XYZ({ x: 100, y: 0, z: 0 });
        expect(step["validator"](data, farPoint)).toBe(true);
    });

    test("validator should return false when dot product <= Precision.Distance", () => {
        const step = new LengthAtAxisStep(tip() as never, () => ({
            point: XYZ.zero,
            direction: XYZ.unitX,
        }));
        const data: LengthAtAxisSnapData = { point: XYZ.zero, direction: XYZ.unitX };
        const nearPoint = new XYZ({ x: Precision.Distance / 2, y: 0, z: 0 });
        expect(step["validator"](data, nearPoint)).toBe(false);
    });

    test("validator should return true for opposite direction (abs value check)", () => {
        const step = new LengthAtAxisStep(tip() as never, () => ({
            point: XYZ.zero,
            direction: XYZ.unitX,
        }));
        const data: LengthAtAxisSnapData = { point: XYZ.zero, direction: XYZ.unitX };
        const oppositePoint = new XYZ({ x: -100, y: 0, z: 0 });
        expect(step["validator"](data, oppositePoint)).toBe(true);
    });

    test("getEventHandler should return SnapLengthAtAxisHandler", () => {
        const step = new LengthAtAxisStep(tip() as never, () => ({
            point: XYZ.zero,
            direction: XYZ.unitX,
        }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, {
            point: XYZ.zero,
            direction: XYZ.unitX,
        });
        expect(handler).toBeInstanceOf(SnapLengthAtAxisHandler);
        controller.dispose();
    });
});

// ============================================================================
// LengthAtPlaneStep
// ============================================================================

describe("LengthAtPlaneStep", () => {
    test("validator should return true when projected distance > Precision.Distance", () => {
        const step = new LengthAtPlaneStep(tip() as never, () => ({
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        }));
        const data: SnapLengthAtPlaneData = { point: () => XYZ.zero, plane: () => Plane.XY };
        const farPoint = new XYZ({ x: 100, y: 0, z: 0 });
        expect(step["validator"](data, farPoint)).toBe(true);
    });

    test("validator should return false when projected point is too close", () => {
        const step = new LengthAtPlaneStep(tip() as never, () => ({
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        }));
        const data: SnapLengthAtPlaneData = { point: () => XYZ.zero, plane: () => Plane.XY };
        const nearPoint = new XYZ({ x: Precision.Distance / 2, y: 0, z: 0 });
        expect(step["validator"](data, nearPoint)).toBe(false);
    });

    test("validator should treat point on plane with non-zero z correctly", () => {
        const step = new LengthAtPlaneStep(tip() as never, () => ({
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        }));
        const data: SnapLengthAtPlaneData = { point: () => XYZ.zero, plane: () => Plane.XY };
        // Point with z=100 projects to (x=100, y=0, z=0) on XY plane, distance is 100
        const pointWithZ = new XYZ({ x: 100, y: 0, z: 100 });
        expect(step["validator"](data, pointWithZ)).toBe(true);
    });

    test("getEventHandler should return SnapLengthAtPlaneHandler", () => {
        const step = new LengthAtPlaneStep(tip() as never, () => ({
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, {
            point: () => XYZ.zero,
            plane: () => Plane.XY,
        });
        expect(handler).toBeInstanceOf(SnapLengthAtPlaneHandler);
        controller.dispose();
    });
});

// ============================================================================
// AngleStep
// ============================================================================

describe("AngleStep", () => {
    const center = () => XYZ.zero;
    const p1 = () => new XYZ({ x: 10, y: 0, z: 0 });

    test("getEventHandler should return AngleSnapEventHandler", () => {
        const step = new AngleStep(tip() as never, center, p1, () => ({ plane: () => Plane.XY }));
        const doc = new TestDocument();
        const controller = new AsyncController();
        const handler = step["getEventHandler"](doc, controller, { plane: () => Plane.XY });
        expect(handler).toBeInstanceOf(AngleSnapEventHandler);
        controller.dispose();
    });

    test("getEventHandler should throw when plane is not provided", () => {
        const step = new AngleStep(tip() as never, center, p1);
        const doc = new TestDocument();
        const controller = new AsyncController();
        expect(() => {
            step["getEventHandler"](doc, controller, {});
        }).toThrow("AngleSnapEventHandler: no plane");
        controller.dispose();
    });

    test("validator should return true when refPoint is undefined", () => {
        const step = new AngleStep(tip() as never, center, p1, () => ({ plane: () => Plane.XY }));
        const data: PointSnapData = {};
        expect(step["validator"](data, new XYZ({ x: 5, y: 0, z: 0 }))).toBe(true);
    });

    test("validator should check distance against refPoint", () => {
        const refPoint = () => XYZ.zero;
        const step = new AngleStep(tip() as never, center, p1, () => ({ plane: () => Plane.XY, refPoint }));
        const data: PointSnapData = { refPoint };
        expect(step["validator"](data, new XYZ({ x: 100, y: 0, z: 0 }))).toBe(true);
        expect(step["validator"](data, new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
    });
});
