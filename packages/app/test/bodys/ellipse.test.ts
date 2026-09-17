// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { EllipseNode } from "../../src/bodys/ellipse";
import { createMockShape, createMockWireShape, setupShapeFactoryMock } from "./_utils";

describe("EllipseNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const center = XYZ.zero;
    const xvec = XYZ.unitX;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.xvec).toBe(xvec);
            expect(node.majorRadius).toBe(20);
            expect(node.minorRadius).toBe(10);
        });

        test("should set name from display()", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            expect(node.name).toBe("body.ellipse1");
        });

        test("isFace should default to false", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            expect(node.isFace).toBe(false);
        });

        test("isFace should be true when option isFace=true", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
                isFace: true,
            });
            expect(node.isFace).toBe(true);
        });
    });

    describe("display", () => {
        test("should return body.ellipse", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            expect(node.display()).toBe("body.ellipse");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 30,
                minorRadius: 15,
            });
            expect(node.majorRadius).toBe(30);
            expect(node.minorRadius).toBe(15);
            expect(node.normal).toBe(normal);
            expect(node.xvec).toBe(xvec);
        });
    });

    describe("setters", () => {
        test("setting center should update value", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const newCenter = new XYZ({ x: 5, y: 5, z: 0 });
            node.center = newCenter;
            expect(node.center).toBe(newCenter);
        });

        test("setting majorRadius should update value", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            node.majorRadius = 40;
            expect(node.majorRadius).toBe(40);
        });

        test("setting minorRadius should update value", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            node.minorRadius = 25;
            expect(node.minorRadius).toBe(25);
        });

        test("setting isFace should update value", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockWireShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            node.isFace = true;
            expect(node.isFace).toBe(true);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on center change", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.center = new XYZ({ x: 1, y: 1, z: 0 });
            expect(handler.mock.calls.map((c) => c[0])).toContain("center");
        });

        test("should emit on majorRadius change", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.majorRadius = 99;
            expect(handler.mock.calls.map((c) => c[0])).toContain("majorRadius");
        });

        test("should emit on minorRadius change", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.minorRadius = 88;
            expect(handler.mock.calls.map((c) => c[0])).toContain("minorRadius");
        });

        test("should emit on isFace change", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockWireShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.isFace = true;
            expect(handler.mock.calls.map((c) => c[0])).toContain("isFace");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.ellipse with all params", () => {
            const ellipse = rs.fn(() => Result.ok(createMockShape()));
            setupShapeFactoryMock({ ellipse });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            node.generateShape();
            expect(ellipse).toHaveBeenCalledWith(normal, center, xvec, 20, 10);
        });

        test("should return Result.err when shapeFactory.ellipse fails", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.err("ellipse creation failed"),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should wire+toFace when isFace is true and ellipse succeeds", () => {
            setupShapeFactoryMock({
                ellipse: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockWireShape()),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
                isFace: true,
            });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
        });

        test("should return ellipse result when wire creation fails for isFace", () => {
            const mockEdge = createMockShape();
            setupShapeFactoryMock({
                ellipse: () => Result.ok(mockEdge),
                wire: () => Result.err("wire failed"),
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
                isFace: true,
            });
            const result = node.generateShape();
            // wire failed, falls back to circle result
            expect(result.isOk).toBe(true);
        });
    });
});
