// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * An array's own numbers as the canvas draws them: the spacing along the run from the seed to
 * its first copy — with the line that measures it — and the instance count on that copy. Each
 * one is double-clicked to change it, which is what SolidWorks calls "add spacing dimension"
 * and "display instance count", and the only place a pattern's numbers read without opening
 * its tool.
 */

import { type I18nKeys, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import {
    type ArrayDraft,
    arrayInstanceTotal,
    DRAFT_ARRAY_ID,
    liveInstanceIds,
} from "../../src/sketch/arrayOps";
import style from "../../src/sketch/editor/sketchAnnotations.module.css";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { originRef, type SketchArrayPattern } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { badgeView, type MockBadge } from "./_helpers/sketchBadges";
import "./setup";

/** What a `showDialog` publication handed over, for driving the value dialogs by hand. */
interface DialogCapture {
    title?: I18nKeys;
    content?: HTMLElement;
    buttons?: { content: I18nKeys; shouldClose?: () => boolean; onclick?: () => void }[];
}

/**
 * Screens `showDialog` so a test can read the dialog a command opened and answer it — the same
 * capture `sketchDimensions.test.ts` runs over the datum dialogs, since these are those.
 */
function captureDialog() {
    const dialog: DialogCapture = {};
    const original = PubSub.default.pub as unknown as (key: string, ...args: unknown[]) => void;
    PubSub.default.pub = ((key: string, ...args: unknown[]) => {
        if (key === "showDialog") {
            [dialog.title, dialog.content, dialog.buttons] = args as [
                I18nKeys,
                HTMLElement,
                DialogCapture["buttons"],
            ];
            return;
        }
        original.call(PubSub.default, key, ...args);
    }) as never;
    return {
        dialog,
        restorePub: () => {
            PubSub.default.pub = original as never;
        },
    };
}

/** Types `text` into the open dialog and presses its confirm — `false` when it refused. */
function confirmDialog(dialog: DialogCapture, text: string): boolean {
    const box = dialog.content?.querySelector("input");
    expect(box).not.toBeNull();
    (box as HTMLInputElement).value = text;
    const confirm = dialog.buttons?.find((button) => button.content === "common.confirm");
    expect(confirm).toBeDefined();
    const closes = confirm?.shouldClose?.() !== false;
    if (closes) confirm?.onclick?.();
    return closes;
}

/** The annotation whose face reads `text` — the count and the spacing are told apart by it. */
function badgeFaced(badges: readonly MockBadge[], text: string): MockBadge {
    const badge = badges.findLast((b) => !b.disposed && b.element.textContent === text);
    expect(badge).toBeDefined();
    return badge as MockBadge;
}

/**
 * A line patterned three times along the sketch's own X axis: the seed spans x 0..10, so its
 * centre is (5, 0). The copies are 20 apart, so the run reaches (45, 0) — the spacing reads
 * halfway to the *first* copy, at (15, 0), and the count where the last one landed.
 */
function setupPattern(pattern?: SketchArrayPattern) {
    const ctx = badgeView();
    const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const source = editor.solver.addLine(0, 0, 10, 0);
    editor.solver.addArray(
        pattern ?? { type: "linear", x: { count: 3, spacing: 20 }, y: { count: 1, spacing: 0 } },
        [source],
    );
    editor.solve(true);
    const dialogs = captureDialog();
    return { ...ctx, editor, node, source, ...dialogs };
}

describe("an array's numbers on the canvas", () => {
    test("draws the step it takes and the run it takes it along", () => {
        const ctx = setupPattern();
        try {
            const spacing = badgeFaced(ctx.badges, "20.00");
            expect(spacing.position.x).toBeCloseTo(15, 6);
            expect(spacing.position.y).toBeCloseTo(0, 6);
            expect(spacing.element.title).toContain("20.00");

            const count = badgeFaced(ctx.badges, "×3");
            // the count names the whole run, so it sits where the last instance landed
            expect(count.position.x).toBeCloseTo(45, 6);
            // the count stands clear of the geometry, the spacing sits on its line
            expect(count.position.y).toBeGreaterThan(0);
            // no badge says "array" any more: the numbers are the whole of what it shows
            expect(ctx.badges.some((b) => b.element.querySelector("svg") !== null)).toBe(false);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("draws the run itself, as the dimension layer's own line", () => {
        const ctx = setupPattern();
        try {
            // the spacing is a measurement, so the line measuring it is drawn with the
            // dimension layer: a straight run is the two points it is, so its mesh is two
            // vertices of three coordinates. The sketch draws other things (entity points, the
            // selection highlight), so the run is found by its own shape, not by position.
            // the sketch draws a mesh for the seed's own line as well, so the run is told apart
            // by where it starts: the seed's centre, not the seed's own start point
            const runs = ctx.displayed
                .flatMap((entry) => entry.datas)
                .map((data) => data.position as Float32Array)
                .filter((position) => position.length === 2 * 3 && Math.abs(position[0] - 5) < 1e-6);
            expect(runs).toHaveLength(1);
            expect(runs[0][0]).toBeCloseTo(5, 6);
            expect(runs[0][runs[0].length - 3]).toBeCloseTo(45, 6);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("reads a turn as the angle the field holds", () => {
        const ctx = setupPattern({
            type: "circular",
            center: { type: "ref", ref: originRef() },
            count: 3,
            twist: 90,
            equalSpacing: false,
        });
        try {
            expect(badgeFaced(ctx.badges, "90.0°").element.title).toContain("90.0°");
            expect(badgeFaced(ctx.badges, "×3")).toBeDefined();
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("opens the spacing for editing when its annotation is double-clicked", () => {
        const ctx = setupPattern();
        try {
            badgeFaced(ctx.badges, "20.00").element.dispatchEvent(new MouseEvent("dblclick"));
            expect(ctx.dialog.title).toBe("sketch.arraySpacingX");
            // the box opens on the number as a dimension's does: two places, the reading's own
            expect((ctx.dialog.content?.querySelector("input") as HTMLInputElement).value).toBe("20.00");

            expect(confirmDialog(ctx.dialog, "30")).toBe(true);

            // the record takes it, the commit writes it, and the sketch re-derives around it
            expect(ctx.editor.solver.arrays()[0].pattern).toMatchObject({
                type: "linear",
                x: { count: 3, spacing: 30 },
            });
            expect(ctx.node.data.arrays![0].pattern).toMatchObject({ x: { spacing: 30 } });
            expect(liveInstanceIds(ctx.editor.solver.arrays()[0])).toHaveLength(2);
            expect(ctx.editor.solver.entityPoints(liveInstanceIds(ctx.editor.solver.arrays()[0])[0])).toEqual(
                [
                    [30, 0],
                    [40, 0],
                ],
            );
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("takes a negative spacing, which runs the direction the other way", () => {
        // The dialog's default reading is positive-only, which is the *dimensions'* business: a
        // length is a magnitude there. A pattern's spacing is not — `SketchArrayAxis` reads a
        // negative one as the same step taken the other way, the solver takes its absolute
        // value, and the arrow draws itself flipped — so the canvas has to accept what the
        // options bar already does.
        const ctx = setupPattern();
        try {
            badgeFaced(ctx.badges, "20.00").element.dispatchEvent(new MouseEvent("dblclick"));

            expect(confirmDialog(ctx.dialog, "-30")).toBe(true);

            expect(ctx.editor.solver.arrays()[0].pattern).toMatchObject({ x: { count: 3, spacing: -30 } });
            expect(ctx.editor.solver.entityPoints(liveInstanceIds(ctx.editor.solver.arrays()[0])[0])).toEqual(
                [
                    [-30, 0],
                    [-20, 0],
                ],
            );
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("opens the count for editing, and refuses a count a pattern cannot hold", () => {
        const ctx = setupPattern();
        try {
            badgeFaced(ctx.badges, "×3").element.dispatchEvent(new MouseEvent("dblclick"));
            expect(ctx.dialog.title).toBe("sketch.arrayCountX");

            // a count that is not a whole number, or is past what a pattern may hold, keeps the
            // dialog open rather than reaching the record
            expect(confirmDialog(ctx.dialog, "2.5")).toBe(false);
            expect(confirmDialog(ctx.dialog, "999")).toBe(false);
            expect(arrayInstanceTotal(ctx.editor.solver.arrays()[0].pattern)).toBe(3);

            expect(confirmDialog(ctx.dialog, "5")).toBe(true);
            expect(arrayInstanceTotal(ctx.editor.solver.arrays()[0].pattern)).toBe(5);
            expect(ctx.node.data.arrays![0].instanceEntityIds).toHaveLength(4);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("takes one as the count of a direction, which is what turns it off", () => {
        // `SketchArrayAxis`: one lays down nothing. That is the reading the solver places by
        // and the reading the arrows drag by, so it is the reading the canvas has to accept —
        // otherwise a direction is only turned off from the options bar.
        const ctx = setupPattern({
            type: "linear",
            x: { count: 3, spacing: 20 },
            y: { count: 2, spacing: 25 },
        });
        try {
            badgeFaced(ctx.badges, "×3").element.dispatchEvent(new MouseEvent("dblclick"));
            expect(confirmDialog(ctx.dialog, "1")).toBe(true);

            const pattern = ctx.editor.solver.arrays()[0].pattern;
            expect(pattern).toMatchObject({ type: "linear", x: { count: 1, spacing: 20 } });
            // the Y direction is untouched, and it is the whole of what the pattern now lays
            expect(arrayInstanceTotal(pattern)).toBe(2);
            const instances = liveInstanceIds(ctx.editor.solver.arrays()[0]);
            expect(instances).toHaveLength(1);
            expect(ctx.editor.solver.entityPoints(instances[0])).toEqual([
                [0, 25],
                [10, 25],
            ]);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("refuses a run of one, which is a seed and no pattern", () => {
        // A turn or a curve lays every instance in one run, so its count is the whole pattern:
        // one is the seed alone, and the record would be removed rather than emptied.
        const ctx = setupPattern({
            type: "circular",
            center: { type: "ref", ref: originRef() },
            count: 3,
            twist: 90,
            equalSpacing: false,
        });
        try {
            badgeFaced(ctx.badges, "×3").element.dispatchEvent(new MouseEvent("dblclick"));
            expect(ctx.dialog.title).toBe("common.count");

            expect(confirmDialog(ctx.dialog, "1")).toBe(false);
            expect(arrayInstanceTotal(ctx.editor.solver.arrays()[0].pattern)).toBe(3);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("draws the numbers of the pattern a tool is holding, before there is a record", () => {
        const ctx = badgeView();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const source = editor.solver.addLine(0, 0, 10, 0);
            // what the array tool hands over while it is up: a pattern with no record behind it
            editor.arrayDraft = {
                id: DRAFT_ARRAY_ID,
                pattern: { type: "linear", x: { count: 4, spacing: 25 }, y: { count: 1, spacing: 0 } },
                sourceIds: [source],
                set: rs.fn(),
            };
            editor.solve(true);

            // the numbers the user is about to place are already on the canvas, readable and
            // doubled like those of a pattern that is finished
            expect(badgeFaced(ctx.badges, "25.00")).toBeDefined();
            expect(badgeFaced(ctx.badges, "×4")).toBeDefined();

            const { dialog, restorePub } = captureDialog();
            badgeFaced(ctx.badges, "25.00").element.dispatchEvent(new MouseEvent("dblclick"));
            // and doubling one writes into the tool rather than into a record that is not there
            expect(confirmDialog(dialog, "40")).toBe(true);
            expect(editor.arrayDraft.set).toHaveBeenCalledWith("spacingX", 40);
            restorePub();
            editor.arrayDraft = undefined;
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });

    test("lets the pointer through to the handle under it while one is being aimed at", () => {
        // The number is a DOM overlay and the handle is a mesh, so a number lying over the
        // arrow takes the press that would grab the handle, and the click that settles the
        // drag — the sketch is handed neither, and has no way to know it was robbed. So the
        // numbers go the way the constraint symbols do (`inertConstraintSymbols`), and only
        // while a handle is live: a number nobody is reaching past is still doubled to edit.
        const ctx = setupPattern();
        try {
            const rest = badgeFaced(ctx.badges, "20.00");
            expect(rest.element.classList.contains(style.inert)).toBe(false);

            ctx.editor.annotations.inertConstraintSymbols = true;

            // the same element, restyled: `drawBadge` keeps a badge whose key has not changed,
            // and a press that is under way has to survive the repaint
            expect(badgeFaced(ctx.badges, "20.00").element).toBe(rest.element);
            expect(rest.element.classList.contains(style.inert)).toBe(true);

            // And a number the drag *changes* is a new badge — its key carries the value — so
            // it arrives after the flag was set, when the setter has long since stopped
            // restyling anything. Reading the flag once, at the flip, would leave it live.
            const record = ctx.editor.solver.arrays()[0];
            ctx.editor.solver.updateArray(record.id, {
                pattern: { type: "linear", x: { count: 3, spacing: 30 }, y: { count: 1, spacing: 0 } },
            });
            ctx.editor.solve(true);

            const dragged = badgeFaced(ctx.badges, "30.00");
            expect(dragged.element).not.toBe(rest.element);
            expect(dragged.element.classList.contains(style.inert)).toBe(true);

            ctx.editor.annotations.inertConstraintSymbols = false;
            expect(dragged.element.classList.contains(style.inert)).toBe(false);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("clears that highlight when the pointer leaves one, refresh or no refresh", () => {
        const ctx = setupPattern();
        try {
            const highlight = rs.spyOn(ctx.doc.visual.eventHandler as never, "highlightConstraintEntities");
            const badge = badgeFaced(ctx.badges, "×3");
            badge.element.dispatchEvent(new Event("mouseenter"));

            // The hover raises a highlight, and *raising* it refreshes the annotations — which
            // empties the set of badges on the canvas. The badge keeps the element it had (its
            // key did not change) and is not drawn again, so the guard that asks whether an
            // element is one of the live badges has to be re-registered on every refresh, or
            // the leave below is ignored and the highlight stays up for good.
            ctx.editor.solve(true);
            badge.element.dispatchEvent(new Event("mouseleave"));

            expect(highlight).toHaveBeenLastCalledWith([]);
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("lights the pattern up while the pointer is on either number", () => {
        const ctx = setupPattern();
        try {
            const ids = [ctx.source, ...liveInstanceIds(ctx.editor.solver.arrays()[0])];
            const highlight = rs.spyOn(ctx.doc.visual.eventHandler as never, "highlightConstraintEntities");
            for (const text of ["20.00", "×3"]) {
                badgeFaced(ctx.badges, text).element.dispatchEvent(new Event("mouseenter"));
                expect(highlight).toHaveBeenLastCalledWith(ids);
            }
        } finally {
            ctx.restorePub();
            ctx.restoreFactory();
        }
    });

    test("draws nothing for a pattern the solver will not take", () => {
        const ctx = badgeView();
        try {
            const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const source = editor.solver.addCircle(0, 30, 2);
            // a curve pattern follows a curve, and a curve dragged to nothing leaves the
            // pattern with nothing to place its instances along
            const curve = editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addArray({ type: "curve", curveId: curve, count: 3, spacing: 20 }, [source]);
            editor.solve(true);
            expect(ctx.badges.filter((b) => !b.disposed).map((b) => b.element.textContent)).toContain(
                "20.00",
            );

            editor.solver.setPointPosition({ entityId: curve, pointIndex: 1 }, 0, 0);
            editor.solve(true);

            const faces = ctx.badges.filter((b) => !b.disposed).map((b) => b.element.textContent);
            expect(faces).not.toContain("20.00");
            expect(faces).not.toContain("×3");
            editor.exit();
        } finally {
            ctx.restoreFactory();
        }
    });
});
