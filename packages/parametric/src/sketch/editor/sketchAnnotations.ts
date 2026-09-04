// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    CommandStore,
    type EdgeMeshData,
    type IDisposable,
    type IView,
} from "@chili3d/core";
import {
    ConstraintKind,
    entityRadius,
    isDatumEntityId,
    pointRefKey,
    type SketchConstraintData,
    type SketchPointRef,
    toUV,
    toWorld,
    worldPerPixel,
} from "../sketchModel";
import type { SketchSolver } from "../solver";
import {
    angleDimension,
    axisDistanceDimension,
    type DimensionAnchor,
    type DimensionGeometry,
    distanceDimension,
    lineIntersection,
    pointLineDistanceDimension,
    pointLineFoot,
    pointLineSignedDistance,
    radiusDimension,
    segmentOffset,
    toDisplayDatum,
} from "./dimensionLayout";
import style from "./sketchAnnotations.module.css";

/**
 * Badge content for the no-datum symbol constraints. `command` identifies the
 * constraint command whose decorator icon the badge renders; `label` is only a
 * fallback shown when that icon is unavailable (commands unregistered in unit
 * tests, or a non-string icon kind) — in the app the badge always shows the icon.
 */
const CONSTRAINT_BADGES: Partial<Record<ConstraintKind, { label: string; command: CommandKeys }>> = {
    [ConstraintKind.Horizontal]: { label: "H", command: "constraint.horizontal" },
    [ConstraintKind.Vertical]: { label: "V", command: "constraint.vertical" },
    [ConstraintKind.P2PCoincident]: { label: "◇", command: "constraint.coincident" },
    [ConstraintKind.Parallel]: { label: "∥", command: "constraint.parallel" },
    [ConstraintKind.Perpendicular]: { label: "⊥", command: "constraint.perpendicular" },
    [ConstraintKind.EqualLength]: { label: "=", command: "constraint.equal" },
    [ConstraintKind.EqualRadius]: { label: "=", command: "constraint.equal" },
    [ConstraintKind.EqualArcRadius]: { label: "=", command: "constraint.equal" },
    [ConstraintKind.TangentLineCircle]: { label: "T", command: "constraint.tangent" },
    [ConstraintKind.TangentCircleCircle]: { label: "T", command: "constraint.tangent" },
    [ConstraintKind.TangentLineArc]: { label: "T", command: "constraint.tangent" },
    [ConstraintKind.TangentArcArc]: { label: "T", command: "constraint.tangent" },
    [ConstraintKind.TangentCircleArc]: { label: "T", command: "constraint.tangent" },
    [ConstraintKind.PointOnLine]: { label: "⊙", command: "constraint.pointOn" },
    [ConstraintKind.PointOnCircle]: { label: "⊙", command: "constraint.pointOn" },
    [ConstraintKind.PointOnArc]: { label: "⊙", command: "constraint.pointOn" },
    [ConstraintKind.Midpoint]: { label: "M", command: "constraint.midpoint" },
    [ConstraintKind.Symmetric]: { label: "S", command: "constraint.symmetric" },
    [ConstraintKind.HorizontalAlign]: { label: "⬌", command: "constraint.horizontalAlign" },
    [ConstraintKind.VerticalAlign]: { label: "⬍", command: "constraint.verticalAlign" },
    [ConstraintKind.Fix]: { label: "⚓", command: "constraint.fix" },
};

type BadgeSymbol = { label: string; icon?: string };

/** Badge content for a constraint kind; the icon comes from the command's `@command` decorator. */
function badgeSymbol(kind: ConstraintKind): BadgeSymbol | undefined {
    const entry = CONSTRAINT_BADGES[kind];
    if (entry === undefined) return undefined;
    const icon = CommandStore.getComandData(entry.command)?.icon;
    return { label: entry.label, icon: typeof icon === "string" ? icon : undefined };
}

/** Badge center offset from its geometry, in screen pixels. */
const BADGE_OFFSET_PX = 18;
/** How close the cursor must stay to a visible badge for the entity hover to survive. */
const BADGE_REACH_PX = 30;
/** Pointer travel (screen px) before a badge press becomes a label drag. */
const LABEL_DRAG_THRESHOLD_PX = 4;
/**
 * Blue for dimension graphics — matches the dark-theme `--primary-color` (#4a9eff)
 * behind the badges' `--badge-accent`; green is reserved for hover/selection highlights.
 */
const DIMENSION_COLOR = 0x4a9eff;

/**
 * True when a pointer event target is (or is inside) an annotation badge.
 * Such events bubble to the viewport with badge-relative offsets, so the
 * sketch event handler must ignore them — the badge's own mouseenter/leave
 * handlers drive highlighting while it is hovered.
 */
export function isBadgeEventTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(`.${style.badge}`) !== null;
}

/** Live preview shown while a dimension is being placed. */
export type DimensionPreview =
    /** Plain connecting line (e.g. from the first picked point to the cursor). */
    | {
          readonly kind: "segment";
          readonly p1: [number, number];
          readonly p2: [number, number];
      }
    | {
          readonly kind: "distance";
          readonly p1: [number, number];
          readonly p2: [number, number];
          readonly position: [number, number];
      }
    | {
          readonly kind: "radius";
          readonly center: [number, number];
          readonly radius: number;
          readonly position: [number, number];
      }
    | {
          readonly kind: "pointLine";
          readonly p: [number, number];
          readonly l1: [number, number];
          readonly l2: [number, number];
          readonly position: [number, number];
      }
    | {
          readonly kind: "angle";
          readonly a1: [number, number];
          readonly a2: [number, number];
          readonly b1: [number, number];
          readonly b2: [number, number];
          readonly position: [number, number];
      }
    | {
          readonly kind: "axisDistance";
          readonly p1: [number, number];
          readonly p2: [number, number];
          readonly axis: "h" | "v";
          readonly position: [number, number];
      };

/**
 * Renders constraint symbols (toolbar constraint icons) and datum dimensions (extension lines,
 * arrows, value text) anchored to sketch geometry. Recreated wholesale on each
 * refresh — sketches are small, so this stays simple. Dimension graphics use
 * pixel-relative sizes, so the camera controller is subscribed to re-render on zoom.
 * Constraint symbols are shown while one of their referenced entities is highlighted
 * (hovered, dragged or selected), or while the badge itself is hovered/selected;
 * they are suppressed entirely while a pick is active so they cannot occlude the
 * geometry being picked. Datum dimensions stay visible. Symbol badges are offset a
 * screen-constant distance from their geometry so they never cover the clickable
 * line/point; multi-entity constraints (parallel, tangent, ...) get one badge per
 * referenced entity, so each badge stays next to — and reachable from — its own
 * geometry however far apart the entities are. The event handler keeps the entity
 * hover alive while the cursor crosses the gap to a badge (`isNearVisibleBadge`). Badges are interactive: hovering
 * one highlights its referenced entities, clicking a symbol badge selects it,
 * selected constraints can be deleted, and double-clicking a datum badge re-opens
 * its value input. Datum badges are repositioned by dragging: either press-drag-release,
 * or click to pick the label up (it then follows the cursor) and click again —
 * on the canvas or on the label itself — to drop it; Escape cancels, restoring the
 * previous anchor. The new anchor is committed (undoable) on drop.
 */
export class SketchAnnotationManager implements IDisposable {
    private items: IDisposable[] = [];
    private badgeElements = new Map<number, HTMLElement[]>();
    private badgeAnchors: { u: number; v: number; entityIds: number[] }[] = [];
    private meshId?: number;
    private disposed = false;
    private highlightedEntities = new Set<number>();
    private hoveredConstraint?: number;
    private readonly selectedConstraints = new Set<number>();
    private rebuilding = false;
    private suppressSymbols = false;
    private dimensionPreview?: DimensionPreview;
    /**
     * Active datum label drag. `held` tracks the mouse button: a press-drag
     * commits on release; a click without movement releases the button with
     * `held = false`, leaving the label following the cursor until the next
     * click drops it. `original` restores the anchor on cancel.
     */
    private labelDrag?: {
        readonly id: number;
        readonly startX: number;
        readonly startY: number;
        readonly original?: DimensionAnchor;
        held: boolean;
        moved: boolean;
    };
    private dragCleanup?: () => void;
    private readonly onCameraChanged = () => this.refresh();

    constructor(
        private readonly view: IView,
        private readonly solver: SketchSolver,
        private readonly anchors: Map<number, DimensionAnchor>,
        private readonly onHighlightEntities: (entityIds: number[]) => void = () => {},
        private readonly onEditDatum: (constraintId: number) => void = () => {},
        private readonly onAnchorDragEnd: (constraintId: number) => void = () => {},
    ) {
        // optional call: mock camera controllers in unit tests may lack the event API
        view.cameraController.onPropertyChanged?.(this.onCameraChanged);
    }

    /** True while a datum label is being dragged or follows the cursor for placement. */
    get isLabelDragging(): boolean {
        return this.labelDrag !== undefined && (this.labelDrag.moved || !this.labelDrag.held);
    }

    /** Constraint id whose label is being dragged/placed, if any. */
    get draggingLabelId(): number | undefined {
        return this.labelDrag?.id;
    }

    get hoveredConstraintId(): number | undefined {
        return this.hoveredConstraint;
    }

    get selectedConstraintIds(): number[] {
        return [...this.selectedConstraints];
    }

    /** Shows constraint symbols for these entities; refresh is skipped when unchanged. */
    setHighlightedEntities(entityIds: Iterable<number>): void {
        if (this.disposed) return;
        const next = new Set(entityIds);
        if (
            next.size === this.highlightedEntities.size &&
            [...next].every((id) => this.highlightedEntities.has(id))
        ) {
            return;
        }
        this.highlightedEntities = next;
        this.refresh();
    }

    clearConstraintSelection(): void {
        if (this.selectedConstraints.size === 0) return;
        this.selectedConstraints.clear();
        this.applySelectionClasses();
    }

    /** Drops deleted constraints from the hover/selection state. */
    deselectConstraints(constraintIds: Iterable<number>): void {
        let changed = false;
        let hoverCleared = false;
        for (const id of constraintIds) {
            if (this.labelDrag?.id === id) {
                // the delete flow re-renders via solve — just drop the drag session
                this.labelDrag = undefined;
                this.dragCleanup?.();
            }
            if (this.hoveredConstraint === id) {
                this.hoveredConstraint = undefined;
                hoverCleared = true;
            }
            changed = this.selectedConstraints.delete(id) || changed;
        }
        // a deleted hovered badge leaves its entity highlight behind otherwise
        if (hoverCleared) this.onHighlightEntities([]);
        if (changed) this.applySelectionClasses();
    }

    refresh(): void {
        if (this.disposed) return;
        // DOM removal fires mouseleave on a hovered badge; suppress it so the
        // badge does not vanish under a stationary cursor mid-rebuild
        this.rebuilding = true;
        this.disposeItems();
        this.rebuilding = false;
        const px = this.pixelSize();
        const segments: DimensionGeometry["segments"] = [];
        this.addConstraintGraphics(px, segments);
        this.addPreviewGraphics(px, segments);

        if (segments.length > 0) {
            this.meshId = this.view.document.visual.context.displayMesh([this.toEdgeMesh(segments)], {
                onTop: true,
            });
        }
        this.view.update();
    }

    private addConstraintGraphics(px: number, segments: DimensionGeometry["segments"]): void {
        const coincidentGroups = new Set<string>();
        for (const constraint of this.solver.toData().constraints) {
            switch (constraint.kind) {
                case ConstraintKind.Horizontal:
                case ConstraintKind.Vertical:
                    this.addAxisBadge(constraint, px);
                    break;
                case ConstraintKind.P2PCoincident:
                    this.addCoincidentBadge(constraint, px, coincidentGroups);
                    break;
                case ConstraintKind.P2PDistance:
                case ConstraintKind.Radius:
                case ConstraintKind.P2LDistance:
                case ConstraintKind.Angle:
                case ConstraintKind.HorizontalDistance:
                case ConstraintKind.VerticalDistance:
                    this.addDatumDimension(constraint, px, segments);
                    break;
                default:
                    this.addSymbolBadge(constraint, px);
                    break;
            }
        }
    }

    private addAxisBadge(constraint: SketchConstraintData, px: number): void {
        if (!this.isConstraintVisible(constraint)) return;
        const p1 = this.solver.pointOf(constraint.refs[0]);
        const p2 = this.solver.pointOf(constraint.refs[1]);
        // offset along the segment normal so the badge does not cover the line
        const [u, v] = offsetFromSegment(p1, p2, BADGE_OFFSET_PX * px);
        const symbol = badgeSymbol(constraint.kind);
        this.addBadge(symbol?.label ?? "", u, v, constraint, constraint.refs, false, symbol?.icon);
    }

    /**
     * Symbol badges for the no-datum constraints (parallel, tangent, fix, ...) —
     * one badge per referenced entity (or constrained point), each anchored next to
     * its own geometry so it stays visible-reachable no matter how far apart the
     * constrained entities are.
     */
    private addSymbolBadge(constraint: SketchConstraintData, px: number): void {
        const symbol = badgeSymbol(constraint.kind);
        if (symbol === undefined) return;
        // an arc's structural PointOnArc (all refs on the arc itself) stays invisible —
        // it is part of the entity, deleting it would break the arc geometry
        if (
            constraint.kind === ConstraintKind.PointOnArc &&
            constraint.refs.every((r) => r.entityId === constraint.refs[0].entityId)
        ) {
            return;
        }
        if (!this.isConstraintVisible(constraint)) return;
        const anchors = this.symbolAnchors(constraint, px).filter(
            // drop duplicates (e.g. a symmetric constraint on the same point twice)
            (anchor, i, all) =>
                all.findIndex((b) => Math.hypot(anchor[0] - b[0], anchor[1] - b[1]) < 1e-9) === i,
        );
        for (const [u, v] of anchors) {
            this.addBadge(symbol.label, u, v, constraint, constraint.refs, false, symbol.icon);
        }
    }

    /** Per-entity (or per-point) badge anchors of a symbol constraint. */
    private symbolAnchors(constraint: SketchConstraintData, px: number): [number, number][] {
        switch (constraint.kind) {
            case ConstraintKind.PointOnLine:
            case ConstraintKind.PointOnCircle:
            case ConstraintKind.PointOnArc:
            case ConstraintKind.Midpoint:
            case ConstraintKind.Fix:
                // the constraint is about this one point
                return [pointBadgeAnchor(this.solver.pointOf(constraint.refs[0]), px)];
            case ConstraintKind.HorizontalAlign:
            case ConstraintKind.VerticalAlign:
                return constraint.refs.map((ref) => pointBadgeAnchor(this.solver.pointOf(ref), px));
            case ConstraintKind.Symmetric:
                // the point pair carries the constraint; the symmetry axis is context
                return constraint.refs
                    .slice(0, 2)
                    .map((ref) => pointBadgeAnchor(this.solver.pointOf(ref), px));
            default: {
                const hint = this.refsMidpoint(constraint.refs);
                const entityIds = [...new Set(constraint.refs.map((r) => r.entityId))];
                return entityIds
                    .map((id) => this.entityBadgeAnchor(id, px, hint))
                    .filter((anchor) => anchor !== undefined);
            }
        }
    }

    /**
     * Anchor beside an entity's own geometry: normal offset from a line's midpoint;
     * radial offset from a circle (facing away from the constraint's other party, so
     * tangent/equal partners do not stack) or from an arc's mid-sweep direction.
     * Datum axes are unit stubs at the origin, so the anchor sits beside the
     * projection of the constraint midpoint onto the axis instead.
     */
    private entityBadgeAnchor(
        entityId: number,
        px: number,
        hint: [number, number],
    ): [number, number] | undefined {
        const entity = this.solver.entity(entityId);
        if (entity === undefined) return undefined;
        const off = BADGE_OFFSET_PX * px;
        if (entity.type === "line") {
            const p1: [number, number] = [entity.params[0], entity.params[1]];
            const p2: [number, number] = [entity.params[2], entity.params[3]];
            return isDatumEntityId(entityId)
                ? projectBeside(p1, p2, hint, off)
                : offsetFromSegment(p1, p2, off);
        }
        const [cx, cy] = entity.params;
        const radius =
            entity.type === "circle"
                ? entity.params[2]
                : Math.hypot(entity.params[2] - cx, entity.params[3] - cy);
        let direction: [number, number] | undefined;
        if (entity.type === "arc") {
            // mid-sweep direction keeps the badge next to the visible arc stroke
            const mx = (entity.params[2] + entity.params[4]) / 2 - cx;
            const my = (entity.params[3] + entity.params[5]) / 2 - cy;
            const length = Math.hypot(mx, my);
            if (length > 1e-9) direction = [mx / length, my / length];
        }
        if (direction === undefined) {
            const [du, dv] = [cx - hint[0], cy - hint[1]];
            const length = Math.hypot(du, dv);
            direction = length < 1e-9 ? [Math.SQRT1_2, Math.SQRT1_2] : [du / length, dv / length];
        }
        return [cx + direction[0] * (radius + off), cy + direction[1] * (radius + off)];
    }

    /** Average of the referenced points — generic badge anchor for multi-point constraints. */
    private refsMidpoint(refs: readonly SketchPointRef[]): [number, number] {
        let u = 0;
        let v = 0;
        for (const ref of refs) {
            const [x, y] = this.solver.pointOf(ref);
            u += x;
            v += y;
        }
        return [u / refs.length, v / refs.length];
    }

    private addCoincidentBadge(constraint: SketchConstraintData, px: number, shownGroups: Set<string>): void {
        const group = this.solver.coincidentGroup(constraint.refs[0]);
        const key = group.map(pointRefKey).sort().join("|");
        if (shownGroups.has(key)) return;
        shownGroups.add(key);
        if (!this.isConstraintVisible(constraint, group)) return;
        const [u, v] = this.solver.pointOf(group[0]);
        // diagonal offset so the badge does not cover the shared point
        const off = BADGE_OFFSET_PX * px * Math.SQRT1_2;
        const symbol = badgeSymbol(ConstraintKind.P2PCoincident);
        this.addBadge(symbol?.label ?? "", u + off, v + off, constraint, group, false, symbol?.icon);
    }

    private addDatumDimension(
        constraint: SketchConstraintData,
        px: number,
        segments: DimensionGeometry["segments"],
    ): void {
        const geometry = this.dimensionGeometry(constraint, px);
        if (geometry === undefined) return;
        segments.push(...geometry.segments);
        const prefix = constraint.kind === ConstraintKind.Radius ? "R" : "";
        const suffix = constraint.kind === ConstraintKind.Angle ? "°" : "";
        const value = toDisplayDatum(constraint.kind, constraint.datum ?? 0);
        this.addBadge(
            `${prefix}${value.toFixed(constraint.kind === ConstraintKind.Angle ? 1 : 2)}${suffix}`,
            ...geometry.textPosition,
            constraint,
            constraint.refs,
            true,
        );
    }

    private dimensionGeometry(constraint: SketchConstraintData, px: number): DimensionGeometry | undefined {
        const anchor = this.anchors.get(constraint.id);
        const offset = anchor?.kind === "offset" ? anchor.offset : 0;
        switch (constraint.kind) {
            case ConstraintKind.P2PDistance:
                return distanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    offset,
                    px,
                );
            case ConstraintKind.Radius:
                return this.radiusGeometry(constraint, px);
            case ConstraintKind.HorizontalDistance:
            case ConstraintKind.VerticalDistance:
                return axisDistanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    constraint.kind === ConstraintKind.HorizontalDistance ? "h" : "v",
                    offset,
                    px,
                );
            case ConstraintKind.P2LDistance:
                return pointLineDistanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    this.solver.pointOf(constraint.refs[2]),
                    offset,
                    px,
                );
            case ConstraintKind.Angle:
                return this.angleGeometry(constraint, px);
            default:
                return undefined;
        }
    }

    private angleGeometry(constraint: SketchConstraintData, px: number): DimensionGeometry | undefined {
        const [a1, a2, b1, b2] = constraint.refs.map((r) => this.solver.pointOf(r));
        const vertex = lineIntersection(a1, a2, b1, b2) ?? [
            (a1[0] + a2[0] + b1[0] + b2[0]) / 4,
            (a1[1] + a2[1] + b1[1] + b2[1]) / 4,
        ];
        const anchor = this.anchors.get(constraint.id);
        // the anchor vector sets the arc radius: label distance shrinks towards the arc
        const radius = anchor?.kind === "vector" ? Math.hypot(anchor.dx, anchor.dy) * 0.7 : 0;
        return angleDimension(
            vertex,
            [a2[0] - a1[0], a2[1] - a1[1]],
            [b2[0] - b1[0], b2[1] - b1[1]],
            radius,
            px,
        );
    }

    private addPreviewGraphics(px: number, segments: DimensionGeometry["segments"]): void {
        const preview = this.dimensionPreview;
        if (preview === undefined) return;
        if (preview.kind === "segment") {
            segments.push([preview.p1[0], preview.p1[1], preview.p2[0], preview.p2[1]]);
            return;
        }
        if (preview.kind === "distance") {
            const offset = segmentOffset(preview.p1, preview.p2, preview.position);
            const geometry = distanceDimension(preview.p1, preview.p2, offset, px);
            if (geometry === undefined) return;
            segments.push(...geometry.segments);
            const value = Math.hypot(preview.p2[0] - preview.p1[0], preview.p2[1] - preview.p1[1]);
            this.addPreviewBadge(value.toFixed(2), geometry.textPosition);
            return;
        }
        if (preview.kind === "radius") {
            const [cx, cy] = preview.center;
            const geometry = radiusDimension(
                preview.center,
                preview.radius,
                preview.position[0] - cx,
                preview.position[1] - cy,
                px,
            );
            segments.push(...geometry.segments);
            this.addPreviewBadge(`R${preview.radius.toFixed(2)}`, geometry.textPosition);
            return;
        }
        if (preview.kind === "pointLine") {
            const foot = pointLineFoot(preview.p, preview.l1, preview.l2);
            if (foot === undefined) return;
            const offset = segmentOffset(preview.p, foot, preview.position);
            const geometry = pointLineDistanceDimension(preview.p, preview.l1, preview.l2, offset, px);
            if (geometry === undefined) return;
            segments.push(...geometry.segments);
            this.addPreviewBadge(
                pointLineSignedDistance(preview.p, preview.l1, preview.l2).toFixed(2),
                geometry.textPosition,
            );
            return;
        }
        if (preview.kind === "axisDistance") {
            const base =
                preview.axis === "h"
                    ? (preview.p1[1] + preview.p2[1]) / 2
                    : (preview.p1[0] + preview.p2[0]) / 2;
            const offset = (preview.axis === "h" ? preview.position[1] : preview.position[0]) - base;
            const geometry = axisDistanceDimension(preview.p1, preview.p2, preview.axis, offset, px);
            if (geometry === undefined) return;
            segments.push(...geometry.segments);
            const value =
                preview.axis === "h" ? preview.p2[0] - preview.p1[0] : preview.p2[1] - preview.p1[1];
            this.addPreviewBadge(value.toFixed(2), geometry.textPosition);
            return;
        }
        // angle preview
        const vertex = lineIntersection(preview.a1, preview.a2, preview.b1, preview.b2) ?? [
            (preview.a1[0] + preview.a2[0] + preview.b1[0] + preview.b2[0]) / 4,
            (preview.a1[1] + preview.a2[1] + preview.b1[1] + preview.b2[1]) / 4,
        ];
        const d1: [number, number] = [preview.a2[0] - preview.a1[0], preview.a2[1] - preview.a1[1]];
        const d2: [number, number] = [preview.b2[0] - preview.b1[0], preview.b2[1] - preview.b1[1]];
        const radius = Math.hypot(preview.position[0] - vertex[0], preview.position[1] - vertex[1]) * 0.7;
        const geometry = angleDimension(vertex, d1, d2, radius, px);
        if (geometry === undefined) return;
        segments.push(...geometry.segments);
        const len1 = Math.hypot(d1[0], d1[1]);
        const len2 = Math.hypot(d2[0], d2[1]);
        if (len1 < 1e-12 || len2 < 1e-12) return;
        const cos = Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1]) / (len1 * len2)));
        this.addPreviewBadge(`${((Math.acos(cos) * 180) / Math.PI).toFixed(1)}°`, geometry.textPosition);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.dragCleanup?.();
        this.view.cameraController.removePropertyChanged?.(this.onCameraChanged);
        this.disposeItems();
    }

    /**
     * Hides the constraint symbol badges (H / V / ◇) while a pick is active —
     * they pop up next to the hovered geometry and occlude the very point or
     * entity the user is trying to click. Datum dimensions stay visible.
     */
    set suppressConstraintSymbols(value: boolean) {
        if (this.disposed || value === this.suppressSymbols) return;
        this.suppressSymbols = value;
        this.refresh();
    }

    /** Sets (or clears, with undefined) the live dimension preview. */
    setDimensionPreview(preview: DimensionPreview | undefined): void {
        if (this.disposed) return;
        this.dimensionPreview = preview;
        this.refresh();
    }

    private isConstraintVisible(
        constraint: SketchConstraintData,
        refs: readonly SketchPointRef[] = constraint.refs,
    ): boolean {
        if (this.suppressSymbols) return false;
        return (
            this.hoveredConstraint === constraint.id ||
            this.selectedConstraints.has(constraint.id) ||
            refs.some((ref) => this.highlightedEntities.has(ref.entityId))
        );
    }

    private radiusGeometry(constraint: SketchConstraintData, px: number): DimensionGeometry | undefined {
        const entity = this.solver.entity(constraint.refs[0].entityId);
        if (entity === undefined) return undefined;
        const center: [number, number] = [entity.params[0], entity.params[1]];
        const radius = entityRadius(entity);
        const anchor = this.anchors.get(constraint.id);
        const [dx, dy] = anchor?.kind === "vector" ? [anchor.dx, anchor.dy] : [radius, radius];
        return radiusDimension(center, radius, dx, dy, px);
    }

    /** World units per screen pixel at the view center (falls back to 1). */
    private pixelSize(): number {
        return worldPerPixel(this.view, this.solver.plane, this.view.width / 2, this.view.height / 2) ?? 1;
    }

    private toEdgeMesh(segments: [number, number, number, number][]): EdgeMeshData {
        const position = new Float32Array(segments.length * 6);
        segments.forEach(([x1, y1, x2, y2], i) => {
            const p1 = toWorld(this.solver.plane, x1, y1);
            const p2 = toWorld(this.solver.plane, x2, y2);
            position.set([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], i * 6);
        });
        return { position, range: [], color: DIMENSION_COLOR, lineType: "solid" };
    }

    /** Preview badge: not interactive — the position pick click must reach the viewport. */
    private addPreviewBadge(text: string, [u, v]: [number, number]): void {
        this.items.push(
            this.view.htmlText(text, toWorld(this.solver.plane, u, v), {
                hideDelete: true,
                className: `${style.badge} ${style.preview}`,
            }),
        );
    }

    private addBadge(
        text: string,
        u: number,
        v: number,
        constraint: SketchConstraintData,
        refs: readonly SketchPointRef[] = constraint.refs,
        draggable = false,
        icon?: string,
    ): void {
        const id = constraint.id;
        const entityIds = [...new Set(refs.map((r) => r.entityId))];
        this.badgeAnchors.push({ u, v, entityIds });
        this.items.push(
            this.view.htmlText(text, toWorld(this.solver.plane, u, v), {
                hideDelete: true,
                interactive: true,
                className: style.badge,
                onCreated: (element) => {
                    const list = this.badgeElements.get(id) ?? [];
                    list.push(element);
                    this.badgeElements.set(id, list);
                    element.classList.toggle(style.selected, this.selectedConstraints.has(id));
                    if (icon !== undefined) {
                        element.classList.add(style.symbol);
                        element.replaceChildren(badgeIcon(icon));
                    }
                    if (draggable) {
                        element.classList.add(style.draggable);
                        element.addEventListener("pointerdown", (e) => this.beginLabelDrag(id, e));
                    }
                },
                onMouseEnter: () => {
                    this.hoveredConstraint = id;
                    this.onHighlightEntities(entityIds);
                },
                onMouseLeave: () => {
                    if (this.rebuilding || this.hoveredConstraint !== id) return;
                    this.hoveredConstraint = undefined;
                    this.onHighlightEntities([]);
                },
                // datum badges (dimensions) can be edited; symbol badges cannot
                onDoubleClick:
                    constraint.datum === undefined && constraint.datums === undefined
                        ? undefined
                        : (event) => {
                              event.stopPropagation();
                              this.onEditDatum(id);
                          },
                // a click on a draggable datum badge picks its label up for
                // placement instead of toggling the constraint selection
                onClick: draggable
                    ? undefined
                    : (event) => {
                          event.stopPropagation();
                          this.toggleSelection(id, event.shiftKey);
                      },
            }),
        );
    }

    /**
     * True while the cursor is close enough to a visible badge of this entity to
     * reach it — the event handler uses this to keep the entity hover (and thus
     * the badge) alive across the gap between the geometry and the offset badge.
     */
    isNearVisibleBadge(entityId: number, uv: [number, number]): boolean {
        if (this.disposed) return false;
        const tolerance = BADGE_REACH_PX * this.pixelSize();
        return this.badgeAnchors.some(
            (anchor) =>
                anchor.entityIds.includes(entityId) &&
                Math.hypot(anchor.u - uv[0], anchor.v - uv[1]) < tolerance,
        );
    }

    /**
     * Repositions a datum label by dragging its badge. Both gestures are supported:
     * press-drag-release, and click-move-click (a press released without travel picks
     * the label up; it then follows the cursor and the next click — anywhere, even on
     * the label itself — drops it). The anchor is recomputed from the pointer on every
     * move; the refresh rebuilds the badge mid-drag, so the session listens on window.
     * The window listeners use the capture phase: interactive badges stopPropagation
     * pointerdown/up (threeView), and since the label follows the cursor the release
     * usually lands on the badge — a bubble-phase listener would never see it and the
     * drag would stick.
     */
    private beginLabelDrag(constraintId: number, event: PointerEvent): void {
        if (event.button !== 0 || this.disposed) return;
        event.preventDefault();
        if (this.labelDrag !== undefined) {
            // a click while the label follows the cursor drops it in place
            this.endLabelDrag(true);
            return;
        }
        this.labelDrag = {
            id: constraintId,
            startX: event.clientX,
            startY: event.clientY,
            original: this.anchors.get(constraintId),
            held: true,
            moved: false,
        };
        const onMove = (e: PointerEvent) => this.moveLabelDrag(e.clientX, e.clientY);
        const onUp = () => this.releaseLabelDrag();
        this.dragCleanup = () => {
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            this.dragCleanup = undefined;
        };
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
    }

    private moveLabelDrag(clientX: number, clientY: number): void {
        const drag = this.labelDrag;
        if (drag === undefined) return;
        if (!drag.moved) {
            if (Math.hypot(clientX - drag.startX, clientY - drag.startY) < LABEL_DRAG_THRESHOLD_PX) return;
            drag.moved = true;
        }
        const uv = this.clientToUV(clientX, clientY);
        if (uv === undefined) return;
        const constraint = this.solver.toData().constraints.find((c) => c.id === drag.id);
        if (constraint === undefined) return;
        const anchor = this.anchorAtPosition(constraint, uv);
        if (anchor === undefined) return;
        this.anchors.set(drag.id, anchor);
        this.refresh();
    }

    private releaseLabelDrag(): void {
        const drag = this.labelDrag;
        if (drag === undefined || !drag.held) return;
        if (drag.moved) {
            // press-drag-release commits where the button went up
            this.endLabelDrag(true);
        } else {
            // a plain click picks the label up: it follows the cursor until the next click
            drag.held = false;
        }
    }

    /** Ends the label drag; `commit` keeps the new position, otherwise the anchor is restored. */
    endLabelDrag(commit: boolean): void {
        const drag = this.labelDrag;
        if (drag === undefined) return;
        this.labelDrag = undefined;
        this.dragCleanup?.();
        // never travelled: a plain click or the first half of a double-click — nothing changed
        if (!drag.moved) return;
        if (!commit) {
            if (drag.original === undefined) this.anchors.delete(drag.id);
            else this.anchors.set(drag.id, drag.original);
            this.refresh();
            return;
        }
        this.onAnchorDragEnd(drag.id);
    }

    /** Cancels the label drag (Escape), restoring the anchor from before the drag. */
    cancelLabelDrag(): void {
        this.endLabelDrag(false);
    }

    /** Sketch-plane uv under a client (page) position; undefined off-plane or without a dom. */
    private clientToUV(clientX: number, clientY: number): [number, number] | undefined {
        const dom = this.view.dom;
        if (dom === undefined) return undefined;
        const rect = dom.getBoundingClientRect();
        const point = this.solver.plane.intersectRay(
            this.view.rayAt(clientX - rect.left, clientY - rect.top),
        );
        return point === undefined ? undefined : toUV(this.solver.plane, point);
    }

    /** Anchor that places the label at `uv` — the inverse of the per-kind layout. */
    private anchorAtPosition(
        constraint: SketchConstraintData,
        uv: [number, number],
    ): DimensionAnchor | undefined {
        const points = constraint.refs.map((r) => this.solver.pointOf(r));
        switch (constraint.kind) {
            case ConstraintKind.P2PDistance:
                return { kind: "offset", offset: segmentOffset(points[0], points[1], uv) };
            case ConstraintKind.HorizontalDistance:
                return { kind: "offset", offset: uv[1] - (points[0][1] + points[1][1]) / 2 };
            case ConstraintKind.VerticalDistance:
                return { kind: "offset", offset: uv[0] - (points[0][0] + points[1][0]) / 2 };
            case ConstraintKind.P2LDistance: {
                const foot = pointLineFoot(points[0], points[1], points[2]);
                return foot === undefined
                    ? undefined
                    : { kind: "offset", offset: segmentOffset(points[0], foot, uv) };
            }
            case ConstraintKind.Radius: {
                const entity = this.solver.entity(constraint.refs[0].entityId);
                if (entity === undefined) return undefined;
                return { kind: "vector", dx: uv[0] - entity.params[0], dy: uv[1] - entity.params[1] };
            }
            case ConstraintKind.Angle: {
                const vertex = lineIntersection(points[0], points[1], points[2], points[3]) ?? [
                    (points[0][0] + points[1][0] + points[2][0] + points[3][0]) / 4,
                    (points[0][1] + points[1][1] + points[2][1] + points[3][1]) / 4,
                ];
                return { kind: "vector", dx: uv[0] - vertex[0], dy: uv[1] - vertex[1] };
            }
            default:
                return undefined;
        }
    }

    private toggleSelection(id: number, additive: boolean): void {
        if (additive) {
            if (!this.selectedConstraints.delete(id)) {
                this.selectedConstraints.add(id);
            }
        } else {
            this.selectedConstraints.clear();
            this.selectedConstraints.add(id);
        }
        this.applySelectionClasses();
    }

    private applySelectionClasses(): void {
        for (const [id, elements] of this.badgeElements) {
            for (const element of elements) {
                element.classList.toggle(style.selected, this.selectedConstraints.has(id));
            }
        }
    }

    private disposeItems(): void {
        for (const item of this.items) {
            item.dispose();
        }
        this.items = [];
        this.badgeElements.clear();
        this.badgeAnchors = [];
        if (this.meshId !== undefined) {
            this.view.document.visual.context.removeMesh(this.meshId);
            this.meshId = undefined;
        }
    }
}

/** SVG element referencing the toolbar iconfont symbol (sized/colored via CSS). */
function badgeIcon(name: string): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", `#${name}`);
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${name}`);
    const icon = document.createElementNS(ns, "svg");
    icon.append(use);
    return icon;
}

/** Diagonal offset from a point so the badge does not cover it. */
function pointBadgeAnchor([u, v]: [number, number], px: number): [number, number] {
    const off = BADGE_OFFSET_PX * px * Math.SQRT1_2;
    return [u + off, v + off];
}

/**
 * Anchor beside the projection of `hint` onto segment ab, offset towards `hint` —
 * used for datum axes, whose segment stub at the origin says nothing about where
 * the constrained geometry is.
 */
function projectBeside(
    a: [number, number],
    b: [number, number],
    hint: [number, number],
    offset: number,
): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t = length2 < 1e-12 ? 0 : ((hint[0] - a[0]) * dx + (hint[1] - a[1]) * dy) / length2;
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const su = hint[0] - proj[0];
    const sv = hint[1] - proj[1];
    const side = Math.hypot(su, sv);
    let nu: number;
    let nv: number;
    if (side < 1e-9) {
        const length = Math.hypot(dx, dy);
        [nu, nv] = length < 1e-9 ? [0, 1] : [-dy / length, dx / length];
    } else {
        [nu, nv] = [su / side, sv / side];
    }
    return [proj[0] + nu * offset, proj[1] + nv * offset];
}

function offsetFromSegment(a: [number, number], b: [number, number], offset: number): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const [nu, nv] = length < 1e-9 ? [0, 1] : [-dy / length, dx / length];
    return [(a[0] + b[0]) / 2 + nu * offset, (a[1] + b[1]) / 2 + nv * offset];
}
