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
        this._highlighted = true;
        this.markBatchDirty();
    }

    unhighlight(): void {
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

/** The visual for an annotation node; kinds without one (text, infinite line) get undefined. */
export function createAnnotationVisual(
    context: ThreeVisualContext,
    annotation: Annotation,
): ThreeAnnotation | undefined {
    if (annotation instanceof DimensionAnnotation) {
        return new ThreeDimensionAnnotation(context, annotation);
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

export class ThreeDimensionAnnotation extends ThreeAnnotation implements IHighlightable {
    private readonly _handles: Points;
    private _selected = false;
    private _layoutValid = false;
    private _view?: IView;
    private _disposed = false;
    private _mirrored = false;
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

    // The layout size does not depend on the camera, but which side of the dimension
    // plane the camera sits on still decides whether the text needs its anti-mirror flip.
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

    /** Recomputes the anti-mirror state for `view` and requests a redraw. */
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
            if (mirrored !== this._mirrored) {
                this._mirrored = mirrored;
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
        // on; only the text flips to never read mirrored. Both bake the visual's
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
        const matrix = this.transform;
        for (let i = 0; i < laid.length; i += 2) {
            const local = this._anchor
                .add(this._direction.multiply(laid[i] * em * flip))
                .add(this._side.multiply(laid[i + 1] * em));
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
