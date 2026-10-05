// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IView, Plane, Ray, XYZ } from "@chili3d/core";
import { createMockView } from "@chili3d/core/test-utils";
import { ConstraintKind, datumIsSigned, viewPixelSize, worldPerPixel } from "../../src/sketch/sketchModel";

/**
 * An orthographic-style view whose rays are consistent with `direction`: adjacent
 * horizontal pixels shift the ray origin by one world unit along the screen-right
 * axis, so a correct pixel-size measure reads exactly 1 at any view angle.
 */
function orthoView(direction: XYZ, up: XYZ = XYZ.unitY): IView {
    const d = direction.normalize()!;
    let right = d.cross(up);
    if (right.lengthSq() < 1e-12) right = XYZ.unitY.reverse();
    const step = right.normalize()!;
    return createMockView({
        direction: () => d,
        up: () => up,
        rayAt: (mx, _my) =>
            new Ray({
                point: step.multiply(mx - 400).sub(d.multiply(500)),
                direction: d,
            }),
    });
}

describe("viewPixelSize", () => {
    test("matches the on-plane measure when the view faces the plane", () => {
        const view = orthoView(XYZ.unitZ.reverse());
        expect(viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
        expect(worldPerPixel(view, Plane.XY, 400, 300)).toBeCloseTo(1);
    });

    test("stays bounded when the sketch plane is viewed edge-on", () => {
        // Orbiting to a side view aligns the screen-right axis with the YZ plane
        // normal, so the on-plane measure explodes...
        const view = orthoView(new XYZ({ x: 0.02, y: -1, z: 0 }), XYZ.unitZ);
        expect(worldPerPixel(view, Plane.YZ, 400, 300)).toBeGreaterThan(10);
        // ...while the perpendicular measure keeps its exact value
        expect(viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
    });

    test("picks any perpendicular when the view runs along the up axis", () => {
        const view = orthoView(XYZ.unitZ, XYZ.unitZ);
        expect(viewPixelSize(view, XYZ.zero)).toBeCloseTo(1);
    });
});

describe("datumIsSigned", () => {
    // The dialogs refuse a minus sign for everything else, so this is the one place that
    // decides it — the tools used to write the set of kinds out for themselves.
    test.each([
        [ConstraintKind.P2LDistance, true],
        [ConstraintKind.HorizontalDistance, true],
        [ConstraintKind.VerticalDistance, true],
        [ConstraintKind.Fix, true],
        [ConstraintKind.P2PDistance, false],
        [ConstraintKind.Radius, false],
        [ConstraintKind.Angle, false],
    ])("%s is signed: %s", (kind, signed) => {
        expect(datumIsSigned(kind)).toBe(signed);
    });
});
