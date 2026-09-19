// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    combineUnitSpecs,
    LENGTH_UNITS,
    mergeUnitSpecs,
    UNITLESS,
    type UnitSpec,
    unitSpecEquals,
    unitSpecLabel,
    unitSpecOfType,
    unitSpecRoot,
} from "../src";

describe("unitSpecEquals", () => {
    test("compares by exponent, not by identity", () => {
        expect(unitSpecEquals(LENGTH_UNITS, { length: 1, angle: 0 })).toBe(true);
        expect(unitSpecEquals(LENGTH_UNITS, ANGLE_UNITS)).toBe(false);
        expect(unitSpecEquals(UNITLESS, { length: 0, angle: 0 })).toBe(true);
    });
});

describe("combineUnitSpecs", () => {
    test.each([
        { left: LENGTH_UNITS, right: UNITLESS, sign: 1 as const, expected: LENGTH_UNITS },
        { left: LENGTH_UNITS, right: UNITLESS, sign: -1 as const, expected: LENGTH_UNITS },
        { left: LENGTH_UNITS, right: LENGTH_UNITS, sign: -1 as const, expected: UNITLESS },
    ])("multiplying/dividing $left by $right gives $expected", ({ left, right, sign, expected }) => {
        expect(combineUnitSpecs(left, right, sign)).toEqual(expected);
    });

    test("multiplying two lengths gives an area, not a length", () => {
        const area: UnitSpec = { length: 2, angle: 0 };
        expect(combineUnitSpecs(LENGTH_UNITS, LENGTH_UNITS, 1)).toEqual(area);
        expect(combineUnitSpecs(area, LENGTH_UNITS, -1)).toEqual(LENGTH_UNITS);
    });

    test("angle exponents accumulate independently of length", () => {
        expect(combineUnitSpecs(ANGLE_UNITS, ANGLE_UNITS, 1)).toEqual({ length: 0, angle: 2 });
        expect(combineUnitSpecs(LENGTH_UNITS, ANGLE_UNITS, 1)).toEqual({ length: 1, angle: 1 });
    });
});

describe("mergeUnitSpecs", () => {
    test("merges equal quantities and lets a unitless side adopt the other", () => {
        expect(mergeUnitSpecs(LENGTH_UNITS, LENGTH_UNITS)).toEqual(LENGTH_UNITS);
        expect(mergeUnitSpecs(UNITLESS, LENGTH_UNITS)).toEqual(LENGTH_UNITS);
        expect(mergeUnitSpecs(ANGLE_UNITS, UNITLESS)).toEqual(ANGLE_UNITS);
        expect(mergeUnitSpecs(UNITLESS, UNITLESS)).toEqual(UNITLESS);
    });

    test("refuses a genuine conflict", () => {
        expect(mergeUnitSpecs(LENGTH_UNITS, ANGLE_UNITS)).toBeUndefined();
        expect(mergeUnitSpecs({ length: 2, angle: 0 }, LENGTH_UNITS)).toBeUndefined();
    });
});

describe("unitSpecRoot", () => {
    test("halves even exponents", () => {
        expect(unitSpecRoot({ length: 2, angle: 0 })).toEqual(LENGTH_UNITS);
        expect(unitSpecRoot({ length: -2, angle: 0 })).toEqual({ length: -1, angle: 0 });
        expect(unitSpecRoot(UNITLESS)).toEqual(UNITLESS);
    });

    test("refuses an odd exponent — length^0.5 is not a quantity", () => {
        expect(unitSpecRoot(LENGTH_UNITS)).toBeUndefined();
        expect(unitSpecRoot({ length: 2, angle: 1 })).toBeUndefined();
        expect(unitSpecRoot({ length: 0.5, angle: 0 })).toBeUndefined();
    });
});

describe("unitSpecLabel", () => {
    test.each([
        { unit: UNITLESS, expected: "unitless" },
        { unit: LENGTH_UNITS, expected: "length" },
        { unit: ANGLE_UNITS, expected: "angle" },
        { unit: { length: 2, angle: 0 }, expected: "length^2" },
        { unit: { length: 1, angle: 1 }, expected: "length*angle" },
    ])("labels $unit as $expected", ({ unit, expected }) => {
        expect(unitSpecLabel(unit)).toBe(expected);
    });
});

describe("unitSpecOfType", () => {
    test.each([
        { type: "length" as const, expected: LENGTH_UNITS },
        { type: "angle" as const, expected: ANGLE_UNITS },
        { type: "unitless" as const, expected: UNITLESS },
    ])("maps $type", ({ type, expected }) => {
        expect(unitSpecOfType(type)).toEqual(expected);
    });
});
