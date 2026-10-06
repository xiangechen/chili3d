// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    type EdgeMeshData,
    type IDocument,
    type IEventHandler,
    type IView,
    LENGTH_UNITS,
    labelOnSegment,
    type ParameterValue,
    Precision,
    PubSub,
    pointLineFoot,
    property,
    XYZ,
} from "@chili3d/core";
import { ARROW_LENGTH } from "../../commands/arrowHandle";
import { AxisDragHandler, type DragPreview } from "../../commands/axisDragHandler";
import { SketchEditor } from "../editor/sketchEditor";
import { additivePick, sketchEntityMesh } from "../editor/sketchEventHandler";
import { type OffsetOutcome, offsetEntities, offsetPreview } from "../offsetOps";
import { type DimensionAnchor, type SketchEntityData, toWorld } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * Where the copy would land — the trim's and the mirror's own tone, for the same reason:
 * nothing of it is on the sketch yet, so the preview is the only thing saying where it
 * goes. Dashed, so a copy landing over real geometry still reads as a proposal.
 */
const OFFSET_PREVIEW_COLOR = 0xff6b6b;
const OFFSET_PREVIEW_LINE_WIDTH = 3;

/** The arrow's anchor: a point on the picked geometry, and the direction the value grows in. */
export interface OffsetAnchor {
    readonly point: [number, number];
    readonly direction: [number, number];
}

export interface OffsetSessionData {
    /** The sketch being edited: its selection *is* the set to offset. */
    readonly editor: SketchEditor;
    /**
     * Where viewport events go when they are not the arrow's — the sketch's own handler,
     * so clicking and boxing curves, their hover and their highlight all behave exactly as
     * they do outside the command.
     */
    readonly picking: IEventHandler;
    /** The anchor on the current selection, or `undefined` when it reads no side off it. */
    resolveAnchor(sources: readonly number[]): OffsetAnchor | undefined;
    /** Sketch units: what counts as a shared corner. Never the least confirmable distance. */
    readonly tolerance: number;
    /** The command's current distance, so the arrow starts in sync with its input. */
    readonly distance?: number;
    onReady?(session: SketchOffsetSession): void;
    onDone?(): void;
    /** The session reports the signed distance so the command syncs its input. */
    onDistance?(value: number): void;
}

/**
 * The offset's session: the arrow sits on the selected geometry and the sketch keeps
 * being worked in underneath it. Select a curve — click it, or rubber-band several — and
 * the arrow appears on it with the offset previewed; drag the arrow and the distance
 * changes under the hand; select more curves and the same offset applies to all of them
 * at once. Picking and dragging are one session rather than two stages, which is how the
 * extrude and revolve handles work as well.
 *
 * That is also why it forwards rather than owns: anything not aimed at the arrow goes to
 * the sketch's own event handler, so entity picking, hovering, the rubber band and
 * endpoint dragging stay the ones the user already knows. Only the arrow's own gestures,
 * and the keys that type its value, are handled here.
 *
 * The arrow points the direction a *positive* value moves the copy, which is the anchor
 * entity's own "left": for a line that is its left normal, for an arc the way to its
 * centre, for a circle outward. Drag the other way and the value goes negative and the
 * arrow turns round, so it always sits where the copy went.
 */
export class SketchOffsetSession extends AxisDragHandler {
    private _distance: number;
    private _arrowHovered = false;
    private anchor: OffsetAnchor | undefined;
    private origin: XYZ | undefined;
    private direction: XYZ | undefined;
    /** The press in flight is the arrow's, so the rest of that gesture is too. */
    private arrowGesture = false;
    /** The base is in click-move mode: the value is settled by the next release. */
    private moveMode = false;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly data: OffsetSessionData,
    ) {
        super(document, controller);
        this._distance = data.distance ?? 0;
        this.syncSelection();
        this.start();
    }

    /** The distance the user settled on — what the command commits. */
    get distance(): number {
        return this._distance;
    }

    /** The curves being offset: the sketch's own selection. */
    private get sources(): number[] {
        return this.data.editor.selectedEntityIds();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    protected override axis(): { origin: XYZ; normal: XYZ } {
        return { origin: this.origin ?? XYZ.zero, normal: this.direction ?? XYZ.unitX };
    }

    /**
     * The arrow's tail is the offset itself: it starts on the anchor and slides out as the
     * value grows, so its position *is* the readout. Past zero it turns round rather than
     * doubling back over the geometry. No anchor (nothing selected) collapses to a point,
     * which the base reads as no arrow at all.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        if (this.origin === undefined || this.direction === undefined) {
            return { start: XYZ.zero, end: XYZ.zero };
        }
        const start = this.origin.add(this.direction.multiply(this._distance));
        const direction = this._distance < -Precision.Float ? this.direction.multiply(-1) : this.direction;
        return { start, end: start.add(direction.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    /** Measured at the anchor so the arrow does not pulse as the offset moves it. */
    protected override scaleAnchor(): XYZ {
        return this.origin ?? XYZ.zero;
    }

    protected override currentValue(): number {
        return this._distance;
    }

    protected override setCurrentValue(value: number): void {
        this._distance = value;
        this.data.onDistance?.(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    /**
     * The arrow's own hover feedback — without this it never lights up, since the base
     * leaves the hook empty and only its own click path ever sets the flag. The plane
     * offset's handle does the same, including rebuilding an arrow that had no view to
     * take its pixel size from when it was first built.
     */
    protected override onHover(view: IView, event: PointerEvent): void {
        if (this.arrowLength === undefined) this.refreshArrow(view);
        this.setArrowHover(view, this.isOverArrow(view, event));
    }

    /**
     * Confirming takes a set as well as a distance: with nothing selected there is nothing
     * to offset, and no arrow on screen to drag either.
     *
     * What counts as a distance at all is the sketch's own coincidence scale, not the
     * drag's screen tolerance: keyed to the screen, a real distance would become
     * unconfirmable just because the view is zoomed out (and the confirm button says
     * nothing when it refuses).
     */
    protected override canConfirm(): boolean {
        return this.sources.length > 0 && Math.abs(this._distance) > Precision.Distance;
    }

    /** The copies the current value would make, in the tone a proposal is drawn in. */
    protected override buildPreview(): DragPreview {
        const copies = offsetPreview(
            this.data.editor.solver,
            this.sources,
            this._distance,
            this.data.tolerance,
        );
        return { meshes: copies.map((copy) => offsetPreviewMesh(this.data.editor, copy)) };
    }

    /** The copy is what is being aimed at, so it must not hide behind the geometry. */
    protected override previewOnTop(): boolean {
        return true;
    }

    /** With no anchor there is no arrow to grab — its segment would be a point. */
    protected override isOverArrow(view: IView, event: PointerEvent): boolean {
        return this.anchor !== undefined && super.isOverArrow(view, event);
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onCleanup(): void {
        // the badges take pointer events again once nothing is being dragged
        this.data.editor.annotations.inertConstraintSymbols = false;
        this.data.onDone?.();
    }

    // ------------------------------------------------------------------ Click-move mode bookkeeping

    protected override enterMoveMode(view: IView, event: PointerEvent): void {
        this.moveMode = true;
        super.enterMoveMode(view, event);
    }

    protected override finishMoveMode(view: IView): void {
        this.moveMode = false;
        super.finishMoveMode(view);
    }

    protected override exitMoveMode(view: IView): void {
        this.moveMode = false;
        super.exitMoveMode(view);
    }

    // ------------------------------------------------------------------ Events: the arrow's, or the sketch's

    override pointerDown(view: IView, event: PointerEvent): void {
        this.arrowGesture = this.moveMode || this.isOverArrow(view, event);
        this.updateBadgeInterception(view, event);
        if (this.arrowGesture) {
            super.pointerDown(view, event);
            return;
        }
        this.data.picking.pointerDown(view, additivePick(event));
        this.syncSelection();
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        // the base also runs the arrow's hover feedback, which is wanted either way
        super.pointerMove(view, event);
        this.updateBadgeInterception(view, event);
        if (this.moveMode || this.arrowGesture) return;
        this.data.picking.pointerMove(view, additivePick(event));
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        this.updateBadgeInterception(view, event);
        if (this.moveMode || this.arrowGesture) {
            super.pointerUp(view, event);
            this.arrowGesture = false;
            this.syncSelection();
            return;
        }
        // the sketch may have selected a box, or dragged a point and committed: its
        // redraw can leave the overlays stale, so they go back up whatever it did
        this.data.picking.pointerUp(view, additivePick(event));
        this.syncSelection();
        this.refresh();
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.data.picking.pointerOut?.(view, additivePick(event));
    }

    override mouseWheel(view: IView, event: WheelEvent): void {
        super.mouseWheel(view, event);
        this.data.picking.mouseWheel?.(view, event);
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        // Escape (out of the drag, then out of the command), Enter, and the digits that
        // type a value are the drag's. Deleting a picked curve is a sketch edit and has to
        // reach the sketch, which also changes what the offset applies to.
        if (event.key === "Delete" || event.key === "Backspace") {
            this.data.picking.keyDown(view, event);
            this.syncSelection();
            return;
        }
        super.keyDown(view, event);
    }

    /**
     * While the arrow is being aimed at or moved, the sketch's floating constraint badges
     * stop taking pointer events. They are DOM overlays while the arrow is a mesh, so one
     * lying over the arrow would take the press that grabs it — or the click that settles
     * its value — and the browser would never know the arrow was under it. They stay
     * drawn; only the interception goes, and only while this lasts.
     */
    private updateBadgeInterception(view: IView, event: PointerEvent): void {
        this.data.editor.annotations.inertConstraintSymbols =
            this.moveMode || this.arrowGesture || this.isOverArrow(view, event);
    }

    // ------------------------------------------------------------------ Following the selection

    /**
     * Re-reads the selection and, when it moved, re-anchors the arrow and redraws it and
     * the preview. This is what makes the arrow appear the moment a curve is picked (the
     * sketch's own click path did the picking) and follow every later box, add or delete.
     */
    private syncSelection(): void {
        const sources = this.sources;
        const anchor = sources.length === 0 ? undefined : this.data.resolveAnchor(sources);
        if (sameAnchor(anchor, this.anchor)) return;
        this.anchor = anchor;
        const plane = this.data.editor.node.plane;
        if (anchor === undefined) {
            this.origin = undefined;
            this.direction = undefined;
        } else {
            const [u, v] = anchor.point;
            const [du, dv] = anchor.direction;
            this.origin = toWorld(plane, u, v);
            this.direction =
                toWorld(plane, u + du, v + dv)
                    .sub(this.origin)
                    .normalize() ?? undefined;
        }
        this.refresh();
    }
}

/** Whether two anchors are the same spot and the same side. */
function sameAnchor(first: OffsetAnchor | undefined, second: OffsetAnchor | undefined): boolean {
    if (first === undefined || second === undefined) return first === second;
    const near = (a: number, b: number) => Math.abs(a - b) <= Precision.Float;
    return (
        near(first.point[0], second.point[0]) &&
        near(first.point[1], second.point[1]) &&
        near(first.direction[0], second.direction[0]) &&
        near(first.direction[1], second.direction[1])
    );
}

/** One prospective copy as the session previews it — the entity's own mesh, dashed. */
function offsetPreviewMesh(editor: SketchEditor, copy: SketchEntityData): EdgeMeshData {
    const mesh = sketchEntityMesh(editor, copy, OFFSET_PREVIEW_COLOR, "dash");
    mesh.lineWidth = OFFSET_PREVIEW_LINE_WIDTH;
    return mesh;
}

/**
 * Offsets the selected curves by a distance the arrow is dragged to, as a copy tied to
 * them — move the source or edit the distance afterwards and the copy follows. Pick them
 * before or during: the tool is one live session (see `SketchOffsetSession`), and the
 * copies land with a dimension from each line to its source, editable afterwards like any
 * other (see `offsetOps.ts` for what that tie holds and where it stops).
 *
 * One shot per invocation: the confirm commits and the command is over, so the next
 * offset starts the tool again (at whatever distance it was left holding). ESC, or a drag
 * that never settles, leaves the sketch alone.
 */
@command({ key: "sketch.offset", icon: "icon-offset" })
export class SketchOffsetCommand extends SketchConstraintCommand {
    private _session: SketchOffsetSession | undefined;
    /** Set while the session pushes a value in, so the setter does not push it back. */
    private _syncingFromSession = false;
    /**
     * Set while the setter drives the session, so the echo it returns — the number the
     * typed value resolved to — does not land back on the property and replace it.
     */
    private _pushingToSession = false;

    /** The offset distance, dragged on the arrow or typed here (an expression is fine). */
    @property("sketch.offsetDistance", { unit: LENGTH_UNITS })
    get distance(): ParameterValue {
        return this.getPrivateValue("distance", 0);
    }
    set distance(value: ParameterValue) {
        if (!this.setProperty("distance", value)) return;
        if (this._syncingFromSession || this._session === undefined) return;
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        if (!resolved.isOk) return;
        // the session echoes the number straight back through `onDistance`; swallowed
        // there, so an expression typed above survives instead of becoming its value
        this._pushingToSession = true;
        this._session.setValue(resolved.value);
        this._pushingToSession = false;
    }

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        await this.offsetOnce(editor);
    }

    /**
     * The session: the arrow is up as soon as anything is selected, and it ends on a
     * confirm (which commits) or on ESC (which does not). What was confirmed is read off
     * the editor's selection — that is what the user picked with.
     */
    private async offsetOnce(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const controller = this.controller;
        const session = new SketchOffsetSession(editor.document, controller, this.sessionData(editor));
        try {
            await editor.document.picker.pickAsync(
                session,
                "prompt.pickOffsetEntities",
                controller,
                "none",
                // the picking cursor, not the drawing one: this session selects curves
                // (and drags a handle), it does not lay geometry down
                "select.default",
            );
        } finally {
            session.dispose();
        }

        // The session may have ended under the drag (another view, a closed document):
        // `picker.pickAsync` restores whatever handler it replaced, which by then is a
        // disposed sketch handler, so nothing may touch the editor from here on.
        if (SketchEditor.getActive() !== editor) return;
        if (controller.result?.status !== "success") return;
        const sources = editor.selectedEntityIds();
        if (sources.length === 0) return;
        if (this.applyOffset(editor, sources, session.distance)) editor.clearEntitySelection();
    }

    /**
     * What the session needs of the command: the sketch it works in, the handler to hand
     * every non-arrow event to, and the two-way tie between its distance and this
     * command's input.
     */
    private sessionData(editor: SketchEditor): OffsetSessionData {
        return {
            editor,
            // read before the swap: the sketch's handler is the one in place, and
            // everything not aimed at the arrow has to keep reaching it
            picking: editor.document.visual.eventHandler,
            resolveAnchor: (sources) => anchorOf(editor.solver, sources),
            tolerance: Math.max(editor.screenTolerance(), 1e-6),
            distance: this.appliedDistance(),
            onReady: (created) => {
                this._session = created;
            },
            onDone: () => {
                this._session = undefined;
            },
            onDistance: (value) => {
                if (this._pushingToSession) return;
                this._syncingFromSession = true;
                this.distance = value;
                this._syncingFromSession = false;
            },
        };
    }

    /** Runs the op and commits, or reports why it would not. Either way the tool is done. */
    private applyOffset(editor: SketchEditor, sourceIds: readonly number[], distance: number): boolean {
        const result = offsetEntities(editor.solver, sourceIds, distance, editor.screenTolerance());
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return false;
        }
        const { dimensions, branched, noJoin } = result.value;
        for (const dimension of dimensions) {
            editor.dimensionAnchors.set(dimension.constraintId, offsetLabel(editor, dimension));
        }
        if (branched > 0) PubSub.default.pub("statusBarTip", "sketch.offsetBranched{0}", branched);
        if (noJoin > 0) PubSub.default.pub("statusBarTip", "sketch.offsetNoJoin{0}", noJoin);
        editor.solve(true);
        editor.commit();
        return true;
    }

    /** The distance the run would use, resolved against the document's parameters. */
    private appliedDistance(): number {
        const resolved = this.resolveParameter(this.distance, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }
}

/**
 * Where the offset's dimension goes: halfway between the copy's point and its foot on the
 * source line, so the label reads across the gap it measures. Without an anchor the
 * annotation layer falls back to the line's own middle, which for a point-to-line
 * dimension sits on the geometry.
 */
function offsetLabel(editor: SketchEditor, dimension: OffsetOutcome["dimensions"][number]): DimensionAnchor {
    const point = editor.solver.pointOf(dimension.point);
    const foot =
        pointLineFoot(
            point,
            editor.solver.pointOf(dimension.line[0]),
            editor.solver.pointOf(dimension.line[1]),
        ) ?? point;
    return {
        kind: "offset",
        ...labelOnSegment(point, foot, [(point[0] + foot[0]) / 2, (point[1] + foot[1]) / 2]),
    };
}

/**
 * The arrow's anchor on the first picked entity a side can be read off: the point the
 * arrow sits on, and the direction a positive distance moves the copy — the entity's own
 * "left", which is what the op's sign means (see `offsetParams`).
 */
function anchorOf(solver: SketchSolver, sourceIds: readonly number[]): OffsetAnchor | undefined {
    for (const id of sourceIds) {
        const entity = solver.entity(id);
        const anchor = entity === undefined ? undefined : anchorOn(entity);
        if (anchor !== undefined) return anchor;
    }
    return undefined;
}

/**
 * One entity's anchor, or `undefined` when there is no direction to read off it at all.
 * "Too small" is the sketch's own scale here too — a line shorter than a screen pixel is
 * still a line, and its arrow is drawn at a fixed pixel size wherever it sits.
 */
function anchorOn(entity: SketchEntityData): OffsetAnchor | undefined {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = Math.hypot(x2 - x1, y2 - y1);
        if (length <= Precision.Distance) return undefined;
        return {
            point: [(x1 + x2) / 2, (y1 + y2) / 2],
            direction: [-(y2 - y1) / length, (x2 - x1) / length],
        };
    }
    const [cx, cy, sx, sy] = entity.params;
    if (entity.type === "circle") {
        const radius = entity.params[2];
        if (radius <= Precision.Distance) return undefined;
        return { point: [cx + radius, cy], direction: [1, 0] }; // outward: a circle's own positive
    }
    // an arc's left is the way to its centre, and its start point carries its radius
    const radius = Math.hypot(sx - cx, sy - cy);
    if (radius <= Precision.Distance) return undefined;
    return { point: [sx, sy], direction: [(cx - sx) / radius, (cy - sy) / radius] };
}
