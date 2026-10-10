// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Escape during a drag in flight.
 *
 * Escape is the editor's cancel: it takes back a label drag, a pick and a box rather than
 * settling them, and a drag is one more gesture of that kind. What makes this worth pinning is
 * that a drag has already written — a point drag writes the solver's parameters on every move —
 * so "cancel" has to be an actual undo of the solver's own reading, and the gesture has to end
 * without the session going with it.
 */

import { Plane } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { SketchNode } from "../../src/sketch/sketchNode";
import type { SketchSolver } from "../../src/sketch/solver";
import { pointerEvent, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

/** A session with one horizontal line, well clear of the origin datum. */
function sessionWithLine() {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const line = editor.solver.addLine(30, 30, 100, 30);
    editor.solve(true);
    return { ...ctx, editor, line };
}

function paramsOf(solver: SketchSolver, id: number): number[] {
    const data = solver.entity(id);
    if (data === undefined) throw new Error(`no entity ${id}`);
    return data.params;
}

const escaped = () => new KeyboardEvent("keydown", { key: "Escape" });

/** Holds the line's first point — sketch (30, 30), screen (430, 330) — and drags it to (60, 60). */
function dragFirstPoint(handler: SketchEventHandler, view: ReturnType<typeof setupSketchHover>["view"]) {
    handler.pointerDown(view, pointerEvent(430, 330));
    handler.pointerMove(view, pointerEvent(460, 360));
}

describe("Escape during a point drag", () => {
    test("puts the point back, adds no constraint and leaves the session up", () => {
        const { editor, line, view, doc, restoreFactory } = sessionWithLine();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const before = [...paramsOf(editor.solver, line)];
            const constraintsBefore = editor.solver.toData().constraints.length;
            const commit = rs.spyOn(editor, "commit");

            dragFirstPoint(handler, view);
            // the drag really did write — without this the restore below proves nothing
            expect(paramsOf(editor.solver, line)).not.toEqual(before);

            handler.keyDown(view, escaped());

            expect(paramsOf(editor.solver, line)).toEqual(before);
            expect(editor.solver.toData().constraints).toHaveLength(constraintsBefore);
            // a cancel is not a gesture that settled anywhere, so there is nothing to undo
            expect(commit).not.toHaveBeenCalled();
            // and it ended the drag, not the session
            expect(SketchEditor.getActive()).toBe(editor);
            expect(handler.isEnabled).toBe(true);
            commit.mockRestore();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("unpins the dragged parameters when the session is disposed mid-drag", () => {
        const { editor, view, doc, restoreFactory } = sessionWithLine();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const endDrag = rs.spyOn(editor.solver, "endDrag");

            dragFirstPoint(handler, view);
            // the parameters are marked dragged, and stay pinned until something clears them;
            // a session torn down with a drag in flight is the one path that would never ask
            editor.dispose();

            expect(endDrag).toHaveBeenCalled();
            endDrag.mockRestore();
        } finally {
            restoreFactory();
        }
    });

    test("a press elsewhere settles a drag whose release never arrived", () => {
        const { editor, line, view, doc, restoreFactory } = sessionWithLine();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const endDrag = rs.spyOn(editor.solver, "endDrag");
            const commit = rs.spyOn(editor, "commit");

            // The press starts a drag and its release lands outside the viewport — the viewport
            // binds its own listeners to itself, so it never arrives. Without a recovery the drag
            // stays live and the point follows the pointer with nothing pressed; the next press
            // is where the label drag and the copy-end drag are recovered, and a point drag is
            // one more of those.
            dragFirstPoint(handler, view);
            expect(endDrag).not.toHaveBeenCalled();

            handler.pointerDown(view, pointerEvent(600, 400));

            expect(endDrag).toHaveBeenCalled();
            expect(commit).toHaveBeenCalled();
            // a *lost* release is a release all the same: the point stays where it was left
            expect(paramsOf(editor.solver, line)[0]).toBeCloseTo(60, 6);
            endDrag.mockRestore();
            commit.mockRestore();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("a released drag still settles: the point stays, and it is committed", () => {
        const { editor, line, view, doc, restoreFactory } = sessionWithLine();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const commit = rs.spyOn(editor, "commit");

            dragFirstPoint(handler, view);
            handler.pointerUp(view, pointerEvent(460, 360));

            // the release path is untouched by the cancel: it keeps the move and commits it
            expect(paramsOf(editor.solver, line)[0]).toBeCloseTo(60, 6);
            expect(commit).toHaveBeenCalled();
            commit.mockRestore();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });
});
