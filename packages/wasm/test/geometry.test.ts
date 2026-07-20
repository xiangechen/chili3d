// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { OccLine, OccTrimmedCurve } from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace } from "../src/shape";
import type { OccPlane } from "../src/surface";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

function basisCurveOfEdge(edge: OccEdge) {
    return (edge.curve as OccTrimmedCurve).basisCurve;
}

function surfaceOfFace(face: OccFace) {
    return face.surface();
}

// ============================================================================
// OccGeometry — dispose / idempotency (base class behavior)
// ============================================================================

describe("OccGeometry — dispose", () => {
    test("dispose on curve does not throw", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        expect(() => line.dispose()).not.toThrow();
    });

    test("double dispose on curve does not throw (idempotent)", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        line.dispose();
        expect(() => line.dispose()).not.toThrow();
    });

    test("dispose on surface does not throw", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const plane = surfaceOfFace(face);
        expect(() => plane.dispose()).not.toThrow();
    });

    test("double dispose on surface does not throw (idempotent)", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const plane = surfaceOfFace(face);
        plane.dispose();
        expect(() => plane.dispose()).not.toThrow();
    });
});

// ============================================================================
// OccGeometry — transform (base class)
// ============================================================================

describe("OccGeometry — transform", () => {
    test("transform on curve moves the curve", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        const origLoc = line.location;
        const translation = Matrix4.fromTranslation(10, 0, 0);
        line.transform(translation);
        expect(line.location.x).not.toBeCloseTo(origLoc.x);
    });

    test("transform on surface moves the surface", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const plane = surfaceOfFace(face) as OccPlane;
        const origLoc = plane.location;
        const translation = Matrix4.fromTranslation(10, 0, 0);
        plane.transform(translation);
        expect(plane.location.x).not.toBeCloseTo(origLoc.x);
    });

    test("transformed creates a new curve via copy + transform", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        const translation = Matrix4.fromTranslation(5, 0, 0);
        const origLoc = line.location;
        const transformed = line.transformed(translation);
        expect(line.location.x).toBeCloseTo(origLoc.x);
        expect(transformed).toBeDefined();
        expect(transformed.geometryType).toBe(line.geometryType);
    });

    test("transformed on surface creates a new surface", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const plane = surfaceOfFace(face) as OccPlane;
        const origLoc = plane.location;
        const translation = Matrix4.fromTranslation(5, 0, 0);
        const transformed = plane.transformed(translation);
        expect(plane.location.x).toBeCloseTo(origLoc.x);
        expect(transformed).toBeDefined();
    });

    test("copy on curve creates independent clone with same type", () => {
        const line = basisCurveOfEdge(factory.line(XYZ.zero, XYZ.unitX).value as OccEdge) as OccLine;
        const copy = line.copy();
        expect(copy.geometryType).toBe(line.geometryType);
        // OccLine copy should also be a curve
        expect((copy as OccLine).curveType).toBe("line");
    });

    test("copy on surface creates independent clone", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = box.findSubShapes(ShapeTypes.face)[0] as OccFace;
        const plane = surfaceOfFace(face);
        const copy = plane.copy();
        expect(copy.geometryType).toBe("surface");
    });
});
