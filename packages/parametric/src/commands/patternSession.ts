// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type AsyncController,
    BoundingBox,
    formatMeasurement,
    I18n,
    type I18nKeys,
    type IDisposable,
    type IDocument,
    type IEventHandler,
    type IStep,
    type IView,
    MathUtils,
    Matrix4,
    type ParameterValue,
    Precision,
    Result,
    type ShapeMeshData,
    type SnapResult,
    UNITLESS,
    type UnitSpec,
    XYZ,
} from "@chili3d/core";
import { circularPlacements, linearPlacements } from "../features/pattern";
import type { ParametricBodyNode } from "../parametricBodyNode";
import { promptDatum } from "../sketch/editor/datumPrompt";
import { ARROW_LENGTH } from "./arrowHandle";
import { AxisDragHandler } from "./axisDragHandler";
import style from "./patternSession.module.css";
import { type DragPreview, PreviewConfirmHandler } from "./previewConfirmHandler";

/**
 * The world line the pattern runs along: the picked edge's own geometry, read the feature's
 * way — the line is taken off the edge in the SOURCE's frame (normalised there, as
 * `lineOfEdge` does) and then carried into the world by the pick's transform.
 */
export interface PatternLine {
    readonly point: XYZ;
    readonly direction: XYZ;
}

/** The panel's push target while a pattern's preview/session is open. */
export interface PatternPanelSink {
    setCount(count: number): void;
    setValue(value: number): void;
}

/** What a pattern step's handler must satisfy: the event pump, disposal, and the committing view. */
export type PatternStepHandler = IEventHandler & { commitView: IView | undefined };

/**
 * The pattern command's last step, always run: opens whichever handler the mode builds on the
 * picks so far and waits it out — the confirm control (or Enter) commits while ESC leaves
 * nothing behind. Which handler that is belongs to the mode: a linear pattern hangs a ghost
 * preview for the options panel to drive; a circular one runs the turn-handle drag session.
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
            await document.picker.pickAsync(handler, this.tip, controller, "none", "draw");
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
 * What the linear preview opens with: the body, the reference direction(s) as world lines,
 * and the panel's numbers resolved (an expression that does not resolve opens as the field's
 * own default; the commit's validation reports it). Direction 2 rides along when the optional
 * pick brought one. No report-backs — a preview never edits the panel; the panel edits it.
 */
export interface PatternPreviewData {
    /** The body being patterned: its chain input is what the copies repeat. */
    readonly body: ParametricBodyNode;
    readonly line: PatternLine;
    /** Direction 2's world line, when the optional pick brought one. */
    readonly line2?: PatternLine;
    readonly count: number;
    readonly value: number;
    readonly count2?: number;
    readonly value2?: number;
    /** The handler registers itself so the command can push option changes in. */
    onReady?(handler: PatternPreviewHandler): void;
    /** The handler reports its cleanup so the command can drop the reference. */
    onDone?(): void;
}

/**
 * The linear pattern's preview-confirm session, Onshape-style: the ghost of every copy hangs
 * on the canvas the moment the reference edge is picked, the options panel's edits (count and
 * spacing, plus count2/spacing2 on a grid) re-ghost it live, and the confirm control (or
 * Enter) commits while ESC leaves nothing behind. No handles, no badges — the panel is the
 * editor.
 *
 * The ghosts are placed by the FEATURE'S OWN math (`linearPlacements`), so what previews is
 * bit for bit what a rebuild builds — the boolean is the only thing the preview skips, since
 * it never moves the copies.
 */
export class PatternPreviewHandler extends PreviewConfirmHandler implements PatternPanelSink {
    private _count: number;
    private _value: number;
    private _count2: number;
    private _value2: number;
    /** The reference in the BODY's frame — the frame the feature's placements live in. */
    private readonly _hostLine: PatternLine;
    /** Direction 2 in the body frame, when the optional pick brought one. */
    private readonly _hostLine2: PatternLine | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: PatternPreviewData,
    ) {
        super(document, controller);
        this._count = data.count;
        this._value = data.value;
        this._count2 = data.count2 ?? 1;
        this._value2 = data.value2 ?? 0;
        const inverse = data.body.worldTransform().invert() ?? Matrix4.identity();
        this._hostLine = {
            point: inverse.ofPoint(data.line.point),
            direction: inverse.ofVector(data.line.direction),
        };
        this._hostLine2 =
            data.line2 === undefined
                ? undefined
                : {
                      point: inverse.ofPoint(data.line2.point),
                      direction: inverse.ofVector(data.line2.direction),
                  };
        this.start();
    }

    // ------------------------------------------------------------------ The panel's pushes

    setValue(value: number): void {
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

    /** A handle's drawn length: pixel-sized, so it is aimed at rather than measured. */
    private get handleLength(): number {
        return Math.max(this.arrowLength ?? ARROW_LENGTH, ARROW_LENGTH);
    }

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
