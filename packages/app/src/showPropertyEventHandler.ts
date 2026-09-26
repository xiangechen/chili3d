// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    DimensionAnnotation,
    dimensionLayoutFor,
    type IDocument,
    type INode,
    type IView,
    type Matrix4,
    NodeSelectionHandler,
    ObjectSnap,
    Plane,
    PubSub,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type XYZ,
} from "@chili3d/core";

/** Screen-pixel radius around a grip point that grabs that point instead of the text. */
const GRIP_HIT_PX = 12;
/** Movement below this stays a click, so plain selection still works on annotations. */
const DRAG_START_PX = 3;

type DimensionGrip = "startPoint" | "endPoint" | "centerPoint" | "textPoint";

interface PendingDimensionDrag {
    readonly node: DimensionAnnotation;
    readonly grip: DimensionGrip;
    readonly plane: Plane;
    /** World-to-local of the annotation; drag points arrive in world space. */
    readonly inverse?: Matrix4;
}

interface ActiveDimensionDrag extends PendingDimensionDrag {
    readonly transaction: Transaction;
    /** Geometric feature snap for the measurement endpoints; the text point moves freely. */
    readonly objectSnap?: ObjectSnap;
}

export class ShowPropertyEventHandler extends NodeSelectionHandler {
    private _pendingDrag?: PendingDimensionDrag;
    private _drag?: ActiveDimensionDrag;

    constructor(document: IDocument) {
        super(document, true);
        document.selection.onNodeChanged.sub(this.handleSelectionChanged);
    }

    protected readonly handleSelectionChanged = (selected: INode[]) => {
        PubSub.default.pub("showProperties", this.document, selected);
    };

    override pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 0 && event.isPrimary) {
            this._pendingDrag = this.hitDimension(view, event);
            if (this._pendingDrag) {
                // Mirrors SelectionHandler.pointerDown minus the rectangle: dragging an
                // annotation must not start a rubber band.
                event.preventDefault();
                this.mouse = { isDown: true, x: event.offsetX, y: event.offsetY };
                this.pointerEventMap.set(event.pointerId, event);
                return;
            }
        }
        super.pointerDown(view, event);
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        if (this._pendingDrag && !this._drag && this.movedBeyond(DRAG_START_PX, event)) {
            const transaction = new Transaction(this.document, "drag annotation");
            transaction.start();
            const objectSnap = this._pendingDrag.grip === "textPoint" ? undefined : this.createObjectSnap();
            this._drag = { ...this._pendingDrag, transaction, objectSnap };
        }
        if (this._drag) {
            const point = this.dragPoint(view, this._drag, event);
            if (point !== undefined) {
                this._drag.node[this._drag.grip] = this._drag.inverse?.ofPoint(point) ?? point;
            }
            view.update();
            return;
        }
        super.pointerMove(view, event);
    }

    /** Where the dragged grip goes: a snapped feature point if one is near, else the drag plane. */
    private dragPoint(view: IView, drag: ActiveDimensionDrag, event: PointerEvent): XYZ | undefined {
        if (drag.objectSnap) {
            const shapes = view.detectShapes(
                (ShapeTypes.edge | ShapeTypes.vertex) as ShapeType,
                event.offsetX,
                event.offsetY,
            );
            const snaped = drag.objectSnap.snap({ view, mx: event.offsetX, my: event.offsetY, shapes });
            drag.objectSnap.handleSnaped?.(this.document, snaped);
            if (snaped?.point !== undefined) return snaped.point;
        }
        return drag.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
    }

    protected createObjectSnap(): ObjectSnap {
        return new ObjectSnap(Config.instance.snapType);
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        if (this._drag) {
            this.endDrag("commit");
            this.mouse.isDown = false;
            this.pointerEventMap.delete(event.pointerId);
            view.update();
            return;
        }
        this._pendingDrag = undefined;
        super.pointerUp(view, event);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        // The pointer left the canvas mid-drag: keep what was dragged so far.
        this.endDrag("commit");
        super.pointerOut(view, event);
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape" && this._drag) {
            this.endDrag("rollback");
            return;
        }
        super.keyDown(view, event);
    }

    override disposeInternal() {
        this.endDrag("rollback");
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        super.disposeInternal();
    }

    private endDrag(action: "commit" | "rollback") {
        const drag = this._drag;
        this._pendingDrag = undefined;
        this._drag = undefined;
        if (!drag) return;
        drag.objectSnap?.clear();
        if (action === "commit") {
            drag.transaction.commit();
        } else {
            drag.transaction.rollback();
        }
    }

    private movedBeyond(px: number, event: PointerEvent) {
        return Math.abs(event.offsetX - this.mouse.x) > px || Math.abs(event.offsetY - this.mouse.y) > px;
    }

    private hitDimension(view: IView, event: PointerEvent): PendingDimensionDrag | undefined {
        for (const visual of view.detectVisual(event.offsetX, event.offsetY)) {
            const node = view.document.visual.context.getNode(visual);
            if (node instanceof DimensionAnnotation) {
                const grip = this.nearestGrip(view, node, event);
                const drag = dimensionDragPlane(node, grip);
                return drag ? { node, grip, ...drag } : undefined;
            }
        }
        return undefined;
    }

    private nearestGrip(view: IView, node: DimensionAnnotation, event: PointerEvent): DimensionGrip {
        const world = node.worldTransform();
        let grip: DimensionGrip = "textPoint";
        let best = GRIP_HIT_PX;
        for (const candidate of ["startPoint", "endPoint", "centerPoint"] as const) {
            const point = node[candidate];
            if (point === undefined) continue; // only an angular dimension has a vertex grip
            const s = view.worldToScreen(world.ofPoint(point));
            const distance = Math.hypot(s.x - event.offsetX, s.y - event.offsetY);
            if (distance < best) {
                best = distance;
                grip = candidate;
            }
        }
        return grip;
    }
}

/**
 * The plane a grip moves in: the dimension's own plane (in world space), anchored at
 * the grip so the first drag frame does not jump. Undefined for a degenerate
 * (invisible) dimension. `inverse` maps world drag points back to annotation-local.
 */
function dimensionDragPlane(
    node: DimensionAnnotation,
    grip: DimensionGrip,
): { plane: Plane; inverse?: Matrix4 } | undefined {
    const world = node.worldTransform();
    const center = node.centerPoint;
    const planeNormal = node.planeNormal;
    const layout = dimensionLayoutFor(
        node.dimensionType,
        world.ofPoint(node.startPoint),
        world.ofPoint(node.endPoint),
        world.ofPoint(node.textPoint),
        1,
        center === undefined ? undefined : world.ofPoint(center),
        planeNormal === undefined ? undefined : world.ofVector(planeNormal).normalize(),
    );
    if (layout === undefined) return undefined;
    const origin = node[grip];
    if (origin === undefined) return undefined;
    return {
        plane: new Plane({
            origin: world.ofPoint(origin),
            normal: layout.normal,
            xvec: layout.direction,
        }),
        inverse: world.invert(),
    };
}
