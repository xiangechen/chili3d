// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { concatTypedArrays, EdgeMeshData, FaceMeshData, MathUtils, Matrix4, Mesh } from "chili-core";

export class MeshUtils {
    static setFaceMeshData(
        data: FaceMeshData,
        other: FaceMeshData | undefined,
        matrix: Matrix4,
        offset: { facePosition: number; faceIndex: number },
    ) {
        if (!other) {
            return;
        }

        data.range = data.range.concat(
            other.range.map((g) => {
                return {
                    start: g.start + offset.faceIndex,
                    shape: g.shape,
                    count: g.count,
                    transform: matrix,
                };
            }),
        );
        data.index.set(
            other.index.map((x) => x + offset.facePosition),
            offset.faceIndex,
        );
        data.position.set(matrix.ofPoints(other.position), offset.facePosition * 3);
        data.normal.set(matrix.ofVectors(other.normal), offset.facePosition * 3);
        data.uv.set(other.uv, offset.facePosition * 2);
    }

    static setSurfaceMeshData(
        data: Mesh, 
        other: Mesh, 
        matrix: Matrix4,
        offset: { meshPosition: number; meshIndex: number },
        materialMap: Map<number, number>,
    ) {
        other.groups.forEach((g) => {
            data.groups.push({
                start: g.start + offset.meshIndex,
                count: g.count,
                materialIndex: materialMap.get(g.materialIndex)!,
            })
        })
        if (data.index && other.index) {
            data.index.set(other.index.map((x) => x + offset.meshPosition), offset.meshIndex);
        }
        if (data.position && other.position) {
            data.position.set(matrix.ofPoints(other.position), offset.meshPosition * 3);
        }
        if (data.normal && other.normal) {
            data.normal.set(matrix.ofVectors(other.normal), offset.meshPosition * 3);
        }
        if (data.uv && other.uv) {
            data.uv.set(other.uv, offset.meshPosition * 2);
        }
    }

    static combineFaceMeshData(data: FaceMeshData, other: FaceMeshData | undefined, matrix: Matrix4) {
        if (!other) {
            return;
        }

        data.range = data.range.concat(
            other.range.map((g) => {
                return {
                    start: g.start + data.index.length,
                    shape: g.shape,
                    count: g.count,
                    transform: matrix,
                };
            }),
        );
        data.index = concatTypedArrays([data.index, other.index.map((x) => x + data.position.length / 3)]);
        data.position = this.concatFloat32Array(data.position, matrix.ofPoints(other.position));
        data.normal = this.concatFloat32Array(data.normal, matrix.ofVectors(other.normal));
        data.uv = this.concatFloat32Array(data.uv, other.uv);
    }

    static concatFloat32Array(arr1: ArrayLike<number>, arr2: ArrayLike<number>) {
        let arr = new Float32Array(arr1.length + arr2.length);
        arr.set(arr1);
        arr.set(arr2, arr1.length);
        return arr;
    }

    static setEdgeMeshData(
        data: EdgeMeshData,
        other: EdgeMeshData | undefined,
        matrix: Matrix4,
        offset: number,
    ) {
        if (!other) {
            return;
        }

        data.position.set(matrix.ofPoints(other.position), offset * 3);
        data.range = data.range.concat(
            other.range.map((g) => {
                return {
                    transform: matrix,
                    start: g.start + offset,
                    shape: g.shape,
                    count: g.count,
                };
            }),
        );
    }

    static combineEdgeMeshData(data: EdgeMeshData, other: EdgeMeshData | undefined, matrix: Matrix4) {
        if (!other) {
            return;
        }

        let start = data.position.length / 3;
        data.position = this.concatFloat32Array(data.position, matrix.ofPoints(other.position));
        data.range = data.range.concat(
            other.range.map((g) => {
                return {
                    start: g.start + start,
                    shape: g.shape,
                    count: g.count,
                    transform: matrix,
                };
            }),
        );
    }

    static mergeFaceMesh(mesh: FaceMeshData, materialMap: [number, number][]): FaceMeshData {
        if (materialMap.length === 0) {
            return mesh;
        }

        const materialIndexMap = new Map<number, number>(materialMap);
        for (let i = 0; i < mesh.range.length; i++) {
            if (!materialIndexMap.has(i)) {
                materialIndexMap.set(i, 0);
            }
        }

        return this.mergeFaceMeshWithMap(mesh, materialIndexMap);
    }

    private static mergeFaceMeshWithMap(mesh: FaceMeshData, materialMap: Map<number, number>): FaceMeshData {
        const result: FaceMeshData = {
            position: new Float32Array(mesh.position.length),
            normal: new Float32Array(mesh.normal.length),
            uv: new Float32Array(mesh.uv.length),
            index: new Uint32Array(mesh.index.length),
            range: [],
            color: mesh.color,
            groups: [],
        };

        let offset = { facePosition: 0, faceIndex: 0 };
        const grouped = Object.groupBy(materialMap, (x) => x[1]);

        for (const key of Object.keys(grouped)) {
            const i = parseInt(key);
            const groupStart = offset.faceIndex;
            MeshUtils.mergeSameGroup(grouped[i]!, mesh, result, offset);
            result.groups.push({
                start: groupStart,
                count: offset.faceIndex - groupStart,
                materialIndex: i,
            });
        }
        return result;
    }

    private static mergeSameGroup(
        group: [number, number][],
        mesh: FaceMeshData,
        result: FaceMeshData,
        offset: { facePosition: number; faceIndex: number },
    ) {
        for (const index of group) {
            const { start, count, shape, transform: worldTransform } = mesh.range[index[0]];

            const oldIndex = mesh.index.slice(start, start + count);
            const { min, max } = MathUtils.minMax(oldIndex)!;
            result.position.set(mesh.position.slice(min * 3, (max + 1) * 3), offset.facePosition * 3);
            result.normal.set(mesh.normal.slice(min * 3, (max + 1) * 3), offset.facePosition * 3);
            result.uv.set(mesh.uv.slice(min * 2, (max + 1) * 2), offset.facePosition * 2);
            result.index.set(
                oldIndex.map((x) => x - min + offset.facePosition),
                offset.faceIndex,
            );
            result.range.push({
                start: offset.faceIndex,
                count,
                shape,
                transform: worldTransform,
            });
            offset.facePosition += max - min + 1;
            offset.faceIndex += oldIndex.length;
        }
    }

    static subFace(mesh: FaceMeshData, index: number): FaceMeshData | undefined {
        const group = mesh?.range[index];
        if (!group) return undefined;

        const indices = mesh.index.slice(group.start, group.start + group.count);
        const { min, max } = MathUtils.minMax(indices)!;
        const [indiceStart, indiceEnd] = [min, max + 1];

        return {
            position: mesh.position.slice(indiceStart * 3, indiceEnd * 3),
            normal: mesh.normal.slice(indiceStart * 3, indiceEnd * 3),
            index: indices.map((i) => i - indiceStart),
            uv: mesh.uv.slice(indiceStart * 2, indiceEnd * 2),
            range: [],
            color: mesh.color,
            groups: [],
        };
    }

    static subFaceOutlines(face: FaceMeshData, index: number) {
        const mesh = this.subFace(face, index);
        if (!mesh) return undefined;

        return this.faceOutline(mesh);
    }

    static addEdge(
        pointsMap: Map<string, { count: number; points: number[] }>,
        face: { position: Float32Array },
        i: number,
        j: number,
    ) {
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        const entry = pointsMap.get(key);
        if (entry) {
            entry.count++;
        } else {
            const points = [
                ...face.position.slice(i * 3, i * 3 + 3),
                ...face.position.slice(j * 3, j * 3 + 3),
            ];
            pointsMap.set(key, { count: 1, points });
        }
    }

    static faceOutline(face: { position: Float32Array; index: Uint32Array }) {
        const pointsMap = new Map<string, { count: number; points: number[] }>();

        for (let i = 0; i < face.index.length; i += 3) {
            this.addEdge(pointsMap, face, face.index[i], face.index[i + 1]);
            this.addEdge(pointsMap, face, face.index[i + 1], face.index[i + 2]);
            this.addEdge(pointsMap, face, face.index[i + 2], face.index[i]);
        }

        return new Float32Array(
            Array.from(pointsMap.values())
                .filter((v) => v.count === 1)
                .flatMap((entry) => entry.points),
        );
    }

    static subEdge(mesh: EdgeMeshData, index: number) {
        const group = mesh?.range[index];
        if (!group) return undefined;

        return mesh.position.slice(group.start * 3, (group.start + group.count) * 3);
    }
}
