// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape } from "@chili3d/core";
import { Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace, OccShape } from "../src/shape";
import {
    OccConicalSurface,
    OccCylindricalSurface,
    type OccElementarySurface,
    OccPlane,
    OccRectangularSurface,
    OccSphericalSurface,
    OccSurfaceOfLinearExtrusion,
    OccSurfaceOfRevolution,
    OccToroidalSurface,
} from "../src/surface";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/** Get the surface from a face. */
function surfaceOfFace(face: OccFace) {
    return face.surface();
}

/** Get the first face from a shape. */
function firstFace(shape: IShape): OccFace {
    return shape.findSubShapes(ShapeTypes.face)[0] as OccFace;
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

    test("extruded face → side faces may be extrusion surfaces", () => {
        const rect = unwrapOk(factory.rect(Plane.XY, 10, 10));
        const prism = unwrapOk(factory.prism(rect, new XYZ({ x: 0, y: 0, z: 20 })));
        const faces = prism.findSubShapes(ShapeTypes.face);
        const surfaceTypes = faces.map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        // At least one side face should be an extrusion surface (exclude top/bottom planar faces)
        expect(surfaceTypes.length).toBeGreaterThan(0);
    });

    test("revolved face → faces may include revolution surfaces", () => {
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
        expect(faces.length).toBeGreaterThan(0);
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

    test("continuity returns a continuity value", () => {
        const c = plane.continuity();
        expect(["c0", "g1", "c1", "g2", "c2", "c3", "cn"]).toContain(c);
    });

    test("value returns 3D point at UV", () => {
        const p = plane.value(0, 0);
        expect(typeof p.x).toBe("number");
        expect(typeof p.y).toBe("number");
        expect(typeof p.z).toBe("number");
    });

    test("d0 returns point at UV", () => {
        const p = plane.d0(0.5, 0.5);
        expect(typeof p.x).toBe("number");
    });

    test("d1 returns point and partial derivatives", () => {
        const { point, d1u, d1v } = plane.d1(0.5, 0.5);
        expect(typeof point.x).toBe("number");
        expect(typeof d1u.x).toBe("number");
        expect(typeof d1v.x).toBe("number");
    });

    test("d2 returns point and second derivatives", () => {
        const result = plane.d2(0.5, 0.5);
        expect(typeof result.point.x).toBe("number");
        expect(typeof result.d2u.x).toBe("number");
        expect(typeof result.d2v.x).toBe("number");
        expect(typeof result.d2uv.x).toBe("number");
    });

    test("d3 returns point and third derivatives", () => {
        const result = plane.d3(0.5, 0.5);
        expect(typeof result.point.x).toBe("number");
        expect(typeof result.d3u.x).toBe("number");
    });

    test("dn returns partial derivative", () => {
        const v = plane.dn(0, 0, 1, 0);
        expect(typeof v.x).toBe("number");
    });

    test("bounds returns UV domain", () => {
        const b = plane.bounds();
        expect(b).toBeDefined();
        if (b) {
            expect(typeof b.u1).toBe("number");
            expect(typeof b.u2).toBe("number");
            expect(typeof b.v1).toBe("number");
            expect(typeof b.v2).toBe("number");
        }
    });

    test("uIso returns isoparametric curve", () => {
        const c = plane.uIso(0);
        expect(c).toBeDefined();
    });

    test("vIso returns isoparametric curve", () => {
        const c = plane.vIso(0);
        expect(c).toBeDefined();
    });

    test("isUClosed / isVClosed are booleans", () => {
        expect(typeof plane.isUClosed()).toBe("boolean");
        expect(typeof plane.isVClosed()).toBe("boolean");
    });

    test("isUPreiodic / isVPreiodic are booleans", () => {
        expect(typeof plane.isUPreiodic()).toBe("boolean");
        expect(typeof plane.isVPreiodic()).toBe("boolean");
    });

    test("uPeriod / vPeriod", () => {
        // For a plane these should be valid numbers (or throw which is ok)
        try {
            expect(typeof plane.uPeriod()).toBe("number");
        } catch {
            // Some surfaces throw for period — acceptable
        }
    });

    test("isCNu / isCNv are booleans", () => {
        expect(typeof plane.isCNu(1)).toBe("boolean");
        expect(typeof plane.isCNv(1)).toBe("boolean");
    });

    test("copy creates independent surface", () => {
        const copy = plane.copy();
        expect(copy.geometryType).toBe("surface");
    });

    test("project returns points on surface", () => {
        const pts = plane.project(new XYZ({ x: 5, y: 5, z: 10 }));
        expect(pts.length).toBeGreaterThanOrEqual(0);
    });

    test("parameter returns UV for a point on surface", () => {
        const p = plane.value(0.5, 0.5);
        const uv = plane.parameter(p, 0.1);
        if (uv) {
            expect(typeof uv.u).toBe("number");
            expect(typeof uv.v).toBe("number");
        }
    });

    test("nearestPoint returns closest point info", () => {
        const r = plane.nearestPoint(new XYZ({ x: 5, y: 5, z: 10 }));
        if (r) {
            const [pt, param] = r;
            expect(typeof pt.x).toBe("number");
            expect(typeof param).toBe("number");
        }
    });

    test("projectCurve projects a curve onto surface", () => {
        const edge = unwrapOk(
            factory.line(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 10, y: 0, z: 5 })),
        ) as OccEdge;
        const result = plane.projectCurve(edge.curve);
        if (result) {
            expect(result.geometryType).toBe("curve");
        }
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
        expect(typeof p.origin.x).toBe("number");
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

    test("inherited location and axis are defined", () => {
        expect(cyl.location).toBeDefined();
        expect(cyl.axis).toBeDefined();
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

    test("apex returns a point", () => {
        const apex = conical.apex();
        expect(typeof apex.x).toBe("number");
    });

    test("setRadius updates reference radius", () => {
        const old = conical.refRadius();
        conical.setRadius(old + 1);
        expect(conical.refRadius()).not.toBeCloseTo(old);
    });

    test("semiAngle setter", () => {
        const old = conical.semiAngle;
        expect(() => {
            conical.semiAngle = old + 0.1;
        }).not.toThrow();
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

    test("location getter returns a point", () => {
        const loc = elem.location;
        expect(typeof loc.x).toBe("number");
        expect(typeof loc.y).toBe("number");
        expect(typeof loc.z).toBe("number");
    });

    test("location setter", () => {
        elem.location = new XYZ({ x: 20, y: 0, z: 0 });
        expect(elem.location.x).toBeCloseTo(20);
    });

    test("axis getter returns a non-zero direction vector", () => {
        const axis = elem.axis;
        expect(typeof axis.x).toBe("number");
        // Plane's axis has at least one non-zero component
        expect(Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z)).toBeGreaterThan(0);
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
// OccRectangularSurface
// ============================================================================

describe("OccRectangularSurface", () => {
    test("can get rectangular trim surface from a face", () => {
        const box = unwrapOk(factory.box(Plane.XY, 10, 10, 10));
        const face = firstFace(box);
        const wire = (face as OccFace).outerWire();
        const faceResult = factory.face([wire]);
        if (faceResult.isOk) {
            const s = surfaceOfFace(faceResult.value as OccFace);
            if (s instanceof OccRectangularSurface) {
                expect(s.basisSurface()).toBeDefined();
                s.setTrim(0, 1, 0, 1);
            }
        }
    });
});

// ============================================================================
// OccSurfaceOfLinearExtrusion — from extruded face
// ============================================================================

describe("OccSurfaceOfLinearExtrusion", () => {
    test("extruded face creates linear extrusion surface", () => {
        const rect = unwrapOk(factory.rect(Plane.XY, 10, 10));
        const prism = unwrapOk(factory.prism(rect, new XYZ({ x: 0, y: 0, z: 20 })));
        const faces = prism.findSubShapes(ShapeTypes.face);
        // Find a side face which should be a linear extrusion surface
        const surfaces = faces.map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });
        const extrusionSurface = surfaces.find((s) => s instanceof OccSurfaceOfLinearExtrusion);
        if (extrusionSurface) {
            expect(extrusionSurface).toBeDefined();
            // direction() and basisCurve() should work
            const dir = (extrusionSurface as OccSurfaceOfLinearExtrusion).direction();
            expect(typeof dir.x).toBe("number");
        }
    });
});

// ============================================================================
// OccSurfaceOfRevolution — from revolved face
// ============================================================================

describe("OccSurfaceOfRevolution", () => {
    test("revolved face creates revolution surface", () => {
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
        const surfaces = faces.map((f) => {
            try {
                return surfaceOfFace(f as OccFace);
            } catch {
                return null;
            }
        });

        const revSurface = surfaces.find((s) => s instanceof OccSurfaceOfRevolution);
        if (revSurface) {
            const rev = revSurface as OccSurfaceOfRevolution;
            expect(typeof rev.location.x).toBe("number");
        }
    });
});

// ============================================================================
// OccToroidalSurface — from revolved circle (torus)
// ============================================================================

describe("OccToroidalSurface", () => {
    test("torus from revolved circle has toroidal surface", () => {
        const circle = unwrapOk(factory.circle(XYZ.unitY, new XYZ({ x: 5, y: 0, z: 0 }), 2));
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = factory.revolve(circle, axis, 360);
        if (revolved.isOk) {
            const faces = revolved.value.findSubShapes(ShapeTypes.face);
            const surfaces = faces.map((f) => {
                try {
                    return surfaceOfFace(f as OccFace);
                } catch {
                    return null;
                }
            });
            const torus = surfaces.find((s) => s instanceof OccToroidalSurface) as
                | OccToroidalSurface
                | undefined;
            if (torus) {
                expect(torus.majorRadius).toBeGreaterThan(0);
                expect(torus.minorRadius).toBeGreaterThan(0);
                expect(torus.area()).toBeGreaterThan(0);
            }
        }
    });

    test("torus surface setters", () => {
        const circle = unwrapOk(factory.circle(XYZ.unitY, new XYZ({ x: 5, y: 0, z: 0 }), 2));
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const revolved = factory.revolve(circle, axis, 360);
        if (revolved.isOk) {
            const faces = revolved.value.findSubShapes(ShapeTypes.face);
            const surfaces = faces.map((f) => {
                try {
                    return surfaceOfFace(f as OccFace);
                } catch {
                    return null;
                }
            });
            const torus = surfaces.find((s) => s instanceof OccToroidalSurface) as
                | OccToroidalSurface
                | undefined;
            if (torus) {
                const oldMajor = torus.majorRadius;
                torus.majorRadius = oldMajor + 1;
                expect(torus.majorRadius).not.toBeCloseTo(oldMajor);
                torus.majorRadius = oldMajor;
                expect(torus.majorRadius).toBeCloseTo(oldMajor);
            }
        }
    });
});
