// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { FaceNode } from "../../src/bodys/face";
import { createMockDocument } from "../_helpers";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

describe("FaceNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize shapes", () => {
            const edge = createMockEdge();
            const wire = createMockWire();
            const shapes = [edge, wire] as any;
            const node = new FaceNode({ document: doc, shapes });
            expect(node.shapes).toBe(shapes);
        });

        test("should set name from display()", () => {
            const node = new FaceNode({ document: doc, shapes: [createMockEdge()] as any });
            expect(node.name).toBe("body.face");
        });

        test("should accept empty shapes array", () => {
            const node = new FaceNode({ document: doc, shapes: [] });
            expect(node.shapes.length).toBe(0);
        });
    });

    describe("display", () => {
        test("should return body.face", () => {
            const node = new FaceNode({ document: doc, shapes: [createMockEdge()] as any });
            expect(node.display()).toBe("body.face");
        });
    });

    describe("getters", () => {
        test("should return shapes from constructor", () => {
            const wire = createMockWire();
            const node = new FaceNode({ document: doc, shapes: [wire] as any });
            expect(node.shapes[0]).toBe(wire);
        });
    });

    describe("setters", () => {
        test("setting shapes should update value", () => {
            const mockFace = createMockShape();
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(mockFace),
            });
            const node = new FaceNode({ document: doc, shapes: [createMockEdge()] as any });
            const newShapes = [createMockWire(), createMockEdge({ isClosed: () => true })] as any;
            node.shapes = newShapes;
            expect(node.shapes).toBe(newShapes);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit when shapes change", () => {
            const mockFace = createMockShape();
            setupShapeFactoryMock({
                wire: () => Result.ok(createMockWire()),
                face: () => Result.ok(mockFace),
            });
            const node = new FaceNode({ document: doc, shapes: [createMockEdge()] as any });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.shapes = [createMockWire()] as any;
            expect(events).toContain("shapes");
        });
    });

    describe("generateShape", () => {
        test("should return error when shapes is empty", () => {
            const node = new FaceNode({ document: doc, shapes: [] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should call shapeFactory.wire and shapeFactory.face for closed edges", () => {
            let wireEdges: any[] = [];
            let faceWires: any[] = [];
            const mockWire = createMockWire();
            const faceShape = createMockShape();
            setupShapeFactoryMock({
                wire: (edges: any[]) => {
                    wireEdges = edges;
                    return Result.ok(mockWire);
                },
                face: (wires: any[]) => {
                    faceWires = wires;
                    return Result.ok(faceShape);
                },
            });
            const node = new FaceNode({
                document: doc,
                shapes: [createMockEdge({ isClosed: () => true })] as any,
            });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(wireEdges.length).toBe(1);
            expect(faceWires.length).toBe(1);
        });

        test("should use wire shapes directly without creating new wire", () => {
            let faceWires: any[] = [];
            const mockWire = createMockWire();
            setupShapeFactoryMock({
                face: (wires: any[]) => {
                    faceWires = wires;
                    return Result.ok(createMockShape());
                },
            });
            const node = new FaceNode({ document: doc, shapes: [mockWire] as any });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(faceWires.length).toBe(1);
        });
    });
});
