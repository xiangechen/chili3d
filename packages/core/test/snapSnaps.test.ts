// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type ObjectSnapType, ObjectSnapTypes } from "../src";
import { Plane, Ray, XYZ } from "../src/math";
import { AxisSnap } from "../src/snap/snaps/axisSnap";
import { PlaneSnap, WorkplaneSnap } from "../src/snap/snaps/planeSnap";
import { PointOnCurveSnap } from "../src/snap/snaps/pointOnCurveSnap";
import { SurfaceSnap } from "../src/snap/snaps/surfaceSnap";
import type { IView, VisualShapeData } from "../src/visual";
import { createMockCurve, createMockView, createMouseAndDetected } from "./mocks";

/**
 * Camera orientation suitable for geometric snap tests: looking along Z with Y up.
 * The shared createMockView from mocks.ts looks along -Y, which triggers
 * ViewUtils.ensurePlane to replace the workplane — undesirable for tests
 * that verify ray-plane intersection against the workplane directly.
 */
function createSnapTestView(overrides?: Partial<IView>): IView {
    return createMockView({
        up: () => XYZ.unitY,
        direction: () => XYZ.unitZ,
        ...overrides,
    });
}

// ============================================================================
// AxisSnap
// ============================================================================

describe("AxisSnap", () => {
    // Use unitY to avoid being parallel to the "right" vector
    const point = XYZ.zero;
    const direction = XYZ.unitY;

    test("should be created with point and direction", () => {
        const snap = new AxisSnap(point, direction);
        expect(snap.point).toBe(point);
        expect(snap.direction).toBe(direction);
    });

    test("snap should return a result on the axis", () => {
        const view = createSnapTestView();
        const snap = new AxisSnap(point, direction);
        const data = createMouseAndDetected(view, { mx: 450, my: 300 });

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.point).toBeDefined();
            expect(result.type).toBe("axis");
        }
    });

    test("clear should clean up temp lines", () => {
        const view = createSnapTestView();
        const snap = new AxisSnap(point, direction);
        const data = createMouseAndDetected(view);

        snap.snap(data);
        expect(() => snap.clear()).not.toThrow();
    });

    test("removeDynamicObject should clean up temp lines", () => {
        const view = createSnapTestView();
        const snap = new AxisSnap(point, direction);
        const data = createMouseAndDetected(view);

        snap.snap(data);
        expect(() => snap.removeDynamicObject()).not.toThrow();
    });
});

// ============================================================================
// WorkplaneSnap
// ============================================================================

describe("WorkplaneSnap", () => {
    test("should snap to the view's workplane", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 0, y: 0, z: 10 }), direction: XYZ.unitZ.reverse() }),
        });
        const snap = new WorkplaneSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.point?.z).toBeCloseTo(0, 5);
            expect(result.type).toBe("onSurface");
        }
    });

    test("should respect refPoint for distance calculation", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 3, y: 4, z: 10 }), direction: XYZ.unitZ.reverse() }),
        });
        const refPoint = () => XYZ.zero;
        const snap = new WorkplaneSnap(refPoint);
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.distance).toBeCloseTo(5, 0);
        }
    });

    test("should return undefined if ray is parallel to workplane", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 0, y: 0, z: 5 }), direction: XYZ.unitX }),
        });
        const snap = new WorkplaneSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });
});

// ============================================================================
// PlaneSnap
// ============================================================================

describe("PlaneSnap", () => {
    test("should snap using a custom plane function", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 1, y: 2, z: 10 }), direction: XYZ.unitZ.reverse() }),
            screenToWorld: () => new XYZ({ x: 1, y: 2, z: 0 }),
        });
        const snap = new PlaneSnap(() => Plane.XY);
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.plane).toBeDefined();
            expect(result.type).toBe("onSurface");
        }
    });

    test("should include plane in result", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 0, y: 0, z: 10 }), direction: XYZ.unitZ.reverse() }),
            screenToWorld: () => XYZ.zero,
        });
        const snap = new PlaneSnap(() => Plane.XY);
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result?.plane) {
            expect(result.plane.origin).toStrictEqual(Plane.XY.origin);
        }
    });

    test("removeDynamicObject and clear should be no-ops", () => {
        const snap = new PlaneSnap(() => Plane.XY);
        expect(() => snap.removeDynamicObject()).not.toThrow();
        expect(() => snap.clear()).not.toThrow();
    });
});

// ============================================================================
// PointOnCurveSnap
// ============================================================================

describe("PointOnCurveSnap", () => {
    test("should snap to nearest point on curve", () => {
        const view = createSnapTestView();
        const nearestPoint = new XYZ({ x: 1, y: 2, z: 0 });
        const curve = createMockCurve({ nearestPoint });
        const snap = new PointOnCurveSnap({ curve });
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.point).toBe(nearestPoint);
            expect(result.type).toBe("nearCurve");
        }
    });

    test("should return undefined if no nearest point on curve", () => {
        const view = createSnapTestView();
        const curve = createMockCurve();
        const snap = new PointOnCurveSnap({ curve });
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("removeDynamicObject and clear should be no-ops", () => {
        const curve = createMockCurve();
        const snap = new PointOnCurveSnap({ curve });
        expect(() => snap.removeDynamicObject()).not.toThrow();
        expect(() => snap.clear()).not.toThrow();
    });
});

// ============================================================================
// SurfaceSnap
// ============================================================================

describe("SurfaceSnap", () => {
    let originalSnapType: ObjectSnapType;

    beforeEach(() => {
        originalSnapType = Config.instance.snapType;
    });

    afterEach(() => {
        Config.instance.snapType = originalSnapType;
    });

    function createMockFaceShape(projectedPoint: XYZ) {
        return {
            surface: () => ({
                project: () => [projectedPoint],
            }),
            shapeType: 4,
            transformedMul: function () {
                return this;
            },
        };
    }

    function createMockVisualShapeData(overrides?: Partial<VisualShapeData>): VisualShapeData {
        const face = createMockFaceShape(new XYZ({ x: 10, y: 20, z: 0 }));
        return {
            shape: face,
            owner: { node: { document: {} } } as never,
            transform: { ofPoint: (p: XYZ) => p, invert: () => null } as never,
            indexes: [],
            point: new XYZ({ x: 15, y: 25, z: 0 }),
            ...overrides,
        } as unknown as VisualShapeData;
    }

    test("should snap to a face surface", () => {
        Config.instance.snapType = ObjectSnapTypes.onSurface;

        const shapeData = createMockVisualShapeData();
        const view = createSnapTestView({
            detectShapes: () => [shapeData],
        });
        const snap = new SurfaceSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeDefined();
        if (result) {
            expect(result.type).toBe("onSurface");
            expect(result.shapes.length).toBe(1);
        }
    });

    test("should return undefined when snap type does not include onSurface", () => {
        Config.instance.snapType = ObjectSnapTypes.none;

        const view = createSnapTestView();
        const snap = new SurfaceSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("should return undefined when no faces detected", () => {
        Config.instance.snapType = ObjectSnapTypes.onSurface;

        const view = createSnapTestView({
            detectShapes: () => [],
        });
        const snap = new SurfaceSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("removeDynamicObject and clear should be no-ops", () => {
        const snap = new SurfaceSnap();
        expect(() => snap.removeDynamicObject()).not.toThrow();
        expect(() => snap.clear()).not.toThrow();
    });
});
