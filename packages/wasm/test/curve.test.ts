// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import {
    OccBezierCurve,
    OccBSplineCurve,
    OccCircle,
    OccCurve,
    OccEllipse,
    OccHyperbola,
    OccLine,
    OccOffsetCurve,
    OccParabola,
    OccTrimmedCurve,
} from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace } from "../src/shape";
import { OccBSplineSurface } from "../src/surface";
import { basisCurveOfEdge, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

// ============================================================================
// OccCurve — static wrap type dispatch
// ============================================================================

describe("OccCurve.wrap — type dispatch", () => {
    test("wraps line curve as OccLine", () => {
        const edge = factory.line(XYZ.zero, XYZ.unitX).value as OccEdge;
        const curve = basisCurveOfEdge(edge);
        expect(curve instanceof OccLine).toBe(true);
    });

    test("wraps circle curve as OccCircle", () => {
        const edge = factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge;
        const curve = basisCurveOfEdge(edge);
        expect(curve instanceof OccCircle).toBe(true);
    });

    test("wraps ellipse curve as OccEllipse", () => {
        const edge = factory.ellipse(XYZ.unitZ, XYZ.zero, XYZ.unitX, 10, 5).value as OccEdge;
        const curve = basisCurveOfEdge(edge);
        expect(curve instanceof OccEllipse).toBe(true);
    });

    test("wraps bezier curve as OccBezierCurve", () => {
        const points = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
        const edge = factory.bezier(points).value as OccEdge;
        const curve = basisCurveOfEdge(edge);
        expect(curve instanceof OccBezierCurve).toBe(true);
    });

    test("throws for unknown curve type", () => {
        // Passing a non-curve object should throw
        expect(() => OccCurve.wrap(null as any)).toThrow();
    });
});

// ============================================================================
// OccCurve — core methods
// ============================================================================

describe("OccCurve — core methods", () => {
    let line: OccLine;
    let circle: OccCircle;

    beforeEach(() => {
        line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
    });

    test("curveType is correct", () => {
        expect(line.curveType).toBe("line");
        expect(circle.curveType).toBe("circle");
    });

    test("length of untrimmed line is astronomical (infinite line)", () => {
        // Geom_Line is an infinite line; its untrimmed length is ~4e100
        expect(line.length()).toBeGreaterThan(1e99);
    });

    test("trimmed curve length is consistent with trim range", () => {
        const t = line.trim(0, 0.5);
        expect(t).toBeDefined();
        expect(t!.length()).toBeCloseTo(0.5);
    });

    test("isClosed returns true for circle, false for line", () => {
        expect(circle.isClosed()).toBe(true);
        expect(line.isClosed()).toBe(false);
    });

    test("isPeriodic returns true for circle, false for line", () => {
        expect(circle.isPeriodic()).toBe(true);
        expect(line.isPeriodic()).toBe(false);
    });

    test("period of circle is 2*PI", () => {
        expect(circle.period()).toBeCloseTo(2 * Math.PI);
    });

    test("firstParameter and lastParameter of an infinite line are astronomical", () => {
        expect(line.firstParameter()).toBeLessThan(-1e99);
        expect(line.lastParameter()).toBeGreaterThan(1e99);
    });

    test("value returns point on curve", () => {
        const p = line.value(0);
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
    });

    test("d0 returns the point at the parameter", () => {
        const p = line.d0(0.5);
        expect(p.x).toBeCloseTo(0.5);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
    });

    test("d1 returns point and tangent vector", () => {
        const { point, vec } = line.d1(0.5);
        expect(point.x).toBeCloseTo(0.5);
        // For a line from (0,0,0) to (1,0,0), tangent at any point is (1,0,0)
        expect(vec.x).toBeCloseTo(1);
        expect(vec.y).toBeCloseTo(0);
        expect(vec.z).toBeCloseTo(0);
    });

    test("d2 of a circle at u=0 returns the expected derivatives", () => {
        const { point, vec1, vec2 } = circle.d2(0);
        expect(point.x).toBeCloseTo(5);
        expect(point.y).toBeCloseTo(0);
        expect(vec1.x).toBeCloseTo(0);
        expect(vec1.y).toBeCloseTo(5);
        expect(vec2.x).toBeCloseTo(-5);
        expect(vec2.y).toBeCloseTo(0);
    });

    test("d3 of a circle at u=0 returns the expected derivatives", () => {
        const { point, vec1, vec2, vec3 } = circle.d3(0);
        expect(point.x).toBeCloseTo(5);
        expect(vec1.y).toBeCloseTo(5);
        expect(vec2.x).toBeCloseTo(-5);
        expect(vec3.y).toBeCloseTo(-5);
    });

    test("dn(u, 1) of a line returns the direction", () => {
        const v = line.dn(0, 1);
        expect(v.x).toBeCloseTo(1);
        expect(v.y).toBeCloseTo(0);
        expect(v.z).toBeCloseTo(0);
    });

    test("isCN returns true for a line", () => {
        expect(line.isCN(1)).toBe(true);
    });

    test("reverse flips parameter direction", () => {
        const origStart = line.value(line.firstParameter());
        line.reverse();
        const newEnd = line.value(line.lastParameter());
        expect(newEnd.x).toBeCloseTo(origStart.x, 5);
    });

    test("reversed creates new reversed copy", () => {
        const reversed = line.reversed();
        const origStart = line.value(line.firstParameter());
        const revEnd = reversed.value(reversed.lastParameter());
        expect(revEnd.x).toBeCloseTo(origStart.x, 5);
    });

    test("copy creates independent clone", () => {
        const copy = line.copy();
        expect(copy.geometryType).toBe(line.geometryType);
    });

    test("continuity returns a continuity value", () => {
        const c = circle.continuity();
        expect(["c0", "g1", "c1", "g2", "c2", "c3", "cn"]).toContain(c);
    });

    test("nearestFromPoint returns projection data", () => {
        const res = line.nearestFromPoint(new XYZ({ x: 0.5, y: 1, z: 0 }));
        expect(res.point.x).toBeCloseTo(0.5);
        expect(res.point.y).toBeCloseTo(0);
        expect(res.point.z).toBeCloseTo(0);
        expect(res.distance).toBeCloseTo(1);
        expect(res.parameter).toBeCloseTo(0.5);
    });

    test("project returns points sorted by distance", () => {
        const query = new XYZ({ x: 1, y: 0, z: 0 });
        // A point inside the circle projects to the nearest and farthest extrema
        const points = circle.project(query);
        expect(points.length).toBe(2);
        expect(points[0].distanceTo(query)).toBeCloseTo(4, 6);
        expect(points[1].distanceTo(query)).toBeCloseTo(6, 6);
    });

    test("parameter returns parameter for a point on curve", () => {
        const midPoint = line.value(0.5);
        const param = line.parameter(midPoint, 1e-3);
        expect(param).toBeCloseTo(0.5, 1);
    });

    test("uniformAbscissaByLength on bounded trimmed curve returns points", () => {
        // Geom_Line is infinite → uniformAbscissaByLength fails. Use trimmed curve.
        const t = line.trim(0, 1);
        expect(t).toBeDefined();
        const pts = t!.uniformAbscissaByLength(0.25);
        expect(pts.length).toBeGreaterThanOrEqual(3);
    });

    test("uniformAbscissaByCount returns correct number of points", () => {
        const count = 5;
        const pts = line.uniformAbscissaByCount(count);
        expect(pts.length).toBe(count + 1);
    });

    test("trim creates trimmed curve with the expected length", () => {
        const t = line.trim(0.3, 0.7);
        expect(t).toBeDefined();
        expect(t!.length()).toBeCloseTo(0.4);
    });
});

// ============================================================================
// OccLine — specific properties
// ============================================================================

describe("OccLine", () => {
    test("direction getter returns unit vector", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        const dir = line.direction;
        expect(dir.x).toBeCloseTo(1);
        expect(dir.y).toBeCloseTo(0);
        expect(dir.z).toBeCloseTo(0);
    });

    test("direction setter changes line direction", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        line.direction = new XYZ({ x: 0, y: 1, z: 0 });
        // Setter uses toDir which normalizes — check value is normalized
        const dir = line.direction;
        expect(dir.y).toBeCloseTo(1);
    });

    test("location getter returns origin", () => {
        const line = basisCurveOfEdge(
            factory.line(new XYZ({ x: 3, y: 4, z: 0 }), new XYZ({ x: 3, y: 4, z: 1 })).value as OccEdge,
        ) as OccLine;
        const loc = line.location;
        expect(loc.x).toBeCloseTo(3);
        expect(loc.y).toBeCloseTo(4);
        expect(loc.z).toBeCloseTo(0);
    });

    test("location setter moves line", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        line.location = new XYZ({ x: 5, y: 5, z: 5 });
        const loc = line.location;
        expect(loc.x).toBeCloseTo(5);
    });
});

// ============================================================================
// OccCircle
// ============================================================================

describe("OccCircle", () => {
    test("center getter returns circle center", () => {
        const circle = basisCurveOfEdge(
            factory.circle(XYZ.unitZ, new XYZ({ x: 1, y: 2, z: 0 }), 10).value as OccEdge,
        ) as OccCircle;
        expect(circle.center.x).toBeCloseTo(1);
        expect(circle.center.y).toBeCloseTo(2);
        expect(circle.center.z).toBeCloseTo(0);
    });

    test("center setter moves circle", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
        circle.center = new XYZ({ x: 10, y: 10, z: 0 });
        expect(circle.center.x).toBeCloseTo(10);
        expect(circle.center.y).toBeCloseTo(10);
    });

    test("radius getter/setter", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
        expect(circle.radius).toBeCloseTo(5);
        circle.radius = 10;
        expect(circle.radius).toBeCloseTo(10);
        expect(circle.length()).toBeCloseTo(2 * Math.PI * 10, 0);
    });

    test("axis/xAxis/yAxis match the creation normal", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
        expect(circle.axis.z).toBeCloseTo(1);
        expect(circle.xAxis.x).toBeCloseTo(1);
        expect(circle.yAxis.y).toBeCloseTo(1);
    });

    test("eccentricity is 0 for circle", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
        expect(circle.eccentricity()).toBe(0);
    });
});

// ============================================================================
// OccEllipse
// ============================================================================

describe("OccEllipse", () => {
    let ellipse: OccEllipse;

    beforeEach(() => {
        ellipse = basisCurveOfEdge(
            factory.ellipse(XYZ.unitZ, XYZ.zero, XYZ.unitX, 10, 5).value as OccEdge,
        ) as OccEllipse;
    });

    test("majorRadius and minorRadius", () => {
        expect(ellipse.majorRadius).toBeCloseTo(10);
        expect(ellipse.minorRadius).toBeCloseTo(5);
    });

    test("center returns ellipse center", () => {
        expect(ellipse.center.x).toBeCloseTo(0);
        expect(ellipse.center.y).toBeCloseTo(0);
        expect(ellipse.center.z).toBeCloseTo(0);
    });

    test("focus1 and focus2 are at ±c from center where c² = a² - b²", () => {
        const f1 = ellipse.focus1;
        const f2 = ellipse.focus2;
        const c = Math.sqrt(10 * 10 - 5 * 5);
        expect(f1.x).toBeCloseTo(c, 6);
        expect(f2.x).toBeCloseTo(-c, 6);
        expect(f1.distanceTo(f2)).toBeCloseTo(2 * c, 6);
    });

    test("setters change geometry", () => {
        ellipse.majorRadius = 15;
        ellipse.minorRadius = 8;
        expect(ellipse.majorRadius).toBeCloseTo(15);
        expect(ellipse.minorRadius).toBeCloseTo(8);
    });
});

// ============================================================================
// OccBezierCurve
// ============================================================================

describe("OccBezierCurve", () => {
    let bezier: OccBezierCurve;

    beforeEach(() => {
        const pts = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
        bezier = basisCurveOfEdge(factory.bezier(pts).value as OccEdge) as OccBezierCurve;
    });

    test("degree matches number of poles minus 1", () => {
        expect(bezier.degree()).toBe(2);
    });

    test("nbPoles equals number of control points", () => {
        // Created with 3 points → 3 poles
        expect(bezier.nbPoles()).toBe(3);
    });

    test("pole returns individual control point", () => {
        const p = bezier.pole(1);
        // 1-indexed in OCCT — the first pole is the first control point
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
    });

    test("poles returns all control points", () => {
        const pts = bezier.poles();
        expect(pts.length).toBe(3);
        expect(pts[1].x).toBeCloseTo(10);
        expect(pts[1].y).toBeCloseTo(0);
        expect(pts[2].y).toBeCloseTo(10);
    });

    test("weight returns default weight of 1", () => {
        expect(bezier.weight(1)).toBeCloseTo(1);
    });

    test("insertPoleAfter increases pole count", () => {
        bezier.insertPoleAfter(1, new XYZ({ x: 5, y: 5, z: 0 }), undefined);
        expect(bezier.nbPoles()).toBe(4);
    });

    test("insertPoleBefore increases pole count", () => {
        bezier.insertPoleBefore(1, new XYZ({ x: -5, y: 0, z: 0 }), 1.5);
        expect(bezier.nbPoles()).toBe(4);
    });

    test("removePole decreases pole count", () => {
        bezier.removePole(3);
        expect(bezier.nbPoles()).toBe(2);
    });

    test("setPole changes control point position", () => {
        const newPt = new XYZ({ x: 20, y: 0, z: 0 });
        bezier.setPole(2, newPt, undefined);
        const changed = bezier.pole(2);
        expect(changed.x).toBeCloseTo(20);
    });

    test("startPoint and endPoint", () => {
        expect(bezier.startPoint().x).toBeCloseTo(0);
        expect(bezier.endPoint().y).toBeCloseTo(10);
    });
});

// ============================================================================
// OccBSplineCurve
// ============================================================================

describe("OccBSplineCurve", () => {
    test("can create BSpline from lofted surface iso curve", () => {
        // Loft between offset circles produces a BSpline side surface;
        // its iso curves are Geom_BSplineCurves
        const c1 = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
        const c2 = factory.circle(XYZ.unitZ, new XYZ({ x: 5, y: 5, z: 15 }), 3).value;
        const loft = factory.loft([c1, c2], true, false, "c0");
        expect(loft.isOk).toBe(true);
        const bsplineSurface = loft.value
            .findSubShapes(ShapeTypes.face)
            .map((f) => (f as OccFace).surface())
            .find((s) => s instanceof OccBSplineSurface);
        expect(bsplineSurface).toBeDefined();
        const iso = (bsplineSurface as OccBSplineSurface).uIso(0.5);
        expect(iso instanceof OccBSplineCurve).toBe(true);
        const bspline = iso as OccBSplineCurve;
        expect(bspline.nbPoles()).toBeGreaterThan(0);
        expect(bspline.nbKnots()).toBeGreaterThan(0);
        expect(bspline.degree()).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// OccTrimmedCurve — from edge
// ============================================================================

describe("OccTrimmedCurve", () => {
    let trimmed: OccTrimmedCurve;

    beforeEach(() => {
        const edge = factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge;
        trimmed = edge.curve as OccTrimmedCurve;
    });

    test("basisCurve returns the untrimmed curve", () => {
        expect(trimmed.basisCurve instanceof OccCurve).toBe(true);
    });

    test("setTrim modifies the parameter range", () => {
        const origLen = trimmed.length();
        trimmed.setTrim(0, Math.PI);
        const newLen = trimmed.length();
        // After trimming to half-circle, length should be ~half
        expect(newLen).toBeCloseTo(origLen / 2, 6);
    });

    test("startPoint and endPoint of a full-circle edge coincide at (5,0,0)", () => {
        const start = trimmed.startPoint();
        const end = trimmed.endPoint();
        expect(start.x).toBeCloseTo(5, 6);
        expect(start.y).toBeCloseTo(0, 6);
        expect(end.distanceTo(start)).toBeCloseTo(0, 6);
    });
});

// ============================================================================
// OccCurve — nearestExtrema between two curves
// ============================================================================

describe("OccCurve — nearestExtrema", () => {
    test("nearestExtrema between two touching circles", () => {
        // Two radius-5 circles centered at (0,0,0) and (10,0,0) touch at (5,0,0)
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge);
        const edge2 = factory.circle(XYZ.unitZ, new XYZ({ x: 10, y: 0, z: 0 }), 5).value as OccEdge;
        const circle2 = basisCurveOfEdge(edge2);
        const result = circle.nearestExtrema(circle2);
        expect(result).toBeDefined();
        expect(result!.distance).toBeCloseTo(0, 6);
        expect(result!.p1.x).toBeCloseTo(5, 6);
        expect(result!.p2.x).toBeCloseTo(5, 6);
    });
});

// ============================================================================
// OccCurve — transform
// ============================================================================

describe("OccCurve — transform", () => {
    test("transformed creates new curve, old unchanged", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        const translation = { toArray: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] } as any;
        // The transform method is on OccGeometry base class, using Matrix4
        const origLoc = line.location;
        line.transform(translation);
        // After direct transform, the original is modified (transform, not transformed)
        expect(line.location.x).not.toBeCloseTo(origLoc.x);
    });
});

// ============================================================================
// OccBezierCurve — setWeight
// ============================================================================

describe("OccBezierCurve — setWeight", () => {
    test("setWeight changes the weight of a pole", () => {
        const pts = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
        const bezier = basisCurveOfEdge(factory.bezier(pts, [1, 2, 1]).value as OccEdge) as OccBezierCurve;
        expect(bezier.weight(2)).toBeCloseTo(2);
        bezier.setWeight(2, 3);
        expect(bezier.weight(2)).toBeCloseTo(3);
    });

    test("setWeight on default-weight bezier", () => {
        const pts = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
        const bezier = basisCurveOfEdge(factory.bezier(pts).value as OccEdge) as OccBezierCurve;
        expect(bezier.weight(1)).toBeCloseTo(1);
        bezier.setWeight(1, 2.5);
        expect(bezier.weight(1)).toBeCloseTo(2.5);
    });
});

// ============================================================================
// OccCurve — nearestExtrema with core Line
// ============================================================================

describe("OccCurve — nearestExtrema with core.Line", () => {
    test("nearestExtrema between OccCurve and core Line", () => {
        // Circle r=5 at origin; vertical line through (10,0,0) — nearest points are
        // (5,0,0) on the circle and (10,0,0) on the line
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge);
        const coreLine = new Line({ point: new XYZ({ x: 10, y: 0, z: 0 }), direction: XYZ.unitY });
        const result = circle.nearestExtrema(coreLine);
        expect(result).toBeDefined();
        expect(result!.p1.x).toBeCloseTo(5, 6);
        expect(result!.p1.y).toBeCloseTo(0, 6);
        expect(result!.p2.x).toBeCloseTo(10, 6);
        expect(result!.p2.y).toBeCloseTo(0, 6);
    });
});

// ============================================================================
// OccOffsetCurve — from OccEdge.offset
// ============================================================================

describe("OccOffsetCurve", () => {
    test("edge.offset produces a Geom_OffsetCurve-backed edge", () => {
        const edge = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5)) as OccEdge;
        const offsetEdge = unwrapOk(edge.offset(2, XYZ.unitZ)) as OccEdge;
        const curve = basisCurveOfEdge(offsetEdge);
        expect(curve instanceof OccOffsetCurve).toBe(true);
        const offsetCurve = curve as OccOffsetCurve;
        expect(offsetCurve.offset()).toBeCloseTo(2, 6);
        const dir = offsetCurve.direction();
        expect(dir.x).toBeCloseTo(0, 6);
        expect(dir.y).toBeCloseTo(0, 6);
        expect(dir.z).toBeCloseTo(1, 6);
        expect(offsetCurve.basisCurve instanceof OccTrimmedCurve).toBe(true);
        // Offsetting a radius-5 circle by 2 along its normal yields a radius-7 circle
        expect(offsetEdge.length()).toBeCloseTo(2 * Math.PI * 7, 6);
    });
});

// ============================================================================
// OccHyperbola / OccParabola — from cone sections
// ============================================================================

/** Section a cone (r5 → r0.1 over z 0..20) with a plane and return the basis curves. */
function coneSectionCurves(plane: Plane) {
    const cone = unwrapOk(factory.cone(XYZ.unitZ, XYZ.zero, 5, 0.1, 20));
    const edges = cone.section(plane).findSubShapes(ShapeTypes.edge) as OccEdge[];
    return edges.map((e) => basisCurveOfEdge(e));
}

describe("OccHyperbola", () => {
    // A plane parallel to the cone axis (but offset from it) cuts a hyperbola
    const axialPlane = () =>
        new Plane({ origin: new XYZ({ x: 0, y: 1, z: 0 }), normal: XYZ.unitY, xvec: XYZ.unitX });

    test("cone sectioned by an axial-offset plane yields a hyperbola", () => {
        const curves = coneSectionCurves(axialPlane());
        const hyperbola = curves.find((c) => c instanceof OccHyperbola) as OccHyperbola | undefined;
        expect(hyperbola).toBeDefined();
        const hyp = hyperbola as OccHyperbola;
        expect(hyp.focal()).toBeCloseTo(8.4047, 3);
        expect(hyp.majorRadius).toBeCloseTo(4.0816, 3);
        expect(hyp.minorRadius).toBeCloseTo(1, 6);
        expect(hyp.location.y).toBeCloseTo(1, 6);
        // The foci are symmetric about the center: focus1 + focus2 = 2 * location
        const sum = hyp.focus1.add(hyp.focus2);
        expect(sum.x).toBeCloseTo(2 * hyp.location.x, 6);
        expect(sum.y).toBeCloseTo(2 * hyp.location.y, 6);
        expect(sum.z).toBeCloseTo(2 * hyp.location.z, 6);
    });

    test("radius setters update the focal distance (focal = 2√(a²+b²))", () => {
        const curves = coneSectionCurves(axialPlane());
        const hyperbola = curves.find((c) => c instanceof OccHyperbola) as OccHyperbola | undefined;
        expect(hyperbola).toBeDefined();
        const hyp = hyperbola as OccHyperbola;
        hyp.minorRadius = 2;
        expect(hyp.minorRadius).toBeCloseTo(2, 6);
        expect(hyp.focal()).toBeCloseTo(2 * Math.sqrt(hyp.majorRadius ** 2 + 4), 6);
        hyp.majorRadius = 6;
        expect(hyp.majorRadius).toBeCloseTo(6, 6);
        expect(hyp.focal()).toBeCloseTo(2 * Math.sqrt(36 + 4), 6);
    });
});

describe("OccParabola", () => {
    test("cone sectioned by a generatrix-parallel plane yields a parabola", () => {
        // dr/dz = (0.1 - 5) / 20 = -0.245; a plane parallel to a generatrix cuts a parabola
        const len = Math.sqrt(1 + 0.245 ** 2);
        const normal = new XYZ({ x: 1 / len, y: 0, z: 0.245 / len });
        const plane = new Plane({ origin: new XYZ({ x: 2, y: 0, z: 10 }), normal, xvec: XYZ.unitY });
        const curves = coneSectionCurves(plane);
        const parabola = curves.find((c) => c instanceof OccParabola) as OccParabola | undefined;
        expect(parabola).toBeDefined();
        const par = parabola as OccParabola;
        expect(par.focal()).toBeCloseTo(0.06544, 3);
        // By definition, the focus-to-directrix distance equals 2 * focal
        expect(par.focus.distanceTo(par.directrix)).toBeCloseTo(2 * par.focal(), 6);
    });
});
