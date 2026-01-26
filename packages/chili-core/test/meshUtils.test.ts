// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, XYZ } from "../src/math";
import { type EdgeMeshData, type FaceMeshData, Mesh } from "../src/shape";
import { MeshUtils } from "../src/visual/meshUtils";

describe("MeshUtils", () => {
    describe("setFaceMeshData", () => {
        test("should return early if other is undefined", () => {
            const data: FaceMeshData = {
                position: new Float32Array(9),
                normal: new Float32Array(9),
                uv: new Float32Array(6),
                index: new Uint32Array(3),
                range: [],
                color: 0xfff,
                groups: [],
            };
            const matrix = Matrix4.identity();
            const offset = { facePosition: 0, faceIndex: 0 };

            expect(() => MeshUtils.setFaceMeshData(data, undefined, matrix, offset)).not.toThrow();
        });

        test("should set face mesh data correctly", () => {
            const data: FaceMeshData = {
                position: new Float32Array(18), // Space for 6 vertices
                normal: new Float32Array(18),
                uv: new Float32Array(12),
                index: new Uint32Array(6), // Space for 6 indices
                range: [],
                color: 0xfff,
                groups: [],
            };

            const other: FaceMeshData = {
                position: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const matrix = Matrix4.fromTranslation(5, 0, 0);
            const offset = { facePosition: 3, faceIndex: 3 };

            MeshUtils.setFaceMeshData(data, other, matrix, offset);

            expect(data.range).toHaveLength(1);
            expect(data.range[0].start).toBe(3);
            expect(data.range[0].transform).toBe(matrix);
            expect(data.index[3]).toBe(3);
            expect(data.index[4]).toBe(4);
            expect(data.index[5]).toBe(5);
        });
    });

    describe("setSurfaceMeshData", () => {
        test("should set surface mesh data correctly", () => {
            const data = Mesh.createSurface(6, 6);
            const other = Mesh.createSurface(3, 3);

            // Add a group to other mesh
            other.groups.push({ start: 0, count: 3, materialIndex: 0 });

            const matrix = Matrix4.fromTranslation(1, 0, 0);
            const offset = { meshPosition: 3, meshIndex: 3 };
            const materialMap = new Map<number, number>([[0, 1]]);

            MeshUtils.setSurfaceMeshData(data, other, matrix, offset, materialMap);

            expect(data.groups).toHaveLength(1);
            expect(data.groups[0].start).toBe(3);
            expect(data.groups[0].materialIndex).toBe(1);
        });
    });

    describe("combineFaceMeshData", () => {
        test("should return early if other is undefined", () => {
            const data: FaceMeshData = {
                position: new Float32Array(9),
                normal: new Float32Array(9),
                uv: new Float32Array(6),
                index: new Uint32Array(3),
                range: [],
                color: 0xfff,
                groups: [],
            };

            expect(() => MeshUtils.combineFaceMeshData(data, undefined, Matrix4.identity())).not.toThrow();
        });

        test("should combine face mesh data correctly", () => {
            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [],
                color: 0xfff,
                groups: [],
            };

            const other: FaceMeshData = {
                position: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const matrix = Matrix4.fromTranslation(5, 0, 0);

            MeshUtils.combineFaceMeshData(data, other, matrix);

            expect(data.position.length).toBe(18);
            expect(data.index.length).toBe(6);
            expect(data.range).toHaveLength(1);
        });
    });

    describe("concatFloat32Array", () => {
        test("should concatenate two Float32Arrays", () => {
            const arr1 = new Float32Array([1, 2, 3]);
            const arr2 = new Float32Array([4, 5]);
            const result = MeshUtils.concatFloat32Array(arr1, arr2);

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(5);
            expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
        });

        test("should handle empty first array", () => {
            const arr1 = new Float32Array([]);
            const arr2 = new Float32Array([1, 2, 3]);
            const result = MeshUtils.concatFloat32Array(arr1, arr2);

            expect(result.length).toBe(3);
            expect(Array.from(result)).toEqual([1, 2, 3]);
        });

        test("should handle empty second array", () => {
            const arr1 = new Float32Array([1, 2, 3]);
            const arr2 = new Float32Array([]);
            const result = MeshUtils.concatFloat32Array(arr1, arr2);

            expect(result.length).toBe(3);
            expect(Array.from(result)).toEqual([1, 2, 3]);
        });
    });

    describe("setEdgeMeshData", () => {
        test("should return early if other is undefined", () => {
            const data: EdgeMeshData = {
                position: new Float32Array(6),
                range: [],
                color: 0xfff,
                lineType: "solid",
            };

            expect(() => MeshUtils.setEdgeMeshData(data, undefined, Matrix4.identity(), 0)).not.toThrow();
        });

        test("should set edge mesh data correctly", () => {
            const data: EdgeMeshData = {
                position: new Float32Array(12), // Space for 4 vertices
                range: [],
                color: 0xfff,
                lineType: "solid",
            };

            const other: EdgeMeshData = {
                position: new Float32Array([2, 0, 0, 3, 0, 0]),
                range: [{ start: 0, count: 2, shape: {} as any, transform: undefined }],
                color: 0xfff,
                lineType: "solid",
            };

            const matrix = Matrix4.fromTranslation(5, 0, 0);
            const offset = 2;

            MeshUtils.setEdgeMeshData(data, other, matrix, offset);

            expect(data.range).toHaveLength(1);
            expect(data.range[0].start).toBe(2);
            expect(data.range[0].transform).toBe(matrix);
        });
    });

    describe("combineEdgeMeshData", () => {
        test("should return early if other is undefined", () => {
            const data: EdgeMeshData = {
                position: new Float32Array(6),
                range: [],
                color: 0xfff,
                lineType: "solid",
            };

            expect(() => MeshUtils.combineEdgeMeshData(data, undefined, Matrix4.identity())).not.toThrow();
        });

        test("should combine edge mesh data correctly", () => {
            const data: EdgeMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [],
                color: 0xfff,
                lineType: "solid",
            };

            const other: EdgeMeshData = {
                position: new Float32Array([2, 0, 0, 3, 0, 0]),
                range: [{ start: 0, count: 2, shape: {} as any, transform: undefined }],
                color: 0xfff,
                lineType: "solid",
            };

            const matrix = Matrix4.fromTranslation(5, 0, 0);

            MeshUtils.combineEdgeMeshData(data, other, matrix);

            expect(data.position.length).toBe(12);
            expect(data.range).toHaveLength(1);
        });
    });

    describe("mergeFaceMesh", () => {
        test("should return original mesh if materialMap is empty", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const result = MeshUtils.mergeFaceMesh(mesh, []);
            expect(result).toBe(mesh);
        });

        test("should merge face mesh with material map", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const materialMap: [number, number][] = [[0, 1]];
            const result = MeshUtils.mergeFaceMesh(mesh, materialMap);

            expect(result).not.toBe(mesh);
            expect(result.groups).toHaveLength(1);
            expect(result.groups[0].materialIndex).toBe(1);
        });
    });

    describe("subFace", () => {
        test("should return undefined if index is out of range", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const result = MeshUtils.subFace(mesh, 1);
            expect(result).toBeUndefined();
        });

        test("should extract sub face correctly", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const result = MeshUtils.subFace(mesh, 0);

            expect(result).toBeDefined();
            expect(result!.position).toEqual(mesh.position);
            expect(result!.index).toEqual(new Uint32Array([0, 1, 2]));
            expect(result!.range).toEqual([]);
        });
    });

    describe("subFaceOutlines", () => {
        test("should return undefined if sub face is undefined", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const result = MeshUtils.subFaceOutlines(mesh, 1);
            expect(result).toBeUndefined();
        });

        test("should return face outline for valid sub face", () => {
            const mesh: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: {} as any, transform: undefined }],
                color: 0xfff,
                groups: [],
            };

            const result = MeshUtils.subFaceOutlines(mesh, 0);

            expect(result).toBeDefined();
            expect(result).toBeInstanceOf(Float32Array);
        });
    });

    describe("addEdge", () => {
        test("should add new edge to points map", () => {
            const pointsMap = new Map<string, { count: number; points: number[] }>();
            const face = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };

            MeshUtils.addEdge(pointsMap, face, 0, 1);

            expect(pointsMap.size).toBe(1);
            expect(pointsMap.has("0_1")).toBe(true);
            expect(pointsMap.get("0_1")!.count).toBe(1);
            expect(pointsMap.get("0_1")!.points).toEqual([0, 0, 0, 1, 0, 0]);
        });

        test("should increment count for existing edge", () => {
            const pointsMap = new Map<string, { count: number; points: number[] }>();
            const face = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };

            MeshUtils.addEdge(pointsMap, face, 0, 1);
            MeshUtils.addEdge(pointsMap, face, 1, 0);

            expect(pointsMap.size).toBe(1);
            expect(pointsMap.get("0_1")!.count).toBe(2);
        });

        test("should handle reversed indices correctly", () => {
            const pointsMap = new Map<string, { count: number; points: number[] }>();
            const face = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };

            MeshUtils.addEdge(pointsMap, face, 1, 0);

            expect(pointsMap.has("0_1")).toBe(true);
        });
    });

    describe("faceOutline", () => {
        test("should generate face outline for triangle", () => {
            const face = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                index: new Uint32Array([0, 1, 2]),
            };

            const result = MeshUtils.faceOutline(face);

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(18); // 6 edges * 3 coordinates
        });

        test("should return empty array for empty face", () => {
            const face = {
                position: new Float32Array([]),
                index: new Uint32Array([]),
            };

            const result = MeshUtils.faceOutline(face);

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(0);
        });
    });

    describe("subEdge", () => {
        test("should return undefined if index is out of range", () => {
            const mesh: EdgeMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
                range: [{ start: 0, count: 4, shape: {} as any, transform: undefined }],
                color: 0xfff,
                lineType: "solid",
            };

            const result = MeshUtils.subEdge(mesh, 1);
            expect(result).toBeUndefined();
        });

        test("should extract sub edge correctly", () => {
            const mesh: EdgeMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
                range: [{ start: 0, count: 4, shape: {} as any, transform: undefined }],
                color: 0xfff,
                lineType: "solid",
            };

            const result = MeshUtils.subEdge(mesh, 0);

            expect(result).toBeDefined();
            expect(result!.length).toBe(12); // 4 points * 3 coordinates
            expect(Array.from(result!)).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
        });
    });
});
