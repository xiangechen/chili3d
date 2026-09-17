// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { PolygonNode } from "../../src/bodys/polygon";
import { createMockShape, createMockWireShape, setupShapeFactoryMock } from "./_utils";

describe("PolygonNode", () => {
    let doc: IDocument;
    const points = [
        new XYZ({ x: 0, y: 0, z: 0 }),
        new XYZ({ x: 10, y: 0, z: 0 }),
        new XYZ({ x: 10, y: 10, z: 0 }),
        new XYZ({ x: 0, y: 0, z: 0 }),
    ];

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize points", () => {
            const node = new PolygonNode({ document: doc, points });
            expect(node.points).toBe(points);
        });

        test("should set name from display()", () => {
            const node = new PolygonNode({ document: doc, points });
            expect(node.name).toBe("body.polygon1");
        });

        test("isFace should default to false", () => {
            const node = new PolygonNode({ document: doc, points });
            expect(node.isFace).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.polygon", () => {
            const node = new PolygonNode({ document: doc, points });
            expect(node.display()).toBe("body.polygon");
        });
    });

    describe("getters", () => {
        test("should return points", () => {
            const node = new PolygonNode({ document: doc, points });
            expect(node.points.length).toBe(4);
            expect(node.points[0].x).toBe(0);
        });
    });

    describe("setters", () => {
        test("setting points should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new PolygonNode({ document: doc, points });
            const np = [new XYZ({ x: 1, y: 1, z: 0 }), new XYZ({ x: 2, y: 2, z: 0 })];
            node.points = np;
            expect(node.points).toBe(np);
        });

        test("setting isFace should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockWireShape()),
            });
            const node = new PolygonNode({ document: doc, points });
            node.isFace = true;
            expect(node.isFace).toBe(true);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on points change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new PolygonNode({ document: doc, points });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.points = [new XYZ({ x: 1, y: 1, z: 0 })];
            expect(handler.mock.calls.map((c) => c[0])).toContain("points");
        });

        test("should emit on isFace change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockWireShape()),
            });
            const node = new PolygonNode({ document: doc, points });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.isFace = true;
            expect(handler.mock.calls.map((c) => c[0])).toContain("isFace");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.polygon with points", () => {
            const polygon = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ polygon });
            const node = new PolygonNode({ document: doc, points });
            node.generateShape();
            expect(polygon).toHaveBeenCalledWith(points);
        });

        test("should return wire result when isFace is false", () => {
            const mockWire = createMockShape();
            setupShapeFactoryMock({ polygon: () => Result.ok(mockWire) });
            const node = new PolygonNode({ document: doc, points });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when shapeFactory.polygon fails", () => {
            setupShapeFactoryMock({
                polygon: () => Result.err("polygon creation failed"),
            });
            const node = new PolygonNode({ document: doc, points });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should call toFace() when isFace is true and polygon succeeds", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockWireShape()),
            });
            const node = new PolygonNode({ document: doc, points });
            node.isFace = true;
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
        });

        test("should return wire result when polygon fails for isFace mode", () => {
            setupShapeFactoryMock({
                polygon: () => Result.err("polygon failed"),
            });
            const node = new PolygonNode({ document: doc, points });
            node.isFace = true;
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
