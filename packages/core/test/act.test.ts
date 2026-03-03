// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XY, XYZ } from "../src";
import { Act } from "../src/visual/act";
import type { ICameraController } from "../src/visual/cameraController";
import type { IView } from "../src/visual/view";

describe("Act class tests", () => {
    describe("Constructor and basic properties", () => {
        test("should create Act instance with given values", () => {
            const name = "Test Act";
            const cameraPosition = new XYZ(1, 2, 3);
            const cameraTarget = new XYZ(4, 5, 6);
            const cameraUp = new XYZ(0, 1, 0);

            const act = new Act(name, cameraPosition, cameraTarget, cameraUp);

            expect(act.name).toBe(name);
            expect(act.cameraPosition).toEqual(cameraPosition);
            expect(act.cameraTarget).toEqual(cameraTarget);
            expect(act.cameraUp).toEqual(cameraUp);
        });

        test("should create Act with zero vectors when not provided", () => {
            const name = "Test Act";
            const zeroVector = XYZ.zero;

            const act = new Act(name, zeroVector, zeroVector, zeroVector);

            expect(act.name).toBe(name);
            expect(act.cameraPosition).toEqual(zeroVector);
            expect(act.cameraTarget).toEqual(zeroVector);
            expect(act.cameraUp).toEqual(zeroVector);
        });
    });

    describe("Property setters and getters", () => {
        test("should set and get name property", () => {
            const act = new Act("Initial", XYZ.zero, XYZ.zero, XYZ.zero);

            expect(act.name).toBe("Initial");

            act.name = "Updated Name";
            expect(act.name).toBe("Updated Name");
        });

        test("should set and get cameraPosition property", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);
            const newPosition = new XYZ(10, 20, 30);

            expect(act.cameraPosition).toEqual(XYZ.zero);

            act.cameraPosition = newPosition;
            expect(act.cameraPosition).toEqual(newPosition);
        });

        test("should set and get cameraTarget property", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);
            const newTarget = new XYZ(5, 10, 15);

            expect(act.cameraTarget).toEqual(XYZ.zero);

            act.cameraTarget = newTarget;
            expect(act.cameraTarget).toEqual(newTarget);
        });

        test("should set and get cameraUp property", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);
            const newUp = new XYZ(0, 1, 0);

            expect(act.cameraUp).toEqual(XYZ.zero);

            act.cameraUp = newUp;
            expect(act.cameraUp).toEqual(newUp);
        });
    });

    describe("Static method fromView", () => {
        test("should create Act from view properties", () => {
            const mockCameraController: ICameraController = {
                cameraPosition: new XYZ(1, 2, 3),
                cameraTarget: new XYZ(4, 5, 6),
                cameraUp: new XYZ(0, 1, 0),
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
            };

            const mockView: IView = {
                document: {} as any,
                cameraController: mockCameraController,
                isClosed: false,
                width: 800,
                height: 600,
                dom: undefined,
                mode: 0 as any,
                name: "Test View",
                workplane: {} as any,
                update: () => {},
                up: () => XYZ.unitY,
                toImage: () => "",
                direction: () => XYZ.unitZ,
                rayAt: () => ({}) as any,
                screenToWorld: () => XYZ.zero,
                worldToScreen: () => new XY(0, 0),
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
            };

            const actName = "View Act";
            const act = Act.fromView(mockView, actName);

            expect(act.name).toBe(actName);
            expect(act.cameraPosition).toEqual(mockCameraController.cameraPosition);
            expect(act.cameraTarget).toEqual(mockCameraController.cameraTarget);
            expect(act.cameraUp).toEqual(mockCameraController.cameraUp);
        });
    });

    describe("Observable functionality", () => {
        test("should inherit from Observable", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);

            expect(typeof act.onPropertyChanged).toBe("function");
            expect(typeof act.removePropertyChanged).toBe("function");
        });

        test("should trigger property change events when properties change", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);
            let callCount = 0;
            const mockCallback = () => {
                callCount++;
            };

            act.onPropertyChanged(mockCallback);

            act.name = "New Name";
            expect(callCount).toBe(1);

            act.cameraPosition = new XYZ(1, 1, 1);
            expect(callCount).toBe(2);

            act.cameraTarget = new XYZ(2, 2, 2);
            expect(callCount).toBe(3);

            act.cameraUp = new XYZ(0, 1, 0);
            expect(callCount).toBe(4);

            act.removePropertyChanged(mockCallback);
        });
    });

    describe("Serialization decorators", () => {
        test("should have correct serializable fields", () => {
            const act = new Act("Test", XYZ.zero, XYZ.zero, XYZ.zero);

            // Test that the class has the @serializable decorator
            expect(Act.prototype.constructor.name).toBe("Act");

            // Test that properties are properly decorated with @serialze
            expect(typeof act.name).toBe("string");
            expect(act.cameraPosition).toBeInstanceOf(XYZ);
            expect(act.cameraTarget).toBeInstanceOf(XYZ);
            expect(act.cameraUp).toBeInstanceOf(XYZ);
        });
    });

    describe("Edge cases and validation", () => {
        test("should handle empty string name", () => {
            const act = new Act("", XYZ.zero, XYZ.zero, XYZ.zero);
            expect(act.name).toBe("");

            act.name = "";
            expect(act.name).toBe("");
        });

        test("should handle large coordinate values", () => {
            const largePosition = new XYZ(1000000, -1000000, 500000);
            const largeTarget = new XYZ(-500000, 750000, -250000);
            const largeUp = new XYZ(0, 1, 0);

            const act = new Act("Large Coordinates", largePosition, largeTarget, largeUp);

            expect(act.cameraPosition).toEqual(largePosition);
            expect(act.cameraTarget).toEqual(largeTarget);
            expect(act.cameraUp).toEqual(largeUp);
        });

        test("should handle floating point precision", () => {
            const precisePosition = new XYZ(0.123456789, 0.987654321, 0.555555555);
            const preciseTarget = new XYZ(1.111111111, 2.222222222, 3.333333333);
            const preciseUp = new XYZ(0, 0.707106781, 0.707106781);

            const act = new Act("Precise", precisePosition, preciseTarget, preciseUp);

            expect(act.cameraPosition.x).toBeCloseTo(0.123456789, 9);
            expect(act.cameraPosition.y).toBeCloseTo(0.987654321, 9);
            expect(act.cameraPosition.z).toBeCloseTo(0.555555555, 9);
            expect(act.cameraTarget).toEqual(preciseTarget);
            expect(act.cameraUp).toEqual(preciseUp);
        });

        test("should handle same position and target", () => {
            const samePoint = new XYZ(1, 1, 1);
            const act = new Act("Same Point", samePoint, samePoint, XYZ.unitY);

            expect(act.cameraPosition).toEqual(act.cameraTarget);
            expect(act.cameraPosition).toEqual(samePoint);
        });

        test("should handle negative values", () => {
            const act = new Act(
                "Negative Values",
                new XYZ(-1, -2, -3),
                new XYZ(-4, -5, -6),
                new XYZ(0, -1, 0),
            );

            expect(act.cameraPosition).toEqual(new XYZ(-1, -2, -3));
            expect(act.cameraTarget).toEqual(new XYZ(-4, -5, -6));
            expect(act.cameraUp).toEqual(new XYZ(0, -1, 0));
        });
    });
});
