// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IShape } from "@chili3d/core";
import { Plane, Result, Serializer, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { BoxNode } from "../../src/bodys/box";
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
            expect(node.name).toBe("body.box1");
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
        test.each([
            { prop: "dx", value: 100 },
            { prop: "dy", value: 200 },
            { prop: "dz", value: 300 },
        ] as const)("setting $prop should update the value", ({ prop, value }) => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node[prop] = value;
            expect(node[prop]).toBe(value);
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
        test.each([
            {
                prop: "dx",
                set: (node: BoxNode) => {
                    node.dx = 99;
                },
                emitted: "dx",
            },
            {
                prop: "dy",
                set: (node: BoxNode) => {
                    node.dy = 88;
                },
                emitted: "dy",
            },
            {
                prop: "dz",
                set: (node: BoxNode) => {
                    node.dz = 77;
                },
                emitted: "dz",
            },
            {
                prop: "location",
                set: (node: BoxNode) => {
                    node.location = new XYZ({ x: 5, y: 5, z: 5 });
                },
                emitted: "plane",
            },
        ] as const)("should emit when $prop changes", ({ set, emitted }) => {
            setupSimpleShapeFactoryMock("box");
            const node = new BoxNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            set(node);
            expect(handler.mock.calls.map((c) => c[0])).toContain(emitted);
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
            const box = rs.fn(() => Result.ok(mockShape as any));
            setupShapeFactoryMock({ box });

            const plane = defaultPlane();
            const node = new BoxNode({ document: doc, plane, dx: 10, dy: 20, dz: 30 });
            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(box).toHaveBeenCalledWith(plane, 10, 20, 30);
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
