// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plane } from "@chili3d/core";
import type { WasmSystem } from "../../lib/garlic";
import { newGarlicSystem } from "./garlic";
import {
    ConstraintKind,
    datumEntityData,
    datumPoint,
    type ExternalRefData,
    entityPointCount,
    FIRST_EXTERNAL_ENTITY_ID,
    INCIDENCE_TOLERANCE,
    isDatumEntityId,
    isExternalEntityId,
    nextSketchId,
    pointRefKey,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    syncExternalRoles,
} from "./sketchModel";

function findRoot(parent: Map<string, string>, key: string): string {
    let root = key;
    while (parent.get(root) !== root) {
        root = parent.get(root)!;
    }
    return root;
}

const PARAM_KIND_COORDINATE = 0;
const PARAM_KIND_LENGTH = 1;

function projectOntoCircle(
    center: [number, number],
    radius: number,
    u: number,
    v: number,
): [number, number] | undefined {
    const dx = u - center[0];
    const dy = v - center[1];
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-12) return undefined;
    return [center[0] + (dx / distance) * radius, center[1] + (dy / distance) * radius];
}

/** garlic param kinds per entity type: line = 2 points, circle = center + radius, arc = 3 points. */
const ENTITY_PARAM_KINDS: Record<SketchEntityType, number[]> = {
    line: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE],
    circle: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_LENGTH],
    arc: [
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
    ],
};

/**
 * Pads/truncates a snapshot to the entity type's param layout. Hand-edited or
 * legacy data can carry a truncated snapshot — normalizing beats throwing from a
 * property-listener path (updateExternalEntity's length guard), seeding garlic
 * with a short param array, or feeding NaN coordinates to shape building. Unknown
 * types and already-matching lengths pass through unchanged (same array identity).
 */
export function normalizeSnapshot(type: SketchEntityType, snapshot: number[]): number[] {
    const count = ENTITY_PARAM_KINDS[type]?.length;
    if (count === undefined || snapshot.length === count) return snapshot;
    return Array.from({ length: count }, (_, index) => snapshot[index] ?? 0);
}

export interface SolveOutcome {
    result: string;
    dofs: number;
}

interface ConstraintRecord {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    garlicId: number;
    datumParamIds?: number[];
}

/**
 * Internal structural pins of one seeded external entity (a Fix per point, plus a
 * Radius for circles): `datumParamIds[i]` is the structural datum pinning the
 * entity's `entityParams[i]`, so the net dofs contribution is zero and
 * `updateExternalEntity` can move the entity by rewriting both sides. The
 * structural constraints stay out of `this.constraints`, so they are never
 * serialized, annotated or removable. The entity itself lives in the regular
 * entity tables (`entityTypes`/`entityParams`/`entityCache`) marked fixed.
 */
interface ExternalPins {
    datumParamIds: number[];
    constraintIds: number[];
}

/**
 * Wraps one garlic `WasmSystem` for a sketch on a given plane.
 * Entity/constraint ids exposed here are stable and owned by this class;
 * garlic ParamId/ConstraintId handles stay internal.
 */
export class SketchSolver {
    readonly plane: Plane;
    private system: WasmSystem;
    /** Entity tables holding real AND external entities (externals under reserved negative ids). */
    private readonly entityTypes = new Map<number, SketchEntityType>();
    private readonly entityParams = new Map<number, number[]>();
    private readonly entityCache = new Map<number, number[]>();
    private readonly constraints = new Map<number, ConstraintRecord>();
    /** garlic param ids of the datum entities (origin, X/Y axes), keyed by reserved id. */
    private readonly datumParams = new Map<number, number[]>();
    /** Internal constraints pinning the datum (never serialized, shown or removable). */
    private structuralConstraintIds: number[] = [];
    /**
     * Entities that can be constraint targets but never dragged, deleted or
     * param-edited: the datum (origin, X/Y axes) and every seeded external entity.
     */
    private readonly fixedEntities = new Set<number>();
    /** Internal structural pins of the seeded external entities, keyed by their reserved negative ids. */
    private readonly externalPins = new Map<number, ExternalPins>();
    /** External refs carried through `toData`; the sketch node owns their persistent state. */
    private externalRefs: ExternalRefData[] = [];
    /** Timeline anchors carried through `toData` like `externalRefs` (see SketchData.refPositions). */
    private refPositions: Record<string, number> | undefined;
    /**
     * Node id of the sketch plane's face owner (SketchNode.planeRef), set by the
     * editor — the solver never sees the node-level planeRef. That anchor has a
     * second consumer beyond the refs (`computeSketchRollback` seeds from it even
     * when no feature references the sketch), so it is exempt from the last-ref
     * prune in `removeExternalEntity`: deleting every auto-captured boundary ref
     * must not stop the session rollback of the body the sketch still sits on.
     * Node-level, not data-level — survives `reset`.
     */
    planeOwnerNodeId: string | undefined;
    private draggedParamIds: number[] = [];
    /**
     * Monotonic id allocation, serialized as SketchData.entityIdSeq/externalIdSeq:
     * freed ids are never reused, so a stale ProfileRef fingerprint (keyed on entity
     * ids) can never match a geometrically different region. Real ids count up from
     * 1, external ids count down from FIRST_EXTERNAL_ENTITY_ID.
     */
    private entityIdSeq = 1;
    private externalIdSeq = FIRST_EXTERNAL_ENTITY_ID;
    /**
     * Counter emission gate: `toData` writes the counters only when the loaded data
     * carried them or an allocation happened since — a no-op session on a
     * pre-counter document must round-trip byte-identical, or every sketch exit
     * would record a phantom history entry.
     */
    private idCountersPersisted = false;
    private idAllocatedSinceLoad = false;
    /** Constraint ids cascaded away by the latest `syncExternalRefs` (type-flip reseed or drop). */
    private removedConstraintIds: number[] = [];

    constructor(plane: Plane, data?: SketchData) {
        this.plane = plane;
        this.system = newGarlicSystem();
        this.seedDatum();
        if (data !== undefined) {
            this.loadData(data);
        }
    }

    addLine(x1: number, y1: number, x2: number, y2: number): number {
        return this.registerEntity("line", this.addEntityParams("line", [x1, y1, x2, y2]));
    }

    addCircle(cx: number, cy: number, r: number): number {
        return this.registerEntity("circle", this.addEntityParams("circle", [cx, cy, r]));
    }

    addArc(cx: number, cy: number, sx: number, sy: number, ex: number, ey: number): number {
        const id = this.registerEntity("arc", this.addEntityParams("arc", [cx, cy, sx, sy, ex, ey]));
        // structural constraint (invisible in the UI): keeps the end point on the
        // circle defined by center + start, so the arc always ends at its end point
        this.addConstraint({
            kind: ConstraintKind.PointOnArc,
            refs: [
                { entityId: id, pointIndex: 2 },
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 1 },
            ],
        });
        return id;
    }

    addConstraint(constraint: Omit<SketchConstraintData, "id">): number {
        const id = nextSketchId([...this.constraints.values()]);
        this.addConstraintWithId(id, constraint);
        return id;
    }

    removeConstraint(id: number): void {
        const record = this.constraints.get(id);
        // Deletion stays idempotent: the UI can carry a dead id (e.g. an annotation
        // whose constraint was cascaded away untransacted by syncExternalRefs), and
        // a no-op beats throwing from a delete handler.
        if (record === undefined) return;
        this.system.remove_constraint(record.garlicId);
        for (const datumParamId of record.datumParamIds ?? []) {
            this.system.remove_param(datumParamId);
        }
        this.constraints.delete(id);
    }

    /** Removes the entity and every constraint referencing it; returns removed constraint ids. */
    removeEntity(id: number): number[] {
        if (isDatumEntityId(id)) {
            throw new Error("The sketch datum cannot be removed");
        }
        if (isExternalEntityId(id)) {
            throw new Error("External references are removed with removeExternalEntity");
        }
        const paramIds = this.entityParams.get(id);
        if (paramIds === undefined) {
            throw new Error(`Unknown sketch entity: ${id}`);
        }
        const removedConstraints: number[] = [];
        for (const record of [...this.constraints.values()]) {
            if (record.refs.some((r) => r.entityId === id)) {
                this.removeConstraint(record.id);
                removedConstraints.push(record.id);
            }
        }
        for (const paramId of paramIds) {
            this.system.remove_param(paramId);
        }
        this.entityTypes.delete(id);
        this.entityParams.delete(id);
        this.entityCache.delete(id);
        return removedConstraints;
    }

    /**
     * Seeds an external reference into the regular entity tables under its reserved
     * negative id, marked fixed and pinned like the datum: every point is pinned by
     * an internal Fix (circles also pin the radius), so the net dofs contribution
     * is zero. The ref joins the carried list that `toData` preserves.
     */
    addExternalEntity(ref: ExternalRefData): void {
        if (this.externalPins.has(ref.entityId)) {
            throw new Error(`External reference already seeded: ${ref.entityId}`);
        }
        this.seedExternalEntity(ref.entityId, ref.type, normalizeSnapshot(ref.type, ref.snapshot));
        // the counter stays below every seeded id, even one allocated outside it
        this.externalIdSeq = Math.min(this.externalIdSeq, ref.entityId - 1);
        this.externalRefs.push(ref);
    }

    /**
     * Allocates the next external entity id from the monotonic session counter
     * (counts down from FIRST_EXTERNAL_ENTITY_ID, never reissuing a freed id).
     * Command/editor-side allocation — the id is then seeded with addExternalEntity.
     */
    allocateExternalEntityId(): number {
        this.idAllocatedSinceLoad = true;
        return this.externalIdSeq--;
    }

    /** Whether the entity is fixed (datum or external): targetable, but never movable/deletable/editable. */
    isFixed(entityId: number): boolean {
        return this.fixedEntities.has(entityId);
    }

    /**
     * Ids of the user constraints the latest `syncExternalRefs` cascaded away —
     * through a type-flip reseed (their entity's param layout changed, so they could
     * not survive) or through a dropped ref (their target geometry no longer exists).
     * Both are reported so the editor can drop the constraints' dimension anchors:
     * an unreported removal would leave orphan anchors in `SketchData.anchors`.
     * Cleared at the start of every `syncExternalRefs` call.
     */
    get lastRemovedConstraintIds(): readonly number[] {
        return this.removedConstraintIds;
    }

    /**
     * Anchors a newly referenced body's timeline position (its current feature
     * count). The first reference anchors it; later references to the same body
     * keep the anchor — the sketch's timeline position does not move.
     */
    recordRefPosition(nodeId: string, featureCount: number): void {
        if (this.refPositions?.[nodeId] !== undefined) return;
        if (this.refPositions === undefined) this.refPositions = {};
        this.refPositions[nodeId] = featureCount;
    }

    /**
     * Removes an external reference and every constraint referencing it; returns
     * the removed constraint ids. The structural pins, their datum params and the
     * entity params are removed from garlic (constraints first — params in use
     * cannot be removed).
     */
    removeExternalEntity(id: number): number[] {
        const pins = this.externalPins.get(id);
        if (pins === undefined) {
            throw new Error(`Unknown external reference: ${id}`);
        }
        const removedConstraints = this.removeConstraintsOn(id);
        for (const constraintId of pins.constraintIds) {
            this.system.remove_constraint(constraintId);
        }
        for (const paramId of pins.datumParamIds) {
            this.system.remove_param(paramId);
        }
        for (const paramId of this.entityParams.get(id)!) {
            this.system.remove_param(paramId);
        }
        this.externalPins.delete(id);
        this.fixedEntities.delete(id);
        this.entityTypes.delete(id);
        this.entityParams.delete(id);
        this.entityCache.delete(id);
        const nodeId = this.externalRefs.find((ref) => ref.entityId === id)?.nodeId;
        this.externalRefs = this.externalRefs.filter((ref) => ref.entityId !== id);
        this.pruneRefPosition(nodeId);
        return removedConstraints;
    }

    /**
     * The last ref to a source node takes its timeline anchor with it — a stale
     * anchor would keep rolling that body back on every edit session
     * (computeSketchRollback), hiding features the sketch no longer relates to.
     * The plane owner's anchor is exempt: it also anchors the face the sketch
     * sits on, which outlives the auto-captured boundary refs.
     */
    private pruneRefPosition(nodeId: string | undefined): void {
        if (nodeId === undefined || nodeId === this.planeOwnerNodeId || this.refPositions === undefined) {
            return;
        }
        if (this.externalRefs.some((ref) => ref.nodeId === nodeId)) {
            return;
        }
        delete this.refPositions[nodeId];
        // a fully pruned map goes back to absent for a byte-identical round-trip
        if (Object.keys(this.refPositions).length === 0) this.refPositions = undefined;
    }

    /** Removes every constraint referencing the entity; returns removed constraint ids. */
    removeConstraintsOn(entityId: number): number[] {
        const removed: number[] = [];
        for (const record of [...this.constraints.values()]) {
            if (record.refs.some((r) => r.entityId === entityId)) {
                this.removeConstraint(record.id);
                removed.push(record.id);
            }
        }
        return removed;
    }

    /**
     * Moves a seeded external entity to newly resolved geometry: rewrites both the
     * entity params and the structural datum params pinning them (the JS-side cache
     * follows, so reads never cross wasm). Callers run a fine solve afterwards so
     * the attached geometry follows.
     */
    updateExternalEntity(id: number, params: number[]): void {
        const pins = this.externalPins.get(id);
        const paramIds = this.entityParams.get(id);
        if (pins === undefined || paramIds === undefined) {
            throw new Error(`Unknown external reference: ${id}`);
        }
        if (params.length !== paramIds.length) {
            throw new Error(`External reference ${id} expects ${paramIds.length} params`);
        }
        const cache = this.entityCache.get(id)!;
        for (let i = 0; i < params.length; i++) {
            this.system.set_param(paramIds[i], params[i]);
            this.system.set_param(pins.datumParamIds[i], params[i]);
            cache[i] = params[i];
        }
    }

    /**
     * Reconciles the seeded external entities with `refs` (the node re-resolved
     * them behind the solver's back): seeds new ones, removes dropped ones (with
     * their constraints), moves ones whose snapshot changed. A type flip reseeds
     * the entity — its constraints cannot survive the param-layout change and are
     * removed. Both cascades are exposed via `lastRemovedConstraintIds` so the
     * editor can drop the removed constraints' dimension anchors. Returns whether
     * anything changed.
     */
    syncExternalRefs(refs: ExternalRefData[]): boolean {
        this.removedConstraintIds = [];
        let changed = false;
        for (const id of [...this.externalPins.keys()]) {
            if (!refs.some((ref) => ref.entityId === id)) {
                // a dropped ref's constraints die with it — report them like a type
                // flip does, or their dimension anchors stay behind as orphans
                this.removedConstraintIds.push(...this.removeExternalEntity(id));
                changed = true;
            }
        }
        for (const ref of refs) {
            if (!this.externalPins.has(ref.entityId)) {
                this.addExternalEntity(ref);
                changed = true;
                continue;
            }
            if (this.entityTypes.get(ref.entityId) !== ref.type) {
                this.reseedExternalEntity(ref);
                changed = true;
                continue;
            }
            const current = this.entityCache.get(ref.entityId)!;
            // hand-edited/legacy snapshots can carry the wrong length; normalize
            // instead of letting updateExternalEntity throw from this listener path
            const snapshot = normalizeSnapshot(ref.type, ref.snapshot);
            if (current.some((value, index) => value !== snapshot[index])) {
                this.updateExternalEntity(ref.entityId, snapshot);
                changed = true;
            }
        }
        this.externalRefs = refs;
        return changed;
    }

    /**
     * Type-flip reseed: constraints cannot survive the param-layout change, so the
     * entity is removed (cascading its constraints, exposed via
     * `lastRemovedConstraintIds`) and re-seeded. The source node's timeline anchor
     * is preserved across the removal.
     */
    private reseedExternalEntity(ref: ExternalRefData): void {
        const anchor = this.refPositions?.[ref.nodeId];
        this.removedConstraintIds.push(...this.removeExternalEntity(ref.entityId));
        this.addExternalEntity(ref);
        // the removal above prunes the anchor when this was the node's last ref
        // (and can empty the whole map) — restore it either way
        if (anchor !== undefined) {
            if (this.refPositions === undefined) this.refPositions = {};
            this.refPositions[ref.nodeId] = anchor;
        }
    }

    setDatum(constraintId: number, value: number, index = 0): void {
        const paramId = this.constraints.get(constraintId)?.datumParamIds?.[index];
        if (paramId === undefined) {
            throw new Error(`Constraint ${constraintId} has no datum ${index}`);
        }
        this.system.set_param(paramId, value);
    }

    /** Moves a point without solving; used by auto-constraint snapping before a solve. */
    setPointPosition(ref: SketchPointRef, u: number, v: number): void {
        if (isDatumEntityId(ref.entityId)) {
            throw new Error("The sketch datum cannot be moved");
        }
        if (isExternalEntityId(ref.entityId)) {
            throw new Error("An external reference cannot be moved");
        }
        const [xId, yId] = this.pointParamIds(ref);
        this.system.set_param(xId, u);
        this.system.set_param(yId, v);
        const [x, y] = this.pointCacheIndices(ref);
        const cache = this.entityCache.get(ref.entityId)!;
        cache[x] = u;
        cache[y] = v;
    }

    /** Kinds of constraints currently applied to any point of the entity. */
    constraintKindsOn(entityId: number): ConstraintKind[] {
        return [...this.constraints.values()]
            .filter((c) => c.refs.some((r) => r.entityId === entityId))
            .map((c) => c.kind);
    }

    /** Kinds of constraints currently applied to a specific point ref. */
    constraintKindsOnPoint(ref: SketchPointRef): ConstraintKind[] {
        return [...this.constraints.values()]
            .filter((c) => c.refs.some((r) => pointRefKey(r) === pointRefKey(ref)))
            .map((c) => c.kind);
    }

    /** Whether an identical constraint (same kind and refs, order-insensitive) already exists. */
    hasConstraint(kind: ConstraintKind, refs: SketchPointRef[]): boolean {
        const key = refs.map(pointRefKey).sort().join("|");
        return [...this.constraints.values()].some(
            (c) => c.kind === kind && c.refs.map(pointRefKey).sort().join("|") === key,
        );
    }

    solve(fine: boolean): SolveOutcome {
        this.syncAngleDatumSide();
        let report = this.system.solve(fine);
        this.refreshCache();
        // A fine solve can silently stall when the geometry starts far off its
        // constraints (e.g. a sketch saved mid-drift): snap any point left off its
        // incidence geometry back onto it and re-solve once to heal the state.
        if (fine && this.repairIncidenceResiduals()) {
            report = this.system.solve(true);
            this.refreshCache();
        }
        return {
            result: typeof report === "string" ? report : String(report?.result),
            dofs: this.system.dofs(),
        };
    }

    /**
     * Snaps every point whose incidence constraint (point on line/circle/arc) is
     * violated beyond tolerance back onto its geometry. Returns whether anything moved.
     */
    private repairIncidenceResiduals(): boolean {
        let repaired = false;
        for (const record of this.constraints.values()) {
            const ref = record.refs[0];
            if (ref === undefined || this.fixedEntities.has(ref.entityId)) continue;
            const [u, v] = this.pointOf(ref);
            const projected = this.projectedIncidence(record, u, v);
            if (projected === undefined) continue;
            if (Math.hypot(projected[0] - u, projected[1] - v) <= INCIDENCE_TOLERANCE) continue;
            this.setPointPosition(ref, projected[0], projected[1]);
            repaired = true;
        }
        return repaired;
    }

    /** Projects (u, v) onto the line an incidence constraint pins any point of the dragged group to. */
    private projectOntoIncidence(groupKeys: Set<string>, u: number, v: number): [number, number] {
        let point: [number, number] = [u, v];
        for (const record of this.constraints.values()) {
            // lines only: circles/arcs stay loose during a coarse drag (the fine
            // solve re-asserts them on pointer-up)
            if (record.kind !== ConstraintKind.PointOnLine) continue;
            if (!groupKeys.has(pointRefKey(record.refs[0]))) continue;
            // self-incidence (the target geometry rides along with the dragged
            // group) has no fixed manifold to project onto
            if (record.refs.slice(1).some((r) => groupKeys.has(pointRefKey(r)))) continue;
            const projected = this.projectedIncidence(record, point[0], point[1]);
            if (projected !== undefined) point = projected;
        }
        return point;
    }

    /** Nearest position on the geometry an incidence constraint pins its point to. */
    private projectedIncidence(record: ConstraintRecord, u: number, v: number): [number, number] | undefined {
        switch (record.kind) {
            case ConstraintKind.PointOnLine: {
                const [x1, y1] = this.pointOf(record.refs[1]);
                const [x2, y2] = this.pointOf(record.refs[2]);
                const dx = x2 - x1;
                const dy = y2 - y1;
                const lengthSq = dx * dx + dy * dy;
                if (lengthSq < 1e-12) return undefined;
                const t = ((u - x1) * dx + (v - y1) * dy) / lengthSq;
                return [x1 + t * dx, y1 + t * dy];
            }
            case ConstraintKind.PointOnCircle: {
                const radius = this.currentRadius(record.refs[1].entityId);
                return projectOntoCircle(this.pointOf(record.refs[1]), radius, u, v);
            }
            case ConstraintKind.PointOnArc: {
                const center = this.pointOf(record.refs[1]);
                const start = this.pointOf(record.refs[2]);
                const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
                return projectOntoCircle(center, radius, u, v);
            }
            default:
                return undefined;
        }
    }

    /**
     * Angle datums are signed: the sign records which side of the first line the
     * second line sits on (the UI edits only the magnitude). Sync the sign with
     * the current geometry before solving, so an edit never flips a line across
     * its reference — and legacy unsigned datums adopt the loaded geometry's side.
     */
    private syncAngleDatumSide(): void {
        for (const [id, record] of this.constraints) {
            if (record.kind !== ConstraintKind.Angle || record.datumParamIds === undefined) continue;
            const sweep = this.currentSweep(record.refs);
            // ambiguous at 0°/180° — leave the datum sign alone
            if (Math.abs(sweep) < 1e-9 || Math.abs(Math.PI - Math.abs(sweep)) < 1e-9) continue;
            const datum = Number(this.system.get_params(new Uint32Array(record.datumParamIds))[0]);
            if (datum !== 0 && sweep * datum < 0) this.setDatum(id, -datum);
        }
    }

    /** Signed sweep (radians) from the first line's direction to the second's. */
    private currentSweep(refs: readonly SketchPointRef[]): number {
        const [x1, y1] = this.pointOf(refs[0]);
        const [x2, y2] = this.pointOf(refs[1]);
        const [x3, y3] = this.pointOf(refs[2]);
        const [x4, y4] = this.pointOf(refs[3]);
        const d1x = x2 - x1;
        const d1y = y2 - y1;
        const d2x = x4 - x3;
        const d2y = y4 - y3;
        if (Math.hypot(d1x, d1y) < 1e-12 || Math.hypot(d2x, d2y) < 1e-12) return 0;
        return Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    }

    dofs(): number {
        return this.system.dofs();
    }

    /** Data of every real (editable) entity; fixed datum/external entities are excluded. */
    entities(): SketchEntityData[] {
        return [...this.entityCache.entries()]
            .filter(([id]) => !this.fixedEntities.has(id))
            .map(([id, params]) => ({
                id,
                type: this.entityTypes.get(id)!,
                params: [...params],
            }));
    }

    /**
     * Current data of every seeded external reference, mirroring `entities()` for the
     * real geometry and served from the same JS-side cache (no wasm crossing).
     * Externals are pinned snap/constraint targets — never editable — so a snapped
     * constraint onto one is always satisfiable from the sketch side.
     */
    externalEntitiesData(): SketchEntityData[] {
        return [...this.externalPins.keys()].map((id) => ({
            id,
            type: this.entityTypes.get(id)!,
            params: [...this.entityCache.get(id)!],
        }));
    }

    /**
     * The external refs carried through `toData`, roles and dangling flags included.
     * During an editor session this is the live truth — `node.data` lags behind until
     * the next commit, so session displays and pick lists read the refs from here.
     */
    externalRefsData(): ExternalRefData[] {
        return [...this.externalRefs];
    }

    /** Current data of one entity, or undefined when unknown. Datum axes answer synthetic line data. */
    entity(id: number): SketchEntityData | undefined {
        if (id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID) return datumEntityData(id);
        const type = this.entityTypes.get(id);
        const params = this.entityCache.get(id);
        return type === undefined || params === undefined ? undefined : { id, type, params: [...params] };
    }

    pointOf(ref: SketchPointRef): [number, number] {
        if (isDatumEntityId(ref.entityId)) return datumPoint(ref);
        const [x, y] = this.pointCacheIndices(ref);
        const params = this.entityCache.get(ref.entityId)!;
        return [params[x], params[y]];
    }

    entityPoints(entityId: number): [number, number][] {
        const type = this.entityTypes.get(entityId);
        if (type === undefined) {
            throw new Error(`Unknown sketch entity: ${entityId}`);
        }
        switch (type) {
            case "line":
                return [this.pointOf({ entityId, pointIndex: 0 }), this.pointOf({ entityId, pointIndex: 1 })];
            case "arc":
                return [this.pointOf({ entityId, pointIndex: 1 }), this.pointOf({ entityId, pointIndex: 2 })];
            default:
                return [this.pointOf({ entityId, pointIndex: 0 })];
        }
    }

    /**
     * All point refs coincident-linked to `ref` (including `ref` itself).
     * Coincident constraints merge points conceptually; garlic keeps separate params,
     * so drag operations must move the whole group. Fixed (datum and external) refs
     * never join a group — fixed entities must not be dragged.
     */
    coincidentGroup(ref: SketchPointRef): SketchPointRef[] {
        const parent = this.coincidentParentMap();
        const key = pointRefKey(ref);
        if (!parent.has(key)) {
            return [ref];
        }
        const root = findRoot(parent, key);
        const group: SketchPointRef[] = [];
        for (const record of this.constraints.values()) {
            if (record.kind !== ConstraintKind.P2PCoincident) continue;
            for (const r of record.refs) {
                if (this.fixedEntities.has(r.entityId)) continue;
                if (
                    findRoot(parent, pointRefKey(r)) === root &&
                    !group.some((g) => pointRefKey(g) === pointRefKey(r))
                ) {
                    group.push(r);
                }
            }
        }
        return group;
    }

    /** Union-find parent map over all coincident-linked point refs (fixed refs excluded). */
    private coincidentParentMap(): Map<string, string> {
        const parent = new Map<string, string>();
        for (const record of this.constraints.values()) {
            if (record.kind !== ConstraintKind.P2PCoincident || record.refs.length !== 2) continue;
            if (record.refs.some((r) => this.fixedEntities.has(r.entityId))) continue;
            const a = pointRefKey(record.refs[0]);
            const b = pointRefKey(record.refs[1]);
            if (!parent.has(a)) parent.set(a, a);
            if (!parent.has(b)) parent.set(b, b);
            parent.set(findRoot(parent, a), findRoot(parent, b));
        }
        return parent;
    }

    beginDrag(refs: SketchPointRef[]): void {
        const paramIds = new Set<number>();
        for (const ref of refs) {
            for (const r of this.coincidentGroup(ref)) {
                if (this.fixedEntities.has(r.entityId)) continue;
                for (const id of this.pointParamIds(r)) {
                    paramIds.add(id);
                }
            }
        }
        this.draggedParamIds = [...paramIds];
        this.system.mark_dragged(new Uint32Array(this.draggedParamIds));
    }

    dragTo(ref: SketchPointRef, u: number, v: number): SolveOutcome {
        const group = this.coincidentGroup(ref).filter((r) => !this.fixedEntities.has(r.entityId));
        const groupKeys = new Set(group.map(pointRefKey));
        // A point pinned onto a line slides along it instead of following the raw
        // cursor: garlic's coarse solve does not converge from far off-manifold
        // positions, which would leave the point drifting off its constraint and
        // eventually surface as a bogus "Conflicting" report.
        const [pu, pv] = this.projectOntoIncidence(groupKeys, u, v);
        for (const r of group) {
            const [xId, yId] = this.pointParamIds(r);
            this.system.set_param(xId, pu);
            this.system.set_param(yId, pv);
        }
        return this.solve(false);
    }

    endDrag(): SolveOutcome {
        if (this.draggedParamIds.length > 0) {
            this.system.clear_dragged(new Uint32Array(this.draggedParamIds));
            this.draggedParamIds = [];
        }
        return this.solve(true);
    }

    toData(): SketchData {
        const constraints: SketchConstraintData[] = [...this.constraints.values()].map((record) => {
            const data: SketchConstraintData = {
                id: record.id,
                kind: record.kind,
                refs: record.refs.map((r) => ({ ...r })),
            };
            if (record.datumParamIds !== undefined) {
                const values = Array.from(this.system.get_params(new Uint32Array(record.datumParamIds)));
                if (values.length === 1) {
                    data.datum = values[0];
                } else {
                    data.datums = values;
                }
            }
            return data;
        });
        const result: SketchData = { entities: this.entities(), constraints };
        // external refs live in SketchData, not in the entity list — preserve them
        if (this.externalRefs.length > 0) {
            result.externalRefs = JSON.parse(JSON.stringify(this.externalRefs)) as ExternalRefData[];
            // roles derive from the constraints referencing each ref (pinned refs keep theirs)
            syncExternalRoles(result);
        }
        // timeline anchors are capture-time metadata the solver never derives — carry them
        if (this.refPositions !== undefined) {
            result.refPositions = { ...this.refPositions };
        }
        // monotonic id counters — carried so a freed id is never reused across
        // sessions; emitted only once they mean something (see the field comment)
        if (this.idCountersPersisted || this.idAllocatedSinceLoad) {
            result.entityIdSeq = this.entityIdSeq;
            result.externalIdSeq = this.externalIdSeq;
        }
        return result;
    }

    dispose(): void {
        this.system.free();
    }

    /** Replaces all state with `data` — undo/redo rewrites the node data behind the solver. */
    reset(data: SketchData): void {
        this.system.free();
        this.system = newGarlicSystem();
        this.entityTypes.clear();
        this.entityParams.clear();
        this.entityCache.clear();
        this.constraints.clear();
        this.fixedEntities.clear();
        this.externalPins.clear();
        this.externalRefs = [];
        this.refPositions = undefined;
        this.entityIdSeq = 1;
        this.externalIdSeq = FIRST_EXTERNAL_ENTITY_ID;
        this.removedConstraintIds = [];
        this.draggedParamIds = [];
        this.seedDatum();
        this.loadData(data);
    }

    /**
     * Creates the datum entities (origin at (0,0), X axis (0,0)-(1,0), Y axis
     * (0,0)-(0,1)) as garlic params under reserved negative ids, each point pinned
     * by an internal Fix constraint and marked fixed. Net dofs contribution is
     * zero; the structural constraints stay out of `this.constraints`, so they are
     * never serialized, annotated or removable.
     */
    private seedDatum(): void {
        this.datumParams.clear();
        this.structuralConstraintIds = [];
        const seed = (entityId: number, coords: number[]) => {
            const kinds = new Uint8Array(coords.length).fill(PARAM_KIND_COORDINATE);
            const ids = Array.from(this.system.add_params(kinds, new Float64Array(coords)));
            this.datumParams.set(entityId, ids);
            this.fixedEntities.add(entityId);
            const { constraintIds } = this.pinPoints(ids, coords);
            this.structuralConstraintIds.push(...constraintIds);
        };
        seed(SKETCH_ORIGIN_ID, [0, 0]);
        seed(SKETCH_X_AXIS_ID, [0, 0, 1, 0]);
        seed(SKETCH_Y_AXIS_ID, [0, 0, 0, 1]);
    }

    /**
     * Pins every (x, y) point param pair of `paramIds` with an internal Fix
     * constraint to a datum param holding the point's current value — the shared
     * core of `seedDatum` and `seedExternalEntity`. `values` parallels `paramIds`
     * and supplies the pinned coordinates.
     */
    private pinPoints(paramIds: readonly number[], values: readonly number[]): ExternalPins {
        const datumParamIds: number[] = [];
        const constraintIds: number[] = [];
        for (let i = 0; i < paramIds.length; i += 2) {
            const x0 = this.createDatumParam(values[i]);
            const y0 = this.createDatumParam(values[i + 1]);
            datumParamIds.push(x0, y0);
            constraintIds.push(
                this.system.add_constraint(
                    ConstraintKind.Fix,
                    new Uint32Array([paramIds[i], paramIds[i + 1], x0, y0]),
                    null,
                    true,
                    0,
                ),
            );
        }
        return { datumParamIds, constraintIds };
    }

    /**
     * Seeds one external entity into the regular entity tables (marked fixed): raw
     * garlic params in the entity layout, every point pinned by an internal Fix
     * constraint (circles additionally pin the radius with an internal Radius
     * constraint). Net dofs contribution is zero; the structural constraints stay
     * out of `this.constraints`.
     */
    private seedExternalEntity(entityId: number, type: SketchEntityType, params: number[]): void {
        const paramIds = this.addEntityParams(type, params);
        this.registerEntity(type, paramIds, entityId);
        // Only the point params are pinned here — a circle's radius param is not a
        // coordinate pair and gets its own Radius pin below.
        const { datumParamIds, constraintIds } = this.pinPoints(
            paramIds.slice(0, entityPointCount(type) * 2),
            params,
        );
        if (type === "circle") {
            const radiusDatum = this.createDatumParam(params[2]);
            datumParamIds.push(radiusDatum);
            constraintIds.push(
                this.system.add_constraint(
                    ConstraintKind.Radius,
                    new Uint32Array([paramIds[2], radiusDatum]),
                    null,
                    true,
                    0,
                ),
            );
        }
        this.fixedEntities.add(entityId);
        this.externalPins.set(entityId, { datumParamIds, constraintIds });
    }

    private registerEntity(type: SketchEntityType, paramIds: number[], id?: number): number {
        let entityId: number;
        if (id === undefined) {
            entityId = this.entityIdSeq++;
            this.idAllocatedSinceLoad = true;
        } else {
            entityId = id;
            // explicit ids (loadData, external seeds) still advance the counter,
            // so a later allocation never reissues them
            this.entityIdSeq = Math.max(this.entityIdSeq, id + 1);
        }
        this.entityTypes.set(entityId, type);
        this.entityParams.set(entityId, paramIds);
        this.entityCache.set(entityId, [...this.system.get_params(new Uint32Array(paramIds))]);
        return entityId;
    }

    private addConstraintWithId(id: number, constraint: Omit<SketchConstraintData, "id">): void {
        const { params, datumParamIds, garlicKind } = this.buildConstraintParams(constraint);
        const garlicId = this.system.add_constraint(
            garlicKind ?? constraint.kind,
            new Uint32Array(params),
            null,
            true,
            0,
        );
        this.constraints.set(id, {
            id,
            kind: constraint.kind,
            refs: constraint.refs.map((r) => ({ ...r })),
            garlicId,
            datumParamIds,
        });
    }

    /** garlic param ids for a constraint; datum kinds also create their datum params. */
    private buildConstraintParams(constraint: Omit<SketchConstraintData, "id">): {
        params: number[];
        datumParamIds?: number[];
        /** garlic kind when it differs from the sketch-level kind (arc radius → P2PDistance). */
        garlicKind?: ConstraintKind;
    } {
        const { refs } = constraint;
        switch (constraint.kind) {
            case ConstraintKind.P2PCoincident:
            case ConstraintKind.Horizontal:
            case ConstraintKind.Vertical:
            case ConstraintKind.HorizontalAlign:
            case ConstraintKind.VerticalAlign:
                return { params: [...this.pointParamIds(refs[0]), ...this.pointParamIds(refs[1])] };
            case ConstraintKind.PointOnArc:
                // p, c, s — refs are [point, center, start] (arc structural: end, center, start)
                return {
                    params: [
                        ...this.pointParamIds(refs[0]),
                        ...this.arcPointParamIds(refs[1]),
                        ...this.arcPointParamIds(refs[2]),
                    ],
                };
            case ConstraintKind.PointOnLine:
            case ConstraintKind.Midpoint:
                return {
                    params: [
                        ...this.pointParamIds(refs[0]),
                        ...this.linePointParamIds(refs[1]),
                        ...this.linePointParamIds(refs[2]),
                    ],
                };
            case ConstraintKind.Parallel:
            case ConstraintKind.Perpendicular:
            case ConstraintKind.EqualLength:
                return { params: this.twoLineParams(refs) };
            case ConstraintKind.Symmetric:
                return {
                    params: [
                        ...this.pointParamIds(refs[0]),
                        ...this.pointParamIds(refs[1]),
                        ...this.linePointParamIds(refs[2]),
                        ...this.linePointParamIds(refs[3]),
                    ],
                };
            case ConstraintKind.EqualRadius:
                return {
                    params: [this.radiusParamId(refs[0].entityId), this.radiusParamId(refs[1].entityId)],
                };
            case ConstraintKind.PointOnCircle:
                return {
                    params: [
                        ...this.pointParamIds(refs[0]),
                        ...this.circleCenterParamIds(refs[1]),
                        this.radiusParamId(refs[1].entityId),
                    ],
                };
            case ConstraintKind.TangentLineCircle:
                return {
                    params: [
                        ...this.linePointParamIds(refs[0]),
                        ...this.linePointParamIds(refs[1]),
                        ...this.circleCenterParamIds(refs[2]),
                        this.radiusParamId(refs[2].entityId),
                    ],
                };
            case ConstraintKind.TangentCircleCircle:
                return {
                    params: [
                        ...this.circleCenterParamIds(refs[0]),
                        this.radiusParamId(refs[0].entityId),
                        ...this.circleCenterParamIds(refs[1]),
                        this.radiusParamId(refs[1].entityId),
                    ],
                };
            case ConstraintKind.EqualArcRadius:
            case ConstraintKind.TangentArcArc:
                return {
                    params: [
                        ...this.arcPointParamIds(refs[0]),
                        ...this.arcPointParamIds(refs[1]),
                        ...this.arcPointParamIds(refs[2]),
                        ...this.arcPointParamIds(refs[3]),
                    ],
                };
            case ConstraintKind.TangentLineArc:
                return {
                    params: [
                        ...this.linePointParamIds(refs[0]),
                        ...this.linePointParamIds(refs[1]),
                        ...this.arcPointParamIds(refs[2]),
                        ...this.arcPointParamIds(refs[3]),
                    ],
                };
            case ConstraintKind.TangentCircleArc:
                return {
                    params: [
                        ...this.circleCenterParamIds(refs[0]),
                        this.radiusParamId(refs[0].entityId),
                        ...this.arcPointParamIds(refs[1]),
                        ...this.arcPointParamIds(refs[2]),
                    ],
                };
            case ConstraintKind.P2PDistance:
                return this.withDatums(
                    [...this.pointParamIds(refs[0]), ...this.pointParamIds(refs[1])],
                    [constraint.datum ?? this.currentDistance(refs[0], refs[1])],
                );
            case ConstraintKind.Radius: {
                if (this.typeOf(refs[0].entityId) === "arc") {
                    // arcs have no radius param — drive ‖start−center‖ as a point distance
                    const start: SketchPointRef = { entityId: refs[0].entityId, pointIndex: 1 };
                    return {
                        garlicKind: ConstraintKind.P2PDistance,
                        ...this.withDatums(
                            [...this.arcPointParamIds(refs[0]), ...this.arcPointParamIds(start)],
                            [constraint.datum ?? this.currentRadius(refs[0].entityId)],
                        ),
                    };
                }
                return this.withDatums(
                    [this.radiusParamId(refs[0].entityId)],
                    [constraint.datum ?? this.currentRadius(refs[0].entityId)],
                );
            }
            case ConstraintKind.P2LDistance:
                return this.withDatums(
                    [
                        ...this.pointParamIds(refs[0]),
                        ...this.linePointParamIds(refs[1]),
                        ...this.linePointParamIds(refs[2]),
                    ],
                    [constraint.datum ?? this.currentP2LDistance(refs)],
                );
            case ConstraintKind.Angle:
                return this.withDatums(this.twoLineParams(refs), [
                    constraint.datum ?? this.currentAngle(refs),
                ]);
            case ConstraintKind.HorizontalDistance:
            case ConstraintKind.VerticalDistance:
                return this.withDatums(
                    [...this.pointParamIds(refs[0]), ...this.pointParamIds(refs[1])],
                    [
                        constraint.datum ??
                            this.currentSignedDistance(
                                refs[0],
                                refs[1],
                                constraint.kind === ConstraintKind.HorizontalDistance ? 0 : 1,
                            ),
                    ],
                );
            case ConstraintKind.Fix:
                return this.withDatums(
                    [...this.pointParamIds(refs[0])],
                    constraint.datums ?? [...this.pointOf(refs[0])],
                );
            default:
                throw new Error(`Unsupported constraint kind: ${constraint.kind}`);
        }
    }

    private withDatums(params: number[], values: number[]): { params: number[]; datumParamIds: number[] } {
        const datumParamIds = values.map((value) => this.createDatumParam(value));
        return { params: [...params, ...datumParamIds], datumParamIds };
    }

    private createDatumParam(value: number): number {
        return Number(
            this.system.add_params(new Uint8Array([PARAM_KIND_LENGTH]), new Float64Array([value]))[0],
        );
    }

    /** [l1.p1, l1.p2, l2.p1, l2.p2] param ids for two-line constraints. */
    private twoLineParams(refs: SketchPointRef[]): number[] {
        return [
            ...this.linePointParamIds(refs[0]),
            ...this.linePointParamIds(refs[1]),
            ...this.linePointParamIds(refs[2]),
            ...this.linePointParamIds(refs[3]),
        ];
    }

    private typedPointParamIds(ref: SketchPointRef, type: SketchEntityType): [number, number] {
        // datum axes pass as lines; the origin is a bare point and never matches here
        if (isDatumEntityId(ref.entityId)) {
            if (type === "line" && ref.entityId !== SKETCH_ORIGIN_ID) {
                return this.pointParamIds(ref);
            }
            throw new Error(`Datum entity ${ref.entityId} is not a ${type}`);
        }
        if (this.typeOf(ref.entityId) !== type) {
            throw new Error(`Entity ${ref.entityId} is not a ${type}`);
        }
        return this.pointParamIds(ref);
    }

    /** Entity type of a real or external entity, undefined when unknown. */
    private typeOf(entityId: number): SketchEntityType | undefined {
        return this.entityTypes.get(entityId);
    }

    private linePointParamIds(ref: SketchPointRef): [number, number] {
        return this.typedPointParamIds(ref, "line");
    }

    private circleCenterParamIds(ref: SketchPointRef): [number, number] {
        return this.typedPointParamIds(ref, "circle");
    }

    private arcPointParamIds(ref: SketchPointRef): [number, number] {
        return this.typedPointParamIds(ref, "arc");
    }

    private pointCacheIndices(ref: SketchPointRef): [number, number] {
        const type = this.entityTypes.get(ref.entityId);
        if (type === "line" && (ref.pointIndex === 0 || ref.pointIndex === 1)) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "arc" && ref.pointIndex >= 0 && ref.pointIndex <= 2) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "circle" && ref.pointIndex === 0) {
            return [0, 1];
        }
        throw new Error(`Invalid point ref ${ref.entityId}:${ref.pointIndex}`);
    }

    private pointParamIds(ref: SketchPointRef): [number, number] {
        const datum = this.datumParams.get(ref.entityId);
        if (datum !== undefined) {
            return [datum[ref.pointIndex * 2], datum[ref.pointIndex * 2 + 1]];
        }
        const [x, y] = this.pointCacheIndices(ref);
        const params = this.entityParams.get(ref.entityId)!;
        return [params[x], params[y]];
    }

    private radiusParamId(entityId: number): number {
        if (this.entityTypes.get(entityId) !== "circle") {
            throw new Error(`Entity ${entityId} is not a circle`);
        }
        return this.entityParams.get(entityId)![2];
    }

    private currentDistance(a: SketchPointRef, b: SketchPointRef): number {
        const [ax, ay] = this.pointOf(a);
        const [bx, by] = this.pointOf(b);
        return Math.hypot(bx - ax, by - ay);
    }

    /** Radius from the cache: params[2] for circles, ‖start−center‖ for arcs. */
    private currentRadius(entityId: number): number {
        const params = this.entityCache.get(entityId)!;
        if (this.entityTypes.get(entityId) === "arc") {
            return Math.hypot(params[2] - params[0], params[3] - params[1]);
        }
        return params[2];
    }

    /** garlic-signed perpendicular distance (negative of the usual cross-product sign). */
    private currentP2LDistance(refs: SketchPointRef[]): number {
        const [px, py] = this.pointOf(refs[0]);
        const [x1, y1] = this.pointOf(refs[1]);
        const [x2, y2] = this.pointOf(refs[2]);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (length < 1e-12) return 0;
        return (dy * (px - x1) - dx * (py - y1)) / length;
    }

    /** Angle magnitude (radians) between the directions of the two referenced lines. */
    private currentAngle(refs: SketchPointRef[]): number {
        return Math.abs(this.currentSweep(refs));
    }

    /** Signed axis distance (axis 0: p2.x − p1.x; axis 1: p2.y − p1.y). */
    private currentSignedDistance(a: SketchPointRef, b: SketchPointRef, axis: 0 | 1): number {
        return this.pointOf(b)[axis] - this.pointOf(a)[axis];
    }

    private refreshCache(): void {
        const all: number[] = [];
        for (const ids of this.entityParams.values()) {
            all.push(...ids);
        }
        if (all.length === 0) return;
        const values = this.system.get_params(new Uint32Array(all));
        let offset = 0;
        for (const [id, ids] of this.entityParams) {
            this.entityCache.set(id, Array.from(values.slice(offset, offset + ids.length)));
            offset += ids.length;
        }
    }

    private loadData(data: SketchData): void {
        this.refPositions = data.refPositions === undefined ? undefined : { ...data.refPositions };
        // external refs seed before the constraints that may reference them
        for (const ref of data.externalRefs ?? []) {
            this.addExternalEntity(ref);
        }
        for (const entity of data.entities) {
            this.registerEntity(entity.type, this.addEntityParams(entity.type, entity.params), entity.id);
        }
        for (const constraint of data.constraints) {
            this.addConstraintWithId(constraint.id, constraint);
        }
        // id counters: trust the serialized ones; data written before counters
        // initializes from the current max+1 / min-1 via the seeding above
        if (data.entityIdSeq !== undefined) this.entityIdSeq = Math.max(this.entityIdSeq, data.entityIdSeq);
        if (data.externalIdSeq !== undefined) {
            this.externalIdSeq = Math.min(this.externalIdSeq, data.externalIdSeq);
        }
        this.idCountersPersisted = data.entityIdSeq !== undefined || data.externalIdSeq !== undefined;
        this.idAllocatedSinceLoad = false;
        // normalize roles for documents written before role derivation (and for
        // hand-edited data): an unpinned ref any constraint references is a profile
        syncExternalRoles({ constraints: data.constraints, externalRefs: this.externalRefs });
        this.solve(true);
    }

    private addEntityParams(type: SketchEntityType, values: number[]): number[] {
        const ids = this.system.add_params(
            new Uint8Array(ENTITY_PARAM_KINDS[type]),
            new Float64Array(values),
        );
        return Array.from(ids);
    }
}
