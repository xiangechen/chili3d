// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, VisualConfig } from "@chili3d/core";
import { breakPreviewAt } from "../../src/sketch/commands/sketchBreak";
import { SketchEditor, type SketchEntityPick } from "../../src/sketch/editor/sketchEditor";
import { SketchNode } from "../../src/sketch/sketchNode";
import { hoverHandler, lastHoverMeshes, pointerEvent, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

/** The tone the handler marks a carve point in — pinned, it is the whole cue. */
const BREAK_MARKER_COLOR = 0x8c9aa8;

/**
 * A sketch under a break pick: a line (0,0)-(100,0) spanning screen x 400..500 at y 300,
 * and a circle centred on (0, 60) with radius 20. The mock view maps world (x, y) to
 * screen (400 + x, 300 − y), and a carve point is drawn where the click projects onto the
 * entity — so the marker's own position is what these tests read.
 */
function setupBreakSketch() {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const line = editor.solver.addLine(0, 0, 100, 0);
    const circle = editor.solver.addCircle(0, 60, 20);
    editor.solve(true);
    /** Starts the pick the command would, with the closed curve's chosen point if any. */
    const pick = (first?: SketchEntityPick) => {
        void editor.pickEntityAt("prompt.pickBreakEntity", undefined, {
            previewAt: breakPreviewAt(editor, first),
        });
        return hoverHandler(ctx);
    };
    return { ...ctx, editor, line, circle, pick };
}

/**
 * The marker at `index` of the last hover, as its world position rounded to 1e-2. The
 * `|| 0` folds the negative zero a projection can land on back onto 0, which `toEqual`
 * tells apart.
 */
function markerAt(displayed: { colors: number[]; datas: any[] }[], index: number): number[] {
    const position = lastHoverMeshes(displayed)[index].position as Float32Array;
    return Array.from(position)
        .slice(0, 3)
        .map((value) => Math.round(value * 100) / 100 || 0);
}

describe("SketchEditor break preview", () => {
    test("marks where the click would carve the line", () => {
        const { editor, pick, displayed, restoreFactory } = setupBreakSketch();
        try {
            // screen (475, 305) is the sketch's (75, -5): a click beside the line, which
            // the op projects onto it before cutting
            pick().pointerMove(editor.view, pointerEvent(475, 305));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                BREAK_MARKER_COLOR,
            ]);
            // the line is lit as any hovered entity is, with the carve point over it
            expect(markerAt(displayed, 1)).toEqual([75, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("marks both carve points of a closed curve once the first is in", () => {
        const { editor, circle, pick, displayed, restoreFactory } = setupBreakSketch();
        try {
            // the circle's rightmost point, chosen at the click this pick comes after
            // screen (400, 260) is the sketch's (0, 40): the bottom of the circle
            pick({ entityId: circle, uv: [20, 60] }).pointerMove(editor.view, pointerEvent(400, 260));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                BREAK_MARKER_COLOR,
                BREAK_MARKER_COLOR,
            ]);
            // the point already chosen is marked first, the one under the pointer after it
            expect(markerAt(displayed, 1)).toEqual([20, 60, 0]);
            expect(markerAt(displayed, 2)).toEqual([0, 40, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("lights the line but marks nothing where its own end was clicked", () => {
        const { editor, pick, displayed, restoreFactory } = setupBreakSketch();
        try {
            pick().pointerMove(editor.view, pointerEvent(400, 300));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([VisualConfig.highlightEdgeColor]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });
});
