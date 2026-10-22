// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../src/config";
import { Plane, Ray, XYZ } from "../src/math";
import type { ICameraController } from "../src/visual/cameraController";
import type { IView } from "../src/visual/view";
import { ViewUtils } from "../src/visual/viewUtils";

function createMockCameraController(overrides?: Partial<ICameraController>): ICameraController {
    return {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
        cameraTarget: new XYZ({ x: 0, y: 0, z: 0 }),
        cameraUp: new XYZ({ x: 0, y: 1, z: 0 }),
        cameraType: "perspective",
        fitContent: () => {},
        lookAt: () => {},
        pan: () => {},
        startRotate: () => {},
        rotate: () => {},
        zoom: () => {},
        updateCameraPosionTarget: () => {},
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        dispose: () => {},
        ...overrides,
    };
}

function createMockView(overrides?: Partial<IView>): IView {
    return {
        document: {} as any,
        cameraController: createMockCameraController(),
        isClosed: false,
        width: 800,
        height: 600,
        mode: "solid",
        name: "test-view",
        workplane: Plane.XY,
        update: () => {},
        up: () => XYZ.unitZ,
        toImage: () => "",
        direction: () => XYZ.unitY.reverse(),
        rayAt: () => ({ point: XYZ.zero, direction: XYZ.unitZ.reverse() }) as any,
        screenToWorld: () => XYZ.zero,
        worldToScreen: () => ({ x: 0, y: 0 }) as any,
        isolate: () => {},
        unisolate: () => {},
        resize: () => {},
        setDom: () => {},
        htmlText: () => ({ dispose: () => {} }),
        close: () => {},
        detectVisual: () => [],
        detectVisualRect: () => [],
        detectShapes: () => [],
        detectShapesRect: () => [],
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        dispose: () => {},
        ...overrides,
    } as unknown as IView;
}

describe("ViewUtils", () => {
    describe("rayFromEye", () => {
        test("should create perspective ray from camera to point", () => {
            const cameraPos = new XYZ({ x: 0, y: 0, z: 10 });
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: cameraPos,
                    cameraType: "perspective",
                }),
            });
            const point = new XYZ({ x: 5, y: 5, z: 0 });

            const ray = ViewUtils.rayFromEye(view, point);

            expect(ray.point).toEqual(cameraPos);
            // Line normalizes direction, so direction is a unit vector
            expect(ray.direction.z).toBeLessThan(0); // points downward
        });

        test("should create orthographic ray along view direction", () => {
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
                    cameraType: "orthographic",
                }),
                direction: () => XYZ.unitZ.reverse(),
            });
            const point = new XYZ({ x: 3, y: 4, z: 0 });

            const ray = ViewUtils.rayFromEye(view, point);

            // Orthographic: direction is view direction
            expect(ray.direction.z).toBe(-1);
            // Point projected along view direction to camera plane
            expect(ray.point.z).toBe(10);
        });

        test("should create orthographic ray from eye to point", () => {
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
                    cameraType: "orthographic",
                }),
                direction: () => XYZ.unitZ.reverse(),
            });
            const point = new XYZ({ x: 5, y: 3, z: 2 });

            const ray = ViewUtils.rayFromEye(view, point);

            expect(ray.direction.z).toBe(-1);
            // Point projected onto plane at camera z level
            expect(ray.point.z).toBe(10);
        });
    });

    describe("directionAt", () => {
        test("should return view direction for orthographic camera", () => {
            const viewDir = new XYZ({ x: 0, y: 0, z: -1 });
            const view = createMockView({
                cameraController: createMockCameraController({ cameraType: "orthographic" }),
                direction: () => viewDir,
            });

            const dir = ViewUtils.directionAt(view, XYZ.zero);

            expect(dir).toEqual(viewDir);
        });

        test("should return vector from camera to point for perspective camera", () => {
            const cameraPos = new XYZ({ x: 0, y: 0, z: 10 });
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: cameraPos,
                    cameraType: "perspective",
                }),
            });
            const point = new XYZ({ x: 2, y: 3, z: 0 });

            const dir = ViewUtils.directionAt(view, point);

            expect(dir.x).toBe(2);
            expect(dir.y).toBe(3);
            expect(dir.z).toBe(-10);
        });
    });

    describe("ensurePlane", () => {
        test("should return same plane when normal is parallel to view direction", () => {
            // View direction (0,0,-1), XY plane normal (0,0,1) → dot = -1, |dot| = 1 which >= Precision.Float
            // So plane is NOT replaced
            const view = createMockView({
                direction: () => XYZ.unitZ.reverse(),
                up: () => XYZ.unitY,
            });
            const plane = Plane.XY;

            const result = ViewUtils.ensurePlane(view, plane);

            expect(result).toBe(plane);
        });

        test("should replace plane when normal is perpendicular to view direction", () => {
            // View direction (0,-1,0), XY plane normal (0,0,1) → dot = 0, |dot| < Precision.Float
            // So plane IS replaced
            const view = createMockView({
                direction: () => new XYZ({ x: 0, y: -1, z: 0 }),
                up: () => XYZ.unitZ,
            });
            const plane = Plane.XY;

            const result = ViewUtils.ensurePlane(view, plane);

            // Should be a new plane
            expect(result).not.toBe(plane);
            expect(result.origin).toEqual(plane.origin);
        });

        test("should handle plane with perpendicular normal to oblique view direction", () => {
            const view = createMockView({
                direction: () => XYZ.unitY.reverse(),
                up: () => XYZ.unitZ,
            });
            // ZX plane normal (0,1,0), view direction (0,-1,0) → dot = -1, |dot| = 1 which >= Precision.Float
            // So plane is NOT replaced
            const plane = Plane.ZX;

            const result = ViewUtils.ensurePlane(view, plane);

            expect(result).toBe(plane);
        });
    });

    describe("raycastClosestPlane", () => {
        test("should return a plane from raycast", () => {
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
                    cameraType: "perspective",
                }),
                direction: () => XYZ.unitZ.reverse(),
                up: () => XYZ.unitY,
            });
            const start = XYZ.zero;
            const end = new XYZ({ x: 5, y: 5, z: 0 });

            const plane = ViewUtils.raycastClosestPlane(view, start, end);

            expect(plane).not.toBeNull();
            expect(plane.origin).not.toBeNull();
            expect(plane.normal).not.toBeNull();
        });

        test("should handle dynamic workplane disabled with perpendicular workplane", () => {
            const originalDynamicWorkplane = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;

            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
                    cameraType: "perspective",
                }),
                direction: () => XYZ.unitZ.reverse(),
                up: () => XYZ.unitY,
                workplane: Plane.XY,
            });
            const start = XYZ.zero;
            const end = new XYZ({ x: 5, y: 5, z: 0 });

            const plane = ViewUtils.raycastClosestPlane(view, start, end);

            expect(plane).not.toBeNull();
            expect(plane.origin.x).toBe(0);
            expect(plane.origin.y).toBe(0);
            expect(plane.origin.z).toBe(0);

            // Restore
            Config.instance.dynamicWorkplane = originalDynamicWorkplane;
        });

        test("should pick closest plane from three orthogonal planes", () => {
            const view = createMockView({
                cameraController: createMockCameraController({
                    cameraPosition: new XYZ({ x: 0, y: 0, z: 10 }),
                    cameraType: "perspective",
                }),
                direction: () => XYZ.unitZ.reverse(),
                up: () => XYZ.unitZ,
            });
            const start = XYZ.zero;
            const end = new XYZ({ x: 2, y: 2, z: 0 });

            const plane = ViewUtils.raycastClosestPlane(view, start, end);

            expect(plane).not.toBeNull();
            expect(plane.origin).toEqual(start);
        });
    });

    describe("viewPixelSize / worldPerPixel", () => {
        /**
         * An orthographic-style view whose rays are consistent with `direction`: adjacent
         * horizontal pixels shift the ray origin by one world unit along the screen-right
         * axis, so a correct pixel-size measure reads exactly 1 at any view angle.
         */
        function orthoView(direction: XYZ, up: XYZ = XYZ.unitY): IView {
            const d = direction.normalize()!;
            let right = d.cross(up);
            if (right.lengthSq() < 1e-12) right = XYZ.unitY.reverse();
            const step = right.normalize()!;
            return createMockView({
                direction: () => d,
                up: () => up,
                rayAt: (mx, _my) =>
                    new Ray({
                        point: step.multiply(mx - 400).sub(d.multiply(500)),
                        direction: d,
                    }),
            });
        }

        test("matches the on-plane measure when the view faces the plane", () => {
            const view = orthoView(XYZ.unitZ.reverse());
            expect(ViewUtils.viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
            expect(ViewUtils.worldPerPixel(view, Plane.XY, 400, 300)).toBeCloseTo(1);
        });

        test("stays bounded when the plane is viewed edge-on", () => {
            // Orbiting to a side view aligns the screen-right axis with the YZ plane
            // normal, so the on-plane measure explodes...
            const view = orthoView(new XYZ({ x: 0.02, y: -1, z: 0 }), XYZ.unitZ);
            expect(ViewUtils.worldPerPixel(view, Plane.YZ, 400, 300)).toBeGreaterThan(10);
            // ...while the perpendicular measure keeps its exact value
            expect(ViewUtils.viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
        });

        test("picks any perpendicular when the view runs along the up axis", () => {
            const view = orthoView(XYZ.unitZ, XYZ.unitZ);
            expect(ViewUtils.viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
        });

        test("doubles when the point is twice as far under a perspective camera", () => {
            const view = createMockView({
                rayAt: (mx, my) =>
                    new Ray({
                        point: XYZ.zero,
                        direction: new XYZ({ x: mx - 400, y: 300 - my, z: -500 }).normalize()!,
                    }),
            });

            const near = ViewUtils.viewPixelSize(view, new XYZ({ x: 0, y: 0, z: -500 }));
            const far = ViewUtils.viewPixelSize(view, new XYZ({ x: 0, y: 0, z: -1000 }));
            expect(near).toBeCloseTo(1, 2);
            expect(far! / near!).toBeCloseTo(2, 3);
        });

        test("returns undefined when the sampled rays collapse", () => {
            const view = createMockView({
                rayAt: () =>
                    new Ray({ point: new XYZ({ x: 0, y: 0, z: 500 }), direction: XYZ.unitZ.reverse() }),
            });

            expect(ViewUtils.viewPixelSize(view, XYZ.zero)).toBeUndefined();
        });
    });
});
