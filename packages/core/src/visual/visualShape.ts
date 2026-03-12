// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const VisualStates = {
    normal: 0,
    edgeHighlight: 1,
    edgeSelected: 2,
    faceTransparent: 4,
    faceColored: 8,
} as const;
export type VisualState = (typeof VisualStates)[keyof typeof VisualStates];

export class VisualStateUtils {
    public static addState(origin: VisualState, add: VisualState) {
        return (origin | add) as VisualState;
    }

    public static removeState(origin: VisualState, remove: VisualState) {
        return ((origin & remove) ^ origin) as VisualState;
    }

    public static hasState(origin: VisualState, testState: VisualState) {
        return (origin & testState) === testState;
    }
}

export interface VisualGroup {
    start: number;
    count: number;
    materialIndex?: number;
}
