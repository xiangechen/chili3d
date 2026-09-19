// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type FeatureItem,
    type IDocument,
    Id,
    type IEdge,
    type IFace,
    type INode,
    LENGTH_UNITS,
    Matrix4,
    type ParameterValue,
    Plane,
    resolveUnitSpec,
    type Scope,
    ShapeNode,
    ShapeTypes,
    type UnitSpec,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef } from "../features/edgeRef";
import type {
    BooleanOperation,
    ExtrudeFeatureData,
    FeatureData,
    RevolveFeatureData,
} from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import { captureFaceRef, type PlaneFaceRef, sketchPlaneOfFace } from "../sketch/planeRef";
import {
    ConstraintKind,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    type SketchEntityType,
} from "../sketch/sketchModel";
import { SketchNode } from "../sketch/sketchNode";
import { SketchSolver } from "../sketch/solver";

/**
 * A parametric program: an ordered list of sketch and feature operations, driven from a
 * plain-JSON payload. The engine owns no geometry of its own — every step delegates to
 * the same API the interactive commands use (`SketchSolver`, `SketchNode`,
 * `ParametricBodyNode.setFeaturesEmitShapeChanged`), so an AI-built body is
 * indistinguishable from a hand-built one.
 *
 * Contract: synchronous, and **throws on any failure** so the caller's `Transaction`
 * rolls the whole program back. Nothing is written to history and the visual is not
 * refreshed here — that is the caller's job.
 */

export type ParametricOp =
    | SketchOp
    | ExtrudeOp
    | RevolveOp
    | FilletChamferOp
    | BooleanOp
    | EditFeatureOp
    | FeaturesOp;

export interface SketchOp {
    op: "sketch";
    id: string;
    name?: string;
    /** A datum plane, or a planar face of an existing node. Defaults to XY. */
    plane?: "XY" | "YZ" | "ZX" | { nodeId: string; faceIndex: number };
    entities: { type: SketchEntityType; params: number[] }[];
    constraints?: {
        kind: string;
        refs: { entity: number; point: number }[];
        datum?: ParameterValue;
        datums?: ParameterValue[];
    }[];
}

export interface ExtrudeOp {
    op: "extrude";
    id: string;
    name?: string;
    /** The sketch op id, or an existing sketch's node id. */
    sketch: string;
    depth: ParameterValue;
    symmetric?: boolean;
    startOffset?: ParameterValue;
    /** Omit to create a new body; otherwise the body to append the feature to. */
    body?: string;
    operation?: BooleanOperation;
}

export interface RevolveOp {
    op: "revolve";
    id: string;
    name?: string;
    sketch: string;
    axis: { point: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
    /** Degrees. Defaults to 360. Always starts a new body — revolve has no join/cut form. */
    angle?: ParameterValue;
}

export interface FilletChamferOp {
    op: "fillet" | "chamfer";
    id: string;
    name?: string;
    body: string;
    /** Indexes into the body's current edge list (findSubShapes order). */
    edgeIndexes: number[];
    radius?: ParameterValue;
    distance?: ParameterValue;
}

export interface BooleanOp {
    op: "boolean";
    id: string;
    name?: string;
    body: string;
    operation: BooleanOperation;
    /** Node ids (or op ids) of the tool bodies. */
    tools: string[];
    consumeTools?: boolean;
}

export interface EditFeatureOp {
    op: "editFeature";
    body: string;
    featureId: string;
    action: "setParameter" | "rename" | "suppress" | "moveTo" | "remove";
    key?: string;
    value?: ParameterValue | boolean;
    index?: number;
}

export interface FeaturesOp {
    op: "features";
    id?: string;
    body: string;
}

/**
 * A feature row as it leaves the engine. `FeatureItem` cannot be returned as-is: its
 * `references` hold live `INode`s, which own their parent and document right back, so
 * serializing it throws "cyclic structures". Everything here is plain data.
 */
export interface FeatureSummary {
    id: string;
    type: string;
    display: string;
    name?: string;
    suppressed: boolean;
    error?: string;
    warning?: string;
    reselectable?: boolean;
    references: { key: string; display: string; nodeId: string }[];
    parameters: { key: string; display: string; value: number | string | boolean; unit?: UnitSpec }[];
}

/** What one program produced, in the same envelope shape `run_program` uses. */
export interface ProgramResult {
    created: { id: string; nodeId: string; name: string }[];
    /** The feature list of every body the program touched. */
    bodies: { nodeId: string; name: string; features: FeatureSummary[] }[];
    /** Nodes adopted by a boolean feature — hidden children of the body, not deleted. */
    consumed: { nodeId: string; name: string; ownerId: string }[];
    results: Record<string, unknown>;
}

interface State {
    readonly document: IDocument;
    readonly refs: Map<string, string>;
    readonly out: ProgramResult;
    readonly touched: Set<ParametricBodyNode>;
}

/**
 * Op id -> node id, per document. Only node ids are kept: a node survives rebuilds and
 * undo/redo, so a stale entry resolves to "node not found" on its own — no live-shape
 * cache and therefore no rollback patching.
 */
const refsByDocument = new WeakMap<IDocument, Map<string, string>>();
const MAX_REFS_PER_DOCUMENT = 512;

function refsFor(document: IDocument): Map<string, string> {
    const existing = refsByDocument.get(document);
    if (existing !== undefined) return existing;
    const refs = new Map<string, string>();
    refsByDocument.set(document, refs);
    return refs;
}

/** Runs every op in order, returning the result envelope. Throws on the first failure. */
export function runParametricProgram(document: IDocument, ops: readonly ParametricOp[]): ProgramResult {
    const refs = refsFor(document);
    if (refs.size > MAX_REFS_PER_DOCUMENT) refs.clear();
    const state: State = {
        document,
        refs,
        out: { created: [], bodies: [], consumed: [], results: {} },
        touched: new Set(),
    };
    ops.forEach((op, index) => {
        try {
            runOp(state, op);
        } catch (err) {
            throw new Error(`op ${index} ("${op.op}") failed: ${(err as Error).message}`);
        }
    });
    state.out.bodies = [...state.touched].map((body) => ({
        nodeId: body.id,
        name: body.name,
        features: summarizeFeatures(body),
    }));
    return state.out;
}

function runOp(state: State, op: ParametricOp): void {
    switch (op.op) {
        case "sketch":
            runSketchOp(state, op);
            break;
        case "extrude":
            runExtrudeOp(state, op);
            break;
        case "revolve":
            runRevolveOp(state, op);
            break;
        case "fillet":
        case "chamfer":
            runEdgeCornerOp(state, op);
            break;
        case "boolean":
            runBooleanOp(state, op);
            break;
        case "editFeature":
            runEditFeatureOp(state, op);
            break;
        case "features":
            runFeaturesOp(state, op);
            break;
        default:
            throw new Error(`unknown op "${(op as { op: string }).op}"`);
    }
}

// ------------------------------------------------------------------ Reference resolution

/** Resolves an op id (or a plain node id) to a node. */
function resolveNode(state: State, ref: unknown, what: string): INode {
    const key = String(ref ?? "");
    if (key === "") throw new Error(`${what} is required`);
    const id = state.refs.get(key) ?? key;
    const node = state.document.modelManager.findNodes((n) => n.id === id)[0];
    if (node === undefined) {
        const known = state.refs.size > 0 ? [...state.refs.keys()].join(", ") : "none defined yet";
        throw new Error(
            `unknown ${what} "${key}": no node with id "${id}" (op ids defined in this session: ${known})`,
        );
    }
    return node;
}

function resolveSketch(state: State, ref: unknown): SketchNode {
    const node = resolveNode(state, ref, "sketch");
    if (!(node instanceof SketchNode)) {
        throw new Error(`"${ref}" is a ${node.constructor.name}, not a sketch`);
    }
    return node;
}

function resolveBody(state: State, ref: unknown): ParametricBodyNode {
    const node = resolveNode(state, ref, "body");
    if (!(node instanceof ParametricBodyNode)) {
        throw new Error(`"${ref}" is a ${node.constructor.name}, not a parametric body`);
    }
    return node;
}

// ------------------------------------------------------------------ Sketch

function runSketchOp(state: State, op: SketchOp): void {
    const { planeRef, plane, refPositions } = resolveSketchPlane(state, op);
    const data = buildSketchData(state.document, op, plane);
    if (refPositions !== undefined) data.refPositions = refPositions;

    const sketch = new SketchNode({ document: state.document, plane, planeRef, data });
    state.document.modelManager.addNode(sketch);
    // The node builds its edges lazily and reports failure only through `shape` — this
    // read is both the trigger and the single place a bad sketch can be caught.
    const shape = sketch.shape;
    if (!shape.isOk) throw new Error(`the sketch is not usable: ${shape.error}`);
    if (op.name !== undefined) sketch.name = op.name;

    state.refs.set(op.id, sketch.id);
    state.out.created.push({ id: op.id, nodeId: sketch.id, name: sketch.name });
}

function resolveSketchPlane(
    state: State,
    op: SketchOp,
): { plane: Plane; planeRef?: PlaneFaceRef; refPositions?: Record<string, number> } {
    const picked = op.plane;
    if (picked === undefined || picked === "XY") return { plane: Plane.XY };
    if (picked === "YZ") return { plane: Plane.YZ };
    if (picked === "ZX") return { plane: Plane.ZX };

    const host = resolveNode(state, picked.nodeId, "plane host");
    if (!(host instanceof ShapeNode) || !host.shape.isOk) {
        throw new Error(`node "${picked.nodeId}" has no valid shape to build a sketch plane on`);
    }
    const faces = host.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const local = faces[picked.faceIndex];
    if (local === undefined) {
        throw new Error(
            `faceIndex ${picked.faceIndex} is out of range on "${picked.nodeId}" (0..${faces.length - 1})`,
        );
    }
    if (!local.surface().isPlanar()) {
        throw new Error(`face ${picked.faceIndex} of "${picked.nodeId}" is not planar`);
    }
    // Sketch planes and face refs are captured in world coordinates (planeRef.ts).
    const transform = host.worldTransform();
    const isIdentity = transform.equals(Matrix4.identity());
    const world = isIdentity ? local : (local.transformedMul(transform) as IFace);
    try {
        const planeRef = captureFaceRef(host.id, world);
        if (isBodyTrackingNode(host)) {
            const faceId = host.faceIdAt(picked.faceIndex);
            if (faceId !== undefined) planeRef.faceId = faceId;
        }
        // The plane belongs to the host's shape at capture time: anchor the sketch's
        // timeline there so a later feature moving the face does not drag the plane.
        const refPositions =
            host instanceof ParametricBodyNode ? { [host.id]: host.features.length } : undefined;
        return { plane: sketchPlaneOfFace(world), planeRef, refPositions };
    } finally {
        if (!isIdentity) world.dispose();
    }
}

function buildSketchData(document: IDocument, op: SketchOp, plane: Plane): SketchData {
    const entities: SketchEntityData[] = op.entities.map((entity, index) => ({
        id: index + 1,
        type: entity.type,
        params: entity.params,
    }));
    const data: SketchData = {
        entities,
        constraints: [],
        // Explicit ids are handed out by index, so the counter has to start past them.
        entityIdSeq: entities.length + 1,
    };
    const constraints = op.constraints ?? [];
    if (constraints.length === 0) return data;

    data.constraints = constraints.map((constraint, index) => {
        const refs = constraint.refs.map((ref) => ({ entityId: ref.entity, pointIndex: ref.point }));
        const entry: SketchConstraintData = {
            id: index + 1,
            kind: parseConstraintKind(constraint.kind),
            refs,
        };
        if (constraint.datum !== undefined) entry.datum = constraint.datum;
        if (constraint.datums !== undefined) entry.datums = constraint.datums;
        return entry;
    });
    return solveSketch(plane, data, document.variables.evaluate().scope);
}

/**
 * Runs the constraint solver once over freshly built data, returning the solved form.
 * The solver loads (and solves) in its constructor; this only adds the datum-error check
 * the node itself would swallow — an expression that does not resolve would otherwise
 * leave the sketch silently under-solved.
 */
function solveSketch(plane: Plane, data: SketchData, scope: Scope): SketchData {
    const solver = new SketchSolver(plane, data, scope);
    try {
        solver.solve(true);
        if (solver.datumErrors.size > 0) {
            const [id, message] = [...solver.datumErrors][0];
            throw new Error(`constraint ${id} has an unusable value: ${message}`);
        }
        return solver.toData();
    } finally {
        solver.dispose();
    }
}

function parseConstraintKind(kind: unknown): ConstraintKind {
    if (typeof kind === "number" && ConstraintKind[kind] !== undefined) return kind as ConstraintKind;
    const name = String(kind);
    const resolved = (ConstraintKind as unknown as Record<string, ConstraintKind | undefined>)[name];
    if (resolved !== undefined) return resolved;
    const valid = Object.keys(ConstraintKind).filter((key) => Number.isNaN(Number(key)));
    throw new Error(`unknown constraint kind "${name}" — valid kinds: ${valid.join(", ")}`);
}

// ------------------------------------------------------------------ Features

function runExtrudeOp(state: State, op: ExtrudeOp): void {
    const sketch = resolveSketch(state, op.sketch);
    const scope = state.document.variables.evaluate().scope;
    ensureUnit(op.depth, scope, LENGTH_UNITS, "depth");
    if (op.startOffset !== undefined) ensureUnit(op.startOffset, scope, LENGTH_UNITS, "startOffset");

    // `profiles` is deliberately left out: an absent list extrudes every closed profile
    // of the sketch, which is what a whole-sketch extrude means.
    const feature: ExtrudeFeatureData = {
        id: Id.generate(),
        type: "extrude",
        sketchId: sketch.id,
        depth: op.depth,
        ...(op.symmetric === true ? { symmetric: true } : {}),
        ...(op.startOffset !== undefined ? { startOffset: op.startOffset } : {}),
    };
    if (op.body === undefined) {
        createBody(state, op.id, op.name, [feature], () => {
            sketch.visible = false;
        });
        return;
    }
    if (op.operation === undefined) {
        throw new Error('appending an extrude to an existing body requires "operation" (fuse/cut/common)');
    }
    const body = resolveBody(state, op.body);
    appendFeature(state, body, { ...feature, operation: op.operation });
    // An op that edits a body is registered as another name for it, so a later op can
    // reference the result of this one the same way it references a freshly built body.
    state.refs.set(op.id, body.id);
}

function runRevolveOp(state: State, op: RevolveOp): void {
    const sketch = resolveSketch(state, op.sketch);
    const scope = state.document.variables.evaluate().scope;
    ensureAxis(op.axis);
    if (op.angle !== undefined) ensureUnit(op.angle, scope, ANGLE_UNITS, "angle");

    const feature: RevolveFeatureData = {
        id: Id.generate(),
        type: "revolve",
        sketchId: sketch.id,
        // A world-space snapshot; without an `axisSource` there is nothing to re-derive
        // the axis from, and the snapshot is what the handler falls back to anyway.
        axis: { point: { ...op.axis.point }, direction: { ...op.axis.direction } },
        angle: op.angle ?? 360,
    };
    createBody(state, op.id, op.name, [feature], () => {
        sketch.visible = false;
    });
}

function runEdgeCornerOp(state: State, op: FilletChamferOp): void {
    const body = resolveBody(state, op.body);
    const shape = body.shape;
    if (!shape.isOk) throw new Error(`body "${op.body}" has no valid shape: ${shape.error}`);
    const scope = state.document.variables.evaluate().scope;
    const value = op.op === "fillet" ? op.radius : op.distance;
    if (value === undefined)
        throw new Error(`"${op.op}" requires "${op.op === "fillet" ? "radius" : "distance"}"`);
    ensureUnit(value, scope, LENGTH_UNITS, op.op === "fillet" ? "radius" : "distance");

    const edges = shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
    const refs = op.edgeIndexes.map((index) => {
        const edge = edges[index];
        if (edge === undefined) {
            throw new Error(
                `edgeIndex ${index} is out of range on body "${op.body}" (0..${edges.length - 1})`,
            );
        }
        // Same capture the interactive fillet uses: the tracked id is what makes the
        // ref survive a rebuild, the fingerprint is what matches when it does not.
        const id = body.edgeIdAt(index);
        return captureEdgeRef(edge, id, body.edgeIdIsShared(id));
    });

    const feature: FeatureData =
        op.op === "fillet"
            ? { id: Id.generate(), type: "fillet", radius: value, edges: refs }
            : { id: Id.generate(), type: "chamfer", distance: value, edges: refs };
    appendFeature(state, body, feature);
    state.refs.set(op.id, body.id);
}

function runBooleanOp(state: State, op: BooleanOp): void {
    const body = resolveBody(state, op.body);
    const tools = op.tools.map((tool) => resolveNode(state, tool, "boolean tool"));
    for (const tool of tools) {
        if (tool.id === body.id) throw new Error(`cannot use the body "${op.body}" as its own boolean tool`);
        if (!(tool instanceof ShapeNode)) {
            throw new Error(`boolean tool "${tool.name}" is a ${tool.constructor.name}, not a shape node`);
        }
    }
    appendFeature(state, body, {
        id: Id.generate(),
        type: "boolean",
        operation: op.operation,
        toolIds: tools.map((tool) => tool.id),
        ...(op.consumeTools === false ? { consumeTools: false } : {}),
    });
    // The body adopts the tools itself (`syncConsumedTools`); this only reports it.
    for (const tool of tools) {
        state.out.consumed.push({ nodeId: tool.id, name: tool.name, ownerId: body.id });
    }
    state.refs.set(op.id, body.id);
}

function runEditFeatureOp(state: State, op: EditFeatureOp): void {
    const body = resolveBody(state, op.body);
    const before = erroredFeatureIds(body);
    switch (op.action) {
        case "setParameter":
            if (op.key === undefined) throw new Error('"setParameter" requires "key"');
            if (op.value === undefined) throw new Error('"setParameter" requires "value"');
            body.setFeatureParameter(op.featureId, op.key, op.value);
            break;
        case "rename":
            body.renameFeature(op.featureId, typeof op.value === "string" ? op.value : "");
            return;
        case "suppress":
            body.setFeatureSuppressed(op.featureId, op.value === true);
            break;
        case "moveTo":
            if (typeof op.index !== "number") throw new Error('"moveTo" requires a numeric "index"');
            body.moveFeatureTo(op.featureId, op.index);
            break;
        case "remove":
            body.removeFeature(op.featureId);
            break;
        default:
            throw new Error(`unknown editFeature action "${(op as { action: string }).action}"`);
    }
    checkBody(state, body, before);
}

function runFeaturesOp(state: State, op: FeaturesOp): void {
    state.out.results[op.id ?? "features"] = summarizeFeatures(resolveBody(state, op.body));
}

/** Feature rows stripped of their live nodes — see `FeatureSummary`. */
function summarizeFeatures(body: ParametricBodyNode): FeatureSummary[] {
    const types = body.features.map((feature) => feature.type);
    return body.featureItems().map((item, index) => featureSummary(item, types[index]));
}

function featureSummary(item: FeatureItem, type: string | undefined): FeatureSummary {
    const summary: FeatureSummary = {
        id: item.id,
        type: type ?? "unknown",
        display: item.display,
        suppressed: item.suppressed === true,
        references: (item.references ?? []).map((reference) => ({
            key: reference.key,
            display: reference.display,
            // The node itself is what cycles — keep its id, which is what a caller needs.
            nodeId: reference.node.id,
        })),
        parameters: item.parameters.map((parameter) => ({
            key: parameter.key,
            display: parameter.display,
            value: parameter.value,
            ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
        })),
    };
    if (item.name !== undefined) summary.name = item.name;
    if (item.error !== undefined) summary.error = item.error;
    if (item.warning !== undefined) summary.warning = item.warning;
    if (item.reselectable === true) summary.reselectable = true;
    return summary;
}

// ------------------------------------------------------------------ Feature plumbing

function createBody(
    state: State,
    id: string,
    name: string | undefined,
    features: FeatureData[],
    afterAdd?: () => void,
): void {
    const body = new ParametricBodyNode({ document: state.document, features });
    state.document.modelManager.addNode(body);
    if (name !== undefined) body.name = name;
    afterAdd?.();
    checkBody(state, body, undefined);
    state.refs.set(id, body.id);
    state.out.created.push({ id, nodeId: body.id, name: body.name });
}

/**
 * The single write gate for features. A failed rebuild is swallowed by the node — it
 * keeps the previous shape and only records the message on the feature row — so this
 * has to compare before and after and raise, or a broken model would be reported as a
 * success. Only *new* errors count: a stale failure from an earlier edit must not make
 * every later op look broken.
 */
function appendFeature(state: State, body: ParametricBodyNode, feature: FeatureData): void {
    const before = erroredFeatureIds(body);
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    checkBody(state, body, before);
}

function checkBody(state: State, body: ParametricBodyNode, before: Set<string> | undefined): void {
    const failed = body
        .featureItems()
        .find((item) => item.error !== undefined && (before === undefined || !before.has(item.id)));
    if (failed !== undefined) {
        throw new Error(`feature "${failed.display}" (${failed.id}) failed: ${failed.error}`);
    }
    const shape = body.shape;
    if (!shape.isOk) throw new Error(`the body could not be rebuilt: ${shape.error}`);
    state.touched.add(body);
}

function erroredFeatureIds(body: ParametricBodyNode): Set<string> {
    return new Set(
        body
            .featureItems()
            .filter((item) => item.error !== undefined)
            .map((item) => item.id),
    );
}

/** Resolves a parameter up front so a bad expression fails here, not inside a rebuild. */
function ensureUnit(value: ParameterValue, scope: Scope, expected: UnitSpec, what: string): void {
    const resolved = resolveUnitSpec(value, scope, expected);
    if (!resolved.isOk) throw new Error(`"${what}" is not usable: ${resolved.error}`);
}

function ensureAxis(axis: RevolveOp["axis"]): void {
    const finite = (v: { x: number; y: number; z: number } | undefined) =>
        v !== undefined && [v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n));
    if (!finite(axis?.point) || !finite(axis?.direction)) {
        throw new Error('"axis" must be { point: {x,y,z}, direction: {x,y,z} } with finite numbers');
    }
    const { x, y, z } = axis.direction;
    if (x === 0 && y === 0 && z === 0) throw new Error('"axis.direction" must be non-zero');
}
