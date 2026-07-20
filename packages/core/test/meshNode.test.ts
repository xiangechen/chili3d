// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Mesh } from "../src";
import { Matrix4 } from "../src";
import { MeshNode } from "../src/model/meshNode";
import { TestDocument } from "./mocks";

function createMockMesh(overrides?: Partial<Mesh>): Mesh {
    return {
        meshType: "surface",
        position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
        normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        index: new Uint32Array([0, 1, 2, 0, 2, 3]),
        color: 0xffffff,
        groups: [],
        uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        ...overrides,
    } as Mesh;
}

describe("MeshNode", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument();
    });

    describe("constructor", () => {
        test("should initialize with mesh and name", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(node.name).toBe("test-mesh");
            expect(node.mesh).toBe(mesh);
        });

        test("should generate id when not provided", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(node.id).toBeDefined();
            expect(typeof node.id).toBe("string");
        });

        test("should use provided id", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh", id: "custom-id" });

            expect(node.id).toBe("custom-id");
        });

        test("should use provided materialId string", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh", materialId: "mat1" });

            expect(node.materialId).toBe("mat1");
        });

        test("should use provided materialId array", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({
                document: doc,
                mesh,
                name: "test-mesh",
                materialId: ["mat1", "mat2"],
            });

            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });

        test("should default materialId to empty string when no materials in model", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(node.materialId).toBe("");
        });
    });

    describe("materialId property", () => {
        test("should set and get string materialId", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            node.materialId = "newMat";
            expect(node.materialId).toBe("newMat");
        });

        test("should set and get array materialId", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            node.materialId = ["mat1", "mat2"];
            expect(node.materialId).toEqual(["mat1", "mat2"]);
        });
    });

    describe("mesh property", () => {
        test("should get mesh", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(node.mesh).toBe(mesh);
        });

        test("should set mesh", () => {
            const mesh1 = createMockMesh();
            const mesh2 = createMockMesh({ position: new Float32Array([0, 0, 0]) });
            const node = new MeshNode({ document: doc, mesh: mesh1, name: "test-mesh" });

            node.mesh = mesh2;
            expect(node.mesh).toBe(mesh2);
        });
    });

    describe("display", () => {
        test("should return correct i18n key", () => {
            const mesh = createMockMesh();
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(node.display()).toBe("body.meshNode");
        });
    });

    describe("boundingBox", () => {
        test("should compute bounding box from mesh positions", () => {
            const mesh = createMockMesh({
                position: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0]),
            });
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            const box = node.boundingBox();
            expect(box).toBeDefined();
        });

        test("should apply transform to bounding box", () => {
            const mesh = createMockMesh({
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
            });
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });
            node.transform = Matrix4.fromTranslation(5, 0, 0);

            const box = node.boundingBox();
            expect(box).toBeDefined();
            expect(box!.min.x).toBe(5);
            expect(box!.max.x).toBe(6);
        });

        test("should throw when mesh has no position", () => {
            const mesh = createMockMesh({ position: undefined });
            const node = new MeshNode({ document: doc, mesh, name: "test-mesh" });

            expect(() => node.boundingBox()).toThrow();
        });
    });
});
