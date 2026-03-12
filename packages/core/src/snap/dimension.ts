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
