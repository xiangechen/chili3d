// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    LENGTH_UNITS,
    type ParameterValue,
    PubSub,
    property,
    type Result,
} from "@chili3d/core";
import { applyCornerOps, type CornerOptions, findCorners, type SketchCorner } from "../cornerOps";
import type { SketchEditor } from "../editor/sketchEditor";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * Rounds or cuts the corners of every selected line pair. A pre-existing selection of
 * two or more lines is converted in one commit and the command ends; with nothing
 * selected it picks two lines at a time until ESC — the same shape as
 * `sketch.toggleConstruction`, and what makes box-selecting a profile's edges work.
 */
abstract class SketchCornerCommand extends SketchConstraintCommand {
    /** Which corner op this is — the corner pre-flight is op-aware (see `findCorners`). */
    protected abstract readonly method: CornerOptions["method"];

    /** The command's length parameter, resolved against the document's parameters. */
    protected abstract resolveValue(): Result<number>;

    protected abstract optionsFor(value: number): CornerOptions;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const selected = editor.selectedEntityIds().filter((id) => editor.solver.entity(id)?.type === "line");
        if (selected.length >= 2) {
            this.applyCorners(editor, this.cornersOf(editor, selected));
            // the highlight would keep claiming a selection the command consumed
            editor.clearEntitySelection();
            return;
        }
        // a lone selected line is the first half of the pair, not something to drop
        await this.pickLoop(editor, selected);
    }

    /** Corners among the picked lines, reporting why a valid-looking pick found none. */
    private cornersOf(editor: SketchEditor, lineIds: readonly number[]): SketchCorner[] | undefined {
        const found = findCorners(editor.solver, lineIds, cornerTolerance(editor), this.method);
        if (!found.isOk) {
            PubSub.default.pub("displayError", found.error);
            return undefined;
        }
        if (found.value.length === 0) {
            PubSub.default.pub("displayError", "The picked lines do not share an endpoint");
            return undefined;
        }
        return found.value;
    }

    /**
     * Resolves the option here rather than once up front: the panel writes it straight
     * onto the command while the pick loop is open, so a value read at the start would
     * be stale by the time the second edge lands.
     */
    private applyCorners(editor: SketchEditor, corners: SketchCorner[] | undefined): void {
        if (corners === undefined) return;
        const value = this.resolveValue();
        if (!value.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", value.error);
            return;
        }
        const applied = applyCornerOps(editor.solver, corners, this.optionsFor(value.value));
        if (!applied.isOk) {
            PubSub.default.pub("displayError", applied.error);
            return;
        }
        // a radius label goes on its own corner's outside; without an anchor every one
        // of them falls back to the same 45° and they stop reading as that corner's
        for (const label of applied.value) {
            editor.dimensionAnchors.set(label.constraintId, {
                kind: "vector",
                dx: label.offset.x,
                dy: label.offset.y,
            });
        }
        editor.solve(true);
        editor.commit();
    }

    /**
     * Picks edges until ESC, starting from `initial` — what was already selected when
     * the command was invoked. A click yields one line and keeps it for the next click,
     * a rubber-band box yields its whole set at once; either way every corner among
     * the lines gathered so far is converted as soon as there are two. Each round
     * commits on its own, so the result shows as it is picked.
     */
    private async pickLoop(editor: SketchEditor, initial: readonly number[]): Promise<void> {
        let pending: number[] = [...initial];
        while (true) {
            const picked = await this.pickLines(editor);
            if (picked === undefined) return;
            const lines = [...new Set([...pending, ...picked])];
            if (lines.length < 2) {
                pending = lines;
                continue;
            }
            pending = [];
            this.applyCorners(editor, this.cornersOf(editor, lines));
            // a box leaves its catch highlighted; the click path selects nothing
            editor.clearEntitySelection();
        }
    }

    /** One edge pick: a click answers with the line under the cursor, a box with everything it crossed. */
    private async pickLines(editor: SketchEditor): Promise<number[] | undefined> {
        this.controller = new AsyncController();
        const ids = await editor.pickEntities("prompt.pickSketchEntity", "line", undefined, this.controller);
        this.controller.dispose();
        return ids;
    }
}

/** Sketch-plane units for the positional corner fallback: a few screen pixels, floored so a headless run still matches. */
function cornerTolerance(editor: SketchEditor): number {
    return Math.max(editor.screenTolerance(), 1e-6);
}

@command({ key: "sketch.fillet", icon: "icon-fillet2D" })
export class SketchFilletCommand extends SketchCornerCommand {
    protected readonly method = "fillet";

    @property("circle.radius", { unit: LENGTH_UNITS })
    get radius(): ParameterValue {
        return this.getPrivateValue("radius", 10);
    }
    set radius(value: ParameterValue) {
        this.setProperty("radius", value);
    }

    protected resolveValue(): Result<number> {
        return this.resolveParameter(this.radius, LENGTH_UNITS);
    }

    protected optionsFor(value: number): CornerOptions {
        return { method: "fillet", radius: value };
    }
}

@command({ key: "sketch.chamfer", icon: "icon-chamfer2D" })
export class SketchChamferCommand extends SketchCornerCommand {
    protected readonly method = "chamfer";

    @property("common.length", { unit: LENGTH_UNITS })
    get length(): ParameterValue {
        return this.getPrivateValue("length", 10);
    }
    set length(value: ParameterValue) {
        this.setProperty("length", value);
    }

    protected resolveValue(): Result<number> {
        return this.resolveParameter(this.length, LENGTH_UNITS);
    }

    protected optionsFor(value: number): CornerOptions {
        return { method: "chamfer", distance: value };
    }
}
