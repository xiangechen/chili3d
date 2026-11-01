// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import type { IDocument } from "../src/document";
import { Id, Transaction } from "../src/foundation";
import type { I18nKeys } from "../src/i18n";
import { FaceMaterialPair, GeometryNode } from "../src/model/geometryNode";
import type { INode } from "../src/model/node";
import type { IShapeMeshData } from "../src/shape";
import { TestDocument } from "../test-utils";

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
            const pair = new FaceMaterialPair({ faceIndex: 1, materialIndex: 2 });
            expect(pair.faceIndex).toBe(1);
            expect(pair.materialIndex).toBe(2);
        });
    });

    describe("constructor", () => {
        test("should initialize with default materialId", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            expect(node.materialId).toBe("");
        });

        test("should initialize with provided materialId", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            expect(node.materialId).toBe("mat1");
        });

        test("should initialize with array materialId", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: ["mat1", "mat2"] });
            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });

        test("should initialize with custom id", () => {
            const customId = Id.generate();
            const node = new TestGeometryNode({ document: doc, name: "test", id: customId });
            expect(node.id).toBe(customId);
        });
    });

    describe("materialId property", () => {
        test("should get and set string materialId", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            node.materialId = "newMat";
            expect(node.materialId).toBe("newMat");
        });

        test("should get and set array materialId", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            node.materialId = ["mat1", "mat2"];
            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });
    });

    describe("faceMaterialPair property", () => {
        test("should default to empty array", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should set and get faceMaterialPair", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            const pairs = [
                new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 }),
                new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 }),
            ];
            node.faceMaterialPair = pairs;
            expect(node.faceMaterialPair).toEqual(pairs);
        });
    });

    describe("mesh property", () => {
        test("should return created mesh", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            const mesh = node.mesh;
            expect(mesh).not.toBeNull();
            expect(mesh.faces?.position).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        });

        test("should cache mesh", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            const mesh1 = node.mesh;
            const mesh2 = node.mesh;
            expect(mesh1).toBe(mesh2);
        });
    });

    describe("boundingBox", () => {
        test("should return bounding box from faces", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            const bbox = node.boundingBox();
            expect(bbox).not.toBeNull();
        });

        test("should return undefined if no positions", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            // Mock mesh with no positions
            (node as any)._mesh = { faces: { position: [] }, edges: { position: [] } };
            const bbox = node.boundingBox();
            expect(bbox).toBeUndefined();
        });
    });

    describe("disposeInternal", () => {
        test("should clear mesh cache", () => {
            const node = new TestGeometryNode({ document: doc, name: "test" });
            node.mesh; // Access to create mesh
            expect((node as any)._mesh).not.toBeNull();
            node.disposeInternal();
            expect((node as any)._mesh).toBeUndefined();
        });
    });

    describe("addFaceMaterial", () => {
        test("should add single face material", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            expect(node.materialId).toEqual(["mat1", "mat2"]);
            expect(node.faceMaterialPair).toHaveLength(1);
            expect(node.faceMaterialPair[0].faceIndex).toBe(0);
            expect(node.faceMaterialPair[0].materialIndex).toBe(1);
        });

        test("should not add if material is same as current single", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat1" }]);
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should handle single face mesh", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            // Mock single face mesh
            (node as any)._mesh = { faces: { range: [0] } };
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            expect(node.materialId).toBe("mat2");
        });
    });

    describe("removeFaceMaterial", () => {
        test("should remove face materials", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: ["mat1", "mat2"] });
            node.faceMaterialPair = [
                new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 }),
                new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 }),
            ];
            node.removeFaceMaterial([0]);
            expect(node.faceMaterialPair).toHaveLength(1);
            expect(node.faceMaterialPair[0].faceIndex).toBe(1);
        });

        test("should remove material from array if no longer used", () => {
            const node = new TestGeometryNode({
                document: doc,
                name: "test",
                materialId: ["mat1", "mat2", "mat3"],
            });
            node.faceMaterialPair = [
                new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 }),
                new FaceMaterialPair({ faceIndex: 2, materialIndex: 2 }),
            ];
            node.removeFaceMaterial([1]);
            expect(node.materialId).toEqual(["mat1", "mat3"]);
            expect(node.faceMaterialPair[0].materialIndex).toBe(1); // Adjusted index
        });

        test("should convert to single material if only one left", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: ["mat1", "mat2"] });
            node.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 })];
            node.removeFaceMaterial([1]);
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });
    });

    describe("repainting a node", () => {
        /** A mesh whose `range` lists `count` faces of one triangle each. */
        function faceMesh(count: number) {
            const position: number[] = [];
            const normal: number[] = [];
            const uv: number[] = [];
            const index: number[] = [];
            const range: { start: number; count: number; shape: undefined }[] = [];
            for (let face = 0; face < count; face++) {
                const base = face * 3;
                position.push(base, 0, 0, base + 1, 0, 0, base, 1, 0);
                normal.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
                uv.push(0, 0, 1, 0, 0, 1);
                range.push({ start: index.length, count: 3, shape: undefined });
                index.push(base, base + 1, base + 2);
            }
            return {
                position: new Float32Array(position),
                normal: new Float32Array(normal),
                uv: new Float32Array(uv),
                index: new Uint32Array(index),
                range,
                groups: [],
            };
        }

        function preparedNode(count = 1): { node: TestGeometryNode; redraw: ReturnType<typeof rs.fn> } {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            // `updateVisual` merges the raw faces `createMesh` captured; building them through
            // the real kernel is not what these tests are about.
            const mesh = faceMesh(count);
            (node as any)._originFaceMesh = mesh;
            (node as any)._mesh = { faces: mesh };
            const context = (doc as any).visual.context;
            const redraw = rs.fn((_nodes: INode[]) => {});
            context.redrawNode = redraw;
            return { node, redraw };
        }

        test("rebuilds the display of a node that has a visual", () => {
            const { node, redraw } = preparedNode();
            (doc as any).visual.context.getVisual = () => ({});

            node.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })];

            expect(redraw).toHaveBeenCalledTimes(1);
            expect(redraw.mock.calls[0][0]).toEqual([node]);
        });

        test("merges the paint into the cached mesh but adds no visual to a removed node", () => {
            const { node, redraw } = preparedNode();
            // What the history leaves behind after its removal record: no visual any more.
            (doc as any).visual.context.getVisual = () => undefined;

            node.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })];

            // The merged mesh is what a re-insert (redo) displays, so it must still happen.
            expect(node.mesh.faces?.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
            expect(node.materialId).toBe("mat1");
            expect(redraw).not.toHaveBeenCalled();
        });

        test("does not write into a mesh a refresh dropped", () => {
            const { node } = preparedNode();
            (doc as any).visual.context.getVisual = () => undefined;
            node.refreshMesh();
            expect((node as any)._mesh).toBeUndefined();

            // Nothing to merge into — the next `createMesh` merges from the raw faces instead.
            node.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })];

            expect(node.faceMaterialPair).toHaveLength(1);
        });

        test("keeps a material id that removeFaceMaterial already collapsed to a string", () => {
            const { node } = preparedNode(2);
            (doc as any).visual.context.getVisual = () => undefined;

            node.addFaceMaterial([{ faceIndex: 1, materialId: "mat2" }]);
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat1" }]);
            // The last paint goes: one material left, so the palette collapses to a string.
            node.removeFaceMaterial([1]);

            expect(node.faceMaterialPair).toEqual([new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })]);
            expect(node.materialId).toBe("mat1");
        });

        test("re-points the surviving pairs at the last material when the palette collapses", () => {
            const { node } = preparedNode(2);
            (doc as any).visual.context.getVisual = () => undefined;
            node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            node.addFaceMaterial([{ faceIndex: 1, materialId: "mat1" }]);
            expect(node.materialId).toEqual(["mat1", "mat2"]);
            expect(node.faceMaterialPair).toEqual([
                new FaceMaterialPair({ faceIndex: 0, materialIndex: 1 }),
                new FaceMaterialPair({ faceIndex: 1, materialIndex: 0 }),
            ]);

            // mat1 (index 0) goes, so the survivor must not stay on index 1 — that points past
            // a palette which now holds a single entry.
            node.removeFaceMaterial([1]);

            expect(node.materialId).toBe("mat2");
            expect(node.faceMaterialPair).toEqual([new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 })]);
        });

        test("records the paint, so it stays undoable, when there is no mesh to merge into", () => {
            const { node } = preparedNode();
            (doc as any).visual.context.getVisual = () => undefined;
            node.refreshMesh();
            expect((node as any)._mesh).toBeUndefined();

            Transaction.execute(doc, "paint", () => {
                node.addFaceMaterial([{ faceIndex: 0, materialId: "mat2" }]);
            });
            expect(node.materialId).toEqual(["mat1", "mat2"]);

            doc.history.undo();

            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });
    });

    describe("clearFaceMaterial", () => {
        test("should clear all face materials and reset to first material", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: ["mat1", "mat2"] });
            node.faceMaterialPair = [
                new FaceMaterialPair({ faceIndex: 0, materialIndex: 0 }),
                new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 }),
            ];
            node.clearFaceMaterial();
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });

        test("should do nothing if already single material", () => {
            const node = new TestGeometryNode({ document: doc, name: "test", materialId: "mat1" });
            node.clearFaceMaterial();
            expect(node.materialId).toBe("mat1");
            expect(node.faceMaterialPair).toEqual([]);
        });
    });
});
