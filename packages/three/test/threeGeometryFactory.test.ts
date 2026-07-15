// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FaceMeshData } from "@chili3d/core";
import { BufferGeometry, MeshLambertMaterial, PointsMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { ThreeGeometryFactory } from "../src/threeGeometryFactory";

describe("ThreeGeometryFactory", () => {
    describe("createFaceBufferGeometry", () => {
        test("sets position, normal, uv, and index attributes", () => {
            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
                index: new Uint32Array([0, 1, 2, 0, 2, 3]),
                groups: [],
                range: [],
                color: 0xff0000,
            };

            const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);

            expect(buff).toBeInstanceOf(BufferGeometry);
            expect(buff.getAttribute("position").count).toBe(4);
            expect(buff.getAttribute("normal").count).toBe(4);
            expect(buff.getAttribute("uv").count).toBe(4);
            expect(buff.index).not.toBeNull();
            expect(buff.index!.count).toBe(6);
            expect(buff.boundingBox).not.toBeNull();
        });

        test("handles data without index", () => {
            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([]),
                groups: [],
                range: [],
                color: 0x00ff00,
            };

            const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);

            expect(buff).toBeInstanceOf(BufferGeometry);
            expect(buff.index).toBeNull();
            expect(buff.boundingBox).not.toBeNull();
        });
    });

    describe("createEdgeBufferGeometry", () => {
        test("sets positions and computes bounding box", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
                color: 0xff0000,
                lineType: "solid" as const,
                range: [],
                lineWidth: 1,
            };

            const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);

            expect(buff.constructor.name).toBe("LineSegmentsGeometry");
            expect(buff.boundingBox).not.toBeNull();
        });
    });

    describe("createVertexBufferGeometry", () => {
        test("sets position attribute and computes bounding box", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 1, 1]),
                size: 3,
                color: 0x0000ff,
                range: [],
            };

            const buff = ThreeGeometryFactory.createVertexBufferGeometry(data);

            expect(buff).toBeInstanceOf(BufferGeometry);
            expect(buff.getAttribute("position").count).toBe(2);
            expect(buff.boundingBox).not.toBeNull();
        });
    });

    describe("setColor", () => {
        test("sets single color on material", () => {
            const mat = new MeshLambertMaterial();
            const buff = new BufferGeometry();

            ThreeGeometryFactory.setColor(buff, { color: 0xff0000 }, mat);

            expect(mat.color.getHex()).toBe(0xff0000);
            expect(mat.vertexColors).toBe(false);
        });

        test("sets per-vertex colors when color is an array", () => {
            const mat = new MeshLambertMaterial();
            const buff = new BufferGeometry();

            ThreeGeometryFactory.setColor(
                buff,
                {
                    color: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
                },
                mat,
            );

            expect(mat.vertexColors).toBe(true);
            const colorAttr = buff.getAttribute("color");
            expect(colorAttr.count).toBe(4);
        });

        test("sets color on PointsMaterial", () => {
            const mat = new PointsMaterial();
            const buff = new BufferGeometry();

            ThreeGeometryFactory.setColor(buff, { color: 0x0000ff }, mat);

            expect(mat.color.getHex()).toBe(0x0000ff);
        });
    });

    describe("setMaterialParameter", () => {
        test("applies lineOpacity to LineMaterial", () => {
            // Access private method through createEdgeMaterial
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0,
                lineType: "solid" as const,
                range: [],
            };
            const edgeMat = ThreeGeometryFactory.createEdgeMaterial(data, {
                lineOpacity: 0.5,
            });
            expect(edgeMat.transparent).toBe(true);
            expect(edgeMat.opacity).toBeCloseTo(0.5);
        });

        test("applies vertexOpacity to PointsMaterial", () => {
            const mat = ThreeGeometryFactory.createVertexMaterial(
                { position: new Float32Array([]), size: 3, color: 0, range: [] },
                { vertexOpacity: 0.3 },
            );
            expect(mat.transparent).toBe(true);
            expect(mat.opacity).toBeCloseTo(0.3);
        });

        test("applies meshOpacity to MeshLambertMaterial", () => {
            // Test via createMeshMaterial
            const mat = ThreeGeometryFactory.createMeshMaterial({
                meshOpacity: 0.7,
            });
            expect(mat.transparent).toBe(true);
            expect(mat.opacity).toBeCloseTo(0.7);
        });

        test("applies onTop (depthTest=false, depthWrite=false)", () => {
            const mat = ThreeGeometryFactory.createMeshMaterial({
                onTop: true,
            });
            expect(mat.depthTest).toBe(false);
            expect(mat.depthWrite).toBe(false);
        });

        test("onTop on LineMaterial", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0,
                lineType: "solid" as const,
                range: [],
            };
            const edgeMat = ThreeGeometryFactory.createEdgeMaterial(data, {
                onTop: true,
            });
            expect(edgeMat.depthTest).toBe(false);
            expect(edgeMat.depthWrite).toBe(false);
        });
    });

    describe("createMeshMaterial", () => {
        test("returns MeshLambertMaterial with DoubleSide", () => {
            const mat = ThreeGeometryFactory.createMeshMaterial();
            expect(mat).toBeInstanceOf(MeshLambertMaterial);
            expect(mat.side).toBe(2); // DoubleSide = 2
        });
    });

    describe("createEdgeMaterial", () => {
        test("returns LineMaterial with default linewidth", () => {
            const data = {
                position: new Float32Array([]),
                color: 0,
                lineType: "solid" as const,
                range: [],
            };
            const mat = ThreeGeometryFactory.createEdgeMaterial(data);
            expect(mat).toBeInstanceOf(LineMaterial);
            expect(mat.linewidth).toBe(1);
            expect(mat.polygonOffset).toBe(true);
        });

        test("applies custom lineWidth from data", () => {
            const data = {
                position: new Float32Array([]),
                color: 0,
                lineType: "solid" as const,
                range: [],
                lineWidth: 5,
            };
            const mat = ThreeGeometryFactory.createEdgeMaterial(data);
            expect(mat.linewidth).toBe(5);
        });

        test("dash lineType enables dash properties", () => {
            const data = {
                position: new Float32Array([]),
                color: 0,
                lineType: "dash" as const,
                range: [],
            };
            const mat = ThreeGeometryFactory.createEdgeMaterial(data);
            expect(mat.dashed).toBe(true);
            expect(mat.dashScale).toBe(1);
            expect(mat.dashSize).toBe(30);
            expect(mat.gapSize).toBe(30);
        });
    });

    describe("createVertexMaterial", () => {
        test("returns PointsMaterial with correct size", () => {
            const data = {
                position: new Float32Array([]),
                size: 5,
                color: 0,
                range: [],
            };
            const mat = ThreeGeometryFactory.createVertexMaterial(data);
            expect(mat).toBeInstanceOf(PointsMaterial);
            expect(mat.size).toBe(5);
            expect(mat.sizeAttenuation).toBe(false);
        });
    });

    describe("createFaceGeometry", () => {
        test("returns Mesh with geometry and material", () => {
            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([]),
                groups: [],
                range: [],
                color: 0xff0000,
            };
            const mesh = ThreeGeometryFactory.createFaceGeometry(data);
            expect(mesh).toBeDefined();
            expect(mesh.geometry).toBeDefined();
            expect(mesh.material).toBeInstanceOf(MeshLambertMaterial);
        });

        test("onTop sets renderOrder", () => {
            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([]),
                groups: [],
                range: [],
                color: 0,
            };
            const mesh = ThreeGeometryFactory.createFaceGeometry(data, { onTop: true });
            expect(mesh.renderOrder).toBe(999);
        });
    });

    describe("createEdgeGeometry", () => {
        test("returns LineSegments2 with geometry and material", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0xff0000,
                lineType: "solid" as const,
                range: [],
            };
            const segment = ThreeGeometryFactory.createEdgeGeometry(data);
            expect(segment).toBeInstanceOf(LineSegments2);
            expect(segment.geometry).toBeDefined();
            expect(segment.material).toBeInstanceOf(LineMaterial);
        });

        test("dash lineType triggers computeLineDistances", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0xff0000,
                lineType: "dash" as const,
                range: [],
            };
            const segment = ThreeGeometryFactory.createEdgeGeometry(data);
            expect(segment).toBeInstanceOf(LineSegments2);
            expect(segment.material).toBeInstanceOf(LineMaterial);
            expect((segment.material as LineMaterial).dashed).toBe(true);
        });

        test("onTop sets renderOrder", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0,
                lineType: "solid" as const,
                range: [],
            };
            const segment = ThreeGeometryFactory.createEdgeGeometry(data, { onTop: true });
            expect(segment.renderOrder).toBe(999);
        });
    });

    describe("createVertexGeometry", () => {
        test("returns Points with geometry and material", () => {
            const data = {
                position: new Float32Array([0, 0, 0, 1, 1, 1]),
                size: 3,
                color: 0x0000ff,
                range: [],
            };
            const points = ThreeGeometryFactory.createVertexGeometry(data);
            expect(points).toBeDefined();
            expect(points.geometry).toBeDefined();
            expect(points.material).toBeInstanceOf(PointsMaterial);
        });

        test("onTop sets renderOrder", () => {
            const data = {
                position: new Float32Array([0, 0, 0]),
                size: 3,
                color: 0,
                range: [],
            };
            const points = ThreeGeometryFactory.createVertexGeometry(data, { onTop: true });
            expect(points.renderOrder).toBe(999);
        });
    });
});
