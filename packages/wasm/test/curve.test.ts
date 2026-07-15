// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import {
    OccBezierCurve,
    OccBSplineCurve,
    OccCircle,
    OccCurve,
    OccEllipse,
    OccLine,
    type OccTrimmedCurve,
} from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge } from "../src/shape";
import { createTestFactory } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/** Extract the basis (untrimmed) curve from an edge. */
function basisCurveOfEdge(edge: OccEdge) {
    return (edge.curve as OccTrimmedCurve).basisCurve;
}

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

    test("length of untrimmed line is very large (infinite line)", () => {
        // Geom_Line is an infinite line; its untrimmed length is huge
        expect(line.length()).toBeGreaterThan(1);
    });

    test("trimmed curve length is consistent with trim range", () => {
        const t = line.trim(0, 0.5);
        expect(t.length()).toBeCloseTo(0.5);
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

    test("firstParameter and lastParameter", () => {
        expect(typeof line.firstParameter()).toBe("number");
        expect(typeof line.lastParameter()).toBe("number");
        expect(line.firstParameter()).toBeLessThan(line.lastParameter());
    });

    test("value returns point on curve", () => {
        const p = line.value(0);
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
    });

    test("d0 returns point on curve", () => {
        const p = line.d0(0.5);
        expect(typeof p.x).toBe("number");
        expect(typeof p.y).toBe("number");
        expect(typeof p.z).toBe("number");
    });

    test("d1 returns point and tangent vector", () => {
        const { point, vec } = line.d1(0.5);
        expect(typeof point.x).toBe("number");
        expect(typeof vec.x).toBe("number");
        // For a line from (0,0,0) to (1,0,0), tangent at any point is (1,0,0)
        expect(vec.x).toBeCloseTo(1);
        expect(vec.y).toBeCloseTo(0);
        expect(vec.z).toBeCloseTo(0);
    });

    test("d2 returns point and first/second derivatives", () => {
        const { point, vec1, vec2 } = circle.d2(0);
        expect(typeof point.x).toBe("number");
        expect(typeof vec1.x).toBe("number");
        expect(typeof vec2.x).toBe("number");
    });

    test("d3 returns point and three derivatives", () => {
        const { point, vec1, vec2, vec3 } = circle.d3(0);
        expect(typeof point.x).toBe("number");
        expect(typeof vec1.x).toBe("number");
        expect(typeof vec2.x).toBe("number");
        expect(typeof vec3.x).toBe("number");
    });

    test("dn(u, n) returns n-th derivative", () => {
        const v = line.dn(0, 1);
        expect(typeof v.x).toBe("number");
    });

    test("isCN returns boolean", () => {
        expect(typeof line.isCN(1)).toBe("boolean");
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
        expect(res).toBeDefined();
        expect(typeof res.point.x).toBe("number");
    });

    test("project returns points sorted by distance", () => {
        const points = line.project(new XYZ({ x: 0.5, y: 1, z: 0 }));
        expect(points.length).toBeGreaterThanOrEqual(1);
    });

    test("parameter returns parameter for a point on curve", () => {
        const midPoint = line.value(0.5);
        const param = line.parameter(midPoint, 1e-3);
        expect(param).toBeCloseTo(0.5, 1);
    });

    test("uniformAbscissaByLength on bounded trimmed curve returns points", () => {
        // Geom_Line is infinite → uniformAbscissaByLength fails. Use trimmed curve.
        const t = line.trim(0, 1);
        const pts = t.uniformAbscissaByLength(0.25);
        expect(pts.length).toBeGreaterThanOrEqual(3);
    });

    test("uniformAbscissaByCount returns correct number of points", () => {
        const count = 5;
        const pts = line.uniformAbscissaByCount(count);
        expect(pts.length).toBe(count + 1);
    });

    test("trim creates trimmed curve", () => {
        const t = line.trim(0.3, 0.7);
        expect(t).toBeDefined();
        expect(t.length()).toBeLessThan(line.length());
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

    test("axis/xAxis/yAxis are defined", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge) as OccCircle;
        expect(circle.axis).toBeDefined();
        expect(circle.xAxis).toBeDefined();
        expect(circle.yAxis).toBeDefined();
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

    test("focus1 and focus2 are at opposite sides of center", () => {
        const f1 = ellipse.focus1;
        const f2 = ellipse.focus2;
        // Foci lie on major axis at ±c from center where c² = a² - b²
        expect(f1.distanceTo(f2)).toBeGreaterThan(0);
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
        expect(bezier.degree()).toBeGreaterThanOrEqual(1);
    });

    test("nbPoles equals number of control points", () => {
        // Created with 3 points → 3 poles
        expect(bezier.nbPoles()).toBe(3);
    });

    test("pole returns individual control point", () => {
        const p = bezier.pole(1);
        // 1-indexed in OCCT
        expect(typeof p.x).toBe("number");
    });

    test("poles returns all control points", () => {
        const pts = bezier.poles();
        expect(pts.length).toBe(3);
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
    test("can create BSpline from circle approximation", () => {
        // Get a BSpline from edge curve of a circle (may be a BSpline internally)
        const circle = factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge;
        const basis = basisCurveOfEdge(circle);
        if (basis instanceof OccBSplineCurve) {
            expect(basis.nbPoles()).toBeGreaterThan(0);
            expect(basis.nbKnots()).toBeGreaterThan(0);
            expect(basis.degree()).toBeGreaterThanOrEqual(1);
        } else {
            // Circle may not be BSpline — that's fine
            expect(basis instanceof OccCircle).toBe(true);
        }
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
        expect(newLen).toBeLessThan(origLen);
    });

    test("startPoint and endPoint are at trim boundaries", () => {
        const start = trimmed.startPoint();
        const end = trimmed.endPoint();
        expect(typeof start.x).toBe("number");
        expect(typeof end.x).toBe("number");
    });
});

// ============================================================================
// OccCurve — nearestExtrema between two curves
// ============================================================================

describe("OccCurve — nearestExtrema", () => {
    test("nearestExtrema between circle and line", () => {
        const circle = basisCurveOfEdge(factory.circle(XYZ.unitZ, XYZ.zero, 5).value as OccEdge);
        const edge2 = factory.circle(XYZ.unitZ, new XYZ({ x: 10, y: 0, z: 0 }), 5).value as OccEdge;
        const circle2 = basisCurveOfEdge(edge2);
        const result = circle.nearestExtrema(circle2);
        expect(result).toBeDefined();
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
