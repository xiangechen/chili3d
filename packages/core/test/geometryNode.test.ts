// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../src/document";
import { Id } from "../src/foundation";
import type { I18nKeys } from "../src/i18n";
import { FaceMaterialPair, GeometryNode } from "../src/model/geometryNode";
import type { IShapeMeshData } from "../src/shape";
import { TestDocument } from "./testDocument";

// Test subclass to implement the abstract createMesh method
class TestGeometryNode extends GeometryNode {
    display(): I18nKeys {
        return "common.name";
    }

    protected createMesh(): IShapeMeshData {
        // Return a simple mock mesh for testing
        return {
            faces: {
                position: [0, 0, 0, 1, 0, 0, 0, 1, 0],
                range: [0, 3],
                groups: [],
            },
            edges: undefined,
        } as any;
    }
}

describe("GeometryNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = new TestDocument() as any;
    });

    describe("FaceMaterialPair", () => {
        test("should create FaceMaterialPair with correct values", () => {
            const pair = new FaceMaterialPair(1, 2);
            expect(pair.faceIndex).toBe(1);
            expect(pair.materialIndex).toBe(2);
        });
    });

    describe("constructor", () => {
        test("should initialize with default materialId", () => {
            const node = new TestGeometryNode(doc, "test");
            expect(node.materialId).toBe("");
        });

        test("should initialize with provided materialId", () => {
            const node = new TestGeometryNode(doc, "test", "mat1");
            expect(node.materialId).toBe("mat1");
        });

        test("should initialize with array materialId", () => {
            const node = new TestGeometryNode(doc, "test", ["mat1", "mat2"]);
            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });

        test("should initialize with custom id", () => {
            const customId = Id.generate();
            const node = new TestGeometryNode(doc, "test", undefined, customId);
            expect(node.id).toBe(customId);
        });
    });

    describe("materialId property", () => {
        test("should get and set string materialId", () => {
            const node = new TestGeometryNode(doc, "test");
            node.materialId = "newMat";
            expect(node.materialId).toBe("newMat");
        });

        test("should get and set array materialId", () => {
            const node = new TestGeometryNode(doc, "test");
            node.materialId = ["mat1", "mat2"];
            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });
    });

    describe("faceMaterialPair property", () => {
        test("should default to empty array", () => {
            const node = new TestGeometryNode(doc, "test");
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should set and get faceMaterialPair", () => {
            const node = new TestGeometryNode(doc, "test");
            const pairs = [new FaceMaterialPair(0, 0), new FaceMaterialPair(1, 1)];
            node.faceMaterialPair = pairs;
            expect(node.faceMaterialPair).toEqual(pairs);
        });
    });

    describe("mesh property", () => {
        test("should return created mesh", () => {
            const node = new TestGeometryNode(doc, "test");
            const mesh = node.mesh;
            expect(mesh).toBeDefined();
            expect(mesh.faces?.position).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        });

        test("should cache mesh", () => {
            const node = new TestGeometryNode(doc, "test");
            const mesh1 = node.mesh;
            const mesh2 = node.mesh;
            expect(mesh1).toBe(mesh2);
        });
    });

    describe("boundingBox", () => {
        test("should return bounding box from faces", () => {
            const node = new TestGeometryNode(doc, "test");
            const bbox = node.boundingBox();
            expect(bbox).toBeDefined();
        });

        test("should return undefined if no positions", () => {
            const node = new TestGeometryNode(doc, "test");
            // Mock mesh with no positions
            (node as any)._mesh = { faces: { position: [] }, edges: { position: [] } };
            const bbox = node.boundingBox();
            expect(bbox).toBeUndefined();
        });
    });

    describe("disposeInternal", () => {
        test("should clear mesh cache", () => {
            const node = new TestGeometryNode(doc, "test");
            node.mesh; // Access to create mesh
            expect((node as any)._mesh).toBeDefined();
            node.disposeInternal();
            expect((node as any)._mesh).toBeUndefined();
        });
    });

    describe("addFaceMaterial", () => {
        test("should add single face material", () => {
            const node = new TestGeometryNode(doc, "test", "mat1");
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            expect(node.materialId).toEqual(["mat1", "mat2"]);
            expect(node.faceMaterialPair).toHaveLength(1);
            expect(node.faceMaterialPair[0].faceIndex).toBe(0);
            expect(node.faceMaterialPair[0].materialIndex).toBe(1);
        });

        test("should not add if material is same as current single", () => {
            const node = new TestGeometryNode(doc, "test", "mat1");
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat1" }]);
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should handle single face mesh", () => {
            const node = new TestGeometryNode(doc, "test", "mat1");
            // Mock single face mesh
            (node as any)._mesh = { faces: { range: [0] } };
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            expect(node.materialId).toBe("mat2");
        });
    });

    describe("removeFaceMaterial", () => {
        test("should remove face materials", () => {
            const node = new TestGeometryNode(doc, "test", ["mat1", "mat2"]);
            node.faceMaterialPair = [new FaceMaterialPair(0, 0), new FaceMaterialPair(1, 1)];
            node.removeFaceMaterial([0]);
            expect(node.faceMaterialPair).toHaveLength(1);
            expect(node.faceMaterialPair[0].faceIndex).toBe(1);
        });

        test("should remove material from array if no longer used", () => {
            const node = new TestGeometryNode(doc, "test", ["mat1", "mat2", "mat3"]);
            node.faceMaterialPair = [new FaceMaterialPair(1, 1), new FaceMaterialPair(2, 2)];
            node.removeFaceMaterial([1]);
            expect(node.materialId).toEqual(["mat1", "mat3"]);
            expect(node.faceMaterialPair[0].materialIndex).toBe(1); // Adjusted index
        });

        test("should convert to single material if only one left", () => {
            const node = new TestGeometryNode(doc, "test", ["mat1", "mat2"]);
            node.faceMaterialPair = [new FaceMaterialPair(1, 1)];
            node.removeFaceMaterial([1]);
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });
    });

    describe("clearFaceMaterial", () => {
        test("should clear all face materials and reset to first material", () => {
            const node = new TestGeometryNode(doc, "test", ["mat1", "mat2"]);
            node.faceMaterialPair = [new FaceMaterialPair(0, 0), new FaceMaterialPair(1, 1)];
            node.clearFaceMaterial();
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should do nothing if already single material", () => {
            const node = new TestGeometryNode(doc, "test", "mat1");
            node.clearFaceMaterial();
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });
    });
});
