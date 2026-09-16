// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, ShapeTypes, XYZ } from "@chili3d/core";
import type { OccShapeConverter } from "../src/converter";
import type { OccTrimmedCurve } from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace } from "../src/shape";
import { createBox, createSphere, createTestConverter, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

// The Release WASM build disables C++ exception catching, so any OCCT raise aborts the
// module. These tests pin the preventive guards in the C++ query layer for degenerate
// geometry: zero-length edges, geometry-less empty compounds, and surface-less faces.
let factory: ShapeFactory;
let converter: OccShapeConverter;

beforeEach(() => {
    factory = createTestFactory();
    converter = createTestConverter();
});

// A full sphere has a degenerate edge at each pole (zero length, no 3D curve).
function degenerateEdgeOf(shape: IShape): OccEdge {
    const edges = shape.findSubShapes(ShapeTypes.edge) as OccEdge[];
    const degenerate = edges.find((e) => e.length() < 1e-7);
    expect(degenerate).toBeDefined();
    return degenerate!;
}

describe("degenerate edge guards", () => {
    test("curve throws a catchable JS error instead of aborting", () => {
        const edge = degenerateEdgeOf(createSphere(factory, XYZ.zero, 10));
        expect(() => edge.curve).toThrow("degenerate edge");
    });

    test("trim returns undefined", () => {
        const edge = degenerateEdgeOf(createSphere(factory, XYZ.zero, 10));
        expect(edge.trim(0, 1)).toBeUndefined();
    });

    test("offset returns an error Result", () => {
        const edge = degenerateEdgeOf(createSphere(factory, XYZ.zero, 10));
        expect(edge.offset(5, XYZ.unitX).isOk).toBe(false);
    });

    test("parameter and point queries do not abort", () => {
        const edge = degenerateEdgeOf(createSphere(factory, XYZ.zero, 10));
        const first = edge.firstParameter();
        const last = edge.lastParameter();
        expect(Number.isFinite(first)).toBe(true);
        expect(Number.isFinite(last)).toBe(true);
        // The pole edge evaluates to the pole on the sphere of radius 10 around the origin.
        const pole = edge.pointAt(first);
        expect(Math.hypot(pole.x, pole.y, pole.z)).toBeCloseTo(10, 6);
    });

    test("vertex queries return the pole point", () => {
        const edge = degenerateEdgeOf(createSphere(factory, XYZ.zero, 10));
        const [start, end] = edge.ends();
        expect(start.isEqualTo(end)).toBe(true);
        expect(Math.hypot(start.x, start.y, start.z)).toBeCloseTo(10, 6);
    });

    test("meshing a shape with degenerate edges does not abort", () => {
        const sphere = createSphere(factory, XYZ.zero, 10);
        const mesh = sphere.mesh;
        expect(mesh.faces!.position.length).toBeGreaterThan(0);
        expect(sphere.edgesMeshPosition().position.length).toBeGreaterThan(0);
    });
});

describe("zero-length curve guards", () => {
    test("uniform abscissa queries return empty arrays", () => {
        const zeroEdge = unwrapOk(factory.bezier([XYZ.zero, XYZ.zero, XYZ.zero])) as OccEdge;
        expect(zeroEdge.length()).toBeCloseTo(0, 9);
        expect(zeroEdge.curve.uniformAbscissaByLength(1)).toEqual([]);
        expect(zeroEdge.curve.uniformAbscissaByCount(4)).toEqual([]);
        // Fewer than 2 requested points raises Standard_ConstructionError in OCCT.
        expect(zeroEdge.curve.uniformAbscissaByCount(0)).toEqual([]);
    });
});

describe("curve trim guards", () => {
    // Geom_TrimmedCurve raises Standard_ConstructionError on an empty parameter window or
    // on a window outside a non-periodic basis curve's range; with exception catching
    // disabled the raise would abort the module, so Curve::trim returns a null handle.

    test("equal parameters return a null handle for a line and a circle", () => {
        const line = wasm.Curve.makeLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
        const lineTrim = wasm.Curve.trim(line.get(), 1, 1);
        expect(lineTrim.isNull()).toBe(true);

        const circle = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 10)) as OccEdge;
        const circleTrim = wasm.Curve.trim((circle.curve as OccTrimmedCurve).curve, 1, 1);
        expect(circleTrim.isNull()).toBe(true);

        line.delete();
        lineTrim.delete();
        circleTrim.delete();
    });

    test("a null curve returns a null handle", () => {
        const trimmed = wasm.Curve.trim(null, 0, 1);
        expect(trimmed.isNull()).toBe(true);
        trimmed.delete();
    });

    test("a window outside a non-periodic curve's range returns a null handle", () => {
        // A degree-1 bezier from the origin to (10, 0, 0), basis range [0, 1].
        const seg = unwrapOk(factory.bezier([XYZ.zero, { x: 10, y: 0, z: 0 }])) as OccEdge;
        const curve = (seg.curve as OccTrimmedCurve).curve;

        const below = wasm.Curve.trim(curve, -0.5, 0.5);
        expect(below.isNull()).toBe(true);
        const above = wasm.Curve.trim(curve, 0.5, 2);
        expect(above.isNull()).toBe(true);
        // Within Precision::PConfusion (1e-9 in OCCT v8) of the range the window is
        // still accepted.
        const withinTolerance = wasm.Curve.trim(curve, -1e-12, 1 + 1e-12);
        expect(withinTolerance.isNull()).toBe(false);

        below.delete();
        above.delete();
        withinTolerance.delete();
    });

    test("a periodic curve still normalizes windows beyond its period", () => {
        const circle = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 10)) as OccEdge;
        const shifted = wasm.Curve.trim(
            (circle.curve as OccTrimmedCurve).curve,
            4 * Math.PI + 0.5,
            4 * Math.PI + 1.5,
        );
        expect(shifted.isNull()).toBe(false);
        const trimmed = shifted.get();
        expect(trimmed).not.toBeNull();
        expect(trimmed!.firstParameter()).toBeCloseTo(0.5, 9);
        expect(trimmed!.lastParameter()).toBeCloseTo(1.5, 9);
        shifted.delete();
    });

    test("a valid trim still returns the right segment", () => {
        const seg = unwrapOk(factory.bezier([XYZ.zero, { x: 10, y: 0, z: 0 }])) as OccEdge;
        const trimmed = seg.curve.trim(0.25, 0.75);
        expect(trimmed).toBeDefined();
        expect(trimmed!.firstParameter()).toBeCloseTo(0.25, 9);
        expect(trimmed!.lastParameter()).toBeCloseTo(0.75, 9);
        const start = trimmed!.value(0.25);
        expect(start.x).toBeCloseTo(2.5, 9);
        expect(start.y).toBeCloseTo(0, 9);
        expect(start.z).toBeCloseTo(0, 9);
        const end = trimmed!.value(0.75);
        expect(end.x).toBeCloseTo(7.5, 9);
        expect(end.y).toBeCloseTo(0, 9);
        expect(end.z).toBeCloseTo(0, 9);
    });

    test("the OccCurve wrapper surfaces a null handle as undefined, never a poisoned curve", () => {
        // Wrapper level (ICurve.trim): the honest failure value is undefined — no
        // crash, no OccTrimmedCurve around a null pointer.
        const seg = unwrapOk(factory.bezier([XYZ.zero, { x: 10, y: 0, z: 0 }])) as OccEdge;
        // a coincident window
        expect(seg.curve.trim(0.5, 0.5)).toBeUndefined();
        // a window collapsing at exactly the curve's end (the modify.break end pick)
        expect(seg.curve.trim(seg.curve.lastParameter(), seg.curve.lastParameter())).toBeUndefined();
        // a window outside the non-periodic basis range
        expect(seg.curve.trim(-0.5, 0.5)).toBeUndefined();

        // a valid window still wraps a healthy trimmed curve
        const trimmed = seg.curve.trim(0.25, 0.75);
        expect(trimmed).toBeDefined();
        expect(trimmed!.curveType).toBe("trimmedCurve");
        expect(trimmed!.length()).toBeCloseTo(5, 6);
    });

    test("the OccEdge wrapper surfaces an empty window as undefined", () => {
        // Wrapper level (IEdge.trim): Edge::trim reports an empty window as a
        // null edge, and the wrapper surfaces that as undefined.
        const seg = unwrapOk(factory.bezier([XYZ.zero, { x: 10, y: 0, z: 0 }])) as OccEdge;
        expect(seg.trim(0.5, 0.5)).toBeUndefined();
        expect(seg.trim(0.25, 0.75)).toBeDefined();
    });

    test("setTrim throws a catchable JS error instead of aborting", () => {
        // Geom_TrimmedCurve::SetTrim raises on an empty window or on one outside a
        // non-periodic basis curve's range; with exception catching disabled the
        // raise would abort the module, so the wrapper rejects them JS-side.
        const seg = unwrapOk(factory.bezier([XYZ.zero, { x: 10, y: 0, z: 0 }])) as OccEdge;
        const curve = seg.curve as OccTrimmedCurve;
        // a coincident window
        expect(() => curve.setTrim(0.5, 0.5)).toThrow("empty parameter window");
        // a sub-tolerance window
        expect(() => curve.setTrim(0.5, 0.5 + 1e-12)).toThrow("empty parameter window");
        // a window outside the non-periodic basis range ([0, 1] here)
        expect(() => curve.setTrim(-0.5, 0.5)).toThrow("outside the basis curve's range");
        expect(() => curve.setTrim(0.5, 2)).toThrow("outside the basis curve's range");
        // a valid retrim still works after the rejected ones
        curve.setTrim(0.25, 0.75);
        expect(curve.firstParameter()).toBeCloseTo(0.25, 9);
        expect(curve.lastParameter()).toBeCloseTo(0.75, 9);
    });

    test("setTrim on a periodic basis still normalizes windows beyond its period", () => {
        const circle = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 10)) as OccEdge;
        const curve = circle.curve as OccTrimmedCurve;
        // periodic basis: no range rejection, OCCT adjusts the window into the period
        curve.setTrim(4 * Math.PI + 0.5, 4 * Math.PI + 1.5);
        expect(curve.firstParameter()).toBeCloseTo(0.5, 9);
        expect(curve.lastParameter()).toBeCloseTo(1.5, 9);
    });
});

describe("empty compound guards", () => {
    // A section of two disjoint shapes is an empty compound without any geometry.
    function emptyCompound(): IShape {
        const box = createBox(factory, 10, 10, 10);
        const far = box.transformed(Matrix4.fromTranslation(100, 0, 0));
        const empty = box.section(far);
        expect(empty.shapeType).toBe(ShapeTypes.compound);
        expect(empty.findSubShapes(ShapeTypes.face).length).toBe(0);
        return empty;
    }

    test("boundingBox returns a zero box", () => {
        const bb = emptyCompound().boundingBox();
        expect(bb.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(bb.max).toEqual({ x: 0, y: 0, z: 0 });
    });

    test("orientedBoundingBox returns a zero-size box", () => {
        const obb = emptyCompound().orientedBoundingBox();
        expect(obb.size).toEqual({ x: 0, y: 0, z: 0 });
    });

    test("volume returns 0", () => {
        expect(emptyCompound().volume()).toBeCloseTo(0, 9);
    });

    test("extremaDistance against a geometry-less shape returns -1", () => {
        const box = createBox(factory, 10, 10, 10);
        expect(box.extremaDistance(emptyCompound())).toBe(-1);
    });
});

describe("surface-less face guards", () => {
    // A face without a geometric surface, carrying only a triangulation (what
    // mesh-based imports produce). The kernel reads this BREP back as a
    // triangulation-only face whose BRep_Tool::Surface is null.
    const SURFACE_LESS_FACE_BREP = `
CASCADE Topology V3, (c) Open Cascade
Locations 0
Curve2ds 0
Curves 0
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 0
Triangulations 1
3 1 0 0 0
0 0 0 10 0 0 0 10 0
1 2 3

TShapes 1
Fa
0  1e-07 0 0
2 1

1101000
*

+1 0
`;

    function surfaceLessFace(): OccFace {
        const result = converter.convertFromBrep(SURFACE_LESS_FACE_BREP);
        expect(result.isOk).toBe(true);
        expect(result.value.shapeType).toBe(ShapeTypes.face);
        return result.value as OccFace;
    }

    test("area falls back to the triangulation", () => {
        expect(surfaceLessFace().area()).toBeCloseTo(50, 6);
    });

    test("normal returns zeros instead of dereferencing a null surface", () => {
        const [point, normal] = surfaceLessFace().normal(0.5, 0.5);
        expect(point).toEqual({ x: 0, y: 0, z: 0 });
        expect(normal).toEqual({ x: 0, y: 0, z: 0 });
    });

    test("containsPoint returns false", () => {
        expect(surfaceLessFace().containsPoint({ x: 1, y: 1, z: 0 }, true, 0.01)).toBe(false);
    });

    test("intersectLine returns undefined", () => {
        expect(surfaceLessFace().intersectLine({ x: 1, y: 1, z: -5 }, { x: 0, y: 0, z: 1 })).toBeUndefined();
    });

    test("surface throws a catchable JS error instead of dereferencing a null handle", () => {
        expect(() => surfaceLessFace().surface()).toThrow("Face.surface: face has no geometric surface");
    });

    test("outerWire throws a catchable JS error instead of wrapping a null wire", () => {
        expect(() => surfaceLessFace().outerWire()).toThrow("Face.outerWire: face has no outer wire");
    });

    test("healthy faces still return their surface and outer wire", () => {
        const face = createBox(factory, 10, 10, 10).findSubShapes(ShapeTypes.face)[0] as OccFace;
        expect(face.surface().isPlanar()).toBe(true);
        expect(face.outerWire().edgeLoop().length).toBe(4);
    });

    test("meshing emits zero UVs for triangulation without UV nodes", () => {
        // Raw wasm level: meshing the freshly imported face reuses its UV-less
        // triangulation; UVNode would raise out-of-range without the guard.
        const raw = wasm.Converter.convertFromBrep(SURFACE_LESS_FACE_BREP);
        const mesher = new wasm.Mesher(raw, 0.005, true);
        const faceMesh = mesher.mesh().faceMeshData;
        mesher.delete();
        expect(faceMesh.position.length).toBe(9);
        expect(Array.from(faceMesh.uv).every((v) => v === 0)).toBe(true);
    });
});
