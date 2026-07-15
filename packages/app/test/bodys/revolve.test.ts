// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Line, Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { RevolvedNode } from "../../src/bodys/revolve";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("RevolvedNode", () => {
    let doc: IDocument;
    let profile: any;
    let axis: Line;

    beforeEach(() => {
        doc = createMockDocument();
        profile = {
            shapeType: 0,
            isEqual: () => false,
            isClosed: () => false,
            mesh: { edges: undefined, faces: undefined, vertexs: undefined },
            matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
            dispose: () => {},
        };
        axis = new Line({ point: XYZ.zero, direction: XYZ.unitX });
    });

    describe("constructor", () => {
        test("should initialize profile, axis, and angle", () => {
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 360 });
            expect(node.profile).toBe(profile);
            expect(node.axis).toBe(axis);
            expect(node.angle).toBe(360);
        });

        test("should set name from display()", () => {
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 90 });
            expect(node.name).toBe("body.revol");
        });

        test("should accept partial angle", () => {
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 270 });
            expect(node.angle).toBe(270);
        });
    });

    describe("display", () => {
        test("should return body.revol", () => {
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            expect(node.display()).toBe("body.revol");
        });
    });

    describe("getters", () => {
        test("should return profile, axis, angle", () => {
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 270 });
            expect(node.profile).toBe(profile);
            expect(node.axis).toBe(axis);
            expect(node.angle).toBe(270);
        });
    });

    describe("setters", () => {
        test("setting profile should update value", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const np = { ...profile, shapeType: 1 };
            node.profile = np as any;
            expect(node.profile).toBe(np);
        });

        test("setting angle should update value", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            node.angle = 90;
            expect(node.angle).toBe(90);
        });

        test("setting axis should update value", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const newAxis = new Line({ point: XYZ.unitY, direction: XYZ.unitZ });
            node.axis = newAxis;
            expect(node.axis).toBe(newAxis);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on angle change", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.angle = 45;
            expect(events).toContain("angle");
        });

        test("should emit on profile change", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.profile = { ...profile } as any;
            expect(events).toContain("profile");
        });

        test("should emit on axis change", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.axis = new Line({ point: XYZ.zero, direction: XYZ.unitY });
            expect(events).toContain("axis");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.revolve", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                revolve: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 360 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toBe(profile);
            expect(calledWith[1]).toBe(axis);
            expect(calledWith[2]).toBe(360);
        });
    });
});
