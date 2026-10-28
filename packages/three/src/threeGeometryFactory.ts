// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData, MeshLike, MeshOption, VertexMeshData } from "@chili3d/core";
import {
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    LineBasicMaterial,
    type Material,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    Points,
    PointsMaterial,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

export const TopRenderOrder = 999;

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
        material: MeshLambertMaterial | MeshBasicMaterial | PointsMaterial | LineMaterial | LineBasicMaterial,
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
            // body face materials are always transparent (threeHelper), so they render in
            // the transparent pass after all opaque objects; on-top materials must join
            // that pass for renderOrder to lift them above occluding bodies
            material.transparent = true;
        }
    }

    /** Depth-test-free clone of an existing material, for rendering an object above everything else. */
    static createOnTopMaterial(material: Material): Material {
        const cloned = material.clone();
        cloned.depthTest = false;
        cloned.depthWrite = false;
        cloned.transparent = true;
        return cloned;
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

    /**
     * The face material of a mesh. `unlit` swaps the lit material for one that shows the colour it
     * was given — see `MeshOption.unlit` for which overlays need that.
     */
    static createMeshMaterial(meshOption?: MeshOption) {
        const material = meshOption?.unlit
            ? new MeshBasicMaterial({ side: DoubleSide })
            : new MeshLambertMaterial({ side: DoubleSide });
        ThreeGeometryFactory.setMaterialParameter(material, meshOption);
        return material;
    }

    /**
     * Applies a mesh's colour to the geometry and material it was built with. A single colour
     * tints the material; an array is per-vertex and goes onto the geometry instead —
     * `LineSegments2` keeps those on its instanced start/end attributes (`setColors`), while
     * faces and points take a plain `color` attribute.
     *
     * The material is whitened for the array case because the vertex colour is *multiplied* by
     * the material's own: a caller that cloned a shared per-width material would otherwise
     * inherit whatever tint it carried, and the light theme's near-black `defaultEdgeColor`
     * would turn a sketch's blue into almost nothing.
     */
    static setColor(
        buffer: BufferGeometry,
        data: { color?: number | number[] },
        material: MeshLambertMaterial | MeshBasicMaterial | PointsMaterial | LineMaterial | LineBasicMaterial,
    ) {
        if (typeof data.color === "number") {
            material.color.set(data.color);
        } else if (Array.isArray(data.color)) {
            material.vertexColors = true;
            material.color.set(0xffffff);
            if (buffer instanceof LineSegmentsGeometry) {
                buffer.setColors(data.color);
            } else {
                buffer.setAttribute("color", new Float32BufferAttribute(data.color, 3));
            }
        }
    }

    static createFaceBufferGeometry(data: MeshLike) {
        const { position, index } = ThreeGeometryFactory.validFaceGeometry(data);
        const buff = new BufferGeometry();
        buff.setAttribute("position", new BufferAttribute(position, 3));
        buff.setAttribute("normal", new BufferAttribute(data.normal, 3));
        buff.setAttribute("uv", new BufferAttribute(data.uv, 2));
        if (index.length > 0) buff.setIndex(new BufferAttribute(index, 1));
        buff.computeBoundingBox();
        return buff;
    }

    private static validFaceGeometry(data: MeshLike) {
        const indexed = data.index.length > 0;
        const position = ThreeGeometryFactory.validPrimitivePositions(
            data.position,
            indexed ? 1 : 3,
        ) as Float32Array;
        if (!indexed || position === data.position || position.length === 0) {
            return { position, index: position.length === 0 ? new Uint32Array() : data.index };
        }

        let fallback = 0;
        while (!ThreeGeometryFactory.isFinitePoint(data.position, fallback)) fallback += 3;
        let index: Uint32Array | undefined;
        for (let i = 0; i < data.index.length; i += 3) {
            const a = data.index[i] * 3;
            const b = data.index[i + 1] * 3;
            const c = data.index[i + 2] * 3;
            if (
                ThreeGeometryFactory.isFinitePoint(data.position, a) &&
                ThreeGeometryFactory.isFinitePoint(data.position, b) &&
                ThreeGeometryFactory.isFinitePoint(data.position, c)
            ) {
                continue;
            }
            index ??= new Uint32Array(data.index);
            index[i] = index[i + 1] = index[i + 2] = fallback / 3;
        }
        return { position, index: index ?? data.index };
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
        ThreeGeometryFactory.setLineSegmentsPositions(buff, data.position);
        buff.computeBoundingBox();
        return buff;
    }

    static setLineSegmentsPositions(geometry: LineSegmentsGeometry, positions: number[] | Float32Array) {
        geometry.setPositions(ThreeGeometryFactory.validPrimitivePositions(positions, 2));
    }

    /** Degenerate replacements keep primitive indices aligned with the source mesh for picking. */
    private static validPrimitivePositions(positions: number[] | Float32Array, pointsPerPrimitive: number) {
        let fallback = -1;
        let hasInvalidPoint = false;
        for (let i = 0; i < positions.length; i += 3) {
            if (ThreeGeometryFactory.isFinitePoint(positions, i)) {
                if (fallback < 0) fallback = i;
            } else {
                hasInvalidPoint = true;
            }
        }
        if (!hasInvalidPoint) return positions;
        if (fallback < 0) return new Float32Array();

        const result = new Float32Array(positions);
        const stride = pointsPerPrimitive * 3;
        for (let i = 0; i < result.length; i += stride) {
            let valid = true;
            for (let j = 0; j < stride; j += 3) {
                if (!ThreeGeometryFactory.isFinitePoint(positions, i + j)) {
                    valid = false;
                    break;
                }
            }
            if (valid) continue;
            for (let j = 0; j < stride && i + j < result.length; j++) {
                result[i + j] = positions[fallback + (j % 3)];
            }
        }
        return result;
    }

    private static isFinitePoint(positions: number[] | Float32Array, offset: number) {
        return (
            Number.isFinite(positions[offset]) &&
            Number.isFinite(positions[offset + 1]) &&
            Number.isFinite(positions[offset + 2])
        );
    }

    static createVertexBufferGeometry(data: VertexMeshData) {
        const buff = new BufferGeometry();
        const position = ThreeGeometryFactory.validPrimitivePositions(data.position, 1) as Float32Array;
        buff.setAttribute("position", new BufferAttribute(position, 3));
        buff.computeBoundingBox();
        return buff;
    }
}
