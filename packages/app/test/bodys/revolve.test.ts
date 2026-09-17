// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IShape } from "@chili3d/core";
import { Line, Result, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { RevolvedNode } from "../../src/bodys/revolve";
import {
    createMockShape,
    createMockWire,
    setupShapeFactoryMock,
    setupSimpleShapeFactoryMock,
} from "./_utils";

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
            expect(node.name).toBe("body.revol1");
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
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.angle = 45;
            expect(handler.mock.calls.map((c) => c[0])).toContain("angle");
        });

        test("should emit on profile change", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.profile = { ...profile } as any;
            expect(handler.mock.calls.map((c) => c[0])).toContain("profile");
        });

        test("should emit on axis change", () => {
            setupSimpleShapeFactoryMock("revolve");
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.axis = new Line({ point: XYZ.zero, direction: XYZ.unitY });
            expect(handler.mock.calls.map((c) => c[0])).toContain("axis");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.revolve", () => {
            const revolve = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ revolve });
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 360 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(revolve).toHaveBeenCalledWith(profile, axis, 360);
        });

        test("should return Result.err when shapeFactory.revolve fails", () => {
            setupShapeFactoryMock({
                revolve: () => Result.err("revolve creation failed"),
            });
            const node = new RevolvedNode({ document: doc, profile, axis, angle: 180 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should convert closed wire to face and revolve the face to produce a solid", () => {
            const closedWire = Object.assign(createMockWire(), { isClosed: () => true });
            const faceShape = createMockShape();
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ face, revolve });
            const node = new RevolvedNode({ document: doc, profile: closedWire, axis, angle: 180 });
            const result = node.generateShape();
            expect(face).toHaveBeenCalledWith([closedWire]);
            expect(revolve).toHaveBeenCalledTimes(1);
            expect(revolve.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when face creation fails for closed wire", () => {
            const closedWire = Object.assign(createMockWire(), { isClosed: () => true });
            const revolve = rs.fn((_shape: IShape, _axis: Line, _angle: number) =>
                Result.ok(createMockShape() as any),
            );
            setupShapeFactoryMock({ face: () => Result.err("face creation failed"), revolve });
            const node = new RevolvedNode({ document: doc, profile: closedWire, axis, angle: 180 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(revolve).not.toHaveBeenCalled();
        });
    });
});
