// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IEdge,
    type IFace,
    type INode,
    type INodeVisual,
    type IShape,
    type IStep,
    type IView,
    LENGTH_UNITS,
    NOT_REFERENCE_GEOMETRY_FILTER,
    type Plane,
    Precision,
    PubSub,
    resolveUnitSpec,
    ShapeTypes,
    ShapeTypeUtils,
    type SnapResult,
    type VisualShapeData,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { ARROW_LENGTH, outwardNormalAt } from "./arrowHandle";
import { AxisDragHandler, type DragPreview } from "./axisDragHandler";
import { cornerPreview } from "./edgeCornerCommand";
import { ExtrudeFeatureCommand } from "./extrudeCommand";
import { dragPlaneOf, planeOfPickedFace } from "./extrudeDragStep";
import { cornerDragOf, cornerRebuilt } from "./modifyCornerCommand";
import { offsetPreview } from "./offsetFaceCommand";
import { prioritizeSketchFaces } from "./profileFaceSort";
import { SELECTED_FACE_STATE } from "./selectedFaceState";

/** Where the arrow stands and which way it points, in WORLD coordinates. */
export interface PressPullGrip {
    readonly origin: XYZ;
    readonly direction: XYZ;
}

/**
 * The whole Press Pull gesture, in ONE session: click faces or edges to pick them, watch the arrow
 * stand on the last one, drag the arrow for the distance, and confirm once.
 *
 * **Why it is one session and not a pick step followed by a drag step.** Every step of a
 * `MultistepCommand` settles on its own confirm, so picking a face and then dragging an arrow is
 * two confirms for one gesture. Extrude has the same shape and avoids it the same way: its drag
 * handler retargets the profile AND sets the depth, so the confirm it publishes is the only one.
 *
 * A positive distance is always "away from the material" — out along a face's outward normal, and
 * for an edge along its way out of the material (see `gripOf`). On an edge the SIGN is what picks
 * the result, out for a round and in for a chamfer. On a face the drag means whatever moving that
 * face means: an offset of it, or — when a fillet or chamfer FEATURE built it — that much more of
 * the feature's own size, which is what `facePreview` draws and what the hand-off is given.
 */
export class PressPullHandler extends AxisDragHandler {
    private _value: number;
    private _arrowHovered = false;
    /** What has been picked, in the order it was: the arrow stands on the last of them. */
    private readonly picked: VisualShapeData[] = [];
    private grip: PressPullGrip | undefined;
    private hovered: VisualShapeData | undefined;
    /** The body ghosted while the preview is up (see `syncGhost`). */
    private ghosted: INodeVisual | undefined;

    /**
     * Rebuilding the chain (or an offset, whose failure path bisects) on every pointer move
     * is the expensive half of the gesture; the arrow and the value box stay synchronous,
     * the preview trails by one debounce like Modify Corner's.
     */
    private readonly rebuildPreview = (view?: IView) => this.refreshPreviewNow(view);

    private refreshPreviewNow(view?: IView): void {
        if (this.cleaned) return;
        super.refreshTempShapes(view);
    }

    protected override refreshTempShapes(view?: IView): void {
        this.rebuildPreview(view);
    }

    constructor(
        document: IDocument,
        controller: AsyncController,
        startValue: number,
        private readonly onValue: (value: number) => void,
    ) {
        super(document, controller);
        this._value = startValue;
        this.start();
    }

    get pickedShapes(): readonly VisualShapeData[] {
        return this.picked;
    }

    get value(): number {
        return this._value;
    }

    /**
     * The axis the arrow stands on, as a plane through the grip — the gesture's own frame,
     * handed to the command with the distance so it can tell which way the drag went
     * (a sketch profile's extrusion decides its boolean operation from it).
     */
    get gripPlane(): Plane | undefined {
        const grip = this.grip;
        return grip === undefined ? undefined : dragPlaneOf(grip.origin, grip.direction);
    }

    /** Nothing picked yet means no axis to drag along; the arrow is drawn collapsed until then. */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        const grip = this.grip;
        return grip === undefined
            ? { origin: XYZ.zero, normal: XYZ.unitZ }
            : { origin: grip.origin, normal: grip.direction };
    }

    /** The shaft leaves the grip point by the current value; past zero the arrow turns around. */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        const grip = this.grip;
        if (grip === undefined) return { start: XYZ.zero, end: XYZ.zero };
        const start = grip.origin.add(grip.direction.multiply(this._value));
        const way = this._value < -Precision.Float ? grip.direction.multiply(-1) : grip.direction;
        return { start, end: start.add(way.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    protected override currentValue(): number {
        return this._value;
    }

    protected override setCurrentValue(value: number): void {
        this._value = value;
        this.onValue(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    /** A gesture with nothing picked, or with nothing to move, has nothing to hand over. */
    protected override canConfirm(): boolean {
        return this.picked.length > 0 && Math.abs(this._value) > Precision.Float;
    }

    /**
     * Confirm with nothing picked ends the command. There is no result to hand over, and the
     * confirm button is shown regardless of the pick — leaving it inert reads as a broken
     * button; the empty Enter that finishes a command is the convention.
     */
    protected override confirm(): void {
        if (this.picked.length === 0) {
            this.controller.cancel();
            return;
        }
        super.confirm();
    }

    /** What the picks would become at the current value, built by the command that will be opened. */
    protected override buildPreview(): DragPreview {
        const meshes = this.previewMeshes();
        return { meshes: meshes ?? [] };
    }

    protected override onHover(view: IView, event: PointerEvent): void {
        if (this.arrowLength === undefined) this.refreshArrow(view);
        if (this.isOverArrow(view, event)) {
            this.clearHover();
            this.setArrowHover(view, true);
            return;
        }
        this.setArrowHover(view, false);

        const shape = this.detect(view, event);
        if (shape === this.hovered) return;
        this.clearHover();
        this.hovered = shape;
        if (shape !== undefined) {
            this.document.visual.highlighter.addState(
                shape.owner,
                VisualStates.faceHighlight,
                shape.shape.shapeType,
                ...shape.indexes,
            );
        }
        view.update();
    }

    /**
     * Ghosts the body being changed. The preview IS that body moved, so drawn together the two
     * overlap over the very faces the user is looking at and the result reads as a ghost over the
     * geometry it replaces — which is why the command this opens ghosts its body the same way.
     *
     * Whole-visual state, as a boolean preview's `hide` is: the picked faces keep their own
     * highlight because the tint is a material the geometry underneath does not lose.
     */
    private syncGhost(): void {
        const owner = this.picked.at(-1)?.owner;
        if (owner === this.ghosted) return;
        this.ghosted = undefined;
        if (owner !== undefined) {
            this.document.visual.highlighter.addState(owner, VisualStates.faceTransparent, ShapeTypes.shape);
            this.ghosted = owner;
        }
    }

    private clearGhost(): void {
        if (this.ghosted === undefined) return;
        this.document.visual.highlighter.removeState(
            this.ghosted,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        this.ghosted = undefined;
    }

    protected override onCleanup(): void {
        this.clearGhost();
    }

    protected override clearHover(): void {
        if (this.hovered === undefined) return;
        this.document.visual.highlighter.removeState(
            this.hovered.owner,
            VisualStates.faceHighlight,
            this.hovered.shape.shapeType,
            ...this.hovered.indexes,
        );
        this.hovered = undefined;
    }

    protected override onClick(view: IView, event: PointerEvent): void {
        const shape = this.detect(view, event);
        if (shape === undefined) return;
        const at = this.picked.findIndex((x) => PressPullHandler.same(x, shape));
        if (at >= 0) {
            this.picked.splice(at, 1);
        } else if (!this.admit(shape)) {
            return;
        } else {
            this.picked.push(shape);
        }

        // The arrow follows the pick most recently added — the one the hand just went to — and
        // falls back to the new last one when that pick was taken away.
        this.grip = gripOf(this.picked.at(-1));
        this.syncGhost();
        this.refreshTempShapes(view);
        this.document.selection.setSelectedShapes([...this.picked], SELECTED_FACE_STATE, false);
        view.document.visual.update();
    }

    /**
     * Whether `shape` may join the pick. One KIND at a time, however many of them: a face's
     * distance is how far it moves, an edge's same distance means a round or a chamfer, and a set
     * holding both has no one thing to do with it. One body too — the command that will be opened
     * works on one.
     */
    private admit(shape: VisualShapeData): boolean {
        const first = this.picked[0];
        if (first === undefined) return true;
        if (first.owner.node !== shape.owner.node || first.shape.shapeType !== shape.shape.shapeType) {
            PubSub.default.pub("showToast", "prompt.pressPullOneKind");
            return false;
        }
        return true;
    }

    /**
     * What the pointer may take. A body answers with its faces AND its edges — one distance is
     * either "move this face" or "round or chamfer this edge" — while a sketch answers with its
     * PROFILES alone: a sketch's edges are the lines that draw those profiles, and pushing one is
     * not a thing (the edge branch would open a Fillet on a sketch line).
     */
    private detect(view: IView, event: PointerEvent): VisualShapeData | undefined {
        const detected = view.detectShapes(
            (ShapeTypes.face | ShapeTypes.edge) as typeof ShapeTypes.face,
            event.offsetX,
            event.offsetY,
            undefined,
            NOT_REFERENCE_GEOMETRY_FILTER,
        );
        // A sketch drawn ON a solid face is coplanar with it, so the raycast hits both and the
        // order they come back in flips with the smallest pointer movement. The sketch is what
        // the user put there, so it is what the pointer takes (`prioritizeSketchFaces`).
        return prioritizeSketchFaces(detected).find((x) => PressPullHandler.pickable(x));
    }

    /** Whether pushing `shape` means anything — see `detect` for what each kind of node offers. */
    private static pickable(shape: VisualShapeData): boolean {
        const node = shape.owner.node;
        if (node instanceof SketchNode) return ShapeTypeUtils.hasFace(shape.shape.shapeType);
        return node instanceof ParametricBodyNode;
    }

    private static same(a: VisualShapeData, b: VisualShapeData): boolean {
        return a.owner === b.owner && a.shape.isSame(b.shape);
    }

    private previewMeshes() {
        const last = this.picked.at(-1);
        if (last === undefined) return undefined;
        const world = ShapeTypeUtils.hasFace(last.shape.shapeType)
            ? this.facePreview(last)
            : cornerPreview(
                  last.owner.node,
                  this.picked,
                  Math.abs(this._value),
                  this._value < 0 ? "chamfer" : "fillet",
              );
        if (world === undefined) return undefined;

        const { faces, edges } = world.mesh;
        world.dispose();
        if (faces === undefined) return undefined;
        return [faces, edges].filter((x) => x !== undefined);
    }

    /**
     * A picked face's preview, which is whatever dragging that face means:
     *
     * - a sketch profile is EXTRUDED — the prism this drag would make, which is what the hand-off
     *   builds (a lone profile face is not part of a solid for an offset to move, and an offset of
     *   one shows nothing at all, which is what a drag on a profile used to show);
     * - a corner feature's surface is that feature rebuilt at the size the drag asks for (see
     *   `cornerDragOf`), which is what the hand-off writes;
     * - anything else is an offset of the face itself.
     *
     * A corner face the drag cannot be expressed on — a chamfer in one of its asymmetric modes,
     * whose flat's plane is fixed by both parameters at once (see `cornerDragOf`) — previews
     * NOTHING rather than an offset the confirm would not produce: there the drag is only a grab,
     * and the command it opens asks for the size on the feature's own terms.
     */
    private facePreview(picked: VisualShapeData): IShape | undefined {
        if (picked.owner.node instanceof SketchNode) {
            return ExtrudeFeatureCommand.extrudePreview(this.picked, this._value);
        }
        const drag = cornerDragOf(picked, this._value, (value) => {
            const scope = this.document.variables.evaluate().scope;
            const resolved = resolveUnitSpec(value, scope, LENGTH_UNITS);
            return resolved.isOk ? resolved.value : undefined;
        });
        if (drag === undefined) return offsetPreview(picked.owner.node, this.picked, this._value, true);

        const body = picked.owner.node;
        if (drag.size === undefined || !(body instanceof ParametricBodyNode)) return undefined;
        return cornerRebuilt(body, drag.feature, drag.size, picked.transform);
    }
}

/**
 * The step that runs that gesture and settles with what was picked and the distance the arrow was
 * dragged to — which the command then hands to the command it opens.
 *
 * It also publishes the handler it made (`onReady`) and takes it back when the gesture ends
 * (`onDone`): the arrow and the options tab are two views of ONE value, and the tab has no other
 * way to reach the drag it is showing. The callbacks are optional because the step is usable
 * without a panel to sync.
 */
export class PressPullStep implements IStep {
    constructor(
        private readonly startValue: () => number,
        private readonly onValue: (value: number) => void,
        private readonly onReady: (handler: PressPullHandler) => void = () => {},
        private readonly onDone: () => void = () => {},
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const handler = new PressPullHandler(document, controller, this.startValue(), this.onValue);
        this.onReady(handler);
        try {
            // The SELECTION cursor, not the drawing one: this gesture is picking shapes off a body
            // (the arrow it also draws is a handle, not a tool), and a crosshair reads as "sketch a
            // new entity" — which is what the same cursor means everywhere else in the app.
            await document.picker.pickAsync(
                handler,
                "prompt.pressPull",
                controller,
                "none",
                "select.default",
            );
        } finally {
            // Always first: the handler's cleanup is what puts the arrow and the highlights away.
            handler.dispose();
            this.onDone();
        }
        if (controller.result?.status !== "success") return undefined;
        const picked = handler.pickedShapes;
        if (picked.length === 0) return undefined;

        return {
            view: document.application.activeView!,
            type: "input",
            point: handler.pickedShapes[0]?.point,
            plane: handler.gripPlane,
            distance: handler.value,
            shapes: [...picked],
            nodes: [picked[0].owner.node as any],
        };
    }
}

/**
 * Where the arrow stands for this shape, in world coordinates — undefined for one it cannot be
 * dragged along, and then the arrow is not drawn at all.
 */
export function gripOf(picked: VisualShapeData | undefined): PressPullGrip | undefined {
    if (picked === undefined) return undefined;
    const type = picked.shape.shapeType;
    if (ShapeTypeUtils.hasFace(type)) {
        // A face has a normal of its own: the plane through the pick, out along it. The arrow
        // starts where the pointer landed, falling back to the plane's own point when a pick
        // carries none.
        const plane = planeOfPickedFace(picked);
        return { origin: picked.point ?? plane.origin, direction: plane.normal };
    }
    if (ShapeTypeUtils.hasEdge(type)) return edgeGrip(picked);
    return undefined;
}

/**
 * An edge has no normal — what it has is the two faces that meet along it, and the way out of the
 * material is the sum of their outward normals.
 */
function edgeGrip(picked: VisualShapeData): PressPullGrip | undefined {
    const edge = picked.shape as IEdge;
    const body = bodyShapeOf(picked.owner.node);
    if (body === undefined) return undefined;
    const middle = edge.pointAt((edge.firstParameter() + edge.lastParameter()) / 2);
    const normals = facesAround(body, edge)
        .map((face) => outwardNormalAt(face, middle))
        .filter((normal): normal is XYZ => normal !== undefined);
    if (normals.length !== 2) return undefined;
    const away = normals[0].add(normals[1]).normalize();
    const direction = away === undefined ? undefined : picked.transform.ofVector(away).normalize();
    if (direction === undefined) return undefined;
    return { origin: picked.transform.ofPoint(middle), direction };
}

/** The two faces meeting at `edge`, found by identity — the kernel's own adjacency is C++-side. */
function facesAround(body: IShape, edge: IEdge): IFace[] {
    return (body.findSubShapes(ShapeTypes.face) as IFace[]).filter((face) =>
        (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((x) => x.isSame(edge)),
    );
}

function bodyShapeOf(node: INode): IShape | undefined {
    if (!(node instanceof ParametricBodyNode)) return undefined;
    return node.shape.isOk ? node.shape.value : undefined;
}
