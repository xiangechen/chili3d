// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Annotation,
    type BoundingBox,
    DimensionAnnotation,
    debounce,
    defaultFontService,
    dimensionLayoutFor,
    dimensionLayoutScale,
    type INode,
    type IView,
    type IVisualObject,
    type Matrix4,
    RefSegmentAnnotation,
    TextAnnotation,
    ViewUtils,
    XYZ,
} from "@chili3d/core";
import { BufferGeometry, type Mesh, Object3D, Points, PointsMaterial } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { AnnotationBatch, IBatchedAnnotation } from "./annotationBatch";
import { Constants } from "./constants";
import type { IHighlightable } from "./highlightable";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";

const HIGHLIGHT_COLOR = 0x00ffff;
/** Grip-dot diameter in screen pixels (sizeAttenuation is off, so this never scales). */
const HANDLE_SIZE_PX = 7;

/**
 * Shared plumbing of the annotation visuals. An annotation draws nothing of its
 * own: it writes its geometry — points local to the node, with `transform`
 * baked in — into the `AnnotationBatch` of whichever parent it is added to, and
 * keeps only its grip dots as children. The Object3D matrix still mirrors the
 * node's transform, because `worldTransform()` feeds the anti-mirror test.
 */
export abstract class ThreeAnnotation extends Object3D implements IVisualObject, IBatchedAnnotation {
    locked: boolean = false;
    abstract readonly annotation: Annotation;
    private _batch?: AnnotationBatch;
    private _highlighted = false;

    get transform() {
        return ThreeHelper.toMatrix(this.matrix);
    }
    set transform(value: Matrix4) {
        this.matrix.fromArray(value.toArray());
        this.updateWorldMatrix(true, false);
        this.markBatchDirty();
    }

    constructor(protected context: ThreeVisualContext) {
        super();
        this.matrixAutoUpdate = false;
        this.addEventListener("added", this.handleAddedToParent);
        this.addEventListener("removed", this.handleRemovedFromParent);
    }

    get batch(): AnnotationBatch | undefined {
        return this._batch;
    }

    get batchVisible(): boolean {
        return this.annotation.visible && this.annotation.parentVisible;
    }

    get batchColor(): number {
        return this._highlighted ? HIGHLIGHT_COLOR : this.annotation.color;
    }

    buildLineSegments(_target: number[]): void {}
    buildTriangles(_target: number[]): void {}

    worldTransform(): Matrix4 {
        this.updateWorldMatrix(true, false);
        return ThreeHelper.toMatrix(this.matrixWorld);
    }

    boundingBox(): BoundingBox | undefined {
        return this.annotation.boundingBox();
    }

    highlight(): void {
        // A batch rebuild redraws every annotation of the parent — skip no-op transitions.
        if (this._highlighted) return;
        this._highlighted = true;
        this.markBatchDirty();
    }

    unhighlight(): void {
        if (!this._highlighted) return;
        this._highlighted = false;
        this.markBatchDirty();
    }

    markBatchDirty(): void {
        this._batch?.markDirty();
    }

    /** Push `local` flat xyz triples transformed into the batch's parent space. */
    protected pushTransformed(target: number[], local: number[]): void {
        // The visual's own matrix, not `annotation.transform`: a component member's
        // matrix accumulates the transforms of the (possibly nested) component path.
        const matrix = this.transform;
        for (let i = 0; i + 2 < local.length; i += 3) {
            const point = matrix.ofPoint(new XYZ(local[i], local[i + 1], local[i + 2]));
            target.push(point.x, point.y, point.z);
        }
    }

    private readonly handleAddedToParent = () => {
        if (this.parent === null) return;
        this._batch = this.context.batchFor(this.parent);
        this._batch.register(this);
    };

    private readonly handleRemovedFromParent = () => {
        this._batch?.unregister(this);
        this._batch = undefined;
    };

    abstract wholeVisual(): (Mesh | LineSegments2 | Points)[];

    dispose(): void {
        this.handleRemovedFromParent();
        this.removeEventListener("added", this.handleAddedToParent);
        this.removeEventListener("removed", this.handleRemovedFromParent);
    }
}

/** The visual for an annotation node; kinds without one (infinite line) get undefined. */
export function createAnnotationVisual(
    context: ThreeVisualContext,
    annotation: Annotation,
): ThreeAnnotation | undefined {
    if (annotation instanceof DimensionAnnotation) {
        return new ThreeDimensionAnnotation(context, annotation);
    }
    if (annotation instanceof TextAnnotation) {
        return new ThreeTextAnnotation(context, annotation);
    }
    if (annotation instanceof RefSegmentAnnotation) {
        return new ThreeRefSegmentAnnotation(context, annotation);
    }
    return undefined;
}

export class ThreeRefSegmentAnnotation extends ThreeAnnotation implements IHighlightable {
    constructor(
        context: ThreeVisualContext,
        readonly annotation: RefSegmentAnnotation,
    ) {
        super(context);
        this.transform = annotation.transform;
        annotation.onPropertyChanged(this.handlePropertyChanged);
    }

    private readonly handlePropertyChanged = (property: keyof RefSegmentAnnotation) => {
        if (property === "transform") {
            this.transform = this.annotation.transform;
        } else {
            this.markBatchDirty();
        }
    };

    override buildLineSegments(target: number[]): void {
        const { startPoint, endPoint } = this.annotation;
        this.pushTransformed(target, [
            startPoint.x,
            startPoint.y,
            startPoint.z,
            endPoint.x,
            endPoint.y,
            endPoint.z,
        ]);
    }

    wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [];
    }

    override dispose(): void {
        super.dispose();
        this.annotation.removePropertyChanged(this.handlePropertyChanged);
    }
}

/** How far the leader stops short of the text, in text heights. */
const LEADER_GAP_EM = 0.25;

/** The frame a note draws in before any view is known: the world XY plane. */
const PLANAR_FRAME = { x: XYZ.unitX, y: XYZ.unitY };

/**
 * The frame a note's text is drawn in: facing the camera and reading left to right, so it
 * is legible from wherever the user looks at it. A dimension's text lies in the plane it
 * measures, which is right for a mark on the model; a note is read, not measured, and the
 * troika text it replaces faced the camera too.
 */
function billboardFrame(view: IView): { x: XYZ; y: XYZ } {
    const normal = view.direction().reverse().normalize();
    if (normal === undefined) return PLANAR_FRAME;
    // the camera's up, projected into the plane facing it
    const up = view
        .up()
        .sub(normal.multiply(view.up().dot(normal)))
        .normalize();
    if (up === undefined) return PLANAR_FRAME;
    return { x: up.cross(normal).normalize() ?? PLANAR_FRAME.x, y: up };
}

/**
 * A note: mesh text at its position, and the leader from there back to what it is about.
 * The text follows the camera (see `billboardFrame`), so the batch is rebuilt when the
 * view turns; the leader is anchored in space and never moves.
 */
export class ThreeTextAnnotation extends ThreeAnnotation implements IHighlightable {
    private _frame = PLANAR_FRAME;
    private _view?: IView;
    private _disposed = false;

    constructor(
        context: ThreeVisualContext,
        readonly annotation: TextAnnotation,
    ) {
        super(context);
        this.transform = annotation.transform;
        annotation.onPropertyChanged(this.handleAnnotationChanged);
        defaultFontService.ensureLoaded();
        defaultFontService.onLoaded(this.handleFontLoaded);
        // On document reload the view is registered after the visuals are created;
        // pick it up as soon as it arrives, or the text keeps the fallback frame.
        annotation.document.application?.views?.onCollectionChanged?.(this.handleViewsChanged);
        this.refreshView();
    }

    private readonly handleViewsChanged = () => this.refreshView();

    private readonly handleFontLoaded = () => this.markBatchDirty();

    private readonly handleAnnotationChanged = (property: keyof TextAnnotation) => {
        if (property === "transform") {
            this.transform = this.annotation.transform;
        }
        this.markBatchDirty();
        this.context.visual.update();
    };

    private readonly onCameraChanged = debounce(() => {
        const view = this.view();
        if (view) this.updateForView(view);
    }, 20);

    /** The (single) view displaying this annotation's document; subscribes on first use. */
    private view(): IView | undefined {
        if (this._view?.isClosed) {
            this._view.cameraController.removePropertyChanged?.(this.onCameraChanged);
            this._view = undefined;
        }
        if (this._view !== undefined) return this._view;
        const document = this.context.visual.document;
        this._view = document?.application?.views?.find((v) => v.document === document && !v.isClosed);
        this._view?.cameraController.onPropertyChanged?.(this.onCameraChanged);
        return this._view;
    }

    private refreshView(): void {
        const view = this.view();
        if (view) this.updateForView(view);
        else this.context.visual.update();
    }

    /** Re-frames the text for `view`; only a turn of the camera changes anything. */
    updateForView(view: IView): void {
        if (this._disposed || view.isClosed) return;
        const frame = billboardFrame(view);
        // a fraction of a degree is below what the text can show, and rebuilding the
        // batch on every camera nudge would redraw every annotation in the document.
        // Signed dots: a jump to the opposite side flips the frame's x axis, and keeping
        // the old frame would draw the text mirrored for the now-facing camera.
        if (frame.x.dot(this._frame.x) > 1 - 1e-6 && frame.y.dot(this._frame.y) > 1 - 1e-6) return;
        this._frame = frame;
        this.markBatchDirty();
        this.context.visual.update();
    }

    override buildLineSegments(target: number[]): void {
        const { leaderPoint, position } = this.annotation;
        if (leaderPoint === undefined) return;
        const dir = position.sub(leaderPoint).normalize();
        if (dir === undefined) return;
        // stop short of the text, whose left edge sits on `position`
        const end = position.sub(dir.multiply(this.annotation.textHeight * LEADER_GAP_EM));
        this.pushTransformed(target, [leaderPoint.x, leaderPoint.y, leaderPoint.z, end.x, end.y, end.z]);
    }

    override buildTriangles(target: number[]): void {
        // nothing to draw before the font arrives; `handleFontLoaded` rebuilds when it does
        if (defaultFontService.outline === undefined) return;
        const laid = defaultFontService.layout(this.annotation.content);
        // The frame is a world-space billboard (from the view); bring it into the
        // annotation's local space, or a rotated/mirrored/instanced transform applies
        // it a second time and drags the text out of the plane facing the camera.
        const inverse = this.worldTransform().invert();
        const x = inverse?.ofVector(this._frame.x) ?? this._frame.x;
        const y = inverse?.ofVector(this._frame.y) ?? this._frame.y;
        const em = this.annotation.textHeight;
        // the layout centres the line on the origin; a note reads from the leader's end,
        // so the line starts there instead
        let left = Number.POSITIVE_INFINITY;
        for (let i = 0; i < laid.length; i += 2) left = Math.min(left, laid[i]);
        const shift = Number.isFinite(left) ? -left : 0;

        const matrix = this.transform;
        for (let i = 0; i < laid.length; i += 2) {
            const local = this.annotation.position
                .add(x.multiply((laid[i] + shift) * em))
                .add(y.multiply(laid[i + 1] * em));
            const point = matrix.ofPoint(local);
            target.push(point.x, point.y, point.z);
        }
    }

    wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [];
    }

    override dispose(): void {
        this._disposed = true;
        this._view?.cameraController.removePropertyChanged?.(this.onCameraChanged);
        this.annotation.removePropertyChanged(this.handleAnnotationChanged);
        this.annotation.document.application?.views?.removeCollectionChanged?.(this.handleViewsChanged);
        defaultFontService.removeLoaded(this.handleFontLoaded);
        super.dispose();
    }
}

export class ThreeDimensionAnnotation extends ThreeAnnotation implements IHighlightable {
    private readonly _handles: Points;
    private _selected = false;
    private _layoutValid = false;
    private _view?: IView;
    private _disposed = false;
    private _mirrored = false;
    private _flipped = false;
    private _segments: number[] = [];
    private _triangles: number[] = [];
    private _anchor = XYZ.zero;
    private _direction = XYZ.unitX;
    private _side = XYZ.unitY;
    private _normal = XYZ.unitZ;

    constructor(
        context: ThreeVisualContext,
        readonly annotation: DimensionAnnotation,
    ) {
        super(context);
        this._handles = this.createHandles();
        this.add(this._handles);

        defaultFontService.ensureLoaded();
        defaultFontService.onLoaded(this.handleFontLoaded);
        this.rebuild();
        this.transform = annotation.transform;
        annotation.onPropertyChanged(this.handleAnnotationChanged);
        this._selected = this.isSelected();
        this.syncHandlesVisible();
        annotation.document.selection?.onNodeChanged?.sub(this.handleSelectionChanged);
        // On document reload the view is registered after the visuals are created;
        // pick it up as soon as it arrives.
        annotation.document.application?.views?.onCollectionChanged?.(this.handleViewsChanged);
        this.refreshView();
    }

    override get batchVisible(): boolean {
        return super.batchVisible && this._layoutValid;
    }

    // Drag grips at start/end/text, shown while the annotation is selected. They
    // draw through the model and stay a constant pixel size.
    private createHandles() {
        const handles = new Points(
            new BufferGeometry(),
            new PointsMaterial({
                color: this.annotation.color,
                size: HANDLE_SIZE_PX,
                sizeAttenuation: false,
                depthTest: false,
            }),
        );
        handles.visible = false;
        handles.layers.enable(Constants.Layers.Wireframe);
        handles.layers.enable(Constants.Layers.Solid);
        return handles;
    }

    private readonly handleFontLoaded = () => this.markBatchDirty();

    /** Re-orients the text for the current view (if any) and requests a redraw. */
    private refreshView() {
        const view = this.view();
        if (view) {
            this.updateForView(view);
        } else {
            this.context.visual.update();
        }
    }

    private readonly handleViewsChanged = () => this.refreshView();

    private isSelected() {
        return this.annotation.document.selection?.getSelectedNodes?.().includes(this.annotation) ?? false;
    }

    private readonly handleSelectionChanged = (selected: INode[]) => {
        this._selected = selected.includes(this.annotation);
        this.syncHandlesVisible();
        this.context.visual.update();
    };

    private syncHandlesVisible() {
        this._handles.visible = this._selected && this._layoutValid;
    }

    private readonly handleAnnotationChanged = (property: keyof DimensionAnnotation) => {
        // "transform" only re-places the slices; the local layout stays as built.
        if (property === "transform") {
            this.transform = this.annotation.transform;
        } else {
            this.rebuild();
        }
        this.refreshView();
    };

    // The layout size does not depend on the camera, but the camera still decides the
    // text's anti-mirror flip and the readability turn for a cross-line text point.
    private readonly onCameraChanged = debounce(() => {
        const view = this.view();
        if (view) this.updateForView(view);
    }, 20);

    /** The (single) view displaying this annotation's document; subscribes on first use. */
    private view(): IView | undefined {
        if (this._view?.isClosed) {
            // A closed view never comes back: forget it so a later view of the
            // same document gets picked up.
            this._view.cameraController.removePropertyChanged?.(this.onCameraChanged);
            this._view = undefined;
        }
        if (this._view !== undefined) return this._view;
        const document = this.context.visual.document;
        this._view = document?.application?.views?.find((v) => v.document === document && !v.isClosed);
        this._view?.cameraController.onPropertyChanged?.(this.onCameraChanged);
        return this._view;
    }

    /** Recomputes the view-dependent text state (anti-mirror and readability turn) for `view`. */
    updateForView(view: IView): void {
        if (this._disposed || view.isClosed) return;
        if (this._layoutValid) {
            // The text lies in the dimension plane with its baseline along the
            // dimension line; seen from behind the plane it flips around its up
            // axis, so it never reads mirrored. The mirror test happens in world
            // space — the annotation's own transform (and a component instance's)
            // rotates the local plane.
            const world = this.worldTransform();
            const anchor = world.ofPoint(this._anchor);
            const toCamera = ViewUtils.directionAt(view, anchor).reverse();
            const normal = world.ofVector(this._normal);
            const mirrored = normal.dot(toCamera) < 0;
            // A text point dropped across the measured line reverses the layout's up
            // axis, leaving the text upside down on screen. Turning the text frame
            // half a turn (direction and up together) keeps it upright — a rotation,
            // not a mirror like the flip above.
            const flipped = world.ofVector(this._side).dot(view.up()) < 0;
            if (mirrored !== this._mirrored || flipped !== this._flipped) {
                this._mirrored = mirrored;
                this._flipped = flipped;
                this.markBatchDirty();
            }
        }
        view.update();
    }

    private rebuild() {
        const scale = dimensionLayoutScale(this.annotation.textHeight);
        const layout = dimensionLayoutFor(
            this.annotation.dimensionType,
            this.annotation.startPoint,
            this.annotation.endPoint,
            this.annotation.textPoint,
            scale,
            this.annotation.centerPoint,
            this.annotation.planeNormal,
        );
        if (layout === undefined) {
            this._layoutValid = false;
            this._segments = [];
            this._triangles = [];
            this.syncHandlesVisible();
            this.markBatchDirty();
            return;
        }
        this._layoutValid = true;
        this._segments = layout.segments;
        this._triangles = layout.triangles;
        this._direction = layout.direction;
        this._side = layout.side;
        this._normal = layout.normal;
        this._anchor = layout.textPosition;

        // Drag grips at the attachment points — an angular dimension also has its vertex.
        const grips = [this.annotation.startPoint, this.annotation.endPoint];
        if (this.annotation.centerPoint !== undefined) grips.push(this.annotation.centerPoint);
        grips.push(this.annotation.textPoint);
        this._handles.geometry.setFromPoints(grips.map(ThreeHelper.fromXYZ));
        this.syncHandlesVisible();
        this.markBatchDirty();
    }

    override buildLineSegments(target: number[]): void {
        this.pushTransformed(target, this._segments);
    }

    override buildTriangles(target: number[]): void {
        // The arrowheads keep their world orientation whatever side the camera is
        // on; only the text flips to never read mirrored, and turns half a turn when
        // a cross-line text point would leave it upside down. Both bake the visual's
        // own matrix — it accumulates a (possibly nested) component path, which
        // `annotation.transform` alone would drop.
        this.pushTransformed(target, this._triangles);
        // nothing to draw before the font arrives; `handleFontLoaded` rebuilds when it does
        if (defaultFontService.outline === undefined) return;
        const laid = defaultFontService.layout(this.annotation.formattedValue());
        // One em is the text height in world units — the fixed world size the
        // troika text had through fontSize × DIMENSION_LAYOUT_SCALE.
        const em = this.annotation.textHeight;
        const flip = this._mirrored ? -1 : 1;
        const turn = this._flipped ? -1 : 1;
        const matrix = this.transform;
        for (let i = 0; i < laid.length; i += 2) {
            const local = this._anchor
                .add(this._direction.multiply(laid[i] * em * flip * turn))
                .add(this._side.multiply(laid[i + 1] * em * turn));
            const point = matrix.ofPoint(local);
            target.push(point.x, point.y, point.z);
        }
    }

    override highlight(): void {
        super.highlight();
        (this._handles.material as PointsMaterial).color.setHex(HIGHLIGHT_COLOR);
    }

    override unhighlight(): void {
        super.unhighlight();
        (this._handles.material as PointsMaterial).color.setHex(this.annotation.color);
    }

    wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [this._handles];
    }

    override dispose(): void {
        this._disposed = true;
        super.dispose();
        this._view?.cameraController.removePropertyChanged?.(this.onCameraChanged);
        this.annotation.removePropertyChanged(this.handleAnnotationChanged);
        this.annotation.document.selection?.onNodeChanged?.remove(this.handleSelectionChanged);
        this.annotation.document.application?.views?.removeCollectionChanged?.(this.handleViewsChanged);
        defaultFontService.removeLoaded(this.handleFontLoaded);
        this._handles.geometry.dispose();
        (this._handles.material as PointsMaterial).dispose();
    }
}
