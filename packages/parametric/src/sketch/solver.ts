// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EMPTY_SCOPE, type ParameterValue, type Plane, Result, type Scope } from "@chili3d/core";
import type { SolveResultInfo, WasmSystem } from "../../lib/garlic";
import { INCIDENCE_TOLERANCE } from "../features/refGeometry";
import { ENTITY_PARAM_KINDS, PARAM_KIND_COORDINATE, PARAM_KIND_LENGTH } from "./entityLayout";
import {
    type EntityTables,
    type ExternalEntityHost,
    ExternalEntityRegistry,
    type ExternalPins,
} from "./externalEntities";
import { newGarlicSystem } from "./garlic";
import {
    ConstraintKind,
    datumEntityData,
    datumIsReading,
    datumPoint,
    datumSignIsSide,
    type ExternalRefData,
    isDatumEntityId,
    isExternalEntityId,
    isStructuralConstraint,
    nextSketchId,
    pointRefKey,
    type RadiusDisplay,
    resolveDatumSource,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    syncExternalRoles,
    toDatumSource,
} from "./sketchModel";

function findRoot(parent: Map<string, string>, key: string): string {
    let root = key;
    while (parent.get(root) !== root) {
        root = parent.get(root)!;
    }
    return root;
}

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

export interface SolveOutcome {
    result: SolveResultInfo;
    dofs: number;
}

/**
 * What the solver can say about the constraint set beyond the solve result: the
 * degrees of freedom left and the constraints (sketch ids, not garlic ids) it
 * flags as conflicting or redundant. Structural constraints the user never sees
 * (datum pins, external-entity pins) are filtered out by the garlicId → sketch id
 * mapping — they are not in `constraints`.
 */
export interface SketchDiagnostics {
    dofs: number;
    conflicting: number[];
    redundant: number[];
}

/** One datum as it goes into garlic: what to persist alongside the value it resolved to. */
interface DatumValue {
    readonly source: ParameterValue;
    readonly value: number;
}

/** garlic param wiring for one constraint, as `buildConstraintParams` works it out. */
interface ConstraintParams {
    params: number[];
    /** The params a datum was written into, when the kind carries one. */
    datumParamIds?: number[];
    datumSources?: ParameterValue[];
    /** garlic kind when it differs from the sketch-level kind (arc radius → P2PDistance). */
    garlicKind?: ConstraintKind;
}

/** The kinds whose value arrives through a datum param rather than from the geometry. */
const DATUM_CONSTRAINTS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.P2PDistance,
    ConstraintKind.Radius,
    ConstraintKind.P2LDistance,
    ConstraintKind.Angle,
    ConstraintKind.HorizontalDistance,
    ConstraintKind.VerticalDistance,
    ConstraintKind.Fix,
]);

interface ConstraintRecord {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    garlicId: number;
    datumParamIds?: number[];
    /**
     * What each `datumParamIds` entry was written from, in the same order: a number
     * may be read back from garlic (that is how the solver normalizes a literal),
     * a string is an expression and must be persisted verbatim — reading garlic back
     * over it would replace the user's expression with its current value.
     */
    datumSources?: ParameterValue[];
    /** The reading a radius datum is written in — `diameter` halves what resolves. */
    display?: RadiusDisplay;
    /** A reference dimension: garlic solves around it and writes its datum back. */
    driven?: boolean;
}

/**
 * Wraps one garlic `WasmSystem` for a sketch on a given plane.
 * Entity/constraint ids exposed here are stable and owned by this class;
 * garlic ParamId/ConstraintId handles stay internal.
 */
export class SketchSolver implements ExternalEntityHost {
    readonly plane: Plane;
    /**
     * The garlic system every param and constraint is created in. Public because the
     * external-entity registry (`externalEntities.ts`) is a peer collaborator that
     * places params in it — see `ExternalEntityHost`. Replaced wholesale by `reset`.
     */
    system: WasmSystem;
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
    /**
     * Real entities flagged as construction geometry (SketchEntityData.construction).
     * The solver treats them like any other entity — the flag only travels through
     * `entities()`/`loadData` so `toData` round-trips it and the node/profile layer
     * can exclude them from shape building.
     */
    private readonly constructionEntities = new Set<number>();
    /** The pinned external entities and the refs they came from — see `externalEntities.ts`. */
    private readonly external = new ExternalEntityRegistry(this);
    private draggedParamIds: number[] = [];
    /**
     * The document's parameters, re-read by every expression datum. Held as a snapshot
     * rather than a live reference: `document.variables.evaluate()` re-resolves the
     * whole table, and `setScope` is where a new one lands.
     */
    private _scope: Scope;
    /** Expression datums that failed to resolve, by constraint id — the editor surfaces them. */
    private readonly _datumErrors = new Map<number, string>();

    /**
     * Monotonic id allocation, serialized as SketchData.entityIdSeq/externalIdSeq:
     * freed ids are never reused, so a stale ProfileRef fingerprint (keyed on entity
     * ids) can never match a geometrically different region. Real ids count up from
     * 1, external ids count down from FIRST_EXTERNAL_ENTITY_ID (the registry's).
     */
    private entityIdSeq = 1;
    /**
     * Counter emission gate: `toData` writes the counters only when the loaded data
     * carried them or an allocation happened since — a no-op session on a
     * pre-counter document must round-trip byte-identical, or every sketch exit
     * would record a phantom history entry.
     */
    private idCountersPersisted = false;
    private idAllocatedSinceLoad = false;

    constructor(plane: Plane, data?: SketchData, scope: Scope = EMPTY_SCOPE) {
        this.plane = plane;
        this._scope = scope;
        this.system = newGarlicSystem();
        this.seedDatum();
        if (data !== undefined) {
            this.loadData(data);
        }
    }

    /** Expression datums that failed to resolve at the last load or scope change. */
    get datumErrors(): ReadonlyMap<number, string> {
        return this._datumErrors;
    }

    /**
     * Re-resolves every expression datum against `scope` and pushes the new values into
     * garlic. Returns whether any value actually moved, so the caller can skip a solve
     * that would find nothing to do. A datum that no longer resolves is reported through
     * `datumErrors` and keeps its previous value — the sketch stays usable.
     *
     * A driven dimension is skipped: its datum is garlic's own output, and garlic's datum
     * contract says a param must not be pushed from JS and written back by a constraint at
     * once. What is held here would only be the previous measurement, so pushing it would
     * undo the solve that produced it.
     */
    setScope(scope: Scope): boolean {
        this._scope = scope;
        this._datumErrors.clear();
        let changed = false;
        for (const record of this.constraints.values()) {
            if (record.driven === true) continue;
            const sources = record.datumSources;
            const paramIds = record.datumParamIds;
            if (sources === undefined || paramIds === undefined) continue;
            for (let index = 0; index < sources.length; index++) {
                // only an expression moves with the scope: a literal is a storage value already in
                // garlic, and pushing it back would let a stale sign overwrite a solved one
                if (typeof sources[index] === "number") continue;
                const resolved = resolveDatumSource(record.kind, sources[index], scope, record.display);
                if (!resolved.isOk) {
                    this._datumErrors.set(record.id, resolved.error);
                    continue;
                }
                // an expression is a magnitude: it has no minus to gesture with, so the side the
                // dimension is on now is the side it keeps
                const value = this.sideSignedDatum(
                    record.kind,
                    resolved.value,
                    this.datumSide(paramIds[index]),
                    false,
                );
                const current = this.system.get_params(new Uint32Array([paramIds[index]]))[0];
                if (current === value) continue;
                this.system.set_param(paramIds[index], value);
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Writes a user input as one of a constraint's datums: a literal is converted into
     * storage units, an expression is stored verbatim and resolved on the spot. A side-carrying
     * distance lands on the side the dimension already sits unless the input itself was negative,
     * which is the flip gesture (`sideSignedDatum`). A failed resolve returns the error without
     * touching the datum — the user is editing, so the dialog rejects the input rather than the
     * sketch silently keeping a stale value.
     *
     * A driven dimension refuses the write: its datum is garlic's output, and a value
     * pushed in would be overwritten by the next solve. Editing one means turning it
     * back into a driving dimension first, which is what the tools offer instead.
     */
    setDatumSource(constraintId: number, input: ParameterValue, index = 0): Result<void> {
        const record = this.constraints.get(constraintId);
        const paramId = record?.datumParamIds?.[index];
        if (record === undefined || paramId === undefined) {
            return Result.err(`Constraint ${constraintId} has no datum ${index}`);
        }
        if (record.driven === true) {
            return Result.err(`Constraint ${constraintId} is driven — it measures, it does not drive`);
        }
        const source = toDatumSource(record.kind, input, record.display);
        const resolved = resolveDatumSource(record.kind, source, this._scope, record.display);
        if (!resolved.isOk) return Result.err(resolved.error);
        const value = this.sideSignedDatum(
            record.kind,
            resolved.value,
            this.datumSide(paramId),
            typeof input === "number" && input < 0,
        );
        if (record.datumSources === undefined) record.datumSources = [];
        // the literal is stored as the value garlic takes, not as it was typed: a minus in the
        // input was the flip gesture, and a datum source read back on the next scope change must
        // not flip the geometry a second time
        record.datumSources[index] = typeof source === "number" ? value : source;
        this._datumErrors.delete(constraintId);
        this.system.set_param(paramId, value);
        return Result.ok(undefined);
    }

    /**
     * A side-carrying datum's value for the solver: the magnitude just resolved, on the side the
     * dimension already sits — or on the *other* side, when the input carried a minus, which is
     * the user asking for the flip rather than a number of their own (`datumSignIsSide`).
     * Keeping the side is what stops an edit that only changes the magnitude from moving the
     * geometry across its reference.
     *
     * `side` is the side to keep, and each caller says where it read it: the datum's own current
     * value when the constraint is live, the geometry when it is still being built. Only a value
     * the user typed can flip — an expression has no gesture in it, and re-resolving one must
     * land on the same side every time.
     */
    private sideSignedDatum(kind: ConstraintKind, value: number, side: number, flip: boolean): number {
        if (!datumSignIsSide(kind)) return value;
        const current = side < 0 ? -1 : 1;
        return Math.abs(value) * (flip ? -current : current);
    }

    /**
     * The side a live datum sits on, read from garlic: ±1. Zero — the point on its line, the two
     * points level — is no side at all, and reads as positive.
     */
    private datumSide(paramId: number | undefined): number {
        if (paramId === undefined) return 1;
        return this.system.get_params(new Uint32Array([paramId]))[0] < 0 ? -1 : 1;
    }

    // ------------------------------------------------------------------ Entity and constraint editing

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

    /**
     * Re-creates a constraint under its existing id, with the refs/kind/datum given.
     * Keeping the id is the point: constraint ids key the persisted dimension
     * anchors (`SketchData.anchors`), so an op that rewrites a constraint's refs —
     * the trim op, moving a point's constraints onto the half that kept the point —
     * must not leave the anchor behind as an orphan. A constraint whose datum is an
     * expression comes back verbatim: `sourceDatums` returns it as written — which is what
     * a caller rebuilding one must hand over, since a driven dimension's *persisted* datum
     * is the measurement rather than the source it came from
     * (`setDriven`). Returns false for a stale id (the constraint is gone).
     */
    replaceConstraint(id: number, constraint: Omit<SketchConstraintData, "id">): boolean {
        if (!this.constraints.has(id)) return false;
        this.removeConstraint(id);
        this.addConstraintWithId(id, constraint);
        return true;
    }

    /**
     * Re-records a constraint as a driven (reference) dimension, or back as a driving one,
     * keeping its id and its refs. The garlic constraint is rebuilt — `driving` is fixed at
     * creation — but the sketch id survives, so the datum anchor the id keys stays put.
     *
     * Only a constraint whose datum is a *reading* can go either way. `datumParamIds` is not
     * that test on its own: a Fix has datum params too (its coordinates), so it passes, and
     * garlic takes it as a reference without complaint — but there is nothing to measure, and
     * the pin's two degrees of freedom come back instead (`datumIsReading`). Returns false when
     * there was nothing to change, which is how a mixed selection settles.
     */
    setDriven(id: number, driven: boolean): boolean {
        const record = this.constraints.get(id);
        if (record === undefined || record.datumParamIds === undefined) return false;
        if (!datumIsReading(record.kind)) return false;
        if ((record.driven === true) === driven) return false;
        // the datum is carried from the *source*, not from what the record displays: a driven
        // dimension displays the measurement garlic wrote back, and rebuilding from that would
        // turn the expression the user wrote into the number it happened to evaluate to
        const datums = this.sourceDatums(record);
        this.replaceConstraint(id, {
            kind: record.kind,
            refs: record.refs,
            ...(datums === undefined ? {} : datums.length === 1 ? { datum: datums[0] } : { datums }),
            ...(record.display === undefined ? {} : { display: record.display }),
            ...(driven ? { driven: true } : {}),
        });
        return true;
    }

    /**
     * Changes a real entity's type in place, keeping its id. The trim op needs this
     * for a circle that loses a piece and becomes an arc: the params have a different
     * layout, so the garlic entity cannot survive the swap, but the ID must — entity
     * ids are the primary key of `ProfileRef` region identity, and "a freed id is
     * never reused" (`entityIdSeq`) exists so a stale fingerprint can never match an
     * unrelated entity. A retype is the one case where an id outlives its params, and
     * it is the same logical entity on both sides, so that invariant is not at risk.
     *
     * The constraints cannot survive either — garlic param ids are not stable across
     * the swap — so each one is handed to `transform`, which returns the constraint to
     * re-create under the SAME id (again: the id keys the datum anchor) or undefined
     * to drop it. Structural constraints (an arc's PointOnArc) are not user geometry;
     * they are rebuilt from the new type instead. Returns the ids of the constraints
     * that could not be re-created.
     */
    retypeEntity(
        id: number,
        type: SketchEntityType,
        values: number[],
        transform: (constraint: SketchConstraintData) => Omit<SketchConstraintData, "id"> | undefined,
    ): Result<number[]> {
        if (isDatumEntityId(id) || isExternalEntityId(id)) {
            return Result.err("The datum and external references cannot change type");
        }
        if (this.entityTypes.get(id) === undefined) {
            return Result.err(`Unknown sketch entity: ${id}`);
        }
        const captured = this.constraintsData().filter((c) => c.refs.some((r) => r.entityId === id));
        const construction = this.constructionEntities.has(id);
        this.removeEntity(id);
        // the private path, not `seedEntity`: same registration, without claiming an
        // id from the allocator (this id already exists, it is only changing shape)
        this.registerEntity(type, this.addEntityParams(type, values), id);
        if (construction) this.constructionEntities.add(id);

        const dropped: number[] = [];
        for (const constraint of captured) {
            if (isStructuralConstraint(constraint)) continue;
            const next = transform(constraint);
            if (next === undefined) {
                dropped.push(constraint.id);
                continue;
            }
            // A kind the new type cannot express (an EqualRadius over an arc, whose
            // radiusParamId throws) is a drop, not a failure of the whole retype.
            try {
                this.addConstraintWithId(constraint.id, next);
            } catch {
                dropped.push(constraint.id);
            }
        }
        // after the captured constraints are back in the map, so `nextSketchId`
        // cannot hand this one the id of a constraint being re-created
        if (type === "arc") {
            this.addConstraint({
                kind: ConstraintKind.PointOnArc,
                refs: [
                    { entityId: id, pointIndex: 2 },
                    { entityId: id, pointIndex: 0 },
                    { entityId: id, pointIndex: 1 },
                ],
            });
        }
        return Result.ok(dropped);
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
        this.constructionEntities.delete(id);
        return removedConstraints;
    }

    /** Whether the entity is fixed (datum or external): targetable, but never movable/deletable/editable. */
    isFixed(entityId: number): boolean {
        return this.fixedEntities.has(entityId);
    }

    /** Whether the entity is construction geometry: a constraint/snap target that never builds profiles. */
    isConstruction(entityId: number): boolean {
        return this.constructionEntities.has(entityId);
    }

    /** Flags a real entity as construction geometry (or back to profile geometry). */
    setConstruction(entityId: number, construction: boolean): void {
        if (construction) this.constructionEntities.add(entityId);
        else this.constructionEntities.delete(entityId);
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

    /**
     * Whether a constraint of one of `kinds` pins `ref` to geometry outside its own
     * entity. An arc's structural PointOnArc refers to that arc alone, so it is no
     * incidence: it keeps the arc on its own circle without pinning the point to
     * anything else.
     */
    hasIncidenceOn(ref: SketchPointRef, kinds: readonly ConstraintKind[]): boolean {
        return this.incidenceConstraintOn(ref, kinds) !== undefined;
    }

    /**
     * The first constraint of one of `kinds` pinning `ref` to geometry outside its
     * own entity, or undefined — the record form of `hasIncidenceOn`.
     */
    incidenceConstraintOn(
        ref: SketchPointRef,
        kinds: readonly ConstraintKind[],
    ): SketchConstraintData | undefined {
        const key = pointRefKey(ref);
        const record = [...this.constraints.values()].find(
            (c) =>
                kinds.includes(c.kind) &&
                c.refs.some((r) => pointRefKey(r) === key) &&
                c.refs.some((r) => r.entityId !== ref.entityId),
        );
        if (record === undefined) return undefined;
        return { id: record.id, kind: record.kind, refs: record.refs.map((r) => ({ ...r })) };
    }

    /** Whether an identical constraint (same kind and refs, order-insensitive) already exists. */
    hasConstraint(kind: ConstraintKind, refs: SketchPointRef[]): boolean {
        const key = refs.map(pointRefKey).sort().join("|");
        return [...this.constraints.values()].some(
            (c) => c.kind === kind && c.refs.map(pointRefKey).sort().join("|") === key,
        );
    }

    // ------------------------------------------------------------------ Solving

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
            result: report.result,
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

    /**
     * Constraint diagnostics — garlic semantics require a solve first (`solve`
     * then `diagnose`), so callers run this after a fine solve. The garlic
     * report keys constraints by garlic id; they are mapped back to sketch
     * constraint ids here, which silently drops the structural pins (they have
     * no `ConstraintRecord`).
     *
     * Both lists cover the WHOLE group, not only the constraint garlic happened
     * to flag: a conflict group names just the failing constraint, a redundant
     * group just the one judged excess — but any member of either group is an
     * equally valid fix (drop either side of a contradiction, or any one of a
     * duplicating set), so the counterparts/sources are merged in and the user
     * sees the full choice set rather than the solver's arbitrary pick.
     */
    diagnose(): SketchDiagnostics {
        const report = this.system.diagnose();
        const byGarlicId = this.recordsByGarlicId();
        return {
            // the report's own DOF, not `system.dofs()`: that one reads a rank cached
            // per topology, which lags one real iteration through a singular
            // configuration — the panel would then contradict the redundancy list it
            // is showing beside it (see `SketchEditor.publishSolveStatus`)
            dofs: report.dofs,
            conflicting: this.groupSketchIds(report.conflictGroups, byGarlicId, (g) => [
                g.constraint,
                ...g.counterparts,
            ]),
            redundant: this.groupSketchIds(report.redundantGroups, byGarlicId, (g) => [
                g.constraint,
                ...g.sources,
            ]),
        };
    }

    private recordsByGarlicId(): Map<number, number> {
        const byGarlicId = new Map<number, number>();
        for (const record of this.constraints.values()) {
            byGarlicId.set(record.garlicId, record.id);
        }
        return byGarlicId;
    }

    /** Every member of each group, mapped to sketch ids: the flagged constraint plus the ones it involves. */
    private groupSketchIds<T>(
        groups: readonly T[],
        byGarlicId: Map<number, number>,
        members: (group: T) => number[],
    ): number[] {
        const ids = new Set<number>();
        for (const group of groups) {
            for (const garlicId of members(group)) {
                const sketchId = byGarlicId.get(garlicId);
                if (sketchId !== undefined) ids.add(sketchId);
            }
        }
        return [...ids].sort((a, b) => a - b);
    }

    // ------------------------------------------------------------------ Queries

    /** Data of every real (editable) entity; fixed datum/external entities are excluded. */
    entities(): SketchEntityData[] {
        return [...this.entityCache.entries()]
            .filter(([id]) => !this.fixedEntities.has(id))
            .map(([id, params]) => ({
                id,
                type: this.entityTypes.get(id)!,
                params: [...params],
                // emitted only when set — a sketch without construction geometry
                // must round-trip byte-identical (no phantom history entry)
                ...(this.constructionEntities.has(id) ? { construction: true } : {}),
            }));
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

    // ------------------------------------------------------------------ Dragging

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

    // ------------------------------------------------------------------ Serialization and lifecycle

    toData(): SketchData {
        const constraints = this.constraintsData();
        const result: SketchData = { entities: this.entities(), constraints };
        // external refs live in SketchData, not in the entity list — preserve them
        if (this.external.refs.length > 0) {
            result.externalRefs = JSON.parse(JSON.stringify(this.external.refs)) as ExternalRefData[];
            // roles derive from the constraints referencing each ref (pinned refs keep theirs)
            syncExternalRoles(result);
        }
        // timeline anchors are capture-time metadata the solver never derives — carry them
        if (this.external.refPositions !== undefined) {
            result.refPositions = { ...this.external.refPositions };
        }
        // monotonic id counters — carried so a freed id is never reused across
        // sessions; emitted only once they mean something (see the field comment)
        if (this.idCountersPersisted || this.idAllocatedSinceLoad) {
            result.entityIdSeq = this.entityIdSeq;
            result.externalIdSeq = this.external.idSeq;
        }
        return result;
    }

    /** Every constraint record, with the current datum parameter values folded back in. */
    private constraintsData(): SketchConstraintData[] {
        return [...this.constraints.values()].map((record) => {
            const data: SketchConstraintData = {
                id: record.id,
                kind: record.kind,
                refs: record.refs.map((r) => ({ ...r })),
            };
            const sources = this.persistedDatums(record);
            if (sources !== undefined) {
                if (sources.length === 1) {
                    data.datum = sources[0];
                } else {
                    data.datums = sources;
                }
            }
            // the reading is what the datum above means, so it travels with it
            if (record.display !== undefined) data.display = record.display;
            if (record.driven !== undefined) data.driven = record.driven;
            return data;
        });
    }

    /**
     * The datums of a record as they should be persisted, in order. A literal is read
     * back from garlic — that is where the solver's normalization lands (the angle sign
     * `syncAngleDatumSide` settles on, the geometric fallback a datumless constraint
     * started from). An expression is returned as written: reading garlic back over it
     * would replace the user's expression with whatever it currently evaluates to, once
     * per commit.
     *
     * A driven dimension is neither: garlic's output is the whole of what it says. What it
     * measures is not its source but the value the last solve wrote back, so the number this
     * hands out — persisted, and the one the badges and the constraint list render — reads as
     * the geometry. Its source is still carried in the record (`withDatum`) for `sourceDatums`.
     */
    private persistedDatums(record: ConstraintRecord): ParameterValue[] | undefined {
        if (record.driven === true) return this.datumValues(record);
        return this.sourceDatums(record);
    }

    /**
     * The datums of a record as its *sources* have them: an expression as written, a literal from
     * garlic. What a constraint rebuilt from this record must be given — going back to driving
     * from a driven one's persisted datum would drop the expression the user wrote, since that
     * datum is the measurement (`setDriven`).
     */
    private sourceDatums(record: ConstraintRecord): ParameterValue[] | undefined {
        const values = this.datumValues(record);
        return values?.map((value, index) => {
            const source = record.datumSources?.[index];
            return typeof source === "string" ? source : value;
        });
    }

    /** The record's datum parameters exactly as garlic holds them. */
    private datumValues(record: ConstraintRecord): number[] | undefined {
        const paramIds = record.datumParamIds;
        if (paramIds === undefined) return undefined;
        return Array.from(this.system.get_params(new Uint32Array(paramIds)));
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
        this.constructionEntities.clear();
        this.external.clear();
        this.entityIdSeq = 1;
        this.draggedParamIds = [];
        this.seedDatum();
        this.loadData(data);
    }

    // ------------------------------------------------------------------ Datum seeding (see `solverEntities` / `sketchModel` for the reserved ids)

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

    // ------------------------------------------------------------------ External entities

    // The registry in `externalEntities.ts` owns which externals exist and where they
    // came from; these are the two halves of the seam. First the `ExternalEntityHost`
    // operations it borrows — the entity tables and the garlic system, expressed as
    // named operations rather than handed over as fields. Then one-line delegations,
    // which are the reason nothing outside this class had to change.

    /** `ExternalEntityHost`: creates `type`'s params and registers them as one entity. */
    seedEntity(type: SketchEntityType, values: number[], id?: number): number[] {
        const paramIds = this.addEntityParams(type, values);
        this.registerEntity(type, paramIds, id);
        return paramIds;
    }

    /** `ExternalEntityHost`: the entity's tables in one view; `cache` is the live array. */
    entityTablesOf(id: number): EntityTables | undefined {
        const type = this.entityTypes.get(id);
        const params = this.entityParams.get(id);
        const cache = this.entityCache.get(id);
        return type === undefined || params === undefined || cache === undefined
            ? undefined
            : { type, params, cache };
    }

    /** `ExternalEntityHost`: drops the entity's rows; its garlic params are the caller's. */
    forgetEntity(id: number): void {
        this.entityTypes.delete(id);
        this.entityParams.delete(id);
        this.entityCache.delete(id);
    }

    setFixed(id: number, fixed: boolean): void {
        if (fixed) this.fixedEntities.add(id);
        else this.fixedEntities.delete(id);
    }

    /** `ExternalEntityHost`: the serialization gate — see `idAllocatedSinceLoad`. */
    markIdAllocated(): void {
        this.idAllocatedSinceLoad = true;
    }

    addExternalEntity(ref: ExternalRefData): void {
        this.external.addExternalEntity(ref);
    }

    allocateExternalEntityId(): number {
        return this.external.allocateExternalEntityId();
    }

    recordRefPosition(nodeId: string, featureCount: number): void {
        this.external.recordRefPosition(nodeId, featureCount);
    }

    /** Removes the ref and every constraint referencing it; returns the removed constraint ids. */
    removeExternalEntity(id: number): number[] {
        return this.external.removeExternalEntity(id);
    }

    updateExternalEntity(id: number, params: number[]): void {
        this.external.updateExternalEntity(id, params);
    }

    syncExternalRefs(refs: ExternalRefData[]): boolean {
        return this.external.syncExternalRefs(refs);
    }

    externalEntitiesData(): SketchEntityData[] {
        return this.external.externalEntitiesData();
    }

    externalRefsData(): ExternalRefData[] {
        return this.external.externalRefsData();
    }

    /**
     * Ids of the user constraints the latest `syncExternalRefs` cascaded away —
     * through a type-flip reseed (their entity's param layout changed, so they could
     * not survive) or through a dropped ref (their target geometry no longer exists).
     * Both are reported so the editor can drop the constraints' dimension anchors:
     * an unreported removal would leave orphan anchors in `SketchData.anchors`.
     */
    get lastRemovedConstraintIds(): readonly number[] {
        return this.external.removedConstraintIds;
    }

    /**
     * Node id of the sketch plane's face owner (`SketchNode.planeRef`), set by the
     * editor — the solver never sees the node-level planeRef. Node-level, not
     * data-level: it survives `reset` (see the registry's field comment).
     */
    get planeOwnerNodeId(): string | undefined {
        return this.external.planeOwnerNodeId;
    }

    set planeOwnerNodeId(value: string | undefined) {
        this.external.planeOwnerNodeId = value;
    }

    /**
     * Pins every (x, y) point param pair of `paramIds` with an internal Fix
     * constraint to a datum param holding the point's current value — the shared
     * core of `seedDatum` and `seedExternalEntity`. `values` parallels `paramIds`
     * and supplies the pinned coordinates.
     */
    pinPoints(paramIds: readonly number[], values: readonly number[]): ExternalPins {
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

    // ------------------------------------------------------------------ Constraint-parameter plumbing

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
        const { params, datumParamIds, datumSources, garlicKind } = this.buildConstraintParams(
            constraint,
            id,
        );
        // `driving` is garlic's own flag: true means the datum is an input, false means it
        // is the write-back target of a reference dimension. A constraint with no datum
        // must stay driving — garlic refuses the other way round.
        const garlicId = this.system.add_constraint(
            garlicKind ?? constraint.kind,
            new Uint32Array(params),
            null,
            constraint.driven !== true,
            0,
        );
        this.constraints.set(id, {
            id,
            kind: constraint.kind,
            refs: constraint.refs.map((r) => ({ ...r })),
            garlicId,
            datumParamIds,
            datumSources,
            display: constraint.display,
            driven: constraint.driven,
        });
    }

    /** garlic param ids for a constraint; datum kinds also create their datum params. */
    private buildConstraintParams(
        constraint: Omit<SketchConstraintData, "id">,
        id: number,
    ): ConstraintParams {
        if (DATUM_CONSTRAINTS.has(constraint.kind)) return this.datumConstraintParams(constraint, id);
        return { params: this.geometricConstraintParams(constraint) };
    }

    /**
     * The garlic params of a constraint that is pure geometry: every ref contributes the
     * point / line / arc / radius ids garlic reads for that kind, in ref order.
     */
    private geometricConstraintParams(constraint: Omit<SketchConstraintData, "id">): number[] {
        const { refs } = constraint;
        switch (constraint.kind) {
            case ConstraintKind.P2PCoincident:
            case ConstraintKind.Horizontal:
            case ConstraintKind.Vertical:
            case ConstraintKind.HorizontalAlign:
            case ConstraintKind.VerticalAlign:
                return this.pointParams(refs[0], refs[1]);
            case ConstraintKind.PointOnArc:
                // p, c, s — refs are [point, center, start] (arc structural: end, center, start)
                return [...this.pointParams(refs[0]), ...this.arcParams(refs[1], refs[2])];
            case ConstraintKind.PointOnLine:
            case ConstraintKind.Midpoint:
                return [...this.pointParams(refs[0]), ...this.lineParams(refs[1], refs[2])];
            case ConstraintKind.Parallel:
            case ConstraintKind.Perpendicular:
            case ConstraintKind.EqualLength:
                return this.twoLineParams(refs);
            case ConstraintKind.Symmetric:
                return [...this.pointParams(refs[0], refs[1]), ...this.lineParams(refs[2], refs[3])];
            case ConstraintKind.EqualRadius:
                return [this.radiusParamId(refs[0].entityId), this.radiusParamId(refs[1].entityId)];
            case ConstraintKind.PointOnCircle:
                return [
                    ...this.pointParams(refs[0]),
                    ...this.circleCenterParamIds(refs[1]),
                    this.radiusParamId(refs[1].entityId),
                ];
            case ConstraintKind.TangentLineCircle:
                return [
                    ...this.lineParams(refs[0], refs[1]),
                    ...this.circleCenterParamIds(refs[2]),
                    this.radiusParamId(refs[2].entityId),
                ];
            case ConstraintKind.TangentCircleCircle:
                return [
                    ...this.circleCenterParamIds(refs[0]),
                    this.radiusParamId(refs[0].entityId),
                    ...this.circleCenterParamIds(refs[1]),
                    this.radiusParamId(refs[1].entityId),
                ];
            case ConstraintKind.EqualArcRadius:
            case ConstraintKind.TangentArcArc:
                return this.arcParams(refs[0], refs[1], refs[2], refs[3]);
            case ConstraintKind.TangentLineArc:
                return [...this.lineParams(refs[0], refs[1]), ...this.arcParams(refs[2], refs[3])];
            case ConstraintKind.TangentCircleArc:
                return [
                    ...this.circleCenterParamIds(refs[0]),
                    this.radiusParamId(refs[0].entityId),
                    ...this.arcParams(refs[1], refs[2]),
                ];
            default:
                // A datum kind never reaches here — `buildConstraintParams` routes it first.
                throw new Error(`Unsupported constraint kind: ${constraint.kind}`);
        }
    }

    /**
     * The garlic params of a datum-driven constraint: its geometric params plus the param
     * its datum is written into. The value comes from the expression scope, the geometry's
     * own value standing in when the datum is absent or does not resolve (see `datumOf`).
     */
    private datumConstraintParams(
        constraint: Omit<SketchConstraintData, "id">,
        id: number,
    ): ConstraintParams {
        const { refs } = constraint;
        switch (constraint.kind) {
            case ConstraintKind.P2PDistance:
                return this.withDatum(this.pointParams(refs[0], refs[1]), id, constraint, () =>
                    this.currentDistance(refs[0], refs[1]),
                );
            case ConstraintKind.Radius:
                return this.radiusConstraintParams(constraint, id);
            case ConstraintKind.P2LDistance:
                return this.withDatum(
                    [...this.pointParams(refs[0]), ...this.lineParams(refs[1], refs[2])],
                    id,
                    constraint,
                    () => this.currentP2LDistance(refs),
                );
            case ConstraintKind.Angle:
                return this.withDatum(this.twoLineParams(refs), id, constraint, () =>
                    this.currentAngle(refs),
                );
            case ConstraintKind.HorizontalDistance:
            case ConstraintKind.VerticalDistance:
                return this.withDatum(this.pointParams(refs[0], refs[1]), id, constraint, () =>
                    this.currentSignedDistance(
                        refs[0],
                        refs[1],
                        constraint.kind === ConstraintKind.HorizontalDistance ? 0 : 1,
                    ),
                );
            case ConstraintKind.Fix:
                return this.fixConstraintParams(constraint, id);
            default:
                throw new Error(`Unsupported datum constraint kind: ${constraint.kind}`);
        }
    }

    /** A circle's radius drives its radius param; an arc has none, so it drives a point distance. */
    private radiusConstraintParams(
        constraint: Omit<SketchConstraintData, "id">,
        id: number,
    ): ConstraintParams {
        const entityId = constraint.refs[0].entityId;
        if (this.typeOf(entityId) !== "arc") {
            return this.withDatum([this.radiusParamId(entityId)], id, constraint, () =>
                this.currentRadius(entityId),
            );
        }
        // arcs have no radius param — drive ‖start−center‖ as a point distance
        const start: SketchPointRef = { entityId, pointIndex: 1 };
        return {
            garlicKind: ConstraintKind.P2PDistance,
            ...this.withDatum(this.arcParams(constraint.refs[0], start), id, constraint, () =>
                this.currentRadius(entityId),
            ),
        };
    }

    /** A fix pins one point; given explicit datums, each coordinate carries its own. */
    private fixConstraintParams(constraint: Omit<SketchConstraintData, "id">, id: number): ConstraintParams {
        const ref = constraint.refs[0];
        const fallback = this.pointOf(ref);
        const sources = constraint.datums;
        return this.withDatums(
            this.pointParams(ref),
            sources === undefined
                ? fallback.map((value) => ({ source: value, value }))
                : sources.map((source, index) =>
                      this.datumOf(id, constraint.kind, source, () => fallback[index]),
                  ),
        );
    }

    /**
     * One datum on top of a constraint's geometric params. A driven dimension is seeded
     * from the geometry rather than from any stored value: its datum is garlic's output,
     * so whatever was persisted there is last solve's measurement — and the first solve
     * of a session should read the geometry, not a stale copy of it.
     *
     * An expression it was written with is still carried as the datum's *source*, though. It is
     * the user's, and it belongs to the dimension rather than to the driving it is not doing at
     * the moment: dropping it here is what would leave a toggle back to driving holding a number
     * (`sourceDatums`). Nothing resolves it meanwhile — a reference measures, and the source is
     * only ever read back by a rebuild.
     */
    private withDatum(
        params: number[],
        id: number,
        constraint: Omit<SketchConstraintData, "id">,
        fallback: () => number,
    ): ConstraintParams {
        if (constraint.driven === true) {
            const value = fallback();
            const carried = typeof constraint.datum === "string" ? constraint.datum : value;
            return this.withDatums(params, [{ source: carried, value }]);
        }
        return this.withDatums(params, [
            this.datumOf(id, constraint.kind, constraint.datum, fallback, constraint.display),
        ]);
    }

    /** The garlic params of each ref, concatenated in ref order. */
    private pointParams(...refs: readonly SketchPointRef[]): number[] {
        return refs.flatMap((ref) => this.pointParamIds(ref));
    }

    private lineParams(...refs: readonly SketchPointRef[]): number[] {
        return refs.flatMap((ref) => this.linePointParamIds(ref));
    }

    private arcParams(...refs: readonly SketchPointRef[]): number[] {
        return refs.flatMap((ref) => this.arcPointParamIds(ref));
    }

    /**
     * One datum as a source/value pair. `source === undefined` is the datumless case: the
     * geometry's current value becomes both the source and the value, exactly as before.
     *
     * A literal is a storage value already — sign and all, so it is taken as it stands. An
     * expression is written in the reading's units, where a side-carrying distance is a magnitude
     * (`datumSignIsSide`), so it takes the side the geometry is on — which is the side the
     * constraint was built for, and the one a later re-resolve keeps.
     *
     * An expression that does not resolve does NOT throw — the dimension falls back to
     * that same geometric value and the error is recorded in `datumErrors`, mirroring how
     * a failed feature keeps the body's last good shape. A bad expression must not make
     * the sketch unopenable; the editor surfaces it on the annotation instead.
     */
    private datumOf(
        id: number,
        kind: ConstraintKind,
        source: ParameterValue | undefined,
        fallback: () => number,
        display?: RadiusDisplay,
    ): DatumValue {
        if (source === undefined) {
            const value = fallback();
            return { source: value, value };
        }
        const resolved = resolveDatumSource(kind, source, this._scope, display);
        if (resolved.isOk) {
            const value =
                typeof source === "number"
                    ? resolved.value
                    : this.sideSignedDatum(kind, resolved.value, fallback(), false);
            return { source, value };
        }
        this._datumErrors.set(id, resolved.error);
        return { source, value: fallback() };
    }

    private withDatums(params: number[], datums: readonly DatumValue[]): ConstraintParams {
        const datumParamIds = datums.map((datum) => this.createDatumParam(datum.value));
        return {
            params: [...params, ...datumParamIds],
            datumParamIds,
            datumSources: datums.map((datum) => datum.source),
        };
    }

    createDatumParam(value: number): number {
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

    // ------------------------------------------------------------------ Load and param cache

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
        // The constraints are rebuilt below, so their datum errors are too.
        this._datumErrors.clear();
        this.external.refPositions = data.refPositions === undefined ? undefined : { ...data.refPositions };
        // external refs seed before the constraints that may reference them
        for (const ref of data.externalRefs ?? []) {
            this.external.addExternalEntity(ref);
        }
        for (const entity of data.entities) {
            this.registerEntity(entity.type, this.addEntityParams(entity.type, entity.params), entity.id);
            if (entity.construction === true) this.constructionEntities.add(entity.id);
        }
        for (const constraint of data.constraints) {
            this.addConstraintWithId(constraint.id, constraint);
        }
        // id counters: trust the serialized ones; data written before counters
        // initializes from the current max+1 / min-1 via the seeding above
        if (data.entityIdSeq !== undefined) this.entityIdSeq = Math.max(this.entityIdSeq, data.entityIdSeq);
        if (data.externalIdSeq !== undefined) {
            this.external.idSeq = Math.min(this.external.idSeq, data.externalIdSeq);
        }
        this.idCountersPersisted = data.entityIdSeq !== undefined || data.externalIdSeq !== undefined;
        this.idAllocatedSinceLoad = false;
        // normalize roles for documents written before role derivation (and for
        // hand-edited data): an unpinned ref any constraint references is a profile
        syncExternalRoles({ constraints: data.constraints, externalRefs: [...this.external.refs] });
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
