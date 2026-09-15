// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes } from "@chili3d/core";
import { Box3, Mesh, MeshBasicMaterial, Points } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { defaultEdgeMaterial, edgeMaterialOfWidth } from "../src/materials";
import { ThreeGeometry } from "../src/threeGeometry";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import { createTestGeometryNode, createThreeMockVisualContext } from "./mocks";

describe("ThreeGeometry", () => {
    let context: ThreeVisualContext;

    beforeEach(() => {
        context = createThreeMockVisualContext();
    });

    describe("construction", () => {
        test("creates with faces and edges", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            expect(geo).toBeInstanceOf(ThreeGeometry);
            expect(geo.visible).toBe(true);
        });

        test("creates when only edges are present", () => {
            const node = createTestGeometryNode({ hasFaces: false, hasVertexs: false });
            const geo = new ThreeGeometry(node, context);
            expect(geo.faces()).toBeUndefined();
            expect(geo.edges()).toBeInstanceOf(LineSegments2);
            expect(geo.vertexs()).toBeUndefined();
        });

        test("creates when only faces are present", () => {
            const node = createTestGeometryNode({ hasEdges: false, hasVertexs: false });
            const geo = new ThreeGeometry(node, context);
            expect(geo.faces()).toBeInstanceOf(Mesh);
            expect(geo.edges()).toBeUndefined();
            expect(geo.vertexs()).toBeUndefined();
        });

        test("creates when only vertexs are present", () => {
            const node = createTestGeometryNode({ hasFaces: false, hasEdges: false });
            const geo = new ThreeGeometry(node, context);
            expect(geo.faces()).toBeUndefined();
            expect(geo.edges()).toBeUndefined();
            expect(geo.vertexs()).toBeInstanceOf(Points);
        });
    });

    describe("faces / edges / vertexs accessors", () => {
        test("faces returns the face mesh", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            expect(geo.faces()).toBeInstanceOf(Mesh);
        });

        test("edges returns the edges mesh", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            expect(geo.edges()).toBeInstanceOf(LineSegments2);
        });

        test("vertexs returns the vertex points", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            expect(geo.vertexs()).toBeInstanceOf(Points);
        });

        test("faces returns undefined when no faces present", () => {
            const node = createTestGeometryNode({ hasFaces: false });
            const geo = new ThreeGeometry(node, context);
            expect(geo.faces()).toBeUndefined();
        });

        test("edges returns undefined when no edges present", () => {
            const node = createTestGeometryNode({ hasEdges: false });
            const geo = new ThreeGeometry(node, context);
            expect(geo.edges()).toBeUndefined();
        });
    });

    describe("boundingBox / box", () => {
        test("boundingBox returns object with min/max from faces", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const box = geo.boundingBox();
            // face positions span (0,0,0)..(1,1,0) in createTestGeometryNode
            expect(box?.min.x).toBe(0);
            expect(box?.min.y).toBe(0);
            expect(box?.min.z).toBe(0);
            expect(box?.max.x).toBe(1);
            expect(box?.max.y).toBe(1);
            expect(box?.max.z).toBe(0);
        });

        test("box returns the Three.js bounding box", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const box = geo.box();
            expect(box).toBeInstanceOf(Box3);
            expect(box?.isEmpty()).toBe(false);
        });
    });

    describe("changeFaceMaterial", () => {
        test("changeFaceMaterial updates face material", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const newMat = new MeshBasicMaterial({ color: 0xff00ff });
            geo.changeFaceMaterial(newMat);
            expect(geo.faces()?.material).toBe(newMat);
        });

        test("changeFaceMaterial is a no-op when no faces present", () => {
            const node = createTestGeometryNode({ hasFaces: false });
            const geo = new ThreeGeometry(node, context);
            geo.changeFaceMaterial(new MeshBasicMaterial());
            expect(geo.faces()).toBeUndefined();
        });
    });

    describe("set temporary materials", () => {
        test("setFacesMateiralTemperary replaces the face material", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const mat = new MeshBasicMaterial({ color: 0xaa00aa });
            geo.setFacesMateiralTemperary(mat as any);
            expect(geo.faces()?.material).toBe(mat);
        });

        test("setEdgesMateiralTemperary replaces the edge material", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const material = { isLineMaterial: true } as any;
            geo.setEdgesMateiralTemperary(material);
            expect(geo.edges()?.material).toBe(material);
        });

        test("removeTemperaryMaterial resets to defaults", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const originalFaceMat = geo.faces()?.material;

            const tempFaceMat = new MeshBasicMaterial({ color: 0xaa00aa });
            geo.setFacesMateiralTemperary(tempFaceMat as any);
            const tempEdgeMat = { isLineMaterial: true } as any;
            geo.setEdgesMateiralTemperary(tempEdgeMat);
            expect(geo.faces()?.material).toBe(tempFaceMat);
            expect(geo.edges()?.material).toBe(tempEdgeMat);

            geo.removeTemperaryMaterial();
            expect(geo.faces()?.material).toBe(originalFaceMat);
            expect(geo.edges()?.material).toBe(defaultEdgeMaterial);
        });

        test("edges use a lineWidth-matched material and restore to it", () => {
            const node = createTestGeometryNode({ edgeLineWidth: 2 });
            const geo = new ThreeGeometry(node, context);
            const wideMaterial = edgeMaterialOfWidth(2);

            expect(geo.edges()?.material).toBe(wideMaterial);
            expect(geo.edges()?.material).not.toBe(defaultEdgeMaterial);

            geo.setEdgesMateiralTemperary({ isLineMaterial: true } as any);
            geo.removeTemperaryMaterial();
            expect(geo.edges()?.material).toBe(wideMaterial);
        });
    });

    describe("subShapeVisual / wholeVisual", () => {
        test("wholeVisual returns array with faces, edges, vertexs", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const visuals = geo.wholeVisual();
            expect(visuals.length).toBe(3); // faces + edges + vertexs
        });

        test("wholeVisual filters out undefined parts", () => {
            const node = createTestGeometryNode({ hasVertexs: false });
            const geo = new ThreeGeometry(node, context);
            const visuals = geo.wholeVisual();
            expect(visuals.length).toBe(2); // faces + edges
        });

        test("subShapeVisual with whole shape type returns all parts", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const shapes = geo.subShapeVisual(ShapeTypes.shape);
            expect(shapes.length).toBe(3);
        });

        test("subShapeVisual with face type returns faces", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            // ShapeTypes.face = 0b10000 = 16
            const shapes = geo.subShapeVisual(ShapeTypes.face);
            expect(shapes.length).toBe(1);
        });

        test("subShapeVisual with edge type returns edges", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            // ShapeTypes.edge = 0b1000000 = 64
            const shapes = geo.subShapeVisual(ShapeTypes.edge);
            expect(shapes.length).toBe(1);
        });

        test("subShapeVisual with wire type returns edges too", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const shapes = geo.subShapeVisual(ShapeTypes.wire);
            expect(shapes.length).toBe(1);
        });
    });

    describe("getSubShapeAndIndex", () => {
        test("getSubShapeAndIndex finds face", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const result = geo.getSubShapeAndIndex("face", 0);
            expect(result.subShape?.id).toBe("f1");
            expect(result.shape).toBe(result.subShape);
            expect(result.index).toBe(0);
        });

        test("getSubShapeAndIndex finds edge", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const result = geo.getSubShapeAndIndex("edge", 0);
            expect(result.subShape?.id).toBe("e1");
            expect(result.shape).toBe(result.subShape);
            expect(result.index).toBe(0);
        });

        test("getSubShapeAndIndex finds vertex", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const result = geo.getSubShapeAndIndex("vertex", 0);
            expect(result.subShape?.id).toBe("v1");
            expect(result.shape).toBe(result.subShape);
            expect(result.index).toBe(0);
        });

        test("getSubShapeAndIndex returns empty when no edge range", () => {
            const node = createTestGeometryNode({ hasEdges: false });
            const geo = new ThreeGeometry(node, context);
            const result = geo.getSubShapeAndIndex("edge", 0);
            expect(result.shape).toBeUndefined();
        });
    });

    describe("setRenderOnTop", () => {
        test("swaps to depth-test-free transparent clones with top render order", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            geo.setRenderOnTop(true);

            const edgeMaterial = geo.edges()!.material;
            expect(edgeMaterial).not.toBe(defaultEdgeMaterial);
            expect((edgeMaterial as any).depthTest).toBe(false);
            expect((edgeMaterial as any).depthWrite).toBe(false);
            // body materials are always transparent and render after opaque objects;
            // on-top materials must be transparent too, or bodies still overdraw them
            expect((edgeMaterial as any).transparent).toBe(true);
            expect(geo.edges()!.renderOrder).toBe(999);
            expect((geo.vertexs()!.material as any).depthTest).toBe(false);
            // the shared default materials stay untouched
            expect(defaultEdgeMaterial.depthTest).toBe(true);
            expect(defaultEdgeMaterial.transparent).toBe(false);
        });

        test("meshes rebuilt while on top keep the on-top material", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            geo.setRenderOnTop(true);

            node._notify("shape");

            expect((geo.edges()!.material as any).depthTest).toBe(false);
            expect(geo.edges()!.renderOrder).toBe(999);
        });

        test("temporary materials and their removal keep the on-top state", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            geo.setRenderOnTop(true);

            const tempEdgeMat = { isLineMaterial: true } as any;
            geo.setEdgesMateiralTemperary(tempEdgeMat);
            expect(geo.edges()!.material).toBe(tempEdgeMat);

            geo.removeTemperaryMaterial();
            const restored = geo.edges()!.material;
            expect(restored).not.toBe(defaultEdgeMaterial);
            expect((restored as any).depthTest).toBe(false);
            expect((restored as any).transparent).toBe(true);
            expect(geo.edges()!.renderOrder).toBe(999);
        });

        test("restores default materials and render order when turned off", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const faceMaterial = geo.faces()!.material;
            geo.setRenderOnTop(true);
            geo.setRenderOnTop(false);

            expect(geo.edges()!.material).toBe(defaultEdgeMaterial);
            expect(geo.edges()!.renderOrder).toBe(0);
            expect(geo.faces()!.material).toBe(faceMaterial);
            expect(geo.faces()!.renderOrder).toBe(0);
        });
    });

    describe("dispose", () => {
        test("dispose removes all sub-meshes", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            expect(geo.children.length).toBe(3);

            geo.dispose();
            expect(geo.children.length).toBe(0);
        });
    });

    describe("property change handler", () => {
        test("materialId change updates face material", () => {
            const node = createTestGeometryNode();
            const geo = new ThreeGeometry(node, context);
            const originalFaceMat = geo.faces()?.material;

            node._notify("materialId");
            // The mock context returns a new material instance per getMaterial call
            expect(geo.faces()?.material).not.toBe(originalFaceMat);
        });
    });
});
