// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    LENGTH_UNITS,
    type ParameterValue,
    Precision,
    Result,
    resolveUnitSpec,
    type Scope,
} from "@chili3d/core";
import { entityRadiusOf, isDegenerate, originAngle, parameterAt, pointAt } from "./curveGeometry";
import {
    ConstraintKind,
    isDatumEntityId,
    isExternalEntityId,
    isStructuralConstraint,
    type SketchArrayAxis,
    type SketchArrayCenter,
    type SketchArrayData,
    type SketchArrayPattern,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { type SketchTransform, transformBase, transformParams } from "./transformOps";

/**
 * The sketch array: placing copies of the selected entities along a direction, around a
 * centre, or along a curve.
 *
 * The geometry is the whole of what lives here — where instance i of an entity lands — and
 * it is written as *rigid transforms of the seed*, one per instance, fed through the
 * transform op's own `transformParams`. Moving the seed, the reference or a parameter is
 * then the same operation as the pattern itself, and the preview and the solver derive
 * their geometry through this one path, so a preview can never show an instance the sketch
 * would not build.
 *
 * What is *not* here is the record: an array keeps a `SketchArrayData` in `SketchData` and
 * the solver rebuilds its instances on every solve (`SketchSolver`'s `refreshArrays`).
 * Nothing ties an instance to its seed by constraint, because garlic has no pattern
 * constraint and no directed distance other than along the sketch's own axes — the record
 * is the tie, which is also why the instances it generates are read-only.
 */

/**
 * How many instances an array may ask for, the seed included. Every instance is rewritten
 * on every solve — a drag frame included — so the work has to be bounded by something.
 */
export const MAX_ARRAY_COUNT = 100;

/** An instance's placement: the rigid transform that carries the seed onto it. */
export interface ArrayPlacement {
    readonly index: number;
    readonly transform: SketchTransform;
}

/** One number as a canvas annotation shows it: what it is, what it says, where it sits. */
export interface ArrayNumber {
    /** What an edit of this number names. */
    readonly field: ArrayField;
    readonly value: number;
    /** Where the number's own label goes, in sketch (u, v). */
    readonly at: [number, number];
}

/**
 * One direction a pattern marches in: the line that measures it — drawn with the dimension
 * geometry — the number it steps by, and how many it lays down.
 *
 * A linear pattern has one of these per direction (a count of 1 leaves its direction out
 * entirely: there is nothing to draw and nothing to read), a circular one has its turn, and a
 * curve one the curve it follows. The spacing reads where its first step is, and the count
 * where the run ends, so the pair reads the way a dimension chain does.
 */
export interface ArrayRun {
    /** The step the run is placed by: sketch units for a length, degrees for a turn. */
    readonly spacing: ArrayNumber & { readonly measure: "length" | "angle" };
    /** How many instances the run lays down, the seed included. */
    readonly count: ArrayNumber;
    /**
     * The run itself, sampled evenly from where the seed sits to the last instance it reaches.
     * Straight along an axis, round a centre, or along the curve followed — in each case the
     * same path the placements are taken along, which is what makes the line measure what it
     * says. It starts at the seed's own place, a curve's offset and all, so the number a run
     * reads is the step its own instances take.
     */
    readonly path: readonly [number, number][];
}

/** A pattern with its references read off the solver and its numbers resolved. */
export interface ResolvedArray {
    /** What the instances turn about — the array's own pivot. */
    readonly base: [number, number];
    /** Instance i's transform, i = 1..count−1. Index 0 is the seed, which is not transformed. */
    readonly placements: readonly ArrayPlacement[];
    /** One per direction the pattern marches in — see `ArrayRun`. */
    readonly runs: readonly ArrayRun[];
}

/**
 * The id a canvas annotation of a *draft* answers by — a pattern a tool is in the middle of
 * making or changing, which is no record and must not be taken for one. Real array ids count up
 * from 1 (`SketchSolver`'s allocator), so nought is never taken.
 */
export const DRAFT_ARRAY_ID = 0;

/**
 * The pattern a tool is in the middle of making or changing: what the canvas draws while the
 * tool is up, in place of a record that either does not exist yet or does not yet hold what the
 * tool holds. Its numbers are written back through `set` — which is what double-clicking one of
 * its annotations does — and it lives only as long as the tool does.
 */
export interface ArrayDraft {
    readonly id: typeof DRAFT_ARRAY_ID;
    readonly pattern: SketchArrayPattern;
    /** The geometry being patterned — the selection, as the tool is reading it right now. */
    readonly sourceIds: readonly number[];
    /**
     * The record the tool is standing in for, when it opened on one: the canvas leaves that
     * record's own numbers out while its draft is up, so they are not drawn twice — once of
     * them stale until the confirm.
     */
    readonly editing?: number;
    set(field: ArrayField, value: ParameterValue): void;
}

/**
 * One of a pattern's numbers as it stands, or `undefined` when the field has no place in it.
 * The reading half of the pair `withField` writes: the canvas and the dialogs ask this what a
 * number is before they offer to change it.
 */
export function arrayFieldValue(pattern: SketchArrayPattern, field: ArrayField): ParameterValue | undefined {
    switch (field) {
        case "countX":
            return pattern.type === "linear" ? pattern.x.count : undefined;
        case "spacingX":
            return pattern.type === "linear" ? pattern.x.spacing : undefined;
        case "countY":
            return pattern.type === "linear" ? pattern.y.count : undefined;
        case "spacingY":
            return pattern.type === "linear" ? pattern.y.spacing : undefined;
        case "count":
            return pattern.type === "linear" ? undefined : pattern.count;
        case "twist":
            return pattern.type === "circular" ? pattern.twist : undefined;
        default:
            return pattern.type === "curve" ? pattern.spacing : undefined;
    }
}

/**
 * `pattern` with one number replaced: the writing half of the pair. A count is a whole number of
 * things and takes nothing else; everything else is whatever the field holds — a literal or an
 * expression — and a field the pattern's type has no place for leaves the pattern alone.
 */
export function withField(
    pattern: SketchArrayPattern,
    field: ArrayField,
    value: ParameterValue,
): SketchArrayPattern {
    switch (field) {
        case "countX":
        case "spacingX":
        case "countY":
        case "spacingY": {
            if (pattern.type !== "linear") return pattern;
            const axis = field === "countX" || field === "spacingX" ? pattern.x : pattern.y;
            const isCount = field === "countX" || field === "countY";
            const next = isCount
                ? { ...axis, count: wholeNumber(value, axis.count) }
                : { ...axis, spacing: value };
            return field === "countX" || field === "spacingX"
                ? { ...pattern, x: next }
                : { ...pattern, y: next };
        }
        case "count":
            return pattern.type === "linear"
                ? pattern
                : { ...pattern, count: wholeNumber(value, pattern.count) };
        case "twist":
            return pattern.type === "circular" ? { ...pattern, twist: value } : pattern;
        default:
            // a linear pattern's spacing belongs to one of its axes, never to the pattern itself
            return pattern.type === "curve" ? { ...pattern, spacing: value } : pattern;
    }
}

/** A count as a whole number of things, at least one — anything else keeps what the field had. */
function wholeNumber(value: ParameterValue, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
}

/** The fields of a record a re-edit may move; everything else about it is its identity. */
export type ArrayPatch = Partial<Pick<SketchArrayData, "pattern" | "sourceIds">>;

/**
 * One of an array's own numbers, as an edit names it — what a canvas annotation of that number
 * hands back when it is double-clicked. A linear pattern names both its directions, so its two
 * counts and two spacings are four fields of their own.
 */
export type ArrayField = "countX" | "spacingX" | "countY" | "spacingY" | "count" | "spacing" | "twist";

/**
 * How many instances a pattern lays down, the seed included — the one place the total is
 * worked out, since no count is stored beside the pattern's own.
 */
export function arrayInstanceTotal(pattern: SketchArrayPattern): number {
    switch (pattern.type) {
        case "linear":
            return axisTotal(pattern.x) * axisTotal(pattern.y);
        default:
            return pattern.count;
    }
}

/** Instances one direction lays down; a count of 1 or less is "this direction lays down none". */
function axisTotal(axis: SketchArrayAxis): number {
    return Math.max(1, axis.count);
}

/** A record's own copy — the solver hands them out, and nothing outside may hold the live one. */
export function cloneArrayData(data: SketchArrayData): SketchArrayData {
    return JSON.parse(JSON.stringify(data)) as SketchArrayData;
}

/** Whether two id lists hold the same ids in the same order. */
export function sameIdList(first: readonly number[], second: readonly number[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index]);
}

/**
 * The seed's own relations: the constraints that live wholly inside the pattern's sources —
 * every ref on geometry the seed itself is made of — and that say something about its *shape*.
 *
 * They are what a copy has to be told again when the pattern is broken, because a copy never
 * carried them: the record placed it, and a square whose four lines were only numerically
 * coincident comes apart at the corners the moment one of them is dragged.
 *
 * Three kinds of constraint are deliberately left out. A **dimension** is a reading of one
 * particular size, and giving every copy its own would bury the sketch in labels; what the
 * pattern was placed by is the pattern's business. A **Fix** pins geometry to the sketch's own
 * frame rather than to its neighbours, which is not a thing a copy inherits — it is where the
 * *seed* happens to be. And an arc's **structural** constraint is left out because every copy
 * already carries one of its own (`addArc` adds it as the entity is made).
 */
export function seedRelations(
    constraints: readonly SketchConstraintData[],
    sourceIds: readonly number[],
): SketchConstraintData[] {
    const sources = new Set(sourceIds);
    return constraints.filter(
        (constraint) =>
            !isStructuralConstraint(constraint) &&
            constraint.datum === undefined &&
            constraint.datums === undefined &&
            constraint.kind !== ConstraintKind.Fix &&
            constraint.refs.length > 0 &&
            constraint.refs.every((ref) => sources.has(ref.entityId)),
    );
}

/**
 * One of the seed's relations said again about a copy: its refs moved onto the copy's own
 * entities, its kind and any reading left alone. `undefined` when the copy is missing an
 * entity the relation names — an instance the user took out cannot hold the seed's structure
 * either, and half a relation is worse than none.
 */
export function copyRelation(
    relation: SketchConstraintData,
    copyOf: ReadonlyMap<number, number>,
): Omit<SketchConstraintData, "id"> | undefined {
    const refs: SketchPointRef[] = [];
    for (const ref of relation.refs) {
        const copy = copyOf.get(ref.entityId);
        if (copy === undefined) return undefined;
        refs.push({ entityId: copy, pointIndex: ref.pointIndex });
    }
    const { id: _id, ...rest } = relation;
    return { ...rest, refs };
}

/**
 * The instance an entity belongs to, or `undefined` when the id is not one of the record's
 * instances. A slot is `(instance, source)`, so the instance is the slot's own quotient —
 * and `null` slots are holes whose missing ids no live entity can be mistaken for.
 */
export function instanceIndexOf(data: SketchArrayData, entityId: number): number | undefined {
    const slot = data.instanceEntityIds.indexOf(entityId);
    const sources = data.sourceIds.length;
    return slot < 0 || sources === 0 ? undefined : 1 + Math.floor(slot / sources);
}

/**
 * The slot an instance's first entity sits in — `(instance − 1) × sources`. Taking an
 * instance out of a pattern means writing `null` over that whole run of slots.
 */
export function instanceFirstSlot(data: SketchArrayData, index: number): number {
    return Math.max(0, (index - 1) * data.sourceIds.length);
}

/** The ids a record still holds — its instances without the holes. */
export function liveInstanceIds(data: SketchArrayData): number[] {
    return data.instanceEntityIds.filter((id): id is number => id !== null);
}

/** One generated instance of one source entity, in the entity's own params layout. */
export interface ArrayInstanceSpec {
    /** The instance this belongs to (1 = the first copy); the seed itself is never here. */
    readonly index: number;
    readonly sourceId: number;
    readonly type: SketchEntityType;
    readonly params: number[];
    /** Whether the instance copies construction geometry. */
    readonly construction: boolean;
}

/** A literal is already in storage units; an expression is written in display units. */
function resolveLength(source: ParameterValue, scope: Scope): Result<number> {
    if (typeof source === "number") return Result.ok(source);
    return resolveUnitSpec(source, scope, LENGTH_UNITS);
}

/**
 * The same for an angle: the solver stores radians and the user writes degrees, so a literal
 * is converted and an expression is resolved in degrees and converted afterwards — the two
 * readings a constraint's angle datum takes (`toDatumSource` / `resolveDatumSource`).
 */
function resolveAngle(source: ParameterValue, scope: Scope): Result<number> {
    if (typeof source === "number") return Result.ok((source * Math.PI) / 180);
    const resolved = resolveUnitSpec(source, scope, ANGLE_UNITS);
    return resolved.isOk ? Result.ok((resolved.value * Math.PI) / 180) : Result.err(resolved.error);
}

/**
 * The tangent angle of `entity` at `s`, the position `parameterAt` speaks. Exact for all
 * three curve kinds rather than read off a chord: a line's tangent is its own direction, and
 * a circle's or an arc's turns a quarter counter-clockwise off the radius, since `s` grows
 * counter-clockwise.
 */
function tangentAngle(entity: SketchEntityData, s: number): number {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        return Math.atan2(y2 - y1, x2 - x1);
    }
    const radius = entityRadiusOf(entity);
    if (radius <= Precision.Distance) return 0;
    return originAngle(entity) + s / radius + Math.PI / 2;
}

/**
 * The seed read in the curve's own terms: how far along the curve its own place sits, and the
 * offset it keeps from the curve — which is the offset every instance of the pattern keeps too.
 */
interface CurveFrame {
    /** How far along the curve the seed's centre projects — where the run is measured from. */
    readonly from: number;
    /** The seed's centre less that point on the curve: how far off the curve the seed stands. */
    readonly offset: readonly [number, number];
}

/** The seed in the curve's own terms — see `CurveFrame`. */
function curveFrame(curve: SketchEntityData, base: readonly [number, number]): CurveFrame {
    const from = parameterAt(curve, [base[0], base[1]]);
    const [u, v] = pointAt(curve, from);
    return { from, offset: [base[0] - u, base[1] - v] };
}

/**
 * Where the pattern stands having followed the curve round to `s`: the point on the curve there,
 * plus the seed's own offset from it, turned by however far the curve's tangent has come round
 * since the seed's place. At `s` = the frame's own `from` this answers with the seed's centre
 * itself, which is what keeps the seed instance 0 of the run rather than a straggler beside it.
 */
function carriedPoint(curve: SketchEntityData, frame: CurveFrame, s: number): [number, number] {
    const [u, v] = pointAt(curve, s);
    const turn = tangentAngle(curve, s) - tangentAngle(curve, frame.from);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return [
        u + cos * frame.offset[0] - sin * frame.offset[1],
        v + sin * frame.offset[0] + cos * frame.offset[1],
    ];
}

/**
 * Where a curve pattern's instances go: the seed carried along the curve, a step of arc length
 * at a time, keeping the offset it stands off by and turning as the curve's tangent turns.
 *
 * A seed that is not on the curve therefore slides alongside it, the whole pattern holding the
 * one offset the seed itself has, rather than the seed being left behind while the instances
 * swing onto the curve. That is what SolidWorks' Transform curve method does with the same case:
 * the seed is a member of the pattern and is never moved, so the pattern has to move with it.
 */
function curvePlacements(
    curve: SketchEntityData,
    base: readonly [number, number],
    frame: CurveFrame,
    spacing: number,
    count: number,
): ArrayPlacement[] {
    const placements: ArrayPlacement[] = [];
    for (let index = 1; index < count; index++) {
        const s = frame.from + index * spacing;
        const [u, v] = carriedPoint(curve, frame, s);
        placements.push({
            index,
            transform: {
                du: u - base[0],
                dv: v - base[1],
                angle: tangentAngle(curve, s) - tangentAngle(curve, frame.from),
                scale: 1,
            },
        });
    }
    return placements;
}

/** One direction of a linear pattern as the straight line it measures, seed to last. */
function straightPath(
    seed: readonly [number, number],
    du: number,
    dv: number,
    steps: number,
): [number, number][] {
    return [
        [seed[0], seed[1]],
        [seed[0] + steps * du, seed[1] + steps * dv],
    ];
}

/** One direction of a linear pattern sampled round a centre: the arc its instances turn through. */
function turnPath(
    seed: readonly [number, number],
    center: readonly [number, number],
    sweep: number,
): [number, number][] {
    const path: [number, number][] = [];
    for (let slice = 0; slice <= STEP_PATH_SLICES; slice++) {
        path.push(turnPoint(seed, center, (sweep * slice) / STEP_PATH_SLICES));
    }
    return path;
}

/** The seed's own place, carried round `center` by `angle`. */
function turnPoint(
    seed: readonly [number, number],
    center: readonly [number, number],
    angle: number,
): [number, number] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const du = seed[0] - center[0];
    const dv = seed[1] - center[1];
    return [center[0] + cos * du - sin * dv, center[1] + sin * du + cos * dv];
}

/**
 * A stretch of a curve pattern's own run, sampled as points on the sketch plane: the arc length
 * asked for, taken from where the seed sits and at the offset it keeps — the path the instance
 * centres are laid on, which is what makes the line measure what it says.
 */
function curvePath(curve: SketchEntityData, frame: CurveFrame, arcLength: number): [number, number][] {
    const path: [number, number][] = [];
    for (let slice = 0; slice <= STEP_PATH_SLICES; slice++) {
        path.push(carriedPoint(curve, frame, frame.from + (arcLength * slice) / STEP_PATH_SLICES));
    }
    return path;
}

/**
 * How many slices a *round* run is drawn in — a turn or a curve. A picture, not a solve: enough
 * that a quarter turn reads as an arc rather than a chord. A straight run needs none, and is
 * the two points it is.
 */
const STEP_PATH_SLICES = 16;

/** A curve worth following: a line, circle or arc that the solver may read and the seed's centre. */
function curveSource(solver: SketchSolver, curveId: number): Result<SketchEntityData> {
    const curve = solver.entity(curveId);
    if (curve === undefined || isDatumEntityId(curve.id) || isExternalEntityId(curve.id)) {
        return Result.err("The array curve is not sketch geometry");
    }
    if (isDegenerate(curve)) return Result.err("The array curve is too short to follow");
    return Result.ok(curve);
}

/**
 * Every entity the pattern reads, so the solver can tell whether a record still has anything
 * to resolve against — a record whose reference has been deleted is a record with nothing to
 * lay out. A linear pattern reads the sketch's own axes (nothing outside itself), and a
 * circular one whose centre the user placed on empty space reads nothing at all.
 */
export function arrayReferenceIds(pattern: SketchArrayPattern): number[] {
    switch (pattern.type) {
        case "linear":
            return [];
        case "circular":
            return pattern.center.type === "ref" ? [pattern.center.ref.entityId] : [];
        default:
            return [pattern.curveId];
    }
}

/** Where a circular pattern turns: the point a reference names, or the place one was put. */
export function centerOf(solver: SketchSolver, center: SketchArrayCenter): [number, number] {
    return center.type === "ref" ? solver.pointOf(center.ref) : [center.u, center.v];
}

/** One direction of a linear pattern, its count and its step read off the solver's scope. */
interface ResolvedAxis {
    readonly count: number;
    readonly spacing: number;
}

/**
 * A direction's count and step.
 *
 * A direction that lays down nothing (`count` 1 or less) is still *read*: its spacing is what
 * its own handle is dragged by, and the second direction of a linear pattern is turned on by
 * pulling that handle out. It is not however *judged* — a direction with a single instance has
 * no step to be too small or to fail to resolve, and refusing the whole pattern over a number
 * it does not use would be refusing the sketch over nothing.
 */
function resolveAxis(axis: SketchArrayAxis, scope: Scope): Result<ResolvedAxis> {
    if (!Number.isInteger(axis.count) || axis.count < 1) {
        return Result.err("An array direction needs at least one instance");
    }
    if (axis.count === 1) {
        const spacing = resolveLength(axis.spacing, scope);
        return Result.ok({ count: 1, spacing: spacing.isOk ? spacing.value : 0 });
    }
    const spacing = resolveStep(axis.spacing, scope);
    return spacing.isOk
        ? Result.ok({ count: axis.count, spacing: spacing.value })
        : Result.err(spacing.error);
}

/** The distance an instance steps, or why a pattern cannot be placed by it. */
function resolveStep(source: ParameterValue, scope: Scope): Result<number> {
    const spacing = resolveLength(source, scope);
    if (!spacing.isOk) return Result.err(spacing.error);
    return Math.abs(spacing.value) <= Precision.Distance
        ? Result.err("The array spacing is too small to place an instance")
        : Result.ok(spacing.value);
}

/**
 * The count of a pattern that lays all its instances in one run — a turn or a curve. Two or
 * more of them, since a run of one is the seed alone and is no pattern at all.
 */
function resolveRunCount(count: number): Result<number> {
    return Number.isInteger(count) && count >= 2
        ? Result.ok(count)
        : Result.err("An array needs at least two instances");
}

/** One direction of a linear pattern as the run it makes, along `alongU` (X) or across it (Y). */
function axisRun(
    seed: readonly [number, number],
    axis: ResolvedAxis,
    spacingField: ArrayField,
    countField: ArrayField,
    alongU: boolean,
): ArrayRun {
    const du = alongU ? axis.spacing : 0;
    const dv = alongU ? 0 : axis.spacing;
    const steps = axis.count - 1;
    return {
        spacing: {
            field: spacingField,
            value: axis.spacing,
            measure: "length",
            // the middle of the *first* step, which is the step the number is: a run of five
            // says "60" between the first two of them, as a dimension chain does
            at: [seed[0] + du / 2, seed[1] + dv / 2],
        },
        count: { field: countField, value: axis.count, at: [seed[0] + steps * du, seed[1] + steps * dv] },
        path: straightPath(seed, du, dv, steps),
    };
}

/**
 * The pattern's references read off the solver and its numbers resolved, or why it cannot be
 * placed. Pure but for the solver reads: nothing is written, so the caller may use this for a
 * preview as readily as for the solve that follows.
 *
 * `sourceIds` is what the seed is read off — its bounding-box centre, the base the transform
 * tool reads off a selection — and every run is drawn from where that seed sits.
 */
export function resolveArray(
    solver: SketchSolver,
    pattern: SketchArrayPattern,
    sourceIds: readonly number[],
    scope: Scope,
): Result<ResolvedArray> {
    const total = arrayInstanceTotal(pattern);
    if (total < 2) return Result.err("An array needs at least two instances");
    if (total > MAX_ARRAY_COUNT) {
        return Result.err(`An array holds at most ${MAX_ARRAY_COUNT} instances`);
    }
    switch (pattern.type) {
        case "linear":
            return resolveLinearArray(solver, pattern, sourceIds, scope);
        case "circular":
            return resolveCircularArray(solver, pattern, sourceIds, scope);
        default:
            return resolveCurveArray(solver, pattern, sourceIds, scope);
    }
}

/** A linear pattern: a grid of shifts along the sketch's own two axes, seeded where it sits. */
function resolveLinearArray(
    solver: SketchSolver,
    pattern: Extract<SketchArrayPattern, { type: "linear" }>,
    sourceIds: readonly number[],
    scope: Scope,
): Result<ResolvedArray> {
    const x = resolveAxis(pattern.x, scope);
    if (!x.isOk) return Result.err(x.error);
    const y = resolveAxis(pattern.y, scope);
    if (!y.isOk) return Result.err(y.error);
    // the placements are shifts and know nothing of the seed; only the runs are drawn from
    // where it sits, so a caller without one still gets a placed pattern
    const seed = transformBase(solver, sourceIds);
    // a direction that lays down nothing has no run: nothing to draw, nothing to read
    const runs: ArrayRun[] = [];
    if (seed !== undefined) {
        if (x.value.count > 1) runs.push(axisRun(seed, x.value, "spacingX", "countX", true));
        if (y.value.count > 1) runs.push(axisRun(seed, y.value, "spacingY", "countY", false));
    }
    return Result.ok({ base: [0, 0], placements: gridPlacements(x.value, y.value), runs });
}

/**
 * The grid's own placements, in the order the slots are written: a row of X at a time, then
 * along Y. Instance k is (i, j) with i = k % x.count and j = k / x.count, and instance 0 — the
 * first cell of the first row — is the seed itself, which is not laid down.
 */
function gridPlacements(x: ResolvedAxis, y: ResolvedAxis): ArrayPlacement[] {
    const placements: ArrayPlacement[] = [];
    for (let j = 0; j < y.count; j++) {
        for (let i = 0; i < x.count; i++) {
            const index = j * x.count + i;
            if (index === 0) continue;
            placements.push({
                index,
                transform: { du: i * x.spacing, dv: j * y.spacing, angle: 0, scale: 1 },
            });
        }
    }
    return placements;
}

/** A circular pattern: the seed turned about a centre, one placement per instance after it. */
function resolveCircularArray(
    solver: SketchSolver,
    pattern: Extract<SketchArrayPattern, { type: "circular" }>,
    sourceIds: readonly number[],
    scope: Scope,
): Result<ResolvedArray> {
    const count = resolveRunCount(pattern.count);
    if (!count.isOk) return Result.err(count.error);
    const twist = resolveAngle(pattern.twist, scope);
    if (!twist.isOk) return Result.err(twist.error);
    if (Math.abs(twist.value) <= Precision.Angle) {
        return Result.err("The array turn is too small to place an instance");
    }
    // even spacing spreads the turn over the count, so the last instance lands back on the
    // seed; otherwise it is spread over the gaps, and the last one lands on the turn asked for
    const step = pattern.equalSpacing ? twist.value / count.value : twist.value / (count.value - 1);
    const placements: ArrayPlacement[] = [];
    for (let index = 1; index < count.value; index++) {
        placements.push({ index, transform: { du: 0, dv: 0, angle: index * step, scale: 1 } });
    }
    const center = centerOf(solver, pattern.center);
    const seed = transformBase(solver, sourceIds);
    // a turn is placed about its centre, which is nothing to do with the seed; the run is what
    // is drawn from where the seed sits, so it waits for one
    return Result.ok({
        base: center,
        placements,
        runs: seed === undefined ? [] : [turnRun(seed, center, twist.value, count.value, step)],
    });
}

/** The arc a turn is measured along: the whole turn as the field holds it, and where it ends. */
function turnRun(
    seed: readonly [number, number],
    center: readonly [number, number],
    twist: number,
    count: number,
    step: number,
): ArrayRun {
    const steps = step * (count - 1);
    return {
        // the number is the whole turn, as the field holds it, and its label reads half a step
        // round from the seed — on the first step's arc
        spacing: {
            field: "twist",
            value: (twist * 180) / Math.PI,
            measure: "angle",
            at: turnPoint(seed, center, step / 2),
        },
        count: { field: "count", value: count, at: turnPoint(seed, center, steps) },
        path: turnPath(seed, center, steps),
    };
}

/** A curve pattern: the seed carried along a curve, one instance per step of arc length. */
function resolveCurveArray(
    solver: SketchSolver,
    pattern: Extract<SketchArrayPattern, { type: "curve" }>,
    sourceIds: readonly number[],
    scope: Scope,
): Result<ResolvedArray> {
    const count = resolveRunCount(pattern.count);
    if (!count.isOk) return Result.err(count.error);
    const curve = curveSource(solver, pattern.curveId);
    if (!curve.isOk) return Result.err(curve.error);
    const spacing = resolveStep(pattern.spacing, scope);
    if (!spacing.isOk) return Result.err(spacing.error);
    const base = transformBase(solver, sourceIds);
    if (base === undefined) return Result.err("Nothing to array");
    const frame = curveFrame(curve.value, base);
    return Result.ok({
        base,
        placements: curvePlacements(curve.value, base, frame, spacing.value, count.value),
        runs: [curveRun(curve.value, frame, spacing.value, count.value)],
    });
}

/** The stretch of curve a pattern runs along, as the numbers that read it and the path they sit on. */
function curveRun(curve: SketchEntityData, frame: CurveFrame, spacing: number, count: number): ArrayRun {
    const run = spacing * (count - 1);
    return {
        // the spacing reads half a step along the run from the seed, and the count where
        // following the curve for the whole run arrives
        spacing: {
            field: "spacing",
            value: spacing,
            measure: "length",
            at: carriedPoint(curve, frame, frame.from + spacing / 2),
        },
        count: { field: "count", value: count, at: carriedPoint(curve, frame, frame.from + run) },
        path: curvePath(curve, frame, run),
    };
}

/**
 * Every instance of every source, instance-major then source order — the order
 * `SketchArrayData.instanceEntityIds` is written in, so a load can pair the persisted ids
 * back up with the geometry derived here.
 *
 * Sources that are not the solver's to copy drop out: the datum and external refs are not
 * geometry an array may hold, and a source that has since been deleted simply is not there.
 */
export function arrayInstanceSpecs(
    solver: SketchSolver,
    sourceIds: readonly number[],
    resolved: ResolvedArray,
): ArrayInstanceSpec[] {
    const sources: SketchEntityData[] = [];
    const seen = new Set<number>();
    for (const id of sourceIds) {
        if (seen.has(id) || isDatumEntityId(id) || isExternalEntityId(id)) continue;
        seen.add(id);
        const entity = solver.entity(id);
        if (entity !== undefined) sources.push(entity);
    }
    const specs: ArrayInstanceSpec[] = [];
    for (const { index, transform } of resolved.placements) {
        for (const source of sources) {
            specs.push({
                index,
                sourceId: source.id,
                type: source.type,
                params: transformParams(source, resolved.base, transform),
                construction: solver.isConstruction(source.id),
            });
        }
    }
    return specs;
}

/**
 * The instances as entity data in sketch coordinates — the preview's own view of what
 * `arrayInstanceSpecs` derives. The ids are the sources' own: nothing addresses a preview
 * entity, it is only ever meshed.
 *
 * `record` is the array a preview stands in for, when it stands in for one: its holes are
 * honoured, so the pattern the preview draws is missing the instances the user took out of it.
 * The holes only mean anything against the source list they were written with — a slot is an
 * (instance, source) pair, and a record re-pointed at other geometry would have its `null`s
 * land on unrelated instances — so a source list that no longer matches the record's drops
 * them, and the preview shows the pattern whole.
 */
export function arrayPreview(
    solver: SketchSolver,
    sourceIds: readonly number[],
    resolved: ResolvedArray,
    record?: SketchArrayData,
): SketchEntityData[] {
    const slots =
        record !== undefined && sameIdList(record.sourceIds, sourceIds)
            ? record.instanceEntityIds
            : undefined;
    return arrayInstanceSpecs(solver, sourceIds, resolved)
        .filter((_spec, slot) => slots === undefined || slots[slot] !== null)
        .map((spec) => ({
            id: spec.sourceId,
            type: spec.type,
            params: spec.params,
            ...(spec.construction ? { construction: true } : {}),
        }));
}
