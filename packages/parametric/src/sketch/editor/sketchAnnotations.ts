// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    CommandStore,
    debounce,
    defaultFontService,
    type EdgeMeshData,
    type FaceMeshData,
    type IDisposable,
    type IView,
    type ShapeMeshData,
} from "@chili3d/core";
import {
    arcAngles,
    ConstraintKind,
    type DimensionLabel,
    entityRadius,
    isDatumEntityId,
    isStructuralConstraint,
    pointRefKey,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
    toUV,
    toWorld,
    viewPixelSize,
} from "../sketchModel";
import type { SketchSolver } from "../solver";
import {
    angleDimension,
    angleVertex,
    axisDistanceDimension,
    type DimensionAnchor,
    type DimensionGeometry,
    type DimensionGraphics,
    type DimensionSize,
    distanceDimension,
    formatDatum,
    labelOnAxis,
    labelOnSegment,
    measuresSupplement,
    pointLineDistanceDimension,
    pointLineFoot,
    pointLineSignedDistance,
    pushDimensionGeometry,
    radiusDimension,
    SKETCH_TEXT_HEIGHT_PX,
    signedSweep,
    sketchDimensionSize,
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

export type BadgeSymbol = { label: string; icon?: string };

/** Badge content for a constraint kind; the icon comes from the command's `@command` decorator. */
export function badgeSymbol(kind: ConstraintKind): BadgeSymbol | undefined {
    const entry = CONSTRAINT_BADGES[kind];
    if (entry === undefined) return undefined;
    const icon = CommandStore.getComandData(entry.command)?.icon;
    return { label: entry.label, icon: typeof icon === "string" ? icon : undefined };
}

/** A dimension label drawn as mesh glyphs: the text, its uv anchor and its baseline direction. */
interface DimensionText {
    readonly text: string;
    readonly u: number;
    readonly v: number;
    readonly direction: [number, number];
    /** Flagged constraints draw in their tone's color instead of DIMENSION_COLOR. */
    readonly tone?: DimensionTone;
}

/**
 * One badge resolved to its anchor, collected before any DOM is built. Two constraints on
 * the same geometry resolve to the same `(u, v)` — the whole point of collecting first is
 * that the overlap can then be resolved (see `clusterBadges`).
 */
interface BadgePlacement {
    readonly constraint: SketchConstraintData;
    readonly refs: readonly SketchPointRef[];
    readonly u: number;
    readonly v: number;
    readonly entityIds: number[];
    /** Datum labels carry a position the user chose — never folded into a stack. */
    readonly draggable: boolean;
    /** A datum's text draws as mesh glyphs; its badge stays invisible (see `.ghost`). */
    readonly ghost: boolean;
    /** Fallback text when the constraint command has no icon (unit tests, odd icon kinds). */
    readonly label: string;
    readonly icon?: string;
}

/**
 * A set of badges close enough to overlap, plus the key that names it. The key is the
 * cluster's index within one refresh, NOT its leader's constraint id: a multi-entity
 * constraint badges every entity it names, so one constraint can lead several clusters
 * — and those clusters are unrelated stacks.
 */
interface BadgeCluster {
    readonly key: number;
    readonly members: readonly BadgePlacement[];
}

/** How a flagged constraint's annotation reads: red for conflicting, amber for redundant. */
type DimensionTone = "conflict" | "redundant";

/** Badge center offset from its geometry, in screen pixels. */
const BADGE_OFFSET_PX = 18;
/** How close the cursor must stay to a visible badge for the entity hover to survive. */
const BADGE_REACH_PX = 30;
/**
 * Screen distance within which two symbol badges fold into one stack. Must stay under
 * 50: a multi-entity constraint that badges two entities 50 world units apart (two
 * parallel lines, at 1 world unit per pixel) has to keep two separate badges.
 */
const BADGE_STACK_DISTANCE_PX = 28;
/**
 * Rough screen width of one expanded member, for judging whether a stack's row will fit
 * before its right edge. Only ever used as a fail-safe: over-estimating opens a stack
 * leftwards a little early, which is cosmetic.
 */
const STACK_MEMBER_WIDTH_PX = 26;
/** Pointer travel (screen px) before a badge press becomes a label drag. */
const LABEL_DRAG_THRESHOLD_PX = 4;
/**
 * Blue for dimension graphics — matches the dark-theme `--primary-color` (#4a9eff)
 * behind the badges' `--badge-accent`; green is reserved for hover/selection highlights.
 */
const DIMENSION_COLOR = 0x4a9eff;

/**
 * Red for conflicting-constraint graphics — matches the dark-theme `--error-color`
 * (#ff6b6b), the badge conflict style uses the CSS variable itself.
 */
const CONFLICT_COLOR = 0xff6b6b;

/**
 * Amber for redundant-constraint graphics — matches the dark-theme `--warning-color`
 * (#ffd93d), the badge redundant style uses the CSS variable itself.
 */
const REDUNDANT_COLOR = 0xffd93d;

/** Mesh colors per tone, normal dimensions included. */
const TONE_COLORS: Record<DimensionTone | "normal", number> = {
    normal: DIMENSION_COLOR,
    conflict: CONFLICT_COLOR,
    redundant: REDUNDANT_COLOR,
};

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
 * arrows, value text) anchored to sketch geometry.
 *
 * - **Lifecycle.** Recreated wholesale on each refresh — sketches are small, so this stays
 *   simple. Dimension graphics use pixel-relative sizes, so the camera controller is subscribed
 *   to re-render on zoom.
 * - **When symbols are visible.** While one of their referenced entities is highlighted
 *   (hovered, dragged or selected), while the badge itself or its panel row is hovered
 *   or the badge is selected, or while the constraint is conflicting — a conflict must
 *   be findable without hunting for it. They are suppressed entirely while a pick is
 *   active, so they cannot occlude the geometry being picked. Datum dimensions stay
 *   visible regardless.
 * - **Placement.** Symbol badges sit a screen-constant distance from their geometry so they
 *   never cover the clickable line/point. A multi-entity constraint (parallel, tangent, …) gets
 *   one badge per referenced entity, so each stays next to — and reachable from — its own
 *   geometry however far apart the entities are. The event handler keeps the entity hover alive
 *   while the cursor crosses the gap to a badge (`isNearVisibleBadge`).
 * - **Stacking.** Badges that land on the same point — Horizontal and Vertical on one line,
 *   or any two constraints on one entity — would otherwise draw exactly on top of each other.
 *   They fold into one chip carrying a count instead, which opens into a row of the real
 *   badges on hover (see `placeBadges`). Badges far enough apart to overlap on screen fold
 *   too, so a multi-entity constraint on two entities that nearly touch shows one chip rather
 *   than two badges over each other. Datum dimensions never fold: their position is the one
 *   the user placed.
 * - **Interaction.** Datum text draws as mesh glyphs (parallel to the dimension line, like the
 *   3D annotations); the badge stays behind it as an invisible layer keeping hover highlight,
 *   label dragging and double-click editing alive. Hovering a badge highlights its referenced
 *   entities; clicking a symbol badge selects it; selected constraints can be deleted;
 *   double-clicking a datum badge re-opens its value input.
 * - **Flagged constraints.** Constraints the solver flags read in the issue color —
 *   conflicting red, redundant amber. A symbol badge goes solid (white-on-color), a
 *   datum dimension redraws its whole graphics (extension lines, arrows, text) in the
 *   tone color — its invisible badge keeps the regular look so only the mesh carries
 *   the signal.
 * - **Dragging a datum badge.** Either press-drag-release, or click to pick the label up (it
 *   then follows the cursor) and click again — on the canvas or on the label itself — to drop
 *   it. Escape cancels and restores the previous anchor. The new anchor is committed (undoable)
 *   on drop.
 */
export class SketchAnnotationManager implements IDisposable {
    private items: IDisposable[] = [];
    private badgeElements = new Map<number, HTMLElement[]>();
    private badgeAnchors: { u: number; v: number; entityIds: number[] }[] = [];
    /** Resolved during a refresh, placed once the whole set is known (`placeBadges`). */
    private pendingBadges: BadgePlacement[] = [];
    /** The stack chip elements of the last refresh, for the selection/expansion look. */
    private stackChips: { element: HTMLElement; key: number; memberIds: number[] }[] = [];
    /**
     * Constraint id → the stacks its badges landed on. A set, not one: a multi-entity
     * constraint badges every entity it names, so its placements can end up in several
     * stacks at once.
     */
    private stacksByConstraint = new Map<number, Set<number>>();
    /** Stack keys whose members are forced visible — see `isConstraintVisible`. */
    private forcedStackKeys = new Set<number>();
    /**
     * Key of the stack whose chip the cursor is on. Survives a refresh on purpose: the
     * rebuild has to find it and re-open the same chip. That works because a highlight —
     * the only thing a live hover triggers — never changes which badges exist or their
     * order, so cluster keys keep naming the same stacks.
     */
    private hoveredStackKey?: number;
    private meshId?: number;
    private disposed = false;
    private highlightedEntities = new Set<number>();
    /** Constraint ids the last fine solve flagged as conflicting — their annotations read red. */
    private conflictingConstraints = new Set<number>();
    /** Constraint ids the last fine solve flagged as redundant — their annotations read amber. */
    private redundantConstraints = new Set<number>();
    private hoveredConstraint?: number;
    /** Constraint whose panel row is hovered — its badge takes the hover look. */
    private panelHoveredConstraint?: number;
    private readonly selectedConstraints = new Set<number>();
    private rebuilding = false;
    private suppressSymbols = false;
    /**
     * Whether the constraint symbols let pointer events through (see
     * `inertConstraintSymbols`). Unlike `suppressSymbols` the badges stay drawn.
     */
    private symbolsInert = false;
    private dimensionPreview?: DimensionPreview;
    /** The labels collected during a refresh, drawn as mesh glyphs into the face channel. */
    private texts: DimensionText[] = [];
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
    /** Selection-change notification — the constraint list panel mirrors the badge selection. */
    onSelectionChanged?: (ids: number[]) => void;
    private readonly onCameraChanged = debounce(() => this.refresh(), 20);
    /**
     * The default font arrives asynchronously (see `defaultFontService`); until it
     * does the labels draw no glyphs at all, and its arrival is what refreshes them.
     */
    private readonly onFontLoaded = () => this.refresh();

    // ------------------------------------------------------------------ Selection and refresh

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
        if (defaultFontService.outline === undefined) {
            defaultFontService.onLoaded(this.onFontLoaded);
            defaultFontService.ensureLoaded();
        }
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

    /** Constraints the last fine solve flagged as conflicting — their annotations read red. */
    setConflictingConstraints(ids: Iterable<number>): void {
        this.conflictingConstraints = new Set(ids);
    }

    /** Constraints the last fine solve flagged as redundant — their annotations read amber. */
    setRedundantConstraints(ids: Iterable<number>): void {
        this.redundantConstraints = new Set(ids);
    }

    /** The tone a flagged constraint's annotation draws in, undefined for the normal blue. */
    private toneOf(id: number): DimensionTone | undefined {
        if (this.conflictingConstraints.has(id)) return "conflict";
        if (this.redundantConstraints.has(id)) return "redundant";
        return undefined;
    }

    /**
     * Panel-row hover: the constraint's badge stays visible with the hover look while
     * the pointer is over the list. Refresh is skipped when unchanged.
     */
    highlightConstraint(id?: number): void {
        if (this.disposed || this.panelHoveredConstraint === id) return;
        this.panelHoveredConstraint = id;
        this.refresh();
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
        this.onSelectionChanged?.([]);
    }

    /** Replaces the selection wholesale — the constraint list panel drives this. */
    selectConstraints(ids: Iterable<number>): void {
        this.selectedConstraints.clear();
        for (const id of ids) this.selectedConstraints.add(id);
        this.applySelectionClasses();
        this.onSelectionChanged?.(this.selectedConstraintIds);
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
        if (changed) {
            this.applySelectionClasses();
            this.onSelectionChanged?.(this.selectedConstraintIds);
        }
    }

    refresh(): void {
        if (this.disposed) return;
        // DOM removal fires mouseleave on a hovered badge; suppress it so the
        // badge does not vanish under a stationary cursor mid-rebuild
        this.rebuilding = true;
        this.disposeItems();
        this.rebuilding = false;
        const px = this.pixelSize();
        // flagged datum dimensions route to their tone's bucket and draw in its color
        const graphics: Record<DimensionTone | "normal", DimensionGraphics> = {
            normal: { segments: [], triangles: [] },
            conflict: { segments: [], triangles: [] },
            redundant: { segments: [], triangles: [] },
        };
        this.texts = [];
        this.addConstraintGraphics(px, graphics);
        this.addPreviewGraphics(px, graphics.normal);
        // the badges only learn they overlap once every candidate anchor is resolved
        this.placeBadges(px);

        const corners: Record<DimensionTone | "normal", DimensionGeometry["triangles"]> = {
            normal: [...graphics.normal.triangles],
            conflict: [...graphics.conflict.triangles],
            redundant: [...graphics.redundant.triangles],
        };
        for (const text of this.texts) {
            this.pushTextTriangles(corners[text.tone ?? "normal"], text, px);
        }

        const meshes: ShapeMeshData[] = [];
        for (const tone of ["normal", "conflict", "redundant"] as const) {
            if (graphics[tone].segments.length > 0) {
                meshes.push(this.toEdgeMesh(graphics[tone].segments, TONE_COLORS[tone]));
            }
            if (corners[tone].length > 0) meshes.push(this.toFaceMesh(corners[tone], TONE_COLORS[tone]));
        }
        if (meshes.length > 0) {
            this.meshId = this.view.document.visual.context.displayMesh(meshes, { onTop: true });
        }
        this.view.update();
    }

    // ------------------------------------------------------------------ Constraint badges and dimension geometry

    private addConstraintGraphics(
        px: number,
        graphics: Record<DimensionTone | "normal", DimensionGraphics>,
    ): void {
        const coincidentGroups = new Set<string>();
        for (const constraint of this.solver.toData().constraints) {
            switch (constraint.kind) {
                case ConstraintKind.Horizontal:
                case ConstraintKind.Vertical:
                    this.queueAxisBadge(constraint, px);
                    break;
                case ConstraintKind.P2PCoincident:
                    this.queueCoincidentBadge(constraint, px, coincidentGroups);
                    break;
                case ConstraintKind.P2PDistance:
                case ConstraintKind.Radius:
                case ConstraintKind.P2LDistance:
                case ConstraintKind.Angle:
                case ConstraintKind.HorizontalDistance:
                case ConstraintKind.VerticalDistance:
                    this.addDatumDimension(constraint, px, graphics[this.toneOf(constraint.id) ?? "normal"]);
                    break;
                default:
                    this.queueSymbolBadge(constraint, px);
                    break;
            }
        }
    }

    /**
     * Axis badge anchor: offset along the segment normal so the badge does not cover the
     * line. Horizontal and Vertical pass the same pair of points, so the two land on the
     * identical anchor — `placeBadges` is what keeps them from drawing on top of each other.
     */
    private queueAxisBadge(constraint: SketchConstraintData, px: number): void {
        if (this.suppressSymbols) return;
        const symbol = badgeSymbol(constraint.kind);
        if (symbol === undefined) return;
        const p1 = this.solver.pointOf(constraint.refs[0]);
        const p2 = this.solver.pointOf(constraint.refs[1]);
        const [u, v] = offsetFromSegment(p1, p2, BADGE_OFFSET_PX * px);
        this.queueBadge(symbol.label, u, v, constraint, constraint.refs, false, symbol.icon);
    }

    /**
     * Symbol badges for the no-datum constraints (parallel, tangent, fix, ...) —
     * one badge per referenced entity (or constrained point), each anchored next to
     * its own geometry so it stays visible-reachable no matter how far apart the
     * constrained entities are.
     */
    private queueSymbolBadge(constraint: SketchConstraintData, px: number): void {
        if (this.suppressSymbols) return;
        const symbol = badgeSymbol(constraint.kind);
        if (symbol === undefined) return;
        if (isStructuralConstraint(constraint)) return;
        const anchors = this.symbolAnchors(constraint, px).filter(
            // drop duplicates (e.g. a symmetric constraint on the same point twice)
            (anchor, i, all) =>
                all.findIndex((b) => Math.hypot(anchor[0] - b[0], anchor[1] - b[1]) < 1e-9) === i,
        );
        for (const [u, v] of anchors) {
            this.queueBadge(symbol.label, u, v, constraint, constraint.refs, false, symbol.icon);
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
     * radial offset from a circle or arc (see `badgeRadialDirection`).
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
        const direction = this.badgeRadialDirection(entity, hint);
        return [cx + direction[0] * (radius + off), cy + direction[1] * (radius + off)];
    }

    /**
     * Radial badge direction of a circle/arc: an arc's mid-sweep direction, otherwise
     * facing away from the constraint's other party (`hint`), so tangent/equal
     * partners do not stack; degenerate cases fall back to the diagonal.
     */
    private badgeRadialDirection(entity: SketchEntityData, hint: [number, number]): [number, number] {
        const [cx, cy] = entity.params;
        if (entity.type === "arc") {
            // true mid-sweep direction: the chord midpoint is the antipode of it once
            // the sweep exceeds π (the badge would float on the empty side) and
            // degenerates at exactly π — the angular midpoint is always a unit vector
            const [a0, sweep] = arcAngles(entity.params);
            return [Math.cos(a0 + sweep / 2), Math.sin(a0 + sweep / 2)];
        }
        const [du, dv] = [cx - hint[0], cy - hint[1]];
        const length = Math.hypot(du, dv);
        return length < 1e-9 ? [Math.SQRT1_2, Math.SQRT1_2] : [du / length, dv / length];
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

    /**
     * One badge per coincident *group* of points, not per constraint: several coincident
     * constraints on the same point describe the same thing. The group key is consumed even
     * when the badge ends up hidden, so a later constraint of the same group cannot claim it.
     */
    private queueCoincidentBadge(
        constraint: SketchConstraintData,
        px: number,
        shownGroups: Set<string>,
    ): void {
        if (this.suppressSymbols) return;
        const group = this.solver.coincidentGroup(constraint.refs[0]);
        const key = group.map(pointRefKey).sort().join("|");
        if (shownGroups.has(key)) return;
        shownGroups.add(key);
        const [u, v] = this.solver.pointOf(group[0]);
        // diagonal offset so the badge does not cover the shared point
        const off = BADGE_OFFSET_PX * px * Math.SQRT1_2;
        const symbol = badgeSymbol(ConstraintKind.P2PCoincident);
        this.queueBadge(symbol?.label ?? "", u + off, v + off, constraint, group, false, symbol?.icon);
    }

    private addDatumDimension(
        constraint: SketchConstraintData,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const geometry = this.dimensionGeometry(constraint, px);
        if (geometry === undefined) return;
        pushDimensionGeometry(graphics, geometry);
        // An expression reads as written — that is the whole point of naming it.
        const text = formatDatum(constraint.kind, constraint.datum ?? 0);
        // A broken expression keeps a visible badge — it is the only place that says so.
        const broken = this.solver.datumErrors.has(constraint.id);
        if (!broken) {
            this.texts.push({
                text,
                u: geometry.textPosition[0],
                v: geometry.textPosition[1],
                direction: geometry.textDirection,
                tone: this.toneOf(constraint.id),
            });
        }
        // datum dimensions stay visible regardless: no visibility gate, and never stacked
        this.queueBadge(
            text,
            ...geometry.textPosition,
            constraint,
            constraint.refs,
            true,
            undefined,
            !broken,
        );
    }

    private dimensionGeometry(constraint: SketchConstraintData, px: number): DimensionGeometry | undefined {
        const size = sketchDimensionSize(px);
        const anchor = this.anchors.get(constraint.id);
        // no anchor (never dragged or placed): the layout's own default, the minimum
        // standoff on the positive side and the middle of the line
        const label: DimensionLabel = anchor?.kind === "offset" ? anchor : { offset: 0 };
        switch (constraint.kind) {
            case ConstraintKind.P2PDistance:
                return distanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    label,
                    size,
                );
            case ConstraintKind.Radius:
                return this.radiusGeometry(constraint, size);
            case ConstraintKind.HorizontalDistance:
            case ConstraintKind.VerticalDistance:
                return axisDistanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    constraint.kind === ConstraintKind.HorizontalDistance ? "h" : "v",
                    label,
                    size,
                );
            case ConstraintKind.P2LDistance:
                return pointLineDistanceDimension(
                    this.solver.pointOf(constraint.refs[0]),
                    this.solver.pointOf(constraint.refs[1]),
                    this.solver.pointOf(constraint.refs[2]),
                    label,
                    size,
                );
            case ConstraintKind.Angle:
                return this.angleGeometry(constraint, size);
            default:
                return undefined;
        }
    }

    private angleGeometry(
        constraint: SketchConstraintData,
        size: DimensionSize,
    ): DimensionGeometry | undefined {
        const [a1, a2, b1, b2] = constraint.refs.map((r) => this.solver.pointOf(r));
        const vertex = angleVertex(a1, a2, b1, b2);
        const anchor = this.anchors.get(constraint.id);
        // the anchor vector is the label the user placed: it picks the side of the
        // vertex the arc lands on, and its distance sets the arc's radius
        const labelPoint: [number, number] =
            anchor?.kind === "vector" ? [vertex[0] + anchor.dx, vertex[1] + anchor.dy] : vertex;
        const d1: [number, number] = [a2[0] - a1[0], a2[1] - a1[1]];
        const d2: [number, number] = [b2[0] - b1[0], b2[1] - b1[1]];
        // the stored pair already carries the supplement choice; the sweep is its short way
        return angleDimension(vertex, d1, signedSweep(d1, d2), labelPoint, size);
    }

    // ------------------------------------------------------------------ Live dimension previews

    private addPreviewGraphics(px: number, graphics: DimensionGraphics): void {
        const preview = this.dimensionPreview;
        if (preview === undefined) return;
        if (preview.kind === "segment") {
            graphics.segments.push([preview.p1[0], preview.p1[1], preview.p2[0], preview.p2[1]]);
            return;
        }
        if (preview.kind === "distance") {
            this.previewDistance(preview, px, graphics);
            return;
        }
        if (preview.kind === "radius") {
            this.previewRadius(preview, px, graphics);
            return;
        }
        if (preview.kind === "pointLine") {
            this.previewPointLine(preview, px, graphics);
            return;
        }
        if (preview.kind === "axisDistance") {
            this.previewAxisDistance(preview, px, graphics);
            return;
        }
        this.previewAngle(preview, px, graphics);
    }

    private previewDistance(
        preview: Extract<DimensionPreview, { kind: "distance" }>,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const label = labelOnSegment(preview.p1, preview.p2, preview.position);
        const geometry = distanceDimension(preview.p1, preview.p2, label, sketchDimensionSize(px));
        if (geometry === undefined) return;
        pushDimensionGeometry(graphics, geometry);
        const value = Math.hypot(preview.p2[0] - preview.p1[0], preview.p2[1] - preview.p1[1]);
        this.pushPreviewText(value.toFixed(2), geometry);
    }

    private previewRadius(
        preview: Extract<DimensionPreview, { kind: "radius" }>,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const [cx, cy] = preview.center;
        const geometry = radiusDimension(
            preview.center,
            preview.radius,
            [preview.position[0] - cx, preview.position[1] - cy],
            sketchDimensionSize(px),
        );
        pushDimensionGeometry(graphics, geometry);
        this.pushPreviewText(`R${preview.radius.toFixed(2)}`, geometry);
    }

    private previewPointLine(
        preview: Extract<DimensionPreview, { kind: "pointLine" }>,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const foot = pointLineFoot(preview.p, preview.l1, preview.l2);
        if (foot === undefined) return;
        const label = labelOnSegment(preview.p, foot, preview.position);
        const geometry = pointLineDistanceDimension(
            preview.p,
            preview.l1,
            preview.l2,
            label,
            sketchDimensionSize(px),
        );
        if (geometry === undefined) return;
        pushDimensionGeometry(graphics, geometry);
        this.pushPreviewText(pointLineSignedDistance(preview.p, preview.l1, preview.l2).toFixed(2), geometry);
    }

    private previewAxisDistance(
        preview: Extract<DimensionPreview, { kind: "axisDistance" }>,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const label = labelOnAxis(preview.p1, preview.p2, preview.axis, preview.position);
        const geometry = axisDistanceDimension(
            preview.p1,
            preview.p2,
            preview.axis,
            label,
            sketchDimensionSize(px),
        );
        if (geometry === undefined) return;
        pushDimensionGeometry(graphics, geometry);
        const value = preview.axis === "h" ? preview.p2[0] - preview.p1[0] : preview.p2[1] - preview.p1[1];
        this.pushPreviewText(value.toFixed(2), geometry);
    }

    private previewAngle(
        preview: Extract<DimensionPreview, { kind: "angle" }>,
        px: number,
        graphics: DimensionGraphics,
    ): void {
        const vertex = angleVertex(preview.a1, preview.a2, preview.b1, preview.b2);
        const d1: [number, number] = [preview.a2[0] - preview.a1[0], preview.a2[1] - preview.a1[1]];
        const d2: [number, number] = [preview.b2[0] - preview.b1[0], preview.b2[1] - preview.b1[1]];
        // the label's sector picks the measured pair, just as the committing command will
        const labelDirection: [number, number] = [
            preview.position[0] - vertex[0],
            preview.position[1] - vertex[1],
        ];
        const supplement = measuresSupplement(d1, d2, labelDirection);
        const second: [number, number] = supplement ? [-d2[0], -d2[1]] : d2;
        const geometry = angleDimension(
            vertex,
            d1,
            signedSweep(d1, second),
            preview.position,
            sketchDimensionSize(px),
        );
        if (geometry === undefined) return;
        pushDimensionGeometry(graphics, geometry);
        const sweep = signedSweep(d1, second);
        this.pushPreviewText(`${((Math.abs(sweep) * 180) / Math.PI).toFixed(1)}°`, geometry);
    }

    /** Preview labels join the mesh text — there is no interactive badge while placing. */
    private pushPreviewText(text: string, geometry: DimensionGeometry): void {
        this.texts.push({
            text,
            u: geometry.textPosition[0],
            v: geometry.textPosition[1],
            direction: geometry.textDirection,
        });
    }

    // ------------------------------------------------------------------ Visibility, graphics helpers and disposal

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.dragCleanup?.();
        this.view.cameraController.removePropertyChanged?.(this.onCameraChanged);
        defaultFontService.removeLoaded(this.onFontLoaded);
        this.disposeItems();
    }

    /** Whether the constraint symbols are currently hidden (see the setter). */
    get suppressConstraintSymbols(): boolean {
        return this.suppressSymbols;
    }

    /** Whether the constraint symbols currently let pointer events through. */
    get inertConstraintSymbols(): boolean {
        return this.symbolsInert;
    }

    /**
     * Draws the constraint symbol badges as usual but stops them taking pointer events.
     * They are DOM overlays, so one lying over a *mesh* handle inside the sketch — the
     * offset's arrow — would swallow the press that grabs it, or the click that settles
     * its value, while the handle itself is invisible to the browser. Datum dimensions are
     * not affected: those are meant to be dragged.
     */
    set inertConstraintSymbols(value: boolean) {
        if (this.disposed || value === this.symbolsInert) return;
        this.symbolsInert = value;
        this.refresh();
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
            // a conflict must be findable without hunting for it — the badge stays up
            // whether or not its entities are highlighted; redundant badges likewise
            this.conflictingConstraints.has(constraint.id) ||
            this.redundantConstraints.has(constraint.id) ||
            this.hoveredConstraint === constraint.id ||
            this.panelHoveredConstraint === constraint.id ||
            this.selectedConstraints.has(constraint.id) ||
            refs.some((ref) => this.highlightedEntities.has(ref.entityId))
        );
    }

    private radiusGeometry(
        constraint: SketchConstraintData,
        size: DimensionSize,
    ): DimensionGeometry | undefined {
        const entity = this.solver.entity(constraint.refs[0].entityId);
        if (entity === undefined) return undefined;
        const center: [number, number] = [entity.params[0], entity.params[1]];
        const radius = entityRadius(entity);
        const anchor = this.anchors.get(constraint.id);
        const [dx, dy] = anchor?.kind === "vector" ? [anchor.dx, anchor.dy] : [radius, radius];
        return radiusDimension(center, radius, [dx, dy], size);
    }

    /** World units per screen pixel at the view center (falls back to 1). */
    private pixelSize(): number {
        return viewPixelSize(this.view, this.solver.plane.origin) ?? 1;
    }

    private toEdgeMesh(
        segments: [number, number, number, number][],
        color: number = DIMENSION_COLOR,
    ): EdgeMeshData {
        const position = new Float32Array(segments.length * 6);
        segments.forEach(([x1, y1, x2, y2], i) => {
            const p1 = toWorld(this.solver.plane, x1, y1);
            const p2 = toWorld(this.solver.plane, x2, y2);
            position.set([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], i * 6);
        });
        return { position, range: [], color, lineType: "solid" };
    }

    /** The solid arrowheads as one face mesh: three corners per triangle, indexed in order. */
    private toFaceMesh(
        corners: DimensionGeometry["triangles"],
        color: number = DIMENSION_COLOR,
    ): FaceMeshData {
        const position = new Float32Array(corners.length * 3);
        const normal = new Float32Array(corners.length * 3);
        const index = new Uint32Array(corners.length);
        const n = this.solver.plane.normal;
        corners.forEach(([u, v], i) => {
            const p = toWorld(this.solver.plane, u, v);
            position.set([p.x, p.y, p.z], i * 3);
            normal.set([n.x, n.y, n.z], i * 3);
            index[i] = i;
        });
        return {
            position,
            normal,
            index,
            uv: new Float32Array(corners.length * 2),
            groups: [{ start: 0, count: corners.length, materialIndex: 0 }],
            range: [],
            color,
        };
    }

    /**
     * Lays one label out as glyph triangles and appends them to the face corners. The layout
     * comes in ems, centered horizontally on the anchor with y up from the baseline; the local
     * frame is the label direction and its left normal. Directions pointing left flip 180° so
     * the text always reads left-to-right.
     */
    private pushTextTriangles(corners: [number, number][], item: DimensionText, px: number): void {
        // nothing before the font arrives; `onFontLoaded` refreshes and lays the text out then
        if (defaultFontService.outline === undefined) return;
        const positions = defaultFontService.layout(item.text);
        const em = SKETCH_TEXT_HEIGHT_PX * px;
        let dirX = item.direction[0];
        let dirY = item.direction[1];
        let sideX = -dirY;
        let sideY = dirX;
        const angle = Math.atan2(dirY, dirX);
        // A baseline pointing left would draw the text upside down: turn the whole frame
        // half a turn so it reads left-to-right. (The 3D batch reaches the same reading
        // through its camera-facing mirror test — the dimension plane's normal, derived
        // from the direction, already flips when the baseline runs backwards.)
        if (angle > Math.PI / 2 || angle <= -Math.PI / 2) {
            dirX = -dirX;
            dirY = -dirY;
            sideX = -sideX;
            sideY = -sideY;
        }
        for (let i = 0; i + 1 < positions.length; i += 2) {
            const x = positions[i] * em;
            const y = positions[i + 1] * em;
            corners.push([item.u + dirX * x + sideX * y, item.v + dirY * x + sideY * y]);
        }
    }

    /**
     * Records a resolved badge instead of building it. Whether two badges collide is only
     * knowable once every candidate anchor is resolved, so the whole set is collected first
     * and `placeBadges` resolves the overlap in one pass.
     */
    private queueBadge(
        label: string,
        u: number,
        v: number,
        constraint: SketchConstraintData,
        refs: readonly SketchPointRef[] = constraint.refs,
        draggable = false,
        icon?: string,
        ghost = false,
    ): void {
        this.pendingBadges.push({
            constraint,
            refs,
            u,
            v,
            entityIds: [...new Set(refs.map((r) => r.entityId))],
            draggable,
            ghost,
            label,
            icon,
        });
    }

    // ------------------------------------------------------------------ Badge placement

    /**
     * Turns the collected placements into DOM.
     *
     * Stackable badges are clustered first — every constraint whose anchor the badge sits on
     * resolves to the same point, so without this they draw on top of each other. A cluster of
     * two or more constraints becomes one chip that opens into a row on hover; a lone badge
     * takes the original path untouched, which is what keeps a single constraint's badge
     * exactly where it has always been. A constraint counts once however many of its own
     * badges landed in the cluster (`distinctConstraints`).
     *
     * Datum dimensions never cluster: their position is the one the user placed.
     *
     * Clustering sees every candidate anchor, including the ones whose constraint is not
     * visible yet. That is what keeps a chip's identity stable — it cannot depend on which
     * of its members happens to be visible at the moment. Measuring the hidden ones costs
     * a little, and sketches are small.
     */
    private placeBadges(px: number): void {
        const groups = clusterBadges(this.pendingBadges, BADGE_STACK_DISTANCE_PX * px);
        const clusterOf = new Map<BadgePlacement, BadgeCluster>();
        this.stacksByConstraint.clear();
        for (const [key, members] of groups.entries()) {
            // one object per group: `emitted` below identifies a cluster by it
            const cluster: BadgeCluster = { key, members };
            for (const placement of members) {
                clusterOf.set(placement, cluster);
                const stacks = this.stacksByConstraint.get(placement.constraint.id) ?? new Set<number>();
                stacks.add(key);
                this.stacksByConstraint.set(placement.constraint.id, stacks);
            }
        }
        this.forcedStackKeys = this.stacksForcedOpen();
        const emitted = new Set<BadgeCluster>();
        for (const placement of this.pendingBadges) {
            const cluster = clusterOf.get(placement);
            if (cluster === undefined) {
                // a datum dimension: never stacked, and shown regardless of any highlight
                this.createBadge(placement);
                continue;
            }
            if (emitted.has(cluster)) continue;
            emitted.add(cluster);
            // a constraint that badged two entities close enough to overlap is still one
            // constraint, so the cluster holds it once
            const members = distinctConstraints(cluster.members).filter(
                (member) =>
                    this.forcedStackKeys.has(cluster.key) ||
                    this.isConstraintVisible(member.constraint, member.refs),
            );
            if (members.length >= 2) {
                this.createStackBadge(members, cluster.key);
            } else if (members.length === 1) {
                this.createBadge(members[0]);
            }
        }
    }

    /**
     * Stack keys whose members must stay up regardless of entity highlight: the chip the
     * cursor is on, and every one holding a badge of the panel-hovered constraint. Keeping
     * the group whole is load bearing — hovering a badge clears the entity hover and rebuilds
     * the badges out from under the cursor (`highlightConstraintEntities` →
     * `setHighlightedEntities` → `refresh`), so without this the stack would collapse the
     * instant the cursor reached it, leaving just the one member that is hovered.
     *
     * A member hover needs no entry of its own: the cursor can only be on a member while the
     * chip around it is open, and that already carries the cursor.
     */
    private stacksForcedOpen(): Set<number> {
        const keys = new Set<number>();
        if (this.hoveredStackKey !== undefined) keys.add(this.hoveredStackKey);
        if (this.panelHoveredConstraint !== undefined) {
            // every stack this constraint badges, not just one: the row the pointer is on
            // must open whichever chip holds its badge
            for (const stack of this.stacksByConstraint.get(this.panelHoveredConstraint) ?? []) {
                keys.add(stack);
            }
        }
        return keys;
    }

    /** A lone badge — the original one, unchanged. */
    private createBadge(placement: BadgePlacement): void {
        const { constraint, u, v, entityIds, draggable, ghost, label, icon } = placement;
        const id = constraint.id;
        this.badgeAnchors.push({ u, v, entityIds });
        this.items.push(
            this.view.htmlText(label, toWorld(this.solver.plane, u, v), {
                hideDelete: true,
                interactive: true,
                // a ghost is invisible: the mesh glyphs carry the text, the badge
                // only keeps the hover/drag/double-click interaction alive
                className: ghost ? `${style.badge} ${style.ghost}` : style.badge,
                onCreated: (element) => {
                    this.registerBadgeElement(element, id, !draggable);
                    renderBadgeFace(element, label, icon);
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
     * The chip of a stack: one badge standing in for all of them, opening into a row of the
     * real ones on hover. It anchors at the leader's position — that much of the original
     * placement stays put, so the badge still sits next to the geometry it belongs to.
     */
    private createStackBadge(members: readonly BadgePlacement[], key: number): void {
        const leader = members[0];
        const memberIds = members.map((member) => member.constraint.id);
        const entityIds = [...new Set(members.flatMap((member) => member.entityIds))];
        const { u, v } = leader;
        this.badgeAnchors.push({ u, v, entityIds });
        this.items.push(
            this.view.htmlText(leader.label, toWorld(this.solver.plane, u, v), {
                hideDelete: true,
                interactive: true,
                className: `${style.badge} ${style.stack}`,
                onCreated: (element) => {
                    this.registerBadgeElement(element, memberIds[0], !members.some((m) => m.draggable));
                    this.applyStackClasses(element, memberIds, key);
                    // a stack near the right edge would have its row clipped by the
                    // CSS2D container's overflow:hidden, so that one opens leftwards
                    if (this.stackOpensLeft(u, v, members.length)) element.classList.add(style.flip);
                    renderBadgeFace(element, leader.label, leader.icon);
                    element.append(
                        createStackCount(members.length),
                        this.createStackMembers(element, members),
                    );
                    this.stackChips.push({ element, key, memberIds });
                },
                onMouseEnter: () => this.enterStack(key, entityIds),
                onMouseLeave: () => this.leaveStack(key, memberIds),
                // the chip stands for the whole group, so a click selects all of it —
                // picking out one of them is what the opened row is for
                onClick: (event) => {
                    event.stopPropagation();
                    this.toggleStackSelection(memberIds, event.shiftKey);
                },
            }),
        );
    }

    /**
     * The badges inside a chip. They are plain elements, not labels of their own: nesting
     * them under the chip is what keeps the hover alive while the cursor moves between them
     * (mouseleave does not fire while the pointer stays inside the chip's subtree).
     */
    private createStackMembers(chip: HTMLElement, members: readonly BadgePlacement[]): HTMLElement {
        const row = document.createElement("div");
        row.className = style.stackMembers;
        for (const member of members) {
            const id = member.constraint.id;
            const element = document.createElement("div");
            element.className = `${style.badge} ${style.stackMember}`;
            renderBadgeFace(element, member.label, member.icon);
            this.registerBadgeElement(element, id, !member.draggable);
            element.addEventListener("mouseenter", () => {
                this.hoveredConstraint = id;
                this.onHighlightEntities(member.entityIds);
            });
            element.addEventListener("mouseleave", (event) => this.leaveStackMember(chip, id, event));
            element.addEventListener("click", (event) => {
                // the chip's own click selects the whole group; a member click is not that
                event.stopPropagation();
                this.toggleSelection(id, event.shiftKey);
            });
            row.append(element);
        }
        return row;
    }

    /** Registers a badge under its constraint and applies the look its state calls for. */
    private registerBadgeElement(element: HTMLElement, id: number, symbol: boolean): void {
        const list = this.badgeElements.get(id) ?? [];
        list.push(element);
        this.badgeElements.set(id, list);
        element.classList.toggle(style.inert, symbol && this.symbolsInert);
        element.classList.toggle(style.selected, this.selectedConstraints.has(id));
        // a conflicting constraint reads solid red — for a ghost datum the badge
        // stays invisible (`.ghost.conflicting`) and the red mesh is the signal
        element.classList.toggle(style.conflicting, this.conflictingConstraints.has(id));
        // redundant reads amber on the same terms
        element.classList.toggle(style.redundant, this.redundantConstraints.has(id));
        // panel-row hover puts the badge in its hover look (the pointer is on the list)
        element.classList.toggle(style.hovered, this.panelHoveredConstraint === id);
        // A datum whose expression stopped resolving keeps its last geometry
        // (`SketchSolver.datumOf`) — this badge is the only place that says so,
        // so it carries the reason as its tooltip and reads as broken.
        const datumError = this.solver.datumErrors.get(id);
        if (datumError !== undefined) {
            element.classList.add(style.error);
            element.title = datumError;
        }
    }

    /** The chip's own look: a stack reads as flagged/selected when any member does. */
    private applyStackClasses(element: HTMLElement, memberIds: readonly number[], key: number): void {
        element.classList.toggle(
            style.conflicting,
            memberIds.some((id) => this.conflictingConstraints.has(id)),
        );
        element.classList.toggle(
            style.redundant,
            memberIds.some((id) => this.redundantConstraints.has(id)),
        );
        element.classList.toggle(
            style.selected,
            memberIds.some((id) => this.selectedConstraints.has(id)),
        );
        // being forced open is the same thing as being open: the cursor is on the chip, or
        // the panel row of a constraint inside it is
        element.classList.toggle(style.expanded, this.forcedStackKeys.has(key));
    }

    private enterStack(key: number, entityIds: number[]): void {
        // idempotent: the rebuild that this triggers can put a fresh chip under a
        // stationary cursor, and re-highlighting would redraw the mesh for nothing
        if (this.hoveredStackKey === key) return;
        this.hoveredStackKey = key;
        this.setStackExpanded(key, true);
        this.onHighlightEntities(entityIds);
    }

    private leaveStack(key: number, memberIds: readonly number[]): void {
        if (this.rebuilding || this.hoveredStackKey !== key) return;
        this.hoveredStackKey = undefined;
        // a member hovered on the way out would otherwise stay hovered for good
        if (this.hoveredConstraint !== undefined && memberIds.includes(this.hoveredConstraint)) {
            this.hoveredConstraint = undefined;
        }
        this.setStackExpanded(key, false);
        this.onHighlightEntities([]);
    }

    /**
     * A member's leave only tears the hover down if the cursor actually left the chip:
     * moving back onto the chip leaves the member (the chip is its ancestor, not its
     * descendant) while the pointer is still well inside the stack.
     */
    private leaveStackMember(chip: HTMLElement, id: number, event: MouseEvent): void {
        if (this.rebuilding || this.hoveredConstraint !== id) return;
        const next = event.relatedTarget;
        if (next instanceof Node && chip.contains(next)) return;
        this.hoveredConstraint = undefined;
        this.onHighlightEntities([]);
    }

    /**
     * Opening and closing toggle the class directly rather than relying on a refresh: the
     * rebuild only happens when the entity highlight actually changes, and a chip the
     * cursor merely reached must open either way.
     */
    private setStackExpanded(key: number, expanded: boolean): void {
        for (const chip of this.stackChips) {
            if (chip.key === key) chip.element.classList.toggle(style.expanded, expanded);
        }
    }

    /** A chip click selects the whole group; clicking a fully selected one clears it. */
    private toggleStackSelection(memberIds: readonly number[], additive: boolean): void {
        if (additive) {
            for (const id of memberIds) this.selectedConstraints.add(id);
        } else if (memberIds.every((id) => this.selectedConstraints.has(id))) {
            for (const id of memberIds) this.selectedConstraints.delete(id);
        } else {
            this.selectedConstraints.clear();
            for (const id of memberIds) this.selectedConstraints.add(id);
        }
        this.applySelectionClasses();
        this.onSelectionChanged?.(this.selectedConstraintIds);
    }

    /** True when a stack's row would run off the right edge, where the renderer clips it. */
    private stackOpensLeft(u: number, v: number, memberCount: number): boolean {
        const screen = this.view.worldToScreen(toWorld(this.solver.plane, u, v));
        return screen.x + memberCount * STACK_MEMBER_WIDTH_PX > this.view.width;
    }

    // ------------------------------------------------------------------ Badge hit-testing and label dragging

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
     * Repositions a datum label by dragging its badge.
     *
     * - **Both gestures work:** press-drag-release, and click-move-click — a press released
     *   without travel picks the label up, it then follows the cursor, and the next click
     *   (anywhere, even on the label itself) drops it.
     * - **The anchor is recomputed** from the pointer on every move. The refresh rebuilds the
     *   badge mid-drag, so the session listens on window rather than on the badge.
     * - **Why the window listeners use the capture phase.** Interactive badges
     *   `stopPropagation` on pointerdown/up (threeView), and since the label follows the cursor
     *   the release usually lands on the badge — a bubble-phase listener would never see it and
     *   the drag would stick.
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
                return { kind: "offset", ...labelOnSegment(points[0], points[1], uv) };
            case ConstraintKind.HorizontalDistance:
                return { kind: "offset", ...labelOnAxis(points[0], points[1], "h", uv) };
            case ConstraintKind.VerticalDistance:
                return { kind: "offset", ...labelOnAxis(points[0], points[1], "v", uv) };
            case ConstraintKind.P2LDistance: {
                const foot = pointLineFoot(points[0], points[1], points[2]);
                return foot === undefined
                    ? undefined
                    : { kind: "offset", ...labelOnSegment(points[0], foot, uv) };
            }
            case ConstraintKind.Radius: {
                const entity = this.solver.entity(constraint.refs[0].entityId);
                if (entity === undefined) return undefined;
                return { kind: "vector", dx: uv[0] - entity.params[0], dy: uv[1] - entity.params[1] };
            }
            case ConstraintKind.Angle: {
                const vertex = angleVertex(points[0], points[1], points[2], points[3]);
                return { kind: "vector", dx: uv[0] - vertex[0], dy: uv[1] - vertex[1] };
            }
            default:
                return undefined;
        }
    }

    // ------------------------------------------------------------------ Selection bookkeeping

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
        this.onSelectionChanged?.(this.selectedConstraintIds);
    }

    private applySelectionClasses(): void {
        for (const [id, elements] of this.badgeElements) {
            for (const element of elements) {
                element.classList.toggle(style.selected, this.selectedConstraints.has(id));
            }
        }
        // a chip reads as selected when any of the constraints it stands for is
        for (const chip of this.stackChips) {
            chip.element.classList.toggle(
                style.selected,
                chip.memberIds.some((id) => this.selectedConstraints.has(id)),
            );
        }
    }

    private disposeItems(): void {
        for (const item of this.items) {
            item.dispose();
        }
        this.items = [];
        this.badgeElements.clear();
        this.badgeAnchors = [];
        this.pendingBadges = [];
        this.stackChips = [];
        this.stacksByConstraint.clear();
        // `hoveredStackKey` deliberately survives: the refresh that these disposals are
        // part of has to find it and re-open the same chip once the badges are back
        if (this.meshId !== undefined) {
            this.view.document.visual.context.removeMesh(this.meshId);
            this.meshId = undefined;
        }
    }
}

/** SVG element referencing the toolbar iconfont symbol (sized/colored via CSS). */
export function badgeIcon(name: string): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", `#${name}`);
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${name}`);
    const icon = document.createElementNS(ns, "svg");
    icon.append(use);
    return icon;
}

/** Applies the constraint icon of `symbol` to a badge element, falling back to its label. */
export function applyConstraintIcon(element: HTMLElement, symbol: BadgeSymbol): void {
    renderBadgeFace(element, symbol.label, symbol.icon);
}

/**
 * Draws a badge's face: the constraint's command icon when it has one, its label otherwise.
 * Shared by the lone badge, the chip and the chip's members, so the three cannot drift apart.
 */
function renderBadgeFace(element: HTMLElement, label: string, icon?: string): void {
    if (icon === undefined) {
        element.textContent = label;
        return;
    }
    element.classList.add(style.symbol);
    element.replaceChildren(badgeIcon(icon));
}

/** The "how many badges stand behind this" corner mark of a chip. */
function createStackCount(count: number): HTMLElement {
    const badge = document.createElement("span");
    badge.className = style.stackCount;
    badge.textContent = String(count);
    return badge;
}

/**
 * Groups the badges that would otherwise draw on top of each other, by leader: the first
 * placement of a group fixes its anchor, and a later one joins only when it lands within
 * `mergeDistance` of that anchor. Measuring against the leader rather than the previous
 * member is what stops a chain (A near B near C) from walking the stack away from where its
 * first badge belongs.
 *
 * Datum dimensions are left out — their position is the one the user placed.
 */
export function clusterBadges<T extends { u: number; v: number; draggable: boolean }>(
    placements: readonly T[],
    mergeDistance: number,
): T[][] {
    const groups: T[][] = [];
    for (const placement of placements) {
        if (placement.draggable) continue;
        const group = groups.find(
            (candidate) =>
                Math.hypot(candidate[0].u - placement.u, candidate[0].v - placement.v) <= mergeDistance,
        );
        if (group === undefined) {
            groups.push([placement]);
        } else {
            group.push(placement);
        }
    }
    return groups;
}

/**
 * One badge per constraint, keeping the first. A constraint that badges several entities
 * puts a placement on each of them, and two of those can land inside the merge distance of
 * `clusterBadges` — the constraint is still one member of the stack, not two.
 */
function distinctConstraints(placements: readonly BadgePlacement[]): BadgePlacement[] {
    const seen = new Set<number>();
    return placements.filter((placement) => {
        if (seen.has(placement.constraint.id)) return false;
        seen.add(placement.constraint.id);
        return true;
    });
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
