// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type EdgeMeshData,
    type IDisposable,
    type IEventHandler,
    type IView,
    MeshDataUtils,
    Precision,
    type ShapeMeshData,
    VisualConfig,
    XY,
    XYZ,
} from "@chili3d/core";
import {
    applyDragAutoConstraints,
    type DragSnap,
    dragSnapPosition,
    snapConstraintKind,
    snapTargetEntityId,
} from "../autoConstraints";
import type { CurvePiece } from "../curveGeometry";
import type { SketchCurvePreview } from "../previewTypes";
import {
    arcAngles,
    ConstraintKind,
    entityPointCount,
    isDatumEntityId,
    originRef,
    SKETCH_EDGE_LINE_WIDTH,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    sketchConstraintColor,
    toUV,
    toWorld,
    viewPixelSize,
} from "../sketchModel";
import { constraintTargetEntities } from "../solverEntities";
import { applyConstraintIcon, type BadgeSymbol, badgeSymbol, isBadgeEventTarget } from "./sketchAnnotations";
import style from "./sketchAnnotations.module.css";
import type { SketchActivePick, SketchEditor, SketchEntityTypeFilter } from "./sketchEditor";

const PICK_TOLERANCE_PX = 8;
const CIRCLE_SEGMENTS = 64;
const DATUM_X_AXIS_COLOR = 0xcc5555;
const DATUM_Y_AXIS_COLOR = 0x55aa55;
/** External references (edges of another part): SolidWorks-style purple. */
const EXTERNAL_REF_COLOR = 0x9b59b6;
/** External references whose source edge no longer resolves. */
const EXTERNAL_DANGLING_COLOR = 0xdd4444;
/** Construction entities (reference geometry of the sketch itself): a muted steel blue. */
const CONSTRUCTION_COLOR = 0x6c8ebf;
/** Live-snap target accent — distinct from the green hover/selection and blue dimensions. */
const SNAP_HIGHLIGHT_COLOR = 0xff9800;
/** Rubber-band box outline — matches the selection highlight its release produces. */
const BOX_SELECT_COLOR = VisualConfig.selectedEdgeColor;
/**
 * The piece a trim would remove, in the tone the editor already flags a broken
 * constraint with: "this is about to go" reads like "this is wrong". Heavier than the
 * entity it is cut out of, so it reads as an overlay rather than as hover feedback.
 */
const TRIM_PREVIEW_COLOR = 0xff6b6b;
/**
 * The span an extend would add: cyan, the one hue the sketch's other cues leave free —
 * not the highlight green the entity under the cursor already wears, not the dimension
 * blue. Dashed as well (see `piecePreviewLineType`), because none of it is on the sketch.
 */
const EXTEND_PREVIEW_COLOR = 0x00c8ff;
/** Where a break would cut: the point marker's own grey, so it reads as a vertex, not as geometry. */
const BREAK_MARKER_COLOR = 0x8c9aa8;
/** Preview overlays are drawn heavier than the geometry they sit over. */
const PREVIEW_LINE_WIDTH = 3;
/**
 * Where a picked line would leave a mirrored copy — the trim's own tone, for the same
 * reason: the copy is not on the sketch yet, so the preview is the only thing telling
 * the user where it lands. Dashed, so a copy landing on top of real geometry still
 * reads as a proposal rather than as geometry already there.
 */
const MIRROR_PREVIEW_COLOR = 0xff6b6b;
const MIRROR_PREVIEW_LINE_WIDTH = 3;
/** A drag shorter than this in both axes reads as a click, not a box. */
const BOX_MIN_PX = 4;

/**
 * What hover should light up: the shape(s) to draw, and the key that says they are already
 * up (an unchanged key skips the redraw, so two different targets must never share one).
 */
interface HoverTarget {
    key?: string;
    mesh?: ShapeMeshData;
    meshes?: ShapeMeshData[];
}

/** Screen-space rectangle, normalized so min ≤ max on both axes. */
interface ScreenRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Viewport event handler active while a sketch is being edited:
 * point dragging with live preview, entity hover highlight and click
 * selection (hovered and selected entities both reveal their constraint
 * symbols), and delegation to the editor's pending pick request.
 */
export class SketchEventHandler implements IEventHandler {
    isEnabled: boolean = true;

    private draggingRef?: SketchPointRef;
    private dragPreviewId?: number;
    private hoverMeshId?: number;
    private hoverKey?: string;
    private readonly selectedEntities = new Set<number>();
    private selectionMeshId?: number;
    private constraintMeshId?: number;
    private datumDisplayId?: number;
    private externalDisplayId?: number;
    private constructionDisplayId?: number;
    private pointDisplayId?: number;
    private snapTargetMeshId?: number;
    private snapHintItem?: IDisposable;
    private controller?: AsyncController;
    /** Screen point a rubber-band box was started from, while one is being dragged. */
    private boxStart?: { x: number; y: number };
    /** Whether the box adds to the selection (shift) instead of replacing it. */
    private boxAdditive = false;
    private boxMeshId?: number;

    // ------------------------------------------------------------------ Session setup and the datum / external display

    constructor(private readonly editor: SketchEditor) {
        this.showDatum();
        this.showExternalRefs();
        this.showConstructionEntities();
        this.showEntityPoints();
    }

    setController(view: IView, controller: AsyncController | undefined) {
        if (this.controller === controller) {
            return;
        }
        controller?.onCancelled((_r) => this.handleEscape(view));
        this.controller = controller;
    }

    /** Session-persistent origin marker and dashed X/Y axis lines. */
    private showDatum(): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        const half = this.datumHalfLength();
        const plane = this.editor.node.plane;
        this.datumDisplayId = view.document.visual.context.displayMesh(
            [
                MeshDataUtils.createEdgeMesh(
                    toWorld(plane, -half, 0),
                    toWorld(plane, half, 0),
                    DATUM_X_AXIS_COLOR,
                    "dash",
                ),
                MeshDataUtils.createEdgeMesh(
                    toWorld(plane, 0, -half),
                    toWorld(plane, 0, half),
                    DATUM_Y_AXIS_COLOR,
                    "dash",
                ),
                MeshDataUtils.createVertexMesh(
                    toWorld(plane, 0, 0),
                    VisualConfig.editVertexSize,
                    DATUM_X_AXIS_COLOR,
                ),
            ],
            { onTop: true },
        );
    }

    /** Session-persistent display of the external references: dashed purple, red when dangling. */
    private showExternalRefs(): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        const meshes: ShapeMeshData[] = [];
        // the solver carries the live refs — node.data lags behind until the next commit
        for (const ref of this.editor.solver.externalRefsData()) {
            const entity = this.editor.solver.entity(ref.entityId);
            if (entity === undefined) continue;
            const color = ref.dangling === true ? EXTERNAL_DANGLING_COLOR : EXTERNAL_REF_COLOR;
            // reference-role externals read as construction geometry; profile-role ones
            // build real profiles, so they get a solid line
            meshes.push(
                sketchEntityMesh(this.editor, entity, color, ref.role === "profile" ? "solid" : "dash"),
            );
        }
        if (meshes.length === 0) return;
        this.externalDisplayId = view.document.visual.context.displayMesh(meshes, { onTop: true });
    }

    /**
     * Session-persistent display of the construction entities: dashed steel blue.
     * They are excluded from the node's shape (they never build profiles), so
     * without this overlay they would be invisible while editing — the same
     * treatment reference-role external refs get above. Every construction entity is
     * drawn, a command's own carrier circles included, so the user can pick and
     * delete them.
     */
    private showConstructionEntities(): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        const meshes: ShapeMeshData[] = [];
        // the solver carries the live flags — node.data lags behind until the next commit
        for (const entity of this.editor.solver.entities()) {
            if (!this.editor.solver.isConstruction(entity.id)) continue;
            meshes.push(sketchEntityMesh(this.editor, entity, CONSTRUCTION_COLOR, "dash"));
        }
        if (meshes.length === 0) return;
        this.constructionDisplayId = view.document.visual.context.displayMesh(meshes, { onTop: true });
    }

    /**
     * Re-renders the session's geometry overlays — the external references, the
     * construction entities and the entity point markers — after the geometry
     * behind them was added, removed, moved or re-resolved.
     */
    refreshGeometryOverlays(): void {
        const view = this.editor.document.application.activeView;
        if (view !== undefined) {
            for (const id of [this.externalDisplayId, this.constructionDisplayId, this.pointDisplayId]) {
                if (id !== undefined) view.document.visual.context.removeMesh(id);
            }
        }
        this.externalDisplayId = undefined;
        this.constructionDisplayId = undefined;
        this.pointDisplayId = undefined;
        this.showExternalRefs();
        this.showConstructionEntities();
        this.showEntityPoints();
        view?.update();
    }

    /**
     * Re-renders just the entity point markers. They carry their entity's constraint
     * colour, so a constraint that flips which entities are pinned has to redraw them —
     * nothing moved, only what the markers read in changed.
     */
    refreshEntityPoints(): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        this.clearEntityPoints(view);
        this.showEntityPoints();
        view.update();
    }

    /**
     * Session-persistent markers on every entity point — line endpoints, circle and
     * arc centers, arc start and end. They are what drawing snaps to and what
     * dragging grabs, so they are worth seeing before the cursor reaches them.
     */
    private showEntityPoints(): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        const meshes = entityPointMeshes(this.editor);
        if (meshes.length === 0) return;
        this.pointDisplayId = view.document.visual.context.displayMesh(meshes, { onTop: true });
    }

    private clearEntityPoints(view: IView): void {
        if (this.pointDisplayId !== undefined) {
            view.document.visual.context.removeMesh(this.pointDisplayId);
            this.pointDisplayId = undefined;
        }
    }

    private clearConstructionEntities(view: IView): void {
        if (this.constructionDisplayId !== undefined) {
            view.document.visual.context.removeMesh(this.constructionDisplayId);
            this.constructionDisplayId = undefined;
        }
    }

    /** Half-length of the drawn axis lines: 1.5× the sketch extent, at least 100, and always spanning the visible viewport. */
    private datumHalfLength(): number {
        let extent = 0;
        for (const entity of this.editor.solver.entities()) {
            const p = entity.params;
            if (entity.type === "circle") {
                extent = Math.max(extent, Math.abs(p[0]) + p[2], Math.abs(p[1]) + p[2]);
            } else {
                for (let i = 0; i + 1 < p.length; i += 2) {
                    extent = Math.max(extent, Math.abs(p[i]), Math.abs(p[i + 1]));
                }
            }
        }
        // axes read as infinite construction lines when they reach past the viewport
        const view = this.editor.document.application.activeView;
        let visible = 0;
        if (view !== undefined) {
            const px = viewPixelSize(view, this.editor.node.plane.origin);
            visible = px === undefined ? 0 : (px * Math.hypot(view.width, view.height)) / 2;
        }
        return Math.max(100, extent * 1.5, visible);
    }

    // ------------------------------------------------------------------ Hit testing

    pointerToUV(view: IView, event: PointerEvent): [number, number] | undefined {
        const point = this.editor.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
        return point === undefined ? undefined : toUV(this.editor.node.plane, point);
    }

    hitTestPoint(view: IView, event: PointerEvent): SketchPointRef | undefined {
        const solver = this.editor.solver;
        const plane = this.editor.node.plane;
        let best: SketchPointRef | undefined;
        let bestDistance = PICK_TOLERANCE_PX;
        for (const entity of this.pickableEntities()) {
            const pointCount = entityPointCount(entity.type);
            for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
                const [u, v] = solver.pointOf({ entityId: entity.id, pointIndex });
                const screen = view.worldToScreen(toWorld(plane, u, v));
                const distance = Math.hypot(screen.x - event.offsetX, screen.y - event.offsetY);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = { entityId: entity.id, pointIndex };
                }
            }
        }
        // the origin is always a pickable datum point; real points win ties
        const originScreen = view.worldToScreen(toWorld(plane, 0, 0));
        const originDistance = Math.hypot(originScreen.x - event.offsetX, originScreen.y - event.offsetY);
        if (originDistance < bestDistance) {
            best = originRef();
        }
        return best;
    }

    /** Real entities plus the seeded external references (constraint targets). */
    private pickableEntities(): SketchEntityData[] {
        return constraintTargetEntities(this.editor.solver);
    }

    hitTestEntity(
        view: IView,
        event: PointerEvent,
        type?: SketchEntityTypeFilter,
        datum = false,
    ): number | undefined {
        const uv = this.pointerToUV(view, event);
        if (uv === undefined) return undefined;
        const tolerance = this.worldTolerance(view, event);
        if (tolerance === undefined) return undefined;
        const types: readonly SketchEntityType[] | undefined =
            type === undefined ? undefined : typeof type === "string" ? [type] : type;

        let best: number | undefined;
        let bestDistance = tolerance;
        const consider = (id: number, distance: number) => {
            if (distance < bestDistance) {
                bestDistance = distance;
                best = id;
            }
        };
        for (const entity of this.pickableEntities()) {
            if (types !== undefined && !types.includes(entity.type)) continue;
            consider(entity.id, entityDistance(uv, entity));
        }
        // datum axes are infinite lines, pickable only when the pick opts in;
        // checked last so real geometry wins ties (e.g. a line lying on an axis)
        if (datum && (types === undefined || types.includes("line"))) {
            consider(SKETCH_X_AXIS_ID, Math.abs(uv[1]));
            consider(SKETCH_Y_AXIS_ID, Math.abs(uv[0]));
        }
        return best;
    }

    // ------------------------------------------------------------------ Pointer and keyboard input

    pointerMove(view: IView, event: PointerEvent): void {
        if (!this.isEnabled) return;
        // a dimension label drag is tracked on window by the annotation manager;
        // the viewport must not run its hover/drag logic alongside it
        if (this.editor.annotations.isLabelDragging) return;
        // events over an annotation badge carry badge-relative offsets; ignoring
        // them keeps the hover alive instead of clearing it with garbage uv
        if (isBadgeEventTarget(event.target)) return;
        if (this.draggingRef !== undefined) {
            this.dragPointAtPointer(view, event);
            return;
        }
        if (this.boxStart !== undefined) {
            this.updateBox(view, this.boxStart, event);
            return;
        }
        const preview = this.editor.activePick?.preview;
        if (preview !== undefined) {
            preview(this.pointerToUV(view, event));
        }
        this.updatePointerHover(view, event);
    }

    /** Moves the point being dragged to wherever the pointer now is, with its snapping. */
    private dragPointAtPointer(view: IView, event: PointerEvent): void {
        const ref = this.draggingRef;
        const uv = this.pointerToUV(view, event);
        if (ref === undefined || uv === undefined) return;
        const tolerance = this.editor.screenTolerance();
        const { position, snap } = dragSnapPosition(this.editor.solver, ref, uv, {
            pointTolerance: tolerance,
            lineTolerance: tolerance,
        });
        this.editor.solver.dragTo(ref, position[0], position[1]);
        this.updateDragPreview(view);
        this.showSnapFeedback(view, snap);
        this.editor.annotations.refresh();
    }

    /**
     * The hover for a pointer that is over neither a badge nor a drag in flight. The
     * geometry has the first claim — an extension line ends on the line it measures, and a
     * leader on the circle it measures, so a pointer within reach of both has to read as
     * the geometry. What is left over may be a dimension's own furniture, which is a
     * target in its own right: the dimension line and its arrows are the dimension as much
     * as its value is.
     */
    private updatePointerHover(view: IView, event: PointerEvent): void {
        // A datum label is the more specific target: it sits over the geometry the way the badge
        // that used to draw it did (a DOM element the viewport never saw), so it takes the hover
        // and whatever entity is under it lets go.
        const uv = this.pointerToUV(view, event);
        const overLabel = uv !== undefined && this.editor.annotations.labelAt(uv[0], uv[1]) !== undefined;
        // Every path asks for the cursor, the geometry one included: a label has no element to
        // hold it, so a pointer that leaves one for the line behind it would keep the grab
        this.editor.annotations.showLabelCursor(overLabel);
        if (overLabel) {
            this.clearHover(view);
            this.hoverDimensionAtPointer(view, event);
            return;
        }
        this.updateHover(view, event);
        if (this.hoverKey === undefined) this.hoverDimensionAtPointer(view, event);
        else this.editor.annotations.hoverConstraint(undefined);
    }

    /** Hands the pointer's hover to the dimension whose drawn graphics it is over, if any. */
    private hoverDimensionAtPointer(view: IView, event: PointerEvent): void {
        const uv = this.pointerToUV(view, event);
        if (uv !== undefined) this.editor.annotations.hoverDimensionAt(uv, this.editor.screenTolerance());
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (!this.isEnabled) return;
        this.endStrayLabelDrag();
        // pick handling first: a right-click must be able to cancel an active pick
        if (this.consumePickClick(view, event)) return;
        if (event.button !== 0) return;

        // A press on a datum label picks the label up: it is drawn as mesh glyphs with no badge
        // behind it (`addDatumDimension`), and `releaseLabelDrag` tells a click from a drag —
        // a click selects the dimension, a drag moves the label, the second click of a
        // double-click opens its value.
        const pressedUV = this.pointerToUV(view, event);
        const label =
            pressedUV === undefined ? undefined : this.editor.annotations.labelAt(pressedUV[0], pressedUV[1]);
        if (label !== undefined) {
            this.editor.annotations.startLabelDrag(label, event);
            return;
        }
        // a press that is not on a label is not the first half of a double-click on one
        this.editor.annotations.clearLabelClick();

        // a multi-entity pick that missed every entity falls through to here: the
        // rubber-band box started below is how the user answers it with a set
        if (this.editor.activePick?.kind === "entities") {
            this.editor.annotations.clearConstraintSelection();
            this.clearSelection(view);
            this.boxAdditive = false;
            this.boxStart = { x: event.offsetX, y: event.offsetY };
            return;
        }

        const ref = this.hitTestPoint(view, event);
        if (this.selectDimensionAtPointer(view, event, ref)) return;
        // A press on the canvas is about the canvas: whatever it goes on to do — drag a
        // point, select an entity, start a rubber band — the dimension that was selected
        // is not what the user just pressed, so it stops being selected here. Every path
        // below used to have to remember this, and the ones that return early did not: a
        // press that caught a line or an endpoint left the dimension selected, which read
        // as "clicking away does not deselect".
        this.editor.annotations.clearConstraintSelection();

        if (this.isDraggablePoint(ref)) {
            this.beginPointDrag(view, ref);
            return;
        }
        this.selectEntityAtPointer(view, event, ref);
    }

    /**
     * Ends a label drag whose release never reached this window — it went elsewhere, or
     * the gesture was interrupted. Left in flight it would keep `isLabelDragging` true for
     * good, and with it the viewport deaf to hover. The press that ends it goes on to
     * behave like the press it is, which is the whole point of that click when the user
     * meant to clear the selection with it.
     */
    private endStrayLabelDrag(): void {
        if (this.editor.annotations.isLabelDragging) this.editor.annotations.endLabelDrag(true);
    }

    /**
     * Takes the press for the dimension whose drawn graphics are under the pointer — its
     * dimension line, its extension lines, its arrows — and answers whether it did. A
     * point or an entity under the pointer still wins: a leader ends on the geometry it
     * measures, and pressing there means the geometry, which is how a circle gets picked
     * by its rim. That is also why it is asked before the selections are dropped below: a
     * press about dimensions must not first throw away the dimension that was selected.
     */
    private selectDimensionAtPointer(view: IView, event: PointerEvent, pointRef?: SketchPointRef): boolean {
        const dimension = this.dimensionAtPointer(view, event);
        if (dimension === undefined || this.geometryAtPointer(view, event, pointRef)) return false;
        this.editor.annotations.toggleConstraint(dimension, event.shiftKey);
        return true;
    }

    /** The datum dimension whose drawn graphics are under the pointer, if any. */
    private dimensionAtPointer(view: IView, event: PointerEvent): number | undefined {
        const uv = this.pointerToUV(view, event);
        if (uv === undefined) return undefined;
        return this.editor.annotations.constraintAt(uv, this.editor.screenTolerance());
    }

    /** Whether a point or an entity is under the pointer — what a press on geometry means. */
    private geometryAtPointer(view: IView, event: PointerEvent, pointRef?: SketchPointRef): boolean {
        if (this.isDraggablePoint(pointRef ?? this.hitTestPoint(view, event))) return true;
        return this.hitTestEntity(view, event) !== undefined;
    }

    /**
     * A double-click in the sketch: doubling one of an array's copies opens that array's tool.
     *
     * A copy is the only thing on canvas that *is* the pattern, so it is what the tool has to
     * hang off — SolidWorks puts its "Edit Pattern" on the instance for the same reason, the
     * difference being that it has a context menu to put it in and this has a double-click.
     * The pattern's own numbers are annotated on the canvas and each is doubled to change it
     * (`SketchAnnotationManager`); this is the way in for everything else about the pattern —
     * its reference, the geometry it copies, its removal and its dissolution.
     *
     * Anything else the sketch could double-click belongs to no tool, and is left alone.
     */
    doubleClick(view: IView, event: MouseEvent): void {
        const entityId = this.hitTestEntity(view, event as PointerEvent);
        const array = entityId === undefined ? undefined : this.editor.solver.arrayOf(entityId);
        if (array === undefined) return;
        this.editor.editArray(array.id);
    }

    /**
     * Whether a hit point is one the user may take hold of: the datum origin, external
     * references and an array's instances are pickable as constraint targets but never
     * draggable, so a press on one of them means the geometry behind it rather than the
     * point. (`isFixed` is exactly that set, which is why none of them can be moved by any
     * means — a drag here, a setter in an op, a dimension anywhere.)
     */
    private isDraggablePoint(ref: SketchPointRef | undefined): ref is SketchPointRef {
        return ref !== undefined && !this.editor.solver.isFixed(ref.entityId);
    }

    /** Hands the click to an active pick; returns whether the pick consumed it. */
    private consumePickClick(view: IView, event: PointerEvent): boolean {
        if (!this.editor.handlePickPointerDown(view, event)) return false;

        // the pick consumed the click; drop the pre-click hover highlight and
        // force a repaint so it disappears even if the mouse stays put
        this.clearHover(view);
        this.syncAnnotationHighlights();
        view.update();
        return true;
    }

    /**
     * An entity under the cursor is selected on the spot; genuinely empty space drops
     * both selections and starts a rubber-band box instead, which resolves on
     * pointer-up — so a press and release in place still reads as a plain click.
     * `pointRef` is the point that was hit, if any: a mark that is deliberately not
     * draggable (the datum, an external reference) is not empty space and not a
     * rubber-band handle either, so pressing one only drops the selections.
     */
    private selectEntityAtPointer(view: IView, event: PointerEvent, pointRef?: SketchPointRef): void {
        const entityId = this.hitTestEntity(view, event);
        if (entityId !== undefined) {
            this.selectEntity(view, entityId, event.shiftKey);
            return;
        }
        if (!event.shiftKey) this.clearSelection(view);
        if (pointRef !== undefined) return;
        this.boxStart = { x: event.offsetX, y: event.offsetY };
        this.boxAdditive = event.shiftKey;
    }

    private beginPointDrag(view: IView, ref: SketchPointRef): void {
        this.draggingRef = ref;
        this.clearHover(view);
        // the drag preview carries the markers and the construction entities while
        // dragging; the persistent overlays would otherwise sit at pre-drag positions
        this.clearEntityPoints(view);
        this.clearConstructionEntities(view);
        const group = this.editor.solver.coincidentGroup(ref);
        this.editor.solver.beginDrag(group);
        // keep the dragged entities' constraint symbols visible during the drag
        this.editor.annotations.setHighlightedEntities(
            new Set([...group.map((r) => r.entityId), ...this.selectedEntities]),
        );
    }

    private selectEntity(view: IView, entityId: number, additive: boolean): void {
        if (additive) {
            if (!this.selectedEntities.delete(entityId)) {
                this.selectedEntities.add(entityId);
            }
        } else {
            this.selectedEntities.clear();
            this.selectedEntities.add(entityId);
        }
        this.updateSelectionHighlight(view);
    }

    pointerUp(view: IView, event: PointerEvent): void {
        const boxStart = this.boxStart;
        if (boxStart !== undefined) {
            this.finishBox(view, boxStart, event);
            return;
        }
        if (this.draggingRef === undefined) return;
        const ref = this.draggingRef;
        this.draggingRef = undefined;
        this.clearDragPreview(view);
        this.clearSnapFeedback();
        this.editor.solver.endDrag();
        // the drag is over: add an auto-constraint now, only if the point still
        // satisfies a snap condition
        const tolerance = this.editor.screenTolerance();
        applyDragAutoConstraints(this.editor.solver, ref, {
            pointTolerance: tolerance,
            lineTolerance: tolerance,
        });
        this.syncAnnotationHighlights();
        this.editor.commit();
        this.editor.solve(true);
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.handleEscape(view);
            return;
        }
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        this.handleDelete(view, event);
    }

    /** Escape peels off one layer at a time: label placement, pick, constraint selection, entity selection, session. */
    private handleEscape(view: IView): void {
        if (this.boxStart !== undefined) {
            this.cancelBox(view);
        } else if (this.editor.annotations.isLabelDragging) {
            this.editor.annotations.cancelLabelDrag();
        } else if (this.editor.isPicking) {
            this.editor.cancelPick();
        } else if (this.editor.annotations.selectedConstraintIds.length > 0) {
            this.editor.annotations.clearConstraintSelection();
        } else if (this.selectedEntities.size > 0) {
            this.clearSelection(view);
        } else {
            this.editor.exit();
        }
    }

    private handleDelete(view: IView, event: KeyboardEvent): void {
        // swallow the key: HotkeyService would otherwise also fire modify.deleteNode,
        // whose node-selection step can delete the very sketch node being edited,
        // leaving the editor drawing into an invisible orphan
        event.stopImmediatePropagation();
        if (this.editor.isPicking || this.draggingRef !== undefined) return;
        const hoveredConstraint = this.editor.annotations.hoveredConstraintId;
        if (hoveredConstraint !== undefined) {
            this.editor.deleteConstraints([hoveredConstraint]);
            return;
        }
        const selectedConstraints = this.editor.annotations.selectedConstraintIds;
        if (selectedConstraints.length > 0) {
            this.editor.deleteConstraints(selectedConstraints);
            return;
        }
        const hovered = this.hoveredEntityId();
        const ids = (hovered !== undefined ? [hovered] : [...this.selectedEntities]).filter(
            // the datum can be hovered through the origin point but never deleted
            (id) => !isDatumEntityId(id),
        );
        if (ids.length === 0) return;
        this.clearHover(view);
        this.clearSelection(view);
        // regular entities and external references delete together in one transaction
        this.editor.deleteEntities(ids);
    }

    // ------------------------------------------------------------------ Constraint highlighting

    /** Highlights the entities a hovered/selected constraint badge refers to. */
    highlightConstraintEntities(entityIds: number[]): void {
        const view = this.editor.document.application.activeView;
        if (view === undefined) return;
        // a badge hover replaces any entity hover: pointerMove ignores events over
        // badges, so the entity highlight would otherwise linger next to the badge's
        this.clearHover(view);
        this.syncAnnotationHighlights();
        this.clearConstraintHighlight(view);
        const meshes = this.constraintHighlightMeshes(entityIds);
        if (meshes.length > 0) {
            this.constraintMeshId = view.document.visual.context.displayMesh(meshes, { onTop: true });
        }
        view.update();
    }

    private constraintHighlightMeshes(entityIds: number[]): ShapeMeshData[] {
        const meshes: ShapeMeshData[] = [];
        for (const id of entityIds) {
            if (id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID) {
                meshes.push(this.datumAxisMesh(id, VisualConfig.highlightEdgeColor));
            } else if (isDatumEntityId(id)) {
                meshes.push(
                    MeshDataUtils.createVertexMesh(
                        toWorld(this.editor.node.plane, 0, 0),
                        VisualConfig.editVertexSize,
                        VisualConfig.highlightEdgeColor,
                    ),
                );
            } else {
                // solver.entity also answers external references and datum axes
                const entity = this.editor.solver.entity(id);
                if (entity !== undefined) meshes.push(sketchEntityMesh(this.editor, entity));
            }
        }
        return meshes;
    }

    /** Entity id of the current hover highlight (`entity:<id>` or `point:<id>:<index>`). */
    private hoveredEntityId(): number | undefined {
        const parts = this.hoverKey?.split(":");
        if (parts === undefined || parts.length < 2) return undefined;
        const id = Number(parts[1]);
        return Number.isInteger(id) ? id : undefined;
    }

    dispose(): void {
        // inert from here on: the viewport decides what to dispatch by `isEnabled`, and a
        // picker session that hands this handler back after the session ended would
        // otherwise leave every pointer event arriving at a disposed sketch
        this.isEnabled = false;
        const view = this.editor.view;
        this.clearSnapFeedback();
        if (!view.isClosed) {
            this.clearHover(view);
            this.clearDragPreview(view);
            this.clearBox(view);
            this.clearSelectionHighlight(view);
            this.clearConstraintHighlight(view);
            if (this.datumDisplayId !== undefined) {
                view.document.visual.context.removeMesh(this.datumDisplayId);
                this.datumDisplayId = undefined;
            }
            if (this.externalDisplayId !== undefined) {
                view.document.visual.context.removeMesh(this.externalDisplayId);
                this.externalDisplayId = undefined;
            }
            this.clearConstructionEntities(view);
            this.clearEntityPoints(view);
        }
        this.selectedEntities.clear();
        this.draggingRef = undefined;
    }

    // ------------------------------------------------------------------ Hover, drag and snap feedback

    /** Pick tolerance converted to sketch-plane units at the event position. */
    private worldTolerance(view: IView, event: PointerEvent): number | undefined {
        const plane = this.editor.node.plane;
        const point = plane.intersectRay(view.rayAt(event.offsetX, event.offsetY)) ?? plane.origin;
        const size = viewPixelSize(view, point);
        return size === undefined ? undefined : size * PICK_TOLERANCE_PX;
    }

    private updateHover(view: IView, event: PointerEvent): void {
        const { key, mesh, meshes } = this.computeHoverTarget(view, event);

        if (key === this.hoverKey) return;
        if (key === undefined && this.hoverKey !== undefined && this.isCrossingToBadge(view, event)) {
            return;
        }
        this.clearHover(view);
        const shown = meshes ?? (mesh === undefined ? undefined : [mesh]);
        if (shown !== undefined && shown.length > 0) {
            this.hoverMeshId = view.document.visual.context.displayMesh(shown, { onTop: true });
            this.hoverKey = key;
        }
        this.syncAnnotationHighlights();
    }

    private computeHoverTarget(view: IView, event: PointerEvent): HoverTarget {
        const pick = this.editor.activePick;

        // an element pick wants a point here if there is one, and an entity otherwise — that
        // is the very precedence it resolves clicks with, so hover shows it the same way
        if (pick === undefined || pick.kind === "point" || pick.kind === "element") {
            const point = this.pointHoverTarget(view, event);
            if (point !== undefined) return point;
        }

        if (pick?.kind === "entityAt") return this.entityAtHoverTarget(view, event, pick);

        // a multi-entity pick and a single-entity one highlight what they want picked
        // just like a plain hover does — and an element pick highlights the entity only
        // when no point was in reach, which the point branch above already settled
        if (
            pick === undefined ||
            pick.kind === "entity" ||
            pick.kind === "entities" ||
            pick.kind === "element"
        ) {
            return this.entityHoverTarget(view, event, pick);
        }
        return {};
    }

    /** The point under the cursor, if one is in reach — a vertex is what every pick hits first. */
    private pointHoverTarget(view: IView, event: PointerEvent): HoverTarget | undefined {
        const ref = this.hitTestPoint(view, event);
        if (ref === undefined) return undefined;
        const [u, v] = this.editor.solver.pointOf(ref);
        return {
            key: `point:${ref.entityId}:${ref.pointIndex}`,
            mesh: MeshDataUtils.createVertexMesh(
                toWorld(this.editor.node.plane, u, v),
                VisualConfig.editVertexSize,
                VisualConfig.editVertexColor,
            ),
        };
    }

    /**
     * The entity under the cursor, highlighted the way a plain hover would. A pick that
     * previews what it would leave draws that proposal instead — see `entityPreviewTarget`.
     */
    private entityHoverTarget(
        view: IView,
        event: PointerEvent,
        pick: SketchActivePick | undefined,
    ): HoverTarget {
        const entityId = this.hitTestEntity(view, event, pick?.entityType, pick?.datum ?? false);
        if (entityId === undefined) return {};

        const preview = this.entityPreviewTarget(entityId, pick);
        if (preview !== undefined) return preview;

        if (isDatumEntityId(entityId)) {
            return {
                key: `entity:${entityId}`,
                mesh: this.datumAxisMesh(entityId, VisualConfig.highlightEdgeColor),
            };
        }
        const entity = this.editor.solver.entity(entityId);
        return entity === undefined
            ? {}
            : { key: `entity:${entityId}`, mesh: sketchEntityMesh(this.editor, entity) };
    }

    /**
     * A pick that previews what it would leave (the mirror) draws its proposal beside the
     * plain hover highlight — the line under the cursor stays lit. The preview only ever
     * adds: a pick previews nothing until it has something to preview (the mirror's line is
     * picked before any source is chosen), and that must still read as an ordinary hover
     * rather than as no feedback at all. Undefined when there is nothing to propose.
     */
    private entityPreviewTarget(
        entityId: number,
        pick: SketchActivePick | undefined,
    ): HoverTarget | undefined {
        const preview = pick?.previewEntity?.(entityId);
        if (preview === undefined || preview.length === 0) return undefined;
        return {
            // `mirror:` rather than `entity:`: updateHover skips a key it already shows,
            // and entering the pick from a plain hover over the same line would otherwise
            // keep the old highlight and never draw the proposal
            key: `mirror:${entityId}`,
            meshes: [
                ...this.hoverHighlightMeshes(entityId),
                ...preview.map((copy) => mirrorPreviewMesh(this.editor, copy)),
            ],
        };
    }

    /**
     * The entity-and-position pick is the trim's, the extend's and the break's, and what
     * each of them asks for is one of these entities — so it lights up under the cursor
     * exactly as an ordinary hover does, and what the click would do is drawn over it:
     * the piece a trim would take away, the span an extend would add, the points a break
     * would carve at.
     *
     * The pick's own answer is `previewAt`, and a pick that has nothing to propose yet —
     * the extend's first step, which is still choosing its target — is an ordinary hover
     * for that reason. Where the op would refuse there is no proposal, but the entity
     * stays lit: the refusal is the absence of the second cue, not of the first.
     */
    private entityAtHoverTarget(view: IView, event: PointerEvent, pick: SketchActivePick): HoverTarget {
        const entityId = this.hitTestEntity(view, event, pick.entityType, pick.datum ?? false);
        const uv = entityId === undefined ? undefined : this.pointerToUV(view, event);
        if (entityId === undefined || uv === undefined) return {};

        const highlight = this.hoverHighlightMeshes(entityId);
        const preview = pick.previewAt?.(entityId, uv);
        if (preview === undefined) return { key: `entity:${entityId}`, meshes: highlight };
        return {
            key: previewKey(entityId, preview),
            meshes: [...highlight, ...previewMeshes(this.editor, preview)],
        };
    }

    /** The highlight a preview stands in front of: the hovered line, datum axes included. */
    private hoverHighlightMeshes(entityId: number): ShapeMeshData[] {
        if (isDatumEntityId(entityId)) {
            return [this.datumAxisMesh(entityId, VisualConfig.highlightEdgeColor)];
        }
        const entity = this.editor.solver.entity(entityId);
        return entity === undefined ? [] : [sketchEntityMesh(this.editor, entity)];
    }

    /** Full-length dashed axis line used for datum hover/constraint highlight. */
    private datumAxisMesh(axisId: number, color: number): ShapeMeshData {
        const half = this.datumHalfLength();
        const plane = this.editor.node.plane;
        return axisId === SKETCH_X_AXIS_ID
            ? MeshDataUtils.createEdgeMesh(toWorld(plane, -half, 0), toWorld(plane, half, 0), color, "dash")
            : MeshDataUtils.createEdgeMesh(toWorld(plane, 0, -half), toWorld(plane, 0, half), color, "dash");
    }

    /**
     * Crossing the gap from an entity to its offset badge keeps the hover alive,
     * otherwise the badge would vanish before the cursor can reach it.
     */
    private isCrossingToBadge(view: IView, event: PointerEvent): boolean {
        const previous = this.hoveredEntityId();
        const uv = this.pointerToUV(view, event);
        return (
            previous !== undefined &&
            uv !== undefined &&
            this.editor.annotations.isNearVisibleBadge(previous, uv)
        );
    }

    /** Constraint symbols show for the union of hovered and selected entities. */
    private syncAnnotationHighlights(): void {
        const ids = new Set(this.selectedEntities);
        const hovered = this.hoveredEntityId();
        if (hovered !== undefined) ids.add(hovered);
        this.editor.annotations.setHighlightedEntities(ids);
    }

    /** Ids of the currently selected entities (empty when nothing is selected). */
    selectedEntityIds(): number[] {
        return [...this.selectedEntities];
    }

    /** Clears the entity selection and its highlight — a command consumed the selection. */
    clearEntitySelection(): void {
        this.clearSelection(this.editor.view);
    }

    private updateSelectionHighlight(view: IView): void {
        this.clearSelectionHighlight(view);
        if (this.selectedEntities.size === 0) {
            this.syncAnnotationHighlights();
            return;
        }
        const meshes = [...this.selectedEntities]
            .map((id) => this.editor.solver.entity(id))
            .filter((entity) => entity !== undefined)
            .map((entity) => sketchEntityMesh(this.editor, entity, VisualConfig.selectedEdgeColor));
        this.selectionMeshId = view.document.visual.context.displayMesh(meshes, { onTop: true });
        this.syncAnnotationHighlights();
        view.update();
    }

    private clearSelection(view: IView): void {
        if (this.selectedEntities.size === 0) return;
        this.selectedEntities.clear();
        this.clearSelectionHighlight(view);
        this.syncAnnotationHighlights();
        view.update();
    }

    // ------------------------------------------------------------------ Rubber-band box selection

    /** Redraws the rubber-band outline for the drag in progress. */
    private updateBox(view: IView, start: { x: number; y: number }, event: PointerEvent): void {
        const rect = screenRect(start, { x: event.offsetX, y: event.offsetY });
        this.clearBox(view);
        const meshes = this.boxOutline(view, rect);
        if (meshes.length > 0) {
            this.boxMeshId = view.document.visual.context.displayMesh(meshes, { onTop: true });
        }
        view.update();
    }

    /** Ends the drag: a real box selects, a press and release in place does nothing more. */
    private finishBox(view: IView, start: { x: number; y: number }, event: PointerEvent): void {
        const rect = screenRect(start, { x: event.offsetX, y: event.offsetY });
        const additive = this.boxAdditive;
        this.cancelBox(view);
        if (rect.maxX - rect.minX < BOX_MIN_PX && rect.maxY - rect.minY < BOX_MIN_PX) return;
        this.selectEntitiesInRect(view, rect, additive);
        this.answerEntityPick();
    }

    /** A box that lands while a multi-entity pick is pending answers it with what it caught. */
    private answerEntityPick(): void {
        if (this.editor.activePick?.kind !== "entities") return;
        this.editor.resolvePick([...this.selectedEntities]);
    }

    private cancelBox(view: IView): void {
        this.boxStart = undefined;
        this.boxAdditive = false;
        // the outline is dropped between two frames; the release and escape paths that
        // end a box often touch nothing else, so without this the last painted frame
        // keeps the dashed quad until something else asks for a repaint
        if (this.boxMeshId !== undefined) view.update();
        this.clearBox(view);
    }

    private clearBox(view: IView): void {
        if (this.boxMeshId === undefined) return;
        view.document.visual.context.removeMesh(this.boxMeshId);
        this.boxMeshId = undefined;
    }

    /**
     * The outline, drawn on the sketch plane through the rays of the rectangle's four
     * screen corners. The camera is locked orthographic onto that plane for the session
     * (`lockCameraOntoPlane`), so the quad lands on the screen rectangle; if the user
     * orbits away it shows the plane's own quad while the hit test stays in screen
     * space — deliberate, since the plane can turn edge-on to a screen rectangle.
     */
    private boxOutline(view: IView, rect: ScreenRect): ShapeMeshData[] {
        const plane = this.editor.node.plane;
        const corners: [number, number][] = [
            [rect.minX, rect.minY],
            [rect.maxX, rect.minY],
            [rect.maxX, rect.maxY],
            [rect.minX, rect.maxY],
        ];
        const world: XYZ[] = [];
        for (const [x, y] of corners) {
            const point = plane.intersectRay(view.rayAt(x, y));
            if (point === undefined) return [];
            world.push(point);
        }
        return world.map((point, i) =>
            MeshDataUtils.createEdgeMesh(point, world[(i + 1) % world.length], BOX_SELECT_COLOR, "dash"),
        );
    }

    /**
     * Selects every entity the rectangle crosses. Crossing rather than containment:
     * a box drawn around a sketch usually has the geometry running through it, and a
     * corner to round is exactly where two lines meet at the box's edge.
     */
    private selectEntitiesInRect(view: IView, rect: ScreenRect, additive: boolean): void {
        if (!additive) this.selectedEntities.clear();
        for (const entity of this.boxCandidates()) {
            if (entityCrossesRect(view, sketchEntityMesh(this.editor, entity), rect)) {
                this.selectedEntities.add(entity.id);
            }
        }
        this.updateSelectionHighlight(view);
    }

    /**
     * What a box may catch: every constraint target, narrowed to the type an active
     * pick asked for — a pick for lines must not hand back the arcs that happen to
     * fall inside the same rectangle.
     */
    private boxCandidates(): SketchEntityData[] {
        const filter = this.editor.activePick?.entityType;
        const types: readonly SketchEntityType[] | undefined =
            filter === undefined ? undefined : typeof filter === "string" ? [filter] : filter;
        return this.pickableEntities().filter((entity) => types === undefined || types.includes(entity.type));
    }

    private clearSelectionHighlight(view: IView): void {
        if (this.selectionMeshId !== undefined) {
            view.document.visual.context.removeMesh(this.selectionMeshId);
            this.selectionMeshId = undefined;
        }
    }

    private clearConstraintHighlight(view: IView): void {
        if (this.constraintMeshId !== undefined) {
            view.document.visual.context.removeMesh(this.constraintMeshId);
            this.constraintMeshId = undefined;
        }
    }

    private clearHover(view: IView): void {
        if (this.hoverMeshId !== undefined) {
            view.document.visual.context.removeMesh(this.hoverMeshId);
            this.hoverMeshId = undefined;
            this.hoverKey = undefined;
        }
    }

    private updateDragPreview(view: IView): void {
        this.clearDragPreview(view);
        // the markers ride along with the dragged geometry; the persistent overlay
        // was dropped when the drag began, and comes back on the commit that ends it
        this.dragPreviewId = view.document.visual.context.displayMesh(
            [...sketchEntityMeshes(this.editor), ...entityPointMeshes(this.editor)],
            { onTop: true },
        );
    }

    private clearDragPreview(view: IView): void {
        if (this.dragPreviewId !== undefined) {
            view.document.visual.context.removeMesh(this.dragPreviewId);
            this.dragPreviewId = undefined;
        }
    }

    /** Highlights the live snap target and shows a floating hint while a drag is snapping onto it. */
    private showSnapFeedback(view: IView, snap: DragSnap | undefined): void {
        this.clearSnapFeedback();
        if (snap === undefined) return;
        this.snapTargetMeshId = this.displaySnapTarget(view, snap);
        this.snapHintItem = this.displaySnapHint(view, snap);
    }

    /** Displays the highlighted snap target (a point marker or a curve highlight); returns its mesh id. */
    private displaySnapTarget(view: IView, snap: DragSnap): number | undefined {
        const plane = this.editor.node.plane;
        const targetId = snapTargetEntityId(snap);
        const mesh =
            targetId === undefined
                ? MeshDataUtils.createVertexMesh(
                      toWorld(plane, snap.position[0], snap.position[1]),
                      VisualConfig.editVertexSize,
                      SNAP_HIGHLIGHT_COLOR,
                  )
                : this.snapEntityHighlight(targetId, SNAP_HIGHLIGHT_COLOR);
        return mesh === undefined
            ? undefined
            : view.document.visual.context.displayMesh([mesh], { onTop: true });
    }

    /** Highlight mesh for a line/axis/circle/arc snap target, or undefined. */
    private snapEntityHighlight(targetId: number, color: number): ShapeMeshData | undefined {
        if (targetId === SKETCH_X_AXIS_ID || targetId === SKETCH_Y_AXIS_ID) {
            return this.datumAxisMesh(targetId, color);
        }
        const entity = this.editor.solver.entity(targetId);
        return entity === undefined ? undefined : sketchEntityMesh(this.editor, entity, color);
    }

    /** Displays the floating hint (constraint icon) beside the snap position. */
    private displaySnapHint(view: IView, snap: DragSnap): IDisposable {
        const plane = this.editor.node.plane;
        const symbol = snapHintSymbol(snap);
        const px = viewPixelSize(view, toWorld(plane, snap.position[0], snap.position[1])) ?? 1;
        const off = 18 * px * Math.SQRT1_2;
        return view.htmlText(symbol.label, toWorld(plane, snap.position[0] + off, snap.position[1] + off), {
            hideDelete: true,
            className: `${style.badge} ${style.preview}`,
            onCreated: (element) => applyConstraintIcon(element, symbol),
        });
    }

    private clearSnapFeedback(): void {
        const view = this.editor.view;
        if (this.snapTargetMeshId !== undefined && !view.isClosed) {
            view.document.visual.context.removeMesh(this.snapTargetMeshId);
        }
        this.snapTargetMeshId = undefined;
        this.snapHintItem?.dispose();
        this.snapHintItem = undefined;
    }
}

/**
 * The sketch's own picking, with `shiftKey` set. A tool that works on a *set* (the offset,
 * the transform) forwards every event not aimed at its own handles here as an additive one:
 * a click adds to the set (and a click on a picked curve takes it out again), a box adds
 * what it crosses, and a click on empty space leaves the set alone instead of dropping it.
 *
 * The carried fields are the whole of what the handler and everything it calls read — the
 * label drag among them, which takes the client coordinates and calls `preventDefault`.
 * Leaving those off once made a press on a dimension throw on a method a plain object
 * never had.
 */
export function additivePick(event: PointerEvent): PointerEvent {
    if (event.shiftKey) return event;
    return {
        offsetX: event.offsetX,
        offsetY: event.offsetY,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        shiftKey: true,
        target: event.target,
        preventDefault: () => {},
    } as unknown as PointerEvent;
}

export function sketchEntityMeshes(editor: SketchEditor): ShapeMeshData[] {
    return editor.solver.entities().map((entity) => sketchEntityMesh(editor, entity));
}

/** Vertex meshes at every entity point of the constraint targets — see `showEntityPoints`. */
/**
 * The markers on every constraint target's own points. Each takes the colour its entity's
 * line draws in — the default edge colour when the constraints pin that entity, the free
 * colour otherwise — so a point reads as part of its line rather than as a separate thing.
 */
function entityPointMeshes(editor: SketchEditor): ShapeMeshData[] {
    const plane = editor.node.plane;
    const pinned = editor.fullyConstrained;
    const meshes: ShapeMeshData[] = [];
    for (const entity of constraintTargetEntities(editor.solver)) {
        const color = sketchConstraintColor(pinned, entity.id);
        for (let pointIndex = 0; pointIndex < entityPointCount(entity.type); pointIndex++) {
            const [u, v] = editor.solver.pointOf({ entityId: entity.id, pointIndex });
            meshes.push(
                MeshDataUtils.createVertexMesh(toWorld(plane, u, v), VisualConfig.editVertexSize, color),
            );
        }
    }
    return meshes;
}

/**
 * The mesh of a piece a pick would leave or take — the trim's and the extend's own cue,
 * drawn over the entity's highlight rather than in its place. `arcSegmentMesh` samples it
 * at the editor's usual density, so a long piece stays smooth and a short one is not
 * over-tessellated.
 */
function curvePieceMesh(
    editor: SketchEditor,
    piece: CurvePiece,
    color: number,
    lineType: "solid" | "dash" = "solid",
): EdgeMeshData {
    const plane = editor.node.plane;
    const mesh =
        piece.kind === "line"
            ? MeshDataUtils.createEdgeMesh(
                  toWorld(plane, piece.point1[0], piece.point1[1]),
                  toWorld(plane, piece.point2[0], piece.point2[1]),
                  color,
                  lineType,
              )
            : arcSegmentMesh(
                  editor,
                  piece.center[0],
                  piece.center[1],
                  piece.radius,
                  piece.startAngle,
                  piece.startAngle + piece.sweep,
                  color,
                  lineType,
              );
    mesh.lineWidth = PREVIEW_LINE_WIDTH;
    return mesh;
}

/** Every mesh a pick's own answer is drawn with, in the order the op listed it. */
function previewMeshes(editor: SketchEditor, preview: SketchCurvePreview): ShapeMeshData[] {
    if (preview.kind === "markers") return preview.uvs.map((point) => markerMesh(editor, point));
    return preview.pieces.map(({ piece, role }) =>
        curvePieceMesh(editor, piece, piecePreviewColor(role), piecePreviewLineType(role)),
    );
}

/**
 * The tone a curve piece is previewed in. What is about to be *taken away* is flagged the
 * way a broken constraint is — it is the same "this is wrong" the trim has always meant —
 * and what is about to be *added* takes a tone of its own: not the highlight green, which
 * the entity under the cursor is already wearing, and not the dimension blue either.
 */
function piecePreviewColor(role: "remove" | "add"): number {
    return role === "remove" ? TRIM_PREVIEW_COLOR : EXTEND_PREVIEW_COLOR;
}

/** A span that is not on the sketch yet is drawn dashed, as the mirror's own proposal is. */
function piecePreviewLineType(role: "remove" | "add"): "solid" | "dash" {
    return role === "remove" ? "solid" : "dash";
}

/** Where a carve would cut, drawn as the same marker the entity's own points are drawn with. */
function markerMesh(editor: SketchEditor, point: [number, number]): ShapeMeshData {
    return MeshDataUtils.createVertexMesh(
        toWorld(editor.node.plane, point[0], point[1]),
        VisualConfig.editVertexSize,
        BREAK_MARKER_COLOR,
    );
}

/** One mirrored copy as the mirror pick previews it — the entity's own mesh, dashed. */
function mirrorPreviewMesh(editor: SketchEditor, copy: SketchEntityData): EdgeMeshData {
    const mesh = sketchEntityMesh(editor, copy, MIRROR_PREVIEW_COLOR, "dash");
    mesh.lineWidth = MIRROR_PREVIEW_LINE_WIDTH;
    return mesh;
}

/** Hover identity of a pick's proposal: moving within one must not re-display the meshes. */
function previewKey(entityId: number, preview: SketchCurvePreview): string {
    if (preview.kind === "markers") {
        const round = (value: number) => Math.round(value * 1e6) / 1e6;
        return `markers:${entityId}:${preview.uvs.map((point) => point.map(round)).join("|")}`;
    }
    return `piece:${entityId}:${preview.pieces
        .map(({ piece, role }) => `${role}:${pieceKey(piece)}`)
        .join("|")}`;
}

function pieceKey(piece: CurvePiece): string {
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    return piece.kind === "line"
        ? `${piece.point1.map(round)}:${piece.point2.map(round)}`
        : `${round(piece.startAngle)}:${round(piece.sweep)}`;
}

export function sketchEntityMesh(
    editor: SketchEditor,
    entity: SketchEntityData,
    color: number = VisualConfig.highlightEdgeColor,
    lineType: "solid" | "dash" = "solid",
): EdgeMeshData {
    const plane = editor.node.plane;
    const [x1, y1, x2, y2] = entity.params;
    let mesh: EdgeMeshData;
    if (entity.type === "line") {
        mesh = MeshDataUtils.createEdgeMesh(toWorld(plane, x1, y1), toWorld(plane, x2, y2), color, lineType);
    } else if (entity.type === "arc") {
        const [cx, cy, r, a0, sweep] = arcGeometry(entity.params);
        mesh = arcSegmentMesh(editor, cx, cy, r, a0, a0 + sweep, color, lineType);
    } else {
        mesh = arcSegmentMesh(editor, x1, y1, entity.params[2], 0, Math.PI * 2, color, lineType);
    }
    mesh.lineWidth = SKETCH_EDGE_LINE_WIDTH;
    return mesh;
}

/** Icon (and fallback label) for the constraint a snap release would add. */
function snapHintSymbol(snap: DragSnap): BadgeSymbol {
    const kind = snapConstraintKind(snap);
    return badgeSymbol(kind) ?? { label: kind === ConstraintKind.P2PCoincident ? "◇" : "⊙" };
}

/**
 * Center, radius, start angle and counter-clockwise sweep (normalized to (0, 2π],
 * matching SketchNode.arcEdge) of an arc entity's params [cx, cy, sx, sy, ex, ey].
 */
function arcGeometry(params: number[]): [number, number, number, number, number] {
    const [cx, cy, sx, sy] = params;
    const r = Math.hypot(sx - cx, sy - cy);
    const [a0, sweep] = arcAngles(params);
    return [cx, cy, r, a0, sweep];
}

/** uv distance to an arc: radial gap inside the sweep, endpoint gap outside it. */
function pointToArcDistance(x: number, y: number, params: number[]): number {
    const [cx, cy, sx, sy, ex, ey] = params;
    const r = Math.hypot(sx - cx, sy - cy);
    if (r < Precision.Distance) return Math.hypot(x - cx, y - cy);
    const [, sweep] = arcAngles(params);
    // the probe direction measured like an arc sweep from the start ray — the
    // same counter-clockwise (0, 2π] convention as arcAngles
    const [, probeSweep] = arcAngles([cx, cy, sx, sy, x, y]);
    if (probeSweep <= sweep) {
        return Math.abs(Math.hypot(x - cx, y - cy) - r);
    }
    return Math.min(Math.hypot(x - sx, y - sy), Math.hypot(x - ex, y - ey));
}

function arcSegmentMesh(
    editor: SketchEditor,
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number,
    color: number,
    lineType: "solid" | "dash" = "solid",
): EdgeMeshData {
    const plane = editor.node.plane;
    const segments = Math.max(2, Math.ceil((CIRCLE_SEGMENTS * (a1 - a0)) / (Math.PI * 2)));
    const position = new Float32Array(segments * 6);
    for (let i = 0; i < segments; i++) {
        const t0 = a0 + ((a1 - a0) * i) / segments;
        const t1 = a0 + ((a1 - a0) * (i + 1)) / segments;
        const p0 = toWorld(plane, cx + r * Math.cos(t0), cy + r * Math.sin(t0));
        const p1 = toWorld(plane, cx + r * Math.cos(t1), cy + r * Math.sin(t1));
        position.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], i * 6);
    }
    return { position, range: [], color, lineType };
}

/** uv distance to an entity's curve: segment, arc sweep, or circle circumference. */
function entityDistance(uv: [number, number], entity: SketchEntityData): number {
    const [x1, y1, x2, y2] = entity.params;
    if (entity.type === "line") return pointToSegmentDistance(uv[0], uv[1], x1, y1, x2, y2);
    if (entity.type === "arc") return pointToArcDistance(uv[0], uv[1], entity.params);
    return Math.abs(Math.hypot(uv[0] - x1, uv[1] - y1) - entity.params[2]);
}

function pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t =
        lengthSquared < 1e-12
            ? 0
            : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Normalizes two screen points into a rectangle with min ≤ max on both axes. */
function screenRect(a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect {
    return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
    };
}

/** Whether any segment of an entity's mesh crosses the screen rectangle. */
function entityCrossesRect(view: IView, mesh: EdgeMeshData, rect: ScreenRect): boolean {
    const { position } = mesh;
    const screen: XY[] = [];
    for (let i = 0; i + 2 < position.length; i += 3) {
        screen.push(view.worldToScreen(new XYZ({ x: position[i], y: position[i + 1], z: position[i + 2] })));
    }
    // the mesh holds consecutive segment pairs: (p0,p1), (p2,p3), …
    for (let i = 0; i + 1 < screen.length; i += 2) {
        if (segmentCrossesRect(screen[i], screen[i + 1], rect)) return true;
    }
    return false;
}

function pointInRect(point: XY, rect: ScreenRect): boolean {
    return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

/** Containment of either end, or a crossing of any of the rectangle's four sides. */
function segmentCrossesRect(a: XY, b: XY, rect: ScreenRect): boolean {
    if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
    const corners = [
        new XY(rect.minX, rect.minY),
        new XY(rect.maxX, rect.minY),
        new XY(rect.maxX, rect.maxY),
        new XY(rect.minX, rect.maxY),
    ];
    return corners.some((corner, i) => segmentsIntersect(a, b, corner, corners[(i + 1) % 4]));
}

/** Orientation test for two closed segments. */
function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
    const cross = (o: XY, p: XY, q: XY) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const ab1 = cross(c, d, a);
    const ab2 = cross(c, d, b);
    const cd1 = cross(a, b, c);
    const cd2 = cross(a, b, d);
    return ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) && ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0));
}
