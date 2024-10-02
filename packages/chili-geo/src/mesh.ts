// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { EdgeMeshData, FaceMeshData, MathUtils } from "chili-core";

export class MeshUtils {
    static subFace(mesh: FaceMeshData, index: number) {
        let group = mesh?.groups[index];
        if (!group) return undefined;

        let indices = mesh.indices.slice(group.start, group.start + group.count);
        let minMax = MathUtils.minMax(indices)!;
        let [indiceStart, indiceEnd] = [minMax.min, minMax.max + 1];

        let positions = mesh.positions.slice(indiceStart * 3, indiceEnd * 3);
        let uvs = mesh.uvs.slice(indiceStart * 2, indiceEnd * 2);
        let normals = mesh.normals.slice(indiceStart * 3, indiceEnd * 3);
        indices = indices.map((i) => i - indiceStart);

        return {
            positions,
            normals,
            indices,
            uvs,
            groups: [],
            color: mesh.color,
        };
    }

    static subFaceOutlines(face: FaceMeshData, index: number) {
        let mesh = this.subFace(face, index);
        if (!mesh) return undefined;

        return this.faceOutline(mesh);
    }

    static faceOutline(face: { positions: number[]; indices: number[] }) {
        let pointsMap = new Map<string, { count: number; points: number[] }>();

        const addEdge = (i: number, j: number) => {
            let key = i < j ? `${i}_${j}` : `${j}_${i}`;
            if (pointsMap.has(key)) {
                pointsMap.get(key)!.count++;
                return;
            }

            const points = [
                ...face.positions.slice(i * 3, i * 3 + 3),
                ...face.positions.slice(j * 3, j * 3 + 3),
            ];
            pointsMap.set(key, { count: 1, points });
        };

        for (let i = 0; i < face.indices.length; i += 3) {
            addEdge(face.indices[i], face.indices[i + 1]);
            addEdge(face.indices[i + 1], face.indices[i + 2]);
            addEdge(face.indices[i + 2], face.indices[i]);
        }

        let points: number[] = [];
        pointsMap.forEach((v) => {
            if (v.count === 1) {
                points.push(...v.points);
            }
        });
        return points;
    }

    static subEdge(mesh: EdgeMeshData, index: number) {
        let group = mesh?.groups[index];
        if (!group) return undefined;

        return mesh.positions.slice(group.start * 3, (group.start + group.count) * 3);
    }
}
