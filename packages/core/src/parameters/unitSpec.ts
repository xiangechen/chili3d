// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A unit spec: the exponents of the two base dimensions a feature parameter can
 * carry. Unitless is both zero, length is `{length: 1}`, angle is `{angle: 1}`.
 * Multiplication and division move the exponents, so `w * h` is an area and
 * `w / h` is unitless.
 */
export interface UnitSpec {
    readonly length: number;
    readonly angle: number;
}

export const UNITLESS: UnitSpec = { length: 0, angle: 0 };
export const LENGTH_UNITS: UnitSpec = { length: 1, angle: 0 };
export const ANGLE_UNITS: UnitSpec = { length: 0, angle: 1 };

export function unitSpecEquals(a: UnitSpec, b: UnitSpec): boolean {
    return a.length === b.length && a.angle === b.angle;
}

/** Divides (`sign = -1`) or multiplies (`sign = 1`) two specs: exponents subtract or add. */
export function combineUnitSpecs(a: UnitSpec, b: UnitSpec, sign: 1 | -1): UnitSpec {
    return { length: a.length + sign * b.length, angle: a.angle + sign * b.angle };
}

/**
 * Halves the exponents — the spec of a square root. Undefined when an exponent is odd:
 * `sqrt(w * h)` (an area) is a length, but `sqrt(w)` would have to be `length^0.5`,
 * which is not a quantity any parameter can carry. Onshape's FeatureScript draws the
 * line in the same place — its `sqrt` takes "any value whose units are even powers".
 */
export function unitSpecRoot(value: UnitSpec): UnitSpec | undefined {
    if (isOddExponent(value.length) || isOddExponent(value.angle)) return undefined;
    return { length: value.length / 2, angle: value.angle / 2 };
}

/** True for an exponent with no whole-number half — `1`, `-1` and `0.5` are all odd here. */
function isOddExponent(exponent: number): boolean {
    return exponent % 2 !== 0;
}

/**
 * The unit two addends must agree on (`+`, `-`, `%`, `min`, `max`): both the
 * same, or one of them unitless. Undefined when they genuinely conflict — the
 * caller reports a mismatch instead of picking a side.
 */
export function mergeUnitSpecs(a: UnitSpec, b: UnitSpec): UnitSpec | undefined {
    if (unitSpecEquals(a, b)) return a;
    if (unitSpecEquals(a, UNITLESS)) return b;
    if (unitSpecEquals(b, UNITLESS)) return a;
    return undefined;
}

/** Readable name for error messages ("length", "angle", "length^2", ...). */
export function unitSpecLabel(value: UnitSpec): string {
    const parts: string[] = [];
    if (value.length !== 0) parts.push(value.length === 1 ? "length" : `length^${value.length}`);
    if (value.angle !== 0) parts.push(value.angle === 1 ? "angle" : `angle^${value.angle}`);
    return parts.length === 0 ? "unitless" : parts.join("*");
}

/**
 * The unit specs a user may declare for a variable. Areas and volumes are not
 * offered — they only arise from expressions.
 */
export type VariableType = "length" | "angle" | "unitless";

/**
 * Guards a row's `type` field. A stored table is JSON, so the declared type arrives as
 * `unknown` whatever the interface says — and `unitSpecOfType` has no case for a value
 * outside the union, which would hand an `undefined` unit to every arithmetic check.
 */
export function isVariableType(value: unknown): value is VariableType {
    return value === "length" || value === "angle" || value === "unitless";
}

export function unitSpecOfType(type: VariableType): UnitSpec {
    switch (type) {
        case "length":
            return LENGTH_UNITS;
        case "angle":
            return ANGLE_UNITS;
        case "unitless":
            return UNITLESS;
    }
}
