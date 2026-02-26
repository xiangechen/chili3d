// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export enum VisualState {
    normal = 0,
    edgeHighlight = 1,
    edgeSelected = 1 << 1,
    faceTransparent = 1 << 2,
    faceColored = 1 << 3,
}

export class VisualStateUtils {
    public static addState(origin: VisualState, add: VisualState) {
        return origin | add;
    }

    public static removeState(origin: VisualState, remove: VisualState) {
        return (origin & remove) ^ origin;
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
