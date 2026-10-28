// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { Config, type ObjectSnapType, ObjectSnapTypes } from "../src";
import { Matrix4, Plane, Ray, XYZ } from "../src/math";
import { AxisSnap } from "../src/snap/snaps/axisSnap";
import { PlaneSnap, WorkplaneSnap } from "../src/snap/snaps/planeSnap";
import { PointOnCurveSnap } from "../src/snap/snaps/pointOnCurveSnap";
import { SurfaceSnap } from "../src/snap/snaps/surfaceSnap";
import type { IView, VisualShapeData } from "../src/visual";
import { createMockCurve, createMockView, createMouseAndDetected } from "../test-utils";

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
        expect(result).not.toBeNull();
        expect(result!.point).not.toBeNull();
        expect(result!.type).toBe("axis");
    });

    test("clear should clean up temp lines", () => {
        const view = createSnapTestView();
        const context = view.document.visual.context;
        const displayMesh = rs.fn((_meshes: unknown[]) => 1);
        const removeMesh = rs.fn((_id: number) => {});
        context.displayMesh = displayMesh as never;
        context.removeMesh = removeMesh as never;

        const snap = new AxisSnap(point, direction);
        const data = createMouseAndDetected(view, { mx: 450, my: 300 });

        snap.snap(data);
        expect(displayMesh).toHaveBeenCalledTimes(1);

        snap.clear();
        expect(removeMesh).toHaveBeenCalledWith(1);
    });

    test("removeDynamicObject should clean up temp lines", () => {
        const view = createSnapTestView();
        const context = view.document.visual.context;
        const displayMesh = rs.fn((_meshes: unknown[]) => 1);
        const removeMesh = rs.fn((_id: number) => {});
        context.displayMesh = displayMesh as never;
        context.removeMesh = removeMesh as never;

        const snap = new AxisSnap(point, direction);
        const data = createMouseAndDetected(view, { mx: 450, my: 300 });

        snap.snap(data);
        expect(displayMesh).toHaveBeenCalledTimes(1);

        snap.removeDynamicObject();
        expect(removeMesh).toHaveBeenCalledWith(1);
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
        expect(result).not.toBeNull();
        expect(result!.point?.z).toBeCloseTo(0, 5);
        expect(result!.type).toBe("onSurface");
    });

    test("should respect refPoint for distance calculation", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 3, y: 4, z: 10 }), direction: XYZ.unitZ.reverse() }),
        });
        const refPoint = () => XYZ.zero;
        const snap = new WorkplaneSnap(refPoint);
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).not.toBeNull();
        expect(result!.distance).toBeCloseTo(5, 0);
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
        expect(result).not.toBeNull();
        expect(result!.plane).not.toBeNull();
        expect(result!.type).toBe("onSurface");
    });

    test("should include plane in result", () => {
        const view = createSnapTestView({
            rayAt: () => new Ray({ point: new XYZ({ x: 0, y: 0, z: 10 }), direction: XYZ.unitZ.reverse() }),
            screenToWorld: () => XYZ.zero,
        });
        const snap = new PlaneSnap(() => Plane.XY);
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);
        expect(result).not.toBeNull();
        expect(result!.plane).toBeDefined();
        expect(result!.plane!.origin).toStrictEqual(Plane.XY.origin);
    });

    test("removeDynamicObject and clear should be no-ops", () => {
        const snap = new PlaneSnap(() => Plane.XY);
        expect(snap.removeDynamicObject()).toBeUndefined();
        expect(snap.clear()).toBeUndefined();
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
        expect(result).not.toBeNull();
        expect(result!.point).toBe(nearestPoint);
        expect(result!.type).toBe("nearCurve");
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
        expect(snap.removeDynamicObject()).toBeUndefined();
        expect(snap.clear()).toBeUndefined();
    });
});

// ============================================================================
// SurfaceSnap
// ============================================================================

describe("SurfaceSnap", () => {
    let originalSnapType: ObjectSnapType;
    let originalEnableSnap: boolean;

    beforeEach(() => {
        originalSnapType = Config.instance.snapType;
        originalEnableSnap = Config.instance.enableSnap;
        Config.instance.enableSnap = true;
    });

    afterEach(() => {
        Config.instance.snapType = originalSnapType;
        Config.instance.enableSnap = originalEnableSnap;
    });

    function createMockFaceShape(projectedPoint: XYZ) {
        // No `transformedMul`: the projection must run in the face's own frame, and a snap that
        // transformed the face into world space would fail here instead of landing elsewhere.
        return {
            surface: () => ({
                project: () => [projectedPoint],
            }),
            shapeType: 4,
        };
    }

    function createMockVisualShapeData(overrides?: Partial<VisualShapeData>): VisualShapeData {
        const face = createMockFaceShape(new XYZ({ x: 10, y: 20, z: 0 }));
        return {
            shape: face,
            owner: { node: { document: {} } } as never,
            transform: {
                ofPoint: (p: XYZ) => p,
                invert: () => ({ ofPoint: (p: XYZ) => p }),
            } as never,
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
        expect(result).not.toBeNull();
        expect(result!.type).toBe("onSurface");
        expect(result!.shapes.length).toBe(1);
    });

    test("projects the pick in the face's own frame under a non-uniform scale", () => {
        Config.instance.snapType = ObjectSnapTypes.onSurface;

        // A placement `gp_Trsf` cannot represent: the body is squeezed 2.5× in z.
        const transform = Matrix4.fromScale(1, 1, 2.5).multiply(Matrix4.fromTranslation(0, 0, -1125));
        const local = new XYZ({ x: 2, y: 3, z: 4 });
        const project = rs.fn((_point: XYZ) => [local]);
        const shapeData = {
            shape: { surface: () => ({ project }), shapeType: 4 },
            owner: { node: { document: {} } } as never,
            transform,
            indexes: [],
            point: transform.ofPoint(local),
        } as unknown as VisualShapeData;
        const view = createSnapTestView({ detectShapes: () => [shapeData] });

        const result = new SurfaceSnap().snap(createMouseAndDetected(view));

        // the projection was asked in the shape's frame ...
        expect(project.mock.calls[0][0].isEqualTo(local)).toBe(true);
        // ... and its answer placed through the same matrix the mesh is drawn with
        expect(result!.point!.isEqualTo(transform.ofPoint(local))).toBe(true);
    });

    test("should return undefined without detecting faces when snap is globally disabled", () => {
        Config.instance.enableSnap = false;
        Config.instance.snapType = ObjectSnapTypes.onSurface;
        const detectShapes = rs.fn(() => []);
        const view = createSnapTestView({ detectShapes });
        const snap = new SurfaceSnap();
        const data = createMouseAndDetected(view);

        const result = snap.snap(data);

        expect(result).toBeUndefined();
        expect(detectShapes).not.toHaveBeenCalled();
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
        expect(snap.removeDynamicObject()).toBeUndefined();
        expect(snap.clear()).toBeUndefined();
    });
});
