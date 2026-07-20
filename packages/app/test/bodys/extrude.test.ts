// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, ShapeTypes, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { ExtrudeNode } from "../../src/bodys/extrude";
import { createMockDocument } from "../_helpers";
import { createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

describe("ExtrudeNode", () => {
    let doc: IDocument;
    let section: any;

    beforeEach(() => {
        doc = createMockDocument();
        section = createMockWire();
    });

    describe("constructor", () => {
        test("should initialize section and length", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 50 });
            expect(node.section).toBe(section);
            expect(node.length).toBe(50);
        });

        test("should set name from display()", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            expect(node.name).toBe("body.extrude");
        });
    });

    describe("display", () => {
        test("should return body.extrude", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            expect(node.display()).toBe("body.extrude");
        });
    });

    describe("getters", () => {
        test("should return section and length", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 42 });
            expect(node.section).toBe(section);
            expect(node.length).toBe(42);
        });
    });

    describe("setters", () => {
        test("setting section should update value", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const newSection = createMockWire();
            node.section = newSection as any;
            expect(node.section).toBe(newSection);
        });

        test("setting length should update value", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            node.length = 99;
            expect(node.length).toBe(99);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on length change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.length = 77;
            expect(events).toContain("length");
        });

        test("should emit on section change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.section = createMockWire() as any;
            expect(events).toContain("section");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.prism for non-face wire section", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                prism: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape() as any);
                },
            });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            node.generateShape();
            expect(calledWith.length).toBe(2);
            expect(calledWith[0]).toBe(section);
        });

        test("should return Result.err when shapeFactory.prism fails", () => {
            setupShapeFactoryMock({
                prism: () => Result.err("prism creation failed"),
            });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should call shapeFactory.prism for face with planar surface", () => {
            let calledWith: any[] = [];
            const faceSectionWithPlanarSurface = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => true }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            setupShapeFactoryMock({
                prism: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape() as any);
                },
            });
            const node = new ExtrudeNode({
                document: doc,
                section: faceSectionWithPlanarSurface as any,
                length: 20,
            });
            node.generateShape();
            expect(calledWith[0]).toBe(faceSectionWithPlanarSurface);
        });

        test("should call shapeFactory.makeThickSolidBySimple for non-planar face", () => {
            let calledMethod: string | null = null;
            let calledArgs: any[] = [];
            const faceSectionNonPlanar = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => false }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            setupShapeFactoryMock({
                makeThickSolidBySimple: (...args: any[]) => {
                    calledMethod = "makeThickSolidBySimple";
                    calledArgs = args;
                    return Result.ok(createMockShape() as any);
                },
                prism: () => Result.err("should not call prism"),
            });
            const node = new ExtrudeNode({ document: doc, section: faceSectionNonPlanar as any, length: 20 });
            const result = node.generateShape();
            expect(calledMethod).toBe("makeThickSolidBySimple");
            expect(calledArgs[0]).toBe(faceSectionNonPlanar);
            expect(calledArgs[1]).toBe(20);
            expect(result.isOk).toBe(true);
        });

        test("should return error when makeThickSolidBySimple fails for non-planar face", () => {
            const faceSectionNonPlanar = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => false }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            setupShapeFactoryMock({
                makeThickSolidBySimple: () => Result.err("thick solid failed"),
            });
            const node = new ExtrudeNode({ document: doc, section: faceSectionNonPlanar as any, length: 20 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
