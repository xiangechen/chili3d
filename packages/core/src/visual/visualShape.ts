// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const VisualStates = {
    normal: 0,
    edgeHighlight: 1,
    edgeSelected: 2,
    faceTransparent: 4,
    faceHighlight: 8,
    faceSelected: 16,
} as const;
export type VisualState = (typeof VisualStates)[keyof typeof VisualStates];

/**
 * State of a body face the user has picked for a feature — the translucent fill a selection
 * usually gets, plus its boundary outlined, so the faces the feature will act on read apart from
 * the ones that are merely hovered. Shared by every command whose pick is "some faces of this
 * body": the extrude that sweeps them, the thicken that stands material on them, the shell that
 * opens them, and the draft that tapers them.
 */
export const SELECTED_FACE_STATE = (VisualStates.faceTransparent | VisualStates.edgeSelected) as VisualState;

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
