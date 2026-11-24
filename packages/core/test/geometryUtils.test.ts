// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import type { ICurve, IEdge, IFace, ITrimmedCurve } from "../src";
import { GeometryUtils, ShapeTypes, XYZ } from "../src";
import { createMockEdge, createMockEdgeCurve, createMockWire } from "../test-utils";

/**
 * Bare (non-trimmed) curve for curveNormal tests: no basisCurve, so CurveUtils.isTrimmed
 * is false; `axis`/`dn` are configurable to hit the conic / parallel / generic branches.
 */
function createBareCurve(overrides: Record<string, unknown> = {}): ICurve {
    return {
        dn: () => XYZ.unitX,
        ...overrides,
    } as unknown as ICurve;
}

/** X-axis segment curve: value(t) = (10t, 0, 0), parameters [0, 1]. */
function xSegmentCurve(offset: XYZ = XYZ.zero): ITrimmedCurve {
    return createMockEdgeCurve({
        valueFn: (t) => new XYZ({ x: t * 10 + offset.x, y: offset.y, z: offset.z }),
    });
}

describe("GeometryUtils", () => {
    describe("nearestPoint", () => {
        test("should return the edge with the smallest distance", () => {
            const near = new XYZ({ x: 2, y: 0, z: 0 });
            const edge1 = createMockEdge({
                curve: createMockEdgeCurve({
                    nearestFromPointResult: {
                        point: new XYZ({ x: 1, y: 0, z: 0 }),
                        parameter: 0.1,
                        distance: 5,
                    },
                }),
            });
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({
                    nearestFromPointResult: { point: near, parameter: 0.4, distance: 1 },
                }),
            });
            const wire = createMockWire([edge1, edge2]);

            const result = GeometryUtils.nearestPoint(wire, XYZ.zero);

            expect(result.edge).toBe(edge2);
            expect(result.point).toBe(near);
            expect(result.parameter).toBe(0.4);
        });

        test("should return the only edge of a single-edge wire", () => {
            const edge = createMockEdge({
                curve: createMockEdgeCurve({
                    nearestFromPointResult: {
                        point: new XYZ({ x: 3, y: 0, z: 0 }),
                        parameter: 0.3,
                        distance: 2,
                    },
                }),
            });
            const wire = createMockWire([edge]);

            const result = GeometryUtils.nearestPoint(wire, XYZ.zero);

            expect(result.edge).toBe(edge);
            expect(result.parameter).toBe(0.3);
        });
    });

    describe("curveNormal", () => {
        test("should return the axis of the conic basis curve for a trimmed conic", () => {
            const curve = createMockEdgeCurve();

            const normal = GeometryUtils.curveNormal(curve);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should return the axis of a non-trimmed conic", () => {
            const axis = new XYZ({ x: 0, y: 1, z: 0 });
            const curve = createBareCurve({ axis });

            const normal = GeometryUtils.curveNormal(curve);

            expect(normal).toBe(axis);
        });

        test("should return unitZ when the tangent is parallel to unitX", () => {
            const curve = createBareCurve({ dn: () => new XYZ({ x: -3, y: 0, z: 0 }) });

            const normal = GeometryUtils.curveNormal(curve);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should return the cross product with unitX for a generic tangent", () => {
            // unitY x unitX = -unitZ
            const curve = createBareCurve({ dn: () => XYZ.unitY });

            const normal = GeometryUtils.curveNormal(curve);

            expect(normal.isEqualTo(new XYZ({ x: 0, y: 0, z: -1 }))).toBe(true);
        });

        test("should unwrap a trimmed curve before computing the normal", () => {
            const basisCurve = createBareCurve({ dn: () => XYZ.unitY });
            const curve = createBareCurve({ basisCurve });

            const normal = GeometryUtils.curveNormal(curve);

            expect(normal.isEqualTo(new XYZ({ x: 0, y: 0, z: -1 }))).toBe(true);
        });
    });

    describe("isCCW", () => {
        test("should warn and use unitZ for an empty wire", () => {
            const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const wire = createMockWire([]);

                expect(GeometryUtils.isCCW(XYZ.unitZ, wire)).toBe(true);
                expect(warn).toHaveBeenCalledWith("Empty wire");
            } finally {
                warn.mockRestore();
            }
        });

        test("should use the curve normal for a single-edge wire", () => {
            const wire = createMockWire([createMockEdge()]);

            expect(GeometryUtils.isCCW(XYZ.unitZ, wire)).toBe(true);
            expect(GeometryUtils.isCCW(new XYZ({ x: 0, y: 0, z: -1 }), wire)).toBe(false);
        });

        test("should compute the normal from the first two edges of a forward wire", () => {
            // edge1 along +X from origin, edge2 along +Y from (10, 0, 0) => normal = +Z
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({ valueFn: (t) => new XYZ({ x: 10, y: t * 10, z: 0 }) }),
            });
            const wire = createMockWire([edge1, edge2]);

            expect(GeometryUtils.isCCW(XYZ.unitZ, wire)).toBe(true);
            expect(GeometryUtils.isCCW(new XYZ({ x: 0, y: 0, z: -1 }), wire)).toBe(false);
        });

        test("should reverse the normal for a reversed wire", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({ valueFn: (t) => new XYZ({ x: 10, y: t * 10, z: 0 }) }),
            });
            const wire = createMockWire([edge1, edge2], "reversed");

            expect(GeometryUtils.isCCW(XYZ.unitZ, wire)).toBe(false);
            expect(GeometryUtils.isCCW(new XYZ({ x: 0, y: 0, z: -1 }), wire)).toBe(true);
        });
    });

    describe("findNextEdge", () => {
        test("should find the edge connected at the end point of a forward edge", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({ curve: xSegmentCurve(new XYZ({ x: 10, y: 0, z: 0 })) });
            const wire = createMockWire([edge1, edge2]);

            const result = GeometryUtils.findNextEdge(wire, edge1);

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(edge2);
        });

        test("should match an edge whose last point touches the end point", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            // curve from (20, 0, 0) back to (10, 0, 0): last point touches edge1's end
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({ valueFn: (t) => new XYZ({ x: 20 - t * 10, y: 0, z: 0 }) }),
            });
            const wire = createMockWire([edge1, edge2]);

            const result = GeometryUtils.findNextEdge(wire, edge1);

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(edge2);
        });

        test("should use the first parameter as the end of a reversed edge", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve(), orientation: "reversed" });
            // curve from (-10, 0, 0) to (0, 0, 0): last point touches edge1's start
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({ valueFn: (t) => new XYZ({ x: t * 10 - 10, y: 0, z: 0 }) }),
            });
            const wire = createMockWire([edge1, edge2]);

            const result = GeometryUtils.findNextEdge(wire, edge1);

            expect(result.isOk).toBe(true);
            expect(result.value).toBe(edge2);
        });

        test("should return an error when no edge connects", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({ curve: xSegmentCurve(new XYZ({ x: 100, y: 0, z: 0 })) });
            const wire = createMockWire([edge1, edge2]);

            const result = GeometryUtils.findNextEdge(wire, edge1);

            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Cannot find next edge");
        });
    });

    describe("face planes", () => {
        test("should sample a valid normal when the face UV origin is degenerate", () => {
            const face = {
                shapeType: ShapeTypes.face,
                normal: (u: number, v: number) =>
                    u === 0 && v === 0 ? [XYZ.zero, XYZ.zero] : [XYZ.zero, XYZ.unitZ],
            } as unknown as IFace;

            const plane = GeometryUtils.planeFromFace(face);
            const upright = GeometryUtils.uprightPlaneFromFace(face);

            expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(upright.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(upright.xvec.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("should provide a stable x axis for a zero normal", () => {
            expect(GeometryUtils.worldAxisXVec(XYZ.zero).isEqualTo(XYZ.unitX)).toBe(true);
        });
    });

    describe("normal", () => {
        test("should return the normalized face normal at (0.5, 0.5)", () => {
            const face = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, new XYZ({ x: 0, y: 0, z: 5 })],
            } as unknown as IFace;

            const normal = GeometryUtils.normal(face);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should sample another uv when the face normal at (0.5, 0.5) is zero", () => {
            const face = {
                shapeType: ShapeTypes.face,
                normal: (u: number, v: number) =>
                    u === 0.5 && v === 0.5 ? [XYZ.zero, XYZ.zero] : [XYZ.zero, XYZ.unitZ],
            } as unknown as IFace;

            const normal = GeometryUtils.normal(face);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should warn and return unitZ when the face normal is zero at every sampled uv", () => {
            const face = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.zero],
            } as unknown as IFace;
            const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const normal = GeometryUtils.normal(face);

                expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
                expect(warn).toHaveBeenCalledWith("Cannot compute face normal, fallback to unitZ");
            } finally {
                warn.mockRestore();
            }
        });

        test("should use the plane spanned by two parallel line edges", () => {
            // Two parallel segments along +X, offset 5 in Y => normal = +Z.
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({ curve: xSegmentCurve(new XYZ({ x: 0, y: 5, z: 0 })) });
            const wire = createMockWire([edge1, edge2]);

            const normal = GeometryUtils.normal(wire);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should fall back to the curve normal when the first edge is closed", () => {
            // Closed first edge: start === end => zero direction; the mock curve's
            // basis conic axis (+Z) is the fallback normal.
            const closedCurve = createMockEdgeCurve({ valueFn: () => XYZ.zero });
            const edge1 = createMockEdge({ curve: closedCurve });
            const edge2 = createMockEdge({ curve: xSegmentCurve() });
            const wire = createMockWire([edge1, edge2]);

            const normal = GeometryUtils.normal(wire);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should return the curve normal for an edge", () => {
            const normal = GeometryUtils.normal(createMockEdge());

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });

        test("should return the wire normal for a wire", () => {
            const edge1 = createMockEdge({ curve: xSegmentCurve() });
            const edge2 = createMockEdge({
                curve: createMockEdgeCurve({ valueFn: (t) => new XYZ({ x: 10, y: t * 10, z: 0 }) }),
            });
            const wire = createMockWire([edge1, edge2]);

            const normal = GeometryUtils.normal(wire);

            expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
        });
    });

    describe("intersects", () => {
        test("should aggregate intersections from all edges", () => {
            const hit = { point: new XYZ({ x: 1, y: 2, z: 3 }), parameter: 0.5 };
            const other1 = createMockEdge();
            const other2 = createMockEdge();
            const edge = {
                intersect: (other: IEdge) => (other === other1 ? [hit] : []),
            } as unknown as IEdge;

            const result = GeometryUtils.intersects(edge, [other1, other2]);

            expect(result.length).toBe(1);
            expect(result[0].parameter).toBe(0.5);
            expect(result[0].point.isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBe(true);
        });

        test("should return an empty array when nothing intersects", () => {
            const edge = createMockEdge();

            const result = GeometryUtils.intersects(edge, [createMockEdge(), createMockEdge()]);

            expect(result.length).toBe(0);
        });

        test("should return an empty array for an empty edge list", () => {
            const result = GeometryUtils.intersects(createMockEdge(), []);

            expect(result.length).toBe(0);
        });
    });
});
