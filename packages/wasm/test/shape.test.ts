// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, Line, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { MockShape } from "@chili3d/core/test-utils";
import { OccTrimmedCurve } from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import {
    type OccEdge,
    type OccFace,
    OccShape,
    type OccSolid,
    type OccVertex,
    type OccWire,
} from "../src/shape";
import { createBox, createSphere, createTestFactory, unwrapOk } from "./helpers";
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

    test("transformedMul must not apply the shape's own location twice", () => {
        // Sub-shapes can carry a non-identity location: the top face of a prism is
        // located at z=30 via its TopLoc_Location. transformedMul(identity) must
        // keep it in place, and a translation must apply exactly once.
        const rect = unwrapOk(factory.rect(Plane.XY, 10, 10));
        const face = (
            rect.shapeType === ShapeTypes.face ? rect : unwrapOk(factory.face([rect as any]))
        ) as IFace;
        const solid = unwrapOk(factory.prism(face, XYZ.unitZ.multiply(30)));
        const faces = solid.findSubShapes(ShapeTypes.face) as IFace[];
        const top = faces.reduce((a, b) => (a.boundingBox().max.z > b.boundingBox().max.z ? a : b));
        expect(top.boundingBox().max.z).toBeCloseTo(30, 6);

        const kept = top.transformedMul(Matrix4.identity());
        expect(kept.boundingBox().max.z).toBeCloseTo(30, 6);

        const shifted = top.transformedMul(Matrix4.fromTranslation(0, 0, 5));
        expect(shifted.boundingBox().max.z).toBeCloseTo(35, 6);
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
        const fake = new MockShape({ shapeType: ShapeTypes.solid });
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
        const fake = new MockShape({ shapeType: ShapeTypes.solid });
        expect(() => box.extremaDistance(fake)).toThrow("Invalid shape type");
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
        const fake = new MockShape({ shapeType: ShapeTypes.solid });
        const result = edges[0].findAncestor(ShapeTypes.face, fake);
        expect(result).toEqual([]);
    });

    test("directSubShapes returns the box shell", () => {
        const box = createBox(factory);
        const subs = box.directSubShapes();
        // A box solid has exactly one shell as its direct sub-shape
        expect(subs.length).toBe(1);
        expect(subs[0].shapeType).toBe(ShapeTypes.shell);
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
        // Partially overlapping box — the faces intersect in section curves
        const box2 = box1.transformed(Matrix4.fromTranslation(5, 5, 5));
        const section = box1.section(box2);
        expect(section.isNull()).toBe(false);
        expect(section.findSubShapes(ShapeTypes.edge).length).toBeGreaterThan(0);
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
    test("setTolerance forwards the tolerance to the kernel", () => {
        const box = createBox(factory);
        const spy = rs.spyOn(wasm.Shape, "setTolerance");
        try {
            box.setTolerance(1e-6);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0]).toBe((box as unknown as OccShape).shape);
            expect(spy.mock.calls[0][1]).toBe(1e-6);
        } finally {
            spy.mockRestore();
        }
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
    test("points of all 8 vertices span the box corners", () => {
        const verts = createBox(factory, 10, 20, 30).findSubShapes(ShapeTypes.vertex) as OccVertex[];
        expect(verts.length).toBe(8);
        const points = verts.map((v) => v.point());
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const zs = points.map((p) => p.z);
        expect(Math.min(...xs)).toBeCloseTo(0);
        expect(Math.max(...xs)).toBeCloseTo(10);
        expect(Math.min(...ys)).toBeCloseTo(0);
        expect(Math.max(...ys)).toBeCloseTo(20);
        expect(Math.min(...zs)).toBeCloseTo(0);
        expect(Math.max(...zs)).toBeCloseTo(30);
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

    test("curve returns the edge's trimmed curve", () => {
        const box = createBox(factory);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        expect(edge.curve).toBeInstanceOf(OccTrimmedCurve);
    });

    test("trim returns a shorter edge", () => {
        const box = createBox(factory, 10, 10, 10);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const curve = edge.curve;
        const mid = (curve.firstParameter() + curve.lastParameter()) / 2;
        const trimmed = edge.trim(curve.firstParameter(), mid);
        expect(trimmed).toBeDefined();
        expect(trimmed!.shapeType).toBe(ShapeTypes.edge);
    });

    test("trim extends an offset edge beyond its original range", () => {
        const line = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        const offset = unwrapOk(line.offset(5, XYZ.unitZ)) as OccEdge;
        const extended = offset.trim(-5, 15);
        expect(extended).toBeDefined();
        expect(extended!.length()).toBeCloseTo(20, 6);
    });

    test("trim returns undefined when the range exceeds the bounded basis curve", () => {
        const bezier = unwrapOk(
            factory.bezier([XYZ.zero, new XYZ({ x: 10, y: 20, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 })]),
        ) as OccEdge;
        const offset = unwrapOk(bezier.offset(5, XYZ.unitZ)) as OccEdge;
        expect(offset.trim(-1, 2)).toBeUndefined();
    });

    test("intersect with a crossing edge returns the intersection point", () => {
        const e1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        const e2 = unwrapOk(
            factory.line(new XYZ({ x: 5, y: -5, z: 0 }), new XYZ({ x: 5, y: 5, z: 0 })),
        ) as OccEdge;
        const intersections = e1.intersect(e2);
        expect(intersections.length).toBe(1);
        expect(intersections[0].point.x).toBeCloseTo(5);
        expect(intersections[0].point.y).toBeCloseTo(0);
        expect(intersections[0].parameter).toBeCloseTo(5);
    });

    test("update replaces the underlying curve geometry", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, XYZ.unitX)) as OccEdge;
        const zLine = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 0, y: 0, z: 10 }))) as OccEdge;
        edge.update(zLine.curve);
        // The wrapped shape now spans the z-line (0..10 in Z, plus tessellation padding)
        const bb = edge.boundingBox();
        expect(bb.max.z - bb.min.z).toBeCloseTo(10, 0);
    });

    test("update throws for a non-OccCurve", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, XYZ.unitX)) as OccEdge;
        expect(() => edge.update({ curveType: "line" } as any)).toThrow("Invalid curve");
    });

    test("hasContinuity / continuity between the two faces of a box edge", () => {
        const box = createBox(factory, 10, 10, 10);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const faces = edge.findAncestor(ShapeTypes.face, box) as OccFace[];
        expect(faces.length).toBe(2);
        // Box faces meet at 90° — only C0 continuous
        expect(edge.hasContinuity(faces[0], faces[1])).toBe(false);
        expect(edge.continuity(faces[0], faces[1])).toBe("c0");
    });

    test("hasContinuity / continuity throw for non-OccFace", () => {
        const box = createBox(factory, 10, 10, 10);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const faces = edge.findAncestor(ShapeTypes.face, box);
        expect(faces.length).toBe(2);
        const fake = new MockShape({ shapeType: ShapeTypes.face }) as unknown as IFace;
        expect(() => edge.hasContinuity(faces[0] as IFace, fake)).toThrow("Invalid face types");
        expect(() => edge.continuity(faces[0] as IFace, fake)).toThrow("Invalid face types");
    });

    test("startPoint / endPoint return the edge endpoints", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        const start = edge.startPoint();
        const end = edge.endPoint();
        expect(start.x).toBeCloseTo(0);
        expect(start.y).toBeCloseTo(0);
        expect(start.z).toBeCloseTo(0);
        expect(end.x).toBeCloseTo(10);
        expect(end.y).toBeCloseTo(0);
        expect(end.z).toBeCloseTo(0);
    });

    test("startPoint / endPoint match the trimmed curve endpoints", () => {
        const box = createBox(factory, 10, 20, 30);
        const edge = box.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const curveStart = edge.curve.startPoint();
        const curveEnd = edge.curve.endPoint();
        expect(edge.startPoint().isEqualTo(curveStart)).toBe(true);
        expect(edge.endPoint().isEqualTo(curveEnd)).toBe(true);
    });

    test("firstParameter / lastParameter return the parameter range", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        expect(edge.firstParameter()).toBeCloseTo(0);
        expect(edge.lastParameter()).toBeCloseTo(10);
    });

    test("pointAt returns the midpoint at the middle parameter", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        const mid = edge.pointAt((edge.firstParameter() + edge.lastParameter()) / 2);
        expect(mid.x).toBeCloseTo(5);
        expect(mid.y).toBeCloseTo(0);
        expect(mid.z).toBeCloseTo(0);
    });

    test("ends returns start and end points in one call", () => {
        const edge = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
        const [start, end] = edge.ends();
        expect(start.isEqualTo(edge.startPoint())).toBe(true);
        expect(end.isEqualTo(edge.endPoint())).toBe(true);
        expect(start.x).toBeCloseTo(0);
        expect(end.x).toBeCloseTo(10);
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

    test("offset with intersection join type creates a radius-12 circle", () => {
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 10).value;
        const wire = factory.wire([circle]).value as OccWire;
        const result = wire.offset(2, "intersection");
        expect(result.isOk).toBe(true);
        expect(result.value.shapeType).toBe(ShapeTypes.wire);
        const face = (result.value as OccWire).toFace();
        expect(face.isOk).toBe(true);
        expect((face.value as OccFace).area()).toBeCloseTo(Math.PI * 144, 3);
    });

    test("offset with tangent join type creates a radius-12 circle", () => {
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 10).value;
        const wire = factory.wire([circle]).value as OccWire;
        const result = wire.offset(2, "tangent");
        expect(result.isOk).toBe(true);
        expect(result.value.shapeType).toBe(ShapeTypes.wire);
        const face = (result.value as OccWire).toFace();
        expect(face.isOk).toBe(true);
        expect((face.value as OccFace).area()).toBeCloseTo(Math.PI * 144, 3);
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

    test("normal returns a unit axis-aligned normal for a box face", () => {
        const [, normal] = boxFaces[0].normal(0.5, 0.5);
        expect(Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z)).toBeCloseTo(1, 9);
    });

    test("intersectLine returns intersection point", () => {
        // The bottom face (z = 0, normal -Z) is hit by an upward ray from below
        const bottomFace = boxFaces.find((f) => f.normal(0.5, 0.5)[1].z === -1);
        expect(bottomFace).toBeDefined();
        const result = bottomFace!.intersectLine({ x: 1, y: 1, z: -5 }, { x: 0, y: 0, z: 1 });
        expect(result).toBeDefined();
        expect(result!.x).toBeCloseTo(1);
        expect(result!.y).toBeCloseTo(1);
        expect(result!.z).toBeCloseTo(0);
    });

    test("containsPoint distinguishes interior and exterior points", () => {
        // The bottom face (z = 0, normal -Z) spans 0..10 × 0..20
        const bottomFace = boxFaces.find((f) => f.normal(0.5, 0.5)[1].z === -1);
        expect(bottomFace).toBeDefined();
        expect(bottomFace!.containsPoint({ x: 5, y: 10, z: 0 }, false, 0.01)).toBe(true);
        expect(bottomFace!.containsPoint({ x: 50, y: 10, z: 0 }, false, 0.01)).toBe(false);
    });

    test("segmentsOfEdgeOnFace returns the pcurve domain for an edge on the face", () => {
        const box = createBox(factory, 10, 10, 10);
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const edge = face.findSubShapes(ShapeTypes.edge)[0] as OccEdge;
        const seg = face.segmentsOfEdgeOnFace(edge);
        expect(seg).toBeDefined();
        expect(seg!.start).toBeCloseTo(0, 6);
        expect(seg!.end).toBeCloseTo(10, 6);
    });

    test("segmentsOfEdgeOnFace returns undefined for a non-OccEdge", () => {
        const fake = new MockShape({ shapeType: ShapeTypes.edge }) as unknown as IEdge;
        expect(boxFaces[0].segmentsOfEdgeOnFace(fake)).toBeUndefined();
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
    test("dispose nulls out the cached mesher data", () => {
        const box = createBox(factory);
        const mesher = box.mesh;
        expect(mesher.faces).toBeDefined();
        box.dispose();
        expect(mesher.faces).toBeNull();
        expect(mesher.edges).toBeNull();
    });

    test("double dispose is idempotent", () => {
        const box = createBox(factory);
        box.dispose();
        expect(() => box.dispose()).not.toThrow();
    });
});
