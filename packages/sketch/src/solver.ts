// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plane } from "@chili3d/core";
import type { WasmSystem } from "../lib/garlic";
import { newGarlicSystem } from "./garlic";
import {
    ConstraintKind,
    nextSketchId,
    pointRefKey,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
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

/** garlic param kinds per entity type: line = 2 points, circle = center + radius. */
const ENTITY_PARAM_KINDS: Record<SketchEntityType, number[]> = {
    line: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE],
    circle: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_LENGTH],
};

export interface SolveOutcome {
    result: string;
    dofs: number;
}

interface ConstraintRecord {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    garlicId: number;
    datumParamId?: number;
}

/**
 * Wraps one garlic `WasmSystem` for a sketch on a given plane.
 * Entity/constraint ids exposed here are stable and owned by this class;
 * garlic ParamId/ConstraintId handles stay internal.
 */
export class SketchSolver {
    readonly plane: Plane;
    private system: WasmSystem;
    private readonly entityTypes = new Map<number, SketchEntityType>();
    private readonly entityParams = new Map<number, number[]>();
    private readonly constraints = new Map<number, ConstraintRecord>();
    private entityCache = new Map<number, number[]>();
    private draggedParamIds: number[] = [];

    constructor(plane: Plane, data?: SketchData) {
        this.plane = plane;
        this.system = newGarlicSystem();
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

    addConstraint(constraint: Omit<SketchConstraintData, "id">): number {
        const id = nextSketchId([...this.constraints.values()]);
        this.addConstraintWithId(id, constraint);
        return id;
    }

    removeConstraint(id: number): void {
        const record = this.constraints.get(id);
        if (record === undefined) {
            throw new Error(`Unknown sketch constraint: ${id}`);
        }
        this.system.remove_constraint(record.garlicId);
        if (record.datumParamId !== undefined) {
            this.system.remove_param(record.datumParamId);
        }
        this.constraints.delete(id);
    }

    /** Removes the entity and every constraint referencing it; returns removed constraint ids. */
    removeEntity(id: number): number[] {
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

    setDatum(constraintId: number, value: number): void {
        const record = this.constraints.get(constraintId);
        if (record?.datumParamId === undefined) {
            throw new Error(`Constraint ${constraintId} has no datum`);
        }
        this.system.set_param(record.datumParamId, value);
    }

    /** Moves a point without solving; used by auto-constraint snapping before a solve. */
    setPointPosition(ref: SketchPointRef, u: number, v: number): void {
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

    solve(fine: boolean): SolveOutcome {
        const report = this.system.solve(fine);
        this.refreshCache();
        return {
            result: typeof report === "string" ? report : String(report?.result),
            dofs: this.system.dofs(),
        };
    }

    dofs(): number {
        return this.system.dofs();
    }

    entities(): SketchEntityData[] {
        return [...this.entityCache.entries()].map(([id, params]) => ({
            id,
            type: this.entityTypes.get(id)!,
            params: [...params],
        }));
    }

    /** Current data of one entity, or undefined when unknown. */
    entity(id: number): SketchEntityData | undefined {
        const type = this.entityTypes.get(id);
        const params = this.entityCache.get(id);
        return type === undefined || params === undefined ? undefined : { id, type, params: [...params] };
    }

    pointOf(ref: SketchPointRef): [number, number] {
        const [x, y] = this.pointCacheIndices(ref);
        const params = this.entityCache.get(ref.entityId)!;
        return [params[x], params[y]];
    }

    entityPoints(entityId: number): [number, number][] {
        const type = this.entityTypes.get(entityId);
        if (type === undefined) {
            throw new Error(`Unknown sketch entity: ${entityId}`);
        }
        return type === "line"
            ? [this.pointOf({ entityId, pointIndex: 0 }), this.pointOf({ entityId, pointIndex: 1 })]
            : [this.pointOf({ entityId, pointIndex: 0 })];
    }

    /**
     * All point refs coincident-linked to `ref` (including `ref` itself).
     * Coincident constraints merge points conceptually; garlic keeps separate params,
     * so drag operations must move the whole group.
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

    /** Union-find parent map over all coincident-linked point refs. */
    private coincidentParentMap(): Map<string, string> {
        const parent = new Map<string, string>();
        for (const record of this.constraints.values()) {
            if (record.kind !== ConstraintKind.P2PCoincident || record.refs.length !== 2) continue;
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
                for (const id of this.pointParamIds(r)) {
                    paramIds.add(id);
                }
            }
        }
        this.draggedParamIds = [...paramIds];
        this.system.mark_dragged(new Uint32Array(this.draggedParamIds));
    }

    dragTo(ref: SketchPointRef, u: number, v: number): SolveOutcome {
        for (const r of this.coincidentGroup(ref)) {
            const [xId, yId] = this.pointParamIds(r);
            this.system.set_param(xId, u);
            this.system.set_param(yId, v);
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
            if (record.datumParamId !== undefined) {
                data.datum = this.system.get_params(new Uint32Array([record.datumParamId]))[0];
            }
            return data;
        });
        return { entities: this.entities(), constraints };
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
        this.constraints.clear();
        this.entityCache.clear();
        this.draggedParamIds = [];
        this.loadData(data);
    }

    private registerEntity(type: SketchEntityType, paramIds: number[], id?: number): number {
        const entityId = id ?? nextSketchId([...this.entityTypes.keys()].map((x) => ({ id: x })));
        this.entityTypes.set(entityId, type);
        this.entityParams.set(entityId, paramIds);
        this.entityCache.set(entityId, [...this.system.get_params(new Uint32Array(paramIds))]);
        return entityId;
    }

    private addConstraintWithId(id: number, constraint: Omit<SketchConstraintData, "id">): void {
        const { params, datumParamId } = this.buildConstraintParams(constraint);
        const garlicId = this.system.add_constraint(constraint.kind, new Uint32Array(params), null, true, 0);
        this.constraints.set(id, {
            id,
            kind: constraint.kind,
            refs: constraint.refs.map((r) => ({ ...r })),
            garlicId,
            datumParamId,
        });
    }

    /** garlic param ids for a constraint; datum kinds also create their datum param. */
    private buildConstraintParams(constraint: Omit<SketchConstraintData, "id">): {
        params: number[];
        datumParamId?: number;
    } {
        const { refs } = constraint;
        switch (constraint.kind) {
            case ConstraintKind.P2PCoincident:
            case ConstraintKind.Horizontal:
            case ConstraintKind.Vertical:
                return { params: [...this.pointParamIds(refs[0]), ...this.pointParamIds(refs[1])] };
            case ConstraintKind.P2PDistance:
                return this.withDatum(
                    [...this.pointParamIds(refs[0]), ...this.pointParamIds(refs[1])],
                    constraint.datum ?? this.currentDistance(refs[0], refs[1]),
                );
            case ConstraintKind.Radius:
                return this.withDatum(
                    [this.radiusParamId(refs[0].entityId)],
                    constraint.datum ?? this.currentRadius(refs[0].entityId),
                );
            default:
                throw new Error(`Unsupported constraint kind: ${constraint.kind}`);
        }
    }

    private withDatum(params: number[], value: number): { params: number[]; datumParamId: number } {
        const datumParamId = this.createDatumParam(value);
        return { params: [...params, datumParamId], datumParamId };
    }

    private createDatumParam(value: number): number {
        return Number(
            this.system.add_params(new Uint8Array([PARAM_KIND_LENGTH]), new Float64Array([value]))[0],
        );
    }

    private pointCacheIndices(ref: SketchPointRef): [number, number] {
        const type = this.entityTypes.get(ref.entityId);
        if (type === "line" && (ref.pointIndex === 0 || ref.pointIndex === 1)) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "circle" && ref.pointIndex === 0) {
            return [0, 1];
        }
        throw new Error(`Invalid point ref ${ref.entityId}:${ref.pointIndex}`);
    }

    private pointParamIds(ref: SketchPointRef): [number, number] {
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

    /** Radius from the cache; the caller already validated the circle via `radiusParamId`. */
    private currentRadius(entityId: number): number {
        return this.entityCache.get(entityId)![2];
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
        for (const entity of data.entities) {
            this.registerEntity(entity.type, this.addEntityParams(entity.type, entity.params), entity.id);
        }
        for (const constraint of data.constraints) {
            this.addConstraintWithId(constraint.id, constraint);
        }
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
