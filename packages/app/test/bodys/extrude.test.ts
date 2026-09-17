// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IShape } from "@chili3d/core";
import { Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockDocument, createMockEdgeCurve } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { ExtrudeNode } from "../../src/bodys/extrude";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

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
            expect(node.name).toBe("body.extrude1");
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
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.length = 77;
            expect(handler.mock.calls.map((c) => c[0])).toContain("length");
        });

        test("should emit on section change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.section = createMockWire() as any;
            expect(handler.mock.calls.map((c) => c[0])).toContain("section");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.prism for non-face wire section", () => {
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            node.generateShape();
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0].length).toBe(2);
            expect(prism.mock.calls[0][0]).toBe(section);
        });

        test("should convert closed wire to face and prism the face to produce a solid", () => {
            const closedWire = Object.assign(createMockWire(), { isClosed: () => true });
            const faceShape = createMockShape();
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ face, prism });
            const node = new ExtrudeNode({ document: doc, section: closedWire, length: 10 });
            const result = node.generateShape();
            expect(face).toHaveBeenCalledWith([closedWire]);
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when face creation fails for closed wire", () => {
            const closedWire = Object.assign(createMockWire(), { isClosed: () => true });
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ face: () => Result.err("face creation failed"), prism });
            const node = new ExtrudeNode({ document: doc, section: closedWire, length: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(prism).not.toHaveBeenCalled();
        });

        test("should convert closed edge (circle) to wire then face before prism", () => {
            const circle = createMockEdge({ curve: createMockEdgeCurve() });
            const wireShape = createMockWire();
            const faceShape = createMockShape();
            const wire = rs.fn((_edges: any[]) => Result.ok(wireShape as any));
            const face = rs.fn((_wires: any[]) => Result.ok(faceShape as any));
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ wire, face, prism });
            const node = new ExtrudeNode({ document: doc, section: circle, length: 10 });
            const result = node.generateShape();
            expect(wire).toHaveBeenCalledWith([circle]);
            expect(face).toHaveBeenCalledWith([wireShape]);
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(faceShape);
            expect(result.isOk).toBe(true);
        });

        test("should return Result.err when wire creation fails for closed edge", () => {
            const circle = createMockEdge({ curve: createMockEdgeCurve() });
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ wire: () => Result.err("wire creation failed"), prism });
            const node = new ExtrudeNode({ document: doc, section: circle, length: 10 });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
            expect(prism).not.toHaveBeenCalled();
        });

        test("should prism open edge directly without creating a face", () => {
            const openEdge = createMockEdge({ isClosed: () => false, curve: createMockEdgeCurve() });
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = new ExtrudeNode({ document: doc, section: openEdge, length: 10 });
            const result = node.generateShape();
            expect(prism).toHaveBeenCalledTimes(1);
            expect(prism.mock.calls[0][0]).toBe(openEdge);
            expect(result.isOk).toBe(true);
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
            const faceSectionWithPlanarSurface = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => true }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            const prism = rs.fn((_shape: IShape, _vec: XYZ) => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({ prism });
            const node = new ExtrudeNode({
                document: doc,
                section: faceSectionWithPlanarSurface as any,
                length: 20,
            });
            node.generateShape();
            expect(prism.mock.calls[0][0]).toBe(faceSectionWithPlanarSurface);
        });

        test("should call shapeFactory.makeThickSolidBySimple for non-planar face", () => {
            const faceSectionNonPlanar = {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => false }),
                normal: (_u: number, _v: number) => [null, { normalize: () => XYZ.unitZ }],
            };
            const makeThickSolidBySimple = rs.fn(() => Result.ok(createMockShape() as any));
            setupShapeFactoryMock({
                makeThickSolidBySimple,
                prism: () => Result.err("should not call prism"),
            });
            const node = new ExtrudeNode({ document: doc, section: faceSectionNonPlanar as any, length: 20 });
            const result = node.generateShape();
            expect(makeThickSolidBySimple).toHaveBeenCalledWith(faceSectionNonPlanar, 20);
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
