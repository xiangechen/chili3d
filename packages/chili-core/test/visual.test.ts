// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualState } from "../src";

describe("visual test", () => {
    test("test VisualState", () => {
        let state = VisualState.normal;
        expect(state).toBe(0);

        state = VisualState.addState(state, VisualState.edgeHighlight);
        expect(state).toBe(1);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualState.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeSelected);
        expect(state).toBe(0);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeFalsy();

        state = VisualState.edgeHighlight;
        state = VisualState.addState(state, VisualState.edgeSelected);
        expect(state).toBe(3);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeTruthy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();

        state = VisualState.removeState(state, VisualState.edgeHighlight);
        expect(state).toBe(2);
        expect(VisualState.hasState(state, VisualState.edgeHighlight)).toBeFalsy();
        expect(VisualState.hasState(state, VisualState.edgeSelected)).toBeTruthy();
    });
});
