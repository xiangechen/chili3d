// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type I18nKeys,
    type IDocument,
    type IFace,
    type INode,
    type IStep,
    type IView,
    type IVisualObject,
    Plane,
    Precision,
    ShapeTypes,
    type SnapResult,
    type VisualShapeData,
    VisualStates,
    VisualStateUtils,
    XYZ,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { planeOfFace } from "../sketch/planeRef";
import { SketchNode } from "../sketch/sketchNode";
import { ARROW_LENGTH } from "./arrowHandle";
import { AxisDragHandler, type DragPreview } from "./axisDragHandler";
import { prioritizeSketchFaces } from "./profileFaceSort";

/**
 * State of a profile face picked for the extrude: the translucent fill a selection
 * usually gets, plus its boundary outlined, so the profile that will be swept reads
 * apart from the faces that are merely hovered.
 */
export const SELECTED_PROFILE_STATE = VisualStateUtils.addState(
    VisualStates.faceTransparent,
    VisualStates.edgeSelected,
);

/**
 * Mutable state of a drag session. The handler updates it when the user drags the
 * arrow or clicks another profile face; the command reads it through the callbacks
 * below so the preview always reflects the live face set.
 */
export interface ExtrudeDragState {
    /** The sketch or parametric body the current faces belong to. */
    node: INode;
    faces: VisualShapeData[];
    origin: XYZ;
    normal: XYZ;
    anchor: XYZ;
    dist: number;
    /** Bottom offset of the extrude along `normal` (startOffset). */
    startOffset: number;
}

/** The preview of a boolean target body: it *is* the result, so the body comes down. */
export type ExtrudePreview = DragPreview;

export interface ExtrudeDragData {
    node: INode;
    /** Initial profile faces from the pick step; empty means the whole sketch. */
    faces: VisualShapeData[];
    origin: XYZ;
    normal: XYZ;
    anchor: XYZ;
    /** The command's current signed depth, so the arrow starts in sync with its input. */
    depth?: number;
    /** The command's current start offset, so the arrow starts at the extruded end face. */
    startOffset?: number;
    buildPreview(state: ExtrudeDragState): ExtrudePreview;
    /** The handler registers itself so the command can push option/depth changes back. */
    onReady?(handler: ExtrudeDragHandler): void;
    /** The handler reports its cleanup so the command can drop the reference. */
    onDone?(): void;
    /** The handler reports the signed depth so the command syncs its depth input. */
    onDist?(dist: number): void;
}

/** Outward plane of a picked solid face, in world coordinates. */
export function planeOfPickedFace(face: VisualShapeData): Plane {
    const world = (face.shape as IFace).transformedMul(face.transform) as IFace;
    const plane = planeOfFace(world);
    world.dispose();
    return plane;
}

/**
 * Push-pull step: shows a draggable arrow plus the confirm/cancel buttons from the
 * start. Two gestures set the depth: drag the arrow with the left button held, or
 * click the arrow and then click a second point (classic click-move-click) — both
 * project the mouse ray onto the extrude normal. A plain click on another profile face
 * (sketch profile or planar solid face) switches the target (Shift toggles faces of the
 * current node). Typing a number enters an exact length. Confirm (button/Enter)
 * commits once a non-zero depth exists; Escape cancels (exiting click-move mode first).
 */
export class ExtrudeDragStep implements IStep {
    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => ExtrudeDragData,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const data = this.handleStepData();
        const handler = new ExtrudeDragHandler(document, controller, data);
        try {
            await document.picker.pickAsync(handler, this.tip, controller, false, "draw");
        } finally {
            // Dispose first, always: the handler's cleanup is what puts back the nodes a
            // boolean preview hid, and a body left invisible is a far louder failure than
            // a stray preview mesh (a throwing pick subscriber must not cause either).
            handler.dispose();
        }

        const state = handler.state;
        const view = handler.commitView;
        if (controller.result?.status !== "success" || view === undefined) return undefined;

        return {
            view,
            point: state.origin.add(state.normal.multiply(state.dist)),
            distance: Math.abs(state.dist),
            shapes: state.faces,
            nodes: [state.node as any],
            type: "input",
            // The live drag plane (it changes when the user switches faces mid-drag),
            // so the command can recover the signed length and direction.
            plane: new Plane({
                origin: state.origin,
                normal: state.normal,
                xvec: state.normal.isParallelTo(XYZ.unitZ)
                    ? XYZ.unitX
                    : XYZ.unitZ.cross(state.normal).normalize()!,
            }),
        };
    }
}

export class ExtrudeDragHandler extends AxisDragHandler {
    readonly state: ExtrudeDragState;

    private _hovered: VisualShapeData | undefined;
    /** The face the arrow is anchored to; re-detection yields new points, so track identity. */
    private _anchorFace: VisualShapeData | undefined;
    /** Visual currently ghosted for the drag (see `syncSourceGhost`). */
    private _ghosted: IVisualObject | undefined;
    private _arrowHovered = false;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: ExtrudeDragData,
    ) {
        super(document, controller);
        this.state = {
            node: data.node,
            faces: [...data.faces],
            origin: data.origin,
            normal: data.normal,
            anchor: data.anchor,
            dist: data.depth ?? 0,
            startOffset: data.startOffset ?? 0,
        };
        // The initial anchor is the first face's pick point (see the command's getDragData).
        this._anchorFace = data.faces[0]?.point !== undefined ? data.faces[0] : undefined;
        this.start();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /** The depth is measured from the plane origin, along its normal. */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        return { origin: this.state.origin, normal: this.state.normal };
    }

    /**
     * The arrow's shaft: base sits at the extrude's end face (anchor + normal *
     * (dist + startOffset)) and the arrow keeps its length, pointing in the drag direction.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        const { dist, normal, anchor, startOffset } = this.state;
        const dir = dist < -Precision.Float ? normal.multiply(-1) : normal;
        const start = anchor.add(normal.multiply(dist + startOffset));
        return { start, end: start.add(dir.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    /** Measured at the fixed anchor, not at the moving depth (see the base class). */
    protected override scaleAnchor(): XYZ {
        return this.state.anchor;
    }

    protected override currentValue(): number {
        return this.state.dist;
    }

    protected override setCurrentValue(value: number): void {
        this.state.dist = value;
        this.data.onDist?.(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    protected override canConfirm(): boolean {
        return Math.abs(this.state.dist) >= Precision.Float;
    }

    protected override buildPreview(): ExtrudePreview {
        if (Math.abs(this.state.dist) < Precision.Float) return { meshes: [] };
        return this.data.buildPreview(this.state);
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onHover(view: IView, event: PointerEvent): void {
        this.updateHover(view, event);
    }

    protected override onClick(view: IView, event: PointerEvent): void {
        this.handleClick(view, event);
    }

    protected override afterPreview(): void {
        this.syncSourceGhost();
    }

    protected override onCleanup(): void {
        this.clearSourceGhost();
        this.data.onDone?.();
    }

    // ------------------------------------------------------------------ Extrude-only gestures

    /** The command pushes a new start offset; the arrow base must follow the end face. */
    setStartOffset(value: number): void {
        if (Math.abs(this.state.startOffset - value) < Precision.Float) return;
        this.state.startOffset = value;
        this.refresh();
    }

    private updateHover(view: IView, event: PointerEvent) {
        // Covers the case where no active view was available at construction time.
        if (this.arrowLength === undefined) this.refreshArrow(view);
        if (this.isOverArrow(view, event)) {
            this.clearHover();
            this.setArrowHover(view, true);
            return;
        }
        this.setArrowHover(view, false);

        const face = this.detectProfileFace(view, event);
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

    protected override clearHover() {
        if (this._hovered === undefined) return;
        this.document.visual.highlighter.removeState(
            this._hovered.owner,
            VisualStates.faceHighlight,
            ShapeTypes.face,
            ...this._hovered.indexes,
        );
        this._hovered = undefined;
    }

    private handleClick(view: IView, event: PointerEvent) {
        const face = this.detectProfileFace(view, event);
        if (face === undefined) return;

        const shiftToggle =
            event.shiftKey && face.owner.node === this.state.node && this.state.faces.length > 0;
        if (shiftToggle) {
            if (!this.toggleFace(face)) return;
        } else {
            this.switchTarget(face);
        }

        this.setCurrentValue(0);
        // Refresh the arrow before syncing the selection: a throwing selection
        // subscriber must not leave the arrow at the stale position.
        this.refreshTempShapes(view);
        this.document.selection.setSelectedShapes(this.state.faces, SELECTED_PROFILE_STATE, false);
        view.document.visual.update();
    }

    /**
     * Shift-click on the current node toggles the face in the extrude set. Returns
     * false when the click is a no-op (removing the last remaining profile).
     */
    private toggleFace(face: VisualShapeData): boolean {
        const index = this.state.faces.findIndex((x) => ExtrudeDragHandler.sameFace(x, face));
        if (index < 0) {
            this.state.faces.push(face);
            // Follow the newly added profile with the arrow.
            if (face.point !== undefined) {
                this.state.anchor = face.point;
                this._anchorFace = face;
            }
            return true;
        }
        if (this.state.faces.length === 1) return false; // keep at least one profile
        this.state.faces.splice(index, 1);
        // The arrow was on the removed profile: fall back to the previous one.
        if (this._anchorFace !== undefined && ExtrudeDragHandler.sameFace(this._anchorFace, face)) {
            const previous = this.state.faces.at(-1);
            this.state.anchor = previous?.point ?? this.state.origin;
            this._anchorFace = previous?.point !== undefined ? previous : undefined;
        }
        return true;
    }

    /** A plain click switches the extrude to the clicked face (and its node's plane). */
    private switchTarget(face: VisualShapeData) {
        const node = face.owner.node;
        const plane = node instanceof SketchNode ? node.plane : planeOfPickedFace(face);
        this.state.node = node;
        this.state.faces = [face];
        this.state.origin = plane.origin;
        this.state.normal = plane.normal;
        this.state.anchor = face.point ?? plane.origin;
        this._anchorFace = face.point !== undefined ? face : undefined;
    }

    /** Sketch profile faces, or planar faces of a parametric body (press-pull). */
    private detectProfileFace(view: IView, event: PointerEvent): VisualShapeData | undefined {
        const faces = prioritizeSketchFaces(view.detectShapes(ShapeTypes.face, event.offsetX, event.offsetY));
        return faces.find(
            (x) =>
                x.owner.node instanceof SketchNode ||
                (x.owner.node instanceof ParametricBodyNode && (x.shape as IFace).surface().isPlanar()),
        );
    }

    /**
     * Ghosts a sketch the drag extrudes from. Its profile faces are real geometry in the
     * node's mesh (`SketchNode.showProfileFaces`, what makes them pickable), so the
     * transparent highlight lands on an opaque face and just tints it — the face has to
     * go transparent too. Whole-visual state: the mesh's faces take the transparent
     * material, its edges keep theirs, and picking is unaffected (it goes through the
     * geometry, not the materials), so faces stay hoverable and toggleable mid-drag.
     */
    private syncSourceGhost() {
        const node = this.state.node;
        const visual = node instanceof SketchNode ? this.document.visual.context.getVisual(node) : undefined;
        if (visual === this._ghosted) return;

        this.clearSourceGhost();
        if (visual === undefined) return;

        // The drag owns the interaction: the picked profile faces are the selection that
        // matters now, so the whole node comes out of the selection — a node-selected
        // sketch would otherwise stay outlined edge to edge for the whole drag.
        this.document.selection.setSelectedNodes([], false);
        this.document.visual.highlighter.addState(visual, VisualStates.faceTransparent, ShapeTypes.shape);
        this._ghosted = visual;
    }

    private clearSourceGhost() {
        if (this._ghosted === undefined) return;
        this.document.visual.highlighter.removeState(
            this._ghosted,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        this._ghosted = undefined;
    }

    private static sameFace(a: VisualShapeData, b: VisualShapeData): boolean {
        return a.owner === b.owner && a.indexes.join(",") === b.indexes.join(",");
    }
}
