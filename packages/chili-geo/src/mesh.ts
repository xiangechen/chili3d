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
        let normals = mesh.normals.slice(indiceStart * 3, indiceEnd * 3);
        indices = indices.map((i) => i - indiceStart);

        return {
            positions,
            normals,
            indices,
        };
    }

    static subEdge(mesh: EdgeMeshData, index: number) {
        let group = mesh?.groups[index];
        if (!group) return undefined;

        let positions = mesh.positions.slice(group.start * 3, (group.start + group.count) * 3);
        return {
            positions,
        };
    }
}
