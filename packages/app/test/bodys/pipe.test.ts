// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IEdge, IWire } from "@chili3d/core";
import { Result, ShapeTypes, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PipeNode } from "../../src/bodys/pipe";
import { createMockDocument } from "../_helpers";
import { createMockEdge, createMockWireWithEdgeLoop, setupShapeFactoryMock } from "./_utils";

/**
 * Full mock that allows generateShape to complete (for setter/onPropertyChanged tests).
 */
function setupFullPipeMock(extra: Record<string, (...args: any[]) => any> = {}) {
    const solid = { shapeType: 0, dispose: () => {} };
    setupShapeFactoryMock({
        circle: () => Result.ok(createMockEdge()),
        wire: () =>
            Result.ok({
                shapeType: ShapeTypes.wire,
                edgeLoop: () => [],
            }),
        sweep: () => Result.ok(solid),
        booleanCut: () => Result.ok(solid),
        ...extra,
    });
}

describe("PipeNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize radius, path, bendRadius, thickness", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.radius).toBe(5);
            expect(node.path).toBe(path);
            expect(node.bendRadius).toBe(0);
            expect(node.thickness).toBe(0);
        });

        test("should set optional bendRadius and thickness", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, bendRadius: 10, thickness: 2 });
            expect(node.bendRadius).toBe(10);
            expect(node.thickness).toBe(2);
        });

        test("should set name from display()", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.name).toBe("body.pipe");
        });
    });

    describe("display", () => {
        test("should return body.pipe", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.display()).toBe("body.pipe");
        });
    });

    describe("getters", () => {
        test("should return constructor values", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 8, path });
            expect(node.radius).toBe(8);
            expect(node.path).toBe(path);
        });

        test("bendRadius default should be 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.bendRadius).toBe(0);
        });

        test("thickness default should be 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.thickness).toBe(0);
        });
    });

    describe("setters", () => {
        test("setting radius should update value", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            node.radius = 8;
            expect(node.radius).toBe(8);
        });

        test("setting bendRadius should update value", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            node.bendRadius = 5;
            expect(node.bendRadius).toBe(5);
        });

        test("setting thickness should update value", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            node.thickness = 2;
            expect(node.thickness).toBe(2);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on radius change", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.radius = 10;
            expect(events).toContain("radius");
        });

        test("should emit on bendRadius change", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.bendRadius = 3;
            expect(events).toContain("bendRadius");
        });

        test("should emit on thickness change", () => {
            const path: any = createMockWireWithEdgeLoop();
            setupFullPipeMock();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.thickness = 1;
            expect(events).toContain("thickness");
        });
    });

    describe("generateShape error paths", () => {
        test("should return error when path has no edges", () => {
            const wireWithEdges: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path: wireWithEdges });
            wireWithEdges.edgeLoop = () => [];
            setupShapeFactoryMock({});
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should return error when path is null (edgeLoop throws)", () => {
            const wireWithEdges: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path: wireWithEdges });
            wireWithEdges.edgeLoop = () => {
                throw new TypeError("Cannot read properties of null");
            };
            setupShapeFactoryMock({});
            expect(() => node.generateShape()).toThrow();
        });

        test("should return error when profile circle creation fails", () => {
            setupShapeFactoryMock({
                circle: () => Result.err("circle failed"),
            });
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should return error when profile wire creation fails", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () => Result.err("wire failed"),
            });
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });

        test("should return error when sweep fails", () => {
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () =>
                    Result.ok({
                        shapeType: ShapeTypes.wire,
                        edgeLoop: () => [],
                    }),
                sweep: () => Result.err("sweep failed"),
            });
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("generateShape success", () => {
        test("should complete full pipeline without thickness", () => {
            const solid = { shapeType: 0, dispose: () => {} };
            let sweepCallArgs: any[] | null = null;

            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () =>
                    Result.ok({
                        shapeType: ShapeTypes.wire,
                        edgeLoop: () => [],
                    }),
                sweep: (...args: any[]) => {
                    sweepCallArgs = args;
                    return Result.ok(solid as any);
                },
            });

            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(sweepCallArgs).not.toBeNull();
        });
    });

    describe("applyHollow", () => {
        test("should return solidResult directly when thickness is 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const solidResult = Result.ok({ shapeType: 0 } as any);
            const result = (node as any).applyHollow(solidResult, null, null, false);
            expect(result).toBe(solidResult);
        });

        test("should return solidResult when solidResult is not ok", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            const solidResult = Result.err("solid failed");
            const result = (node as any).applyHollow(solidResult, null, null, false);
            expect(result).toBe(solidResult);
        });

        test("should return error when thickness >= radius", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 10 });
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, null, null, false);
            expect(result.isOk).toBe(false);
        });

        test("should return solidResult when inner circle fails", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            setupShapeFactoryMock({
                circle: () => Result.err("inner circle failed"),
            });
            const plane: any = { normal: XYZ.unitZ, origin: XYZ.zero, xvec: XYZ.unitX };
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, plane, path, false);
            expect(result).toBe(solidResult);
        });

        test("should return solidResult when inner wire fails", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () => Result.err("inner wire failed"),
            });
            const plane: any = { normal: XYZ.unitZ, origin: XYZ.zero, xvec: XYZ.unitX };
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, plane, path, false);
            expect(result).toBe(solidResult);
        });

        test("should return solidResult when inner sweep fails", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () =>
                    Result.ok({
                        shapeType: ShapeTypes.wire,
                        edgeLoop: () => [],
                    }),
                sweep: () => Result.err("inner sweep failed"),
            });
            const plane: any = { normal: XYZ.unitZ, origin: XYZ.zero, xvec: XYZ.unitX };
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, plane, path, false);
            expect(result).toBe(solidResult);
        });

        test("should return hollow result when boolean cut succeeds", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            const hollowSolid = { shapeType: 3 };
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () =>
                    Result.ok({
                        shapeType: ShapeTypes.wire,
                        edgeLoop: () => [],
                    }),
                sweep: () => Result.ok({} as any),
                booleanCut: () => Result.ok(hollowSolid as any),
            });
            const plane: any = { normal: XYZ.unitZ, origin: XYZ.zero, xvec: XYZ.unitX };
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, plane, path, false);
            expect(result.isOk).toBe(true);
        });

        test("should return solidResult when boolean cut fails", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, thickness: 2 });
            setupShapeFactoryMock({
                circle: () => Result.ok(createMockEdge()),
                wire: () =>
                    Result.ok({
                        shapeType: ShapeTypes.wire,
                        edgeLoop: () => [],
                    }),
                sweep: () => Result.ok({} as any),
                booleanCut: () => Result.err("cut failed"),
            });
            const plane: any = { normal: XYZ.unitZ, origin: XYZ.zero, xvec: XYZ.unitX };
            const solidResult = Result.ok({} as any);
            const result = (node as any).applyHollow(solidResult, plane, path, false);
            expect(result).toBe(solidResult);
        });
    });

    describe("ensureWire", () => {
        test("should return the same wire when given a wire", () => {
            const wirePath: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path: wirePath });
            const result = (node as any).ensureWire(wirePath);
            expect(result.shapeType).toBe(ShapeTypes.wire);
        });

        test("should convert edge to wire via shapeFactory.wire", () => {
            const mockWire = {
                shapeType: ShapeTypes.wire,
                edgeLoop: () => [],
                value: undefined,
            };
            setupShapeFactoryMock({
                wire: () => Result.ok(mockWire as any),
            });
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const edgeInput: any = createMockEdge({ shapeType: ShapeTypes.edge });
            const result = (node as any).ensureWire(edgeInput);
            expect(result.shapeType).toBe(ShapeTypes.wire);
        });
    });
});
