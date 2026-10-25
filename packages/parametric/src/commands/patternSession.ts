// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    type AsyncController,
    BoundingBox,
    type CursorType,
    distanceToSegment,
    formatMeasurement,
    I18n,
    type I18nKeys,
    type IDisposable,
    type IDocument,
    type IEdge,
    type IEventHandler,
    type IStep,
    type IView,
    MathUtils,
    Matrix4,
    nearestHandle,
    type ParameterValue,
    Precision,
    pxSizedArrowLength,
    Result,
    type ShapeMeshData,
    type SnapResult,
    UNITLESS,
    type UnitSpec,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import type { PatternOrientation } from "../features/feature";
import { circularPlacements, curvePlacements, linearPlacements } from "../features/pattern";
import { measuredPath, orderPathEdges, type PatternPathFrames } from "../features/patternPath";
import type { ParametricBodyNode } from "../parametricBodyNode";
import { promptDatum } from "../sketch/editor/datumPrompt";
import { AxisDragHandler } from "./axisDragHandler";
import style from "./patternSession.module.css";
import type { DragPreview } from "./previewConfirmHandler";

/**
 * The world line the pattern runs along: the picked edge's own geometry, read the feature's
 * way — the line is taken off the edge in the SOURCE's frame (normalised there, as
 * `lineOfEdge` does) and then carried into the world by the pick's transform.
 */
export interface PatternLine {
    readonly point: XYZ;
    readonly direction: XYZ;
}

/**
 * The cursor a pattern session holds while it owns the viewport. A nested pick ends with the
 * picker's own `default`, so whoever restores the session's chrome has to know this too.
 */
export const PATTERN_SESSION_CURSOR: CursorType = "draw";

/** The panel's push target while a pattern's preview/session is open. */
export interface PatternPanelSink {
    setCount(count: number): void;
    setValue(value: number): void;
}

/** What a pattern step's handler must satisfy: the event pump, disposal, and the committing view. */
export type PatternStepHandler = IEventHandler & {
    commitView: IView | undefined;
    /**
     * The picker has installed this handler as the viewport's event target. A session that
     * wants a nested pick (the linear pattern's second direction) must wait for this: one
     * started any earlier is installed OVER by the session's own pick, never sees a click,
     * and leaves its dead handler behind when the outer pick restores what it found.
     */
    sessionOpened?(): void;
};

/**
 * The pattern command's last step, always run: opens whichever handler the mode builds on the
 * picks so far and waits it out — the confirm control (or Enter) commits while ESC leaves
 * nothing behind. Which handler that is belongs to the mode: a linear pattern hangs a ghost
 * preview for the options panel to drive; a circular one runs the turn-handle drag session.
 * The curve pattern has no such step: its path pick owns the ghosts and commits on its own.
 */
export class PatternSessionStep implements IStep {
    constructor(
        readonly tip: I18nKeys,
        private readonly openHandler: (
            document: IDocument,
            controller: AsyncController,
        ) => PatternStepHandler | undefined,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const handler = this.openHandler(document, controller);
        if (handler === undefined) return undefined;
        try {
            // `pickAsync` installs the handler before its first await, so the notification
            // below is the moment this session owns the viewport.
            const picking = document.picker.pickAsync(
                handler,
                this.tip,
                controller,
                "none",
                PATTERN_SESSION_CURSOR,
            );
            handler.sessionOpened?.();
            await picking;
        } finally {
            // Dispose first, always: the handler's cleanup is what drops the ghost meshes.
            handler.dispose();
        }
        if (controller.result?.status !== "success") return undefined;
        // The values are already on the command's panel fields (the sync ran while the step
        // was open), so the result is a plain pass token — nothing is read back off it.
        return { view: handler.commitView ?? document.application.activeView!, shapes: [], type: "input" };
    }
}

/**
 * What the linear preview opens with: the body, the reference direction as a world line, and
 * the panel's numbers resolved (an expression that does not resolve opens as the field's own
 * default; the commit's validation reports it). Direction 2 is not part of the opening hand —
 * it arrives later through `setDirection2`, when the panel's checkbox has had its pick. The
 * report-backs are the drag's half of the two-way sync: the hand reports the spacing it
 * settled, so the command writes it back to its own field.
 */
export interface PatternPreviewData {
    /** The body being patterned: its chain input is what the copies repeat. */
    readonly body: ParametricBodyNode;
    readonly line: PatternLine;
    readonly count: number;
    readonly value: number;
    /** The hand settled the first direction's spacing; the command writes it back. */
    onValue?(value: number): void;
    /** Same, for the second direction's spacing. */
    onValue2?(value: number): void;
    /** The session owns the viewport now — the only time a nested pick can be started. */
    onOpened?(): void;
    /** The handler registers itself so the command can push option changes in. */
    onReady?(handler: PatternPreviewHandler): void;
    /** The handler reports its cleanup so the command can drop the reference. */
    onDone?(): void;
}

/** The numbers the preview's arrows drag: one per direction the grid marches in. */
type PreviewHandle = "spacing" | "spacing2";

/**
 * One arrow as it sits on the canvas: the shaft it is drawn along (which flips with the
 * value's sign) and, separately, the axis its drag is measured on (which never flips, so a
 * drag through zero stays continuous).
 */
interface PreviewHandleGeometry {
    readonly role: PreviewHandle;
    readonly start: XYZ;
    readonly end: XYZ;
    readonly normal: XYZ;
}

/**
 * The linear pattern's preview-confirm session, Onshape-style: the ghost of every copy hangs
 * on the canvas the moment the reference edge is picked, the options panel's edits (count and
 * spacing, plus count2/spacing2 on a grid) re-ghost it live, and the confirm control (or
 * Enter) commits while ESC leaves nothing behind.
 *
 * Its handles are the numbers, the way the sketch array's are (`SketchArraySession`): one
 * arrow per direction the pattern marches in — the second only once the panel's switch has
 * picked it — dragged along its own axis. The arrows stand at full opacity over the
 * half-opacity ghosts, so they read as handles rather than as more copies.
 *
 * The ghosts are placed by the FEATURE'S OWN math (`linearPlacements`), so what previews is
 * bit for bit what a rebuild builds — the boolean is the only thing the preview skips, since
 * it never moves the copies.
 */
export class PatternPreviewHandler extends AxisDragHandler implements PatternPanelSink {
    private _count: number;
    private _value: number;
    private _count2 = 1;
    private _value2 = 0;
    /** The world→body transform, kept for directions that arrive after the opening hand. */
    private readonly _inverse: Matrix4;
    /** The reference in the BODY's frame — the frame the feature's placements live in. */
    private readonly _hostLine: PatternLine;
    /** Direction 2 in the body frame; undefined until the panel's switch has its pick. */
    private _hostLine2: PatternLine | undefined;
    /** Direction 2 in the world — what its arrow is drawn and hit-tested against. */
    private _worldLine2: PatternLine | undefined;
    /** The arrow under the pointer, and the one the gesture holds. */
    private _hoveredHandle: PreviewHandle | undefined;
    private _activeHandle: PreviewHandle | undefined;
    /**
     * The arrow the pointer last took hold of. A drag clears the hover and the release ends
     * the gesture, but the pointer is still on that arrow: a number typed right after must
     * edit it, not fall back to the first direction.
     */
    private _lastHandle: PreviewHandle | undefined;
    /** The axis the gesture reads, taken before the first value can move the arrow under it. */
    private _frozenAxis: { origin: XYZ; normal: XYZ } | undefined;
    /** The numbers the gesture found, so abandoning it puts them back rather than zeroing them. */
    private _gestureStart: { value: number; value2: number } | undefined;
    /** The arrows' own meshes by role, for a recolour that does not re-upload them. */
    private _handleIds = new Map<PreviewHandle, number[]>();
    /** The geometry signature those meshes were drawn from; a change forces a rebuild. */
    private _handleKey: string | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: PatternPreviewData,
    ) {
        super(document, controller);
        this._count = data.count;
        this._value = data.value;
        this._inverse = data.body.worldTransform().invert() ?? Matrix4.identity();
        this._hostLine = PatternPreviewHandler.inHostFrame(this._inverse, data.line);
        this.start();
    }

    /** A world line mapped into the body's frame — the frame the feature's placements live in. */
    private static inHostFrame(inverse: Matrix4, line: PatternLine): PatternLine {
        return {
            point: inverse.ofPoint(line.point),
            direction: inverse.ofVector(line.direction),
        };
    }

    /**
     * Direction 2 arrives or leaves while the preview is open — the panel's checkbox is what
     * decides. Undefined drops it and its arrow; the ghosts fall back to one row.
     */
    setDirection2(line: PatternLine | undefined, count = 1, value = 0): void {
        this._worldLine2 = line;
        this._hostLine2 =
            line === undefined ? undefined : PatternPreviewHandler.inHostFrame(this._inverse, line);
        this._count2 = count;
        this._value2 = value;
        if (line === undefined) {
            if (this._hoveredHandle === "spacing2") this._hoveredHandle = undefined;
            if (this._lastHandle === "spacing2") this._lastHandle = undefined;
            if (this._activeHandle === "spacing2") this.forgetGesture();
        }
        this.refreshTempShapes();
    }

    // ------------------------------------------------------------------ The panel's pushes

    override setValue(value: number): void {
        if (Math.abs(this._value - value) < Precision.Float) return;
        this._value = value;
        this.refreshTempShapes();
    }

    setCount(count: number): void {
        if (this._count === count) return;
        this._count = count;
        this.refreshTempShapes();
    }

    setValue2(value: number): void {
        if (Math.abs(this._value2 - value) < Precision.Float) return;
        this._value2 = value;
        this.refreshTempShapes();
    }

    setCount2(count: number): void {
        if (this._count2 === count) return;
        this._count2 = count;
        this.refreshTempShapes();
    }

    // ------------------------------------------------------------------ The arrows' geometry

    /** The arrow under the gesture, or under the pointer, or none at all. */
    private get activeHandle(): PreviewHandle | undefined {
        return this._activeHandle ?? this._hoveredHandle;
    }

    /** Where the arrows stand: the body's centre, whatever edge the direction was read off. */
    private get anchor(): XYZ {
        const shape = this.data.body.shape;
        if (!shape.isOk) return this.data.line.point;
        return this.data.body.worldTransform().ofPoint(BoundingBox.center(shape.value.boundingBox()));
    }

    /**
     * The arrows this preview has: direction 1 always, direction 2 once its pick brought one.
     * Each starts at the body's centre and is drawn at a fixed pixel size — an arrow says which
     * way its number runs, never how big it is.
     */
    private handles(): PreviewHandleGeometry[] {
        const start = this.anchor;
        const handles = [this.handleAlong("spacing", this.data.line, this._value, start)];
        if (this._worldLine2 !== undefined) {
            handles.push(this.handleAlong("spacing2", this._worldLine2, this._value2, start));
        }
        return handles;
    }

    private handleAlong(
        role: PreviewHandle,
        line: PatternLine,
        value: number,
        start: XYZ,
    ): PreviewHandleGeometry {
        const axis = line.direction.normalize() ?? XYZ.unitX;
        // The shaft follows the sign (an arrow pointing back is a negative spacing), the axis
        // the drag reads does not: flipping it at zero would jump the value the pointer holds.
        const drawn = axis.multiply(value < 0 ? -1 : 1);
        return { role, start, end: start.add(drawn.multiply(this.handleLength)), normal: axis };
    }

    private handleOf(role: PreviewHandle | undefined): PreviewHandleGeometry | undefined {
        return role === undefined ? undefined : this.handles().find((handle) => handle.role === role);
    }

    /** The drag axis of `role`'s arrow — frozen when its gesture starts. */
    private axisOf(role: PreviewHandle | undefined): { origin: XYZ; normal: XYZ } | undefined {
        const handle = this.handleOf(role);
        return handle === undefined ? undefined : { origin: handle.start, normal: handle.normal };
    }

    /** The arrow nearest the pointer within the hover tolerance, or none. */
    private handleAt(view: IView, event: PointerEvent): PreviewHandle | undefined {
        return nearestHandle(this.handles(), (handle) =>
            distanceToSegment(
                event.offsetX,
                event.offsetY,
                view.worldToScreen(handle.start),
                view.worldToScreen(handle.end),
            ),
        );
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /** The drag axis of the arrow under the gesture; direction 1's when none is aimed at. */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        if (this._frozenAxis !== undefined) return this._frozenAxis;
        const handle = this.handleOf(this.activeHandle ?? "spacing");
        return handle === undefined
            ? { origin: this.anchor, normal: XYZ.unitX }
            : { origin: handle.start, normal: handle.normal };
    }

    /**
     * A point, never a segment: the base draws one arrow, and this preview draws one per
     * direction instead. Degenerating is how the base's own is switched off.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        return { start: XYZ.zero, end: XYZ.zero };
    }

    /** Measured at the body's centre, so the arrows keep their size however the spacing moves them. */
    protected override scaleAnchor(): XYZ {
        return this.anchor;
    }

    /** The base's hit test measures the one arrow it draws; this preview's are its own. */
    protected override isOverArrow(view: IView, event: PointerEvent): boolean {
        return this.handleAt(view, event) !== undefined;
    }

    /** The arrow a typed number edits: the one held, the one hovered, or the last grabbed. */
    private get typingHandle(): PreviewHandle | undefined {
        return this._activeHandle ?? this._hoveredHandle ?? this._lastHandle;
    }

    protected override currentValue(): number {
        return this.typingHandle === "spacing2" ? this._value2 : this._value;
    }

    protected override setCurrentValue(value: number): void {
        // A gesture with no arrow left (the second direction dropped mid-drag) writes
        // nothing — the remaining motion would pour into the wrong direction.
        const handle = this.typingHandle;
        if (handle === undefined && this.gestureActive) return;
        if (handle === "spacing2") {
            this._value2 = value;
            this.data.onValue2?.(value);
            return;
        }
        this._value = value;
        this.data.onValue?.(value);
    }

    protected override get arrowHovered(): boolean {
        // Derived: the hover is per arrow, and this is only the base's yes/no view of it.
        return this._hoveredHandle !== undefined;
    }
    protected override set arrowHovered(_value: boolean) {
        // Nothing to store — `_hoveredHandle` is the source of truth.
    }

    /**
     * The arrows' own hover feedback — the base leaves this hook empty, since its hit test
     * only knows the one arrow it draws. The nearest of this preview's arrows wins.
     */
    protected override onHover(view: IView, event: PointerEvent): void {
        const hovered = this.handleAt(view, event);
        if (hovered === this._hoveredHandle) return;
        this._hoveredHandle = hovered;
        // Only the arrows change tone: rebuilding the ghosts (a kernel transform + mesh per
        // copy) to repaint two handles would be paid on every hover.
        this.refreshHandle(view);
    }

    /**
     * The base's hover write redraws its own (suppressed) arrow only, which would take this
     * preview's arrows down with it — so the preview is repainted instead.
     */
    protected override setArrowHover(view: IView, hovered: boolean): void {
        if (this.arrowHovered === hovered) return;
        this.refreshHandle(view);
        view.update();
    }

    protected override clearHover(): void {
        if (this._hoveredHandle === undefined) return;
        this._hoveredHandle = undefined;
        // Teardown clears the hover on its way to removing the arrows — no point drawing them.
        if (!this.cleaned) this.refreshHandle();
    }

    // ------------------------------------------------------------------ The gesture

    /** A press starts a drag only on an arrow: the empty canvas is not a spacing. */
    override pointerDown(view: IView, event: PointerEvent): void {
        // A click-move gesture is settled by its RELEASE; a second press is not a new grab.
        // Taking hold again here would re-stamp the numbers the gesture started from, so the
        // Escape that abandons it would put back this press's value instead.
        if (this.awaitingClick) return;
        // The base's own guard comes first, before anything is retargeted: a right button or
        // a secondary pointer must not silently move the gesture to another arrow.
        if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
        const hovered = this.handleAt(view, event);
        if (hovered !== this._hoveredHandle) {
            this._hoveredHandle = hovered;
            // A press that leaves an arrow has to take its highlight with it, or the arrow
            // stays lit until something else happens to repaint.
            if (!this.cleaned) this.refreshHandle(view);
        }
        if (hovered === undefined) return;
        this._activeHandle = hovered;
        this._lastHandle = hovered;
        this._frozenAxis = this.axisOf(hovered);
        this._gestureStart = { value: this._value, value2: this._value2 };
        super.pointerDown(view, event);
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        // The base ignores a non-left release too; forgetting the gesture here would leave it
        // dragging with no arrow, and the next move would pour the value into direction 1.
        if (event.pointerType === "mouse" && event.button !== 0) return;
        super.pointerUp(view, event);
        // A click that only opened the click-move gesture leaves its arrow held for the next click.
        if (!this.awaitingClick) this.forgetGesture();
        // The pointer is still where it let go: re-arm the hover it left behind (the drag
        // start cleared it), so the arrow stays lit and a typed number edits THIS arrow.
        this._hoveredHandle = this.handleAt(view, event);
        this.refreshHandle(view);
    }

    protected override enterMoveMode(view: IView, event: PointerEvent): void {
        // The click path reaches here through a press this preview already took; the fallbacks
        // are for a release that arrives without one.
        this._activeHandle ??= this._hoveredHandle;
        this._frozenAxis ??= this.axisOf(this._activeHandle);
        this._gestureStart ??= { value: this._value, value2: this._value2 };
        super.enterMoveMode(view, event);
    }

    protected override finishMoveMode(view: IView): void {
        super.finishMoveMode(view);
        this.forgetGesture();
    }

    protected override exitMoveMode(view: IView): void {
        // The reset inside reads the active handle, so it happens before the gesture is dropped.
        super.exitMoveMode(view);
        this.forgetGesture();
        // The hover this mode kept was taken at the press, not where the pointer is now;
        // dropped so the repaint below is unlit. The next move re-reads it.
        this._hoveredHandle = undefined;
        this.refreshHandle(view);
    }

    /** Abandoning a gesture puts its number back — nought is not a spacing, it is a broken ghost. */
    protected override resetValue(): void {
        const start = this._gestureStart;
        if (start === undefined) return;
        this.setCurrentValue(this._activeHandle === "spacing2" ? start.value2 : start.value);
    }

    private forgetGesture(): void {
        // The base's half too: a direction dropped under a click-move would otherwise leave
        // it awaiting a settling click that no arrow answers, swallowing the next press.
        this.abandonGesture();
        this._activeHandle = undefined;
        this._frozenAxis = undefined;
        this._gestureStart = undefined;
    }

    // ------------------------------------------------------------------ The arrows' meshes

    /**
     * Measures the arrows for the view (if one is given) and draws them. The base's own
     * `refreshHandle` would take the arrows down first — its arrow is suppressed, so there
     * is nothing for it to draw — which would defeat the recolour path below.
     */
    protected override refreshHandle(view?: IView): void {
        if (view !== undefined) {
            const length = pxSizedArrowLength(view, this.scaleAnchor(), this.axis().normal);
            if (length !== undefined) this.arrowLength = length;
        }
        this.drawHandles();
    }

    protected override removeHandle(): void {
        super.removeHandle();
        this.dropHandles();
    }

    /**
     * The arrows: full opacity and on top, so they never read as another ghost. A refresh
     * that changes only which arrow is lit re-colours the meshes already on screen — the
     * scale-and-upload path is kept for geometry that actually moved.
     */
    private drawHandles(): void {
        const lit = this._activeHandle ?? this._hoveredHandle;
        // One geometry read for the whole pass: `handles()` asks the body for its bounding
        // box, which is not free on a big chain.
        const handles = this.handles();
        if (this.handleKey(handles) === this._handleKey && this.paintHandles(lit)) return;

        this.dropHandles();
        const context = this.document.visual.context;
        for (const handle of handles) {
            const direction = handle.end.sub(handle.start).normalize();
            if (direction === undefined) continue;
            const color = handle.role === lit ? ARROW_HOVER_COLOR : ARROW_COLOR;
            // The base caches the canonical geometry: a drag frame re-places buffers rather
            // than asking the kernel for another cylinder and cone.
            const ids: number[] = [];
            for (const mesh of this.arrowMeshesAt(handle.start, direction, color)) {
                ids.push(context.displayMesh([mesh], { meshOpacity: 1, onTop: true }));
            }
            this._handleIds.set(handle.role, ids);
        }
        this._handleKey = this.handleKey(handles);
        this.document.visual.update();
    }

    /** Re-colours the arrows already on screen; false when there are none to recolour. */
    private paintHandles(lit: PreviewHandle | undefined): boolean {
        if (this._handleIds.size === 0) return false;
        const context = this.document.visual.context;
        for (const [role, ids] of this._handleIds) {
            const color = role === lit ? ARROW_HOVER_COLOR : ARROW_COLOR;
            for (const id of ids) context.setMeshColor(id, color);
        }
        this.document.visual.update();
        return true;
    }

    /** What the drawn arrows were built from: shaft endpoints and the pixel-sized length. */
    private handleKey(handles: readonly PreviewHandleGeometry[]): string {
        const shafts = handles
            .map((h) => `${h.role}:${h.start.x},${h.start.y},${h.start.z}:${h.end.x},${h.end.y},${h.end.z}`)
            .join("|");
        return `${this.handleLength}|${shafts}`;
    }

    private dropHandles(): void {
        for (const ids of this._handleIds.values()) {
            for (const id of ids) this.document.visual.context.removeMesh(id);
        }
        this._handleIds.clear();
        this._handleKey = undefined;
    }

    /**
     * Handles are pixel-sized, so a zoom has to rescale them. The base has ALREADY measured
     * the new length and taken its own arrow down by the time this runs — only this preview's
     * arrows remain to be drawn.
     */
    protected override onCameraChanged(_view: IView): void {
        this.drawHandles();
    }

    // ------------------------------------------------------------------ PreviewConfirmHandler hooks

    /**
     * The copies' transforms in the host's frame — the feature's own placement function, fed
     * the reference lines mapped the feature's own way, so the preview IS the rebuild's layout.
     * Direction 2 rides the preview's own state: its count and spacing are the pair the grid
     * grows by.
     */
    placements(count: number, value: number): Matrix4[] {
        const step2 = this._hostLine2?.direction.multiply(this._value2);
        return linearPlacements(this._hostLine.direction.multiply(value), count, step2, this._count2);
    }

    /**
     * The commit gate, on the numbers as RESOLVED (an expression that never resolved never
     * reaches the preview — it passes here and meets `validateParams`' toast at the commit):
     * a whole count of at least 2 per direction, and a non-zero spacing per direction.
     */
    protected override canConfirm(): boolean {
        if (!Number.isInteger(this._count) || this._count < 2 || this._value === 0) return false;
        if (this._hostLine2 === undefined) return true;
        return Number.isInteger(this._count2) && this._count2 >= 2 && this._value2 !== 0;
    }

    protected override buildPreview(): DragPreview {
        if (this._value === 0) return { meshes: [] };
        const shape = this.data.body.shape;
        if (!shape.isOk) return { meshes: [] };
        const world = this.data.body.worldTransform();
        const meshes: ShapeMeshData[] = [];
        for (const placement of this.placements(this._count, this._value)) {
            const copy = shape.value.transformedMul(world.multiply(placement));
            const { faces, edges } = copy.mesh;
            if (faces !== undefined) meshes.push(faces);
            if (edges !== undefined) meshes.push(edges);
            copy.dispose();
        }
        return { meshes };
    }

    /** Ghosts, not solids-in-waiting: the original stays put and visible beside them. */
    protected override previewOpacity(): number {
        return 0.5;
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    /** The preview's own pick has installed this handler — a nested pick may start now. */
    sessionOpened(): void {
        this.data.onOpened?.();
    }

    protected override onCleanup(): void {
        this.data.onDone?.();
    }
}

/**
 * What the circular session opens with: the body, the rotation axis as a world line, and the
 * panel's numbers resolved (same fallback rule as the linear preview's). The report-backs are
 * the drag's half of the two-way sync: the session reports the number the hand settled, so
 * the command syncs its input.
 */
export interface PatternSessionData {
    /** The body being patterned: its chain input is what the copies repeat. */
    readonly body: ParametricBodyNode;
    /** The rotation axis as a world line (the live geometry, not the stored ref). */
    readonly line: PatternLine;
    /** The panel's count, resolved — the field's own default when its expression does not. */
    readonly count: number;
    /** The panel's angle, resolved — 0 when it does not. */
    readonly value: number;
    readonly equalSpacing: boolean;
    /** The session reports the angle the hand settled, so the command syncs its input. */
    onValue?(value: number): void;
    /** The session reports the count its badge dialog settled — the panel follows it too. */
    onCount?(count: number): void;
    /** The command's own expression resolution, for the badge dialogs' typed input. */
    resolve?(input: ParameterValue, unit: UnitSpec): Result<number>;
    /** The handler registers itself so the command can push option changes back. */
    onReady?(handler: PatternDragHandler): void;
    /** The handler reports its cleanup so the command can drop the reference. */
    onDone?(): void;
}

/** The smallest radius the turn handle sits at when the body's centre lies on the axis. */
const MIN_HANDLE_RADIUS = 1;

/** One canvas badge: its disposable, its element while the view hands one over, its drawn key. */
interface SessionBadge {
    key: string;
    item: IDisposable;
    element: HTMLElement | undefined;
}

/** The badge kinds the session draws — the dragged value and the count. */
type BadgeKind = "value" | "count";

/**
 * The circular pattern's drag session: a turn handle on the rim the body's centre sweeps out,
 * reading arc length as degrees exactly like the sketch array's turn handle (the axis carries
 * `180/πr`), with the angle and count as canvas badges a double-click edits through the
 * sketch's datum dialog. Everything about the gesture (press/drag, click-move-click, numeric
 * entry, the confirm bar, ESC) is `AxisDragHandler`'s; this class says where the handle sits,
 * what the ghosts look like, and when the numbers may commit.
 *
 * The ghosts are placed by the FEATURE'S OWN math (`circularPlacements`), so what drags by is
 * bit for bit what a rebuild builds — the boolean is the only thing the preview skips, since
 * it never moves the copies.
 */
export class PatternDragHandler extends AxisDragHandler implements PatternPanelSink {
    private _count: number;
    private _value: number;
    private _equalSpacing: boolean;
    private _arrowHovered = false;

    /** The reference in the BODY's frame — the frame the feature's placements live in. */
    private readonly _hostLine: PatternLine;
    /** The unit world axis — the drag's reference, which must not inherit a scale. */
    private readonly _worldDir: XYZ;
    /** The handle's anchor in world space: the rim point the body's centre sweeps out. */
    private readonly _anchor: XYZ;
    /** The rim radius and its radial direction, for the arc-length conversion. */
    private readonly _rim: { readonly radial: XYZ; readonly radius: number } | undefined;

    /** The view the canvas badges are drawn into — the one the session opened on. */
    private readonly _badgeView: IView | undefined;
    /** The live badges by kind; a badge keeps its element while text AND anchor are unchanged. */
    private readonly _badges = new Map<BadgeKind, SessionBadge>();

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: PatternSessionData,
    ) {
        super(document, controller);
        this._count = data.count;
        this._value = data.value;
        this._equalSpacing = data.equalSpacing;
        const inverse = data.body.worldTransform().invert() ?? Matrix4.identity();
        this._hostLine = {
            point: inverse.ofPoint(data.line.point),
            direction: inverse.ofVector(data.line.direction),
        };
        this._worldDir = data.line.direction.normalize() ?? XYZ.unitZ;
        const frame = this.handleFrame();
        this._anchor = frame.anchor;
        this._rim = frame.rim;
        this._badgeView = document.application.activeView;
        this.start();
    }

    // ------------------------------------------------------------------ The command's side

    /**
     * The command pushes a panel count in; an unresolvable expression never reaches here.
     * The same setter is the badge dialog's confirm path, so the panel hears the change
     * back through `onCount` — a push of the panel's own value is a no-op before it loops.
     */
    setCount(count: number): void {
        if (this._count === count) return;
        this._count = count;
        this.data.onCount?.(count);
        this.refreshTempShapes();
    }

    setEqualSpacing(value: boolean): void {
        if (this._equalSpacing === value) return;
        this._equalSpacing = value;
        this.refreshTempShapes();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /**
     * The line the drag is measured on: the rim's tangent, carrying the arc-to-degrees
     * conversion in its length — the sketch array's turn-handle trick, so `projectValue`
     * reads degrees straight off.
     */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        if (this._rim === undefined) return { origin: this._anchor, normal: this._worldDir };
        const tangent = this._worldDir.cross(this._rim.radial).normalize() ?? XYZ.unitX;
        return {
            origin: this._anchor,
            normal: tangent.multiply(180 / (Math.PI * this._rim.radius)),
        };
    }

    /**
     * A fixed pixel-sized arrow on the rim's tangent. It never flips with the angle's sign:
     * it marks the rotation's zero, not its extent.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        const tangent = this.axis().normal.normalize() ?? XYZ.unitX;
        return { start: this._anchor, end: this._anchor.add(tangent.multiply(this.handleLength)) };
    }

    protected override currentValue(): number {
        return this._value;
    }

    protected override setCurrentValue(value: number): void {
        this._value = value;
        this.data.onValue?.(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    /** Hover lights the arrow — and puts the badges inert while it lasts. */
    protected override onHover(view: IView, event: PointerEvent): void {
        // Covers the case where no active view was available at construction time.
        if (this.arrowLength === undefined) this.refreshArrow(view);
        this.setArrowHover(view, this.isOverArrow(view, event));
    }

    /**
     * Hovering the arrow puts the badges inert — a DOM badge over the mesh handle would
     * otherwise swallow the press that grabs it. The gesture's own frames already repaint
     * the badges through `afterPreview`; a bare hover change has no such frame, so it
     * repaints here.
     */
    protected override setArrowHover(view: IView, hovered: boolean): void {
        super.setArrowHover(view, hovered);
        this.refreshBadges();
    }

    /** The badges ride every preview repaint, so a drag carries them with the ghosts. */
    protected override afterPreview(): void {
        this.refreshBadges();
    }

    /**
     * The commit gate, on the numbers as RESOLVED (an expression that never resolved never
     * reaches the session — it passes here and meets `validateParams`' toast at the commit):
     * a whole count of at least 2 and a non-zero angle.
     */
    protected override canConfirm(): boolean {
        return Number.isInteger(this._count) && this._count >= 2 && this._value !== 0;
    }

    protected override buildPreview(): DragPreview {
        if (this._value === 0) return { meshes: [] };
        const shape = this.data.body.shape;
        if (!shape.isOk) return { meshes: [] };
        const world = this.data.body.worldTransform();
        const meshes: ShapeMeshData[] = [];
        for (const placement of this.placements(this._count, this._value)) {
            const copy = shape.value.transformedMul(world.multiply(placement));
            const { faces, edges } = copy.mesh;
            if (faces !== undefined) meshes.push(faces);
            if (edges !== undefined) meshes.push(edges);
            copy.dispose();
        }
        return { meshes };
    }

    /** Ghosts, not solids-in-waiting: the original stays put and visible beside them. */
    protected override previewOpacity(): number {
        return 0.5;
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onCleanup(): void {
        for (const badge of this._badges.values()) badge.item.dispose();
        this._badges.clear();
        this.data.onDone?.();
    }

    /**
     * The copies' transforms in the host's frame — the feature's own placement function, fed
     * the reference line mapped the feature's own way, so the preview IS the rebuild's layout.
     */
    placements(count: number, value: number): Matrix4[] {
        return circularPlacements(
            this._hostLine.point,
            this._hostLine.direction,
            value,
            count,
            this._equalSpacing,
        );
    }

    // ------------------------------------------------------------------ The handle's frame

    /**
     * Where the handle stands: on the rim the body's centre sweeps out — its distance from the
     * axis, or, when the centre lies ON the axis (a cylinder about its own axis), at a minimum
     * radius off it, radial along any perpendicular, so the drag still has a lever to be read on.
     */
    private handleFrame(): { anchor: XYZ; rim?: { radial: XYZ; radius: number } } {
        const world = this.data.body.worldTransform();
        const shape = this.data.body.shape;
        if (!shape.isOk) return { anchor: world.ofPoint(XYZ.zero) };
        const box = shape.value.boundingBox();
        const centre = world.ofPoint(BoundingBox.center(box));

        const { point, direction } = this.data.line;
        const unit = direction.normalize() ?? XYZ.unitZ;
        const projection = point.add(unit.multiply(centre.sub(point).dot(unit)));
        const offset = centre.sub(projection);
        const radius = offset.length();
        const radial = offset.normalize();
        if (radial !== undefined && radius > Precision.Distance) {
            return { anchor: centre, rim: { radial, radius } };
        }
        const diagonal = new XYZ(box.max).sub(new XYZ(box.min)).length();
        const fallback = unit.isParallelTo(XYZ.unitZ)
            ? XYZ.unitX
            : (unit.cross(XYZ.unitZ).normalize() ?? XYZ.unitX);
        const rimRadius = Math.max(diagonal / 2, MIN_HANDLE_RADIUS);
        return {
            anchor: projection.add(fallback.multiply(rimRadius)),
            rim: { radial: fallback, radius: rimRadius },
        };
    }

    // ------------------------------------------------------------------ The canvas badges

    /**
     * The numbers the session is made of, drawn on the canvas the sketch array's way: the
     * dragged angle at the mid-swing rim point, the count at the last copy's seat. A badge
     * whose text AND anchor are unchanged keeps its element (a redraw would drop the hover it
     * sits under); a changed one is disposed and drawn afresh. `inert` never enters the key —
     * it is toggled on the live element, or the very hover that raised it would go with the
     * redraw.
     */
    private refreshBadges(): void {
        const view = this._badgeView;
        if (view === undefined) return;
        const inert = this._arrowHovered || this.gestureActive;
        const valueText = formatMeasurement("angle", this._value);
        this.drawBadge(
            view,
            "value",
            valueText,
            this.valueAnchor(),
            I18n.translate("sketch.arrayAngleBadge{0}", valueText) ?? "",
            inert,
            () => this.editValue(),
        );
        this.drawBadge(
            view,
            "count",
            `×${this._count}`,
            this.countAnchor(),
            I18n.translate("sketch.arrayCountBadge{0}", this._count) ?? "",
            inert,
            () => this.editCount(),
        );
    }

    private drawBadge(
        view: IView,
        kind: BadgeKind,
        text: string,
        anchor: XYZ,
        title: string,
        inert: boolean,
        onEdit: () => void,
    ): void {
        const key = `${text}|${anchor.x}|${anchor.y}|${anchor.z}`;
        const existing = this._badges.get(kind);
        if (existing?.key === key) {
            existing.element?.classList.toggle(style.inert, inert);
            if (existing.element !== undefined) existing.element.title = title;
            return;
        }
        existing?.item.dispose();
        let element: HTMLElement | undefined;
        const item = view.htmlText(text, anchor, {
            hideDelete: true,
            interactive: true,
            className: style.badge,
            // the value rides above its anchor, the count hangs below its own — on a shared
            // anchor the two still never overlap
            center: kind === "value" ? { x: 0.5, y: 0 } : { x: 0.5, y: 1.4 },
            onCreated: (created) => {
                element = created;
                created.classList.toggle(style.inert, inert);
                created.title = title;
            },
            onDoubleClick: (event) => {
                event.stopPropagation();
                onEdit();
            },
            // the press is the badge's; the viewport has no business with it
            onClick: (event) => event.stopPropagation(),
        });
        this._badges.set(kind, { key, item, element });
    }

    /** Where the dragged angle is read at: the rim point swung half of it about the axis. */
    private valueAnchor(): XYZ {
        return this.rotateAnchor(this._value / 2);
    }

    /** Where the count is read at: the last copy's seat — the even spread's last, when it fills. */
    private countAnchor(): XYZ {
        const last = this._equalSpacing ? (this._value * (this._count - 1)) / this._count : this._value;
        return this.rotateAnchor(last);
    }

    /** The rim anchor swung `degrees` about the reference axis (the badges' world frame). */
    private rotateAnchor(degrees: number): XYZ {
        const unit = this.data.line.direction.normalize() ?? XYZ.unitZ;
        const radians = MathUtils.degToRad(degrees);
        return Matrix4.fromAxisRad(this.data.line.point, unit, radians).ofPoint(this._anchor);
    }

    /**
     * A badge's double-click: the sketch's own datum dialog, so a pattern's numbers are edited
     * in the same voice as a dimension. The angle takes signed input (a negative runs the
     * pattern the other way); the count is a whole number of at least two. A confirmed value
     * goes through the session's own write path — `setValue`/`setCount` — and the panel hears
     * it through the session's report-backs.
     */
    private editValue(): void {
        void promptDatum(
            this._value,
            (input) => {
                const resolved = this.resolveInput(input, ANGLE_UNITS);
                if (resolved.isOk) this.setValue(resolved.value);
            },
            () => {},
            undefined,
            {
                title: "sketch.arrayAngle",
                positiveOnly: false,
                resolve: (input) => this.resolveInput(input, ANGLE_UNITS),
            },
        );
    }

    private editCount(): void {
        void promptDatum(
            String(this._count),
            (input) => {
                const resolved = this.resolveCountInput(input);
                if (resolved.isOk) this.setCount(resolved.value);
            },
            () => {},
            undefined,
            { title: "common.count", resolve: (input) => this.resolveCountInput(input) },
        );
    }

    /** A count as the dialog reads it: a whole number of at least two, or the box stays open. */
    private resolveCountInput(input: ParameterValue): Result<number> {
        const resolved = this.resolveInput(input, UNITLESS);
        if (!resolved.isOk) return resolved;
        if (!Number.isInteger(resolved.value) || resolved.value < 2) {
            return Result.err("The count must be a whole number of at least 2");
        }
        return resolved;
    }

    /** Typed input resolved the command's own way — against the document's parameters. */
    private resolveInput(input: ParameterValue, unit: UnitSpec): Result<number> {
        if (this.data.resolve !== undefined) return this.data.resolve(input, unit);
        return typeof input === "number" ? Result.ok(input) : Result.err("error.input.invalidNumber");
    }
}

/** A step that is nothing but its own work — the curve path pick, which opens its preview as it goes. */
export class CallbackStep implements IStep {
    constructor(
        private readonly run: (
            document: IDocument,
            controller: AsyncController,
        ) => Promise<SnapResult | undefined>,
    ) {}

    execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        return this.run(document, controller);
    }
}

/**
 * The picked edges' live geometry in the BODY's frame — what the curve preview ghosts are built
 * from, read from the picks rather than the stored refs so the first frame is up before any
 * rebuild. Fails when the picks are not one chain on one node: the run then shows nothing rather
 * than a path the commit could not store.
 */
export function pathFramesFromPicks(
    body: ParametricBodyNode,
    shapes: readonly VisualShapeData[],
): Result<PatternPathFrames> {
    const first = shapes[0];
    if (first === undefined) return Result.err("Select the path edges on one body");
    if (shapes.some((shape) => shape.owner.node !== first.owner.node)) {
        return Result.err("Select the path edges on one body");
    }
    const inverse = body.worldTransform().invert();
    if (inverse === undefined) return Result.err("Pattern path cannot be mapped into the body");
    const ordered = orderPathEdges(shapes.map((shape) => shape.shape as unknown as IEdge));
    if (!ordered.isOk) return Result.err(ordered.error);
    // Pick-local → world → host: the receiver of `multiply` runs first.
    return measuredPath(ordered.value, first.transform.multiply(inverse));
}

/**
 * The curve pattern's canvas ghosts, driven live by the path selection and the options panel.
 *
 * It is not an event handler: the path step owns the viewport with the ordinary multi-select
 * handler, and this class only draws. Every selection change re-measures the picked chain and
 * re-ghosts it, which is what makes the curve pattern ONE step — the copies appear as the edges
 * are clicked, and the selection bar's own confirm (or Enter) is the commit.
 *
 * There is no drag handle: a curve has no single axis to drag a distance along, so the numbers
 * stay on the panel (the line modes put arrows on their directions because each direction IS an
 * axis). The ghosts are placed by the FEATURE'S OWN math (`curvePlacements`), so what previews is
 * bit for bit what a rebuild builds — only the boolean is skipped.
 */
export class CurvePatternPathPreview implements PatternPanelSink, IDisposable {
    private _meshes: number[] = [];
    private _frames: PatternPathFrames | undefined;
    private _count: number;
    private _value: number;
    private _equalSpacing: boolean;
    private _orientation: PatternOrientation;

    constructor(
        private readonly document: IDocument,
        private readonly body: ParametricBodyNode,
        options: {
            readonly count: number;
            readonly spacing: number;
            readonly equalSpacing: boolean;
            readonly orientation: PatternOrientation;
        },
    ) {
        this._count = options.count;
        this._value = options.spacing;
        this._equalSpacing = options.equalSpacing;
        this._orientation = options.orientation;
    }

    /** The measured path, once the current selection makes one; undefined when it does not. */
    get frames(): PatternPathFrames | undefined {
        return this._frames;
    }

    /** The distance equal spacing would use — what the command converges a blank field to. */
    get suggestedSpacing(): number | undefined {
        const frames = this._frames;
        if (frames === undefined) return undefined;
        // A closed path divides by the count (the last copy must miss the original), exactly
        // as `curvePlacements` does; an open path has an end for the last copy to reach.
        const gaps = frames.closed ? this._count : this._count - 1;
        return frames.length / Math.max(1, gaps);
    }

    /** The selection changed: re-measure the picked chain and re-ghost it. */
    setEdges(shapes: readonly VisualShapeData[]): void {
        const frames = pathFramesFromPicks(this.body, shapes);
        this._frames = frames.isOk ? frames.value : undefined;
        this.refresh();
    }

    // ------------------------------------------------------------------ The panel's pushes

    setCount(count: number): void {
        if (this._count === count) return;
        this._count = count;
        this.refresh();
    }

    setValue(value: number): void {
        if (Math.abs(this._value - value) < Precision.Float) return;
        this._value = value;
        this.refresh();
    }

    setEqualSpacing(value: boolean): void {
        if (this._equalSpacing === value) return;
        this._equalSpacing = value;
        this.refresh();
    }

    setOrientation(value: PatternOrientation): void {
        if (this._orientation === value) return;
        this._orientation = value;
        this.refresh();
    }

    dispose(): void {
        this.dropMeshes();
        this._frames = undefined;
    }

    // ------------------------------------------------------------------ The ghosts

    private refresh(): void {
        this.dropMeshes();
        const frames = this._frames;
        const shape = this.body.shape;
        if (frames === undefined || !shape.isOk) return;
        const placements = curvePlacements(
            frames,
            this._count,
            this._value,
            this._equalSpacing,
            this._orientation,
        );
        if (!placements.isOk) return;

        const world = this.body.worldTransform();
        const context = this.document.visual.context;
        for (const placement of placements.value) {
            // The placement lives in the body's frame, so it runs BEFORE the body's own
            // transform: `a.multiply(b)` applies `a` first in this Matrix4.
            const copy = shape.value.transformedMul(placement.multiply(world));
            const { faces, edges } = copy.mesh;
            if (faces !== undefined) this._meshes.push(context.displayMesh([faces], { meshOpacity: 0.5 }));
            if (edges !== undefined) this._meshes.push(context.displayMesh([edges], { meshOpacity: 0.5 }));
            copy.dispose();
        }
        this.document.visual.update();
    }

    private dropMeshes(): void {
        for (const id of this._meshes) this.document.visual.context.removeMesh(id);
        this._meshes = [];
        this.document.visual.update();
    }
}
