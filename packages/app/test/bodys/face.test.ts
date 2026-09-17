// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IEdge, IWire, ShapeType } from "@chili3d/core";
import { Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockDocument, createMockEdgeCurve } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { FaceNode } from "../../src/bodys/face";
import { createMockEdge, createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

function mockLineEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    return createMockEdge({
        curve: createMockEdgeCurve({
            start: new XYZ({ x: x1, y: y1, z: 0 }),
            end: new XYZ({ x: x2, y: y2, z: 0 }),
            valueFn: (t: number) => new XYZ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, z: 0 }),
        }),
        ends: () => [new XYZ({ x: x1, y: y1, z: 0 }), new XYZ({ x: x2, y: y2, z: 0 })],
    }) as unknown as IEdge;
}

// FaceNode uses closed wires directly, so the wire mocks in these tests must report
// isClosed() = true and expose their edges (the shared createMockWire() is unclosed).
function mockClosedWire(...edges: IEdge[]) {
    return Object.assign(createMockWire(), {
        isClosed: () => true,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
    });
}

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
            expect(node.name).toBe("body.face1");
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
            const newShapes = [createMockWire(), mockLineEdge(0, 0, 10, 0)] as any;
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
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.shapes = [mockClosedWire(mockLineEdge(0, 0, 10, 0), mockLineEdge(10, 0, 10, 10))] as any;
            expect(handler.mock.calls.map((c) => c[0])).toContain("shapes");
        });
    });

    describe("generateShape", () => {
        test("should return error when shapes is empty", () => {
            const node = new FaceNode({ document: doc, shapes: [] });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should call shapeFactory.wire and shapeFactory.face for closed edges", () => {
            const mockWire = createMockWire();
            const faceShape = createMockShape();
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(mockWire));
            const face = rs.fn((_wires: IWire[]) => Result.ok(faceShape));
            setupShapeFactoryMock({ wire, face });
            const node = new FaceNode({
                document: doc,
                shapes: [mockLineEdge(0, 0, 10, 0)] as any,
            });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(1);
            expect(wire.mock.calls[0][0].length).toBe(1);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(1);
        });

        test("should group disjoint edge loops into separate wires", () => {
            const mockWire = createMockWire();
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(mockWire));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ wire, face });
            // two disjoint rectangles, edges interleaved and unordered
            const outer = [
                mockLineEdge(0, 0, 100, 0),
                mockLineEdge(100, 0, 100, 100),
                mockLineEdge(100, 100, 0, 100),
                mockLineEdge(0, 100, 0, 0),
            ] as unknown as IEdge[];
            const inner = [
                mockLineEdge(10, 10, 90, 10),
                mockLineEdge(90, 10, 90, 90),
                mockLineEdge(90, 90, 10, 90),
                mockLineEdge(10, 90, 10, 10),
            ] as unknown as IEdge[];
            const shapes = [outer[0], inner[0], outer[1], inner[1], inner[2], outer[2], inner[3], outer[3]];
            const node = new FaceNode({ document: doc, shapes: shapes });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(2);
            const groups = wire.mock.calls.map((c) => c[0] as IEdge[]);
            expect(groups.every((g) => g.length === 4)).toBe(true);
            const [first, second] = groups;
            expect(outer.every((e) => first.includes(e)) || outer.every((e) => second.includes(e))).toBe(
                true,
            );
            expect(inner.every((e) => first.includes(e)) || inner.every((e) => second.includes(e))).toBe(
                true,
            );
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(2);
        });

        test("should combine wires with grouped edge loops", () => {
            const existingWire = mockClosedWire(mockLineEdge(0, 0, 100, 0), mockLineEdge(100, 0, 100, 100));
            const wire = rs.fn((_edges: IEdge[]) => Result.ok(createMockWire()));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ wire, face });
            const node = new FaceNode({
                document: doc,
                shapes: [existingWire, mockLineEdge(0, 0, 10, 0), mockLineEdge(10, 0, 10, 10)] as any,
            });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(wire).toHaveBeenCalledTimes(1);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(2);
            expect(face.mock.calls[0][0][0]).toBe(existingWire);
        });

        test("should use wire shapes directly without creating new wire", () => {
            const mockWire = mockClosedWire(mockLineEdge(0, 0, 10, 0), mockLineEdge(10, 0, 10, 10));
            const face = rs.fn((_wires: IWire[]) => Result.ok(createMockShape()));
            setupShapeFactoryMock({ face });
            const node = new FaceNode({ document: doc, shapes: [mockWire] as any });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(face).toHaveBeenCalledTimes(1);
            expect(face.mock.calls[0][0].length).toBe(1);
        });

        test("should throw error when wire from unclosed edges fails", () => {
            setupShapeFactoryMock({
                wire: () => Result.err("cannot create wire"),
            });
            const node = new FaceNode({
                document: doc,
                shapes: [mockLineEdge(0, 0, 10, 0)] as any,
            });
            expect(() => node.generateShape()).toThrow("Cannot create wire from open shapes");
        });
    });
});
