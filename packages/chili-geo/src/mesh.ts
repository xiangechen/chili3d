// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, FaceMeshData, MathUtils } from "chili-core";

export class MeshUtils {
    static subFace(mesh: FaceMeshData, index: number) {
        const group = mesh?.groups[index];
        if (!group) return undefined;

        const indices = mesh.indices.slice(group.start, group.start + group.count);
        const { min, max } = MathUtils.minMax(indices)!;
        const [indiceStart, indiceEnd] = [min, max + 1];

        return {
            positions: mesh.positions.slice(indiceStart * 3, indiceEnd * 3),
            normals: mesh.normals.slice(indiceStart * 3, indiceEnd * 3),
            indices: indices.map((i) => i - indiceStart),
            uvs: mesh.uvs.slice(indiceStart * 2, indiceEnd * 2),
            groups: [],
            color: mesh.color,
        };
    }

    static subFaceOutlines(face: FaceMeshData, index: number) {
        const mesh = this.subFace(face, index);
        if (!mesh) return undefined;

        return this.faceOutline(mesh);
    }

    static addEdge(
        pointsMap: Map<string, { count: number; points: number[] }>,
        face: { positions: Float32Array },
        i: number,
        j: number,
    ) {
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        const entry = pointsMap.get(key);
        if (entry) {
            entry.count++;
        } else {
            const points = [
                ...face.positions.slice(i * 3, i * 3 + 3),
                ...face.positions.slice(j * 3, j * 3 + 3),
            ];
            pointsMap.set(key, { count: 1, points });
        }
    }

    static faceOutline(face: { positions: Float32Array; indices: Uint16Array | Uint32Array }) {
        const pointsMap = new Map<string, { count: number; points: number[] }>();

        for (let i = 0; i < face.indices.length; i += 3) {
            this.addEdge(pointsMap, face, face.indices[i], face.indices[i + 1]);
            this.addEdge(pointsMap, face, face.indices[i + 1], face.indices[i + 2]);
            this.addEdge(pointsMap, face, face.indices[i + 2], face.indices[i]);
        }

        return new Float32Array(
            Array.from(pointsMap.values())
                .filter((v) => v.count === 1)
                .flatMap((entry) => entry.points),
        );
    }

    static subEdge(mesh: EdgeMeshData, index: number) {
        const group = mesh?.groups[index];
        if (!group) return undefined;

        return mesh.positions.slice(group.start * 3, (group.start + group.count) * 3);
    }
}
