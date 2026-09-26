// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../src/math";
import {
    angularDimensionLayout,
    angularDimensionSweep,
    diameterDimensionLayout,
    dimensionLayoutFor,
    linearDimensionLayout,
    nearestDimensionNormal,
    radialDimensionLayout,
} from "../src/model/dimensionLayout";

const START = XYZ.zero;
const END = new XYZ({ x: 10, y: 0, z: 0 });
const PX = 0.1;

describe("linearDimensionLayout", () => {
    test("should lay out an aligned dimension beside the measured segment", () => {
        const layout = linearDimensionLayout(START, END, new XYZ({ x: 5, y: 5, z: 0 }), PX);
        expect(layout).toBeDefined();
        expect(layout!.normal.z).toBeCloseTo(1);
        expect(layout!.direction.x).toBeCloseTo(1);
        expect(layout!.direction.y).toBeCloseTo(0);
        expect(layout!.side.x).toBeCloseTo(0);
        expect(layout!.side.y).toBeCloseTo(1);

        const s = layout!.segments;
        expect(s).toHaveLength(18);

        // extension line at start: gap 3px, overshoot 4px past the dimension line
        expect(s[0]).toBeCloseTo(0);
        expect(s[1]).toBeCloseTo(0.3);
        expect(s[3]).toBeCloseTo(0);
        expect(s[4]).toBeCloseTo(5.4);
        // extension line at end
        expect(s[6]).toBeCloseTo(10);
        expect(s[7]).toBeCloseTo(0.3);
        expect(s[10]).toBeCloseTo(5.4);
        // dimension line, parallel to the measured segment at the picked offset
        expect(s[12]).toBeCloseTo(0);
        expect(s[13]).toBeCloseTo(5);
        expect(s[15]).toBeCloseTo(10);
        expect(s[16]).toBeCloseTo(5);

        // solid arrowheads: tips on the extension lines, 10px long, 20° half angle
        const t = layout!.triangles;
        expect(t).toHaveLength(18);
        expect([t[0], t[1], t[2]]).toEqual([0, 5, 0]);
        expect(t[3]).toBeCloseTo(Math.cos(Math.PI / 9));
        expect(t[4]).toBeCloseTo(5 + Math.sin(Math.PI / 9));
        expect(t[7]).toBeCloseTo(5 - Math.sin(Math.PI / 9));
        expect([t[9], t[10], t[11]]).toEqual([10, 5, 0]);
        expect(t[12]).toBeCloseTo(10 - Math.cos(Math.PI / 9));

        // text sits at the picked position along the line, half a text height above it
        expect(layout!.textPosition.x).toBeCloseTo(5);
        expect(layout!.textPosition.y).toBeCloseTo(5.6);
        expect(layout!.textPosition.z).toBeCloseTo(0);
    });

    test("should follow the offset side of the text point", () => {
        const layout = linearDimensionLayout(START, END, new XYZ({ x: 5, y: -5, z: 0 }), PX);
        expect(layout).toBeDefined();
        expect(layout!.segments[13]).toBeCloseTo(-5);
        expect(layout!.textPosition.y).toBeCloseTo(-5.6);
    });

    test("should enforce a minimum offset", () => {
        const layout = linearDimensionLayout(START, END, new XYZ({ x: 5, y: 0.05, z: 0 }), PX);
        expect(layout).toBeDefined();
        expect(layout!.segments[13]).toBeCloseTo(1.4);
    });

    test("should fall back to any containing plane when the text point is on the line", () => {
        const layout = linearDimensionLayout(START, END, new XYZ({ x: 5, y: 0, z: 0 }), PX);
        expect(layout).toBeDefined();
        expect(Math.abs(layout!.normal.length() - 1)).toBeLessThan(1e-9);
    });

    test("should return undefined for degenerate input", () => {
        expect(linearDimensionLayout(START, START, XYZ.unitY, PX)).toBeUndefined();
        expect(linearDimensionLayout(START, END, XYZ.unitY, 0)).toBeUndefined();
    });
});

describe("nearestDimensionNormal", () => {
    test("picks the principal plane containing an axis-aligned direction, facing the view", () => {
        // measuring along X, viewed from the front: the XZ plane faces the user
        const normal = nearestDimensionNormal(XYZ.unitX, XYZ.unitNY);
        expect(normal.x).toBeCloseTo(0);
        expect(normal.y).toBeCloseTo(1);
        expect(normal.z).toBeCloseTo(0);
    });

    test("tie between two containing planes goes to the one most facing the view", () => {
        // measuring along X, viewed from above: the XY plane faces the user
        const normal = nearestDimensionNormal(XYZ.unitX, XYZ.unitNZ);
        expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("snaps a near-planar skew direction to the closest principal plane", () => {
        const dir = new XYZ({ x: 1, y: 0.05, z: 0.02 }).normalize()!;
        const normal = nearestDimensionNormal(dir, XYZ.unitNZ);

        // closest to the XY plane: normal ≈ Z, orthogonalized against dir
        expect(normal.z).toBeGreaterThan(0.99);
        expect(normal.dot(dir)).toBeCloseTo(0, 9);
        expect(Math.abs(normal.length() - 1)).toBeLessThan(1e-9);
    });

    test("a diagonal direction ties on every axis and follows the view", () => {
        const dir = new XYZ({ x: 1, y: 1, z: 1 }).normalize()!;
        const normal = nearestDimensionNormal(dir, XYZ.unitNY);

        // Y faces the view most; orthogonalized against dir it leaves the YZ tilt
        expect(normal.dot(dir)).toBeCloseTo(0, 9);
        expect(normal.y).toBeGreaterThan(Math.abs(normal.x));
        expect(normal.y).toBeGreaterThan(Math.abs(normal.z));
    });

    test("never degenerates when the direction itself is an axis", () => {
        for (const dir of [XYZ.unitX, XYZ.unitY, XYZ.unitZ]) {
            const normal = nearestDimensionNormal(dir, XYZ.unitNZ);
            expect(Math.abs(normal.length() - 1)).toBeLessThan(1e-9);
            expect(normal.dot(dir)).toBeCloseTo(0, 9);
        }
    });
});

describe("radialDimensionLayout", () => {
    const CENTER = XYZ.zero;
    const RIM = new XYZ({ x: 10, y: 0, z: 0 });

    test("draws a leader from the center through the rim to the label", () => {
        const layout = radialDimensionLayout(CENTER, RIM, new XYZ({ x: 20, y: 3, z: 0 }), PX)!;
        expect(layout).toBeDefined();
        expect(layout.direction.x).toBeCloseTo(1);
        expect(layout.normal.z).toBeCloseTo(1);
        expect(layout.side.y).toBeCloseTo(1);

        const labelDistance = Math.hypot(20, 3);
        const s = layout.segments;
        // one leader, nothing else — the arrowhead is a triangle now
        expect(s).toHaveLength(6);
        expect([s[0], s[1], s[2]]).toEqual([0, 0, 0]);
        expect(s[3]).toBeCloseTo(labelDistance);
        expect(s[4]).toBeCloseTo(0);
        // solid arrowhead: tip on the rim pointing outward, base corners behind it
        const t = layout.triangles;
        expect(t).toHaveLength(9);
        expect([t[0], t[1], t[2]]).toEqual([10, 0, 0]);
        expect(t[3]).toBeLessThan(10);
        expect(t[6]).toBeLessThan(10);

        expect(layout.textPosition.x).toBeCloseTo(labelDistance);
        expect(layout.textPosition.y).toBeCloseTo(0.6);
    });

    test("pushes a label picked inside the circle out past the rim", () => {
        const layout = radialDimensionLayout(CENTER, RIM, new XYZ({ x: 5, y: 0, z: 0 }), PX)!;
        // label distance = radius + 20px margin = 10 + 2
        expect(layout.segments[3]).toBeCloseTo(12);
    });

    test("returns undefined for degenerate input", () => {
        expect(radialDimensionLayout(CENTER, CENTER, XYZ.unitX, PX)).toBeUndefined();
        expect(radialDimensionLayout(CENTER, RIM, XYZ.unitX, 0)).toBeUndefined();
    });

    test("the stored circle axis keeps the arrows in the circle plane", () => {
        // the text point is collinear with the leader — without the circle axis
        // the plane derivation falls back to an arbitrary seed normal
        const text = new XYZ({ x: 20, y: 0, z: 0 });
        const layout = radialDimensionLayout(CENTER, RIM, text, PX, XYZ.unitZ)!;
        expect(layout.normal.z).toBeCloseTo(1);
        // every segment endpoint stays in the circle plane (z = 0)
        for (const z of layout.segments.filter((_, i) => i % 3 === 2)) {
            expect(z).toBeCloseTo(0, 9);
        }
        // and so does every arrowhead corner
        for (const z of layout.triangles.filter((_, i) => i % 3 === 2)) {
            expect(z).toBeCloseTo(0, 9);
        }

        // legacy annotations without a stored axis still lay out (seed fallback)
        expect(radialDimensionLayout(CENTER, RIM, text, PX)).toBeDefined();
    });
});

describe("diameterDimensionLayout", () => {
    const RIM1 = new XYZ({ x: -10, y: 0, z: 0 });
    const RIM2 = new XYZ({ x: 10, y: 0, z: 0 });

    test("draws the line across the center with outward arrows at both rims", () => {
        const layout = diameterDimensionLayout(RIM1, RIM2, new XYZ({ x: 14, y: 2, z: 0 }), PX)!;
        expect(layout).toBeDefined();
        expect(Math.abs(layout.direction.x)).toBeCloseTo(1);

        const s = layout.segments;
        // one dimension line — the arrowheads are triangles now
        expect(s).toHaveLength(6);
        // the line runs from the far rim to the label
        expect([s[0], s[1], s[2]]).toEqual([-10, 0, 0]);
        expect(s[3]).toBeCloseTo(14);
        // solid arrowheads with their tips at both rims
        const t = layout.triangles;
        expect(t).toHaveLength(18);
        expect([t[0], t[1], t[2]]).toEqual([-10, 0, 0]);
        expect([t[9], t[10], t[11]]).toEqual([10, 0, 0]);

        expect(layout.textPosition.x).toBeCloseTo(14);
    });

    test("follows the text point to the other side", () => {
        const layout = diameterDimensionLayout(RIM1, RIM2, new XYZ({ x: -14, y: 2, z: 0 }), PX)!;
        // the dimension line now extends toward -X
        expect([layout.segments[0], layout.segments[1], layout.segments[2]]).toEqual([10, 0, 0]);
        expect(layout.segments[3]).toBeCloseTo(-14);
        expect(layout.textPosition.x).toBeCloseTo(-14);
    });

    test("pushes a label picked inside the circle out past the rim", () => {
        const layout = diameterDimensionLayout(RIM1, RIM2, new XYZ({ x: 3, y: 0, z: 0 }), PX)!;
        expect(layout.segments[3]).toBeCloseTo(12);
    });

    test("returns undefined for degenerate input", () => {
        expect(diameterDimensionLayout(RIM1, RIM1, XYZ.unitX, PX)).toBeUndefined();
    });
});

describe("angularDimensionLayout", () => {
    const VERTEX = XYZ.zero;
    const P1 = XYZ.unitX;
    const P2 = XYZ.unitY;

    test("draws a 90° arc with tangent arrows and the text on the bisector", () => {
        const layout = angularDimensionLayout(VERTEX, P1, P2, new XYZ({ x: 2, y: 2, z: 0 }), PX)!;
        expect(layout).toBeDefined();
        expect(layout.normal.z).toBeCloseTo(1);
        // the text frame is right-handed, like the linear layout's
        expect(layout.direction.cross(layout.side).dot(layout.normal)).toBeCloseTo(1, 9);

        const radius = Math.hypot(2, 2);
        // 8 arc segments (π/2 sweep); the two arrowheads are triangles
        expect(layout.segments).toHaveLength(8 * 6);
        expect(layout.triangles).toHaveLength(2 * 9);
        // the arc starts on d1 and ends on d2
        expect(layout.segments[0]).toBeCloseTo(radius);
        expect(layout.segments[1]).toBeCloseTo(0);
        expect(layout.segments[8 * 6 - 3]).toBeCloseTo(0);
        expect(layout.segments[8 * 6 - 2]).toBeCloseTo(radius);
        expect(layout.segments[8 * 6 - 1]).toBeCloseTo(0);
        // arrow tips at the arc ends
        expect(layout.triangles[0]).toBeCloseTo(radius);
        expect(layout.triangles[1]).toBeCloseTo(0);
        expect(layout.triangles[9]).toBeCloseTo(0);
        expect(layout.triangles[10]).toBeCloseTo(radius);

        // text on the bisector past the arc
        const textRadius = radius + 14 * PX;
        expect(layout.textPosition.x).toBeCloseTo(textRadius * Math.SQRT1_2);
        expect(layout.textPosition.y).toBeCloseTo(textRadius * Math.SQRT1_2);
        // baseline tangent to the arc, up along the bisector
        expect(layout.side.x).toBeCloseTo(Math.SQRT1_2);
        expect(layout.direction.x).toBeCloseTo(Math.SQRT1_2);
        expect(layout.direction.y).toBeCloseTo(-Math.SQRT1_2);
    });

    test("clamps the arc radius to the minimum when the pick is close", () => {
        const layout = angularDimensionLayout(VERTEX, P1, P2, new XYZ({ x: 0.1, y: 0.1, z: 0 }), PX)!;
        expect(layout.segments[0]).toBeCloseTo(24 * PX);
    });

    test("sweeps the reflex angle when the text sits outside the smaller sweep", () => {
        const layout = angularDimensionLayout(VERTEX, P1, P2, new XYZ({ x: -2, y: -2, z: 0 }), PX)!;
        // 270° sweep: 24 arc segments; the two arrowheads are triangles
        expect(layout.segments).toHaveLength(24 * 6);
        expect(layout.triangles).toHaveLength(2 * 9);
        // bisector of the reflex sweep points opposite the small-angle bisector
        expect(layout.side.x).toBeCloseTo(-Math.SQRT1_2);
        expect(layout.side.y).toBeCloseTo(-Math.SQRT1_2);
    });

    test("returns undefined for parallel directions or a degenerate vertex", () => {
        expect(angularDimensionLayout(VERTEX, P1, P1, XYZ.unitX, PX)).toBeUndefined();
        expect(angularDimensionLayout(VERTEX, VERTEX, P2, XYZ.unitX, PX)).toBeUndefined();
        expect(angularDimensionLayout(VERTEX, P1, P2, XYZ.unitX, 0)).toBeUndefined();
    });
});

describe("angularDimensionSweep", () => {
    const VERTEX = XYZ.zero;
    const P1 = XYZ.unitX;
    const P2 = XYZ.unitY;

    test("reports the smaller sweep while the text sits inside it", () => {
        const sweep = angularDimensionSweep(VERTEX, P1, P2, new XYZ({ x: 2, y: 2, z: 0 }))!;
        expect((sweep * 180) / Math.PI).toBeCloseTo(90);
    });

    test("reports the reflex sweep when the text sits outside it", () => {
        const sweep = angularDimensionSweep(VERTEX, P1, P2, new XYZ({ x: -2, y: -2, z: 0 }))!;
        expect((Math.abs(sweep) * 180) / Math.PI).toBeCloseTo(270);
    });

    test("falls back to the smaller sweep when the text sits on the vertex", () => {
        const sweep = angularDimensionSweep(VERTEX, P1, P2, VERTEX)!;
        expect((sweep * 180) / Math.PI).toBeCloseTo(90);
    });

    test("returns undefined for parallel directions", () => {
        expect(angularDimensionSweep(VERTEX, P1, P1, XYZ.unitX)).toBeUndefined();
    });
});

describe("dimensionLayoutFor", () => {
    test("dispatches every dimension kind to its layout", () => {
        const text = new XYZ({ x: 20, y: 3, z: 0 });
        expect(dimensionLayoutFor("linear", START, END, text, PX)).toBeDefined();
        expect(
            dimensionLayoutFor("radial", XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), text, PX),
        ).toBeDefined();
        expect(
            dimensionLayoutFor(
                "diameter",
                new XYZ({ x: -10, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                text,
                PX,
            ),
        ).toBeDefined();
        expect(dimensionLayoutFor("angular", XYZ.unitX, XYZ.unitY, text, PX, XYZ.zero)).toBeDefined();
        // an angular dimension without a vertex is degenerate
        expect(dimensionLayoutFor("angular", XYZ.unitX, XYZ.unitY, text, PX)).toBeUndefined();
    });
});
