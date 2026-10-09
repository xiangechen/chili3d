// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EMPTY_SCOPE, type ParameterValue, type Plane, Precision, Result, type Scope } from "@chili3d/core";
import type { SolveResultInfo, WasmSystem } from "../../lib/garlic";
import { INCIDENCE_TOLERANCE } from "../features/refGeometry";
import {
    type ArrayInstanceSpec,
    type ArrayPatch,
    arrayInstanceSpecs,
    arrayInstanceTotal,
    arrayReferenceIds,
    cloneArrayData,
    copyRelation,
    instanceFirstSlot,
    instanceIndexOf,
    liveInstanceIds,
    resolveArray,
    sameIdList,
    seedRelations,
} from "./arrayOps";
import {
    type CurveEntity,
    closestCurvePair,
    entityDomain,
    isClosedCurveType,
    nurbsPoleCount,
    nurbsPoleValues,
    nurbsWeights,
    projectPoint,
    nurbsSpec as specOf,
} from "./curveEval";
import {
    entityParamKinds,
    normalizeNurbsParams,
    PARAM_KIND_COORDINATE,
    PARAM_KIND_DIMENSIONLESS,
    PARAM_KIND_LENGTH,
} from "./entityLayout";
import {
    type EntityTables,
    type ExternalEntityHost,
    ExternalEntityRegistry,
    type ExternalPins,
} from "./externalEntities";
import { newGarlicSystem } from "./garlic";
// the guard the offset op refuses a folded copy by, applied here to a distance the user
// changes afterwards: the same geometry, the same answer
import { offsetFolds } from "./offsetOps";
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
    type NurbsSpec,
    type OffsetCurveRef,
    pointRefKey,
    type RadiusDisplay,
    resolveDatumSource,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchArrayData,
    type SketchArrayPattern,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    syncExternalRoles,
    toDatumSource,
} from "./sketchModel";
import { entityPoints } from "./transformOps";

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
 * A NURBS entity's params from its control poles, weights and construction constants, in
 * the order the entity stores them: the poles' coordinates first, then one weight per pole.
 * Throws on a pole count the knot vector or the degree cannot carry: that is not a curve,
 * and the first constraint built on it would be the thing that found out.
 */
function nurbsEntityValues(poles: readonly number[], spec: NurbsSpec, weights?: readonly number[]): number[] {
    const poleCount = poles.length / 2;
    if (poleCount < 2 || poles.length % 2 !== 0) {
        throw new Error(`A nurbs needs at least two control poles, got ${poleCount}`);
    }
    if (spec.degree < 1 || spec.degree > poleCount - 1) {
        throw new Error(`A nurbs of ${poleCount} control poles cannot carry degree ${spec.degree}`);
    }
    if (spec.knots.length !== poleCount + spec.degree + 1) {
        throw new Error(`A nurbs knot vector is poles + degree + 1 long, got ${spec.knots.length}`);
    }
    const values = weights ?? new Array<number>(poleCount).fill(1);
    if (values.length !== poleCount) {
        throw new Error(`A nurbs needs one weight per pole, got ${values.length}`);
    }
    return [...poles, ...values];
}

/** Whether two NURBS describe the same curve structure — the same degree and the same knots. */
function sameNurbsSpec(first: NurbsSpec | undefined, second: NurbsSpec | undefined): boolean {
    if (first === undefined || second === undefined) return first === second;
    return (
        first.degree === second.degree &&
        first.knots.length === second.knots.length &&
        first.knots.every((knot, index) => knot === second.knots[index])
    );
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
    /**
     * Auxiliary contact parameters (the t of a PointOn/Tangent against a conic,
     * bezier, nurbs or curve pair): created with the constraint, seeded from the current
     * geometry, owned by it — `removeConstraint` removes them with it. They are
     * solver internals, never persisted: a reload re-seeds them (`buildConstraintParams`),
     * which keeps a saved sketch byte-identical whether or not it carries them.
     */
    auxParamIds?: number[];
    /**
     * The construction constants of the NURBS segments the constraint names, in its own
     * canonical curve order — garlic takes them as an argument of its own, beside the
     * params, since a knot vector cannot be recovered from a param list.
     */
    nurbs?: NurbsSpec[];
    /** garlic kind when it differs from the sketch-level kind (arc radius → P2PDistance). */
    garlicKind?: ConstraintKind;
}

/**
 * The shortest an offset copy's window may be, as a fraction of the source's own parameter
 * range: below it the copy has nothing left to draw and is deleted rather than kept as a
 * speck. A fraction, not a distance, because a window is a parameter range and the families
 * measure it differently (an angle, a knot span, a unit interval).
 */
const OFFSET_WINDOW_MIN_FRACTION = 1e-9;

/**
 * A copy of an offset ref, its window tuple included: the refs the solver keeps are its own,
 * and the ones it hands out are the caller's to do what it likes with — the same reason a
 * NURBS' knots are copied on the way in and on the way out.
 */
function copyOffsetRef(ref: OffsetCurveRef): OffsetCurveRef {
    return {
        sourceId: ref.sourceId,
        sourceType: ref.sourceType,
        distance: ref.distance,
        ...(ref.window === undefined ? {} : { window: [ref.window[0], ref.window[1]] as [number, number] }),
    };
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
    ConstraintKind.ConicRho,
]);

/**
 * The kinds carrying auxiliary contact parameters (the t of a PointOn/Tangent against
 * a conic, bezier, nurbs or curve pair, the t1/t2 of a curve-curve tangency):
 * `buildConstraintParams` routes them to `curveConstraintParams`, which creates and seeds
 * the aux params. PointOnEllipse/TangentLineEllipse carry no t and stay on the plain path.
 */
const AUX_CURVE_CONSTRAINTS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.PointOnConic,
    ConstraintKind.TangentLineConic,
    ConstraintKind.PointOnBezier,
    ConstraintKind.TangentLineBezier,
    ConstraintKind.PointOnNurbs,
    ConstraintKind.TangentLineNurbs,
    ConstraintKind.TangentCircleEllipse,
    ConstraintKind.TangentArcEllipse,
    ConstraintKind.TangentCircleConic,
    ConstraintKind.TangentArcConic,
    ConstraintKind.TangentCircleBezier,
    ConstraintKind.TangentArcBezier,
    ConstraintKind.TangentCircleNurbs,
    ConstraintKind.TangentArcNurbs,
    ConstraintKind.TangentEllipseEllipse,
    ConstraintKind.TangentEllipseConic,
    ConstraintKind.TangentEllipseBezier,
    ConstraintKind.TangentEllipseNurbs,
    ConstraintKind.TangentConicConic,
    ConstraintKind.TangentConicBezier,
    ConstraintKind.TangentConicNurbs,
    ConstraintKind.TangentBezierBezier,
    ConstraintKind.TangentBezierNurbs,
    ConstraintKind.TangentNurbsNurbs,
]);

interface ConstraintRecord {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    garlicId: number;
    datumParamIds?: number[];
    /** Auxiliary t params of a PointOn/Tangent against a conic, bezier, nurbs or curve pair. */
    auxParamIds?: number[];
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
    /**
     * The construction constants of the NURBS entities, by id — their degree and knot
     * vector. Beside the params rather than among them because garlic takes the pair as an
     * argument of its own (`add_constraint`'s `nurbs`): they are not solver parameters, and
     * nothing in a solve moves them.
     */
    private readonly entityNurbs = new Map<number, NurbsSpec>();
    /**
     * What an offset curve runs parallel to. It has no geometry of its own — `entities()` and
     * `entity()` compose it from its *source's* params as they are now, which is what makes an
     * offset copy follow the entity it came from without a refresh of its own, and what makes
     * its own params empty: nothing of it is a solver parameter, so `entityParamKinds` gives
     * garlic none and no constraint can name it.
     */
    private readonly entityOffsets = new Map<number, OffsetCurveRef>();
    /**
     * The internal constraints holding each NURBS' rational weights (`pinNurbsWeights`), by
     * entity id: the datum param each weight is held at, and the pin itself. Never
     * serialized — a load re-pins every weight at the value it came back with.
     */
    private readonly weightPins = new Map<number, { datumParamIds: number[]; constraintIds: number[] }>();
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
    /**
     * The sketch's arrays, by id (`SketchData.arrays`). Ids are session-local: nothing keys
     * off an array id across sessions — the instances carry their own array's id through
     * `SketchArrayData.instanceEntityIds` — so the allocator restarts at the loaded max + 1
     * rather than being persisted.
     */
    private readonly arrayRecords = new Map<number, SketchArrayData>();
    private arrayIdSeq = 1;
    /**
     * The entities the arrays generate. They are ordinary entities in every other respect —
     * drawn, picked, built into profiles like any other — but `refreshArrays` rewrites their
     * parameters from the record on every solve, so nothing the user does to one survives:
     * `isFixed` names them, and the setters and the ops refuse them the way they refuse the
     * datum and the external refs.
     */
    private readonly derivedEntities = new Set<number>();
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
     * Monotonic id allocation, serialized as SketchData.entityIdSeq/externalIdSeq/
     * constraintIdSeq: freed ids are never reused, so a stale ProfileRef fingerprint
     * (keyed on entity ids) can never match a geometrically different region, and a
     * stale dimension anchor (keyed on constraint ids) can never be inherited by a
     * later constraint. Real ids count up from 1, external ids count down from
     * FIRST_EXTERNAL_ENTITY_ID (the registry's).
     */
    private entityIdSeq = 1;
    private constraintIdSeq = 1;
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
     * The document's parameters as the solver resolves against them — the same table a
     * constraint's expression datum is read through. Read-only, and for callers that have to
     * resolve a value of their own: an array's numbers are the record's rather than a
     * constraint's, and the layers that draw and edit them resolve them here.
     */
    get scope(): Scope {
        return this._scope;
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
        this.addStructuralConstraints(id, "arc");
        return id;
    }

    addEllipse(cx: number, cy: number, mx: number, my: number, nx: number, ny: number): number {
        const id = this.registerEntity("ellipse", this.addEntityParams("ellipse", [cx, cy, mx, my, nx, ny]));
        this.addStructuralConstraints(id, "ellipse");
        return id;
    }

    addEllipseArc(
        cx: number,
        cy: number,
        mx: number,
        my: number,
        nx: number,
        ny: number,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
    ): number {
        const id = this.registerEntity(
            "ellipseArc",
            this.addEntityParams("ellipseArc", [cx, cy, mx, my, nx, ny, sx, sy, ex, ey]),
        );
        this.addStructuralConstraints(id, "ellipseArc");
        return id;
    }

    addConic(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number, rho: number): number {
        return this.registerEntity("conic", this.addEntityParams("conic", [sx, sy, cx, cy, ex, ey, rho]));
    }

    /** A cubic bezier through its four control poles: `poles` is [x0, y0, x1, y1, x2, y2, x3, y3]. */
    addBezier(poles: readonly number[]): number {
        if (poles.length !== 8) {
            throw new Error(`A bezier needs exactly four control poles, got ${poles.length / 2}`);
        }
        return this.registerEntity("bezier", this.addEntityParams("bezier", [...poles]));
    }

    /**
     * A NURBS through its control poles and construction constants: garlic's general form,
     * whose weights are params of their own beside the poles (see `SketchEntityData`).
     * `weights` defaults to the unit weights of a plain B-spline — what the sketch's own
     * tool draws with, and what a caller copying a curve's shape alone wants.
     */
    addNurbs(poles: readonly number[], spec: NurbsSpec, weights?: readonly number[]): number {
        const values = nurbsEntityValues(poles, spec, weights);
        const id = this.registerEntity("nurbs", this.addEntityParams("nurbs", values), undefined, spec);
        this.pinNurbsWeights(id);
        return id;
    }

    /**
     * Holds every one of a NURBS' rational weights at the value it carries, with one
     * internal constraint each.
     *
     * garlic takes the weights as *solve parameters* — `PointOnNurbs`'s layout is
     * control points, then weights, then the contact parameter, and its Jacobian has a
     * column per weight. Left unpinned they are free variables the solver will use to
     * satisfy a constraint, and a weight driven to zero or below is a curve the kernel
     * refuses outright: OCCT raises on a non-positive weight (the Release build turns that
     * into a failed shape, not a crash, but the sketch's profile would be gone all the
     * same). The sketch draws the unit weights every CAD tool's spline has and offers no
     * way to edit them, so they are constants here.
     *
     * The pin is `ConicRho` — garlic's one scalar pin, whose residual is exactly
     * `value − datum` (the kind is named for where it was first needed, not for what it
     * does) — and, like the datum's own Fix pins, it is solver-internal: never in
     * `constraints`, so never serialized, annotated or removable. A tool that let the user
     * edit weights would replace them with real dimensions.
     */
    private pinNurbsWeights(id: number): void {
        const params = this.entityParams.get(id);
        const cache = this.entityCache.get(id);
        if (this.entityTypes.get(id) !== "nurbs" || params === undefined || cache === undefined) return;
        const datumParamIds: number[] = [];
        const constraintIds: number[] = [];
        for (let index = nurbsPoleCount(cache) * 2; index < params.length; index++) {
            // a weight is dimensionless, exactly as a conic's rho is (`datumConstraintParams`)
            const datum = this.createDatumParam(cache[index], PARAM_KIND_DIMENSIONLESS);
            datumParamIds.push(datum);
            constraintIds.push(
                this.system.add_constraint(
                    ConstraintKind.ConicRho,
                    new Uint32Array([params[index], datum]),
                    null,
                    true,
                    0,
                ),
            );
        }
        this.weightPins.set(id, { datumParamIds, constraintIds });
    }

    /** Drops a NURBS' weight pins: the constraints first, then the datums they read. */
    private unpinNurbsWeights(id: number): void {
        const pins = this.weightPins.get(id);
        if (pins === undefined) return;
        for (const constraintId of pins.constraintIds) this.system.remove_constraint(constraintId);
        for (const datumParamId of pins.datumParamIds) this.system.remove_param(datumParamId);
        this.weightPins.delete(id);
    }

    /**
     * The constraints that are part of the entity rather than the user's: an arc's end on its
     * circle, and the ellipse family's axis perpendicularity (garlic reads the two axis points
     * as perpendicular — without the pin the solved curve and the drawn one diverge) plus, for
     * an ellipseArc, both rim points on the ellipse. Rebuilt by `retypeEntity` after the swap,
     * since garlic param ids do not survive it.
     */
    private addStructuralConstraints(id: number, type: SketchEntityType): void {
        if (type === "arc") {
            this.addConstraint({
                kind: ConstraintKind.PointOnArc,
                refs: [
                    { entityId: id, pointIndex: 2 },
                    { entityId: id, pointIndex: 0 },
                    { entityId: id, pointIndex: 1 },
                ],
            });
            return;
        }
        if (type !== "ellipse" && type !== "ellipseArc") return;
        this.addConstraint({
            kind: ConstraintKind.Perpendicular,
            refs: [
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 1 },
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 2 },
            ],
        });
        if (type !== "ellipseArc") return;
        for (const pointIndex of [3, 4]) {
            this.addConstraint({
                kind: ConstraintKind.PointOnEllipse,
                refs: [
                    { entityId: id, pointIndex },
                    { entityId: id, pointIndex: 0 },
                ],
            });
        }
    }

    addConstraint(constraint: Omit<SketchConstraintData, "id">): number {
        const id = this.constraintIdSeq++;
        this.idAllocatedSinceLoad = true;
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
        for (const auxParamId of record.auxParamIds ?? []) {
            this.system.remove_param(auxParamId);
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
        nurbs?: NurbsSpec,
    ): Result<number[]> {
        const refused = this.assertRetypeable(id);
        if (!refused.isOk) return Result.err(refused.error);
        const captured = this.constraintsData().filter((c) => c.refs.some((r) => r.entityId === id));
        const construction = this.constructionEntities.has(id);
        // the private path: this entity is changing shape, not going away, so the arrays
        // reading it must survive — the instances are re-laid from its new type on the
        // solve that follows
        this.dropEntity(id);
        // the private path, not `seedEntity`: same registration, without claiming an
        // id from the allocator (this id already exists, it is only changing shape)
        this.registerEntity(type, this.addEntityParams(type, values), id, nurbs);
        if (construction) this.constructionEntities.add(id);

        const dropped = this.reapplyConstraints(captured, transform);
        // the re-added constraints already advanced the allocator, so this one cannot
        // take the id of a constraint that was just re-created
        this.addStructuralConstraints(id, type);
        this.pinNurbsWeights(id);
        this.repointOffsetCopies(id, type);
        return Result.ok(dropped);
    }

    /** Refuses a retype the id itself forbids: a datum, an external ref, an array instance, an unknown id. */
    private assertRetypeable(id: number): Result<void> {
        if (isDatumEntityId(id) || isExternalEntityId(id)) {
            return Result.err("The datum and external references cannot change type");
        }
        if (this.derivedEntities.has(id)) {
            return Result.err("An array instance takes its type from the entity it copies");
        }
        if (this.entityTypes.get(id) === undefined) {
            return Result.err(`Unknown sketch entity: ${id}`);
        }
        return Result.ok(undefined);
    }

    /**
     * Re-creates each captured constraint under its own id, and returns the ids of the ones
     * that could not come back. A kind the new type cannot express (an EqualRadius over an
     * arc, whose `radiusParamId` throws) is a drop, not a failure of the whole retype.
     */
    private reapplyConstraints(
        captured: readonly SketchConstraintData[],
        transform: (constraint: SketchConstraintData) => Omit<SketchConstraintData, "id"> | undefined,
    ): number[] {
        const dropped: number[] = [];
        for (const constraint of captured) {
            if (isStructuralConstraint(constraint)) continue;
            const next = transform(constraint);
            if (next === undefined) {
                dropped.push(constraint.id);
                continue;
            }
            try {
                this.addConstraintWithId(constraint.id, next);
            } catch {
                dropped.push(constraint.id);
            }
        }
        return dropped;
    }

    /**
     * Moves an offset curve's distance. The copy has no geometry of its own — it reads its
     * source — so there is nothing to solve for: this writes the ref, and the caller solves and
     * commits. A distance the source cannot carry is refused here, before the geometry it would
     * fold through exists.
     */
    setOffsetDistance(entityId: number, distance: number): Result<void> {
        const ref = this.entityOffsets.get(entityId);
        if (ref === undefined) return Result.err("Not an offset curve");
        if (!Number.isFinite(distance) || Math.abs(distance) <= Precision.Distance) {
            return Result.err("The offset distance is too small");
        }
        const source = this.entity(ref.sourceId);
        if (source === undefined) return Result.err("The entity an offset curve reads is gone");
        if (offsetFolds(source, distance)) {
            return Result.err("The offset distance is larger than the geometry it comes from");
        }
        this.entityOffsets.set(entityId, { ...ref, distance });
        return Result.ok(undefined);
    }

    /**
     * Moves an offset curve's ends: the stretch of its source the copy runs over, in that
     * source's own parameter (`OffsetCurveRef.window`). `undefined` puts the copy back over
     * the whole source.
     *
     * A copy has no geometry of its own — it reads its source — so this is the one write
     * there is, and it is what the trim, the extend and the two handles on the copy's ends
     * all come to. Nothing is solved for: the caller solves and commits afterwards, exactly
     * as it does after a distance (see `setOffsetDistance`).
     *
     * A window longer than the source can carry, or one that has shrunk to nothing, is
     * refused rather than drawn as something it is not: the op that cut the copy knows which
     * half to keep, and one that would leave no copy at all deletes the entity instead.
     * Only a closed source (an ellipse) may carry a window past its own start — that is a
     * piece straddling its seam, and the parameter there is the one before it, on round.
     */
    setOffsetWindow(entityId: number, window: [number, number] | undefined): Result<void> {
        const ref = this.entityOffsets.get(entityId);
        if (ref === undefined) return Result.err("Not an offset curve");
        const whole: OffsetCurveRef = {
            sourceId: ref.sourceId,
            sourceType: ref.sourceType,
            distance: ref.distance,
        };
        if (window === undefined) {
            this.entityOffsets.set(entityId, whole);
            return Result.ok(undefined);
        }
        const source = this.entity(ref.sourceId);
        if (source === undefined) return Result.err("The entity an offset curve reads is gone");
        const [first, last] = window[0] <= window[1] ? window : [window[1], window[0]];
        const [domainStart, domainEnd] = entityDomain(source);
        const reach = domainEnd - domainStart;
        const span = last - first;
        if (!Number.isFinite(span) || span <= reach * OFFSET_WINDOW_MIN_FRACTION) {
            return Result.err("The offset copy would be left with nothing");
        }
        if (span > reach + Precision.Distance) {
            return Result.err("The offset copy cannot run past the end of what it came from");
        }
        // a window covering the whole source *is* the whole source: kept as one it would make
        // the copy read as a trimmed piece of itself (see `isClosedEntity`), which is a
        // distinction nothing on the canvas can show and every reader would have to undo
        if (span >= reach - Precision.Distance) {
            this.entityOffsets.set(entityId, whole);
            return Result.ok(undefined);
        }
        // a closed source is read on the round: a window past its end is the same window as the
        // one a turn back, so the start is folded there rather than left wherever a caller put
        // it. An open one is the source's own extent and nothing else — an end that has walked
        // off it is geometry the source cannot carry (the extend grows the source for this).
        if (isClosedCurveType(source.type)) {
            const folded = domainStart + ((((first - domainStart) % reach) + reach) % reach);
            this.entityOffsets.set(entityId, { ...whole, window: [folded, folded + span] });
            return Result.ok(undefined);
        }
        if (first < domainStart - Precision.Distance || last > domainEnd + Precision.Distance) {
            return Result.err("The offset copy cannot run past the end of what it came from");
        }
        this.entityOffsets.set(entityId, { ...whole, window: [first, last] });
        return Result.ok(undefined);
    }

    /** An offset curve's source and how far it runs off it, or undefined for any other entity. */
    offsetRefOf(entityId: number): OffsetCurveRef | undefined {
        const ref = this.entityOffsets.get(entityId);
        return ref === undefined ? undefined : copyOffsetRef(ref);
    }

    /**
     * Tells every copy of a retyped source what it now reads. A copy carries its source's
     * *kind* (`OffsetCurveRef.sourceType`) because the curve math reads an entity on its own,
     * and a trim that turns an ellipse into an ellipseArc — or a circle into an arc — leaves
     * that kind saying something the entity no longer is. The parameter a copy's window is
     * read in is the same on both sides of those two swaps (an absolute angle), so a window
     * that still fits stands as it is.
     *
     * What the swap *can* change is how much of the source there is — an ellipse trimmed into
     * an ellipseArc draws one sweep of it — so every window is re-fitted afterwards.
     */
    private repointOffsetCopies(sourceId: number, type: SketchEntityType): void {
        if (type === "offsetCurve") return;
        for (const [id, ref] of [...this.entityOffsets]) {
            if (ref.sourceId !== sourceId) continue;
            this.entityOffsets.set(id, { ...ref, sourceType: type });
            this.refitOffsetWindow(id);
        }
    }

    /**
     * Re-reads a copy's window against its source's domain *now*, dropping one the shrunk source
     * can no longer carry: the copy reads the whole of it again, which is what a window that no
     * longer names a piece of anything comes to. The write is `setOffsetWindow`'s, so one
     * reading decides what fits.
     */
    private refitOffsetWindow(id: number): void {
        const ref = this.entityOffsets.get(id);
        if (ref === undefined || ref.window === undefined) return;
        if (this.setOffsetWindow(id, ref.window).isOk) return;
        const whole: OffsetCurveRef = {
            sourceId: ref.sourceId,
            sourceType: ref.sourceType,
            distance: ref.distance,
        };
        this.entityOffsets.set(id, whole);
    }

    /** Removes the entity and every constraint referencing it; returns removed constraint ids. */
    removeEntity(id: number): number[] {
        if (isDatumEntityId(id)) {
            throw new Error("The sketch datum cannot be removed");
        }
        if (isExternalEntityId(id)) {
            throw new Error("External references are removed with removeExternalEntity");
        }
        // An offset copy is `derived` too, but it is the user's own curve — the solver places
        // it and nothing more — so it goes like any other entity the user drew.
        if (this.isArrayInstance(id)) {
            throw new Error("An array instance is removed with its array");
        }
        this.detachFromArrays(id);
        const removed = this.dropEntity(id);
        removed.push(...this.dropOffsetCopies(id));
        // losing a source re-lays what the pattern keeps, so leaving it half-placed for the
        // caller's solve to fix would be an entity list that lies in between
        this.refreshArrays();
        return removed;
    }

    /**
     * Forgets the entity and every constraint referencing it. The unguarded half of
     * `removeEntity`: the array machinery and `retypeEntity` reach for this one, since what
     * they remove is theirs to remove — an instance the pattern no longer wants, an entity
     * that is only changing type.
     */
    private dropEntity(id: number): number[] {
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
        // the pins before the params they hold: a weight's own pin is an active constraint
        // on it, and garlic refuses to drop a param one still references
        this.unpinNurbsWeights(id);
        for (const paramId of paramIds) {
            this.system.remove_param(paramId);
        }
        this.entityTypes.delete(id);
        this.entityParams.delete(id);
        this.entityCache.delete(id);
        this.entityNurbs.delete(id);
        this.entityOffsets.delete(id);
        this.constructionEntities.delete(id);
        return removedConstraints;
    }

    /**
     * Removes the offset copies of a source that is going away. A copy's params *are* its
     * source's (`offsetGeometry`), so one whose source is gone has no geometry at all — it
     * would draw and build from an empty parameter list. That is the same answer a pattern's
     * instances get when their seed is deleted, and for the same reason.
     */
    private dropOffsetCopies(sourceId: number): number[] {
        const removed: number[] = [];
        // a copy of an offset copy is never built (`offsettableSources` refuses one), so one
        // pass is enough and no queue is needed
        for (const [id, ref] of [...this.entityOffsets]) {
            if (ref.sourceId === sourceId) removed.push(...this.dropEntity(id));
        }
        return removed;
    }

    /**
     * Whether the entity is not the user's to move, retype or constrain: the datum, the seeded
     * external references, every array instance, and every offset copy. All four are
     * targetable — they snap, they pick, they carry constraints the *solver* owns — but none
     * of them is the sketch's to edit, and every op that asks "may I touch this" asks this.
     *
     * An offset copy is the one of the four that is *cut*: it is drawn geometry the user chose
     * to put there, so a trim, an extend and a delete are all its own and ask
     * `entity.type === "offsetCurve"` on top of this (`trimOps`, `extendOps`). What it cannot
     * be is rewritten — it has no point for a move or a retype to take hold of, which is what
     * this set is really about.
     *
     * Note this is not the same set `entities()` filters on: the datum and the externals are
     * solver-only rows, while an array's instances and an offset copy are real geometry that
     * has to be drawn, picked and built into profiles like any other entity.
     */
    isFixed(entityId: number): boolean {
        return this.fixedEntities.has(entityId) || this.derivedEntities.has(entityId);
    }

    /** Whether the entity is laid out by something else — a pattern's instance, or a copy of a source. */
    isDerived(entityId: number): boolean {
        return this.derivedEntities.has(entityId);
    }

    /**
     * Whether the entity is one a *pattern* lays out: an instance. `isDerived` less the offset
     * copies, which the solver places too but which the user still owns — they are deleted
     * like anything drawn (see `removeEntity`), where an instance goes with its array.
     */
    private isArrayInstance(entityId: number): boolean {
        return this.derivedEntities.has(entityId) && this.entityOffsets.get(entityId) === undefined;
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
        if (this.derivedEntities.has(ref.entityId)) {
            throw new Error("An array instance is placed by its array");
        }
        this.writePoint(ref, u, v);
    }

    /** The unguarded half of `setPointPosition` — what the arrays themselves write with. */
    private writePoint(ref: SketchPointRef, u: number, v: number): void {
        const [xId, yId] = this.pointParamIds(ref);
        this.system.set_param(xId, u);
        this.system.set_param(yId, v);
        const [x, y] = this.pointCacheIndices(ref);
        const cache = this.entityCache.get(ref.entityId)!;
        cache[x] = u;
        cache[y] = v;
    }

    /**
     * Sets a real circle's radius without solving; used by ops that resize geometry in
     * place. A circle keeps its radius in a param of its own (`params[2]`), which the point
     * setters cannot reach — an arc's radius is ‖start − centre‖ and comes along with them.
     */
    setRadius(entityId: number, radius: number): void {
        if (this.derivedEntities.has(entityId)) {
            throw new Error("An array instance's radius comes from the entity it copies");
        }
        if (this.isFixed(entityId)) {
            throw new Error("A fixed entity's radius cannot be changed");
        }
        this.writeRadius(entityId, radius);
    }

    /** The unguarded half of `setRadius` — what the arrays themselves write with. */
    private writeRadius(entityId: number, radius: number): void {
        const paramId = this.radiusParamId(entityId);
        this.system.set_param(paramId, radius);
        const cache = this.entityCache.get(entityId);
        if (cache !== undefined) cache[2] = radius;
    }

    /** The unguarded write of one scalar (non-point) param: a conic's rho. */
    private writeScalar(entityId: number, index: number, value: number): void {
        const paramId = this.entityParams.get(entityId)![index];
        this.system.set_param(paramId, value);
        const cache = this.entityCache.get(entityId);
        if (cache !== undefined) cache[index] = value;
    }

    /**
     * Sets a real conic's rho without solving; the curve ops need it when a trim or an
     * extend reparametrizes the arc — the poles move through the point setters, the rho
     * through here.
     */
    setConicRho(entityId: number, rho: number): void {
        if (this.derivedEntities.has(entityId)) {
            throw new Error("An array instance's rho comes from the entity it copies");
        }
        if (this.isFixed(entityId)) {
            throw new Error("A fixed entity's rho cannot be changed");
        }
        if (this.entityTypes.get(entityId) !== "conic") {
            throw new Error(`Entity ${entityId} is not a conic`);
        }
        this.writeScalar(entityId, 6, rho);
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

    // ------------------------------------------------------------------ Arrays

    /** The sketch's arrays, in id order — the definition, not the instances it lays out. */
    arrays(): SketchArrayData[] {
        return this.liveArrays().map(cloneArrayData);
    }

    /**
     * The records themselves, in id order — the solver's own rows, NOT copies. For readers
     * that take a number and are done before anything can move it: the canvas annotations and
     * the array tool's preview, which between them read this on every frame of a drag. Copying
     * there is not hypothetical waste — `cloneArrayData` round-trips JSON, and the per-frame
     * paths are many.
     *
     * Anything that *keeps* what it reads takes `arrays()`, whose copy is the whole point: the
     * serialized data, a command holding the record it opened on.
     */
    liveArrays(): readonly SketchArrayData[] {
        return [...this.arrayRecords.values()].sort((a, b) => a.id - b.id);
    }

    /**
     * One record as it stands, or `undefined` — the solver's own row, not a copy. The same
     * bargain as `liveArrays`, for the callers that name one array rather than reading them all.
     */
    arrayRecord(id: number): SketchArrayData | undefined {
        return this.arrayRecords.get(id);
    }

    /** The array an instance belongs to, or `undefined` for an entity the user made. */
    arrayOf(entityId: number): SketchArrayData | undefined {
        for (const data of this.arrayRecords.values()) {
            if (liveInstanceIds(data).includes(entityId)) return cloneArrayData(data);
        }
        return undefined;
    }

    /**
     * Patterns `sourceIds` and lays the instances out. The record — not a set of constraints —
     * is what holds the pattern: garlic has no pattern constraint and no directed distance
     * other than along the sketch's own axes, so this is the only thing that can keep an
     * instance answering its seed.
     *
     * The caller solves and commits: the instances are placed here, and every later solve
     * places them again, but it is the commit that makes any of it undoable.
     */
    addArray(pattern: SketchArrayPattern, sourceIds: readonly number[]): Result<number> {
        const sources = this.arrayableSources(sourceIds);
        if (sources.length === 0) return Result.err("Nothing to array");
        const resolved = resolveArray(this, pattern, sources, this._scope);
        if (!resolved.isOk) return Result.err(resolved.error);
        const id = this.arrayIdSeq++;
        this.arrayRecords.set(id, { id, sourceIds: sources, pattern, instanceEntityIds: [] });
        this.refreshArrays();
        return Result.ok(id);
    }

    /**
     * Rewrites an array's definition. A pattern or a source list that changes only what the
     * instances *are* keeps their ids, so the regions keyed on them survive; a change of
     * sources re-lays the whole pattern, since the instances are ordered by source.
     *
     * A pattern that lays down nothing — one instance in total, which is the seed alone — is
     * not a pattern at all, so it removes the array. That is how a count field is also the
     * tool's way out.
     */
    updateArray(id: number, patch: ArrayPatch): Result<void> {
        const data = this.arrayRecords.get(id);
        if (data === undefined) return Result.err(`Unknown sketch array: ${id}`);
        if (patch.pattern !== undefined && arrayInstanceTotal(patch.pattern) < 2) {
            this.removeArray(id);
            return Result.ok(undefined);
        }
        const sources =
            patch.sourceIds === undefined ? data.sourceIds : this.arrayableSources(patch.sourceIds);
        if (sources.length === 0) return Result.err("Nothing to array");
        const pattern = patch.pattern ?? data.pattern;
        const resolved = resolveArray(this, pattern, sources, this._scope);
        if (!resolved.isOk) return Result.err(resolved.error);
        if (!sameIdList(sources, data.sourceIds)) this.dropArrayInstances(data);
        data.sourceIds = sources;
        data.pattern = pattern;
        this.refreshArrays();
        return Result.ok(undefined);
    }

    /** Removes the array and every instance it generated. */
    removeArray(id: number): void {
        const data = this.arrayRecords.get(id);
        if (data === undefined) return;
        this.dropArrayInstances(data);
        this.arrayRecords.delete(id);
        this.refreshDerivedEntities();
    }

    /**
     * Breaks the pattern: the record goes and its copies stay, as the sketch's own geometry —
     * told the seed's shape relations again, so that a copy which was a closed loop is still
     * one (`seedRelations`). What the record held together by re-deriving them on every solve,
     * they now hold themselves.
     *
     * They stop being derived along with it, which is the whole point: from here they can be
     * dragged, dimensioned and deleted one at a time, and the sketch's degrees of freedom go up
     * by what each copy is free to do — the rigid-body motion of a shape nothing else pins.
     * Answers how many relations were said again.
     *
     * The caller solves and commits, as with any other edit.
     */
    dissolveArray(id: number): number {
        const data = this.arrayRecords.get(id);
        if (data === undefined) return 0;
        const relations = seedRelations(this.constraintsData(), data.sourceIds);
        const sources = data.sourceIds.length;
        let added = 0;
        for (let index = 1; index < arrayInstanceTotal(data.pattern) && sources > 0; index++) {
            const copyOf = new Map<number, number>();
            for (let slot = 0; slot < sources; slot++) {
                const copy = data.instanceEntityIds[instanceFirstSlot(data, index) + slot];
                if (copy !== null) copyOf.set(data.sourceIds[slot], copy);
            }
            for (const relation of relations) {
                const moved = copyRelation(relation, copyOf);
                if (moved === undefined) continue;
                this.addConstraint(moved);
                added++;
            }
        }
        this.arrayRecords.delete(id);
        this.refreshDerivedEntities();
        return added;
    }

    /**
     * The array and instance an entity is one of, or `undefined` when the id is not an
     * instance's. What a delete asks *before* it acts: taking one instance out takes every
     * entity it is made of with it, so a caller holding several of them has to know they are
     * one request — and, once the first is out, the others are no longer findable.
     */
    instanceOf(entityId: number): { arrayId: number; index: number } | undefined {
        for (const data of this.arrayRecords.values()) {
            const index = instanceIndexOf(data, entityId);
            if (index !== undefined) return { arrayId: data.id, index };
        }
        return undefined;
    }

    /**
     * Takes the instance `entityId` is out of its pattern. The count is not touched: the
     * hole stays a hole, and raising the count later adds instances after the last one
     * rather than filling it in — Onshape's own rule for a deleted sketch-pattern
     * occurrence. Answers the instance index it took out, or `undefined` when the id is not
     * an instance's — which is also what a *sibling* id of an instance already taken out
     * answers, so a caller acting on several of them asks `instanceOf` first.
     *
     * The caller solves and commits, as with any other edit.
     */
    skipInstance(entityId: number): number | undefined {
        for (const data of [...this.arrayRecords.values()]) {
            const index = instanceIndexOf(data, entityId);
            if (index === undefined) continue;
            const from = instanceFirstSlot(data, index);
            for (let slot = from; slot < from + data.sourceIds.length; slot++) {
                // the entity goes here rather than in the refresh that follows: the hole is
                // what the record keeps, so the row the refresh would look for is already
                // gone by the time it reads the slots
                const id = data.instanceEntityIds[slot];
                if (id !== null && this.entityTypes.has(id)) this.dropEntity(id);
                data.instanceEntityIds[slot] = null;
            }
            this.refreshArrays();
            return index;
        }
        return undefined;
    }

    /**
     * The entities worth patterning out of `ids`: real geometry, each once, in the order
     * given. The datum and the external refs drop out — neither is geometry the solver may
     * copy — and so does an instance, which would otherwise read the pattern back into
     * itself.
     */
    private arrayableSources(ids: readonly number[]): number[] {
        const seen = new Set<number>();
        const sources: number[] = [];
        for (const id of ids) {
            if (seen.has(id) || isDatumEntityId(id) || isExternalEntityId(id)) continue;
            if (this.derivedEntities.has(id) || this.entityTypes.get(id) === undefined) continue;
            seen.add(id);
            sources.push(id);
        }
        return sources;
    }

    /**
     * Rebuilds every array's instances from its record: the ones already there are rewritten
     * in place, the ones the count now calls for are created, and the ones it no longer
     * wants are dropped. Runs at the end of every solve, which is what makes an instance
     * follow its seed, its reference and the document's parameters at once.
     *
     * An array whose pattern does not currently resolve is left exactly as it was: a
     * direction line dragged degenerate for a frame, or a parameter that only momentarily
     * fails, must not take the pattern — or the sketch — down with it.
     */
    private refreshArrays(): void {
        for (const data of this.arrayRecords.values()) {
            const resolved = resolveArray(this, data.pattern, data.sourceIds, this._scope);
            if (!resolved.isOk) continue;
            data.instanceEntityIds = this.applyArrayInstances(
                data,
                arrayInstanceSpecs(this, data.sourceIds, resolved.value),
            );
        }
        this.refreshDerivedEntities();
    }

    /**
     * Brings the record's instances in line with `specs`, answering the ids in that same
     * *slot* order — a spec is one (instance, source) pair, so its position is the slot
     * `instanceEntityIds` is written in and a `null` there is an instance taken out of the
     * pattern. Pairing slot to slot is what keeps an instance's id its own for good.
     */
    private applyArrayInstances(
        data: SketchArrayData,
        specs: readonly ArrayInstanceSpec[],
    ): (number | null)[] {
        const existing = data.instanceEntityIds;
        const ids: (number | null)[] = new Array<number | null>(specs.length).fill(null);
        const kept = new Set<number>();
        specs.forEach((spec, slot) => {
            const id = existing[slot];
            // the user took this instance out: the slot keeps its hole, and the entity the
            // next solve would otherwise lay down stays gone
            if (id === null) return;
            if (id !== undefined && this.canRewriteInstance(id, spec)) {
                this.rewriteInstance(id, spec);
                kept.add(id);
                ids[slot] = id;
                return;
            }
            // a missing instance, or one the seed has since changed shape out from under:
            // the id is abandoned rather than reused, like every other freed id here
            ids[slot] = this.createInstance(spec);
        });
        for (const id of existing) {
            if (id !== null && !kept.has(id)) this.dropEntity(id);
        }
        return ids;
    }

    /**
     * Whether a stored instance can be moved onto `spec` in place rather than re-made. The
     * type alone is not enough: a rewrite writes one point per pole of the spec into an
     * instance that was built from the *old* spec, so a list the instance is too short to
     * hold indexes past its end (`writePoint` refuses), and a NURBS has to still carry its
     * source's construction constants — the rewrite moves control points and never touches
     * the knots, so a re-knotted source is a different curve rather than a moved copy.
     */
    private canRewriteInstance(id: number, spec: ArrayInstanceSpec): boolean {
        if (this.entityTypes.get(id) !== spec.type) return false;
        const params = this.entityCache.get(id);
        if (params === undefined || params.length !== spec.params.length) return false;
        if (spec.type !== "nurbs") return true;
        return sameNurbsSpec(this.entityNurbs.get(id), spec.nurbs);
    }

    /** Moves an instance onto its placement, and its construction flag onto its seed's. */
    private rewriteInstance(id: number, spec: ArrayInstanceSpec): void {
        const entity: SketchEntityData = { id, type: spec.type, params: spec.params };
        entityPoints(entity).forEach(([u, v], pointIndex) => {
            this.writePoint({ entityId: id, pointIndex }, u, v);
        });
        // a circle keeps its radius in a param of its own; an arc's is ‖start − centre‖ and
        // comes along with the points; a conic's rho is a scalar param the same way, and a
        // nurbs' weights are params of their own past the control points
        if (spec.type === "circle") this.writeRadius(id, spec.params[2]);
        if (spec.type === "conic") this.writeScalar(id, 6, spec.params[6]);
        if (spec.type === "nurbs") this.writeWeights(id, nurbsWeights(spec.params));
        this.setConstruction(id, spec.construction);
    }

    /**
     * Writes a NURBS' rational weights in place. Like a circle's radius they live in params
     * of their own — past the control points — so the point setters never reach them.
     */
    private writeWeights(entityId: number, weights: readonly number[]): void {
        const params = this.entityParams.get(entityId);
        const cache = this.entityCache.get(entityId);
        if (params === undefined || cache === undefined) return;
        const poles = nurbsPoleCount(cache);
        for (let i = 0; i < poles && i < weights.length; i++) {
            this.system.set_param(params[poles * 2 + i], weights[i]);
            cache[poles * 2 + i] = weights[i];
        }
    }

    /**
     * Adds an entity of `type` laid out the way `SketchEntityData` carries it — the one
     * place that reads a params vector as an entity, shared by every caller that holds
     * geometry in that form rather than a call per point (an array instance, a mirrored
     * copy). The types that carry structure — `arc`, `ellipse`, `ellipseArc` — get it, as
     * their own `add*` would apply it; a NURBS' `nurbs` are its source's construction
     * constants, which a similarity leaves alone and which cannot be defaulted here.
     */
    addEntityFromParams(
        type: SketchEntityType,
        params: readonly number[],
        nurbs?: NurbsSpec,
        offset?: OffsetCurveRef,
    ): number {
        const [x1, y1, x2, y2, x3, y3] = params;
        switch (type) {
            case "offsetCurve":
                // nothing of it is a solver parameter: its geometry is its source's, read
                // live, so it is registered with none and only the ref is kept
                if (offset === undefined) throw new Error("An offset curve needs its source");
                return this.registerEntity("offsetCurve", [], undefined, undefined, offset);
            case "line":
                return this.addLine(x1, y1, x2, y2);
            case "circle":
                return this.addCircle(x1, y1, x2);
            case "arc":
                return this.addArc(x1, y1, x2, y2, x3, y3);
            case "ellipse":
                return this.addEllipse(x1, y1, x2, y2, x3, y3);
            case "ellipseArc":
                return this.addEllipseArc(x1, y1, x2, y2, x3, y3, params[6], params[7], params[8], params[9]);
            case "conic":
                return this.addConic(x1, y1, x2, y2, x3, y3, params[6]);
            case "bezier":
                return this.addBezier(params);
            case "nurbs": {
                if (nurbs === undefined) {
                    throw new Error("A nurbs entity needs its curve's construction constants");
                }
                return this.addNurbs(nurbsPoleValues(params), nurbs, nurbsWeights(params));
            }
        }
    }

    /** One new instance, with the construction flag it came in with. */
    private createInstance(spec: ArrayInstanceSpec): number {
        const id = this.addEntityFromParams(spec.type, spec.params, spec.nurbs);
        this.setConstruction(id, spec.construction);
        return id;
    }

    /** Drops every instance the record holds, leaving the record itself intact. */
    private dropArrayInstances(data: SketchArrayData): void {
        for (const id of liveInstanceIds(data)) {
            if (this.entityTypes.has(id)) this.dropEntity(id);
        }
        data.instanceEntityIds = [];
    }

    private refreshDerivedEntities(): void {
        this.derivedEntities.clear();
        for (const id of this.entityOffsets.keys()) {
            if (this.entityTypes.has(id)) this.derivedEntities.add(id);
        }
        for (const data of this.arrayRecords.values()) {
            for (const id of liveInstanceIds(data)) {
                if (this.entityTypes.has(id)) this.derivedEntities.add(id);
            }
        }
    }

    /**
     * Takes a persisted record into the live map, if it still has anything to resolve against.
     * The instances are already loaded as ordinary entities like every other row — all this
     * says is which of them are derived and what generates them; the solve that closes
     * `loadData` then re-derives their geometry, which is what reconciles a record whose
     * persisted instances and count have drifted apart (a hand-edited document).
     *
     * A record with no sources, with references that are gone, or reading another array's
     * instances as its own sources, is dropped: a load has no repair to offer, and the next
     * commit writes the sketch without it.
     */
    private loadArray(data: SketchArrayData): void {
        if (arrayInstanceTotal(data.pattern) < 2 || data.sourceIds.length === 0) return;
        if (!data.sourceIds.every((id) => this.entityTypes.has(id) && !this.derivedEntities.has(id))) {
            return;
        }
        const references = arrayReferenceIds(data.pattern);
        if (!references.every((id) => isDatumEntityId(id) || this.entityTypes.has(id))) return;
        this.arrayRecords.set(data.id, cloneArrayData(data));
        this.arrayIdSeq = Math.max(this.arrayIdSeq, data.id + 1);
        for (const id of liveInstanceIds(data)) {
            if (this.entityTypes.has(id)) this.derivedEntities.add(id);
        }
    }

    /**
     * Takes `id` out of every array. As a source it leaves the pattern, and the instances it
     * carried go with it — the remaining ones are re-laid on the next refresh, since they are
     * ordered by source. As a reference (a direction line, a centre, a curve) it leaves the
     * pattern with nothing to lay out at all, so the whole array goes: an array pointing at
     * geometry that is no longer there is not something to keep.
     *
     * An id stops existing in two ways, and this is the one that has to unwire the arrays by
     * hand: `removeEntity` reaches it, and an external reference reaches it through
     * `detachEntityReferences` — an external's constraints cascade on their own, but an array
     * holds its reference by id alone.
     */
    private detachFromArrays(id: number): void {
        for (const data of [...this.arrayRecords.values()]) {
            if (arrayReferenceIds(data.pattern).includes(id)) {
                this.removeArray(data.id);
                continue;
            }
            const remaining = data.sourceIds.filter((source) => source !== id);
            if (remaining.length === data.sourceIds.length) continue;
            this.dropArrayInstances(data);
            data.sourceIds = remaining;
            if (remaining.length === 0) this.arrayRecords.delete(data.id);
        }
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
        // the arrays come last: the seeds are only settled once the solver is, and an
        // instance carries no constraints of its own, so placing one is not something to
        // solve for — it is where the seed's solved position puts it
        this.refreshArrays();
        return {
            result: report.result,
            dofs: this.dofCount(),
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
            if (ref === undefined || this.isFixed(ref.entityId)) continue;
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
            case ConstraintKind.PointOnEllipse:
            case ConstraintKind.PointOnConic:
            case ConstraintKind.PointOnBezier:
            case ConstraintKind.PointOnNurbs:
                return this.projectOntoCurve(record, u, v);
            default:
                return undefined;
        }
    }

    /**
     * Nearest position on the numeric curve an incidence constraint pins its point
     * to. An ellipseArc's manifold is its whole ellipse — garlic reads only the c/m/n
     * params — so the projection runs on the unswept curve. The projection also re-seeds
     * the constraint's aux contact t, keeping the next solve near where the point is.
     */
    private projectOntoCurve(record: ConstraintRecord, u: number, v: number): [number, number] | undefined {
        const entityId = record.refs[1].entityId;
        const type = this.entityTypes.get(entityId);
        const params = this.entityCache.get(entityId);
        if (type === undefined || params === undefined) return undefined;
        const curve: CurveEntity =
            type === "ellipseArc"
                ? { type: "ellipse", params: params.slice(0, 6) }
                : { type, params, nurbs: this.entityNurbs.get(entityId) };
        if (curve.type === "line" || curve.type === "circle" || curve.type === "arc") return undefined;
        const projection = projectPoint(curve, [u, v]);
        const aux = record.auxParamIds?.[0];
        if (aux !== undefined) this.system.set_param(aux, projection.t);
        return projection.point;
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
        return this.dofCount();
    }

    /**
     * garlic's free-parameter count, less the ones an array instance holds. Nothing
     * constrains an instance — the record places it — so garlic counts its parameters as
     * free and would report a pattern of five as five times freer than it is. They are not
     * the user's to move either way: the status bar is answering "how much of this sketch is
     * still mine to place", and an instance never is.
     */
    private dofCount(): number {
        return this.system.dofs() - this.derivedFreeParams();
    }

    /** How many of garlic's free parameters belong to array instances — see `dofCount`. */
    private derivedFreeParams(): number {
        if (this.derivedEntities.size === 0) return 0;
        const free = new Set(this.system.free_param_ids());
        let count = 0;
        for (const id of this.derivedEntities) {
            for (const paramId of this.entityParams.get(id) ?? []) {
                if (free.has(paramId)) count++;
            }
        }
        return count;
    }

    /**
     * The entity ids every one of whose parameters is pinned by the constraints. This is
     * garlic's row-space test (`free_param_ids`), not a residual or numeric one: it is
     * exact, needs no solve, and stays correct in singular configurations where probing
     * the solver's behaviour would not. Fixed entities (the datum, external refs) are
     * pinned by construction and so come back in the set, and so do the array instances:
     * they carry no constraints at all, but the record determines every one of their
     * parameters, and a derived entity that read as free would be a colouring that lies.
     *
     * This is what the sketch editor colours by — fully constrained reads in the default
     * edge colour, anything else in `VisualConfig.sketchFreeColor`.
     */
    fullyConstrainedEntities(): ReadonlySet<number> {
        const free = new Set(this.system.free_param_ids());
        const pinned = new Set<number>(this.derivedEntities);
        for (const [id, paramIds] of this.entityParams) {
            if (paramIds.every((paramId) => !free.has(paramId))) pinned.add(id);
        }
        return pinned;
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
            // is showing beside it (see `SketchEditor.publishSolveStatus`). An array's
            // instances come off it the same way they come off `dofCount`, so the count
            // the panel shows is the sketch the user can still place.
            dofs: report.dofs - this.derivedFreeParams(),
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
                ...this.offsetGeometry(id, params),
                // emitted only when set — a sketch without construction geometry or a
                // NURBS must round-trip byte-identical (no phantom history entry)
                ...(this.constructionEntities.has(id) ? { construction: true } : {}),
                ...(this.entityNurbs.has(id) ? { nurbs: this.copyNurbsSpec(id) } : {}),
            }));
    }

    /**
     * An entity's geometry as its readers see it: its own params, or — for an offset curve —
     * the params and spec of the source it follows, read *now*.
     */
    private offsetGeometry(
        id: number,
        params: number[],
    ): { params: number[]; nurbs?: NurbsSpec; offset?: OffsetCurveRef } {
        const offset = this.entityOffsets.get(id);
        if (offset === undefined) return { params: [...params] };
        const source = this.entityCache.get(offset.sourceId);
        return {
            params: source === undefined ? [] : [...source],
            // The spec travels with the params: both are the source's, and a copy has no
            // geometry of its own to be read with a spec of its own. Without this a copy of a
            // NURBS reads as the *default* clamped uniform curve of that many poles — a
            // different curve wherever the source's knots are not the default ones.
            ...(this.entityNurbs.has(offset.sourceId) ? { nurbs: this.copyNurbsSpec(offset.sourceId) } : {}),
            offset: copyOffsetRef(offset),
        };
    }

    /** Current data of one entity, or undefined when unknown. Datum axes answer synthetic line data. */
    entity(id: number): SketchEntityData | undefined {
        if (id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID) return datumEntityData(id);
        const type = this.entityTypes.get(id);
        const params = this.entityCache.get(id);
        if (type === undefined || params === undefined) return undefined;
        return {
            id,
            type,
            ...this.offsetGeometry(id, params),
            ...(this.entityNurbs.has(id) ? { nurbs: this.copyNurbsSpec(id) } : {}),
        };
    }

    /** The stored construction constants, copied — the caller's to keep or change. */
    private copyNurbsSpec(id: number): NurbsSpec {
        const spec = this.entityNurbs.get(id)!;
        return { degree: spec.degree, knots: [...spec.knots] };
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
            case "ellipseArc":
                return [this.pointOf({ entityId, pointIndex: 3 }), this.pointOf({ entityId, pointIndex: 4 })];
            case "conic":
                return [this.pointOf({ entityId, pointIndex: 0 }), this.pointOf({ entityId, pointIndex: 2 })];
            case "bezier":
                return [this.pointOf({ entityId, pointIndex: 0 }), this.pointOf({ entityId, pointIndex: 3 })];
            case "nurbs": {
                // a clamped curve interpolates its first and last control point, which is
                // what makes them its ends
                const last = nurbsPoleCount(this.entityCache.get(entityId) ?? []) - 1;
                return [
                    this.pointOf({ entityId, pointIndex: 0 }),
                    this.pointOf({ entityId, pointIndex: last }),
                ];
            }
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
                if (this.isFixed(r.entityId)) continue;
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
            if (record.refs.some((r) => this.isFixed(r.entityId))) continue;
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
                if (this.isFixed(r.entityId)) continue;
                for (const id of this.pointParamIds(r)) {
                    paramIds.add(id);
                }
            }
        }
        this.draggedParamIds = [...paramIds];
        this.system.mark_dragged(new Uint32Array(this.draggedParamIds));
    }

    dragTo(ref: SketchPointRef, u: number, v: number): SolveOutcome {
        const group = this.coincidentGroup(ref).filter((r) => !this.isFixed(r.entityId));
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
            result.constraintIdSeq = this.constraintIdSeq;
        }
        // the arrays' *instances* are already in `entities` above — they are real geometry,
        // and an arc instance's structural PointOnArc has to round-trip by id with it. What
        // this carries is the definition they are rebuilt from; like the counters, it is
        // emitted only once it means something
        if (this.arrayRecords.size > 0) result.arrays = this.arrays();
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
        // a spec the new state has no NURBS for would otherwise ride along on its id: the
        // reload may hand that id to any entity, and the stale knots would be its curve
        this.entityNurbs.clear();
        this.entityOffsets.clear();
        this.weightPins.clear();
        this.constraints.clear();
        this.fixedEntities.clear();
        this.constructionEntities.clear();
        this.arrayRecords.clear();
        this.derivedEntities.clear();
        this.external.clear();
        this.entityIdSeq = 1;
        this.constraintIdSeq = 1;
        this.arrayIdSeq = 1;
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
        this.unpinNurbsWeights(id);
        this.entityTypes.delete(id);
        this.entityParams.delete(id);
        this.entityCache.delete(id);
        this.entityNurbs.delete(id);
    }

    setFixed(id: number, fixed: boolean): void {
        if (fixed) this.fixedEntities.add(id);
        else this.fixedEntities.delete(id);
    }

    /** `ExternalEntityHost`: the serialization gate — see `idAllocatedSinceLoad`. */
    markIdAllocated(): void {
        this.idAllocatedSinceLoad = true;
    }

    /** `ExternalEntityHost`: an external's id reaches the arrays the way a sketch entity's does. */
    detachEntityReferences(id: number): void {
        this.detachFromArrays(id);
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

    private registerEntity(
        type: SketchEntityType,
        paramIds: number[],
        id?: number,
        nurbs?: NurbsSpec,
        offset?: OffsetCurveRef,
    ): number {
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
        // copied: the spec is the caller's object, and the entity's own outlives it
        if (nurbs !== undefined)
            this.entityNurbs.set(entityId, { degree: nurbs.degree, knots: [...nurbs.knots] });
        if (offset !== undefined) {
            this.entityOffsets.set(entityId, copyOffsetRef(offset));
            // derived, like an array's instances: the user's to constrain and to delete, but
            // not to edit — its geometry is the entity it came from
            this.derivedEntities.add(entityId);
        }
        return entityId;
    }

    private addConstraintWithId(id: number, constraint: Omit<SketchConstraintData, "id">): void {
        // Explicit ids (loadData, replaceConstraint, the retype's re-creations) still
        // advance the counter, so a later allocation never reissues them — that is what
        // `retypeEntity` relies on when it re-adds the captured constraints and then
        // asks the allocator for the arc's structural PointOnArc.
        this.constraintIdSeq = Math.max(this.constraintIdSeq, id + 1);
        const { params, datumParamIds, datumSources, auxParamIds, nurbs, garlicKind } =
            this.buildConstraintParams(constraint, id);
        // `driving` is garlic's own flag: true means the datum is an input, false means it
        // is the write-back target of a reference dimension. A constraint with no datum
        // must stay driving — garlic refuses the other way round.
        const garlicId = this.system.add_constraint(
            garlicKind ?? constraint.kind,
            new Uint32Array(params),
            null,
            constraint.driven !== true,
            0,
            null,
            nurbs ?? null,
        );
        this.constraints.set(id, {
            id,
            kind: constraint.kind,
            refs: constraint.refs.map((r) => ({ ...r })),
            garlicId,
            datumParamIds,
            datumSources,
            auxParamIds,
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
        if (AUX_CURVE_CONSTRAINTS.has(constraint.kind)) return this.curveConstraintParams(constraint);
        return { params: this.geometricConstraintParams(constraint) };
    }

    /**
     * The garlic params of a constraint against a conic, bezier, nurbs or a curve pair —
     * the kinds carrying auxiliary contact parameters t. Each aux is created here, seeded
     * from the current geometry (a projection, a closest pair), and owned by the
     * constraint: `removeConstraint` disposes of them, and a reload re-seeds them from
     * whatever geometry it finds, so the persisted sketch never mentions them.
     */
    private curveConstraintParams(constraint: Omit<SketchConstraintData, "id">): ConstraintParams {
        const { refs } = constraint;
        switch (constraint.kind) {
            case ConstraintKind.PointOnConic:
            case ConstraintKind.PointOnBezier:
            case ConstraintKind.PointOnNurbs:
                return this.pointOnCurveParams(refs);
            case ConstraintKind.TangentLineConic:
            case ConstraintKind.TangentLineBezier:
            case ConstraintKind.TangentLineNurbs:
                return this.lineTangentCurveParams(refs);
            default:
                return this.curvePairParams(refs);
        }
    }

    /** A point held on a curve: the point, the curve, and its one contact parameter. */
    private pointOnCurveParams(refs: readonly SketchPointRef[]): ConstraintParams {
        const curveId = refs[1].entityId;
        const aux = this.addAuxParams([this.seedCurveParameter(curveId, this.pointOf(refs[0]))]);
        return {
            params: [...this.pointParams(refs[0]), ...this.curveCoreParamIds(curveId), ...aux],
            auxParamIds: aux,
            nurbs: this.nurbsSpecsOf([curveId]),
        };
    }

    /**
     * A line tangent to a curve. The contact is unknown before the first solve, so its
     * parameter is seeded from the line's midpoint projected on the curve — the closest
     * cheap guess at where the two will meet.
     */
    private lineTangentCurveParams(refs: readonly SketchPointRef[]): ConstraintParams {
        const [ax, ay] = this.pointOf(refs[0]);
        const [bx, by] = this.pointOf(refs[1]);
        const curveId = refs[2].entityId;
        const aux = this.addAuxParams([this.seedCurveParameter(curveId, [(ax + bx) / 2, (ay + by) / 2])]);
        return {
            params: [...this.lineParams(refs[0], refs[1]), ...this.curveCoreParamIds(curveId), ...aux],
            auxParamIds: aux,
            nurbs: this.nurbsSpecsOf([curveId]),
        };
    }

    /**
     * A curve-curve tangency: refs are [{A, 0}, {B, 0}], the garlic layout is
     * [curve1…, t1, curve2…, t2], and the two contact parameters are seeded from the curves'
     * closest pair — which is the point the user drew them meeting at.
     */
    private curvePairParams(refs: readonly SketchPointRef[]): ConstraintParams {
        const [first, second] = [refs[0].entityId, refs[1].entityId];
        const [tA, tB] = this.seedCurvePairParameters(first, second);
        const aux = this.addAuxParams([tA, tB]);
        return {
            params: [...this.curveCoreParamIds(first), aux[0], ...this.curveCoreParamIds(second), aux[1]],
            auxParamIds: aux,
            nurbs: this.nurbsSpecsOf([first, second]),
        };
    }

    /**
     * The `nurbs` argument garlic's curve kinds take: one construction-constants entry per
     * NURBS segment, in the constraint's own canonical curve order (nurbs is the last
     * family, so the segment list is the NURBS members of the curve list, in order).
     * `undefined` for a constraint with no NURBS in it — garlic wants the argument absent
     * rather than empty there.
     */
    private nurbsSpecsOf(entityIds: readonly number[]): NurbsSpec[] | undefined {
        const specs = entityIds
            .filter((id) => this.entityTypes.get(id) === "nurbs")
            .map((id) => this.nurbsSpecOf(id));
        return specs.length === 0 ? undefined : specs;
    }

    /** Dimensionless aux params for a constraint's contact t's, seeded with `values`. */
    private addAuxParams(values: readonly number[]): number[] {
        const ids = this.system.add_params(
            new Uint8Array(values.length).fill(PARAM_KIND_DIMENSIONLESS),
            new Float64Array(values),
        );
        return Array.from(ids);
    }

    /** The entity as the curve data `curveEval` reads: its type and current params. */
    private curveDataOf(entityId: number): CurveEntity {
        const type = this.entityTypes.get(entityId);
        const params = this.entityCache.get(entityId);
        if (type === undefined || params === undefined) {
            throw new Error(`Unknown sketch entity: ${entityId}`);
        }
        // a NURBS is only the curve its knots say it is: without them the numeric read
        // would fall back to the default structure and seed a t on another curve
        return { type, params, nurbs: this.entityNurbs.get(entityId) };
    }

    /** t seed for a point-on/tangent against a conic, bezier or nurbs: the point's projection. */
    private seedCurveParameter(entityId: number, point: [number, number]): number {
        return projectPoint(this.curveDataOf(entityId), point).t;
    }

    /** t1/t2 seeds for a curve-curve tangency: the curves' closest pair. */
    private seedCurvePairParameters(firstId: number, secondId: number): [number, number] {
        const pair = closestCurvePair(this.curveDataOf(firstId), this.curveDataOf(secondId));
        return [pair.tA, pair.tB];
    }

    /**
     * The garlic params a tangent/point-on kind reads for one curve of a pair, by family:
     * circle [c, r], arc [c, s], the ellipse family [c, m, n] (an ellipseArc reads as its
     * ellipse — the sweep params are not part of the layout), conic [s, c, e, rho] and the
     * free curves (bezier, nurbs) their whole param list, control points then weights.
     */
    private curveCoreParamIds(entityId: number): number[] {
        const type = this.entityTypes.get(entityId);
        const params = this.entityParams.get(entityId);
        if (type === undefined || params === undefined) {
            throw new Error(`Unknown sketch entity: ${entityId}`);
        }
        switch (type) {
            case "circle":
                return [...params];
            case "arc":
                return params.slice(0, 4);
            case "ellipse":
            case "ellipseArc":
                return params.slice(0, 6);
            case "conic":
            case "bezier":
            case "nurbs":
                return [...params];
            default:
                throw new Error(`Entity ${entityId} is not a curve pair member: ${type}`);
        }
    }

    /**
     * The construction constants a NURBS entity is constrained with — its own, or the
     * clamped uniform default for one whose stored pair does not fit its pole count
     * (hand-edited data). Read through `curveEval.nurbsSpec`, the same call the evaluation
     * makes: a t seed and the solve it seeds must not be talking about two curves.
     */
    private nurbsSpecOf(entityId: number): NurbsSpec {
        const type = this.entityTypes.get(entityId);
        const params = this.entityCache.get(entityId);
        if (type !== "nurbs" || params === undefined) {
            throw new Error(`Entity ${entityId} is not a nurbs`);
        }
        return specOf({ type, params, nurbs: this.entityNurbs.get(entityId) });
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
            case ConstraintKind.PointOnEllipse:
                return [...this.pointParams(refs[0]), ...this.ellipseCoreParamIds(refs[1].entityId)];
            case ConstraintKind.TangentLineEllipse:
                return [...this.lineParams(refs[0], refs[1]), ...this.ellipseCoreParamIds(refs[2].entityId)];
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
            case ConstraintKind.ConicRho:
                return this.withDatum(
                    [this.conicRhoParamId(refs[0].entityId)],
                    id,
                    constraint,
                    () => this.entityCache.get(refs[0].entityId)![6],
                    PARAM_KIND_DIMENSIONLESS,
                );
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
        paramKind: number = PARAM_KIND_LENGTH,
    ): ConstraintParams {
        if (constraint.driven === true) {
            const value = fallback();
            const carried = typeof constraint.datum === "string" ? constraint.datum : value;
            return this.withDatums(params, [{ source: carried, value }], paramKind);
        }
        return this.withDatums(
            params,
            [this.datumOf(id, constraint.kind, constraint.datum, fallback, constraint.display)],
            paramKind,
        );
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

    private withDatums(
        params: number[],
        datums: readonly DatumValue[],
        paramKind: number = PARAM_KIND_LENGTH,
    ): ConstraintParams {
        const datumParamIds = datums.map((datum) => this.createDatumParam(datum.value, paramKind));
        return {
            params: [...params, ...datumParamIds],
            datumParamIds,
            datumSources: datums.map((datum) => datum.source),
        };
    }

    createDatumParam(value: number, kind: number = PARAM_KIND_LENGTH): number {
        return Number(this.system.add_params(new Uint8Array([kind]), new Float64Array([value]))[0]);
    }

    /**
     * [l1.p1, l1.p2, l2.p1, l2.p2] param ids for two-line constraints. garlic reads four bare
     * points and keeps no entity table to check them against, so what makes a pair of them a
     * *segment* is checked here.
     *
     * Two lines' points make one whichever lines they are — that is what these kinds are for,
     * and the offset's own connector runs between a source and its copy. Anything that is not
     * a line has to bring *its own* two points: a free curve's control points are a segment of
     * its own (the bezier tool's chain holds its joints by stating the handles either side of
     * one as parallel), as are an ellipse's frame points (its structural perpendicularity is a
     * Perpendicular on [center, major] × [center, minor]). A ref that is neither — a circle's
     * centre, an arc's radius point, a pair spanning two such entities — is the mistargeted
     * Parallel/Perpendicular/EqualLength the guard is here to catch.
     */
    private twoLineParams(refs: SketchPointRef[]): number[] {
        return [
            ...this.segmentPointParamIds(refs[0], refs[1]),
            ...this.segmentPointParamIds(refs[2], refs[3]),
        ];
    }

    /** One segment of a two-line constraint: two points of one line, or two of one entity. */
    private segmentPointParamIds(
        first: SketchPointRef,
        second: SketchPointRef,
    ): [number, number, number, number] {
        const lineLike = (ref: SketchPointRef) =>
            isDatumEntityId(ref.entityId) || this.entityTypes.get(ref.entityId) === "line";
        const ownTwoPoints = first.entityId === second.entityId && first.pointIndex !== second.pointIndex;
        if (!ownTwoPoints && !(lineLike(first) && lineLike(second))) {
            throw new Error(
                `Entity ${second.entityId} is not a line with ${first.entityId}: a segment's two points are one entity's`,
            );
        }
        return [...this.pointParamIds(first), ...this.pointParamIds(second)];
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

    /**
     * The ellipse family's six core params (c, m, n) of an ellipse or ellipseArc — the
     * layout PointOnEllipse and TangentLineEllipse read. An ellipseArc answers its
     * ellipse: its sweep params sit past the six.
     */
    private ellipseCoreParamIds(entityId: number): number[] {
        const type = this.entityTypes.get(entityId);
        if (type !== "ellipse" && type !== "ellipseArc") {
            throw new Error(`Entity ${entityId} is not an ellipse`);
        }
        return this.entityParams.get(entityId)!.slice(0, 6);
    }

    /** A conic's rho param — what a ConicRho datum drives. */
    private conicRhoParamId(entityId: number): number {
        if (this.entityTypes.get(entityId) !== "conic") {
            throw new Error(`Entity ${entityId} is not a conic`);
        }
        return this.entityParams.get(entityId)![6];
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
        if (type === "ellipse" && ref.pointIndex >= 0 && ref.pointIndex <= 2) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "ellipseArc" && ref.pointIndex >= 0 && ref.pointIndex <= 4) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "conic" && ref.pointIndex >= 0 && ref.pointIndex <= 2) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "bezier" && ref.pointIndex >= 0 && ref.pointIndex <= 3) {
            return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
        }
        if (type === "nurbs") {
            // a nurbs' poles are the params' first two thirds; the weights past them are
            // not points (see `entityPointCount`)
            const poleCount = nurbsPoleCount(this.entityCache.get(ref.entityId) ?? []);
            if (ref.pointIndex >= 0 && ref.pointIndex < poleCount) {
                return [ref.pointIndex * 2, ref.pointIndex * 2 + 1];
            }
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

    /**
     * Takes one stored entity into the live tables, repaired where the data cannot be read as
     * it stands: a NURBS' params are read as whole poles (`normalizeNurbsParams`) and its
     * structure is the fitted one when what was stored does not describe those poles — the
     * clamped uniform default every read falls back to, so the entity that comes back says
     * what it is rather than claiming a structure it cannot be evaluated with.
     */
    private loadEntity(entity: SketchEntityData): void {
        if (entity.type === "offsetCurve") {
            // Its params are its source's, not a solver parameter of its own: what is stored is
            // the ref, and the geometry is read through it (`offsetGeometry`), so a document
            // that has drifted is repaired by its source rather than by a normalizer.
            if (entity.offset === undefined) return;
            this.registerEntity("offsetCurve", [], entity.id, undefined, entity.offset);
            if (entity.construction === true) this.constructionEntities.add(entity.id);
            return;
        }
        const values = entity.type === "nurbs" ? normalizeNurbsParams(entity.params) : entity.params;
        const spec =
            entity.type === "nurbs"
                ? specOf({ type: "nurbs", params: values, nurbs: entity.nurbs })
                : undefined;
        this.registerEntity(entity.type, this.addEntityParams(entity.type, values), entity.id, spec);
        this.pinNurbsWeights(entity.id);
        if (entity.construction === true) this.constructionEntities.add(entity.id);
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
            this.loadEntity(entity);
        }
        // the arrays come after the entities they read — the instances among them are already
        // registered above, and all this does is say which of those rows are derived; the
        // solve at the end of this method is what re-derives their geometry
        for (const array of data.arrays ?? []) {
            this.loadArray(array);
        }
        for (const constraint of data.constraints) {
            this.addConstraintWithId(constraint.id, constraint);
        }
        // id counters: trust the serialized ones; data written before counters
        // initializes from the current max+1 / min-1 via the seeding above
        if (data.entityIdSeq !== undefined) this.entityIdSeq = Math.max(this.entityIdSeq, data.entityIdSeq);
        if (data.constraintIdSeq !== undefined) {
            this.constraintIdSeq = Math.max(this.constraintIdSeq, data.constraintIdSeq);
        }
        if (data.externalIdSeq !== undefined) {
            this.external.idSeq = Math.min(this.external.idSeq, data.externalIdSeq);
        }
        this.idCountersPersisted =
            data.entityIdSeq !== undefined ||
            data.externalIdSeq !== undefined ||
            data.constraintIdSeq !== undefined;
        this.idAllocatedSinceLoad = false;
        // normalize roles for documents written before role derivation (and for
        // hand-edited data): an unpinned ref any constraint references is a profile
        syncExternalRoles({ constraints: data.constraints, externalRefs: [...this.external.refs] });
        this.solve(true);
    }

    private addEntityParams(type: SketchEntityType, values: number[]): number[] {
        const ids = this.system.add_params(
            new Uint8Array(entityParamKinds(type, values.length)),
            new Float64Array(values),
        );
        return Array.from(ids);
    }
}
