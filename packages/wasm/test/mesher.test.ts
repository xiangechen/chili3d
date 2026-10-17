// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import {
    type OccFace,
    type OccShape,
    OccSubEdgeShape,
    OccSubFaceShape,
    OccSubVertexShape,
    type OccVertex,
} from "../src/shape";
import { createBox, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

// ============================================================================
// Mesher — box mesh data
// ============================================================================

describe("Mesher — box", () => {
    test("faces mesh data is populated after access", () => {
        const box = createBox(factory, 10, 20, 30);
        const faces = box.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.position).toBeInstanceOf(Float32Array);
        expect(faces!.position.length).toBeGreaterThan(0);
        expect(faces!.normal).toBeInstanceOf(Float32Array);
        expect(faces!.normal.length).toBe(faces!.position.length);
        expect(faces!.uv).toBeInstanceOf(Float32Array);
        expect(faces!.index).toBeInstanceOf(Uint32Array);
        expect(faces!.index.length).toBeGreaterThan(0);
        expect(faces!.index.length % 3).toBe(0);
        expect(faces!.range.length).toBe(6); // box has 6 faces
    });

    test("vertex mesh data covers every vertex of a solid", () => {
        const box = createBox(factory, 10, 10, 10);
        const mesh = box.mesh;
        expect(mesh.faces).toBeDefined();

        // The solid's own points, not just a lone vertex's: this is what makes a body's
        // vertices raycast-pickable (the up-to-vertex end condition).
        const vertexs = mesh.vertexs;
        expect(vertexs).toBeDefined();
        expect(vertexs!.position.length).toBe(8 * 3);
        expect(vertexs!.range.length).toBe(8);
        expect(vertexs!.range.every((g) => g.count === 1)).toBe(true);

        for (const [index, group] of vertexs!.range.entries()) {
            expect(group.start).toBe(index);
            expect(group.shape).toBeInstanceOf(OccSubVertexShape);
            const point = (group.shape as OccSubVertexShape).point();
            expect(point.x).toBeCloseTo(vertexs!.position[index * 3], 5);
            expect(point.y).toBeCloseTo(vertexs!.position[index * 3 + 1], 5);
            expect(point.z).toBeCloseTo(vertexs!.position[index * 3 + 2], 5);
        }
    });

    test("edges mesh data is populated", () => {
        const box = createBox(factory, 10, 10, 10);
        const edges = box.mesh.edges;
        expect(edges).toBeDefined();
        expect(edges!.position).toBeInstanceOf(Float32Array);
        expect(edges!.position.length).toBeGreaterThan(0);
        expect(edges!.lineType).toBe("solid");
        expect(edges!.range.length).toBe(12); // box has 12 edges
    });

    test("repeated mesh access returns same cached data", () => {
        const box = createBox(factory);
        const faces1 = box.mesh.faces;
        const faces2 = box.mesh.faces;
        expect(faces1).toBe(faces2);
    });

    test("vertex mesh data for OccVertex", () => {
        const box = createBox(factory);
        const verts = box.findSubShapes(ShapeTypes.vertex);
        const vertex = verts[0] as OccVertex;
        const mesh = vertex.mesh;
        expect(mesh.vertexs).toBeDefined();
        expect(mesh.vertexs!.position).toBeInstanceOf(Float32Array);
        expect(mesh.vertexs!.position.length).toBe(3);
    });

    test("vertex mesh data has correct range", () => {
        const box = createBox(factory);
        const verts = box.findSubShapes(ShapeTypes.vertex);
        const vertex = verts[0] as OccVertex;
        const mesh = vertex.mesh;
        expect(mesh.vertexs).toBeDefined();
        expect(mesh.vertexs!.range.length).toBeGreaterThanOrEqual(1);
        expect(mesh.vertexs!.range[0].count).toBe(1);
    });

    test("edgesMeshPosition returns standalone edge mesh", () => {
        const box = createBox(factory);
        const mesh = box.edgesMeshPosition();
        expect(mesh.position).toBeInstanceOf(Float32Array);
        expect(mesh.position.length).toBeGreaterThan(0);
        expect(mesh.lineType).toBe("solid");
    });
});

// ============================================================================
// Mesher — sphere
// ============================================================================

describe("Mesher — sphere", () => {
    test("sphere faces have triangular mesh", () => {
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 10));
        const faces = sphere.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.position.length).toBeGreaterThan(0);
        expect(faces!.index.length).toBeGreaterThan(0);
        expect(faces!.index.length % 3).toBe(0);
        // Sphere should have at least one face range
        expect(faces!.range.length).toBeGreaterThanOrEqual(1);
    });

    test("sphere edges mesh is populated", () => {
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 10));
        const edges = sphere.mesh.edges;
        expect(edges).toBeDefined();
        expect(edges!.position).toBeInstanceOf(Float32Array);
        expect(edges!.lineType).toBe("solid");
    });
});

// ============================================================================
// Mesher — cylinder
// ============================================================================

describe("Mesher — cylinder", () => {
    test("cylinder faces have UV coordinates", () => {
        const cyl = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const faces = cyl.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.uv).toBeInstanceOf(Float32Array);
        expect(faces!.uv.length).toBeGreaterThan(0);
    });

    test("cylinder has 3 faces (top, bottom, side)", () => {
        const cyl = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const faces = cyl.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.range.length).toBe(3);
    });
});

// ============================================================================
// Sub-shape mesh data
// ============================================================================

describe("Sub-shape mesh data", () => {
    let box: OccShape;

    beforeEach(() => {
        box = createBox(factory, 10, 10, 10) as unknown as OccShape;
    });

    test("OccSubFaceShape mesh derives from parent face mesh", () => {
        const faces = box.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.range.length).toBeGreaterThan(0);

        const subFace = faces!.range[0].shape as OccSubFaceShape;
        expect(subFace).toBeInstanceOf(OccSubFaceShape);
        expect(subFace.parent).toBe(box);
        expect(typeof subFace.index).toBe("number");

        const subMesh = subFace.mesh;
        expect(subMesh.faces).toBeDefined();
        expect(subMesh.faces!.position).toBeInstanceOf(Float32Array);
    });

    test("OccSubEdgeShape mesh derives from parent edge mesh", () => {
        const edges = box.mesh.edges;
        expect(edges).toBeDefined();
        expect(edges!.range.length).toBeGreaterThan(0);

        const subEdge = edges!.range[0].shape as OccSubEdgeShape;
        expect(subEdge).toBeInstanceOf(OccSubEdgeShape);
        expect(subEdge.parent).toBe(box);
        expect(typeof subEdge.index).toBe("number");

        const subMesh = subEdge.mesh;
        expect(subMesh.edges).toBeDefined();
        expect(subMesh.edges!.position).toBeInstanceOf(Float32Array);
        expect(subMesh.edges!.lineType).toBe("solid");
    });

    test("OccSubVertexShape mesh derives from parent vertex mesh", () => {
        const verts = box.findSubShapes(ShapeTypes.vertex);
        const vertex = verts[0] as OccVertex;
        const mesh = vertex.mesh;
        expect(mesh.vertexs).toBeDefined();
        expect(mesh.vertexs!.range.length).toBeGreaterThan(0);

        const subVertex = mesh.vertexs!.range[0].shape as OccSubVertexShape;
        expect(subVertex).toBeInstanceOf(OccSubVertexShape);
        expect(subVertex.parent).toBeDefined();
        expect(typeof subVertex.index).toBe("number");

        // Sub-vertex mesh should exist
        const subMesh = subVertex.mesh;
        expect(subMesh.vertexs).toBeDefined();
        expect(subMesh.vertexs!.position.length).toBe(3);
    });

    test("sub-shape id follows naming convention", () => {
        const faces = box.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.range.length).toBeGreaterThan(0);
        const subFace = faces!.range[0].shape as OccSubFaceShape;
        expect(subFace.id).toContain(`${box.id}_f`);

        const edges = box.mesh.edges;
        expect(edges).toBeDefined();
        expect(edges!.range.length).toBeGreaterThan(0);
        const subEdge = edges!.range[0].shape as OccSubEdgeShape;
        expect(subEdge.id).toContain(`${box.id}_e`);
    });
});

// ============================================================================
// Mesher — dispose
// ============================================================================

describe("Mesher — dispose", () => {
    test("dispose cleans up cached mesh data and sub-shapes", () => {
        const box = createBox(factory);
        const mesher = box.mesh;
        const faces = mesher.faces;
        expect(faces).toBeDefined();
        expect(faces!.range.length).toBeGreaterThan(0);
        expect(mesher.vertexs).toBeDefined();

        // After shape dispose, the mesher's cached data is cleaned up
        box.dispose();
        expect(mesher.faces).toBeNull();
        expect(mesher.edges).toBeNull();
        expect(mesher.vertexs).toBeNull();

        // Double dispose is safe
        expect(() => box.dispose()).not.toThrow();
    });

    test("vertexs answers null when the points were never built before the dispose", () => {
        const box = createBox(factory);
        const mesher = box.mesh;

        box.dispose();

        expect(mesher.vertexs).toBeNull();
    });
});

// ============================================================================
// Mesher — cone
// ============================================================================

describe("Mesher — cone", () => {
    test("cone faces mesh is valid", () => {
        const cone = unwrapOk(factory.cone(XYZ.unitZ, XYZ.zero, 5, 3, 20));
        const faces = cone.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.position.length).toBeGreaterThan(0);
        expect(faces!.index.length).toBeGreaterThan(0);
        // Cone has side + bottom face (top may be degenerate)
        expect(faces!.range.length).toBeGreaterThanOrEqual(1);
    });
});
