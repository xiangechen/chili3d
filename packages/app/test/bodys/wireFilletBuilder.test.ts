// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, MathUtils, Precision, ShapeTypes, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { WireFilletBuilder } from "../../src/bodys/pipe";

/**
 * Helpers to create mock IEdge objects for WireFilletBuilder tests.
 */
function makeEdge(firstParam: number, lastParam: number, points: XYZ[]): IEdge {
    // points[0] is at firstParam, points[last] is at lastParam
    const pointAtParam = (t: number): XYZ => {
        const totalRange = lastParam - firstParam;
        if (totalRange <= 0) return points[0];
        const frac = (t - firstParam) / totalRange;
        const idx = Math.min(Math.floor(frac * (points.length - 1)), points.length - 2);
        const localFrac = frac * (points.length - 1) - idx;
        return points[idx].add(points[idx + 1].sub(points[idx]).multiply(localFrac));
    };

    return {
        shapeType: ShapeTypes.edge,
        curve: {
            firstParameter: () => firstParam,
            lastParameter: () => lastParam,
            value: (t: number) => pointAtParam(t),
        },
    } as unknown as IEdge;
}

describe("WireFilletBuilder", () => {
    const builder = new WireFilletBuilder();

    describe("extractVertices", () => {
        test("should extract vertices from a single edge", () => {
            const e = makeEdge(0, 1, [new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 0, z: 0 })]);
            const verts = (builder as any).extractVertices([e]);
            expect(verts).toHaveLength(2);
            expect(verts[0].x).toBe(0);
            expect(verts[1].x).toBe(1);
        });

        test("should extract vertices from multiple connected edges", () => {
            const e1 = makeEdge(0, 1, [new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 0, z: 0 })]);
            const e2 = makeEdge(0, 1, [new XYZ({ x: 1, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 0 })]);
            const e3 = makeEdge(0, 1, [new XYZ({ x: 1, y: 1, z: 0 }), new XYZ({ x: 0, y: 1, z: 0 })]);
            const verts = (builder as any).extractVertices([e1, e2, e3]);
            // first edge start + each edge last = 1 + 3 = 4
            expect(verts).toHaveLength(4);
            expect(verts[0].x).toBe(0);
            expect(verts[0].y).toBe(0);
            expect(verts[1].x).toBe(1);
            expect(verts[1].y).toBe(0);
            expect(verts[2].x).toBe(1);
            expect(verts[2].y).toBe(1);
            expect(verts[3].x).toBe(0);
            expect(verts[3].y).toBe(1);
        });
    });

    describe("computeCornerDirs", () => {
        test("should compute directions for a right-angle corner", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 }); // incoming from left
            const P_next = new XYZ({ x: 0, y: 1, z: 0 }); // going up

            const result = (builder as any).computeCornerDirs(V, P_prev, P_next);
            expect(result).not.toBeNull();

            const { u, v, angle, halfAngle } = result!;
            // u should point from V toward P_prev: (-1,0,0) → u = (1,0,0) wait no
            // P_prev.sub(V) = (-1,0,0), normalize → (-1,0,0). So u points left.
            // Wait: u = P_prev.sub(V).normalize() = (-1,0,0) → normalized to (-1,0,0)
            // v = P_next.sub(V).normalize() = (0,1,0)
            expect(u.x).toBeCloseTo(-1);
            expect(u.y).toBeCloseTo(0);
            expect(v.x).toBeCloseTo(0);
            expect(v.y).toBeCloseTo(1);
            // angle between (-1,0) and (0,1) = 90deg = Math.PI/2
            expect(angle).toBeCloseTo(Math.PI / 2);
            expect(halfAngle).toBeCloseTo(Math.PI / 4);
        });

        test("should return null for parallel edges going same direction", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 });
            const P_next = new XYZ({ x: 1, y: 0, z: 0 }); // opposite directions → parallel check depends on isParallelTo

            // P_prev.sub(V) = (-1,0,0)
            // P_next.sub(V) = (1,0,0)
            // isParallelTo checks if cross product is zero-ish
            // These ARE parallel (both along X axis, opposite directions)
            // But the code also checks isOppositeTo!
            const result = (builder as any).computeCornerDirs(V, P_prev, P_next);
            expect(result).toBeNull();
        });

        test("should return null for collinear edges (180 degrees)", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 });
            const P_next = new XYZ({ x: -2, y: 0, z: 0 }); // same direction = collinear

            const result = (builder as any).computeCornerDirs(V, P_prev, P_next);
            expect(result).toBeNull();
        });

        test("should compute directions for acute angle", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 });
            const P_next = new XYZ({ x: -1, y: 1, z: 0 }); // 45 degrees from V

            const result = (builder as any).computeCornerDirs(V, P_prev, P_next);
            expect(result).not.toBeNull();
            // u = (-1, 0)/1 = (-1, 0), v = (-1, 1)/√2 ≈ (-0.707, 0.707)
            // angle between u and v ≈ 135°? No: dot = (-1)(-0.707) + 0*0.707 = 0.707 → acos(0.707) ≈ 45° = π/4
            expect(result!.angle).toBeCloseTo(Math.PI / 4, 3);
            expect(result!.halfAngle).toBeCloseTo(Math.PI / 8, 3);
        });
    });

    describe("tryComputeFillet", () => {
        test("should compute fillet geometry for a 90° corner", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: 0, y: -5, z: 0 }); // from below
            const P_next = new XYZ({ x: 5, y: 0, z: 0 }); // to right

            const result = (builder as any).tryComputeFillet(V, P_prev, P_next, 2);
            expect(result).not.toBeNull();

            const geom = result!;
            expect(geom.angle).toBeCloseTo(Math.PI / 2);
            expect(geom.normal).toBeDefined();
            expect(geom.center).toBeDefined();
            expect(geom.arcStart).toBeDefined();
            expect(geom.arcAngleDeg).toBeGreaterThan(0);
            expect(geom.arcAngleDeg).toBeLessThan(180);
        });

        test("should clamp tangentLen to prevent self-intersection", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: 0, y: -2, z: 0 });
            const P_next = new XYZ({ x: 2, y: 0, z: 0 });

            // radius 100 would normally cause tangentLen >> distance
            const result = (builder as any).tryComputeFillet(V, P_prev, P_next, 100);
            expect(result).not.toBeNull();
            // tangentLen should be clamped
            expect(result!.tangentLen).toBeLessThanOrEqual(2 / 2.05 + Precision.Distance);
        });

        test("should return null when corner is too sharp (180 deg)", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 });
            const P_next = new XYZ({ x: -2, y: 0, z: 0 });

            const result = (builder as any).tryComputeFillet(V, P_prev, P_next, 1);
            expect(result).toBeNull();
        });

        test("should return null for parallel opposite direction edges", () => {
            const V = XYZ.zero;
            const P_prev = new XYZ({ x: -1, y: 0, z: 0 });
            const P_next = new XYZ({ x: 1, y: 0, z: 0 });

            const result = (builder as any).tryComputeFillet(V, P_prev, P_next, 1);
            expect(result).toBeNull();
        });
    });

    describe("addLineSegment", () => {
        test("should not add segment when distance is below precision", () => {
            const outEdges: IEdge[] = [];
            const from = new XYZ({ x: 0, y: 0, z: 0 });
            const to = new XYZ({ x: 1e-10, y: 0, z: 0 });
            (builder as any).addLineSegment(from, to, outEdges);
            // distance is tiny, so no line should be added
            expect(outEdges).toHaveLength(0);
        });
    });
});
