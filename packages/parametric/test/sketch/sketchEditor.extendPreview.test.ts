// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, VisualConfig } from "@chili3d/core";
import { extendPreviewAt } from "../../src/sketch/commands/sketchExtend";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { SketchNode } from "../../src/sketch/sketchNode";
import { hoverHandler, lastHoverMeshes, pointerEvent, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

/** The tone the handler previews a piece the extend would add in — pinned, it is the cue. */
const EXTEND_PREVIEW_COLOR = 0x00c8ff;
/** The tone it previews a piece the extend would give up in — the trim's own. */
const REMOVE_PREVIEW_COLOR = 0xff6b6b;

/**
 * A sketch under an extend boundary pick: the target is the line (0,0)-(100,0), clicked
 * near its far end, and the boundary is a vertical line the hover is aimed at. The mock
 * view maps world (x, y) to screen (400 + x, 300 − y), so a hover that lands on x = 120
 * has to sit at screen x 520 — and off the target's own line, or it would hit that one
 * first and the pick would take the target as its boundary.
 */
function setupExtendPick(options: {
    boundary: [number, number, number, number];
    hover: [number, number];
    modifyBoundary?: boolean;
}) {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const target = editor.solver.addLine(0, 0, 100, 0);
    editor.solver.addLine(...options.boundary);
    editor.solve(true);
    void editor.pickEntityAt("prompt.pickExtendBoundary", undefined, {
        previewAt: extendPreviewAt(
            editor,
            { entityId: target, uv: [90, 0] },
            options.modifyBoundary ?? false,
        ),
    });
    return { ...ctx, editor, handler: hoverHandler(ctx) };
}

/** The vertices of the mesh at `index` of the last hover, rounded. */
function meshPositions(displayed: { colors: number[]; datas: any[] }[], index: number): number[] {
    return Array.from(lastHoverMeshes(displayed)[index].position as Float32Array).map(Math.round);
}

describe("SketchEditor extend preview", () => {
    test("hovers the span the target would gain", () => {
        const { editor, handler, displayed, restoreFactory } = setupExtendPick({
            boundary: [120, -20, 120, 20],
            hover: [522, 290],
        });
        try {
            handler.pointerMove(editor.view, pointerEvent(522, 290));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                EXTEND_PREVIEW_COLOR,
            ]);
            // the boundary is what this step is picking, so it is the entity lit up; the
            // target answers through the span the click would add to it
            expect(meshPositions(displayed, 0)).toEqual([120, -20, 0, 120, 20, 0]);
            expect(meshPositions(displayed, 1)).toEqual([100, 0, 0, 120, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovers the span a cut back would give up, in the trim's tone", () => {
        const { editor, handler, displayed, restoreFactory } = setupExtendPick({
            boundary: [60, -20, 60, 20],
            hover: [462, 290],
        });
        try {
            handler.pointerMove(editor.view, pointerEvent(462, 290));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                REMOVE_PREVIEW_COLOR,
            ]);
            expect(meshPositions(displayed, 0)).toEqual([60, -20, 0, 60, 20, 0]);
            expect(meshPositions(displayed, 1)).toEqual([60, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("hovers the boundary's own span too when the option asks for it", () => {
        const { editor, handler, displayed, restoreFactory } = setupExtendPick({
            boundary: [120, -20, 120, 20],
            hover: [522, 290],
            modifyBoundary: true,
        });
        try {
            handler.pointerMove(editor.view, pointerEvent(522, 290));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([
                VisualConfig.highlightEdgeColor,
                EXTEND_PREVIEW_COLOR,
                REMOVE_PREVIEW_COLOR,
            ]);
            expect(meshPositions(displayed, 1)).toEqual([100, 0, 0, 120, 0, 0]);
            expect(meshPositions(displayed, 2)).toEqual([120, 0, 0, 120, 20, 0]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });

    test("lights the target while the target itself is being picked", () => {
        const ctx = setupSketchHover();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        try {
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            // the first step has nothing to propose yet — it is still choosing its target,
            // so it has to read as an ordinary hover rather than as no feedback at all
            void editor.pickEntityAt("prompt.pickExtendTarget", ["line", "arc"]);
            hoverHandler(ctx).pointerMove(ctx.view, pointerEvent(475, 300));

            const meshes = lastHoverMeshes(ctx.displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([VisualConfig.highlightEdgeColor]);
            expect(meshPositions(ctx.displayed, 0)).toEqual([0, 0, 0, 100, 0, 0]);
        } finally {
            editor.exit();
            ctx.restoreFactory();
        }
    });

    test("lights the boundary but proposes nothing where the two would not meet", () => {
        const { editor, handler, displayed, restoreFactory } = setupExtendPick({
            boundary: [120, 40, 200, 40],
            hover: [522, 260],
        });
        try {
            handler.pointerMove(editor.view, pointerEvent(522, 260));

            const meshes = lastHoverMeshes(displayed);
            expect(meshes.map((mesh) => mesh.color)).toEqual([VisualConfig.highlightEdgeColor]);
        } finally {
            editor.exit();
            restoreFactory();
        }
    });
});
