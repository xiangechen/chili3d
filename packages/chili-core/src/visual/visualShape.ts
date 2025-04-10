// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

export enum VisualState {
    normal = 0,
    edgeHighlight = 1,
    edgeSelected = 1 << 1,
    faceTransparent = 1 << 2,
}

export namespace VisualState {
    export function addState(origin: VisualState, add: VisualState) {
        return origin | add;
    }

    export function removeState(origin: VisualState, remove: VisualState) {
        return (origin & remove) ^ origin;
    }

    export function hasState(origin: VisualState, testState: VisualState) {
        return (origin & testState) === testState;
    }
}

export interface VisualGroup {
    start: number;
    count: number;
    materialIndex?: number;
}
