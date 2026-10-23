// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../src/math";
import type { LineType } from "../src/shape/lineType";
import {
    concatTypedArrays,
    type EdgeMeshData,
    EdgeMeshDataBuilder,
    type FaceMeshData,
    FaceMeshDataBuilder,
    Mesh,
    MeshDataUtils,
    MeshGroup,
    type ShapeMeshData,
    type VertexMeshData,
} from "../src/shape/meshData";
import type { ISubShape } from "../src/shape/shape";

describe("MeshData", () => {
    describe("Mesh", () => {
        test("createSurface should create mesh with correct properties", () => {
            const mesh = Mesh.createSurface(4, 6);
            expect(mesh.meshType).toBe("surface");
            expect(mesh.position).toBeInstanceOf(Float32Array);
            expect(mesh.position!.length).toBe(4 * 3);
            expect(mesh.normal).toBeInstanceOf(Float32Array);
            expect(mesh.normal!.length).toBe(4 * 3);
            expect(mesh.uv).toBeInstanceOf(Float32Array);
            expect(mesh.uv!.length).toBe(4 * 2);
            expect(mesh.index).toBeInstanceOf(Uint32Array);
            expect(mesh.index!.length).toBe(6);
            expect(mesh.color).toBe(0xfff);
            expect(mesh.groups).toEqual([]);
        });

        test("createLineSegments should create mesh with correct properties", () => {
            const mesh = Mesh.createLineSegments(8);
            expect(mesh.meshType).toBe("linesegments");
            expect(mesh.position).toBeInstanceOf(Float32Array);
            expect(mesh.position!.length).toBe(8 * 3);
            expect(mesh.normal).toBeUndefined();
            expect(mesh.uv).toBeUndefined();
            expect(mesh.index).toBeUndefined();
            expect(mesh.color).toBe(0xfff);
            expect(mesh.groups).toEqual([]);
        });

        test("default mesh properties", () => {
            const mesh = new Mesh();
            expect(mesh.meshType).toBe("linesegments");
            expect(mesh.position).toBeUndefined();
            expect(mesh.normal).toBeUndefined();
            expect(mesh.index).toBeUndefined();
            expect(mesh.color).toBe(0xfff);
            expect(mesh.uv).toBeUndefined();
            expect(mesh.groups).toEqual([]);
        });
    });

    describe("MeshGroup", () => {
        test("constructor should set properties", () => {
            const group = new MeshGroup({ start: 10, count: 20, materialIndex: 5 });
            expect(group.start).toBe(10);
            expect(group.count).toBe(20);
            expect(group.materialIndex).toBe(5);
        });
    });

    describe("concatTypedArrays", () => {
        test("should concatenate Float32Arrays", () => {
            const arr1 = new Float32Array([1, 2, 3]);
            const arr2 = new Float32Array([4, 5]);
            const result = concatTypedArrays([arr1, arr2]);
            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(5);
            expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
        });

        test("should concatenate Uint32Arrays", () => {
            const arr1 = new Uint32Array([10, 20]);
            const arr2 = new Uint32Array([30, 40, 50]);
            const result = concatTypedArrays([arr1, arr2]);
            expect(result).toBeInstanceOf(Uint32Array);
            expect(result.length).toBe(5);
            expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
        });

        test("should handle empty arrays", () => {
            const arr1 = new Float32Array([]);
            const arr2 = new Float32Array([1, 2]);
            const result = concatTypedArrays([arr1, arr2]);
            expect(result.length).toBe(2);
            expect(Array.from(result)).toEqual([1, 2]);
        });

        test("should handle single array", () => {
            const arr = new Float32Array([1, 2, 3]);
            const result = concatTypedArrays([arr]);
            expect(result).toEqual(arr);
            expect(Array.from(result)).toEqual([1, 2, 3]);
        });
    });

    describe("MeshDataUtils", () => {
        describe("type guards", () => {
            test("isVertexMesh", () => {
                const vertexMesh: VertexMeshData = {
                    position: new Float32Array([0, 0, 0]),
                    range: [],
                    color: 0xfff,
                    size: 5,
                };
                expect(MeshDataUtils.isVertexMesh(vertexMesh)).toBe(true);
                expect(MeshDataUtils.isVertexMesh({} as ShapeMeshData)).toBe(false);
            });

            test("isEdgeMesh", () => {
                const edgeMesh: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 1, 1]),
                    range: [],
                    color: 0xfff,
                    lineType: "solid",
                };
                expect(MeshDataUtils.isEdgeMesh(edgeMesh)).toBe(true);
                expect(MeshDataUtils.isEdgeMesh({} as ShapeMeshData)).toBe(false);
            });

            test("isFaceMesh", () => {
                const faceMesh: FaceMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    range: [],
                    color: 0xfff,
                    index: new Uint32Array([0, 1, 2]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                    groups: [],
                };
                expect(MeshDataUtils.isFaceMesh(faceMesh)).toBe(true);
                expect(MeshDataUtils.isFaceMesh({} as ShapeMeshData)).toBe(false);
            });
        });

        describe("createVertexMesh", () => {
            test("should create vertex mesh with correct properties", () => {
                const point = new XYZ({ x: 1, y: 2, z: 3 });
                const size = 10;
                const color = 0x00ff00;
                const result = MeshDataUtils.createVertexMesh(point, size, color);
                expect(result.position).toEqual(new Float32Array([1, 2, 3]));
                expect(result.range).toEqual([]);
                expect(result.color).toBe(color);
                expect(result.size).toBe(size);
            });
        });

        describe("createEdgeMesh", () => {
            test("should create edge mesh with correct properties", () => {
                const start = new XYZ({ x: 0, y: 0, z: 0 });
                const end = new XYZ({ x: 1, y: 2, z: 3 });
                const color = 0xff0000;
                const lineType: LineType = "dash";
                const result = MeshDataUtils.createEdgeMesh(start, end, color, lineType);
                expect(result.position).toEqual(new Float32Array([0, 0, 0, 1, 2, 3]));
                expect(result.range).toEqual([]);
                expect(result.color).toBe(color);
                expect(result.lineType).toBe(lineType);
            });
        });

        describe("mergeEdgeMesh", () => {
            test("should merge two edge meshes", () => {
                const mesh1: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0]),
                    range: [{ start: 0, count: 2, shape: {} as ISubShape }],
                    color: 0xfff,
                    lineType: "solid",
                };
                const mesh2: EdgeMeshData = {
                    position: new Float32Array([2, 0, 0, 3, 0, 0]),
                    range: [{ start: 0, count: 2, shape: {} as ISubShape }],
                    color: 0xfff,
                    lineType: "solid",
                };
                const result = MeshDataUtils.mergeEdgeMesh(mesh1, mesh2);
                expect(result.position).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]));
                expect(result.range).toHaveLength(2);
                expect(result.range[0]).toEqual(mesh1.range[0]);
                expect(result.range[1]).toEqual({ start: 2, count: 2, shape: {} as ISubShape });
                expect(result.color).toBe(mesh1.color);
                expect(result.lineType).toBe(mesh1.lineType);
            });
        });

        describe("appendEdgeMeshes line types", () => {
            const shapeOf = (id: string) =>
                ({
                    id,
                    shapeType: 1,
                    isEqual: () => false,
                    findAncestor: () => [],
                    findSubShapes: () => [],
                }) as unknown as ISubShape;

            const baseEdges = (): EdgeMeshData => ({
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [{ start: 0, count: 2, shape: shapeOf("e1") }],
                color: 0x111111,
                lineType: "solid",
            });

            const auxEdges = (): EdgeMeshData => ({
                position: new Float32Array([2, 0, 0, 3, 0, 0]),
                range: [{ start: 0, count: 2, shape: shapeOf("aux1") }],
                color: 0x222222,
                lineType: "dash",
            });

            test("tags the ranges of a part whose line type differs from the base", () => {
                const result = MeshDataUtils.appendEdgeMeshes(baseEdges(), [auxEdges()]);
                expect(result.lineType).toBe("solid");
                expect(result.range[0].lineType).toBeUndefined();
                expect(result.range[1]).toEqual({
                    start: 2,
                    count: 2,
                    shape: result.range[1].shape,
                    lineType: "dash",
                });
            });

            test("a part sharing the base line type leaves its ranges untagged", () => {
                const extra = { ...auxEdges(), lineType: "solid" as const };
                const result = MeshDataUtils.appendEdgeMeshes(baseEdges(), [extra]);
                expect(result.range.every((x) => x.lineType === undefined)).toBe(true);
            });

            test("the inputs are not mutated", () => {
                const base = baseEdges();
                const aux = auxEdges();
                MeshDataUtils.appendEdgeMeshes(base, [aux]);
                expect(base.range[0].lineType).toBeUndefined();
                expect(aux.range[0].lineType).toBeUndefined();
            });
        });

        describe("splitEdgeRuns", () => {
            const shapeOf = (id: string) =>
                ({
                    id,
                    shapeType: 1,
                    isEqual: () => false,
                    findAncestor: () => [],
                    findSubShapes: () => [],
                }) as unknown as ISubShape;

            test("an untagged mesh comes back as one run sharing the source arrays", () => {
                const data: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0]),
                    range: [{ start: 0, count: 2, shape: shapeOf("e1") }],
                    color: 0x111111,
                    lineType: "solid",
                };
                const runs = MeshDataUtils.splitEdgeRuns(data);
                expect(runs).toHaveLength(1);
                expect(runs[0].lineType).toBe("solid");
                expect(runs[0].startVertex).toBe(0);
                expect(runs[0].position).toBe(data.position);
                expect(runs[0].color).toBe(data.color);
            });

            test("splits around a tagged block and reports mesh-space start vertices", () => {
                const data: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0]),
                    range: [
                        { start: 0, count: 2, shape: shapeOf("e1") },
                        { start: 2, count: 2, shape: shapeOf("aux1"), lineType: "dash" },
                        { start: 4, count: 2, shape: shapeOf("e2") },
                    ],
                    color: 0x111111,
                    lineType: "solid",
                };
                const runs = MeshDataUtils.splitEdgeRuns(data);
                expect(runs.map((x) => [x.lineType, x.startVertex, x.position.length])).toEqual([
                    ["solid", 0, 6],
                    ["dash", 2, 6],
                    ["solid", 4, 6],
                ]);
                expect(Array.from(runs[1].position)).toEqual([2, 0, 0, 3, 0, 0]);
            });

            test("adjacent tagged ranges of the same type coalesce into one run", () => {
                const data: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
                    range: [
                        { start: 0, count: 2, shape: shapeOf("e1") },
                        { start: 2, count: 1, shape: shapeOf("aux1"), lineType: "dash" },
                        { start: 3, count: 1, shape: shapeOf("aux2"), lineType: "dash" },
                    ],
                    color: 0x111111,
                    lineType: "solid",
                };
                const runs = MeshDataUtils.splitEdgeRuns(data);
                expect(runs.map((x) => [x.lineType, x.startVertex, x.position.length])).toEqual([
                    ["solid", 0, 6],
                    ["dash", 2, 6],
                ]);
            });

            test("slices the per-vertex colour array along with the positions", () => {
                const colors = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0];
                const data: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
                    range: [
                        { start: 0, count: 2, shape: shapeOf("e1") },
                        { start: 2, count: 2, shape: shapeOf("aux1"), lineType: "dash" },
                    ],
                    color: colors,
                    lineType: "solid",
                };
                const runs = MeshDataUtils.splitEdgeRuns(data);
                expect(runs[0].color).toEqual([1, 0, 0, 1, 0, 0]);
                expect(runs[1].color).toEqual([0, 1, 0, 0, 1, 0]);
                expect(colors).toHaveLength(12); // sliced, not mutated
            });

            test("segments no range covers keep the mesh's own line type", () => {
                const data: EdgeMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
                    range: [{ start: 0, count: 2, shape: shapeOf("aux1"), lineType: "dash" }],
                    color: 0x111111,
                    lineType: "solid",
                };
                const runs = MeshDataUtils.splitEdgeRuns(data);
                expect(runs.map((x) => [x.lineType, x.startVertex])).toEqual([
                    ["dash", 0],
                    ["solid", 2],
                ]);
            });
        });

        describe("mergeFaceMesh", () => {
            test("should merge two face meshes", () => {
                const mesh1: FaceMeshData = {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    range: [{ start: 0, count: 1, shape: {} as ISubShape }],
                    color: 0xfff,
                    index: new Uint32Array([0, 1, 2]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                    groups: [],
                };
                const mesh2: FaceMeshData = {
                    position: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
                    range: [{ start: 0, count: 1, shape: {} as ISubShape }],
                    color: 0xfff,
                    index: new Uint32Array([0, 1, 2]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                    groups: [],
                };
                const result = MeshDataUtils.mergeFaceMesh(mesh1, mesh2);
                expect(result.position).toEqual(
                    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
                );
                expect(result.range).toHaveLength(2);
                expect(result.range[0]).toEqual(mesh1.range[0]);
                expect(result.range[1]).toEqual({
                    start: 3,
                    count: 1,
                    shape: {} as ISubShape,
                    transform: undefined,
                });
                expect(result.index).toEqual(new Uint32Array([0, 1, 2, 0, 1, 2]));
                expect(result.normal).toEqual(
                    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
                );
                expect(result.uv).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
                expect(result.color).toBe(mesh1.color);
            });
        });
    });

    describe("EdgeMeshDataBuilder", () => {
        test("constructor should set default color", () => {
            const builder = new EdgeMeshDataBuilder();
            expect(builder).toBeInstanceOf(EdgeMeshDataBuilder);
        });

        test("setType should change line type", () => {
            const builder = new EdgeMeshDataBuilder();
            builder.setType("dash");
            const result = builder.build();
            expect(result.lineType).toBe("dash");
        });

        test("newGroup and endGroup should manage groups", () => {
            const builder = new EdgeMeshDataBuilder();
            builder.newGroup();
            builder.addPosition(0, 0, 0);
            builder.addPosition(1, 0, 0);
            builder.addPosition(2, 0, 0);
            const shape = {} as ISubShape;
            builder.endGroup(shape);
            const result = builder.build();
            expect(result.range).toHaveLength(1);
            expect(result.range[0]).toEqual({ start: 0, count: 4, shape });
        });

        test("addPosition should create line segments", () => {
            const builder = new EdgeMeshDataBuilder();
            builder.addPosition(0, 0, 0);
            builder.addPosition(1, 0, 0);
            builder.addPosition(2, 0, 0);
            const result = builder.build();
            expect(result.position).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]));
            expect(result.lineType).toBe("solid");
        });

        test("setColor should apply color", () => {
            const builder = new EdgeMeshDataBuilder();
            builder.setColor(0x00ff00);
            const result = builder.build();
            expect(result.color).toBe(0x00ff00);
        });

        test("addColor should create vertex colors", () => {
            const builder = new EdgeMeshDataBuilder();
            builder.addColor(1, 0, 0);
            builder.addPosition(0, 0, 0);
            builder.addPosition(1, 0, 0);
            builder.addColor(0, 1, 0);
            const result = builder.build();
            expect(result.color).toEqual([1, 0, 0, 0, 1, 0]);
        });
    });

    describe("FaceMeshDataBuilder", () => {
        test("constructor should set default color", () => {
            const builder = new FaceMeshDataBuilder();
            expect(builder).toBeInstanceOf(FaceMeshDataBuilder);
        });

        test("newGroup and endGroup should manage groups", () => {
            const builder = new FaceMeshDataBuilder();
            builder.newGroup();
            builder.addPosition(0, 0, 0);
            builder.addPosition(1, 0, 0);
            builder.addPosition(0, 1, 0);
            builder.addIndices(0, 1, 2);
            const shape = {} as ISubShape;
            builder.endGroup(shape);
            const result = builder.build();
            expect(result.range).toHaveLength(1);
            expect(result.range[0]).toEqual({ start: 0, count: 3, shape });
        });

        test("addPosition, addNormal, addUV, addIndices should work", () => {
            const builder = new FaceMeshDataBuilder();
            builder.addPosition(0, 0, 0);
            builder.addNormal(0, 0, 1);
            builder.addUV(0, 0);
            builder.addPosition(1, 0, 0);
            builder.addNormal(0, 0, 1);
            builder.addUV(1, 0);
            builder.addPosition(0, 1, 0);
            builder.addNormal(0, 0, 1);
            builder.addUV(0, 1);
            builder.addIndices(0, 1, 2);
            const result = builder.build();
            expect(result.position).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
            expect(result.normal).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
            expect(result.uv).toEqual(new Float32Array([0, 0, 1, 0, 0, 1]));
            expect(result.index).toEqual(new Uint32Array([0, 1, 2]));
        });

        test("setColor should apply color", () => {
            const builder = new FaceMeshDataBuilder();
            builder.setColor(0xff0000);
            builder.addPosition(0, 0, 0);
            const result = builder.build();
            expect(result.color).toBe(0xff0000);
        });

        test("addColor should create vertex colors", () => {
            const builder = new FaceMeshDataBuilder();
            builder.addColor(1, 0, 0);
            builder.addPosition(0, 0, 0);
            builder.addColor(0, 1, 0);
            builder.addPosition(1, 0, 0);
            builder.addColor(0, 0, 1);
            builder.addPosition(0, 1, 0);
            builder.addIndices(0, 1, 2);
            const result = builder.build();
            expect(result.color).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        });
    });
});
