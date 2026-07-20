// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IShape } from "@chili3d/core";
import { Plane, Result, Serializer, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { BoxNode } from "../../src/bodys/box";
import { createMockDocument } from "../_helpers";
import { createMockShape, defaultPlane, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("BoxNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties from options", () => {
            const plane = defaultPlane();
            const node = new BoxNode({ document: doc, plane, dx: 10, dy: 20, dz: 30 });
            expect(node.dx).toBe(10);
            expect(node.dy).toBe(20);
            expect(node.dz).toBe(30);
            expect(node.plane).toBe(plane);
        });

        test("should set name from display() i18n key", () => {
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            expect(node.name).toBe("body.box");
        });

        test("should accept negative dimensions", () => {
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: -5, dy: -10, dz: -15 });
            expect(node.dx).toBe(-5);
            expect(node.dy).toBe(-10);
            expect(node.dz).toBe(-15);
        });

        test("should accept zero dimensions", () => {
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 0, dy: 0, dz: 0 });
            expect(node.dx).toBe(0);
            expect(node.dy).toBe(0);
            expect(node.dz).toBe(0);
        });
    });

    describe("display", () => {
        test("should return body.box i18n key", () => {
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            expect(node.display()).toBe("body.box");
        });
    });

    describe("getters", () => {
        test("dx, dy, dz should return constructor values", () => {
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 42, dy: 99, dz: 77 });
            expect(node.dx).toBe(42);
            expect(node.dy).toBe(99);
            expect(node.dz).toBe(77);
        });

        test("location should return plane origin", () => {
            const origin = new XYZ({ x: 5, y: 10, z: 15 });
            const plane = new Plane({ origin, normal: XYZ.unitZ, xvec: XYZ.unitX });
            const node = new BoxNode({ document: doc, plane, dx: 1, dy: 1, dz: 1 });
            expect(node.location.x).toBe(5);
            expect(node.location.y).toBe(10);
            expect(node.location.z).toBe(15);
        });

        test("plane should return the plane set in constructor", () => {
            const plane = new Plane({
                origin: new XYZ({ x: 1, y: 2, z: 3 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            });
            const node = new BoxNode({ document: doc, plane, dx: 1, dy: 1, dz: 1 });
            expect(node.plane).toBe(plane);
        });
    });

    describe("setters", () => {
        test("setting dx should update the value", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dx = 100;
            expect(node.dx).toBe(100);
        });

        test("setting dy should update the value", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dy = 200;
            expect(node.dy).toBe(200);
        });

        test("setting dz should update the value", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dz = 300;
            expect(node.dz).toBe(300);
        });

        test("setting location should update plane origin", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.location = new XYZ({ x: 10, y: 20, z: 30 });
            expect(node.location.x).toBe(10);
            expect(node.location.y).toBe(20);
            expect(node.location.z).toBe(30);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit when dx changes", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dx = 99;
            expect(events).toContain("dx");
        });

        test("should emit when dy changes", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dy = 88;
            expect(events).toContain("dy");
        });

        test("should emit when dz changes", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dz = 77;
            expect(events).toContain("dz");
        });

        test("should emit when location changes", () => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.location = new XYZ({ x: 5, y: 5, z: 5 });
            expect(events).toContain("plane");
        });
    });

    describe("serialize", () => {
        test("should serialize all @serialize fields", () => {
            const plane = new Plane({
                origin: new XYZ({ x: 1, y: 2, z: 3 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            });
            const node = new BoxNode({ document: doc, plane, dx: 10, dy: 20, dz: 30 });
            doc.history.disabled = true;

            const serialized: any = Serializer.serializeObject(node);

            expect(serialized["dx"]).toBe(10);
            expect(serialized["dy"]).toBe(20);
            expect(serialized["dz"]).toBe(30);
            expect(serialized["plane"]).toBeDefined();
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.box with correct parameters", () => {
            const mockShape = createMockShape();
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                box: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(mockShape as any);
                },
            });

            const plane = defaultPlane();
            const node = new BoxNode({ document: doc, plane, dx: 10, dy: 20, dz: 30 });
            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toBe(plane);
            expect(calledWith[1]).toBe(10);
            expect(calledWith[2]).toBe(20);
            expect(calledWith[3]).toBe(30);
        });

        test("should return Result.err when shapeFactory.box fails", () => {
            setupShapeFactoryMock({
                box: () => Result.err("box creation failed"),
            });
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 10, dy: 20, dz: 30 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
