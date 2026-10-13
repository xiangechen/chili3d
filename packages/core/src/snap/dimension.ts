// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const Dimensions = {
    None: 0,
    D1: 1,
    D2: 2,
    D3: 4,

    D1D2: 0b011,
    D1D2D3: 0b111,
} as const;

export type Dimension = (typeof Dimensions)[keyof typeof Dimensions];

export class DimensionUtils {
    static contains(d1: Dimension, d2: Dimension): boolean {
        if (d2 === Dimensions.None) return false;
        return (d1 & d2) === d2;
    }

    /**
     *
     * @param value 1: D1, 2: D2, 3: D3, other: None
     * @returns
     */
    static from(value: number): Dimension {
        const mapping: { [key: number]: Dimension } = {
            1: Dimensions.D1,
            2: Dimensions.D2,
            3: Dimensions.D3,
        };
        return mapping[value] || Dimensions.None;
    }
}

/**
 * What the user typed into the point input box: the numbers as typed and in order, and
 * whether they were written as absolute coordinates (`#x,y,z`) rather than as offsets from
 * the step's reference point.
 *
 * Read by the handlers that accept such input and carried on the result they hand back, so
 * that the two cannot disagree about what was typed. What the numbers *mean* is neither's
 * business: the step's own `PointSnapData.dimension` is what allowed the form in the first
 * place, and it is what says whether the single number was a distance, a radius or an angle.
 */
export interface SnapInput {
    /** The numbers as typed, in order. */
    values: number[];
    /** `#x,y,z`: absolute coordinates rather than an offset from the reference point. */
    absolute: boolean;
}

export function parseDimensionInput(text: string): SnapInput {
    const absolute = text.startsWith("#");
    return { values: (absolute ? text.slice(1) : text).split(",").map(Number), absolute };
}
