// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    type I18nKeys,
    type IDocument,
    type IFace,
    type IStep,
    type IView,
    type IVisualObject,
    MathUtils,
    type Plane,
    Precision,
    ShapeTypes,
    type SnapResult,
    type VisualShapeData,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { ARROW_LENGTH } from "./arrowHandle";
import { AxisDragHandler, type DragPreview } from "./axisDragHandler";
import { SELECTED_FACE_STATE } from "./selectedFaceState";

/**
 * Where the draft's angle handle sits, and what its drag measures.
 *
 * - `anchor` — the arrow's position, at the face's centre.
 * - `lean` — the in-plane direction a positive angle leans the face towards: the face's own
 *   outward normal with its component along the neutral plane's normal removed. A face parallel
 *   to the neutral plane has none, which is exactly the face the kernel cannot taper (no
 *   rotation line), so "no lean" IS "no draft" rather than a separate failure.
 * - `height` — the anchor's distance from the neutral plane. The lever arm the angle is measured
 *   at: a point `height` away from the rotation line moves `height·tan(angle)` when the face
 *   tilts, so the drag inverts that instead of inventing a degrees-per-millimetre constant.
 */
export interface DraftLean {
    readonly anchor: XYZ;
    readonly lean: XYZ;
    readonly height: number;
}

/**
 * The handle's geometry, taken from the first picked face that can carry one.
 *
 * Measured at the face's CENTRE rather than on the rotation line itself (where the face meets the
 * neutral plane): the centre is defined for every face, including the ones that do not reach the
 * plane at all, and it is where the eye already is when the face is picked. The lever is then the
 * centre's distance to the plane — half the face's own depth in the common case, which is what
 * makes the drag feel like the face tilting rather than like a number scrolling.
 */
export function draftLean(faces: readonly VisualShapeData[], neutral: Plane): DraftLean | undefined {
    for (const data of faces) {
        const world = data.shape.transformedMul(data.transform) as IFace;
        try {
            const anchor = BoundingBox.center(world.boundingBox());
            const height = anchor.distanceTo(neutral.project(anchor));
            // A centre ON the plane means the face lies in it: no rotation line, nothing to
            // taper, and a lever that would make the angle jump to a right angle on the first
            // pixel of travel.
            if (height < Precision.Float) continue;
            const [, normal] = world.normal(0, 0);
            const lean = normal.sub(neutral.normal.multiply(normal.dot(neutral.normal))).normalize();
            if (lean === undefined) continue;
            return { anchor, lean, height };
        } finally {
            world.dispose();
        }
    }
    return undefined;
}

/**
 * The direction the handle points for `angle`: along the lean, flipped once the angle is
 * negative — the same "the arrow follows the sign" rule the extrude and offset handles use.
 */
export function draftArrowDirection(lean: XYZ, angle: number): XYZ {
    return angle < -Precision.Float ? lean.multiply(-1) : lean;
}

/** The live state of a draft drag: the body being tapered, the faces picked on it, the angle. */
export interface DraftDragState {
    /** The body being tapered — undefined until the first face is picked. */
    node?: ParametricBodyNode;
    /** The faces picked on `node`, in that body's own frame. */
    faces: VisualShapeData[];
    angle: number;
}

export interface DraftDragData {
    /** The neutral plane in WORLD coordinates — the frame the handle is measured in. */
    readonly neutral: Plane;
    /** Faces already selected when the step opened; the drag owns the set from there. */
    readonly faces: VisualShapeData[];
    /** The command's current angle, so the arrow starts in sync with its input. */
    readonly angle: number;
    /** The tapered preview for the live state — the command builds it, the drag draws it. */
    buildPreview(state: DraftDragState): DragPreview;
    /** The handler reports the dragged angle so the command syncs its angle input. */
    onAngle?(angle: number): void;
    /** The handler registers itself so the command can push option changes back. */
    onReady?(handler: DraftDragHandler): void;
    /** The handler reports its cleanup so the command can drop the reference. */
    onDone?(): void;
}

/**
 * The draft's one interaction step, after the neutral plane is known: pick the faces to taper AND
 * drag the arrow for the angle, in the same gesture.
 *
 * Structured on `ExtrudeDragHandler`, which solves the same problem — a shape pick and a value
 * drag sharing one pointer session — the same way: `AxisDragHandler` runs the gesture (arrow,
 * hover, grab, click-move-click, numeric entry, the confirm bar) and the subclass says what a
 * click on a face means and where the axis is.
 *
 * A click toggles the face it lands on in the picked set — the same add-and-remove rule every
 * multi-face pick has, marked with the same `SELECTED_FACE_STATE` — and a click on ANOTHER body's
 * face switches the target outright, because a draft rewrites one body's chain. The angle handle
 * stands on the first picked face that can carry one, and moves to the next one as the set
 * changes.
 */
export class DraftDragStep implements IStep {
    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => DraftDragData | undefined,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const data = this.handleStepData();
        if (data === undefined) return undefined;
        const handler = new DraftDragHandler(document, controller, data);
        try {
            await document.picker.pickAsync(handler, this.tip, controller, "none", "draw");
        } finally {
            // Dispose first, always: the handler's cleanup is what puts back the body it ghosted
            // and drops the preview meshes.
            handler.dispose();
        }
        const state = handler.state;
        const view = handler.commitView;
        if (controller.result?.status !== "success" || view === undefined) return undefined;
        // A drag can only commit with a face picked, and a picked face names its body.
        return { view, shapes: state.faces, ...(state.node ? { nodes: [state.node] } : {}), type: "shape" };
    }
}

export class DraftDragHandler extends AxisDragHandler {
    readonly state: DraftDragState;

    /** The handle's geometry for the CURRENT face set — undefined until one can carry it. */
    private _lean: DraftLean | undefined;
    /** The face under the pointer; re-detection yields new objects, so track identity. */
    private _hovered: VisualShapeData | undefined;
    /** The body currently ghosted for the preview (see `syncGhost`). */
    private _ghosted: IVisualObject | undefined;
    private _arrowHovered = false;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: DraftDragData,
    ) {
        super(document, controller);
        const first = data.faces.at(0)?.owner.node;
        this.state = {
            ...(first instanceof ParametricBodyNode ? { node: first } : {}),
            faces: [...data.faces],
            angle: data.angle,
        };
        // The seed has to land in the selection, not just in the state: `syncFaces` re-reads the
        // picked set from the selection on every click, so a set that only lived here would be
        // dropped by the first one. Seeding also makes that first click toggle the faces it
        // lands on, rather than replacing the whole set as a click on "another" body would.
        if (data.faces.length > 0) {
            document.selection.setSelectedShapes(data.faces, SELECTED_FACE_STATE, false);
        }
        this.refreshLean();
        this.start();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /**
     * With no lever there is no axis to read an angle off — but the base class still projects onto
     * whatever this returns, so the neutral plane stands in: a valid, INERT axis. `arrowSegment`
     * draws nothing for it and `projectValue` refuses to read it.
     */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        const lean = this._lean;
        return lean === undefined
            ? { origin: this.data.neutral.origin, normal: this.data.neutral.normal }
            : { origin: lean.anchor, normal: lean.lean };
    }

    /** A fixed pixel-sized arrow on the anchor, flipped once the angle turns negative. */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        const lean = this._lean;
        if (lean === undefined) {
            // A zero-length segment: the base class normalises the direction and drops a
            // degenerate one, so no arrow is drawn — which is right, there is nothing to drag.
            const origin = this.data.neutral.origin;
            return { start: origin, end: origin };
        }
        const start = lean.anchor;
        const dir = draftArrowDirection(lean.lean, this.state.angle);
        return { start, end: start.add(dir.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    /**
     * The pointer's travel along the lean direction, as an ANGLE: `atan(travel / height)`, the
     * tilt a point `height` away from the rotation line picks up when it moves that far.
     *
     * Converted here rather than in `currentValue` so the base class's grab-offset bookkeeping —
     * which subtracts the value at grab time to keep the drag continuous — stays in the unit the
     * user is editing. The absolute mapping is shifted by wherever the pointer took hold of a
     * fixed-size handle; the sensitivity is not, and that is the half that can feel wrong.
     */
    protected override projectValue(view: IView, event: PointerEvent): number {
        if (this._lean === undefined) return this.state.angle;
        return MathUtils.radToDeg(Math.atan2(super.projectValue(view, event), this._lean.height));
    }

    protected override currentValue(): number {
        return this.state.angle;
    }

    protected override setCurrentValue(value: number): void {
        this.state.angle = value;
        this.data.onAngle?.(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    protected override canConfirm(): boolean {
        return this.state.faces.length > 0 && Math.abs(this.state.angle) >= Precision.Float;
    }

    protected override buildPreview(): DragPreview {
        return this.data.buildPreview(this.state);
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onHover(view: IView, event: PointerEvent): void {
        this.updateHover(view, event);
    }

    protected override onClick(view: IView, event: PointerEvent): void {
        this.toggleFace(view, event);
    }

    protected override afterPreview(): void {
        this.syncGhost();
    }

    protected override clearHover(): void {
        if (this._hovered === undefined) return;
        this.document.visual.highlighter.removeState(
            this._hovered.owner,
            VisualStates.faceHighlight,
            ShapeTypes.face,
            ...this._hovered.indexes,
        );
        this._hovered = undefined;
    }

    protected override onCleanup(): void {
        this.clearGhost();
        this.data.onDone?.();
    }

    // ------------------------------------------------------------------ Face picking

    /** Hovering a face outlines it — the only cue that a click will pick it up. */
    private updateHover(view: IView, event: PointerEvent): void {
        // Covers the case where no active view was available at construction time.
        if (this.arrowLength === undefined) this.refreshArrow(view);
        this.setArrowHover(view, this.isOverArrow(view, event));
        if (this._arrowHovered) {
            this.clearHover();
            return;
        }
        const face = this.detectFace(view, event);
        if (face === this._hovered) return;

        this.clearHover();
        this._hovered = face;
        if (face !== undefined) {
            this.document.visual.highlighter.addState(
                face.owner,
                VisualStates.faceHighlight,
                ShapeTypes.face,
                ...face.indexes,
            );
        }
        view.update();
    }

    /**
     * A click toggles the face in the picked set — the same accumulate-and-remove rule the
     * selection gives every multi-face pick — unless it is on another body, which switches the
     * target outright.
     */
    private toggleFace(view: IView, event: PointerEvent): void {
        const face = this.detectFace(view, event);
        if (face === undefined) return;
        const sameBody = face.owner.node === this.state.node;
        this.document.selection.setSelectedShapes([face], SELECTED_FACE_STATE, sameBody);
        this.syncFaces(view);
    }

    /**
     * Re-reads the picked set from the selection, which stays the source of truth (that is what
     * the picker-driven face steps return too). The first picked face names the body being
     * tapered; an empty pick keeps the body so the handle's frame does not jump while re-picking.
     */
    private syncFaces(view: IView): void {
        const picked = this.document.selection
            .getSelectedShapes()
            .filter(
                (x) => x.shape.shapeType === ShapeTypes.face && x.owner.node instanceof ParametricBodyNode,
            );
        const node = picked.at(0)?.owner.node;
        if (node instanceof ParametricBodyNode) this.state.node = node;
        this.state.faces = picked.filter((x) => x.owner.node === this.state.node);
        this.refreshLean();
        this.refreshTempShapes(view);
    }

    /** The handle's geometry follows the face set: another face picked, another lever. */
    private refreshLean(): void {
        this._lean = draftLean(this.state.faces, this.data.neutral);
    }

    /** Faces of a parametric body — a draft tapers a body's chain, not a sketch's profiles. */
    private detectFace(view: IView, event: PointerEvent): VisualShapeData | undefined {
        return view
            .detectShapes(ShapeTypes.face, event.offsetX, event.offsetY)
            .find((x) => x.owner.node instanceof ParametricBodyNode);
    }

    // ------------------------------------------------------------------ Ghosting

    /**
     * Ghosts the body the preview stands in for. The taper keeps most of the body's surface and
     * moves the rest by a few degrees, so drawn together the two overlap and the result reads as
     * a ghost over the geometry it replaces.
     *
     * Ghosted rather than hidden, for `ExtrudeDragHandler`'s reason: picking goes through the
     * geometry, not the materials, so the faces stay hoverable and toggleable mid-drag.
     */
    private syncGhost(): void {
        const node = this.state.node;
        const visual = node === undefined ? undefined : this.document.visual.context.getVisual(node);
        if (visual === this._ghosted) return;

        this.clearGhost();
        if (visual === undefined) return;
        this.document.visual.highlighter.addState(visual, VisualStates.faceTransparent, ShapeTypes.shape);
        this._ghosted = visual;
    }

    private clearGhost(): void {
        if (this._ghosted === undefined) return;
        this.document.visual.highlighter.removeState(
            this._ghosted,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        this._ghosted = undefined;
    }
}
