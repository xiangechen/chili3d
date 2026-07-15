// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, Serializer, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { SphereNode } from "../../src/bodys/sphere";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock, setupSimpleShapeFactoryMock } from "./_utils";

describe("SphereNode", () => {
    let doc: IDocument;
    const center = new XYZ({ x: 1, y: 2, z: 3 });

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize center and radius from options", () => {
            const node = new SphereNode({ document: doc, center, radius: 15 });
            expect(node.center).toBe(center);
            expect(node.radius).toBe(15);
        });

        test("should set name from display()", () => {
            const node = new SphereNode({ document: doc, center, radius: 5 });
            expect(node.name).toBe("body.sphere");
        });

        test("should accept zero radius", () => {
            const node = new SphereNode({ document: doc, center, radius: 0 });
            expect(node.radius).toBe(0);
        });
    });

    describe("display", () => {
        test("should return body.sphere", () => {
            const node = new SphereNode({ document: doc, center, radius: 5 });
            expect(node.display()).toBe("body.sphere");
        });
    });

    describe("getters", () => {
        test("center should return constructor value", () => {
            const c = new XYZ({ x: 10, y: 20, z: 30 });
            const node = new SphereNode({ document: doc, center: c, radius: 5 });
            expect(node.center).toBe(c);
        });

        test("radius should return constructor value", () => {
            const node = new SphereNode({ document: doc, center, radius: 42 });
            expect(node.radius).toBe(42);
        });
    });

    describe("setters", () => {
        test("setting center should update the value", () => {
            setupSimpleShapeFactoryMock("sphere");
            const node = new SphereNode({ document: doc, center, radius: 5 });
            const newCenter = new XYZ({ x: 7, y: 8, z: 9 });
            node.center = newCenter;
            expect(node.center).toBe(newCenter);
        });

        test("setting radius should update the value", () => {
            setupSimpleShapeFactoryMock("sphere");
            const node = new SphereNode({ document: doc, center, radius: 5 });
            node.radius = 25;
            expect(node.radius).toBe(25);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit when center changes", () => {
            setupSimpleShapeFactoryMock("sphere");
            const node = new SphereNode({ document: doc, center, radius: 5 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.center = new XYZ({ x: 99, y: 99, z: 99 });
            expect(events).toContain("center");
        });

        test("should emit when radius changes", () => {
            setupSimpleShapeFactoryMock("sphere");
            const node = new SphereNode({ document: doc, center, radius: 5 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.radius = 100;
            expect(events).toContain("radius");
        });
    });

    describe("serialize", () => {
        test("should serialize center and radius", () => {
            const node = new SphereNode({ document: doc, center, radius: 10 });
            doc.history.disabled = true;
            const s = Serializer.serializeObject(node);
            expect(s["radius"]).toBe(10);
            expect(s["center"]).toBeDefined();
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.sphere with correct params", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                sphere: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new SphereNode({ document: doc, center, radius: 15 });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toBe(center);
            expect(calledWith[1]).toBe(15);
        });
    });
});
