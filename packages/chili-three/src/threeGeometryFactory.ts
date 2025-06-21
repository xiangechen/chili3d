// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EdgeMeshData, FaceMeshData, LineType, ShapeMeshData, VertexMeshData } from "chili-core";
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
        buff.setAttribute("position", new BufferAttribute(data.position, 3));
        let material = new PointsMaterial({
            size: data.size,
            sizeAttenuation: false,
        });
        this.setColor(buff, data, material);

        material.depthFunc = AlwaysDepth;
        return new Points(buff, material);
    }

    static createFaceGeometry(data: FaceMeshData, opacity?: number) {
        let buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        let material = new MeshLambertMaterial({ side: DoubleSide });
        if (opacity !== undefined) {
            material.transparent = true;
            material.opacity = opacity;
        }
        this.setColor(buff, data, material);

        return new Mesh(buff, material);
    }

    private static setColor(
        buffer: BufferGeometry,
        data: ShapeMeshData,
        material: MeshLambertMaterial | PointsMaterial | LineMaterial,
    ) {
        if (typeof data.color === "number") {
            material.color.set(data.color);
        } else if (Array.isArray(data.color)) {
            material.vertexColors = true;
            buffer.setAttribute("color", new Float32BufferAttribute(data.color, 3));
        }
    }

    static createFaceBufferGeometry(data: FaceMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new BufferAttribute(data.position, 3));
        buff.setAttribute("normal", new BufferAttribute(data.normal, 3));
        buff.setAttribute("uv", new BufferAttribute(data.uv, 2));
        if (data.index && data.index.length > 0) buff.setIndex(new BufferAttribute(data.index, 1));
        buff.computeBoundingBox();
        return buff;
    }

    static createEdgeGeometry(data: EdgeMeshData) {
        let buff = this.createEdgeBufferGeometry(data);
        let linewidth = data.lineWidth ?? 1;
        let material = new LineMaterial({
            linewidth,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        });
        if (data.lineType === LineType.Dash) {
            material.dashed = true;
            material.dashScale = 100;
            material.dashSize = 100;
            material.gapSize = 100;
        }
        this.setColor(buff, data, material);
        return new LineSegments2(buff, material).computeLineDistances();
    }

    static createEdgeBufferGeometry(data: EdgeMeshData) {
        let buff = new LineSegmentsGeometry();
        buff.setPositions(data.position);
        buff.computeBoundingBox();
        return buff;
    }
}
