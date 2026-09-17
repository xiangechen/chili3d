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
} from "@chili3d/core";
import { applyDragAutoConstraints, type DragSnap, dragSnapPosition } from "../autoConstraints";
import {
    arcAngles,
    ConstraintKind,
    entityPointCount,
    isDatumEntityId,
    isExternalEntityId,
    originRef,
    SKETCH_EDGE_LINE_WIDTH,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    toUV,
    toWorld,
    worldPerPixel,
} from "../sketchModel";
import { constraintTargetEntities } from "../solverEntities";
import { applyConstraintIcon, type BadgeSymbol, badgeSymbol, isBadgeEventTarget } from "./sketchAnnotations";
import style from "./sketchAnnotations.module.css";
import type { SketchEditor, SketchEntityTypeFilter } from "./sketchEditor";

const PICK_TOLERANCE_PX = 8;
const CIRCLE_SEGMENTS = 64;
const DATUM_X_AXIS_COLOR = 0xcc5555;
const DATUM_Y_AXIS_COLOR = 0x55aa55;
/** External references (edges of another part): SolidWorks-style purple. */
const EXTERNAL_REF_COLOR = 0x9b59b6;
/** External references whose source edge no longer resolves. */
const EXTERNAL_DANGLING_COLOR = 0xdd4444;
/** Live-snap target accent — distinct from the green hover/selection and blue dimensions. */
const SNAP_HIGHLIGHT_COLOR = 0xff9800;

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
    private snapTargetMeshId?: number;
    private snapHintItem?: IDisposable;
    private controller?: AsyncController;

    constructor(private readonly editor: SketchEditor) {
        this.showDatum();
        this.showExternalRefs();
    }

    setController(view: IView, controller: AsyncController | undefined) {
        if (this.controller === controller) {
            return;
        }
        controller?.onCancelled((r) => this.handleEscape(view));
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

    /** Re-renders the external references after they were added, removed or re-resolved. */
    refreshExternalRefs(): void {
        const view = this.editor.document.application.activeView;
        if (view !== undefined && this.externalDisplayId !== undefined) {
            view.document.visual.context.removeMesh(this.externalDisplayId);
            this.externalDisplayId = undefined;
        }
        this.showExternalRefs();
        view?.update();
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
            const px = worldPerPixel(view, this.editor.node.plane, view.width / 2, view.height / 2);
            visible = px === undefined ? 0 : (px * Math.hypot(view.width, view.height)) / 2;
        }
        return Math.max(100, extent * 1.5, visible);
    }

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

    pointerMove(view: IView, event: PointerEvent): void {
        if (!this.isEnabled) return;
        // a dimension label drag is tracked on window by the annotation manager;
        // the viewport must not run its hover/drag logic alongside it
        if (this.editor.annotations.isLabelDragging) return;
        // events over an annotation badge carry badge-relative offsets; ignoring
        // them keeps the hover alive instead of clearing it with garbage uv
        if (isBadgeEventTarget(event.target)) return;
        if (this.draggingRef !== undefined) {
            const uv = this.pointerToUV(view, event);
            if (uv !== undefined) {
                const tolerance = this.editor.screenTolerance();
                const { position, snap } = dragSnapPosition(this.editor.solver, this.draggingRef, uv, {
                    pointTolerance: tolerance,
                    lineTolerance: tolerance,
                });
                this.editor.solver.dragTo(this.draggingRef, position[0], position[1]);
                this.updateDragPreview(view);
                this.showSnapFeedback(view, snap);
                this.editor.annotations.refresh();
            }
            return;
        }
        const preview = this.editor.activePick?.preview;
        if (preview !== undefined) {
            preview(this.pointerToUV(view, event));
        }
        this.updateHover(view, event);
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (!this.isEnabled) return;
        // a click while a dimension label follows the cursor drops it here
        if (this.editor.annotations.isLabelDragging) {
            this.editor.annotations.endLabelDrag(true);
            return;
        }
        // pick handling first: a right-click must be able to cancel an active pick
        if (this.editor.handlePickPointerDown(view, event)) {
            // the pick consumed the click; drop the pre-click hover highlight and
            // force a repaint so it disappears even if the mouse stays put
            this.clearHover(view);
            this.syncAnnotationHighlights();
            view.update();
            return;
        }
        if (event.button !== 0) return;

        const ref = this.hitTestPoint(view, event);
        // the datum origin and external references are pickable for constraints but never draggable
        if (ref !== undefined && !isDatumEntityId(ref.entityId) && !isExternalEntityId(ref.entityId)) {
            this.beginPointDrag(view, ref);
            return;
        }

        // no point hit: left-click selects the entity under the cursor
        const entityId = this.hitTestEntity(view, event);
        if (entityId === undefined) {
            // blank click drops both the constraint-badge and entity selections
            this.editor.annotations.clearConstraintSelection();
            this.clearSelection(view);
            return;
        }
        this.selectEntity(view, entityId, event.shiftKey);
    }

    private beginPointDrag(view: IView, ref: SketchPointRef): void {
        this.draggingRef = ref;
        this.clearHover(view);
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

    pointerUp(view: IView, _event: PointerEvent): void {
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
        if (this.editor.annotations.isLabelDragging) {
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
        // a label being placed follows the cursor — it is the delete target
        const draggingLabel = this.editor.annotations.draggingLabelId;
        if (draggingLabel !== undefined) {
            this.editor.deleteConstraints([draggingLabel]);
            return;
        }
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
        const view = this.editor.view;
        this.clearSnapFeedback();
        if (!view.isClosed) {
            this.clearHover(view);
            this.clearDragPreview(view);
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
        }
        this.selectedEntities.clear();
        this.draggingRef = undefined;
    }

    /** Pick tolerance converted to sketch-plane units at the event position. */
    private worldTolerance(view: IView, event: PointerEvent): number | undefined {
        const size = worldPerPixel(view, this.editor.node.plane, event.offsetX, event.offsetY);
        return size === undefined ? undefined : size * PICK_TOLERANCE_PX;
    }

    private updateHover(view: IView, event: PointerEvent): void {
        const { key, mesh } = this.computeHoverTarget(view, event);

        if (key === this.hoverKey) return;
        if (key === undefined && this.hoverKey !== undefined && this.isCrossingToBadge(view, event)) {
            return;
        }
        this.clearHover(view);
        if (mesh !== undefined) {
            this.hoverMeshId = view.document.visual.context.displayMesh([mesh], { onTop: true });
            this.hoverKey = key;
        }
        this.syncAnnotationHighlights();
    }

    private computeHoverTarget(view: IView, event: PointerEvent): { key?: string; mesh?: ShapeMeshData } {
        const pick = this.editor.activePick;

        if (pick === undefined || pick.kind === "point") {
            const ref = this.hitTestPoint(view, event);
            if (ref !== undefined) {
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
        }

        if (pick === undefined || pick.kind === "entity") {
            const entityId = this.hitTestEntity(view, event, pick?.entityType, pick?.datum ?? false);
            if (entityId !== undefined && isDatumEntityId(entityId)) {
                return {
                    key: `entity:${entityId}`,
                    mesh: this.datumAxisMesh(entityId, VisualConfig.highlightEdgeColor),
                };
            }
            const entity = entityId === undefined ? undefined : this.editor.solver.entity(entityId);
            if (entity !== undefined) {
                return { key: `entity:${entityId}`, mesh: sketchEntityMesh(this.editor, entity) };
            }
        }
        return {};
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
        this.dragPreviewId = view.document.visual.context.displayMesh(sketchEntityMeshes(this.editor), {
            onTop: true,
        });
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

    /** Displays the highlighted snap target (a point marker or a line/axis highlight); returns its mesh id. */
    private displaySnapTarget(view: IView, snap: DragSnap): number | undefined {
        const plane = this.editor.node.plane;
        const mesh =
            snap.kind === "point"
                ? MeshDataUtils.createVertexMesh(
                      toWorld(plane, snap.position[0], snap.position[1]),
                      VisualConfig.editVertexSize,
                      SNAP_HIGHLIGHT_COLOR,
                  )
                : this.snapLineHighlight(snap.lineRefs[0].entityId, SNAP_HIGHLIGHT_COLOR);
        return mesh === undefined
            ? undefined
            : view.document.visual.context.displayMesh([mesh], { onTop: true });
    }

    /** Highlight mesh for a line/axis snap target, or undefined. */
    private snapLineHighlight(targetId: number, color: number): ShapeMeshData | undefined {
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
        const px = worldPerPixel(view, plane, view.width / 2, view.height / 2) ?? 1;
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

export function sketchEntityMeshes(editor: SketchEditor): ShapeMeshData[] {
    return editor.solver.entities().map((entity) => sketchEntityMesh(editor, entity));
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
    const kind = snap.kind === "point" ? ConstraintKind.P2PCoincident : ConstraintKind.PointOnLine;
    return badgeSymbol(kind) ?? { label: snap.kind === "point" ? "◇" : "⊙" };
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
