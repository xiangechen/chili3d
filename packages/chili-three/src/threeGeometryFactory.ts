// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { EdgeMeshData, FaceMeshData, LineType, VertexMeshData } from "chili-core";
import {
    AlwaysDepth,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Mesh,
    MeshLambertMaterial,
    Points,
    PointsMaterial,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";

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
        buff.setAttribute("position", new BufferAttribute(new Float32Array(data.positions), 3));
        buff.setAttribute("normal", new BufferAttribute(new Float32Array(data.normals), 3));
        buff.setAttribute("uv", new BufferAttribute(new Float32Array(data.uvs), 2));
        buff.setIndex(new BufferAttribute(new Uint32Array(data.indices), 1));
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
        let buff = new LineSegmentsGeometry();
        buff.setPositions(new Float32Array(data.positions));

        let color = data.color as number;
        let linewidth = data.lineWidth ?? 1;
        let material =
            data.lineType === LineType.Dash
                ? new LineMaterial({
                      color,
                      dashed: true,
                      dashScale: 100,
                      dashSize: 100,
                      gapSize: 100,
                      linewidth,
                      polygonOffset: true,
                      polygonOffsetFactor: -4,
                      polygonOffsetUnits: -4,
                  })
                : new LineMaterial({
                      color,
                      linewidth,
                      polygonOffset: true,
                      polygonOffsetFactor: -4,
                      polygonOffsetUnits: -4,
                  });
        return new LineSegments2(buff, material).computeLineDistances();
    }
}
