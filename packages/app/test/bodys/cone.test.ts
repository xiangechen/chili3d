// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, Serializer, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { ConeNode } from "../../src/bodys/cone";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("ConeNode", () => {
    let doc: IDocument;
    const normal = XYZ.unitZ;
    const center = XYZ.zero;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize all properties", () => {
            const node = new ConeNode({ document: doc, normal, center, radius: 10, dz: 25 });
            expect(node.normal).toBe(normal);
            expect(node.center).toBe(center);
            expect(node.radius).toBe(10);
            expect(node.dz).toBe(25);
        });

        test("should set name from display()", () => {
            const node = new ConeNode({ document: doc, normal, center, radius: 1, dz: 1 });
            expect(node.name).toBe("body.cone");
        });
    });

    describe("display", () => {
        test("should return body.cone", () => {
            const node = new ConeNode({ document: doc, normal, center, radius: 1, dz: 1 });
            expect(node.display()).toBe("body.cone");
        });
    });

    describe("getters", () => {
        test("should return correct values", () => {
            const node = new ConeNode({ document: doc, normal, center, radius: 8, dz: 16 });
            expect(node.radius).toBe(8);
            expect(node.dz).toBe(16);
            expect(node.center).toBe(center);
            expect(node.normal).toBe(normal);
        });
    });

    describe("setters", () => {
        test("should update center", () => {
            setupSimpleShapeFactoryMock("cone");
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const nc = new XYZ({ x: 7, y: 7, z: 7 });
            node.center = nc;
            expect(node.center).toBe(nc);
        });

        test("should update radius", () => {
            setupSimpleShapeFactoryMock("cone");
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 10 });
            node.radius = 30;
            expect(node.radius).toBe(30);
        });

        test("should update dz", () => {
            setupSimpleShapeFactoryMock("cone");
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 10 });
            node.dz = 50;
            expect(node.dz).toBe(50);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on radius change", () => {
            setupSimpleShapeFactoryMock("cone");
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.radius = 20;
            expect(events).toContain("radius");
        });

        test("should emit on dz change", () => {
            setupSimpleShapeFactoryMock("cone");
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.dz = 33;
            expect(events).toContain("dz");
        });
    });

    describe("serialize", () => {
        test("should serialize all properties", () => {
            const node = new ConeNode({ document: doc, normal, center, radius: 6, dz: 12 });
            doc.history.disabled = true;
            const s = Serializer.serializeObject(node);
            expect(s["radius"]).toBe(6);
            expect(s["dz"]).toBe(12);
            expect(s["normal"]).toBeDefined();
            expect(s["center"]).toBeDefined();
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.cone with correct params (radius2=0)", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                cone: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new ConeNode({ document: doc, normal, center, radius: 5, dz: 12 });
            node.generateShape();
            expect(calledWith[0]).toBe(normal);
            expect(calledWith[1]).toBe(center);
            expect(calledWith[2]).toBe(5); // radius
            expect(calledWith[3]).toBe(0); // ConeNode hardcodes 0 as radius2
            expect(calledWith[4]).toBe(12); // dz
        });
    });
});
