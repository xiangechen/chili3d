// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IEdge } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CircleNode } from "../../src/bodys/circle";
import { createMockShape, createMockWireShape, setupShapeFactoryMock } from "./_utils";

describe("CircleNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const center = XYZ.zero;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize normal, center, radius", () => {
            const node = new CircleNode({ document: doc, normal, center, radius: 10 });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.radius).toBe(10);
        });

        test("should set name from display()", () => {
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            expect(node.name).toBe("body.circle1");
        });

        test("isFace should default to false", () => {
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            expect(node.isFace).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.circle", () => {
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            expect(node.display()).toBe("body.circle");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const c = new XYZ({ x: 1, y: 2, z: 3 });
            const node = new CircleNode({ document: doc, normal: XYZ.unitX, center: c, radius: 15 });
            expect(node.center).toBe(c);
            expect(node.radius).toBe(15);
            expect(node.normal).toBe(XYZ.unitX);
        });
    });

    describe("setters", () => {
        test("setting center should update value", () => {
            setupShapeFactoryMock({ circle: () => Result.ok(createMockShape()) });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            const nc = new XYZ({ x: 7, y: 7, z: 7 });
            node.center = nc;
            expect(node.center).toBe(nc);
        });

        test("setting radius should update value", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            node.radius = 25;
            expect(node.radius).toBe(25);
        });

        test("setting isFace should update value", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockWireShape()),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            node.isFace = true;
            expect(node.isFace).toBe(true);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on radius change", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.radius = 99;
            expect(handler.mock.calls.map((c) => c[0])).toContain("radius");
        });

        test("should emit on center change", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.center = new XYZ({ x: 9, y: 9, z: 9 });
            expect(handler.mock.calls.map((c) => c[0])).toContain("center");
        });

        test("should emit on isFace change", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockWireShape()),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.isFace = true;
            expect(handler.mock.calls.map((c) => c[0])).toContain("isFace");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.circle, and when isFace=true also wire and toFace", () => {
            const mockCircle = createMockShape();
            const mockWire = createMockWireShape();
            const circle = rs.fn(() => Result.ok(mockCircle));
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(mockWire));

            setupShapeFactoryMock({ circle, wire });

            const node = new CircleNode({ document: doc, normal, center, radius: 10 });
            node.isFace = true;
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(circle).toHaveBeenCalledWith(normal, center, 10);
            // wire may be invoked by multiple re-evaluations; the original test asserted the last call
            expect(wire.mock.calls.at(-1)?.[0].length).toBe(1);
        });

        test("should return circle result when isFace is false", () => {
            const mockCircle = createMockShape();
            const circle = rs.fn(() => Result.ok(mockCircle));
            setupShapeFactoryMock({ circle });
            const node = new CircleNode({ document: doc, normal, center, radius: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(circle).toHaveBeenCalledWith(normal, center, 10);
        });

        test("should return Result.err when shapeFactory.circle fails", () => {
            setupShapeFactoryMock({
                circle: () => Result.err("circle creation failed"),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 5 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should return circle result when circle succeeds but wire fails (isFace=true)", () => {
            const mockCircle = createMockShape();
            setupShapeFactoryMock({
                circle: () => Result.ok(mockCircle),
                wire: () => Result.err("wire failed"),
            });
            const node = new CircleNode({ document: doc, normal, center, radius: 10 });
            node.isFace = true;
            const result = node.generateShape();
            // wire fails → returns original circle result, which is ok
            expect(result.isOk).toBe(true);
        });
    });
});
