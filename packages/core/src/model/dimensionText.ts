// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * How a measured value reads. The digits and the affixes are one rule wherever a
 * dimension shows a number — a length to two places, an angle to one with its degree
 * sign, a radius prefixed `R`, a diameter `Ø` — so they live here, and the three places
 * that draw a value (the annotation's own read, the command previews, the sketch
 * editor's datum text) ask this module instead of each writing `toFixed` and a prefix.
 *
 * What differs between systems is only *which* tag means what: a 3D annotation carries a
 * `DimensionType`, the sketch editor a `ConstraintKind`, and each maps its own tag onto a
 * `DimensionMeasurement`. The measure tools' readouts are deliberately not part of this —
 * a transient readout is not a dimension, and it writes its angles to two places.
 */
export type DimensionMeasurement = "length" | "angle" | "radius" | "diameter" | "rho";

/**
 * A measured value in pieces: the digits, and the affixes they sit between. In pieces
 * because a text override substitutes the digits into a template (`<>`) and adds the
 * affixes itself; a plain read is the three joined.
 */
export interface MeasurementText {
    /** The value, to the measurement's own number of places. */
    readonly value: string;
    readonly prefix: string;
    readonly suffix: string;
}

/** How many places a measurement reads to: angles to one, the rest to two. */
export function measurementDecimals(measurement: DimensionMeasurement): number {
    return measurement === "angle" ? 1 : 2;
}

/** The affixes a measurement reads with: `R` for a radius, `Ø` for a diameter, `°` for an angle, `ρ` for a conic's rho. */
export function measurementAffixes(measurement: DimensionMeasurement): { prefix: string; suffix: string } {
    switch (measurement) {
        case "radius":
            return { prefix: "R", suffix: "" };
        case "diameter":
            return { prefix: "Ø", suffix: "" };
        case "angle":
            return { prefix: "", suffix: "°" };
        case "rho":
            return { prefix: "ρ", suffix: "" };
        default:
            return { prefix: "", suffix: "" };
    }
}

/** `value` as it reads for `measurement`; `decimals` overrides the kind's own count. */
export function measurementText(
    measurement: DimensionMeasurement,
    value: number,
    decimals?: number,
): MeasurementText {
    const places = decimals ?? measurementDecimals(measurement);
    return { value: value.toFixed(places), ...measurementAffixes(measurement) };
}

/** `value` as one string: the digits with their affixes. */
export function formatMeasurement(
    measurement: DimensionMeasurement,
    value: number,
    decimals?: number,
): string {
    const { prefix, value: digits, suffix } = measurementText(measurement, value, decimals);
    return `${prefix}${digits}${suffix}`;
}
