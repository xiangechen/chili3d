// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { EllipseNode } from "../../src/bodys/ellipse";
import { createMockDocument } from "../_helpers";
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
            expect(node.name).toBe("body.ellipse");
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
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.majorRadius = 99;
            expect(events).toContain("majorRadius");
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
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.minorRadius = 88;
            expect(events).toContain("minorRadius");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.ellipse with all params", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                ellipse: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new EllipseNode({
                document: doc,
                normal,
                center,
                xvec,
                majorRadius: 20,
                minorRadius: 10,
            });
            node.generateShape();
            expect(calledWith[0]).toBe(normal);
            expect(calledWith[1]).toBe(center);
            expect(calledWith[2]).toBe(xvec);
            expect(calledWith[3]).toBe(20);
            expect(calledWith[4]).toBe(10);
        });
    });
});
