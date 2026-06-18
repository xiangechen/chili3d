// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData, MeshLike, MeshOption, VertexMeshData } from "@chili3d/core";
import {
    AlwaysDepth,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    Mesh,
    MeshLambertMaterial,
    Points,
    PointsMaterial,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

const TopRenderOrder = 999;

export class ThreeGeometryFactory {
    static createVertexGeometry(data: VertexMeshData, meshOption?: MeshOption) {
        const buff = ThreeGeometryFactory.createVertexBufferGeometry(data);
        const material = ThreeGeometryFactory.createVertexMaterial(data, meshOption);
        ThreeGeometryFactory.setColor(buff, data, material);

        const points = new Points(buff, material);
        if (meshOption?.onTop) {
            points.renderOrder = TopRenderOrder;
        }
        return points;
    }

    static createVertexMaterial(data: VertexMeshData, meshOption?: MeshOption) {
        const material = new PointsMaterial({
            size: data.size,
            sizeAttenuation: false,
        });
        ThreeGeometryFactory.setMaterialParameter(material, meshOption);
        return material;
    }

    private static setMaterialParameter(
        material: MeshLambertMaterial | PointsMaterial | LineMaterial | LineBasicMaterial,
        meshOption?: MeshOption,
    ) {
        if (material instanceof LineMaterial || material instanceof LineBasicMaterial) {
            if (meshOption?.lineOpacity !== undefined) {
                material.transparent = true;
                material.opacity = meshOption.lineOpacity;
            }
        } else if (material instanceof PointsMaterial) {
            if (meshOption?.vertexOpacity !== undefined) {
                material.transparent = true;
                material.opacity = meshOption.vertexOpacity;
            }
        } else if (meshOption?.meshOpacity !== undefined) {
            material.transparent = true;
            material.opacity = meshOption.meshOpacity;
        }

        if (meshOption?.onTop) {
            material.depthTest = false;
            material.depthWrite = false;
        }
    }

    static createFaceGeometry(data: FaceMeshData, meshOption?: MeshOption) {
        const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        const material = ThreeGeometryFactory.createMeshMaterial(meshOption);
        ThreeGeometryFactory.setColor(buff, data, material);

        const mesh = new Mesh(buff, material);
        if (meshOption?.onTop) {
            mesh.renderOrder = TopRenderOrder;
        }
        return mesh;
    }

    static createMeshMaterial(meshOption?: MeshOption) {
        const material = new MeshLambertMaterial({ side: DoubleSide });
        ThreeGeometryFactory.setMaterialParameter(material, meshOption);
        return material;
    }

    static setColor(
        buffer: BufferGeometry,
        data: { color?: number | number[] },
        material: MeshLambertMaterial | PointsMaterial | LineMaterial | LineBasicMaterial,
    ) {
        if (typeof data.color === "number") {
            material.color.set(data.color);
        } else if (Array.isArray(data.color)) {
            material.vertexColors = true;
            buffer.setAttribute("color", new Float32BufferAttribute(data.color, 3));
        }
    }

    static createFaceBufferGeometry(data: MeshLike) {
        const buff = new BufferGeometry();
        buff.setAttribute("position", new BufferAttribute(data.position, 3));
        buff.setAttribute("normal", new BufferAttribute(data.normal, 3));
        buff.setAttribute("uv", new BufferAttribute(data.uv, 2));
        if (data.index && data.index.length > 0) buff.setIndex(new BufferAttribute(data.index, 1));
        buff.computeBoundingBox();
        return buff;
    }

    static createEdgeGeometry(data: EdgeMeshData, meshOption?: MeshOption) {
        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        const material = ThreeGeometryFactory.createEdgeMaterial(data, meshOption);
        ThreeGeometryFactory.setColor(buff, data, material);
        const segment = new LineSegments2(buff, material);
        if (data.lineType === "dash") {
            segment.computeLineDistances();
        }
        if (meshOption?.onTop) {
            segment.renderOrder = TopRenderOrder;
        }
        return segment;
    }

    static createEdgeMaterial(data: EdgeMeshData, meshOption?: MeshOption) {
        const material = new LineMaterial({
            linewidth: data.lineWidth ?? 1,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        });
        if (data.lineType === "dash") {
            material.dashed = true;
            material.dashScale = 1;
            material.dashSize = 30;
            material.gapSize = 30;
            material.defines["USE_DASH"] = "";
        }

        ThreeGeometryFactory.setMaterialParameter(material, meshOption);
        return material;
    }

    static createEdgeBufferGeometry(data: EdgeMeshData) {
        const buff = new LineSegmentsGeometry();
        buff.setPositions(data.position);
        buff.computeBoundingBox();
        return buff;
    }

    static createVertexBufferGeometry(data: VertexMeshData) {
        const buff = new BufferGeometry();
        buff.setAttribute("position", new BufferAttribute(data.position, 3));
        buff.computeBoundingBox();
        return buff;
    }
}
