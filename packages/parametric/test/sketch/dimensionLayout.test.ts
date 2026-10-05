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

    test("a diameter reads as twice the radius it is stored as, and stores as half", () => {
        // garlic has no diameter constraint: the datum is the radius, the reading is Ø
        expect(toDisplayDatum(ConstraintKind.Radius, 30, "diameter")).toBe(60);
        expect(toStorageDatum(ConstraintKind.Radius, 60, "diameter")).toBe(30);
        // ...and a radius is the radius, both ways
        expect(toDisplayDatum(ConstraintKind.Radius, 30, "radius")).toBe(30);
        expect(toStorageDatum(ConstraintKind.Radius, 60, "radius")).toBe(60);
    });

    test("the diameter reading does not leak into other kinds", () => {
        const display = "diameter" as const;
        expect(toDisplayDatum(ConstraintKind.P2PDistance, 12.5, display)).toBe(12.5);
        expect(toStorageDatum(ConstraintKind.P2PDistance, 12.5, display)).toBe(12.5);
        expect(toStorageDatum(ConstraintKind.Angle, 180, display)).toBeCloseTo(Math.PI, 9);
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

    test("a diameter reads with the Ø over twice the stored radius", () => {
        expect(formatDatum(ConstraintKind.Radius, 30, "diameter")).toBe("Ø60.00");
        expect(formatDatum(ConstraintKind.Radius, 30)).toBe("R30.00");
    });

    test("a diameter expression reads as written, not as the radius it stores", () => {
        // the source is written in the reading's units, so `w` is the Ø the user typed;
        // wrapping it in the halving on the way in would show `(w) / 2` here
        expect(formatDatum(ConstraintKind.Radius, "w", "diameter")).toBe("w");
        expect(formatDatum(ConstraintKind.Radius, "w / 2", "radius")).toBe("w / 2");
    });
});
