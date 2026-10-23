// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EdgeMeshData,
    FaceMaterialPair,
    type IShape,
    type IShapeMeshData,
    Matrix4,
    Result,
} from "../src";
import * as ShapeNodeClasses from "../src/model/shapeNode";
import { MockShape, TestDocument } from "../test-utils";

/** A MockShape that records its own release — the wasm handle behind it is invisible to the GC. */
function trackedShape() {
    return new (class extends MockShape {
        disposed = false;
        override dispose(): void {
            this.disposed = true;
        }
    })();
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
            node = new node({ document: doc, name: "test", materialId: "mat1" });
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
                expect(mesh).not.toBeNull();
            });
        });

        describe("disposeInternal", () => {
            test("should release the shape and mark the node released", () => {
                const shape = trackedShape();
                (node as any).setShape(Result.ok(shape));

                (node as any).disposeInternal();

                expect(shape.disposed).toBe(true);
                expect(node.shape).toBeNull();
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
            expect(multiShapeMesh.edges).not.toBeNull();
        });

        test("should return faces when position length > 0", () => {
            // Add a shape to populate faces
            multiShapeMesh.addShape(mockShape, Matrix4.identity());
            expect(multiShapeMesh.faces).not.toBeNull();
        });

        test("should merge the pickable points of every shape", () => {
            multiShapeMesh.addShape(mockShape, Matrix4.identity());
            expect(multiShapeMesh.vertexs.position.length).toBe(9);
            expect(multiShapeMesh.vertexs.range).toHaveLength(1);

            multiShapeMesh.addShape(mockShape, Matrix4.identity());

            const merged = multiShapeMesh.vertexs;
            expect(merged.position.length).toBe(18);
            expect(merged.range.map((g: { start: number }) => g.start)).toEqual([0, 3]);
            expect(merged.size).toBe(3);
        });
    });

    describe("MultiShapeNode", () => {
        let shapes: MockShape[];

        beforeEach(() => {
            shapes = [new MockShape(), new MockShape()];
        });

        test("should initialize with shapes", () => {
            const node = new ShapeNodeClasses.MultiShapeNode({
                document: doc,
                name: "multi",
                shapes: shapes,
            });
            expect(node.shapes).toEqual(shapes);
        });

        test("should create mesh from multiple shapes", () => {
            const node = new ShapeNodeClasses.MultiShapeNode({
                document: doc,
                name: "multi",
                shapes: shapes,
            });
            const mesh = (node as any).createMesh();

            expect(mesh).not.toBeNull();
        });

        test("should return correct display key", () => {
            const node = new ShapeNodeClasses.MultiShapeNode({
                document: doc,
                name: "multi",
                shapes: shapes,
            });
            expect(node.display()).toBe("body.multiShape");
        });
    });

    describe("ParameterShapeNode", () => {
        class TestParameterShapeNode extends ShapeNodeClasses.ParameterShapeNode {
            protected generateShape(): Result<IShape> {
                return Result.ok(new MockShape());
            }

            display(): any {
                return "test.parameterShape";
            }
        }

        let node: TestParameterShapeNode;

        beforeEach(() => {
            node = new TestParameterShapeNode({ document: doc });
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

        test("should retry generation after a failure", () => {
            let calls = 0;
            const FailingNode = class extends ShapeNodeClasses.ParameterShapeNode {
                protected generateShape(): Result<IShape> {
                    calls++;
                    return calls === 1 ? Result.err("transient") : Result.ok(new MockShape());
                }

                display(): any {
                    return "test.parameterShape";
                }
            };
            const failing: any = new FailingNode({ document: doc });

            expect(failing.shape.isOk).toBe(false);
            expect(failing.shape.isOk).toBe(true);
            expect(calls).toBe(2);
        });

        test("should set shape when property changes", () => {
            // Should not throw when setting property
            expect(() => {
                (node as any).setPropertyEmitShapeChanged("testProp", "newValue");
            }).not.toThrow();
        });

        test("should not regenerate the shape once disposed", () => {
            let calls = 0;
            const CountingNode = class extends ShapeNodeClasses.ParameterShapeNode {
                protected generateShape(): Result<IShape> {
                    calls++;
                    return Result.ok(new MockShape());
                }

                display(): any {
                    return "test.parameterShape";
                }
            };
            const counting = new CountingNode({ document: doc });
            expect(counting.shape.isOk).toBe(true);
            expect(calls).toBe(1);

            counting.dispose();

            // The read still goes through the lazy getter; it must report the released
            // state rather than generate a shape the disposed node can never release.
            expect(counting.shape).toBeNull();
            expect(calls).toBe(1);
        });

        // The document disposes the model first and the history second, and a history
        // record reads its object's property to tell which of its two shapes it owns.
        test("should survive a document teardown that disposes the node before the history", () => {
            const node = new TestParameterShapeNode({ document: doc });
            doc.modelManager.addNode(node);
            const stale = trackedShape();
            const live = trackedShape();
            (node as any).setShape(Result.ok(stale));
            (node as any).setShape(Result.ok(live));
            expect(doc.history.undoCount()).toBeGreaterThan(0);

            node.dispose();
            expect(live.disposed).toBe(true);

            doc.history.dispose();

            expect(stale.disposed).toBe(true);
        });

        test("should name the node after its display name and the next free index", () => {
            expect(node.name).toBe("test.parameterShape1");

            doc.modelManager.addNode(node);
            const second = new TestParameterShapeNode({ document: doc });
            expect(second.name).toBe("test.parameterShape2");
        });
    });

    describe("EditableShapeNode", () => {
        let node: any;

        beforeEach(() => {
            node = new ShapeNodeClasses.EditableShapeNode({
                document: doc,
                name: "editable",
                shape: mockShape,
            });
        });

        test("should initialize with shape", () => {
            expect(node.shape.isOk).toBe(true);
            expect(node.shape.value).toBe(mockShape);
        });

        test("should initialize with shape result", () => {
            const shapeResult = Result.ok(mockShape);
            const node2 = new ShapeNodeClasses.EditableShapeNode({
                document: doc,
                name: "editable",
                shape: shapeResult,
            });
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

    describe("face material merge", () => {
        /** Two faces, the first painted — the merge regroups ranges by material. */
        function twoFaceNode() {
            const shape = new MockShape();
            shape.mesh.faces = {
                position: new Float32Array(18),
                normal: new Float32Array(18),
                index: new Uint32Array([0, 1, 2, 3, 4, 5]),
                uv: new Float32Array(12),
                range: [
                    { start: 0, count: 3, shape: { id: "f0" } as any },
                    { start: 3, count: 3, shape: { id: "f1" } as any },
                ],
                groups: [],
                color: 0xdedede,
            };
            const node = new ShapeNodeClasses.EditableShapeNode({ document: doc, name: "painted", shape });
            node.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 1 })];
            return node;
        }

        const rangeIds = (node: any) => node.mesh.faces.range.map((x: any) => x.shape.id);

        test("a second createMesh on the same shape merges from the raw faces, not the merged ones", () => {
            const node = twoFaceNode();

            // paint face 0 → the merged ranges regroup by material: [f1(mat0), f0(mat1)]
            expect(rangeIds(node)).toEqual(["f1", "f0"]);
            const origin = node.unmergedFaceMesh!;
            expect(origin.range.map((x: any) => x.shape.id)).toEqual(["f0", "f1"]);

            node.refreshMesh();

            // a rebuild must reproduce the first merge exactly — merging the already-merged
            // faces again would flip the ranges back and paint f1 instead of f0
            expect(node.unmergedFaceMesh).toBe(origin);
            expect(rangeIds(node)).toEqual(["f1", "f0"]);
            expect(node.mesh.faces!.groups).toEqual([
                { start: 0, count: 3, materialIndex: 0 },
                { start: 3, count: 3, materialIndex: 1 },
            ]);
        });

        test("a shape change resets the raw faces", () => {
            const node = twoFaceNode();
            node.mesh;
            const origin = node.unmergedFaceMesh;

            node.shape = Result.ok(new MockShape());

            expect(node.unmergedFaceMesh).toBeUndefined();
            expect(node.unmergedFaceMesh).not.toBe(origin);
        });

        test("setExtraDisplayEdges(undefined) on a node without extras does not rebuild the mesh", () => {
            class CountingNode extends ShapeNodeClasses.EditableShapeNode {
                createMeshCalls = 0;
                protected override createMesh(): IShapeMeshData {
                    this.createMeshCalls++;
                    return super.createMesh();
                }
            }
            const node = new CountingNode({ document: doc, name: "x", shape: new MockShape() });
            node.mesh;
            expect(node.createMeshCalls).toBe(1);

            node.setExtraDisplayEdges(undefined);
            expect(node.createMeshCalls).toBe(1);

            const extra: EdgeMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [],
                lineType: "solid",
            };
            node.setExtraDisplayEdges([extra]);
            node.mesh;
            expect(node.createMeshCalls).toBe(2);
        });
    });

    describe("MultiShapeMesh", () => {
        /** A shape whose point mesh reports when it is asked for. */
        function countingShape(reads: { count: number }): IShape {
            return {
                matrix: Matrix4.identity(),
                mesh: {
                    edges: undefined,
                    faces: undefined,
                    get vertexs() {
                        reads.count++;
                        return {
                            position: new Float32Array([0, 0, 0]),
                            range: [],
                            size: 3,
                            color: 0,
                        };
                    },
                },
            } as unknown as IShape;
        }

        test("addShape does not build the point mesh until the points are read", () => {
            const reads = { count: 0 };
            const mesh = new ShapeNodeClasses.MultiShapeMesh();

            mesh.addShape(countingShape(reads), Matrix4.identity());

            // Reading `mesh.vertexs` on the shape would build every vertex wrapper.
            expect(reads.count).toBe(0);
            expect(mesh.vertexs?.position.length).toBe(3);
            expect(reads.count).toBe(1);
            // Cached once built.
            expect(mesh.vertexs?.position.length).toBe(3);
            expect(reads.count).toBe(1);
        });

        test("a shape added after the points were built is merged immediately", () => {
            const reads = { count: 0 };
            const mesh = new ShapeNodeClasses.MultiShapeMesh();
            mesh.addShape(countingShape(reads), Matrix4.identity());
            expect(mesh.vertexs?.position.length).toBe(3);

            mesh.addShape(countingShape(reads), Matrix4.identity());

            expect(mesh.vertexs?.position.length).toBe(6);
            expect(reads.count).toBe(2);
        });
    });
});
