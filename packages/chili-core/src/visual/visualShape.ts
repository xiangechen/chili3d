// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
