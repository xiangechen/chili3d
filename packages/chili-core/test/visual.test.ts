// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualState, VisualStateUtils } from "../src";

describe("visual test", () => {
    test("test VisualState", () => {
        let state = VisualState.normal;
        expect(state).toBe(0);

        state = VisualStateUtils.addState(state, VisualState.edgeHighlight);
        expect(state).toBe(1);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualStateUtils.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualState.edgeSelected);
        expect(state).toBe(0);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualState.edgeHighlight;
        state = VisualStateUtils.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualStateUtils.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualStateUtils.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualStateUtils.hasState(state, VisualState.edgeSelected)).toBeTruthy();
    });
});
