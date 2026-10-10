// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * An offset copy's two ends, as the editor draws and drags them.
 *
 * A copy has no point of its own — nothing of it is a solver parameter — so its ends are the
 * one handle the editor has to read off the *curve*, and what a drag writes is the window the
 * copy is drawn over rather than a position. These tests read the markers the overlay hands to
 * the view and then drive a real drag through the handler, because a handle that is drawn
 * somewhere other than it can be grabbed is a handle that lies.
 */

import { Plane } from "@chili3d/core";
import { entityDomain, entityPeriod, evaluateEntity } from "../../src/sketch/curveEval";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { offsetEntities } from "../../src/sketch/offsetOps";
import { SketchNode } from "../../src/sketch/sketchNode";
import { pointerEvent, setupSketchHover } from "./_helpers/sketchHover";
import "./setup";

const TOLERANCE = 1e-6;

/** The markers the session last drew, as the world x of each. */
function markerXs(displayed: { colors: number[]; datas: any[] }[]): number[] {
    const meshes = displayed.at(-1)?.datas ?? [];
    return meshes.filter((mesh) => mesh.size !== undefined).map((mesh) => mesh.position[0]);
}

/** A session with a straight cubic, and its copy twenty units above it. */
function sessionWithCopy() {
    const ctx = setupSketchHover();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const source = editor.solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
    const offset = offsetEntities(editor.solver, [source], 20, TOLERANCE);
    if (!offset.isOk) throw new Error(offset.error);
    const copy = offset.value.createdEntityIds[0];
    (ctx.doc.visual.eventHandler as SketchEventHandler).refreshEntityPoints();
    return { ...ctx, editor, source, copy };
}

/** The copy's drawn window — what a drag of either of its ends writes. */
function windowOf(editor: SketchEditor, copy: number): [number, number] {
    const data = editor.solver.entity(copy);
    if (data === undefined) throw new Error("the copy is gone");
    return entityDomain(data);
}

describe("an offset copy's end handles", () => {
    test("marks both of its ends, where a point's own marker goes", () => {
        const { editor, copy, restoreFactory, displayed } = sessionWithCopy();
        try {
            // the source's four control points, then the copy's two ends — the copy has no
            // points to mark, so its ends are read off the curve itself
            expect(markerXs(displayed)).toEqual([0, 4, 8, 12, 0, 12]);
            expect(entityPeriod(editor.solver.entity(copy)!)).toBe(0);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("trims the copy when its far handle is dragged back along the source", () => {
        const { editor, source, copy, restoreFactory, view, doc } = sessionWithCopy();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            // the far end is drawn at sketch (12, 20), which the mock view puts at (412, 320)
            handler.pointerDown(view, pointerEvent(412, 320));
            handler.pointerMove(view, pointerEvent(406, 320));
            handler.pointerUp(view, pointerEvent(406, 320));

            const [from, to] = windowOf(editor, copy);
            expect(from).toBeCloseTo(0, 9);
            expect(to).toBeCloseTo(0.5, 6);
            // the drawn copy ends where the pointer left it, and the source is untouched
            expect(evaluateEntity(editor.solver.entity(copy)!, to)).toEqual([6, 20]);
            expect(editor.solver.entity(source)!.params).toEqual([0, 0, 4, 0, 8, 0, 12, 0]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("Escape puts a dragged handle back where the drag found it, and commits nothing", () => {
        const { editor, copy, restoreFactory, view, doc } = sessionWithCopy();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const before = windowOf(editor, copy);
            const commit = rs.spyOn(editor, "commit");

            // the far end is drawn at sketch (12, 20) — screen (412, 320) — and is dragged in
            handler.pointerDown(view, pointerEvent(412, 320));
            handler.pointerMove(view, pointerEvent(406, 320));
            // the move wrote the window as it went, so the cancel has something to take back
            expect(windowOf(editor, copy)).not.toEqual(before);

            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Escape" }));

            expect(windowOf(editor, copy)).toEqual(before);
            // the copy is where it started, so there is no step for the user to undo
            expect(commit).not.toHaveBeenCalled();
            expect(SketchEditor.getActive()).toBe(editor);
            commit.mockRestore();
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("leaves the copy alone when a handle is dragged past the end of the source it reads", () => {
        const { editor, source, copy, restoreFactory, view, doc } = sessionWithCopy();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            handler.pointerDown(view, pointerEvent(412, 320));
            // well past the source's own end: there is no parallel curve out there for the copy
            // to be drawn on, and growing the source is the extend tool's gesture, not a drag's
            handler.pointerMove(view, pointerEvent(500, 320));
            handler.pointerUp(view, pointerEvent(500, 320));

            expect(windowOf(editor, copy)).toEqual([0, 1]);
            expect(editor.solver.entity(source)!.params).toEqual([0, 0, 4, 0, 8, 0, 12, 0]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("holds the grabbed end when it is dragged past the other one", () => {
        const { editor, copy, restoreFactory, view, doc, displayed } = sessionWithCopy();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            // first trim the copy's far end back to sketch (6, 20), leaving the window [0, 0.5]
            handler.pointerDown(view, pointerEvent(412, 320));
            handler.pointerMove(view, pointerEvent(406, 320));
            handler.pointerUp(view, pointerEvent(406, 320));
            const trimmed = windowOf(editor, copy);
            expect(trimmed[1]).toBeCloseTo(0.5, 6);

            // then drag the *origin* handle just past the far end (sketch 6 → 7): `setOffsetWindow`
            // reads the pair as given, so a crossed pair would be swapped — the grabbed end would
            // land where the other one was and the drag would grow that one from then on
            handler.pointerDown(view, pointerEvent(400, 320));
            handler.pointerMove(view, pointerEvent(407, 320));
            handler.pointerUp(view, pointerEvent(407, 320));

            expect(windowOf(editor, copy)[0]).toBeCloseTo(trimmed[0], 9);
            expect(windowOf(editor, copy)[1]).toBeCloseTo(trimmed[1], 6);
            // and the marker the user grabbed is still the one drawn at the copy's start
            expect(markerXs(displayed).slice(-2)).toEqual([0, 6]);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("stops following the pointer when a release never reached the viewport", () => {
        const { editor, copy, restoreFactory, view, doc } = sessionWithCopy();
        try {
            const handler = doc.visual.eventHandler as SketchEventHandler;
            // a drag whose release is swallowed — by a badge, or by the pointer leaving the
            // viewport, which binds its own listeners — leaves the drag in flight
            handler.pointerDown(view, pointerEvent(412, 320));
            handler.pointerMove(view, pointerEvent(406, 320));
            const interrupted = windowOf(editor, copy);

            // the press that follows is the recovery the label drag has: it ends the drag, and the
            // move after it has nothing left to write to (sketch 3 would trim the far end to 0.25
            // were the drag still live)
            handler.pointerDown(view, pointerEvent(200, 200));
            handler.pointerMove(view, pointerEvent(403, 320));

            expect(windowOf(editor, copy)).toEqual(interrupted);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("marks nothing for a copy drawn over the whole of a closed source", () => {
        const ctx = setupSketchHover();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        try {
            const ellipse = editor.solver.addEllipse(0, 40, 10, 40, 0, 45);
            const offset = offsetEntities(editor.solver, [ellipse], 5, TOLERANCE);
            if (!offset.isOk) throw new Error(offset.error);
            const copy = offset.value.createdEntityIds[0];
            (ctx.doc.visual.eventHandler as SketchEventHandler).refreshEntityPoints();

            // the ellipse's own frame points are marked; the copy contributes none of its own
            expect(markerXs(ctx.displayed)).toEqual([0, 10, 0]);
            expect(editor.solver.entity(copy)!.type).toBe("offsetCurve");
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });
});
