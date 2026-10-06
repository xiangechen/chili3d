// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, VisualConfig } from "@chili3d/core";
import { trimPreviewAt } from "../../src/sketch/commands/sketchTrim";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { SketchNode } from "../../src/sketch/sketchNode";
import { hoverHandler, lastHoverMeshes, pointerEvent, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

/** The tone the handler previews the doomed piece in — pinned, it is the whole cue. */
const TRIM_PREVIEW_COLOR = 0xff6b6b;

/**
 * A sketch under a trim pick: the mock view maps world (x, y, 0) to screen
 * (400 + x, 300 − y), so a line (0,0)-(100,0) spans screen x 400..500 at y 300, and a
 * vertical line at x = 50 crosses it at screen (450, 300).
 */
function setupTrimPick() {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    editor.solver.addLine(0, 0, 100, 0);
    editor.solver.addLine(50, -20, 50, 20);
    editor.solve(true);
    void editor.pickEntityAt("prompt.pickTrimEntity", undefined, { previewAt: trimPreviewAt(editor) });
    return { ...ctx, editor, handler: hoverHandler(ctx) };
}

/** The vertices of the mesh at `index` of the last hover, rounded. */
function meshPositions(displayed: { colors: number[]; datas: any[] }[], index: number): number[] {
    return Array.from(lastHoverMeshes(displayed)[index].position as Float32Array).map(Math.round);
}

describe("SketchEditor trim preview", () => {
    test("lights the line and hovers the doomed piece over it", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(475, 300));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                TRIM_PREVIEW_COLOR,
            ]);
            // the whole line stays lit under the piece the click would take away
            expect(meshPositions(displayed, 0)).toEqual([0, 0, 0, 100, 0, 0]);
            expect(meshPositions(displayed, 1)).toEqual([50, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovers the other piece when the cursor crosses to the other side", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(475, 300));
            handler.pointerMove(editor.view, pointerEvent(425, 300));

            expect(meshPositions(displayed, 1)).toEqual([0, 0, 0, 50, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("lights the line but proposes nothing on the crossing, where the trim would refuse", () => {
        const { editor, handler, displayed, restoreFactory } = setupTrimPick();
        try {
            handler.pointerMove(editor.view, pointerEvent(450, 300));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([VisualConfig.highlightEdgeColor]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("an ordinary hover still highlights the whole entity", () => {
        const ctx = setupSketchHover();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        try {
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            hoverHandler(ctx).pointerMove(ctx.view, pointerEvent(475, 300));

            const meshes = lastHoverMeshes(ctx.displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([VisualConfig.highlightEdgeColor]);
            expect(meshPositions(ctx.displayed, 0)).toEqual([0, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            ctx.restoreFactory();
        }
    });
});
