// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { formatDatum, toDisplayDatum, toStorageDatum } from "../../src/sketch/editor/dimensionLayout";
import { ConstraintKind } from "../../src/sketch/sketchModel";

describe("toDisplayDatum / toStorageDatum", () => {
    test("angles convert between radians and degrees, displaying the magnitude", () => {
        expect(toDisplayDatum(ConstraintKind.Angle, Math.PI)).toBeCloseTo(180, 9);
        expect(toStorageDatum(ConstraintKind.Angle, 180)).toBeCloseTo(Math.PI, 9);
        // the stored sweep is signed (sign = side); the UI shows its magnitude
        expect(toDisplayDatum(ConstraintKind.Angle, -Math.PI / 4)).toBeCloseTo(45, 9);
    });

    test("point-line distance flips sign between UI and storage", () => {
        expect(toDisplayDatum(ConstraintKind.P2LDistance, -30)).toBe(30);
        expect(toStorageDatum(ConstraintKind.P2LDistance, 30)).toBe(-30);
        expect(
            toDisplayDatum(ConstraintKind.P2LDistance, toStorageDatum(ConstraintKind.P2LDistance, 7)),
        ).toBe(7);
    });

    test("other kinds pass values through unchanged", () => {
        expect(toDisplayDatum(ConstraintKind.P2PDistance, 12.5)).toBe(12.5);
        expect(toStorageDatum(ConstraintKind.P2PDistance, 12.5)).toBe(12.5);
    });

    test("display and storage conversions round-trip", () => {
        const stored = toStorageDatum(
            ConstraintKind.Angle,
            toDisplayDatum(ConstraintKind.Angle, Math.PI / 3),
        );
        expect(stored).toBeCloseTo(Math.PI / 3, 9);
        expect(
            toDisplayDatum(ConstraintKind.P2PDistance, toStorageDatum(ConstraintKind.P2PDistance, 7)),
        ).toBe(7);
    });
});

describe("formatDatum", () => {
    test("a literal reads as its display value, with the affix its kind carries", () => {
        expect(formatDatum(ConstraintKind.P2PDistance, 12.345)).toBe("12.35");
        expect(formatDatum(ConstraintKind.HorizontalDistance, 80)).toBe("80.00");
        // the radius prefix and the degree sign belong to the datum, not to the caller
        expect(formatDatum(ConstraintKind.Radius, 30)).toBe("R30.00");
        // the datum is stored in radians and displayed in degrees, to one place
        expect(formatDatum(ConstraintKind.Angle, Math.PI / 6)).toBe("30.0°");
        // stored negative for a point on the right of the line, displayed positive
        expect(formatDatum(ConstraintKind.P2LDistance, -30)).toBe("30.00");
    });

    test("an expression reads as written — that name is the user's intent", () => {
        expect(formatDatum(ConstraintKind.P2PDistance, "width*2")).toBe("width*2");
        expect(formatDatum(ConstraintKind.Angle, "45")).toBe("45");
    });
});
