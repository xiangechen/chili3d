// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../src";
import { Plane, XYZ } from "../src/math";
import { Axis } from "../src/snap/tracking/axis";
import { AxisTracking } from "../src/snap/tracking/axisTracking";
import { ObjectTracking } from "../src/snap/tracking/objectTracking";
import { TrackingSnap } from "../src/snap/tracking/trackingSnap";
import { createMockView } from "./mocks";

// ============================================================================
// Axis
// ============================================================================

describe("Axis", () => {
    describe("constructor", () => {
        test("should create an Axis with location, direction, and name", () => {
            const origin = XYZ.zero;
            const dir = XYZ.unitX;
            const axis = new Axis(origin, dir, "X Axis");
            expect(axis.point).toBe(origin);
            expect(axis.direction).toStrictEqual(dir);
            expect(axis.name).toBe("X Axis");
        });

        test("should normalize the direction", () => {
            const axis = new Axis(XYZ.zero, new XYZ({ x: 2, y: 0, z: 0 }), "test");
            expect(axis.direction.isEqualTo(XYZ.unitX)).toBe(true);
        });
    });

    describe("getAxiesAtPlane", () => {
        test("should return x and y axes when containsZ is false", () => {
            const plane = Plane.XY;
            const origin = XYZ.zero;
            const axes = Axis.getAxiesAtPlane(origin, plane, false);
            expect(axes.length).toBe(4);
            expect(axes[0].name).toBe("axis.x");
            expect(axes[0].direction.isEqualTo(plane.xvec)).toBe(true);
            expect(axes[1].name).toBe("axis.x");
            expect(axes[1].direction.isEqualTo(plane.xvec.reverse())).toBe(true);
            expect(axes[2].name).toBe("axis.y");
            expect(axes[2].direction.isEqualTo(plane.yvec)).toBe(true);
            expect(axes[3].name).toBe("axis.y");
            expect(axes[3].direction.isEqualTo(plane.yvec.reverse())).toBe(true);
            axes.forEach((a) => expect(a.point).toBe(origin));
        });

        test("should return x, y and z axes when containsZ is true", () => {
            const plane = Plane.XY;
            const origin = new XYZ({ x: 1, y: 2, z: 3 });
            const axes = Axis.getAxiesAtPlane(origin, plane, true);
            expect(axes.length).toBe(6);
            const zAxes = axes.filter((a) => a.name === "axis.z");
            expect(zAxes.length).toBe(2);
            axes.forEach((a) => expect(a.point).toBe(origin));
        });
    });

    describe("intersect", () => {
        test("should find intersection of two perpendicular axes", () => {
            const axis1 = new Axis(XYZ.zero, XYZ.unitX, "x");
            const axis2 = new Axis(XYZ.zero, XYZ.unitY, "y");
            const intersection = axis1.intersect(axis2);
            expect(intersection).toBeDefined();
            if (intersection) {
                expect(intersection.x).toBeCloseTo(0, 5);
                expect(intersection.y).toBeCloseTo(0, 5);
                expect(intersection.z).toBeCloseTo(0, 5);
            }
        });

        test("should return undefined for parallel axes", () => {
            const axis1 = new Axis(XYZ.zero, XYZ.unitX, "x1");
            const axis2 = new Axis(new XYZ({ x: 0, y: 1, z: 0 }), XYZ.unitX, "x2");
            const intersection = axis1.intersect(axis2);
            expect(intersection).toBeUndefined();
        });
    });
});

// ============================================================================
// AxisTracking
// ============================================================================

describe("AxisTracking", () => {
    test("should be created with trackingZ flag", () => {
        const tracking = new AxisTracking(true);
        expect(tracking.trackingZ).toBe(true);
    });

    test("should initialize axes for a view", () => {
        const tracking = new AxisTracking(true);
        const view = createMockView();
        const origin = XYZ.zero;
        const axes = tracking.getAxes(view, origin);
        expect(axes.length).toBeGreaterThan(0);
    });

    test("should return cached axes on subsequent calls", () => {
        const tracking = new AxisTracking(false);
        const view = createMockView();
        const origin = XYZ.zero;
        const axes1 = tracking.getAxes(view, origin);
        const axes2 = tracking.getAxes(view, origin);
        expect(axes1).toBe(axes2);
    });

    test("should create angle-based axes when angle is provided", () => {
        const tracking = new AxisTracking(false);
        const view = createMockView({ workplane: Plane.XY });
        const origin = XYZ.zero;
        const axes = tracking.getAxes(view, origin, 90);
        expect(axes.length).toBe(4); // 0, 90, 180, 270
    });

    test("should create angle-based axes with specific angle steps", () => {
        const tracking = new AxisTracking(false);
        const view = createMockView({ workplane: Plane.XY });
        const origin = XYZ.zero;
        const axes = tracking.getAxes(view, origin, 45);
        expect(axes.length).toBe(8); // 0, 45, 90, 135, 180, 225, 270, 315
    });

    test("should include Z axes when trackingZ is true with angle", () => {
        const tracking = new AxisTracking(true);
        const view = createMockView({ workplane: Plane.XY });
        const origin = XYZ.zero;
        const axes = tracking.getAxes(view, origin, 90);
        expect(axes.length).toBe(6); // 4 angle axes + 2 Z axes
    });

    test("clear should remove cached axes", () => {
        const tracking = new AxisTracking(true);
        const view = createMockView();
        const origin = XYZ.zero;
        tracking.getAxes(view, origin);
        tracking.clear();
        const newView = createMockView();
        const axes = tracking.getAxes(newView, origin);
        expect(axes.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// ObjectTracking
// ============================================================================

describe("ObjectTracking", () => {
    test("should be created with trackingZ flag", () => {
        const tracking = new ObjectTracking(true);
        expect(tracking.trackingZ).toBe(true);
    });

    test("should return empty tracking rays initially", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const rays = tracking.getTrackingRays(view);
        expect(rays.length).toBe(0);
    });

    test("showTrackingAtTimeout with valid snap should set a timer", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        const snap = {
            view,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
            info: "test point",
            shapes: [{ shape: { id: "s1" } } as never, { shape: { id: "s2" } } as never],
            type: "end" as const,
        };

        expect(() => tracking.showTrackingAtTimeout(document, snap)).not.toThrow();
        // Tracking rays should still be empty immediately (600ms timer)
        expect(tracking.getTrackingRays(view).length).toBe(0);
        tracking.clear();
    });

    test("showTrackingAtTimeout should skip nearCurve snap type", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        const snap = {
            view,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
            shapes: [],
            type: "nearCurve" as const,
        };
        expect(() => tracking.showTrackingAtTimeout(document, snap)).not.toThrow();
        tracking.clear();
    });

    test("showTrackingAtTimeout should skip onSurface snap type", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        const snap = {
            view,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
            shapes: [],
            type: "onSurface" as const,
        };
        expect(() => tracking.showTrackingAtTimeout(document, snap)).not.toThrow();
        tracking.clear();
    });

    test("showTrackingAtTimeout should skip undefined snap", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        expect(() => tracking.showTrackingAtTimeout(document, undefined)).not.toThrow();
        tracking.clear();
    });

    test("showTrackingAtTimeout should skip same snap twice", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        const snap = {
            view,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
            shapes: [{ shape: { id: "s1" } } as never],
            type: "end" as const,
        };
        tracking.showTrackingAtTimeout(document, snap);
        // Second call with same snap should reset timer, not duplicate
        expect(() => tracking.showTrackingAtTimeout(document, snap)).not.toThrow();
        tracking.clear();
    });

    test("clear should clean up resources", () => {
        const tracking = new ObjectTracking(false);
        const view = createMockView();
        const document = view.document;
        const snap = {
            view,
            point: new XYZ({ x: 10, y: 0, z: 0 }),
            shapes: [{ shape: { id: "s1" } } as never],
            type: "end" as const,
        };
        tracking.showTrackingAtTimeout(document, snap);
        tracking.clear();
        expect(tracking.getTrackingRays(view).length).toBe(0);
    });
});

// ============================================================================
// TrackingSnap
// ============================================================================

describe("TrackingSnap", () => {
    let originalTracking: boolean;

    beforeEach(() => {
        originalTracking = Config.instance.enableSnapTracking;
    });

    afterEach(() => {
        Config.instance.enableSnapTracking = originalTracking;
    });

    test("should implement ISnap interface", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        expect(typeof snap.snap).toBe("function");
        expect(typeof snap.clear).toBe("function");
        expect(typeof snap.removeDynamicObject).toBe("function");
    });

    test("should return undefined when tracking is disabled", () => {
        Config.instance.enableSnapTracking = false;
        const snap = new TrackingSnap(() => XYZ.zero, true);
        const view = createMockView();
        const data = { view, mx: 400, my: 300, shapes: [] };
        expect(snap.snap(data)).toBeUndefined();
    });

    test("snap should return undefined with no reference point and no tracked objects", () => {
        Config.instance.enableSnapTracking = true;
        const snap = new TrackingSnap(undefined, false);
        const view = createMockView();
        const data = { view, mx: 400, my: 300, shapes: [] };
        expect(snap.snap(data)).toBeUndefined();
    });

    test("snap should attempt tracking with reference point", () => {
        Config.instance.enableSnapTracking = true;
        const snap = new TrackingSnap(() => XYZ.zero, false);
        const view = createMockView();
        const data = { view, mx: 400, my: 300, shapes: [] };
        // With a reference point, axis tracking is engaged
        // The result depends on screen distance vs Config.SnapDistance
        expect(() => snap.snap(data)).not.toThrow();
    });

    test("handleSnaped should be callable without error", () => {
        // Disable tracking to avoid timer creation during test
        Config.instance.enableSnapTracking = false;
        const snap = new TrackingSnap(() => XYZ.zero, false);
        const view = createMockView();
        const document = view.document;
        expect(() =>
            snap.handleSnaped?.(document, {
                view,
                point: XYZ.zero,
                shapes: [],
                type: "vertex",
            }),
        ).not.toThrow();
    });

    test("handleSnaped should be callable with shape data", () => {
        Config.instance.enableSnapTracking = false;
        const snap = new TrackingSnap(() => XYZ.zero, false);
        const view = createMockView();
        const document = view.document;
        expect(() =>
            snap.handleSnaped?.(document, {
                view,
                point: new XYZ({ x: 1, y: 2, z: 3 }),
                shapes: [
                    {
                        shape: { id: "s1", shapeType: 2 },
                        owner: { node: {} },
                        transform: {
                            ofPoint: (p: XYZ) => p,
                            invert: () => null,
                        },
                        indexes: [],
                        point: XYZ.zero,
                    } as never,
                ],
                type: "end",
            }),
        ).not.toThrow();
    });

    test("clear should clean up all resources", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        expect(() => snap.clear()).not.toThrow();
    });

    test("clear should be idempotent", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        snap.clear();
        expect(() => snap.clear()).not.toThrow();
    });

    test("removeDynamicObject should clean temp lines", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        expect(() => snap.removeDynamicObject()).not.toThrow();
    });

    test("snap should not throw with shapes in detected data", () => {
        Config.instance.enableSnapTracking = true;
        const snap = new TrackingSnap(() => XYZ.zero, false);
        const view = createMockView();
        const data = {
            view,
            mx: 400,
            my: 300,
            shapes: [] as never[],
        };
        expect(() => snap.snap(data)).not.toThrow();
    });
});

// ============================================================================
// TrackingSnap — rayDistanceAtScreen (via private method access)
// ============================================================================

describe("TrackingSnap — rayDistanceAtScreen", () => {
    test("should calculate 0 distance for point directly on axis", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        const view = createMockView();
        const axis = new Axis(XYZ.zero, XYZ.unitX, "x");

        // Point at origin, screen (400, 300) → should be close to axis
        const dist = snap["rayDistanceAtScreen"](view, 400, 300, axis);
        expect(dist).toBeCloseTo(0, 5);
    });

    test("should calculate positive distance for point off axis", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        const view = createMockView();
        // Axis at (0,100,0) → screen projects to (400, 400)
        // Mouse at (500, 300) is off-axis both in x and y
        const axis = new Axis(new XYZ({ x: 0, y: 100, z: 0 }), XYZ.unitY, "y");

        const dist = snap["rayDistanceAtScreen"](view, 450, 350, axis);
        expect(dist).toBeGreaterThan(0);
    });
});
