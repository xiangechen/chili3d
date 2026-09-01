// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EdgeMeshData,
    type IEventHandler,
    type IView,
    MeshDataUtils,
    Precision,
    type ShapeMeshData,
    VisualConfig,
} from "@chili3d/core";
import {
    arcAngles,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    toUV,
    toWorld,
    worldPerPixel,
} from "../sketchModel";
import { isBadgeEventTarget } from "./sketchAnnotations";
import type { SketchEditor, SketchEntityTypeFilter } from "./sketchEditor";

const PICK_TOLERANCE_PX = 8;
const CIRCLE_SEGMENTS = 64;

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

    constructor(private readonly editor: SketchEditor) {}

    pointerToUV(view: IView, event: PointerEvent): [number, number] | undefined {
        const point = this.editor.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
        return point === undefined ? undefined : toUV(this.editor.node.plane, point);
    }

    hitTestPoint(view: IView, event: PointerEvent): SketchPointRef | undefined {
        const solver = this.editor.solver;
        const plane = this.editor.node.plane;
        let best: SketchPointRef | undefined;
        let bestDistance = PICK_TOLERANCE_PX;
        for (const entity of solver.entities()) {
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
        return best;
    }

    hitTestEntity(view: IView, event: PointerEvent, type?: SketchEntityTypeFilter): number | undefined {
        const uv = this.pointerToUV(view, event);
        if (uv === undefined) return undefined;
        const tolerance = this.worldTolerance(view, event);
        if (tolerance === undefined) return undefined;
        const types: readonly SketchEntityType[] | undefined =
            type === undefined ? undefined : typeof type === "string" ? [type] : type;

        const solver = this.editor.solver;
        let best: number | undefined;
        let bestDistance = tolerance;
        for (const entity of solver.entities()) {
            if (types !== undefined && !types.includes(entity.type)) continue;
            const [x1, y1, x2, y2] = entity.params;
            let distance: number;
            if (entity.type === "line") {
                distance = pointToSegmentDistance(uv[0], uv[1], x1, y1, x2, y2);
            } else if (entity.type === "arc") {
                distance = pointToArcDistance(uv[0], uv[1], entity.params);
            } else {
                distance = Math.abs(Math.hypot(uv[0] - x1, uv[1] - y1) - entity.params[2]);
            }
            if (distance < bestDistance) {
                bestDistance = distance;
                best = entity.id;
            }
        }
        return best;
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (!this.isEnabled) return;
        // events over an annotation badge carry badge-relative offsets; ignoring
        // them keeps the hover alive instead of clearing it with garbage uv
        if (isBadgeEventTarget(event.target)) return;
        if (this.draggingRef !== undefined) {
            const uv = this.pointerToUV(view, event);
            if (uv !== undefined) {
                this.editor.solver.dragTo(this.draggingRef, uv[0], uv[1]);
                this.updateDragPreview(view);
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
        if (ref !== undefined) {
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
        this.draggingRef = undefined;
        this.clearDragPreview(view);
        this.editor.solver.endDrag();
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

    /** Escape peels off one layer at a time: pick, constraint selection, entity selection, session. */
    private handleEscape(view: IView): void {
        if (this.editor.isPicking) {
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
        const ids = hovered !== undefined ? [hovered] : [...this.selectedEntities];
        if (ids.length === 0) return;
        this.clearHover(view);
        this.clearSelection(view);
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
        if (entityIds.length > 0) {
            const meshes = this.editor.solver
                .entities()
                .filter((entity) => entityIds.includes(entity.id))
                .map((entity) => sketchEntityMesh(this.editor, entity));
            if (meshes.length > 0) {
                this.constraintMeshId = view.document.visual.context.displayMesh(meshes);
            }
        }
        view.update();
    }

    /** Entity id of the current hover highlight (`entity:<id>` or `point:<id>:<index>`). */
    private hoveredEntityId(): number | undefined {
        const parts = this.hoverKey?.split(":");
        if (parts === undefined || parts.length < 2) return undefined;
        const id = Number(parts[1]);
        return Number.isInteger(id) ? id : undefined;
    }

    dispose(): void {
        const view = this.editor.document.application.activeView;
        if (view !== undefined) {
            this.clearHover(view);
            this.clearDragPreview(view);
            this.clearSelectionHighlight(view);
            this.clearConstraintHighlight(view);
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
            this.hoverMeshId = view.document.visual.context.displayMesh([mesh]);
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
            const entityId = this.hitTestEntity(view, event, pick?.entityType);
            const entity = entityId === undefined ? undefined : this.editor.solver.entity(entityId);
            if (entity !== undefined) {
                return { key: `entity:${entityId}`, mesh: sketchEntityMesh(this.editor, entity) };
            }
        }
        return {};
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
        const meshes = this.editor.solver
            .entities()
            .filter((entity) => this.selectedEntities.has(entity.id))
            .map((entity) => sketchEntityMesh(this.editor, entity, VisualConfig.selectedEdgeColor));
        this.selectionMeshId = view.document.visual.context.displayMesh(meshes);
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
        this.dragPreviewId = view.document.visual.context.displayMesh(sketchEntityMeshes(this.editor));
    }

    private clearDragPreview(view: IView): void {
        if (this.dragPreviewId !== undefined) {
            view.document.visual.context.removeMesh(this.dragPreviewId);
            this.dragPreviewId = undefined;
        }
    }
}

export function sketchEntityMeshes(editor: SketchEditor): ShapeMeshData[] {
    return editor.solver.entities().map((entity) => sketchEntityMesh(editor, entity));
}

export function sketchEntityMesh(
    editor: SketchEditor,
    entity: SketchEntityData,
    color: number = VisualConfig.highlightEdgeColor,
): ShapeMeshData {
    const plane = editor.node.plane;
    const [x1, y1, x2, y2] = entity.params;
    if (entity.type === "line") {
        return MeshDataUtils.createEdgeMesh(toWorld(plane, x1, y1), toWorld(plane, x2, y2), color, "solid");
    }
    if (entity.type === "arc") {
        const [cx, cy, r, a0, sweep] = arcGeometry(entity.params);
        return arcSegmentMesh(editor, cx, cy, r, a0, a0 + sweep, color);
    }
    return arcSegmentMesh(editor, x1, y1, entity.params[2], 0, Math.PI * 2, color);
}

function entityPointCount(type: SketchEntityType): number {
    return type === "line" ? 2 : type === "arc" ? 3 : 1;
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
    const [cx, cy, r, a0, sweep] = arcGeometry(params);
    if (r < Precision.Distance) return Math.hypot(x - cx, y - cy);
    const angle = (Math.atan2(y - cy, x - cx) - a0 + Math.PI * 4) % (Math.PI * 2);
    if (angle <= sweep) {
        return Math.abs(Math.hypot(x - cx, y - cy) - r);
    }
    const [, , sx, sy, ex, ey] = params;
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
    return { position, range: [], color, lineType: "solid" };
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
