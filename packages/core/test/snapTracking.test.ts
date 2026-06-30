// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../src";
import { Plane, XYZ } from "../src/math";
import { AxisTracking } from "../src/snap/tracking/axisTracking";
import { ObjectTracking } from "../src/snap/tracking/objectTracking";
import { TrackingSnap } from "../src/snap/tracking/trackingSnap";
import { createMockView } from "./mocks";

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

    test("should return same axes on subsequent calls (cached)", () => {
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
        expect(axes.length).toBe(4);
    });

    test("should include Z axes when trackingZ is true with angle", () => {
        const tracking = new AxisTracking(true);
        const view = createMockView({ workplane: Plane.XY });
        const origin = XYZ.zero;

        const axes = tracking.getAxes(view, origin, 90);
        expect(axes.length).toBe(6);
    });

    test("clear should remove cached axes and temp meshes", () => {
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

    test("showTrackingAtTimeout should be callable without error", () => {
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
        // Timer is set at 600ms, so tracking rays should still be empty immediately
        expect(tracking.getTrackingRays(view).length).toBe(0);

        // Clean up timer
        tracking.clear();
    });

    test("showTrackingAtTimeout should skip nearCurve type", () => {
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

    test("showTrackingAtTimeout should skip onSurface type", () => {
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

        const result = snap.snap(data);
        expect(result).toBeUndefined();
    });

    test("handleSnaped should be callable", () => {
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

    test("clear should clean up all resources", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        expect(() => snap.clear()).not.toThrow();
    });

    test("removeDynamicObject should clean temp lines", () => {
        const snap = new TrackingSnap(() => XYZ.zero, true);
        expect(() => snap.removeDynamicObject()).not.toThrow();
    });
});
