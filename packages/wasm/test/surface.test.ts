// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { OccLine } from "../src/curve";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace } from "../src/shape";
import {
    OccBSplineSurface,
    OccConicalSurface,
    OccCylindricalSurface,
    type OccElementarySurface,
    OccOffsetSurface,
    OccPlane,
    OccSphericalSurface,
    OccSurfaceOfLinearExtrusion,
    OccSurfaceOfRevolution,
    OccToroidalSurface,
} from "../src/surface";
import { createTestFactory, firstFace, surfaceOfFace, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/**
 * Extrude a face with a curved (bezier) boundary — the swept side face is a
 * Geom_SurfaceOfLinearExtrusion (planar boundaries are simplified to planes instead).
 */
function curvedBoundaryPrism(factory: ShapeFactory) {
    const bezier = unwrapOk(
        factory.bezier([XYZ.zero, new XYZ({ x: 5, y: 5, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })]),
    );
    const closing = unwrapOk(factory.line(new XYZ({ x: 10, y: 0, z: 0 }), XYZ.zero));
    const wire = unwrapOk(factory.wire([bezier, closing]));
    const face = unwrapOk(factory.face([wire]));
    return unwrapOk(factory.prism(face, new XYZ({ x: 0, y: 0, z: 10 })));
}

// ============================================================================
// OccSurface.wrap — type dispatch
// ============================================================================

describe("OccSurface.wrap — type dispatch", () => {
    test("box face → plane surface", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = firstFace(box);
        const surface = surfaceOfFace(face);
        expect(surface instanceof OccPlane).toBe(true);
    });

    test("cylinder face → cylindrical surface", () => {
        const cyl = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const faces = cyl.findSubShapes(ShapeTypes.face);
        const surfaceTypes = faces.map((f) => surfaceOfFace(f as OccFace));
        expect(surfaceTypes.some((s) => s instanceof OccCylindricalSurface)).toBe(true);
    });

    test("sphere face → spherical surface", () => {
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 10));
        const face = firstFace(sphere);
        const surface = surfaceOfFace(face);
        expect(surface instanceof OccSphericalSurface).toBe(true);
    });

    test("cone face → conical surface", () => {
        const cone = unwrapOk(factory.cone(XYZ.unitZ, XYZ.zero, 5, 3, 20));
        const faces = cone.findSubShapes(ShapeTypes.face);
        const surfaceTypes = faces.map((f) => surfaceOfFace(f as OccFace));
        expect(surfaceTypes.some((s) => s instanceof OccConicalSurface)).toBe(true);
    });

    test("extruded curved-profile face → side faces are extrusion surfaces", () => {
        const prism = curvedBoundaryPrism(factory);
        const faces = prism.findSubShapes(ShapeTypes.face);
        const surfaceTypes = faces.map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        // The side face swept from the bezier boundary is a linear extrusion surface
        expect(surfaceTypes.some((s) => s instanceof OccSurfaceOfLinearExtrusion)).toBe(true);
    });

    test("revolved face → side faces are cylindrical surfaces", () => {
        const rect = unwrapOk(
            factory.rect(
                new Plane({
                    origin: new XYZ({ x: 5, y: 0, z: 0 }),
                    normal: XYZ.unitX,
                    xvec: XYZ.unitZ,
                }),
                10,
                20,
            ),
        );
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = unwrapOk(factory.revolve(rect, axis, 360));
        const faces = revolved.findSubShapes(ShapeTypes.face);
        const surfaceTypes = faces.map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        // Revolving a rectangle around an offset axis yields cylindrical side faces
        expect(surfaceTypes.some((s) => s instanceof OccCylindricalSurface)).toBe(true);
    });
});

// ============================================================================
// OccSurface — core methods (tested on a plane surface)
// ============================================================================

describe("OccSurface — core methods", () => {
    let plane: OccPlane;

    beforeEach(() => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        plane = surfaceOfFace(firstFace(box)) as OccPlane;
    });

    test("isPlanar returns true for plane", () => {
        expect(plane.isPlanar()).toBe(true);
    });

    test("continuity of a plane is cn", () => {
        expect(plane.continuity()).toBe("cn");
    });

    test("value returns 3D point at UV, consistent with d0", () => {
        const p = plane.value(0, 0);
        expect(p.distanceTo(plane.d0(0, 0))).toBeCloseTo(0, 9);
        // A plane is unit-parameterized: moving 1 in U moves the point by 1
        expect(plane.value(1, 0).distanceTo(p)).toBeCloseTo(1, 9);
    });

    test("d0 returns point at UV", () => {
        const p = plane.d0(0.5, 0.5);
        expect(p.distanceTo(plane.value(0.5, 0.5))).toBeCloseTo(0, 9);
    });

    test("d1 returns point and unit, orthogonal partial derivatives", () => {
        const { point, d1u, d1v } = plane.d1(0.5, 0.5);
        expect(point.distanceTo(plane.value(0.5, 0.5))).toBeCloseTo(0, 9);
        expect(d1u.length()).toBeCloseTo(1, 9);
        expect(d1v.length()).toBeCloseTo(1, 9);
        expect(d1u.dot(d1v)).toBeCloseTo(0, 9);
    });

    test("d2 returns zero second derivatives on a plane", () => {
        const result = plane.d2(0.5, 0.5);
        expect(result.d2u.length()).toBeCloseTo(0, 9);
        expect(result.d2v.length()).toBeCloseTo(0, 9);
        expect(result.d2uv.length()).toBeCloseTo(0, 9);
    });

    test("d3 returns zero third derivatives on a plane", () => {
        const result = plane.d3(0.5, 0.5);
        expect(result.d3u.length()).toBeCloseTo(0, 9);
        expect(result.d3v.length()).toBeCloseTo(0, 9);
    });

    test("dn returns the first derivative direction, zero for higher orders", () => {
        expect(plane.dn(0, 0, 1, 0).length()).toBeCloseTo(1, 9);
        expect(plane.dn(0, 0, 2, 0).length()).toBeCloseTo(0, 9);
    });

    test("bounds returns a finite UV domain", () => {
        const b = plane.bounds();
        expect(Number.isFinite(b.u1)).toBe(true);
        expect(Number.isFinite(b.u2)).toBe(true);
        expect(Number.isFinite(b.v1)).toBe(true);
        expect(Number.isFinite(b.v2)).toBe(true);
    });

    test("uIso returns a line", () => {
        const c = plane.uIso(0);
        expect(c instanceof OccLine).toBe(true);
    });

    test("vIso returns a line", () => {
        const c = plane.vIso(0);
        expect(c instanceof OccLine).toBe(true);
    });

    test("isUClosed / isVClosed are false for a plane", () => {
        expect(plane.isUClosed()).toBe(false);
        expect(plane.isVClosed()).toBe(false);
    });

    test("isUPeriodic / isVPeriodic are false for a plane", () => {
        expect(plane.isUPeriodic()).toBe(false);
        expect(plane.isVPeriodic()).toBe(false);
    });

    test("uPeriod / vPeriod throw a catchable error on non-periodic surfaces", () => {
        // A plane is not periodic — the wrapper guards the OCCT call with a
        // catchable error instead of letting the wasm runtime abort
        expect(() => plane.uPeriod()).toThrow("Surface is not periodic in the U direction");
        expect(() => plane.vPeriod()).toThrow("Surface is not periodic in the V direction");
    });

    test("isCNu / isCNv are true for a plane", () => {
        expect(plane.isCNu(1)).toBe(true);
        expect(plane.isCNv(1)).toBe(true);
    });

    test("copy creates an independent surface of the same type", () => {
        const copy = plane.copy();
        expect(copy.geometryType).toBe("surface");
        expect(copy instanceof OccPlane).toBe(true);
    });

    test("project returns the single projection point on the plane", () => {
        const query = new XYZ({ x: 5, y: 5, z: 10 });
        const pts = plane.project(query);
        expect(pts.length).toBe(1);
        expect(pts[0]).toBeInstanceOf(XYZ);
        // The projection lies on the surface
        expect(plane.parameter(pts[0], 1e-6)).toBeDefined();
    });

    test("parameter returns UV for a point on surface", () => {
        const p = plane.value(0.5, 0.5);
        const uv = plane.parameter(p, 0.1);
        expect(uv).toBeDefined();
        expect(uv!.u).toBeCloseTo(0.5, 1);
        expect(uv!.v).toBeCloseTo(0.5, 1);
    });

    test("nearestPoint returns closest point info", () => {
        const r = plane.nearestPoint(new XYZ({ x: 5, y: 5, z: 10 }));
        expect(r).toBeDefined();
        const [pt, param] = r!;
        expect(pt).toBeInstanceOf(XYZ);
        expect(Number.isFinite(param)).toBe(true);
    });

    test("projectCurve projects a curve onto surface", () => {
        const edge = unwrapOk(
            factory.line(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 10, y: 0, z: 5 })),
        ) as OccEdge;
        const result = plane.projectCurve(edge.curve);
        expect(result).toBeDefined();
        expect(result!.geometryType).toBe("curve");
    });
});

// ============================================================================
// OccPlane — specific properties
// ============================================================================

describe("OccPlane", () => {
    let plane: OccPlane;

    beforeEach(() => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        plane = surfaceOfFace(firstFace(box)) as OccPlane;
    });

    test("plane getter returns a Plane object", () => {
        const p = plane.plane;
        expect(p).toBeInstanceOf(Plane);
        // A box face plane has an axis-aligned unit normal
        expect(Math.abs(p.normal.x) + Math.abs(p.normal.y) + Math.abs(p.normal.z)).toBeCloseTo(1, 9);
    });

    test("plane setter updates geometry", () => {
        const newPlane = new Plane({
            origin: new XYZ({ x: 10, y: 10, z: 10 }),
            normal: XYZ.unitZ,
            xvec: XYZ.unitX,
        });
        plane.plane = newPlane;
        const updated = plane.plane;
        expect(updated.origin.x).toBeCloseTo(10);
        expect(updated.origin.y).toBeCloseTo(10);
        expect(updated.origin.z).toBeCloseTo(10);
    });
});

// ============================================================================
// OccCylindricalSurface
// ============================================================================

describe("OccCylindricalSurface", () => {
    let cyl: OccCylindricalSurface;

    beforeEach(() => {
        const solid = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const faces = solid.findSubShapes(ShapeTypes.face);
        cyl = faces
            .map((f) => surfaceOfFace(f as OccFace))
            .find((s) => s instanceof OccCylindricalSurface) as OccCylindricalSurface;
    });

    test("radius returns expected value", () => {
        expect(cyl.radius).toBeCloseTo(5);
    });

    test("radius setter changes geometry", () => {
        cyl.radius = 8;
        expect(cyl.radius).toBeCloseTo(8);
    });

    test("inherited location and axis match the creation parameters", () => {
        expect(cyl.location.distanceTo(XYZ.zero)).toBeCloseTo(0, 6);
        expect(cyl.axis.z).toBeCloseTo(1, 6);
    });

    test("uPeriod returns 2π for the periodic U direction", () => {
        expect(cyl.isUPeriodic()).toBe(true);
        expect(cyl.uPeriod()).toBeCloseTo(2 * Math.PI);
    });

    test("vPeriod throws a catchable error for the non-periodic V direction", () => {
        expect(cyl.isVPeriodic()).toBe(false);
        expect(() => cyl.vPeriod()).toThrow("Surface is not periodic in the V direction");
    });
});

// ============================================================================
// OccConicalSurface
// ============================================================================

describe("OccConicalSurface", () => {
    let conical: OccConicalSurface;

    beforeEach(() => {
        const solid = unwrapOk(factory.cone(XYZ.unitZ, XYZ.zero, 5, 3, 20));
        const faces = solid.findSubShapes(ShapeTypes.face);
        conical = faces
            .map((f) => surfaceOfFace(f as OccFace))
            .find((s) => s instanceof OccConicalSurface) as OccConicalSurface;
    });

    test("semiAngle is non-zero", () => {
        // Semi-angle can be positive or negative depending on cone direction
        expect(Math.abs(conical.semiAngle)).toBeGreaterThan(0);
    });

    test("refRadius returns a positive number", () => {
        expect(conical.refRadius()).toBeGreaterThan(0);
    });

    test("apex lies on the cone axis", () => {
        const apex = conical.apex();
        expect(apex.x).toBeCloseTo(0, 6);
        expect(apex.y).toBeCloseTo(0, 6);
        // r1=5 at z=0, r2=3 at z=20 → radius reaches 0 at z=50
        expect(Math.abs(apex.z)).toBeCloseTo(50, 6);
    });

    test("setRadius updates reference radius", () => {
        const old = conical.refRadius();
        conical.setRadius(old + 1);
        expect(conical.refRadius()).not.toBeCloseTo(old);
    });

    test("semiAngle setter updates the semi-angle", () => {
        const old = conical.semiAngle;
        conical.semiAngle = old + 0.1;
        expect(conical.semiAngle).toBeCloseTo(old + 0.1, 9);
    });
});

// ============================================================================
// OccSphericalSurface
// ============================================================================

describe("OccSphericalSurface", () => {
    let spherical: OccSphericalSurface;

    beforeEach(() => {
        const solid = unwrapOk(factory.sphere(XYZ.zero, 10));
        spherical = surfaceOfFace(firstFace(solid)) as OccSphericalSurface;
    });

    test("radius returns expected value", () => {
        expect(spherical.radius).toBeCloseTo(10);
    });

    test("radius setter", () => {
        spherical.radius = 15;
        expect(spherical.radius).toBeCloseTo(15);
    });

    test("area returns positive number", () => {
        expect(spherical.area()).toBeGreaterThan(0);
    });

    test("volume returns positive number", () => {
        expect(spherical.volume()).toBeGreaterThan(0);
    });
});

describe("Torus via revolution", () => {
    test("faces from revolved circle torus exist", () => {
        const circle = unwrapOk(factory.circle(XYZ.unitY, new XYZ({ x: 5, y: 0, z: 0 }), 2));
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = factory.revolve(circle, axis, 360);
        const faces = revolved.value.findSubShapes(ShapeTypes.face);
        expect(faces.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// OccElementarySurface — inherited location/axis/coordinates
// ============================================================================

describe("OccElementarySurface", () => {
    let elem: OccElementarySurface;

    beforeEach(() => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        elem = surfaceOfFace(firstFace(box)) as OccPlane; // OccPlane extends OccElementarySurface
    });

    test("location getter matches the position origin", () => {
        expect(elem.location.distanceTo(elem.coordinates.origin)).toBeCloseTo(0, 9);
    });

    test("location setter", () => {
        elem.location = new XYZ({ x: 20, y: 0, z: 0 });
        expect(elem.location.x).toBeCloseTo(20);
    });

    test("axis getter returns an axis-aligned unit direction", () => {
        const axis = elem.axis;
        expect(Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z)).toBeCloseTo(1, 9);
    });

    test("axis setter", () => {
        elem.axis = XYZ.unitX;
        expect(elem.axis.x).toBeCloseTo(1);
    });

    test("coordinates getter returns Plane", () => {
        const coords = elem.coordinates;
        expect(coords).toBeInstanceOf(Plane);
    });

    test("coordinates setter", () => {
        const newPlane = new Plane({
            origin: new XYZ({ x: 5, y: 5, z: 5 }),
            normal: XYZ.unitZ,
            xvec: XYZ.unitX,
        });
        elem.coordinates = newPlane;
        expect(elem.coordinates.origin.x).toBeCloseTo(5);
    });
});

// ============================================================================
// factory.face — rebuild a face from an extracted wire
// ============================================================================

describe("factory.face from an extracted wire", () => {
    test("face rebuilt from a box face wire is planar with the original area", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = firstFace(box);
        const wire = face.outerWire();
        const faceResult = factory.face([wire]);
        expect(faceResult.isOk).toBe(true);

        const newFace = faceResult.value as OccFace;
        expect(newFace.area()).toBeCloseTo(100, 6);
        expect(surfaceOfFace(newFace) instanceof OccPlane).toBe(true);
    });
});

// ============================================================================
// OccSurfaceOfLinearExtrusion — from extruded face
// ============================================================================

describe("OccSurfaceOfLinearExtrusion", () => {
    test("extruded curved-profile face creates a linear extrusion surface", () => {
        const prism = curvedBoundaryPrism(factory);
        const surfaces = prism.findSubShapes(ShapeTypes.face).map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        const extrusionSurface = surfaces.find((s) => s instanceof OccSurfaceOfLinearExtrusion);
        expect(extrusionSurface).toBeDefined();

        const extrusion = extrusionSurface as OccSurfaceOfLinearExtrusion;
        // The prism was extruded along +Z
        const dir = extrusion.direction();
        expect(Math.abs(dir.z)).toBeCloseTo(1, 6);
        expect(extrusion.basisCurve()).toBeDefined();
    });
});

// ============================================================================
// OccSurfaceOfRevolution — from revolved face
// ============================================================================

describe("OccSurfaceOfRevolution", () => {
    test("revolved bezier profile creates revolution surface", () => {
        // A non-linear profile (bezier) revolves into a generic surface of revolution;
        // linear profiles would be simplified to planes/cylinders instead
        const profile = unwrapOk(
            factory.bezier([
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 8, y: 0, z: 5 }),
                new XYZ({ x: 5, y: 0, z: 10 }),
            ]),
        );
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = unwrapOk(factory.revolve(profile, axis, 360));
        const surfaces = revolved.findSubShapes(ShapeTypes.face).map((f) => surfaceOfFace(f as OccFace));

        const revSurface = surfaces.find((s) => s instanceof OccSurfaceOfRevolution);
        expect(revSurface).toBeDefined();
        const rev = revSurface as OccSurfaceOfRevolution;
        // The revolution axis goes through the origin
        expect(rev.location.x).toBeCloseTo(0, 6);
        expect(rev.location.y).toBeCloseTo(0, 6);
    });
});

// ============================================================================
// OccToroidalSurface — from revolved circle (torus)
// ============================================================================

describe("OccToroidalSurface", () => {
    function revolvedTorus(): OccToroidalSurface {
        const circle = unwrapOk(factory.circle(XYZ.unitY, new XYZ({ x: 5, y: 0, z: 0 }), 2));
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = unwrapOk(factory.revolve(circle, axis, 360));
        const surfaces = revolved.findSubShapes(ShapeTypes.face).map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        const torus = surfaces.find((s) => s instanceof OccToroidalSurface) as OccToroidalSurface | undefined;
        expect(torus).toBeDefined();
        return torus as OccToroidalSurface;
    }

    test("torus from revolved circle has expected radii and area", () => {
        const torus = revolvedTorus();
        expect(torus.majorRadius).toBeCloseTo(5, 6);
        expect(torus.minorRadius).toBeCloseTo(2, 6);
        // Torus area = (2πR)(2πr)
        expect(torus.area()).toBeCloseTo(4 * Math.PI * Math.PI * 5 * 2, 3);
    });

    test("torus surface setters", () => {
        const torus = revolvedTorus();
        const oldMajor = torus.majorRadius;
        torus.majorRadius = oldMajor + 1;
        expect(torus.majorRadius).not.toBeCloseTo(oldMajor);
        torus.majorRadius = oldMajor;
        expect(torus.majorRadius).toBeCloseTo(oldMajor);
    });
});

// ============================================================================
// OccBSplineSurface — from lofted circles
// ============================================================================

describe("OccBSplineSurface", () => {
    /** Loft between offset circles (r5 → r3) produces a BSpline side surface. */
    function loftedBSplineSurface(): OccBSplineSurface {
        const c1 = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
        const c2 = unwrapOk(factory.circle(XYZ.unitZ, new XYZ({ x: 5, y: 5, z: 15 }), 3));
        const loft = unwrapOk(factory.loft([c1, c2], true, false, "c0"));
        const surface = loft
            .findSubShapes(ShapeTypes.face)
            .map((f) => surfaceOfFace(f as OccFace))
            .find((s) => s instanceof OccBSplineSurface) as OccBSplineSurface | undefined;
        expect(surface).toBeDefined();
        return surface as OccBSplineSurface;
    }

    test("side surface is closed in U and open in V", () => {
        const surface = loftedBSplineSurface();
        expect(surface.isUClosed()).toBe(true);
        expect(surface.isVClosed()).toBe(false);
    });

    test("U domain spans the full 2π of the section circles", () => {
        const surface = loftedBSplineSurface();
        const bounds = surface.bounds();
        expect(bounds).toBeDefined();
        expect(bounds.u1).toBeCloseTo(0, 6);
        expect(bounds.u2).toBeCloseTo(2 * Math.PI, 6);
    });

    test("vIso at the bottom boundary is the radius-5 circle", () => {
        const surface = loftedBSplineSurface();
        const iso = surface.vIso(0);
        expect(iso.length()).toBeCloseTo(2 * Math.PI * 5, 6);
    });
});

// ============================================================================
// OccOffsetSurface — from thickening a BSpline face
// ============================================================================

describe("OccOffsetSurface", () => {
    /** Thickening the lofted BSpline face by 1 leaves an offset surface behind. */
    function thickenedOffsetSurface(): OccOffsetSurface {
        const c1 = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
        const c2 = unwrapOk(factory.circle(XYZ.unitZ, new XYZ({ x: 5, y: 5, z: 15 }), 3));
        const loft = unwrapOk(factory.loft([c1, c2], false, false, "c0"));
        const thick = unwrapOk(factory.makeThickSolidBySimple(loft, 1));
        const surface = thick
            .findSubShapes(ShapeTypes.face)
            .map((f) => surfaceOfFace(f as OccFace))
            .find((s) => s instanceof OccOffsetSurface) as OccOffsetSurface | undefined;
        expect(surface).toBeDefined();
        return surface as OccOffsetSurface;
    }

    test("offset surface reports the thickening distance and its basis surface", () => {
        const surface = thickenedOffsetSurface();
        expect(surface.offset).toBeCloseTo(1, 6);
        expect(surface.basisSurface instanceof OccBSplineSurface).toBe(true);
    });

    test("offset setter updates the offset value", () => {
        const surface = thickenedOffsetSurface();
        surface.offset = 2;
        expect(surface.offset).toBeCloseTo(2, 6);
    });
});
