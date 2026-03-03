// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, FolderNode, ShapeNodeFilter } from "../src";
import { Result } from "../src/foundation";
import type { IShape } from "../src/shape";
import { TestDocument } from "./testDocument";

describe("ShapeNodeFilter", () => {
    let doc: any;
    let shapeNode: EditableShapeNode;
    let nonShapeNode: FolderNode;
    let mockShape: IShape;

    beforeEach(() => {
        doc = new TestDocument() as any;

        // Mock shape object
        mockShape = {
            id: "test-shape",
            isNull: () => false,
            dispose: () => {},
            isEqual: (other: IShape) => other === mockShape,
            mesh: { edges: undefined, faces: undefined },
            matrix: { multiply: (m: any) => m },
            transformed: (m: any) => mockShape,
            transformedMul: (m: any) => mockShape,
            edgesMeshPosition: () => ({
                lineType: "solid",
                position: new Float32Array(),
                range: [],
                color: new Float32Array(),
            }),
            isClosed: () => true,
            shapeType: "test" as any,
        } as unknown as IShape;

        // Create real ShapeNode
        shapeNode = new EditableShapeNode(doc, "test-shape-node", Result.ok(mockShape));

        // Create real non-ShapeNode
        nonShapeNode = new FolderNode(doc, "test-folder");
    });

    test("should allow ShapeNode without shape filter", () => {
        const filter = new ShapeNodeFilter();
        expect(filter.allow(shapeNode)).toBe(true);
    });

    test("should reject non-ShapeNode", () => {
        const filter = new ShapeNodeFilter();
        expect(filter.allow(nonShapeNode)).toBe(false);
    });

    test("should allow ShapeNode when shape filter returns true", () => {
        let calledShape: any;
        const mockShapeFilter = {
            allow: (shape: any) => {
                calledShape = shape;
                return true;
            },
        };
        const filter = new ShapeNodeFilter(mockShapeFilter);

        expect(filter.allow(shapeNode)).toBe(true);
        expect(calledShape).toBe(mockShape);
    });

    test("should reject ShapeNode when shape filter returns false", () => {
        let calledShape: any;
        const mockShapeFilter = {
            allow: (shape: any) => {
                calledShape = shape;
                return false;
            },
        };
        const filter = new ShapeNodeFilter(mockShapeFilter);

        expect(filter.allow(shapeNode)).toBe(false);
        expect(calledShape).toBe(mockShape);
    });

    test("should allow ShapeNode when shape is not ok", () => {
        const shapeNodeWithBadShape = new EditableShapeNode(doc, "bad-shape-node", Result.err("Shape error"));

        const filter = new ShapeNodeFilter();
        expect(filter.allow(shapeNodeWithBadShape)).toBe(true);
    });

    test("should not call shape filter when shape is not ok", () => {
        let filterCalled = false;
        const mockShapeFilter = {
            allow: () => {
                filterCalled = true;
                return true;
            },
        };
        const shapeNodeWithBadShape = new EditableShapeNode(doc, "bad-shape-node", Result.err("Shape error"));

        const filter = new ShapeNodeFilter(mockShapeFilter);
        filter.allow(shapeNodeWithBadShape);

        expect(filterCalled).toBe(false);
    });

    test("should not call shape filter when no shape filter provided", () => {
        const filter = new ShapeNodeFilter();
        filter.allow(shapeNode);

        // Should not throw any errors
        expect(filter.allow(shapeNode)).toBe(true);
    });
});
