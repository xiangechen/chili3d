// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { RegularPolygonNode } from "../../src/bodys/regularPolygon";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("RegularPolygonNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const xvec = XYZ.unitX;
    const center = XYZ.zero;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties", () => {
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            expect(node.normal).toBe(normal);
            expect(node.xvec).toBe(xvec);
            expect(node.center).toBe(center);
            expect(node.radius).toBe(10);
            expect(node.sides).toBe(6);
        });

        test("should set name from display()", () => {
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 5,
            });
            expect(node.name).toBe("body.regularPolygon");
        });

        test("isFace should default to false", () => {
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 3,
            });
            expect(node.isFace).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.regularPolygon", () => {
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 4,
            });
            expect(node.display()).toBe("body.regularPolygon");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const c = new XYZ({ x: 5, y: 5, z: 0 });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center: c,
                radius: 15,
                sides: 8,
            });
            expect(node.center).toBe(c);
            expect(node.radius).toBe(15);
            expect(node.sides).toBe(8);
        });
    });

    describe("setters", () => {
        test("setting radius should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            node.radius = 30;
            expect(node.radius).toBe(30);
        });

        test("setting sides should update value", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            node.sides = 8;
            expect(node.sides).toBe(8);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on radius change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.radius = 20;
            expect(events).toContain("radius");
        });

        test("should emit on sides change", () => {
            setupShapeFactoryMock({
                polygon: () => Result.ok(createMockShape()),
                wire: () => Result.ok(createMockShape()),
            });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.sides = 7;
            expect(events).toContain("sides");
        });
    });

    describe("calculateVertices", () => {
        test("should return sides+1 vertices closing the polygon", () => {
            const vertices = RegularPolygonNode.calculateVertices(XYZ.zero, 10, 5, XYZ.unitZ, XYZ.unitX);
            expect(vertices.length).toBe(6); // sides+1 (closed)
            expect(vertices[0]).toEqual(vertices[5]); // first === last
        });

        test("vertices should be on a circle of given radius", () => {
            const vertices = RegularPolygonNode.calculateVertices(XYZ.zero, 10, 4, XYZ.unitZ, XYZ.unitX);
            for (let i = 0; i < 4; i++) {
                const dist = Math.sqrt(vertices[i].x ** 2 + vertices[i].y ** 2 + vertices[i].z ** 2);
                expect(Math.abs(dist - 10)).toBeLessThan(0.0001);
            }
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.polygon", () => {
            let calledPoints: any[] = [];
            setupShapeFactoryMock({
                polygon: (pts: any[]) => {
                    calledPoints = pts;
                    return Result.ok(createMockShape());
                },
            });
            const node = new RegularPolygonNode({
                document: doc,
                normal,
                xvec,
                center,
                radius: 10,
                sides: 6,
            });
            node.generateShape();
            expect(calledPoints.length).toBe(7); // sides + 1
        });
    });
});
