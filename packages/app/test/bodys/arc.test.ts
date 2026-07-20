// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { ArcNode } from "../../src/bodys/arc";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("ArcNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const center = XYZ.zero;
    const start = new XYZ({ x: 10, y: 0, z: 0 });

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize normal, center, start, angle", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.start).toBe(start);
            expect(node.angle).toBe(90);
        });

        test("should set name from display()", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            expect(node.name).toBe("body.arc");
        });
    });

    describe("display", () => {
        test("should return body.arc", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 45 });
            expect(node.display()).toBe("body.arc");
        });
    });

    describe("getters", () => {
        test("should return normal, center, start, angle", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 180 });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.start).toBe(start);
            expect(node.angle).toBe(180);
        });

        test("start should be read-only (no setter)", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            expect(node.start).toBe(start);
        });

        test("normal should be read-only (no setter)", () => {
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            expect(node.normal).toBe(normal);
        });
    });

    describe("setters", () => {
        test("setting center should update value", () => {
            setupShapeFactoryMock({ arc: () => Result.ok(createMockShape()) });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            const nc = new XYZ({ x: 1, y: 1, z: 1 });
            node.center = nc;
            expect(node.center).toBe(nc);
        });

        test("setting angle should update value", () => {
            setupShapeFactoryMock({ arc: () => Result.ok(createMockShape()) });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            node.angle = 180;
            expect(node.angle).toBe(180);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on angle change", () => {
            setupShapeFactoryMock({ arc: () => Result.ok(createMockShape()) });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.angle = 45;
            expect(events).toContain("angle");
        });

        test("should emit on center change", () => {
            setupShapeFactoryMock({ arc: () => Result.ok(createMockShape()) });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.center = new XYZ({ x: 2, y: 2, z: 2 });
            expect(events).toContain("center");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.arc", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                arc: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            node.generateShape();
            expect(calledWith[0]).toBe(normal);
            expect(calledWith[1]).toBe(center);
            expect(calledWith[2]).toBe(start);
            expect(calledWith[3]).toBe(90);
        });

        test("should return Result.err when shapeFactory.arc fails", () => {
            setupShapeFactoryMock({
                arc: () => Result.err("arc creation failed"),
            });
            const node = new ArcNode({ document: doc, normal, center, start, angle: 90 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
