// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, Serializer, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { CylinderNode } from "../../src/bodys/cylinder";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("CylinderNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const center = new XYZ({ x: 5, y: 10, z: 0 });

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties", () => {
            const node = new CylinderNode({ document: doc, normal, center, radius: 8, dz: 20 });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.radius).toBe(8);
            expect(node.dz).toBe(20);
        });

        test("should set name from display()", () => {
            const node = new CylinderNode({ document: doc, normal, center, radius: 1, dz: 1 });
            expect(node.name).toBe("body.cylinder");
        });
    });

    describe("display", () => {
        test("should return body.cylinder", () => {
            const node = new CylinderNode({ document: doc, normal, center, radius: 1, dz: 1 });
            expect(node.display()).toBe("body.cylinder");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const node = new CylinderNode({ document: doc, normal, center, radius: 12, dz: 34 });
            expect(node.radius).toBe(12);
            expect(node.dz).toBe(34);
            expect(node.center).toBe(center);
            expect(node.normal).toBe(normal);
        });
    });

    describe("setters", () => {
        test("should update center", () => {
            setupSimpleShapeFactoryMock("cylinder");
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const nc = new XYZ({ x: 99, y: 99, z: 99 });
            node.center = nc;
            expect(node.center).toBe(nc);
        });

        test("should update radius", () => {
            setupSimpleShapeFactoryMock("cylinder");
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            node.radius = 50;
            expect(node.radius).toBe(50);
        });

        test("should update dz", () => {
            setupSimpleShapeFactoryMock("cylinder");
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            node.dz = 100;
            expect(node.dz).toBe(100);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on radius change", () => {
            setupSimpleShapeFactoryMock("cylinder");
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.radius = 99;
            expect(events).toContain("radius");
        });

        test("should emit on dz change", () => {
            setupSimpleShapeFactoryMock("cylinder");
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dz = 88;
            expect(events).toContain("dz");
        });
    });

    describe("serialize", () => {
        test("should serialize all properties", () => {
            const node = new CylinderNode({ document: doc, normal, center, radius: 7, dz: 15 });
            doc.history.disabled = true;
            const s = Serializer.serializeObject(node);
            expect(s["radius"]).toBe(7);
            expect(s["dz"]).toBe(15);
            expect(s["normal"]).toBeDefined();
            expect(s["center"]).toBeDefined();
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.cylinder", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                cylinder: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toBe(normal);
            expect(calledWith[1]).toBe(center);
            expect(calledWith[2]).toBe(5);
            expect(calledWith[3]).toBe(10);
        });

        test("should return Result.err when shapeFactory.cylinder fails", () => {
            setupShapeFactoryMock({
                cylinder: () => Result.err("cylinder creation failed"),
            });
            const node = new CylinderNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
