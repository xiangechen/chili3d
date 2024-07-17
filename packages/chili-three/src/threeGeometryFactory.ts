// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AlwaysDepth,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    LineDashedMaterial,
    LineSegments,
    Mesh,
    MeshLambertMaterial,
    Points,
    PointsMaterial,
} from "three";
import { EdgeMeshData, FaceMeshData, LineType, VertexMeshData } from "chili-core";

export class ThreeGeometryFactory {
    static createVertexGeometry(data: VertexMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        let color = data.color as number;
        let material = new PointsMaterial({
            size: data.size,
            sizeAttenuation: false,
            color,
        });
        material.depthFunc = AlwaysDepth;
        return new Points(buff, material);
    }

    static createFaceGeometry(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        buff.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
        buff.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
        buff.setIndex(data.indices);
        buff.computeBoundingBox();
        let material = new MeshLambertMaterial({ side: DoubleSide });
        if (typeof data.color === "number") {
            material.color.set(data.color);
        } else {
            material.vertexColors = true;
            buff.setAttribute("color", new Float32BufferAttribute(data.color, 3));
        }

        return new Mesh(buff, material);
    }

    static createEdgeGeometry(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        let color = data.color as number;
        let material: LineBasicMaterial =
            data.lineType === LineType.Dash
                ? new LineDashedMaterial({ color, dashSize: 6, gapSize: 6 })
                : new LineBasicMaterial({ color });
        return new LineSegments(buff, material).computeLineDistances();
    }
}
