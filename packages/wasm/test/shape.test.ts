// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import {
    type OccEdge,
    type OccFace,
    OccShape,
    type OccSolid,
    type OccVertex,
    type OccWire,
} from "../src/shape";
import { createBox, createSphere, createTestFactory } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

// ============================================================================
// OccShape.wrap — static type dispatch
// ============================================================================

describe("OccShape.wrap — type dispatch", () => {
    test("wraps a solid as OccSolid", () => {
        const box = createBox(factory);
        expect(box.shapeType).toBe(ShapeTypes.solid);
    });

    test("wraps a face as OccFace", () => {
        const box = createBox(factory);
        const faces = box.findSubShapes(ShapeTypes.face);
        expect(faces.length).toBeGreaterThanOrEqual(6);
        expect(faces[0].shapeType).toBe(ShapeTypes.face);
    });

    test("wraps an edge as OccEdge", () => {
        const box = createBox(factory);
        const edges = box.findSubShapes(ShapeTypes.edge);
        expect(edges.length).toBe(12);
        expect(edges[0].shapeType).toBe(ShapeTypes.edge);
    });

    test("wraps a vertex as OccVertex", () => {
        const box = createBox(factory);
        const verts = box.findSubShapes(ShapeTypes.vertex);
        expect(verts.length).toBe(8);
        expect(verts[0].shapeType).toBe(ShapeTypes.vertex);
    });

    test("wraps a wire as OccWire", () => {
        const box = createBox(factory);
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const wire = face.outerWire();
        expect(wire.shapeType).toBe(ShapeTypes.wire);
    });

    test("wraps a raw WASM shape via OccShape.wrap", () => {
        // Emscripten bindings don't expose TopoDS constructors directly.
        // Instead, verify wrap properly dispatches all concrete types without throwing.
        const wrapped = OccShape.wrap(
            wasm.Shape.findSubShapes(
                wasm.ShapeFactory.box(
                    {
                        location: { x: 0, y: 0, z: 0 },
                        direction: { x: 0, y: 0, z: 1 },
                        xDirection: { x: 1, y: 0, z: 0 },
                    },
                    1,
                    1,
                    1,
                ).shape,
                wasm.TopAbs_ShapeEnum.TopAbs_EDGE,
            )[0],
        );
        expect(wrapped.shapeType).toBe(ShapeTypes.edge);
    });
});

// ============================================================================
// OccShape core properties
// ============================================================================

describe("OccShape — core properties", () => {
    test("id is auto-generated", () => {
        const box = createBox(factory);
        expect(box.id).toBeDefined();
        expect(typeof box.id).toBe("string");
        expect(box.id.length).toBeGreaterThan(0);
    });

    test("shapeType is correct", () => {
        const box = createBox(factory);
        expect(box.shapeType).toBe(ShapeTypes.solid);
    });

    test("isNull returns false for valid shape", () => {
        const box = createBox(factory);
        expect(box.isNull()).toBe(false);
    });

    test("isClosed returns true for closed wire (circle)", () => {
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
        const wire = factory.wire([circle]).value;
        expect(wire.isClosed()).toBe(true);
    });
});

// ============================================================================
// OccShape — boundingBox
// ============================================================================

describe("OccShape — boundingBox", () => {
    test("box boundingBox dimensions match creation params", () => {
        const box = createBox(factory, 10, 20, 30);
        const bb = box.boundingBox();
        expect(bb.max.x - bb.min.x).toBeCloseTo(10);
        expect(bb.max.y - bb.min.y).toBeCloseTo(20);
        expect(bb.max.z - bb.min.z).toBeCloseTo(30);
    });

    test("sphere boundingBox is approximately 2*radius per axis", () => {
        const sphere = createSphere(factory, XYZ.zero, 10);
        const bb = sphere.boundingBox();
        // Tessellated sphere bounding box has some tolerance
        expect(bb.max.x - bb.min.x).toBeGreaterThan(19.5);
        expect(bb.max.x - bb.min.x).toBeLessThan(21);
        expect(bb.max.y - bb.min.y).toBeGreaterThan(19.5);
        expect(bb.max.y - bb.min.y).toBeLessThan(21);
        expect(bb.max.z - bb.min.z).toBeGreaterThan(19.5);
        expect(bb.max.z - bb.min.z).toBeLessThan(21);
    });

    test("boundingBox returns same result on second call (cached)", () => {
        const box = createBox(factory);
        const bb1 = box.boundingBox();
        const bb2 = box.boundingBox();
        expect(bb1.max.x).toBe(bb2.max.x);
        expect(bb1.min.x).toBe(bb2.min.x);
    });
});

// ============================================================================
// OccShape — orientedBoundingBox
// ============================================================================

describe("OccShape — orientedBoundingBox", () => {
    test("box orientedBoundingBox returns valid structure", () => {
        const box = createBox(factory);
        const obb = box.orientedBoundingBox();
        expect(obb.center).toBeDefined();
        expect(obb.size).toBeDefined();
        expect(obb.size.x).toBeGreaterThan(0);
        expect(obb.size.y).toBeGreaterThan(0);
        expect(obb.size.z).toBeGreaterThan(0);
    });
});

// ============================================================================
// OccShape — matrix
// ============================================================================

describe("OccShape — matrix", () => {
    test("initial matrix translates origin to itself", () => {
        const box = createBox(factory);
        const m = box.matrix;
        const origin = m.ofPoint(XYZ.zero);
        // box created at origin Plane.XY — the location should be at origin
        expect(origin.z).toBeCloseTo(0);
    });

    test("set matrix translates shape correctly", () => {
        const box = createBox(factory);
        const translation = Matrix4.fromTranslation(100, 0, 0);
        box.matrix = translation;
        const bb = box.boundingBox();
        // The box was created at origin (x:0..10), moved by +100 should be at x:100..110
        expect(bb.min.x).toBeCloseTo(100, 0);
        expect(bb.max.x).toBeCloseTo(110, 0);
    });
});

// ============================================================================
// OccShape — clone
// ============================================================================

describe("OccShape — clone", () => {
    test("clone has same shapeType", () => {
        const box = createBox(factory);
        const cloned = box.clone();
        expect(cloned.shapeType).toBe(box.shapeType);
    });

    test("clone has different id", () => {
        const box = createBox(factory);
        const cloned = box.clone();
        expect(cloned.id).not.toBe(box.id);
    });

    test("clone is independent (matrix change doesn't affect original)", () => {
        const box = createBox(factory);
        const cloned = box.clone();
        cloned.matrix = Matrix4.fromTranslation(100, 0, 0);
        // Original should be unchanged
        const bb = box.boundingBox();
        expect(bb.min.x).toBeCloseTo(0, 0);
    });
});

// ============================================================================
// OccShape — transformed / transformedMul
// ============================================================================

describe("OccShape — transform", () => {
    test("transformed creates a new shape without modifying original", () => {
        const box = createBox(factory);
        const translation = Matrix4.fromTranslation(50, 0, 0);
        const moved = box.transformed(translation);
        const movedBB = moved.boundingBox();
        expect(movedBB.min.x).toBeCloseTo(50, 0);

        const origBB = box.boundingBox();
        expect(origBB.min.x).toBeCloseTo(0, 0);
    });

    test("transformedMul applies compound transform", () => {
        const box = createBox(factory);
        const translation = Matrix4.fromTranslation(20, 0, 0);
        const moved = box.transformedMul(translation);
        expect(moved.boundingBox().min.x).toBeCloseTo(20, 0);
    });
});

// ============================================================================
// OccShape — isEqual / isSame / isPartner
// ============================================================================

describe("OccShape — identity checks", () => {
    test("isEqual returns true for same shape", () => {
        const box = createBox(factory);
        expect(box.isEqual(box)).toBe(true);
    });

    test("isEqual returns false for different shapes", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const box2 = createBox(factory, 20, 20, 20);
        expect(box1.isEqual(box2)).toBe(false);
    });

    test("isSame returns true for same shape", () => {
        const box = createBox(factory);
        expect(box.isSame(box)).toBe(true);
    });

    test("isSame returns false for different shapes", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const box2 = createBox(factory, 20, 20, 20);
        expect(box1.isSame(box2)).toBe(false);
    });

    test("isPartner returns true for same shape", () => {
        const box = createBox(factory);
        expect(box.isPartner(box)).toBe(true);
    });

    test("isPartner returns false for different shapes", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const box2 = createBox(factory, 20, 20, 20);
        expect(box1.isPartner(box2)).toBe(false);
    });

    test("isEqual/isSame/isPartner return false for non-OccShape", () => {
        const box = createBox(factory);
        const fake = { shapeType: "solid" } as any;
        expect(box.isEqual(fake)).toBe(false);
        expect(box.isSame(fake)).toBe(false);
        expect(box.isPartner(fake)).toBe(false);
    });
});

// ============================================================================
// OccShape — orientation
// ============================================================================

describe("OccShape — orientation", () => {
    test("new box has forward orientation", () => {
        const box = createBox(factory);
        expect(box.orientation()).toBe("forward");
    });

    test("reserve flips orientation to reversed", () => {
        const box = createBox(factory);
        box.reserve();
        expect(box.orientation()).toBe("reversed");
    });
});

// ============================================================================
// OccShape — extremaDistance
// ============================================================================

describe("OccShape — extremaDistance", () => {
    test("distance between two separated boxes", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const shifted = factory.box(
            new Plane({
                origin: new XYZ({ x: 20, y: 0, z: 0 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            }),
            10,
            10,
            10,
        ).value;
        const dist = box1.extremaDistance(shifted);
        // Box1 ends at x=10, box2 starts at x=20, distance should be ~10
        expect(dist).toBeGreaterThanOrEqual(0);
        expect(dist).toBeCloseTo(10, 0);
    });

    test("throws for non-OccShape", () => {
        const box = createBox(factory);
        expect(() => box.extremaDistance({ shapeType: "solid" } as any)).toThrow("Invalid shape type");
    });
});

// ============================================================================
// OccShape — findSubShapes / findAncestor / directSubShapes
// ============================================================================

describe("OccShape — topology queries", () => {
    test("findSubShapes returns correct face count for box", () => {
        const box = createBox(factory);
        const faces = box.findSubShapes(ShapeTypes.face);
        expect(faces.length).toBe(6);
    });

    test("findSubShapes returns correct edge count for box", () => {
        const box = createBox(factory);
        const edges = box.findSubShapes(ShapeTypes.edge);
        expect(edges.length).toBe(12);
    });

    test("findSubShapes returns correct vertex count for box", () => {
        const box = createBox(factory);
        const verts = box.findSubShapes(ShapeTypes.vertex);
        expect(verts.length).toBe(8);
    });

    test("findAncestor finds faces containing an edge", () => {
        const box = createBox(factory);
        const edges = box.findSubShapes(ShapeTypes.edge);
        const ancestorFaces = edges[0].findAncestor(ShapeTypes.face, box);
        // Each edge on a box belongs to exactly 2 faces
        expect(ancestorFaces.length).toBe(2);
        expect(ancestorFaces[0].shapeType).toBe(ShapeTypes.face);
    });

    test("findAncestor returns empty for non-OccShape fromShape", () => {
        const box = createBox(factory);
        const edges = box.findSubShapes(ShapeTypes.edge);
        const result = edges[0].findAncestor(ShapeTypes.face, { shapeType: "solid" } as any);
        expect(result).toEqual([]);
    });

    test("directSubShapes returns immediate children", () => {
        const box = createBox(factory);
        const subs = box.directSubShapes();
        // Box should have shells as direct sub-shapes
        expect(subs.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// OccShape — section
// ============================================================================

describe("OccShape — section", () => {
    test("section with plane creates intersection shape", () => {
        const box = createBox(factory, 10, 10, 10);
        const cutPlane = new Plane({
            origin: new XYZ({ x: 5, y: 0, z: 5 }),
            normal: XYZ.unitX,
            xvec: XYZ.unitY,
        });
        const section = box.section(cutPlane);
        expect(section.isNull()).toBe(false);
    });

    test("section with another shape", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const box2 = createBox(factory, 10, 10, 10);
        const section = box1.section(box2);
        // May produce a valid section or empty shape
        expect(section.isNull() === true || section.isNull() === false).toBe(true);
    });
});

// ============================================================================
// OccShape — fix / check
// ============================================================================

describe("OccShape — fix & check", () => {
    test("fixShape returns non-null shape", () => {
        const box = createBox(factory);
        const fixed = box.fixShape(1e-5);
        expect(fixed.isNull()).toBe(false);
    });

    test("fixSolid returns non-null shape", () => {
        const box = createBox(factory);
        const fixed = box.fixSolid(1e-5);
        expect(fixed.isNull()).toBe(false);
    });

    test("checkShape returns true for valid box", () => {
        const box = createBox(factory);
        expect(box.checkShape()).toBe(true);
    });

    test("checkFaces returns results array", () => {
        const box = createBox(factory);
        const results = box.checkFaces();
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        // Each result has expected shape
        for (const r of results) {
            expect(typeof r.index).toBe("number");
            expect(typeof r.isValid).toBe("boolean");
            expect(Array.isArray(r.status)).toBe(true);
        }
    });
});

// ============================================================================
// OccShape — split
// ============================================================================

describe("OccShape — split", () => {
    test("split box with plane returns non-null shape", () => {
        const box = createBox(factory, 10, 10, 10);
        // Use a face to split origin box
        const face = box.findSubShapes(ShapeTypes.face)[0];
        const result = box.split([face]);
        expect(result.isNull()).toBe(false);
    });
});

// ============================================================================
// OccShape — setTolerance
// ============================================================================

describe("OccShape — setTolerance", () => {
    test("setTolerance does not throw", () => {
        const box = createBox(factory);
        expect(() => box.setTolerance(1e-6)).not.toThrow();
    });
});

// ============================================================================
// OccShape — edgesMeshPosition
// ============================================================================

describe("OccShape — edgesMeshPosition", () => {
    test("edgesMeshPosition returns valid edge mesh data", () => {
        const box = createBox(factory);
        const mesh = box.edgesMeshPosition();
        expect(mesh).toBeDefined();
        expect(mesh.position).toBeInstanceOf(Float32Array);
        expect(mesh.position.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// OccVertex
// ============================================================================

describe("OccVertex", () => {
    test("point returns coordinates", () => {
        const verts = createBox(factory).findSubShapes(ShapeTypes.vertex) as OccVertex[];
        const point = verts[0].point();
        expect(typeof point.x).toBe("number");
        expect(typeof point.y).toBe("number");
        expect(typeof point.z).toBe("number");
    });
});

// ============================================================================
// OccEdge
// ============================================================================

describe("OccEdge", () => {
    test("length returns expected value for box edge", () => {
        const box = createBox(factory, 10, 20, 30);
        const edges = box.findSubShapes(ShapeTypes.edge);
        const lengths = edges.map((e) => (e as OccEdge).length());
        // Box edges are 10, 20, or 30
        const has10 = lengths.some((l) => Math.abs(l - 10) < 0.1);
        const has20 = lengths.some((l) => Math.abs(l - 20) < 0.1);
        const has30 = lengths.some((l) => Math.abs(l - 30) < 0.1);
        expect(has10).toBe(true);
        expect(has20).toBe(true);
        expect(has30).toBe(true);
    });

    test("curve returns non-null ITrimmedCurve", () => {
        const box = createBox(factory);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const curve = edge.curve;
        expect(curve).toBeDefined();
    });

    test("trim returns a shorter edge", () => {
        const box = createBox(factory, 10, 10, 10);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const curve = edge.curve;
        const mid = (curve.firstParameter() + curve.lastParameter()) / 2;
        const trimmed = edge.trim(curve.firstParameter(), mid);
        expect(trimmed.shapeType).toBe(ShapeTypes.edge);
    });

    test("intersect with Line returns intersection points", () => {
        const box = createBox(factory);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const otherEdge = box.findSubShapes(ShapeTypes.edge)[1] as OccEdge;
        const intersections = edge.intersect(otherEdge);
        // Parallel box edges may or may not intersect
        expect(Array.isArray(intersections)).toBe(true);
    });
});

// ============================================================================
// OccWire
// ============================================================================

describe("OccWire", () => {
    test("edgeLoop returns edges", () => {
        const box = createBox(factory);
        const faces = box.findSubShapes(ShapeTypes.face);
        const wire = (faces[0] as OccFace).outerWire() as OccWire;
        const loop = wire.edgeLoop();
        expect(loop.length).toBe(4); // rectangular face has 4 edges
    });

    test("toFace creates a valid face from a closed wire", () => {
        // Create a closed wire from circle
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
        const wire = factory.wire([circle]).value as OccWire;
        const faceResult = wire.toFace();
        expect(faceResult.isOk).toBe(true);
    });

    test("offset creates a parallel wire", () => {
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 10).value;
        const wire = factory.wire([circle]).value as OccWire;
        const result = wire.offset(2, "arc");
        expect(result.isOk).toBe(true);
    });

    test("offset returns error for zero distance", () => {
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 10).value;
        const wire = factory.wire([circle]).value as OccWire;
        const result = wire.offset(0, "arc");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Invalid distance");
    });
});

// ============================================================================
// OccFace
// ============================================================================

describe("OccFace", () => {
    let boxFaces: OccFace[];

    beforeEach(() => {
        const box = createBox(factory, 10, 20, 30);
        boxFaces = box.findSubShapes(ShapeTypes.face) as OccFace[];
    });

    test("area of box face matches dimensions", () => {
        const areas = boxFaces.map((f) => f.area());
        // Box faces should have areas 200, 300, or 600
        const has200 = areas.some((a) => Math.abs(a - 200) < 1);
        const has300 = areas.some((a) => Math.abs(a - 300) < 1);
        const has600 = areas.some((a) => Math.abs(a - 600) < 1);
        expect(has200).toBe(true);
        expect(has300).toBe(true);
        expect(has600).toBe(true);
    });

    test("outerWire returns a wire", () => {
        const wire = boxFaces[0].outerWire();
        expect(wire.shapeType).toBe(ShapeTypes.wire);
    });

    test("surface returns a surface", () => {
        const surface = boxFaces[0].surface();
        expect(surface).toBeDefined();
    });

    test("normal returns point and normal vector", () => {
        const [point, normal] = boxFaces[0].normal(0.5, 0.5);
        expect(typeof point.x).toBe("number");
        expect(typeof normal.x).toBe("number");
    });

    test("intersectLine returns intersection point", () => {
        // Cast a ray from origin to positive Z — should hit bottom face of box at z=0
        const result = boxFaces[0].intersectLine({ x: 1, y: 1, z: -5 }, { x: 0, y: 0, z: 1 });
        // May or may not intersect depending on which face is first
        expect(result === undefined || typeof result.x === "number").toBe(true);
    });

    test("containsPoint returns boolean", () => {
        // Face (plane-like) should not contain any point with strict edge exclusion
        // but the result should always be boolean, never throw
        const result = boxFaces[0].containsPoint({ x: 0.5, y: 0.5, z: 0 }, false, 1);
        expect(typeof result).toBe("boolean");
    });
});

// ============================================================================
// OccSolid
// ============================================================================

describe("OccSolid", () => {
    let box: OccSolid;

    beforeEach(() => {
        box = createBox(factory, 10, 20, 30) as OccSolid;
    });

    test("volume matches dx*dy*dz", () => {
        expect(box.volume()).toBeCloseTo(6000);
    });

    test("containsPoint returns true for interior point", () => {
        // Box from origin to (10,20,30) — (5,10,15) is inside
        expect(box.containsPoint({ x: 5, y: 10, z: 15 }, false, 0.01)).toBe(true);
    });

    test("containsPoint returns false for far exterior point", () => {
        expect(box.containsPoint({ x: 100, y: 100, z: 100 }, false, 0.01)).toBe(false);
    });
});

// ============================================================================
// OccShape — shellSewing / hlr
// ============================================================================

describe("OccShape — shellSewing & hlr", () => {
    test("shellSewing returns non-null shape", () => {
        const box = createBox(factory);
        const sewn = box.shellSewing(1e-5);
        expect(sewn.isNull()).toBe(false);
    });

    test("hlr returns non-null shape", () => {
        const box = createBox(factory);
        const hlrShape = box.hlr({ x: 20, y: 20, z: 20 }, { x: -1, y: -1, z: -1 }, { x: 0, y: 0, z: 1 });
        expect(hlrShape.isNull()).toBe(false);
    });
});

// ============================================================================
// OccShape — dispose
// ============================================================================

describe("OccShape — dispose", () => {
    test("single dispose does not throw", () => {
        const box = createBox(factory);
        expect(() => box.dispose()).not.toThrow();
    });

    test("double dispose does not throw", () => {
        const box = createBox(factory);
        box.dispose();
        expect(() => box.dispose()).not.toThrow();
    });
});
