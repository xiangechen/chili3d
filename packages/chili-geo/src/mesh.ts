// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, FaceMeshData, MathUtils } from "chili-core";

export class MeshUtils {
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

    static faceOutline(face: { position: Float32Array; index: Uint16Array | Uint32Array }) {
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
