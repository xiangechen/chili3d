// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { WasmSystem } from "../../lib/garlic";
import { normalizeSnapshot } from "./entityLayout";
import {
    ConstraintKind,
    type ExternalRefData,
    entityPointCount,
    FIRST_EXTERNAL_ENTITY_ID,
    type SketchEntityType,
} from "./sketchModel";

/**
 * The pinned external entities of a sketch: the geometry projected in from other
 * nodes, plus the refs and timeline anchors that describe where it came from.
 *
 * This was a cluster of methods inside `SketchSolver` — the largest single block in
 * that 1278-line class, and the one block with state of its own rather than the
 * solver's. It is a registry rather than a second solver: it owns *which* externals
 * exist and *where* they came from, and borrows the solver's entity tables and garlic
 * system to place them. `SketchSolver` keeps delegating, so nothing outside changed.
 *
 * The shape of an external entity:
 * - its params live in the solver's regular entity tables, under a reserved negative
 *   id, marked fixed (targetable by constraints, never draggable/deletable/editable);
 * - every param is additionally pinned by an internal structural constraint to a
 *   datum holding its seeded value, so its net contribution to the degrees of freedom
 *   is zero and `updateExternalEntity` can move it by rewriting both sides;
 * - those structural constraints stay out of the solver's constraint table, so they
 *   are never serialized, annotated or removable.
 */

/**
 * What the registry needs from the solver. Named operations rather than raw fields —
 * the point of the split is that the borrow is declared, and this is the declaration.
 */
export interface ExternalEntityHost {
    /** The garlic system params and constraints are created in. Replaced on `reset`. */
    readonly system: WasmSystem;
    /**
     * Creates garlic params in `type`'s entity layout AND registers them as an entity
     * under `id` (allocating one when omitted). Returns the created param ids.
     */
    seedEntity(type: SketchEntityType, values: number[], id?: number): number[];
    /** The entity tables for `id`, with `cache` LIVE — mutations are seen by later reads. */
    entityTablesOf(id: number): EntityTables | undefined;
    /** Drops `id` from the entity tables; its garlic params are the caller's business. */
    forgetEntity(id: number): void;
    setFixed(id: number, fixed: boolean): void;
    /** Removes every constraint referencing `entityId`, returning the removed ids. */
    removeConstraintsOn(entityId: number): number[];
    /** Pins `paramIds`, taken in (x, y) pairs, to a fresh datum per pair holding `values`. */
    pinPoints(paramIds: readonly number[], values: readonly number[]): ExternalPins;
    /** A fresh garlic param holding `value`, for a structural datum to pin against. */
    createDatumParam(value: number): number;
    /** Records that an id was allocated since the last load — the serialization gate. */
    markIdAllocated(): void;
}

/** The three entity tables as one view. */
export interface EntityTables {
    readonly type: SketchEntityType;
    readonly params: readonly number[];
    readonly cache: number[];
}

/**
 * Internal structural pins of one seeded external entity (a Fix per point, plus a
 * Radius for circles): `datumParamIds[i]` is the structural datum pinning the
 * entity's `entityParams[i]`, so the net dofs contribution is zero and
 * `updateExternalEntity` can move the entity by rewriting both sides.
 */
export interface ExternalPins {
    datumParamIds: number[];
    constraintIds: number[];
}

export class ExternalEntityRegistry {
    /** Structural pins of the seeded entities, keyed by their reserved negative ids. */
    private readonly pins = new Map<number, ExternalPins>();
    /** The refs carried through `toData`; the sketch node owns their persistent state. */
    private _refs: ExternalRefData[] = [];
    /** Timeline anchors carried through `toData` like `refs` (see `SketchData.refPositions`). */
    private _refPositions: Record<string, number> | undefined;
    /**
     * Monotonic id allocation, serialized as `SketchData.externalIdSeq`: freed ids are
     * never reused, so a stale ProfileRef fingerprint (keyed on entity ids) can never
     * match a geometrically different region. External ids count down from
     * `FIRST_EXTERNAL_ENTITY_ID`.
     */
    private _idSeq = FIRST_EXTERNAL_ENTITY_ID;
    /** Constraint ids cascaded away by the latest `syncExternalRefs` (type-flip reseed or drop). */
    private _removedConstraintIds: number[] = [];
    /**
     * Node id of the sketch plane's face owner (`SketchNode.planeRef`), set by the
     * editor — the registry never sees the node-level planeRef. That anchor has a
     * second consumer beyond the refs (`computeSketchRollback` seeds from it even when
     * no feature references the sketch), so it is exempt from the last-ref prune in
     * `removeExternalEntity`. Node-level, not data-level: `clear` keeps it.
     */
    planeOwnerNodeId: string | undefined;

    constructor(private readonly host: ExternalEntityHost) {}

    get refs(): readonly ExternalRefData[] {
        return this._refs;
    }

    get refPositions(): Record<string, number> | undefined {
        return this._refPositions;
    }

    set refPositions(value: Record<string, number> | undefined) {
        this._refPositions = value;
    }

    get idSeq(): number {
        return this._idSeq;
    }

    set idSeq(value: number) {
        this._idSeq = value;
    }

    get removedConstraintIds(): readonly number[] {
        return this._removedConstraintIds;
    }

    /** Drops all data-level state; `planeOwnerNodeId` survives (see its comment). */
    clear(): void {
        this.pins.clear();
        this._refs = [];
        this._refPositions = undefined;
        this._idSeq = FIRST_EXTERNAL_ENTITY_ID;
        this._removedConstraintIds = [];
    }

    /**
     * Seeds an external reference into the regular entity tables under its reserved
     * negative id, marked fixed and pinned like the datum: every point is pinned by
     * an internal Fix (circles also pin the radius), so the net dofs contribution
     * is zero. The ref joins the carried list that `toData` preserves.
     */
    addExternalEntity(ref: ExternalRefData): void {
        if (this.pins.has(ref.entityId)) {
            throw new Error(`External reference already seeded: ${ref.entityId}`);
        }
        this.seedExternalEntity(ref.entityId, ref.type, normalizeSnapshot(ref.type, ref.snapshot));
        // the counter stays below every seeded id, even one allocated outside it
        this._idSeq = Math.min(this._idSeq, ref.entityId - 1);
        this._refs.push(ref);
    }

    /**
     * Allocates the next external entity id from the monotonic session counter
     * (counts down from FIRST_EXTERNAL_ENTITY_ID, never reissuing a freed id).
     * Command/editor-side allocation — the id is then seeded with addExternalEntity.
     */
    allocateExternalEntityId(): number {
        this.host.markIdAllocated();
        return this._idSeq--;
    }

    /**
     * Anchors a newly referenced body's timeline position (its current feature
     * count). The first reference anchors it; later references to the same body
     * keep the anchor — the sketch's timeline position does not move.
     */
    recordRefPosition(nodeId: string, featureCount: number): void {
        if (this._refPositions?.[nodeId] !== undefined) return;
        if (this._refPositions === undefined) this._refPositions = {};
        this._refPositions[nodeId] = featureCount;
    }

    /**
     * Removes an external reference and every constraint referencing it; returns
     * the removed constraint ids. The structural pins, their datum params and the
     * entity params are removed from garlic (constraints first — params in use
     * cannot be removed).
     */
    removeExternalEntity(id: number): number[] {
        const pins = this.pins.get(id);
        if (pins === undefined) {
            throw new Error(`Unknown external reference: ${id}`);
        }
        const removedConstraints = this.host.removeConstraintsOn(id);
        for (const constraintId of pins.constraintIds) {
            this.host.system.remove_constraint(constraintId);
        }
        for (const paramId of pins.datumParamIds) {
            this.host.system.remove_param(paramId);
        }
        for (const paramId of this.host.entityTablesOf(id)!.params) {
            this.host.system.remove_param(paramId);
        }
        this.pins.delete(id);
        this.host.setFixed(id, false);
        this.host.forgetEntity(id);
        const nodeId = this._refs.find((ref) => ref.entityId === id)?.nodeId;
        this._refs = this._refs.filter((ref) => ref.entityId !== id);
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
        if (nodeId === undefined || nodeId === this.planeOwnerNodeId || this._refPositions === undefined) {
            return;
        }
        if (this._refs.some((ref) => ref.nodeId === nodeId)) {
            return;
        }
        delete this._refPositions[nodeId];
        // a fully pruned map goes back to absent for a byte-identical round-trip
        if (Object.keys(this._refPositions).length === 0) this._refPositions = undefined;
    }

    /**
     * Moves a seeded external entity to newly resolved geometry: rewrites both the
     * entity params and the structural datum params pinning them (the JS-side cache
     * follows, so reads never cross wasm). Callers run a fine solve afterwards so
     * the attached geometry follows.
     */
    updateExternalEntity(id: number, params: number[]): void {
        const pins = this.pins.get(id);
        const tables = this.host.entityTablesOf(id);
        if (pins === undefined || tables === undefined) {
            throw new Error(`Unknown external reference: ${id}`);
        }
        if (params.length !== tables.params.length) {
            throw new Error(`External reference ${id} expects ${tables.params.length} params`);
        }
        const cache = tables.cache;
        for (let i = 0; i < params.length; i++) {
            this.host.system.set_param(tables.params[i], params[i]);
            this.host.system.set_param(pins.datumParamIds[i], params[i]);
            cache[i] = params[i];
        }
    }

    /**
     * Reconciles the seeded external entities with `refs` (the node re-resolved
     * them behind the solver's back): seeds new ones, removes dropped ones (with
     * their constraints), moves ones whose snapshot changed. A type flip reseeds
     * the entity — its constraints cannot survive the param-layout change and are
     * removed. Both cascades are exposed via `removedConstraintIds` so the
     * editor can drop the removed constraints' dimension anchors. Returns whether
     * anything changed.
     */
    syncExternalRefs(refs: ExternalRefData[]): boolean {
        this._removedConstraintIds = [];
        let changed = this.dropStaleExternalRefs(refs);
        for (const ref of refs) {
            if (this.syncExternalEntity(ref)) changed = true;
        }
        this._refs = refs;
        return changed;
    }

    /** Drops seeded entities whose ref is gone, reporting the constraints that died with them. */
    private dropStaleExternalRefs(refs: ExternalRefData[]): boolean {
        let changed = false;
        for (const id of [...this.pins.keys()]) {
            if (!refs.some((ref) => ref.entityId === id)) {
                // a dropped ref's constraints die with it — report them like a type
                // flip does, or their dimension anchors stay behind as orphans
                this._removedConstraintIds.push(...this.removeExternalEntity(id));
                changed = true;
            }
        }
        return changed;
    }

    /** Seeds, reseeds (type flip) or moves one ref's entity; returns whether it changed. */
    private syncExternalEntity(ref: ExternalRefData): boolean {
        if (!this.pins.has(ref.entityId)) {
            this.addExternalEntity(ref);
            return true;
        }
        if (this.host.entityTablesOf(ref.entityId)?.type !== ref.type) {
            this.reseedExternalEntity(ref);
            return true;
        }
        const current = this.host.entityTablesOf(ref.entityId)!.cache;
        // hand-edited/legacy snapshots can carry the wrong length; normalize
        // instead of letting updateExternalEntity throw from this listener path
        const snapshot = normalizeSnapshot(ref.type, ref.snapshot);
        if (current.some((value, index) => value !== snapshot[index])) {
            this.updateExternalEntity(ref.entityId, snapshot);
            return true;
        }
        return false;
    }

    /**
     * Type-flip reseed: constraints cannot survive the param-layout change, so the
     * entity is removed (cascading its constraints, exposed via
     * `removedConstraintIds`) and re-seeded. The source node's timeline anchor
     * is preserved across the removal.
     */
    private reseedExternalEntity(ref: ExternalRefData): void {
        const anchor = this._refPositions?.[ref.nodeId];
        this._removedConstraintIds.push(...this.removeExternalEntity(ref.entityId));
        this.addExternalEntity(ref);
        // the removal above prunes the anchor when this was the node's last ref
        // (and can empty the whole map) — restore it either way
        if (anchor !== undefined) {
            if (this._refPositions === undefined) this._refPositions = {};
            this._refPositions[ref.nodeId] = anchor;
        }
    }

    /**
     * Current data of every seeded external reference, mirroring the solver's
     * `entities()` for the real geometry and served from the same JS-side cache (no
     * wasm crossing). Externals are pinned snap/constraint targets — never editable —
     * so a snapped constraint onto one is always satisfiable from the sketch side.
     */
    externalEntitiesData(): { id: number; type: SketchEntityType; params: number[] }[] {
        return [...this.pins.keys()].map((id) => {
            const tables = this.host.entityTablesOf(id)!;
            return { id, type: tables.type, params: [...tables.cache] };
        });
    }

    /**
     * The external refs carried through `toData`, roles and dangling flags included.
     * During an editor session this is the live truth — `node.data` lags behind until
     * the next commit, so session displays and pick lists read the refs from here.
     */
    externalRefsData(): ExternalRefData[] {
        return [...this._refs];
    }

    /**
     * Seeds one external entity into the regular entity tables (marked fixed): raw
     * garlic params in the entity layout, every point pinned by an internal Fix
     * constraint (circles additionally pin the radius with an internal Radius
     * constraint). Net dofs contribution is zero; the structural constraints stay
     * out of the solver's constraint table.
     */
    private seedExternalEntity(entityId: number, type: SketchEntityType, params: number[]): void {
        const paramIds = this.host.seedEntity(type, params, entityId);
        // Only the point params are pinned here — a circle's radius param is not a
        // coordinate pair and gets its own Radius pin below.
        const { datumParamIds, constraintIds } = this.host.pinPoints(
            paramIds.slice(0, entityPointCount(type) * 2),
            params,
        );
        if (type === "circle") {
            const radiusDatum = this.host.createDatumParam(params[2]);
            datumParamIds.push(radiusDatum);
            constraintIds.push(
                this.host.system.add_constraint(
                    ConstraintKind.Radius,
                    new Uint32Array([paramIds[2], radiusDatum]),
                    null,
                    true,
                    0,
                ),
            );
        }
        this.host.setFixed(entityId, true);
        this.pins.set(entityId, { datumParamIds, constraintIds });
    }
}
