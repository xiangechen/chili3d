// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Plane, Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { RectNode } from "../../src/bodys/rect";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("RectNode", () => {
    let doc: IDocument;
    let plane: Plane;

    beforeEach(() => {
        doc = createMockDocument();
        plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
    });

    describe("constructor", () => {
        test("should initialize plane, dx, dy", () => {
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            expect(node.plane).toBe(plane);
            expect(node.dx).toBe(10);
            expect(node.dy).toBe(20);
        });

        test("should set name from display()", () => {
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            expect(node.name).toBe("body.rect");
        });

        test("isFace should default to false", () => {
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            expect(node.isFace).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.rect", () => {
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            expect(node.display()).toBe("body.rect");
        });
    });

    describe("getters", () => {
        test("should return plane, dx, dy", () => {
            const node = new RectNode({ document: doc, plane, dx: 15, dy: 25 });
            expect(node.dx).toBe(15);
            expect(node.dy).toBe(25);
            expect(node.plane).toBe(plane);
        });
    });

    describe("setters", () => {
        test("setting dx should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            node.dx = 42;
            expect(node.dx).toBe(42);
        });

        test("setting dy should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            node.dy = 42;
            expect(node.dy).toBe(42);
        });

        test("setting plane should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            const newPlane = new Plane({
                origin: new XYZ({ x: 1, y: 1, z: 0 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            });
            node.plane = newPlane;
            expect(node.plane).toBe(newPlane);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on dx change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dx = 99;
            expect(events).toContain("dx");
        });

        test("should emit on dy change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dy = 77;
            expect(events).toContain("dy");
        });
    });

    describe("static points()", () => {
        test("should return 5 points forming a closed rectangle", () => {
            const pts = RectNode.points(plane, 10, 20);
            expect(pts.length).toBe(5);
            expect(pts[0]).toBe(plane.origin); // first and last are origin
            expect(pts[4]).toBe(plane.origin);
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.polygon with computed points", () => {
            let calledPoints: any[] = [];
            setupShapeFactoryMock({
                polygon: (pts: any[]) => {
                    calledPoints = pts;
                    return Result.ok(createMockShape());
                },
            });
            const node = new RectNode({ document: doc, plane, dx: 10, dy: 20 });
            node.generateShape();
            expect(calledPoints.length).toBe(5);
        });
    });
});
