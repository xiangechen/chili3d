// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    Combobox,
    command,
    type EdgeMeshData,
    type I18nKeys,
    type IDocument,
    type IEventHandler,
    type IView,
    MeshDataUtils,
    type ParameterValue,
    type Plane,
    Precision,
    PubSub,
    property,
    type ShapeMeshData,
    VisualConfig,
    XYZ,
} from "@chili3d/core";
import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    ARROW_HOVER_TOLERANCE,
    ARROW_LENGTH,
    arrowMeshes,
    distanceToSegment,
} from "../../commands/arrowHandle";
import { AxisDragHandler, type DragPreview } from "../../commands/axisDragHandler";
import {
    type ArrayDraft,
    type ArrayField,
    type ArrayRun,
    arrayPreview,
    centerOf,
    DRAFT_ARRAY_ID,
    type ResolvedArray,
    resolveArray,
    withField,
} from "../arrayOps";
import { snapPosition } from "../autoConstraints";
import { SketchEditor } from "../editor/sketchEditor";
import { additivePick, sketchEntityMesh } from "../editor/sketchEventHandler";
import {
    originRef,
    type SketchArrayAxis,
    type SketchArrayCenter,
    type SketchArrayData,
    type SketchArrayPattern,
    type SketchArrayType,
    type SketchEntityData,
    toUV,
    toWorld,
} from "../sketchModel";
import { transformBase } from "../transformOps";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * Where the copies would land — the mirror's and the offset's own tone, for the same reason:
 * nothing of it is on the sketch yet, so the preview is the only thing saying where it goes.
 * Dashed, so copies landing over real geometry still read as a proposal.
 */
const ARRAY_PREVIEW_COLOR = 0xff6b6b;
const ARRAY_PREVIEW_LINE_WIDTH = 3;

/** The pattern types as the options bar offers them, and the name each one reads by. */
const PATTERN_TYPES: readonly SketchArrayType[] = ["linear", "circular", "curve"];
const PATTERN_KEY: Record<SketchArrayType, I18nKeys> = {
    linear: "option.command.patternType.linear",
    circular: "option.command.patternType.circular",
    curve: "option.command.patternType.curve",
};
const TYPE_OF_KEY = new Map<I18nKeys, SketchArrayType>(
    PATTERN_TYPES.map((type) => [PATTERN_KEY[type], type]),
);

/** The handles the session puts on screen: one for each number that can be dragged. */
type ArrayHandle = "xSpacing" | "ySpacing" | "curveSpacing" | "turn" | "center";

/** Which number a handle drags. */
const HANDLE_FIELDS: Partial<Record<ArrayHandle, ArrayField>> = {
    xSpacing: "spacingX",
    ySpacing: "spacingY",
    curveSpacing: "spacing",
    turn: "twist",
};

/**
 * The handles dragged by where the pointer lands on the plane rather than by how far it slid
 * along a line: a centre is *placed*, not measured. It is the same kind of handle as the
 * transform tool's square and origin (`SketchTransformSession.isPointDrag`).
 */
function isPointDrag(handle: ArrayHandle): boolean {
    return handle === "center";
}

/**
 * One handle as it sits on screen: the shaft it is drawn and aimed along, and — separately —
 * the line its drag is measured on. The two are the same line only when the handle's number is
 * a plain distance: a turn is measured as arc length at the seed's radius and read in degrees,
 * so its axis carries the conversion (`180/πr`), exactly as the transform's rotate handle does.
 */
interface ArrayHandleGeometry {
    readonly role: ArrayHandle;
    readonly start: XYZ;
    readonly end: XYZ;
    readonly origin: XYZ;
    readonly normal: XYZ;
}

export interface ArraySessionData {
    /** The sketch being edited: its selection *is* the set to array — see `resolveSources`. */
    readonly editor: SketchEditor;
    /**
     * Where viewport events go when they are not a handle's — the sketch's own handler, so
     * clicking and boxing curves, their hover and their highlight all behave exactly as they
     * do outside the command.
     */
    readonly picking: IEventHandler;
    /** The pattern as the command holds it: its numbers are the user's, expressions included. */
    readonly pattern: SketchArrayPattern;
    /**
     * The array being edited, when the run opened on one, so the preview can leave out the
     * instances the user took out of it — `undefined` for a pattern being made, which has no
     * holes to honour. The record itself rather than its slots: the holes only mean anything
     * against the source list they were written with (`arrayPreview`).
     */
    readonly record?: SketchArrayData;
    /**
     * The record this run is editing, when it opened on one — so the canvas can leave that
     * record's own numbers out while the run holds its draft.
     */
    readonly editing?: number;
    /**
     * What is being patterned at this moment. Not simply the selection: re-opening an array
     * leaves its instances selected, and those are the pattern's *result* — while any other
     * geometry the user clicks is the pattern's new source, which is how an edit re-points one.
     */
    resolveSources(): number[];
    onReady?(session: SketchArraySession): void;
    onDone?(): void;
    /** The session reports a number the hand settled, so the command syncs its own input. */
    onFieldChange?(field: ArrayField, value: ParameterValue): void;
    /**
     * The session reports a pattern it has put back whole — a gesture the user abandoned —
     * so the command's fields follow it instead of keeping what the gesture left behind.
     */
    onPatternRestored?(pattern: SketchArrayPattern): void;
}

/** How big the centre's own mark reads, in screen pixels — the area a press has to land on. */
const CENTRE_MARK_HALF_PX = 9;

/**
 * The array's session: the seed stays selected in the sketch, the copies are previewed from it
 * and the sketch keeps being worked in underneath. That is why the session forwards rather than
 * owns — anything not aimed at a handle goes to the sketch's own event handler, so entity
 * picking, hovering, the rubber band and endpoint dragging stay the ones the user already knows.
 *
 * Its handles are the numbers: an arrow per direction the pattern marches in, and the centre a
 * turn goes about — the same shape as the transform tool's triad
 * (`SketchTransformSession`), and for the same reason: one drag axis per number, hit-tested by
 * nearest, with the base's own single arrow switched off.
 */
export class SketchArraySession extends AxisDragHandler {
    private pattern: SketchArrayPattern;
    /** The handle under the gesture, and the one the pointer is merely near. */
    private _hoveredHandle: ArrayHandle | undefined;
    private _activeHandle: ArrayHandle | undefined;
    /** The axes the gesture under way reads, taken before the first value can move the seed. */
    private _frozenAxis: { origin: XYZ; normal: XYZ } | undefined;
    private _arrowHovered = false;
    /** The press in flight is a handle's, so the rest of that gesture is too. */
    private arrowGesture = false;
    /** The base is in click-move mode: the value is settled by the next release. */
    private moveMode = false;
    /** Where the seed sits on the plane, so the handles do not wander as the pattern is placed. */
    private seed: XYZ | undefined;
    /** Where a centre drag was taken hold of, in sketch (u, v), and what it started from. */
    private _centreGrab: { uv: [number, number]; center: SketchArrayCenter } | undefined;
    /**
     * The pattern as the gesture under way found it. A drag writes straight into the pattern
     * — which is what the canvas draws and what the confirm would commit — so abandoning one
     * has to put the whole of it back, not just the number the handle was aimed at: pulling a
     * direction's arrow out is also what turns its count on (`setCurrentValue`).
     */
    private _gestureStart: SketchArrayPattern | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly data: ArraySessionData,
    ) {
        super(document, controller);
        this.pattern = data.pattern;
        this.syncSelection();
        this.start();
    }

    /** The pattern the tool would write as it stands — what the command commits. */
    get candidate(): SketchArrayPattern {
        return this.pattern;
    }

    // ------------------------------------------------------------------ The command's side

    /**
     * Writes one of the pattern's numbers. A dragged value is the plain number the gesture
     * produced; one from the options bar keeps whatever it is — a literal, or the expression
     * the field holds.
     */
    setField(field: ArrayField, value: ParameterValue): void {
        const next = withField(this.pattern, field, value);
        if (next === this.pattern) return;
        this.pattern = next;
        this.data.onFieldChange?.(field, value);
        this.refreshAll();
    }

    setEqualSpacing(value: boolean): void {
        if (this.pattern.type !== "circular" || this.pattern.equalSpacing === value) return;
        this.pattern = { ...this.pattern, equalSpacing: value };
        this.refreshAll();
    }

    /**
     * What the canvas draws this pattern from while the tool is up — the numbers the user
     * double-clicks, handed to the editor as its live draft (`SketchEditor.arrayDraft`).
     */
    draft(): ArrayDraft {
        // a live view, not a snapshot: the canvas reads it on every refresh, and the whole
        // point of the draft is that it follows the tool's own numbers as they change
        const session = this;
        return {
            id: DRAFT_ARRAY_ID,
            get pattern() {
                return session.pattern;
            },
            get sourceIds() {
                return session.sources;
            },
            editing: this.data.editing,
            set: (field, value) => this.setField(field, value),
        };
    }

    /** The entities being patterned — see `ArraySessionData.resolveSources`. */
    private get sources(): number[] {
        return this.data.resolveSources();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /** The handle under the gesture, or under the pointer, or none at all. */
    private get activeHandle(): ArrayHandle | undefined {
        return this._activeHandle ?? this._hoveredHandle;
    }

    /**
     * The drag axis of the handle under the gesture: the line the pointer's travel is
     * projected onto. A handle whose number is not a plain distance carries the conversion in
     * this vector's length — see `handles()`, where each one is built.
     */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        if (this._frozenAxis !== undefined) return this._frozenAxis;
        return this.handleOf(this.activeHandle) ?? { origin: XYZ.zero, normal: XYZ.unitX };
    }

    /**
     * A point, never a segment: the base draws one arrow from here, and the session draws one
     * per handle instead. Degenerating is how the base's own arrow is switched off — its
     * `normalize()` reads a zero-length shaft as no direction at all.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        return { start: XYZ.zero, end: XYZ.zero };
    }

    /** Measured at the seed, so the handles keep their size where the pattern starts. */
    protected override scaleAnchor(): XYZ {
        return this._frozenAxis?.origin ?? this.seed ?? XYZ.zero;
    }

    /**
     * The base's own hit test measures against the one arrow it draws, which this session
     * suppresses — so it is answered from the handles instead, as the transform tool's is.
     */
    protected override isOverArrow(view: IView, event: PointerEvent): boolean {
        return this.handleAt(view, event) !== undefined;
    }

    protected override currentValue(): number {
        const handle = this.activeHandle;
        return (handle === undefined ? undefined : this.runFor(handle))?.spacing.value ?? 0;
    }

    protected override setCurrentValue(value: number): void {
        const handle = this._activeHandle;
        const field = handle === undefined ? undefined : HANDLE_FIELDS[handle];
        if (field === undefined) return;
        // pulling out the arrow of a direction that lays down a single instance is what *turns
        // that direction on*: the arrow is the direction, and one that only moved a number
        // nothing reads would be a handle that does nothing
        this.setField(field, value);
        const axis = this.axisOfField(field);
        if (axis !== undefined && axis.count === 1 && Math.abs(value) > Precision.Float) {
            this.setField(this.countFieldOf(field), 2);
        }
    }

    /** The axis a linear field belongs to, or `undefined` for any other field. */
    private axisOfField(field: ArrayField): SketchArrayAxis | undefined {
        if (this.pattern.type !== "linear") return undefined;
        if (field === "spacingX" || field === "countX") return this.pattern.x;
        if (field === "spacingY" || field === "countY") return this.pattern.y;
        return undefined;
    }

    /** The count that goes with a linear spacing — the one its arrow turns on. */
    private countFieldOf(field: ArrayField): ArrayField {
        return field === "spacingX" ? "countX" : "countY";
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    /**
     * The handles' own hover feedback — without it none of them would light up, since the base
     * leaves the hook empty. The arrow length has to be built before the first hit test can
     * size anything.
     */
    protected override onHover(view: IView, event: PointerEvent): void {
        if (this.arrowLength === undefined) this.refreshArrow(view);
        const hovered = this.handleAt(view, event);
        if (hovered === this._hoveredHandle) return;
        this._hoveredHandle = hovered;
        this.refresh();
    }

    /**
     * Confirming takes a set as well as a placing: with nothing to array there is nothing to
     * copy, and a pattern whose numbers the solver cannot place — a spacing of zero, a turn of
     * none — is refused here rather than left half-made.
     */
    protected override canConfirm(): boolean {
        return this.plan() !== undefined;
    }

    /** The copies the current numbers make, and the handles that write them. */
    protected override buildPreview(): DragPreview {
        const copies = this.plan();
        return {
            meshes: [
                ...(copies ?? []).map((copy) => arrayPreviewMesh(this.data.editor, copy)),
                ...this.handleMeshes(),
            ],
        };
    }

    /** The glyphs' white is the look, not a surface to shade (see the transform's own note). */
    protected override previewUnlit(): boolean {
        return true;
    }

    /** The copies and the handles are what is being aimed at: they must not hide behind it. */
    protected override previewOnTop(): boolean {
        return true;
    }

    /** Handles are pixel-sized, and preview meshes are only rebuilt when something asks. */
    protected override onCameraChanged(view: IView): void {
        this.refreshTempShapes(view);
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
        // the click path reaches here without a pointerDown, so the gesture is taken here too
        this._activeHandle = this._hoveredHandle;
        this.beginGesture(view, event);
        super.enterMoveMode(view, event);
    }

    protected override finishMoveMode(view: IView): void {
        this.moveMode = false;
        this.forgetGesture();
        super.finishMoveMode(view);
    }

    protected override exitMoveMode(view: IView): void {
        // the gesture is forgotten after the base has run: leaving the mode is what resets the
        // pattern, and the value it resets to is the one this holds
        this.moveMode = false;
        super.exitMoveMode(view);
        this.forgetGesture();
    }

    // ------------------------------------------------------------------ Events: a handle's, or the sketch's

    override pointerDown(view: IView, event: PointerEvent): void {
        // the hit test runs here rather than trusting the last hover: a click can land
        // straight on a handle with no move before it
        const hovered = this.handleAt(view, event);
        this._hoveredHandle = hovered;
        this.arrowGesture = this.moveMode || hovered !== undefined;
        if (this.arrowGesture) {
            this._activeHandle = hovered;
            // taken before the first value can move anything out from under the gesture
            this.beginGesture(view, event);
        }
        this.updateBadgeInterception(view, event);
        if (this.arrowGesture) {
            super.pointerDown(view, event);
            return;
        }
        this.data.picking.pointerDown(view, additivePick(event));
        this.syncSelection();
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        // the base also runs the handles' hover feedback, which is wanted either way
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
            this._activeHandle = undefined;
            // a click that only opened the click-move-click gesture has not ended it
            if (!this.moveMode) this.forgetGesture();
            this.syncSelection();
            return;
        }
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
        // Escape (out of the drag, then out of the command), Enter, and the digits that type
        // a value are the drag's. Deleting a picked curve is a sketch edit and has to reach
        // the sketch, which also changes what the array applies to.
        if (event.key === "Delete" || event.key === "Backspace") {
            this.data.picking.keyDown(view, event);
            this.syncSelection();
            return;
        }
        super.keyDown(view, event);
    }

    /**
     * While a handle is being aimed at or moved, the sketch's floating constraint badges stop
     * taking pointer events — they are DOM overlays while a handle is a mesh, so one lying over
     * a handle would take the press that grabs it.
     */
    private updateBadgeInterception(view: IView, event: PointerEvent): void {
        this.data.editor.annotations.inertConstraintSymbols =
            this.moveMode || this.arrowGesture || this.handleAt(view, event) !== undefined;
    }

    // ------------------------------------------------------------------ The handles

    /** The pattern as the solver reads it, or `undefined` while it cannot be placed at all. */
    private resolved(): ResolvedArray | undefined {
        const sources = this.sources;
        const solver = this.data.editor.solver;
        if (sources.length === 0) return undefined;
        const resolved = resolveArray(solver, this.pattern, sources, solver.scope);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The run a handle drags, out of the pattern's own runs — the number as it reads. */
    private runFor(handle: ArrayHandle): ArrayRun | undefined {
        const field = HANDLE_FIELDS[handle];
        return this.resolved()?.runs.find((run) => run.spacing.field === field);
    }

    /**
     * The handles this pattern has: an arrow per direction it marches in, and the centre a turn
     * goes about. Each is drawn at the seed and at a constant size — a handle is aimed at, not
     * measured — so a shaft says which way its number grows and never how big it is.
     */
    private handles(): ArrayHandleGeometry[] {
        const seed = this.seed;
        const resolved = this.resolved();
        if (seed === undefined || resolved === undefined) return [];
        const plane = this.data.editor.node.plane;
        // A linear pattern has both of its directions on the canvas whatever their counts: the
        // arrows *are* the two directions, and the one that lays down a single instance has no
        // run to be read off — its handle is still how it is given one (see `setCurrentValue`).
        if (this.pattern.type === "linear") return this.linearHandles(seed, resolved, plane);

        const handles: ArrayHandleGeometry[] = [];
        for (const run of resolved.runs) {
            const handle = this.runHandle(run, seed, resolved, plane);
            if (handle !== undefined) handles.push(handle);
        }
        // The centre a turn goes about: a handle of its own, dragged rather than measured —
        // `isPointDrag` is what tells it apart from the arrows. It is placed where the pattern
        // is, and lands on a snap when there is one (`dragCentre`).
        if (this.pattern.type === "circular") handles.push(this.centreHandle(resolved, plane));
        return handles;
    }

    /** A linear pattern's two arrows: one per direction it marches in, both drawn at the seed. */
    private linearHandles(seed: XYZ, resolved: ResolvedArray, plane: Plane): ArrayHandleGeometry[] {
        const axes: [ArrayHandle, XYZ, number][] = [
            ["xSpacing", plane.xvec, this.axisSpacing(resolved, "spacingX")],
            ["ySpacing", plane.yvec, this.axisSpacing(resolved, "spacingY")],
        ];
        return axes.map(([role, axis, spacing]) => {
            const drawn = axis.multiply(spacing < 0 ? -1 : 1);
            return {
                role,
                start: seed,
                end: seed.add(drawn.multiply(this.handleLength)),
                origin: seed,
                // a unit vector: the drag measures a plain distance, in sketch units
                normal: drawn,
            };
        });
    }

    /** One run's arrow — the turn's own, or the direction the curve leaves the seed in. */
    private runHandle(
        run: ArrayRun,
        seed: XYZ,
        resolved: ResolvedArray,
        plane: Plane,
    ): ArrayHandleGeometry | undefined {
        if (run.spacing.field === "twist") return this.turnHandle(seed, resolved, plane);
        const along = this.runDirection(run, plane);
        if (along === undefined) return undefined;
        const drawn = along.multiply(run.spacing.value < 0 ? -1 : 1);
        return {
            role: "curveSpacing",
            start: seed,
            end: seed.add(drawn.multiply(this.handleLength)),
            origin: seed,
            normal: drawn,
        };
    }

    /** The turn's arrow, at the seed and along the way the turn runs — counter-clockwise. */
    private turnHandle(seed: XYZ, resolved: ResolvedArray, plane: Plane): ArrayHandleGeometry | undefined {
        const center = toWorld(plane, resolved.base[0], resolved.base[1]);
        const radial = seed.sub(center);
        const radius = radial.length();
        const tangent = plane.normal.cross(radial).normalize();
        if (radius <= Precision.Float || tangent === undefined) return undefined;
        return {
            role: "turn",
            start: seed,
            end: seed.add(tangent.multiply(this.handleLength)),
            origin: seed,
            // arc length at the seed's radius, read in degrees: the axis carries 180/πr
            normal: tangent.multiply(180 / (Math.PI * radius)),
        };
    }

    /** The mark a turn goes about: placed where the pattern is, and dragged rather than measured. */
    private centreHandle(resolved: ResolvedArray, plane: Plane): ArrayHandleGeometry {
        const center = toWorld(plane, resolved.base[0], resolved.base[1]);
        return { role: "center", start: center, end: center, origin: center, normal: XYZ.unitX };
    }

    /** A direction's own spacing, whatever it lays down — what its handle starts the drag from. */
    private axisSpacing(resolved: ResolvedArray, field: ArrayField): number {
        return resolved.runs.find((run) => run.spacing.field === field)?.spacing.value ?? 0;
    }

    private handleOf(role: ArrayHandle | undefined): ArrayHandleGeometry | undefined {
        return role === undefined ? undefined : this.handles().find((handle) => handle.role === role);
    }

    /**
     * The handle the pointer is nearest, or undefined. The base's own hit test only ever knows
     * about one arrow, so the session's are tested here and the nearest wins.
     */
    private handleAt(view: IView, event: PointerEvent): ArrayHandle | undefined {
        let nearest: ArrayHandle | undefined;
        let best = ARROW_HOVER_TOLERANCE;
        for (const handle of this.handles()) {
            const distance = this.handleDistance(view, handle, event);
            if (distance <= best) {
                best = distance;
                nearest = handle.role;
            }
        }
        return nearest;
    }

    private handleDistance(view: IView, handle: ArrayHandleGeometry, event: PointerEvent): number {
        const start = view.worldToScreen(handle.start);
        if (!isPointDrag(handle.role)) {
            return distanceToSegment(event.offsetX, event.offsetY, start, view.worldToScreen(handle.end));
        }
        // a centre is an area rather than a line, so anywhere on its mark counts — and it
        // answers with nought from inside, which keeps a press on it from being read as a press
        // on whatever shaft passes under it
        const away = Math.hypot(event.offsetX - start.x, event.offsetY - start.y);
        return Math.max(0, away - CENTRE_MARK_HALF_PX);
    }

    /** The direction a run leaves the seed in, read off the run's own path. */
    private runDirection(run: ArrayRun, plane: Plane): XYZ | undefined {
        const [from, to] = run.path;
        if (from === undefined || to === undefined) return undefined;
        return toWorld(plane, to[0], to[1])
            .sub(toWorld(plane, from[0], from[1]))
            .normalize();
    }

    /**
     * Takes what the gesture under way reads, before the first value moves anything: the axes
     * its value is measured on, the pattern it is about to write into, and where a centre drag
     * was taken hold of.
     */
    private beginGesture(view: IView, event: PointerEvent): void {
        this._frozenAxis = this.handleOf(this.activeHandle);
        this._gestureStart = this.pattern;
        this.grabCentre(view, event);
    }

    /** Drops what a finished gesture was holding — the next one takes its own. */
    private forgetGesture(): void {
        this._frozenAxis = undefined;
        this._gestureStart = undefined;
        this._centreGrab = undefined;
    }

    /**
     * A centre's drag: the handle goes where the pointer lands on the plane, exactly on a snap
     * when there is one. The transform tool's square and origin are the same kind of handle
     * (`SketchTransformSession.updateDrag`), and for the same reason — a centre is *placed*,
     * not measured along a line.
     *
     * What the centre lands on decides what it is: a point of the sketch becomes a reference
     * the turn follows for good, and empty space a pair of coordinates it sits at. Dragging a
     * reference off its geometry is what turns it back into one of those (`snapPosition`).
     */
    protected override updateDrag(view: IView, event: PointerEvent): void {
        const handle = this._activeHandle;
        if (handle === undefined || !isPointDrag(handle)) {
            super.updateDrag(view, event);
            return;
        }
        const grab = this._centreGrab;
        const uv = this.planeUV(view, event);
        if (grab !== undefined && uv !== undefined) this.setCentre(this.centreAt(grab, uv));
        this.refreshTempShapes(view);
        view.document.visual.update();
    }

    /**
     * Where a centre drag would put the centre: the pointer's own travel carried onto the
     * centre it started from, snapped when that lands on a point of the sketch.
     */
    private centreAt(
        grab: { readonly uv: [number, number]; readonly center: SketchArrayCenter },
        uv: readonly [number, number],
    ): SketchArrayCenter {
        const anchor = centerOf(this.data.editor.solver, grab.center);
        const probe: [number, number] = [anchor[0] + uv[0] - grab.uv[0], anchor[1] + uv[1] - grab.uv[1]];
        const snapped = snapPosition(this.data.editor.solver, probe, {
            pointTolerance: this.data.editor.screenTolerance(),
        });
        const point = snapped.snap?.kind === "point" ? snapped.snap.point : undefined;
        return point === undefined ? { type: "at", u: probe[0], v: probe[1] } : { type: "ref", ref: point };
    }

    /** Takes hold of a centre drag, before anything moves it out from under the gesture. */
    private grabCentre(view: IView, event: PointerEvent): void {
        this._centreGrab = undefined;
        const handle = this._activeHandle;
        const pattern = this.pattern;
        if (handle === undefined || !isPointDrag(handle) || pattern.type !== "circular") return;
        const uv = this.planeUV(view, event);
        if (uv !== undefined) this._centreGrab = { uv, center: pattern.center };
    }

    /** Writes a new centre into the pattern a turn is placed about. */
    private setCentre(center: SketchArrayCenter): void {
        if (this.pattern.type !== "circular") return;
        this.pattern = { ...this.pattern, center };
        this.refreshAll();
    }

    /** Where the pointer meets the sketch plane, in sketch (u, v). */
    private planeUV(view: IView, event: PointerEvent): [number, number] | undefined {
        const point = this.data.editor.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
        return point === undefined ? undefined : toUV(this.data.editor.node.plane, point);
    }

    /**
     * Puts the pattern back as the gesture found it, for a drag that is abandoned.
     *
     * Not the base's own reset, which writes nought: an array's numbers *are* the pattern, so
     * noughting a spacing is not "moved back" but "cannot be placed at all" — the copies would
     * leave the canvas and the tool would have nothing to confirm. The centre comes back with
     * everything else: it is one of the pattern's own numbers, written by its own drag.
     */
    protected override resetValue(): void {
        const start = this._gestureStart;
        this._gestureStart = undefined;
        if (start === undefined) return;
        this.pattern = start;
        this.data.onPatternRestored?.(start);
        this.refreshAll();
    }

    /** The handles as meshes: an arrow per direction, a mark where a turn goes about. */
    private handleMeshes(): ShapeMeshData[] {
        const view = this.commitView ?? this.document.application.activeView;
        if (view === undefined) return [];
        const lit = this._activeHandle ?? this._hoveredHandle;
        const meshes: ShapeMeshData[] = [];
        for (const handle of this.handles()) {
            const color = handle.role === lit ? ARROW_HOVER_COLOR : ARROW_COLOR;
            if (isPointDrag(handle.role)) {
                meshes.push(MeshDataUtils.createVertexMesh(handle.start, VisualConfig.editVertexSize, color));
                continue;
            }
            const direction = handle.end.sub(handle.start).normalize();
            if (direction !== undefined) {
                meshes.push(...arrowMeshes(handle.start, direction, this.handleLength, color));
            }
        }
        return meshes;
    }

    /**
     * A handle's drawn length: the base's own arrow length, which is a constant number of
     * pixels. Handles are aimed at rather than measured, and this is what keeps them the same
     * size on screen wherever the pattern is.
     */
    private get handleLength(): number {
        return Math.max(this.arrowLength ?? ARROW_LENGTH, ARROW_LENGTH);
    }

    // ------------------------------------------------------------------ Placing the pattern

    /** The copies the current numbers make, or `undefined` when they cannot be placed at all. */
    private plan(): SketchEntityData[] | undefined {
        const solver = this.data.editor.solver;
        const sources = this.sources;
        const resolved = this.resolved();
        if (resolved === undefined) return undefined;
        return arrayPreview(solver, sources, resolved, this.data.record);
    }

    /**
     * Re-reads the selection and, when the seed's own place moved, redraws the handles and the
     * preview. This is what makes a handle appear the moment geometry is picked (the sketch's
     * own click path did the picking) and follow every later box, add or delete.
     */
    private syncSelection(): void {
        const seed = this.seedCentre();
        const moved = !samePoint(seed, this.seed);
        this.seed = seed;
        if (moved) this.refreshAll();
    }

    /** The seed's own place: the centre of the geometry the pattern is built from. */
    private seedCentre(): XYZ | undefined {
        const sources = this.sources;
        if (sources.length === 0) return undefined;
        const base = transformBase(this.data.editor.solver, sources);
        if (base === undefined) return undefined;
        const plane = this.data.editor.node.plane;
        return toWorld(plane, base[0], base[1]);
    }

    /**
     * Redraws the tool and, with it, the numbers the canvas draws for it: the draft's
     * annotations are the same ones a finished pattern gets, so they have to be re-laid
     * whenever a number changes.
     */
    private refreshAll(): void {
        this.refresh();
        this.data.editor.annotations.refresh();
    }
}

/** Whether two world points are the same spot (both may be undefined). */
function samePoint(first: XYZ | undefined, second: XYZ | undefined): boolean {
    if (first === undefined || second === undefined) return first === second;
    return first.distanceTo(second) <= Precision.Float;
}

/** One prospective copy as the session previews it — the entity's own mesh, dashed. */
function arrayPreviewMesh(editor: SketchEditor, copy: SketchEntityData): EdgeMeshData {
    const mesh = sketchEntityMesh(editor, copy, ARRAY_PREVIEW_COLOR, "dash");
    mesh.lineWidth = ARRAY_PREVIEW_LINE_WIDTH;
    return mesh;
}

/**
 * Patterns the selected entities along a picked direction, around a picked centre, or along a
 * picked curve. The pattern is a *definition* the sketch keeps (`SketchArrayData`), not a set
 * of copies: the copies are re-derived on every solve, so editing a seed, the reference or a
 * parameter moves the whole pattern — which is what SolidWorks and Fusion document for their
 * sketch patterns, and what Onshape leaves entirely to its feature patterns.
 *
 * One shot per invocation: the confirm commits and the command is over, so the next array
 * starts the tool again (at whatever fields it was left holding). ESC leaves the sketch alone.
 * Selecting an existing instance runs the tool against that array instead, editing it.
 */
@command({ key: "sketch.array", icon: "icon-array" })
export class SketchArrayCommand extends SketchConstraintCommand {
    private _session: SketchArraySession | undefined;
    /** The array being edited; `undefined` while the tool is making a new one. */
    private _arrayId: number | undefined;
    /** The reference the pattern is built on: what the user picked, or the record's own. */
    private _pattern: SketchArrayPattern | undefined;
    /** Set while the session pushes a value in, so the setter does not push it back. */
    private _syncingFromSession = false;
    /**
     * Set while the setter drives the session, so the echo it returns — the number the typed
     * value resolved to — does not land back on the property and replace it.
     */
    private _pushingToSession = false;
    /** Set while a record is being read into the fields, so their setters do not restart. */
    private _loadingRecord = false;
    /** Set while the tool is between its pick and its commit, which is when a restart means anything. */
    private _stepping = false;

    /** Which way the copies march, turn, or run — see `option.command.patternType.*`. */
    @property("option.command.patternType", {
        combobox: Combobox.from(PATTERN_TYPES.map((type) => PATTERN_KEY[type])),
    })
    get patternType(): I18nKeys {
        return this.getPrivateValue("patternType", PATTERN_KEY.linear);
    }
    set patternType(value: I18nKeys) {
        if (!this.setProperty("patternType", value)) return;
        this.showLinear = this.patternTypeIs("linear");
        this.showSingle = !this.patternTypeIs("linear");
        this.showSpacing = this.patternTypeIs("curve");
        this.showCircular = this.patternTypeIs("circular");
        // A pattern is picked by a different reference per type — a direction line, a centre,
        // a curve — so the step starts over rather than re-reading the one it has. Only while
        // it is actually stepping: the same setter runs when a caller configures the command
        // before it is executed, and a restart then would leave the run it is about to have
        // already cancelled.
        if (this._stepping && !this._loadingRecord) this.restart();
    }

    /*
     * What the options bar shows, one flag per field group. Each *derives* from the pattern
     * type when nothing has assigned it, which is what makes the bar right on a run that was
     * never told anything: `beforeExecute` restores `patternType` straight into the private
     * value, without going through its setter, so a flag kept only by that setter would be
     * left at its default — a turn's own fields hidden, the grid's shown.
     *
     * The setters are still what tells the panel to re-read a group when the type changes.
     */
    private patternTypeIs(type: SketchArrayType): boolean {
        return (TYPE_OF_KEY.get(this.patternType) ?? "linear") === type;
    }

    /** The grid's own four numbers — the two directions of a linear pattern. */
    get showLinear(): boolean {
        return this.getPrivateValue("showLinear", this.patternTypeIs("linear"));
    }
    set showLinear(value: boolean) {
        this.setProperty("showLinear", value);
    }

    /** The one count a turn or a curve lays down. */
    get showSingle(): boolean {
        return this.getPrivateValue("showSingle", !this.patternTypeIs("linear"));
    }
    set showSingle(value: boolean) {
        this.setProperty("showSingle", value);
    }

    /** How far along the curve each instance lands — a linear pattern has its own per axis. */
    get showSpacing(): boolean {
        return this.getPrivateValue("showSpacing", this.patternTypeIs("curve"));
    }
    set showSpacing(value: boolean) {
        this.setProperty("showSpacing", value);
    }

    get showCircular(): boolean {
        return this.getPrivateValue("showCircular", this.patternTypeIs("circular"));
    }
    set showCircular(value: boolean) {
        this.setProperty("showCircular", value);
    }

    /** Whether an existing array is being edited rather than a new one made. */
    get editing(): boolean {
        return this.getPrivateValue("editing", false);
    }
    set editing(value: boolean) {
        this.setProperty("editing", value);
    }

    get countX(): number {
        return this.getPrivateValue("countX", 3);
    }
    set countX(value: number) {
        this.setProperty("countX", value, () => this.pushField("countX", value));
    }

    /** How far apart they are, along X. A negative one runs the other way. */
    get spacingX(): ParameterValue {
        return this.getPrivateValue("spacingX", 60);
    }
    set spacingX(value: ParameterValue) {
        if (!this.setProperty("spacingX", value)) return;
        this.pushField("spacingX", value);
    }

    /** Instances along the sketch's Y axis — the second direction of the grid. */
    get countY(): number {
        return this.getPrivateValue("countY", 1);
    }
    set countY(value: number) {
        this.setProperty("countY", value, () => this.pushField("countY", value));
    }

    /** How far apart they are, along Y. */
    get spacingY(): ParameterValue {
        return this.getPrivateValue("spacingY", 60);
    }
    set spacingY(value: ParameterValue) {
        if (!this.setProperty("spacingY", value)) return;
        this.pushField("spacingY", value);
    }

    /** Instances a turn or a curve lays down, the seed included. */
    get count(): number {
        return this.getPrivateValue("count", 3);
    }
    set count(value: number) {
        this.setProperty("count", value, () => this.pushField("count", value));
    }

    /** How far along the curve each instance lands. */
    get spacing(): ParameterValue {
        return this.getPrivateValue("spacing", 20);
    }
    set spacing(value: ParameterValue) {
        if (!this.setProperty("spacing", value)) return;
        this.pushField("spacing", value);
    }

    /** The total turn of a circular pattern, in degrees. */
    get twist(): ParameterValue {
        return this.getPrivateValue("twist", 360);
    }
    set twist(value: ParameterValue) {
        if (!this.setProperty("twist", value)) return;
        this.pushField("twist", value);
    }

    /**
     * Whether the turn is spread over the count or over the gaps: an even turn puts the last
     * instance back on the first, so four instances of 360° land a quarter apart.
     */
    get equalSpacing(): boolean {
        return this.getPrivateValue("equalSpacing", true);
    }
    set equalSpacing(value: boolean) {
        if (!this.setProperty("equalSpacing", value)) return;
        this._session?.setEqualSpacing(value);
    }

    /** Drops the array being edited, instances and all, and ends the tool. */
    @property("sketch.arrayRemove", { dependencies: [{ property: "editing", value: true }] })
    async remove(): Promise<void> {
        const editor = SketchEditor.getActive();
        if (editor === undefined || this._arrayId === undefined) return;
        editor.solver.removeArray(this._arrayId);
        this.finish(editor, "sketch.arrayRemoved");
    }

    /**
     * Breaks the array being edited and leaves its copies behind as the sketch's own geometry —
     * the other answer to "I do not want this pattern any more", and the one for when the
     * copies are wanted but the pattern is not (see `SketchSolver.dissolveArray`, which tells
     * each copy the seed's own shape relations so that a copy which was a closed loop still is).
     */
    @property("sketch.arrayDissolve", { dependencies: [{ property: "editing", value: true }] })
    async dissolve(): Promise<void> {
        const editor = SketchEditor.getActive();
        if (editor === undefined || this._arrayId === undefined) return;
        editor.solver.dissolveArray(this._arrayId);
        this.finish(editor, "sketch.arrayDissolved");
    }

    /** Solves, commits and ends the tool, having already made the change. */
    private finish(editor: SketchEditor, tip: I18nKeys): void {
        editor.solve(true);
        editor.commit();
        editor.clearEntitySelection();
        PubSub.default.pub("statusBarTip", tip);
        void this.cancel();
    }

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this._stepping = true;
        try {
            await this.step(editor);
        } finally {
            this._stepping = false;
        }
    }

    /**
     * One pass of the tool. Which of its two jobs it is doing was settled before it was run:
     * the ribbon starts it with nothing to edit and it opens on the numbers the fields already
     * hold (only a curve has to be picked first); a double-click on one of an array's copies
     * starts it with that array in hand (`SketchEditor.editArray`), and it opens what the
     * record says.
     */
    private async step(editor: SketchEditor): Promise<void> {
        const target = editor.takeArrayEditTarget();
        if (target !== undefined) {
            // a target that names nothing any more — the array went away between the
            // double-click and this run — is not a reason to start a *new* pattern under the
            // user's hand, so the tool simply does not open
            if (editor.solver.arrayRecord(target) === undefined) return;
            this.loadRecord(editor, target);
        } else if (this._arrayId !== undefined) {
            // a step starting over on a run that is already editing a record: the pattern type
            // changed, so the reference it is picked by changes with it (`patternType`), while
            // the record the run writes back to stays the one it opened on. Reading the step
            // as a fresh one instead would abandon that record and make a second array.
            this._pattern = await this.freshPattern(editor);
        } else {
            this.editing = false;
            this._pattern = await this.freshPattern(editor);
        }
        if (this._pattern === undefined) return;
        await this.runSession(editor);
    }

    /**
     * The pattern a run starts from when it is not reading a record: the plain one the fields
     * describe, or — the one reference that is still picked — the curve a curve pattern
     * follows. A pattern is picked by a different reference per type, which is why a change of
     * type goes through here rather than keeping what the last step had.
     */
    private async freshPattern(editor: SketchEditor): Promise<SketchArrayPattern | undefined> {
        return TYPE_OF_KEY.get(this.patternType) === "curve"
            ? await this.pickCurve(editor)
            : this.blankPattern();
    }

    /**
     * The pattern a run starts from when it is making a new one: the sketch's own two axes at
     * the numbers the fields hold, or a turn about the sketch's own origin.
     *
     * Nothing has to be picked for either of them. The options bar already *is* a pattern, and
     * the canvas shows it the moment the session opens — which is how Onshape's own sketch
     * pattern reads: selecting the geometry and clicking the tool creates the initial pattern,
     * and the numbers are then edited on the canvas.
     */
    private blankPattern(): SketchArrayPattern {
        if (TYPE_OF_KEY.get(this.patternType) === "circular") {
            return {
                type: "circular",
                // the origin is where a bolt circle usually goes, and it is where the centre
                // handle appears — the user drags it wherever it belongs
                center: { type: "ref", ref: originRef() },
                count: this.count,
                twist: this.twist,
                equalSpacing: this.equalSpacing,
            };
        }
        return {
            type: "linear",
            x: { count: this.countX, spacing: this.spacingX },
            y: { count: this.countY, spacing: this.spacingY },
        };
    }

    /** The curve a curve pattern follows — the one reference that is still picked. */
    private async pickCurve(editor: SketchEditor): Promise<SketchArrayPattern | undefined> {
        this.controller = new AsyncController();
        const controller = this.controller;
        const id = await editor.pickEntity("prompt.pickArrayCurve", undefined, undefined, controller);
        controller.dispose();
        if (id === undefined) return undefined;
        // an instance is the record's own geometry, not a curve the pattern may follow
        if (editor.solver.isDerived(id)) {
            PubSub.default.pub("statusBarTip", "sketch.arrayInstanceReadOnly");
            return undefined;
        }
        return { type: "curve", curveId: id, count: this.count, spacing: this.spacing };
    }

    /** Reads a record into the fields, so an edit opens on the array as it stands. */
    private loadRecord(editor: SketchEditor, id: number): void {
        // the copy, not the live row: the edit's opening pattern is what the fields were read
        // from, and it is kept for as long as the run lasts
        const record = editor.solver.arrays().find((array) => array.id === id);
        if (record === undefined) return;
        this._loadingRecord = true;
        this._arrayId = id;
        this._pattern = record.pattern;
        this.patternType = PATTERN_KEY[record.pattern.type];
        this.writeFields(record.pattern);
        this.editing = true;
        this._loadingRecord = false;
    }

    /**
     * Writes a pattern's own numbers into the fields the options bar shows — the reading half
     * of what the setters push the other way. A pattern that arrives whole rather than a field
     * at a time comes through here: a record being opened, or one a gesture put back.
     */
    private writeFields(pattern: SketchArrayPattern): void {
        if (pattern.type === "linear") {
            this.countX = pattern.x.count;
            this.spacingX = pattern.x.spacing;
            this.countY = pattern.y.count;
            this.spacingY = pattern.y.spacing;
        } else if (pattern.type === "circular") {
            this.count = pattern.count;
            this.twist = pattern.twist;
            this.equalSpacing = pattern.equalSpacing;
        } else {
            this.count = pattern.count;
            this.spacing = pattern.spacing;
        }
    }

    /**
     * The session: the copies preview as soon as there is anything to array, the numbers are
     * on the canvas to be doubled, and it ends on a confirm (which commits) or on ESC (which
     * does not).
     */
    private async runSession(editor: SketchEditor): Promise<void> {
        const pattern = this._pattern;
        if (pattern === undefined) return;
        this.controller = new AsyncController();
        const controller = this.controller;
        const session = new SketchArraySession(editor.document, controller, {
            editor,
            // read before the swap: the sketch's handler is the one in place, and everything
            // not aimed at a handle has to keep reaching it
            picking: editor.document.visual.eventHandler,
            pattern,
            editing: this._arrayId,
            record: this.editingRecord(editor),
            resolveSources: () => this.sourcesFor(editor),
            onReady: (created) => {
                this._session = created;
                // What the canvas draws the pattern's numbers from while there is no record —
                // or none that holds what the tool is holding yet. The draft lands here, after
                // the session has already laid out its own preview, so the annotations have to
                // be asked for the numbers again: nothing else would, until the next edit.
                editor.arrayDraft = created.draft();
                editor.annotations.refresh();
            },
            onDone: () => {
                this._session = undefined;
                editor.arrayDraft = undefined;
            },
            onFieldChange: (field, value) => this.syncFromSession(field, value),
            onPatternRestored: (restored) => {
                this._pattern = restored;
                this.writeFields(restored);
            },
        });
        try {
            await editor.document.picker.pickAsync(
                session,
                "prompt.pickArraySources",
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
        // `picker.pickAsync` restores whatever handler it replaced, so nothing may touch the
        // editor from here on.
        if (SketchEditor.getActive() !== editor) return;
        if (controller.result?.status !== "success") return;
        this.applyPattern(editor, session.candidate);
    }

    /**
     * What the pattern is built from, which is what the selection says: the geometry under it,
     * or — while an edit leaves its own instances selected — the sources that record already
     * has. Anything real the user picks during an edit re-points the pattern at it.
     */
    private sourcesFor(editor: SketchEditor): number[] {
        const real = editor.selectedEntityIds().filter((id) => !editor.solver.isDerived(id));
        if (real.length > 0) return real;
        if (this._arrayId === undefined) return [];
        return editor.solver.arrayRecord(this._arrayId)?.sourceIds ?? [];
    }

    /** Writes the pattern down — a new record, or the one being edited — and commits it. */
    private applyPattern(editor: SketchEditor, pattern: SketchArrayPattern): void {
        const sources = this.sourcesFor(editor);
        if (sources.length === 0) return;
        const result =
            this._arrayId === undefined
                ? editor.solver.addArray(pattern, sources)
                : editor.solver.updateArray(this._arrayId, { pattern, sourceIds: sources });
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return;
        }
        editor.solve(true);
        editor.commit();
        editor.clearEntitySelection();
    }

    /** Hands one field to the session, unless the session is the one that just set it. */
    private pushField(field: ArrayField, value: ParameterValue): void {
        if (this._syncingFromSession || this._session === undefined) return;
        this._pushingToSession = true;
        this._session.setField(field, value);
        this._pushingToSession = false;
    }

    /**
     * Takes a number the tool settled — dragged on the canvas, or typed into one of its
     * annotations — back into the field that holds it, so the options bar and the canvas never
     * disagree. The echo a push of our own comes back as is swallowed here.
     */
    private syncFromSession(field: ArrayField, value: ParameterValue): void {
        if (this._pushingToSession) return;
        if (typeof value !== "number") return;
        this._syncingFromSession = true;
        switch (field) {
            case "countX":
                this.countX = value;
                break;
            case "spacingX":
                this.spacingX = value;
                break;
            case "countY":
                this.countY = value;
                break;
            case "spacingY":
                this.spacingY = value;
                break;
            case "count":
                this.count = value;
                break;
            case "twist":
                this.twist = value;
                break;
            default:
                this.spacing = value;
        }
        this._syncingFromSession = false;
    }

    /** The array being edited — its holes included, so the preview keeps them. */
    private editingRecord(editor: SketchEditor): SketchArrayData | undefined {
        return this._arrayId === undefined ? undefined : editor.solver.arrayRecord(this._arrayId);
    }
}
