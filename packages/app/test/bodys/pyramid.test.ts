// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, Serializer } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PyramidNode } from "../../src/bodys/pyramid";
import { createMockDocument } from "../_helpers";
import { createMockShape, defaultPlane, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("PyramidNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties", () => {
            const plane = defaultPlane();
            const node = new PyramidNode({ document: doc, plane, dx: 10, dy: 15, dz: 20 });
            expect(node.plane).toBe(plane);
            expect(node.dx).toBe(10);
            expect(node.dy).toBe(15);
            expect(node.dz).toBe(20);
        });

        test("should set name from display()", () => {
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            expect(node.name).toBe("body.pyramid");
        });
    });

    describe("display", () => {
        test("should return body.pyramid", () => {
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            expect(node.display()).toBe("body.pyramid");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const plane = defaultPlane();
            const node = new PyramidNode({ document: doc, plane, dx: 10, dy: 15, dz: 20 });
            expect(node.dx).toBe(10);
            expect(node.dy).toBe(15);
            expect(node.dz).toBe(20);
            expect(node.plane).toBe(plane);
        });
    });

    describe("setters", () => {
        test("should update dx", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dx = 42;
            expect(node.dx).toBe(42);
        });

        test("should update dy", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dy = 42;
            expect(node.dy).toBe(42);
        });

        test("should update dz", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            node.dz = 42;
            expect(node.dz).toBe(42);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on dx change", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dx = 99;
            expect(events).toContain("dx");
        });

        test("should emit on dy change", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dy = 77;
            expect(events).toContain("dy");
        });

        test("should emit on dz change", () => {
            setupSimpleShapeFactoryMock("pyramid");
            const node = new PyramidNode({ document: doc, plane: defaultPlane(), dx: 1, dy: 1, dz: 1 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dz = 55;
            expect(events).toContain("dz");
        });
    });

    describe("serialize", () => {
        test("should serialize all properties", () => {
            const plane = defaultPlane();
            const node = new PyramidNode({ document: doc, plane, dx: 10, dy: 15, dz: 20 });
            doc.history.disabled = true;
            const s = Serializer.serializeObject(node);
            expect(s["dx"]).toBe(10);
            expect(s["dy"]).toBe(15);
            expect(s["dz"]).toBe(20);
            expect(s["plane"]).toBeDefined();
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.pyramid", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                pyramid: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const plane = defaultPlane();
            const node = new PyramidNode({ document: doc, plane, dx: 10, dy: 15, dz: 20 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toBe(plane);
            expect(calledWith[1]).toBe(10);
            expect(calledWith[2]).toBe(15);
            expect(calledWith[3]).toBe(20);
        });

        test("should return Result.err when shapeFactory.pyramid fails", () => {
            setupShapeFactoryMock({
                pyramid: () => Result.err("pyramid creation failed"),
            });
            const plane = defaultPlane();
            const node = new PyramidNode({ document: doc, plane, dx: 10, dy: 15, dz: 20 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
