// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../src/config";
import { Result } from "../src/foundation";
import { Matrix4 } from "../src/math";
import * as ShapeNodeClasses from "../src/model/shapeNode";
import type { EdgeMeshData, IShape, IShapeMeshData } from "../src/shape";
import { TestDocument } from "./testDocument";

// Mock implementations for testing
class MockShape implements IShape {
    constructor(public readonly shapeType: any = "test" as any) {}

    get id(): string {
        return "test-shape-id";
    }
    get mesh(): IShapeMeshData {
        return {
            faces: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                range: [{ start: 0, count: 3, shape: {} as any }],
                groups: [],
                color: VisualConfig.defaultFaceColor,
            },
            edges: {
                lineType: "solid",
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0]),
                range: [{ start: 0, count: 4, shape: {} as any }],
                color: VisualConfig.defaultEdgeColor,
            },
            vertexs: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]),
                color: VisualConfig.defaultFaceColor,
                range: [],
                size: 3,
            },
        };
    }
    get matrix(): Matrix4 {
        return Matrix4.identity();
    }

    transformed(_matrix: Matrix4): IShape {
        return new MockShape();
    }
    transformedMul(_matrix: Matrix4): IShape {
        return new MockShape();
    }
    edgesMeshPosition(): EdgeMeshData {
        return this.mesh.edges!;
    }
    isClosed(): boolean {
        return true;
    }
    isNull(): boolean {
        return false;
    }
    isEqual(other: IShape): boolean {
        return this === other;
    }
    isSame(other: IShape): boolean {
        return this === other;
    }
    isPartner(other: IShape): boolean {
        return this === other;
    }
    orientation(): any {
        return "FORWARD" as any;
    }
    findAncestor(_ancestorType: any, _fromShape: IShape): IShape[] {
        return [];
    }
    findSubShapes(_subshapeType: any): IShape[] {
        return [];
    }
    iterShape(): IShape[] {
        return [this];
    }
    section(_shape: IShape | any): IShape {
        return new MockShape();
    }
    split(_shapes: IShape[]): IShape {
        return new MockShape();
    }
    reserve(): void {}
    clone(): IShape {
        return new MockShape();
    }
    hlr(_position: any, _direction: any, _xDir: any): IShape {
        return new MockShape();
    }
    dispose(): void {}
}

describe("shapeNode", () => {
    let doc: TestDocument;
    let mockShape: MockShape;

    beforeEach(() => {
        doc = new TestDocument();
        mockShape = new MockShape();
    });

    beforeEach(() => {
        doc = new TestDocument();
        mockShape = new MockShape();
    });

    describe("ShapeNode", () => {
        let node: any;

        beforeEach(() => {
            node = class extends ShapeNodeClasses.ShapeNode {
                display(): any {
                    return "test.shape";
                }

                protected override createMesh(): IShapeMeshData {
                    return { edges: undefined, faces: undefined, vertexs: undefined };
                }
            };
            node = new node(doc, "test", "mat1");
        });

        describe("shape property", () => {
            test("should return initial error state", () => {
                const shape = node.shape;
                expect(shape.isOk).toBe(false);
                expect(shape.error).toBe("Shape not initialized");
            });
        });

        describe("setShape", () => {
            test("should set valid shape", () => {
                const shapeResult = Result.ok(mockShape);
                (node as any).setShape(shapeResult);

                expect(node.shape.isOk).toBe(true);
                expect(node.shape.value).toBe(mockShape);
            });

            test("should not set shape if equal to existing", () => {
                const shapeResult = Result.ok(mockShape);
                (node as any).setShape(shapeResult);

                // Try to set the same shape again - should not cause issues
                (node as any).setShape(shapeResult);

                expect(node.shape.isOk).toBe(true);
            });

            test("should handle error for invalid shape", () => {
                const errorResult = Result.err("Invalid shape");
                (node as any).setShape(errorResult);

                // Shape should remain in error state
                expect(node.shape.isOk).toBe(false);
            });

            test("should clear mesh cache when shape changes", () => {
                const shapeResult = Result.ok(mockShape);
                (node as any)._mesh = { test: "data" };

                (node as any).setShape(shapeResult);

                expect((node as any)._mesh).toBeUndefined();
            });
        });

        describe("createMesh", () => {
            test("should return empty mesh when shape is invalid", () => {
                const mesh = (node as any).createMesh();
                expect(mesh.edges).toBeUndefined();
                expect(mesh.faces).toBeUndefined();
            });

            test("should create mesh from valid shape", () => {
                (node as any).setShape(Result.ok(mockShape));
                const mesh = (node as any).createMesh();

                // The mock createMesh returns empty data, but that's expected
                expect(mesh).toBeDefined();
            });
        });

        describe("disposeInternal", () => {
            test("should dispose shape and set to null", () => {
                (node as any).setShape(Result.ok(mockShape));

                (node as any).disposeInternal();

                expect((node as any)._shape).toBeNull();
            });
        });
    });

    describe("MultiShapeMesh", () => {
        let multiShapeMesh: any;

        beforeEach(() => {
            multiShapeMesh = new ShapeNodeClasses.MultiShapeMesh();
        });

        test("should initialize with empty edges and faces", () => {
            expect(multiShapeMesh.edges).toBeUndefined();
            expect(multiShapeMesh.faces).toBeUndefined();
        });

        test("should add shape to mesh", () => {
            const matrix = Matrix4.identity();

            // Should not throw when adding shape
            expect(() => {
                multiShapeMesh.addShape(mockShape, matrix);
            }).not.toThrow();
        });

        test("should return edges when position length > 0", () => {
            // Add a shape to populate edges
            multiShapeMesh.addShape(mockShape, Matrix4.identity());
            expect(multiShapeMesh.edges).toBeDefined();
        });

        test("should return faces when position length > 0", () => {
            // Add a shape to populate faces
            multiShapeMesh.addShape(mockShape, Matrix4.identity());
            expect(multiShapeMesh.faces).toBeDefined();
        });
    });

    describe("MultiShapeNode", () => {
        let shapes: MockShape[];

        beforeEach(() => {
            shapes = [new MockShape(), new MockShape()];
        });

        test("should initialize with shapes", () => {
            const node = new ShapeNodeClasses.MultiShapeNode(doc, "multi", shapes);
            expect(node.shapes).toEqual(shapes);
        });

        test("should create mesh from multiple shapes", () => {
            const node = new ShapeNodeClasses.MultiShapeNode(doc, "multi", shapes);
            const mesh = (node as any).createMesh();

            expect(mesh).toBeDefined();
        });

        test("should return correct display key", () => {
            const node = new ShapeNodeClasses.MultiShapeNode(doc, "multi", shapes);
            expect(node.display()).toBe("body.multiShape");
        });
    });

    describe("ParameterShapeNode", () => {
        let node: any;

        beforeEach(() => {
            node = class extends ShapeNodeClasses.ParameterShapeNode {
                protected generateShape(): Result<IShape> {
                    return Result.ok(new MockShape());
                }

                display(): any {
                    return "test.parameterShape";
                }
            };
            node = new node(doc);
        });

        test("should generate shape on first access", () => {
            const shape = node.shape;
            expect(shape.isOk).toBe(true);
            expect(shape.value).toBeInstanceOf(MockShape);
        });

        test("should cache generated shape", () => {
            const shape1 = node.shape;
            const shape2 = node.shape;
            expect(shape1).toBe(shape2);
        });

        test("should set shape when property changes", () => {
            // Should not throw when setting property
            expect(() => {
                (node as any).setPropertyEmitShapeChanged("testProp", "newValue");
            }).not.toThrow();
        });

        test("should initialize with translated name", () => {
            expect((node as any).name).toBeDefined();
        });
    });

    describe("EditableShapeNode", () => {
        let node: any;

        beforeEach(() => {
            node = new ShapeNodeClasses.EditableShapeNode(doc, "editable", mockShape);
        });

        test("should initialize with shape", () => {
            expect(node.shape.isOk).toBe(true);
            expect(node.shape.value).toBe(mockShape);
        });

        test("should initialize with shape result", () => {
            const shapeResult = Result.ok(mockShape);
            const node2 = new ShapeNodeClasses.EditableShapeNode(doc, "editable", shapeResult);
            expect(node2.shape).toBe(shapeResult);
        });

        test("should set shape property", () => {
            const newShape = new MockShape();
            const newShapeResult = Result.ok(newShape);

            node.shape = newShapeResult;

            expect(node.shape.value).toBe(newShape);
        });

        test("should return correct display key", () => {
            expect(node.display()).toBe("body.editableShape");
        });
    });
});
