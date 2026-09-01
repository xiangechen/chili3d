// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type EdgeMeshData, type IDisposable, type IView, VisualConfig } from "@chili3d/core";
import {
    ConstraintKind,
    pointRefKey,
    type SketchConstraintData,
    type SketchPointRef,
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

/** Badge glyphs for the no-datum symbol constraints. */
const CONSTRAINT_GLYPHS: Partial<Record<ConstraintKind, string>> = {
    [ConstraintKind.Parallel]: "∥",
    [ConstraintKind.Perpendicular]: "⊥",
    [ConstraintKind.EqualLength]: "=",
    [ConstraintKind.EqualRadius]: "=",
    [ConstraintKind.EqualArcRadius]: "=",
    [ConstraintKind.TangentLineCircle]: "T",
    [ConstraintKind.TangentCircleCircle]: "T",
    [ConstraintKind.TangentLineArc]: "T",
    [ConstraintKind.TangentArcArc]: "T",
    [ConstraintKind.TangentCircleArc]: "T",
    [ConstraintKind.PointOnLine]: "⊙",
    [ConstraintKind.PointOnCircle]: "⊙",
    [ConstraintKind.PointOnArc]: "⊙",
    [ConstraintKind.Midpoint]: "M",
    [ConstraintKind.Symmetric]: "S",
    [ConstraintKind.HorizontalAlign]: "⬌",
    [ConstraintKind.VerticalAlign]: "⬍",
    [ConstraintKind.Fix]: "⚓",
};

/** Badge center offset from its geometry, in screen pixels. */
const BADGE_OFFSET_PX = 18;
/** How close the cursor must stay to a visible badge for the entity hover to survive. */
const BADGE_REACH_PX = 30;

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
 * Renders constraint symbols (H / V / ◇) and datum dimensions (extension lines,
 * arrows, value text) anchored to sketch geometry. Recreated wholesale on each
 * refresh — sketches are small, so this stays simple. Dimension graphics use
 * pixel-relative sizes, so the camera controller is subscribed to re-render on zoom.
 * Constraint symbols are shown while one of their referenced entities is highlighted
 * (hovered, dragged or selected), or while the badge itself is hovered/selected;
 * they are suppressed entirely while a pick is active so they cannot occlude the
 * geometry being picked. Datum dimensions stay visible. Symbol badges are offset a
 * screen-constant distance from their geometry so they never cover the clickable
 * line/point; the event handler keeps the entity hover alive while the cursor
 * crosses the gap to a badge (`isNearVisibleBadge`). Badges are interactive: hovering
 * one highlights its referenced entities, clicking selects it, selected constraints
 * can be deleted, and double-clicking a datum badge re-opens its value input.
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
    private readonly onCameraChanged = () => this.refresh();

    constructor(
        private readonly view: IView,
        private readonly solver: SketchSolver,
        private readonly anchors: Map<number, DimensionAnchor>,
        private readonly onHighlightEntities: (entityIds: number[]) => void = () => {},
        private readonly onEditDatum: (constraintId: number) => void = () => {},
    ) {
        // optional call: mock camera controllers in unit tests may lack the event API
        view.cameraController.onPropertyChanged?.(this.onCameraChanged);
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
            this.meshId = this.view.document.visual.context.displayMesh([this.toEdgeMesh(segments)]);
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
        this.addBadge(constraint.kind === ConstraintKind.Horizontal ? "H" : "V", u, v, constraint);
    }

    /** Glyph badge for the no-datum symbol constraints (parallel, tangent, fix, ...). */
    private addSymbolBadge(constraint: SketchConstraintData, px: number): void {
        const glyph = CONSTRAINT_GLYPHS[constraint.kind];
        if (glyph === undefined) return;
        // an arc's structural PointOnArc (all refs on the arc itself) stays invisible —
        // it is part of the entity, deleting it would break the arc geometry
        if (
            constraint.kind === ConstraintKind.PointOnArc &&
            constraint.refs.every((r) => r.entityId === constraint.refs[0].entityId)
        ) {
            return;
        }
        if (!this.isConstraintVisible(constraint)) return;
        const off = BADGE_OFFSET_PX * px * Math.SQRT1_2;
        const [u, v] = this.refsMidpoint(constraint.refs);
        this.addBadge(glyph, u + off, v + off, constraint);
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
        this.addBadge("◇", u + off, v + off, constraint, group);
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
        const [cx, cy, radius] = entity.params;
        const anchor = this.anchors.get(constraint.id);
        const [dx, dy] = anchor?.kind === "vector" ? [anchor.dx, anchor.dy] : [radius, radius];
        return radiusDimension([cx, cy], radius, dx, dy, px);
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
        return { position, range: [], color: VisualConfig.highlightEdgeColor, lineType: "solid" };
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
                onClick: (event) => {
                    event.stopPropagation();
                    this.toggleSelection(id, event.shiftKey);
                },
                // datum badges (dimensions) can be edited; symbol badges cannot
                onDoubleClick:
                    constraint.datum === undefined && constraint.datums === undefined
                        ? undefined
                        : (event) => {
                              event.stopPropagation();
                              this.onEditDatum(id);
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

function offsetFromSegment(a: [number, number], b: [number, number], offset: number): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const [nu, nv] = length < 1e-9 ? [0, 1] : [-dy / length, dx / length];
    return [(a[0] + b[0]) / 2 + nu * offset, (a[1] + b[1]) / 2 + nv * offset];
}
