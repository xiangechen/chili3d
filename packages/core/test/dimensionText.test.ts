// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    formatMeasurement,
    measurementAffixes,
    measurementDecimals,
    measurementText,
} from "../src/model/dimensionText";

describe("measurementDecimals", () => {
    test("angles read to one place, every other measurement to two", () => {
        expect(measurementDecimals("angle")).toBe(1);
        expect(measurementDecimals("length")).toBe(2);
        expect(measurementDecimals("radius")).toBe(2);
        expect(measurementDecimals("diameter")).toBe(2);
    });
});

describe("measurementAffixes", () => {
    test("a radius reads with R, a diameter with Ø, an angle with its degree sign", () => {
        expect(measurementAffixes("radius")).toEqual({ prefix: "R", suffix: "" });
        expect(measurementAffixes("diameter")).toEqual({ prefix: "Ø", suffix: "" });
        expect(measurementAffixes("angle")).toEqual({ prefix: "", suffix: "°" });
        expect(measurementAffixes("length")).toEqual({ prefix: "", suffix: "" });
    });
});

describe("measurementText", () => {
    test("splits the digits from the affixes, so a text override can take the digits", () => {
        expect(measurementText("angle", 45)).toEqual({ value: "45.0", prefix: "", suffix: "°" });
        expect(measurementText("radius", 12.345)).toEqual({ value: "12.35", prefix: "R", suffix: "" });
    });

    test("the caller's digit count wins over the kind's own", () => {
        expect(measurementText("radius", 12.345, 1).value).toBe("12.3");
    });
});

describe("formatMeasurement", () => {
    test("reads a value with its kind's digits and affixes", () => {
        expect(formatMeasurement("length", 12.345)).toBe("12.35");
        expect(formatMeasurement("radius", 30)).toBe("R30.00");
        expect(formatMeasurement("diameter", 15)).toBe("Ø15.00");
        expect(formatMeasurement("angle", 45)).toBe("45.0°");
    });

    test("rounds rather than truncating", () => {
        expect(formatMeasurement("length", 12.3456)).toBe("12.35");
        expect(formatMeasurement("angle", 44.96)).toBe("45.0°");
    });
});
