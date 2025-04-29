// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, FaceMeshData, MathUtils, Matrix4 } from "chili-core";

export class MeshUtils {
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
                };
            }),
        );
        data.index = data.index.concat(other.index.map((x) => x + data.position.length / 3));
        data.position = this.combineFloat32Array(data.position, matrix.ofPoints(other.position));
        data.normal = this.combineFloat32Array(data.normal, matrix.ofVectors(other.normal));
        data.uv = this.combineFloat32Array(data.uv, other.uv);
    }

    static combineFloat32Array(arr1: ArrayLike<number>, arr2: ArrayLike<number>) {
        let arr = new Float32Array(arr1.length + arr2.length);
        arr.set(arr1);
        arr.set(arr2, arr1.length);
        return arr;
    }

    static combineEdgeMeshData(data: EdgeMeshData, other: EdgeMeshData | undefined, matrix: Matrix4) {
        if (!other) {
            return;
        }

        let start = data.position.length / 3;
        data.position = this.combineFloat32Array(data.position, matrix.ofPoints(other.position));
        data.range = data.range.concat(
            other.range.map((g) => {
                return {
                    start: g.start + start,
                    shape: g.shape,
                    count: g.count,
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
            index: [],
            range: [],
            color: mesh.color,
            groups: [],
        };
        let vertexCount = 0;
        const grouped = Object.groupBy(materialMap, (x) => x[1]);
        for (let i = 0; i < Object.keys(grouped).length; i++) {
            const groupStart = result.index.length;
            vertexCount = MeshUtils.mergeSameGroup(grouped[i]!, mesh, result, vertexCount);
            result.groups.push({
                start: groupStart,
                count: result.index.length - groupStart,
                materialIndex: i,
            });
        }
        return result;
    }

    private static mergeSameGroup(
        group: [number, number][],
        mesh: FaceMeshData,
        result: FaceMeshData,
        vertexCount: number,
    ) {
        for (const index of group) {
            const { start, count, shape } = mesh.range[index[0]];

            const oldIndex = mesh.index.slice(start, start + count);
            const { min, max } = MathUtils.minMax(oldIndex)!;
            result.position.set(mesh.position.slice(min * 3, (max + 1) * 3), vertexCount * 3);
            result.normal.set(mesh.normal.slice(min * 3, (max + 1) * 3), vertexCount * 3);
            result.uv.set(mesh.uv.slice(min * 2, (max + 1) * 2), vertexCount * 2);
            for (let j = 0; j < count; j++) {
                result.index.push(oldIndex[j] - min + vertexCount);
            }
            result.range.push({
                start: result.index.length - count,
                count: count,
                shape,
            });
            vertexCount += max - min + 1;
        }
        return vertexCount;
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

    static faceOutline(face: { position: Float32Array; index: number[] }) {
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
