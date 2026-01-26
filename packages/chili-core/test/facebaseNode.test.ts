// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, IShape, IShapeMeshData, Serialized, XYZLike } from "../src";
import { Matrix4, Orientation, type Plane, PropertyUtils, Result, ShapeType } from "../src";
import { FacebaseNode } from "../src/model/facebaseNode";
import { TestDocument } from "./testDocument";

// Mock shape implementation for testing
class MockShape implements IShape {
    readonly shapeType: ShapeType = ShapeType.Compound;
    private _id: string = "mock-shape-id";

    get id(): string {
        return this._id;
    }

    matrix: Matrix4 = Matrix4.identity();
    mesh: IShapeMeshData = { faces: undefined, edges: undefined, vertexs: undefined };

    transformed(matrix: Matrix4): IShape {
        return this;
    }

    transformedMul(matrix: Matrix4): IShape {
        return this;
    }

    edgesMeshPosition(): EdgeMeshData {
        return {
            lineType: "solid",
            position: new Float32Array(),
            range: [],
            color: [0, 0, 0, 1],
        };
    }

    isClosed(): boolean {
        return false;
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

    orientation(): Orientation {
        return Orientation.FORWARD;
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        return [];
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        return [];
    }

    iterShape(): IShape[] {
        return [this];
    }

    section(shape: IShape | Plane): IShape {
        return this;
    }

    split(shapes: IShape[]): IShape {
        return this;
    }

    reserve(): void {}

    clone(): IShape {
        return new MockShape();
    }

    hlr(position: XYZLike, direction: XYZLike, xDir: XYZLike): IShape {
        return this;
    }

    dispose(): void {}
}

// Concrete implementation of FacebaseNode for testing
class TestFacebaseNode extends FacebaseNode {
    protected generateShape(): Result<IShape> {
        return Result.ok(new MockShape());
    }

    override display() {
        return "test.facebase" as any;
    }
}

describe("FacebaseNode", () => {
    let doc: TestDocument;
    let node: TestFacebaseNode;

    beforeEach(() => {
        doc = new TestDocument();
        node = new TestFacebaseNode(doc);
    });

    afterEach(() => {
        node.dispose();
    });

    describe("isFace property", () => {
        test("should have default value false", () => {
            expect(node.isFace).toBe(false);
        });

        test("should set isFace to true", () => {
            node.isFace = true;
            expect(node.isFace).toBe(true);
        });

        test("should set isFace to false", () => {
            node.isFace = true;
            node.isFace = false;
            expect(node.isFace).toBe(false);
        });

        test("should handle boolean assignment correctly", () => {
            node.isFace = true;
            expect(node.isFace).toBe(true);

            node.isFace = false;
            expect(node.isFace).toBe(false);
        });
    });

    describe("serialization", () => {
        test("should serialize isFace property", () => {
            node.isFace = true;

            const serialized: Serialized = {
                classKey: "TestFacebaseNode",
                properties: {
                    isFace: node.isFace,
                    id: node.id,
                    name: node.name,
                    materialId: undefined,
                },
            };

            expect(serialized.properties["isFace"]).toBe(true);
        });

        test("should handle missing isFace in deserialization", () => {
            expect(node.isFace).toBe(false);
        });
    });

    describe("property decorator", () => {
        test("should have isFace property registered with correct display name", () => {
            const properties = PropertyUtils.getOwnProperties(FacebaseNode.prototype);
            const isFaceProp = properties.find((p) => p.name === "isFace");

            expect(isFaceProp).toBeDefined();
            expect(isFaceProp?.display).toBe("option.command.isFace");
        });
    });

    describe("inheritance", () => {
        test("should extend ParameterShapeNode", () => {
            expect(node).toBeInstanceOf(FacebaseNode);
            expect(node.constructor.name).toBe("TestFacebaseNode");
        });

        test("should have shape generation capability", () => {
            const shape = node.shape;
            expect(shape.isOk).toBe(true);
            expect(shape.value).toBeInstanceOf(MockShape);
        });
    });

    describe("property change notifications", () => {
        test("should emit property changed when isFace is modified", () => {
            let propertyChanged = false;
            node.onPropertyChanged(() => {
                propertyChanged = true;
            });

            node.isFace = true;

            expect(propertyChanged).toBe(true);
        });
    });

    describe("edge cases", () => {
        test("should handle multiple isFace assignments", () => {
            node.isFace = true;
            node.isFace = false;
            node.isFace = true;
            node.isFace = false;

            expect(node.isFace).toBe(false);
        });

        test("should maintain isFace value after shape regeneration", () => {
            node.isFace = true;

            // Force shape regeneration by accessing shape
            const shape = node.shape;
            expect(shape.isOk).toBe(true);

            expect(node.isFace).toBe(true);
        });

        test("should handle isFace property with different truthy/falsy values", () => {
            // Test basic boolean values
            expect(node.isFace).toBe(false); // default

            node.isFace = true;
            expect(node.isFace).toBe(true);

            node.isFace = false;
            expect(node.isFace).toBe(false);

            // Test numeric values (stored as-is but with type assertion)
            node.isFace = 0 as any;
            expect(node.isFace).toBe(0);

            node.isFace = 1 as any;
            expect(node.isFace).toBe(1);

            // Test string values (stored as-is but with type assertion)
            node.isFace = "true" as any;
            expect(node.isFace).toBe("true");

            node.isFace = "false" as any;
            expect(node.isFace).toBe("false");

            // Test empty string (stored as-is but with type assertion)
            node.isFace = "" as any;
            expect(node.isFace).toBe("");

            // Test object (stored as-is but with type assertion)
            node.isFace = {} as any;
            expect(typeof node.isFace).toBe("object");
        });
    });
});
