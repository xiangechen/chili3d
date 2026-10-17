// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    Config,
    type IDocument,
    type IFace,
    type IView,
    PubSub,
    ShapeSelectionHandler,
    ShapeTypes,
    screenDistance,
    VisualConfig,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { pointCrossMesh } from "../sketch/curveMesh";
import { toUV, toWorld, viewPixelSize } from "../sketch/sketchModel";
import { SketchNode } from "../sketch/sketchNode";
import { capturePickedHoleFace, type PickedHoleFace } from "./holeFace";

/**
 * A sketch's standalone point the handler hit-tested — under the cursor right now, or
 * remembered as selected. `world` is the entity's position in world coordinates.
 */
export interface SketchPointGlyphHit {
    readonly sketch: SketchNode;
    readonly entityId: number;
    readonly world: XYZ;
}

/**
 * The nearest visible sketch's standalone point within `tolerancePx` screen pixels of (x, y).
 * A sketch point is NOT a sub-shape — it never enters the sketch's geometry, so the pick
 * pipeline cannot hit it and the handler hit-tests the glyphs itself, in pixels like the snap
 * system does (`screenDistance`). Construction points are skipped: they draw no cross outside
 * the editor, and a pick must land on something visible.
 */
export function sketchPointGlyphAt(
    document: IDocument,
    view: IView,
    x: number,
    y: number,
    tolerancePx: number = Config.instance.SnapDistance,
): SketchPointGlyphHit | undefined {
    let best: SketchPointGlyphHit | undefined;
    let bestDistance = tolerancePx;
    const sketches = document.modelManager.findNodes((n) => n instanceof SketchNode) as SketchNode[];
    for (const sketch of sketches) {
        if (!sketch.visible || !sketch.parentVisible) continue;
        const transform = sketch.worldTransform();
        for (const entity of sketch.data.entities) {
            if (entity.type !== "point" || entity.construction === true) continue;
            const world = transform.ofPoint(toWorld(sketch.plane, entity.params[0], entity.params[1]));
            const distance = screenDistance(view, x, y, world);
            if (distance <= bestDistance) {
                bestDistance = distance;
                best = { sketch, entityId: entity.id, world };
            }
        }
    }
    return best;
}

/**
 * The hole command's first step: pick the hole centers straight off the sketches' point
 * glyphs — a click toggles one, Enter or the confirm bar finishes — or click a planar face of
 * a parametric body to take the face instead (`faceResult`, ending the step, since
 * `multiMode` is off). A point glyph wins over the face under it: the cross the user is
 * aiming at is what the click takes, so the face highlight comes down while one is hovered.
 *
 * All centers come from ONE sketch (`HoleSketchPoints` is a one-sketch list): a click on
 * another sketch's point is refused with a toast. Selected points keep their crosses — the
 * selected tone against the hover one, the same green-vs-lime split the viewport's
 * selected-vs-highlight faces use — until toggled off or the handler is disposed.
 *
 * `selectedPoints` is the COMMAND's list, handed in so a re-entered step (a failed face
 * deduction asks for a face next) keeps what was picked; the handler mutates it in place.
 */
export class HoleCenterPickHandler extends ShapeSelectionHandler {
    /** The face a click captured — the step's "place the holes on this face" answer. */
    faceResult: PickedHoleFace | undefined;

    private _hovered: SketchPointGlyphHit | undefined;
    private _hoverMeshId: number | undefined;
    private _selectedMeshIds: number[] = [];

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly selectedPoints: SketchPointGlyphHit[],
    ) {
        super(
            document,
            ShapeTypes.face,
            false,
            controller,
            { allow: (shape) => (shape as IFace).surface().isPlanar() },
            { allow: (node) => node instanceof ParametricBodyNode },
        );
        this.highlightState = VisualStates.faceHighlight;
        const view = document.application.activeView;
        if (view !== undefined && this.selectedPoints.length > 0) this.rebuildSelectedMeshes(view);
    }

    protected override setHighlight(view: IView, event: PointerEvent): void {
        const hit = sketchPointGlyphAt(this.document, view, event.offsetX, event.offsetY);
        if (hit !== undefined) {
            // Drawing and picking stay in step: a glyph under the pointer wins over the face
            // behind it, so the face highlight has to come down (the datum picker's contract).
            this.cleanHighlights();
        } else {
            super.setHighlight(view, event);
        }
        this.setHoveredPoint(view, hit);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredPoint(view, undefined);
    }

    private setHoveredPoint(view: IView, hit: SketchPointGlyphHit | undefined): void {
        if (hit?.sketch === this._hovered?.sketch && hit?.entityId === this._hovered?.entityId) return;
        this._hovered = hit;
        if (this._hoverMeshId !== undefined) {
            this.document.visual.context.removeMesh(this._hoverMeshId);
            this._hoverMeshId = undefined;
        }
        if (hit !== undefined) {
            this._hoverMeshId = this.displayCross(view, hit, VisualConfig.highlightFaceColor);
        }
        view.update();
    }

    protected override select(view: IView, event: PointerEvent): number {
        const hit = sketchPointGlyphAt(this.document, view, event.offsetX, event.offsetY);
        if (hit !== undefined) {
            this.togglePoint(view, hit);
            return 0; // toggling never ends the step — Enter or the confirm bar does
        }
        const face = this._highlights?.[0];
        const body = face?.owner.node;
        if (face === undefined || !(body instanceof ParametricBodyNode)) return 0;
        this.faceResult = capturePickedHoleFace(body, face.shape as IFace, face.transform, face.indexes[0]);
        return 1;
    }

    private togglePoint(view: IView, hit: SketchPointGlyphHit): void {
        const index = this.selectedPoints.findIndex(
            (x) => x.sketch === hit.sketch && x.entityId === hit.entityId,
        );
        if (index >= 0) {
            this.selectedPoints.splice(index, 1);
        } else {
            const pinned = this.selectedPoints[0]?.sketch;
            if (pinned !== undefined && pinned !== hit.sketch) {
                PubSub.default.pub(
                    "showToast",
                    "error.default:{0}",
                    "Hole centers must come from one sketch",
                );
                return;
            }
            this.selectedPoints.push(hit);
        }
        this.rebuildSelectedMeshes(view);
    }

    private rebuildSelectedMeshes(view: IView): void {
        const context = this.document.visual.context;
        this._selectedMeshIds.forEach((id) => context.removeMesh(id));
        this._selectedMeshIds = this.selectedPoints.map((hit) =>
            this.displayCross(view, hit, VisualConfig.selectedEdgeColor),
        );
    }

    /**
     * A cross on the point's own sketch plane, on top like the datum quads: the sketch's own
     * cross sits at the same spot, and a pick affordance must not z-fight or hide behind the
     * geometry it floats over. `half` is the arm half-length in world units, measured off the
     * view so the cross reads at a constant pixel size.
     */
    private displayCross(view: IView, hit: SketchPointGlyphHit, color: number): number {
        const plane = hit.sketch.plane.transformed(hit.sketch.worldTransform());
        const half = (viewPixelSize(view, hit.world) ?? 0) * (VisualConfig.editVertexSize / 2);
        return this.document.visual.context.displayMesh(
            [pointCrossMesh(plane, toUV(plane, hit.world), half, color)],
            { onTop: true },
        );
    }

    protected override highlightNext(_view: IView): void {
        // no cycling: at most one face is highlighted, and the glyphs hit-test per move
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        const context = this.document.visual.context;
        if (this._hoverMeshId !== undefined) {
            context.removeMesh(this._hoverMeshId);
            this._hoverMeshId = undefined;
        }
        this._selectedMeshIds.forEach((id) => context.removeMesh(id));
        this._selectedMeshIds = [];
    }
}
