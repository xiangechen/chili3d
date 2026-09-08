// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    I18n,
    type IDocument,
    type IShape,
    Line,
    Matrix4,
    Plane,
    Result,
    ShapeNode,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import type { JsonSchema, Tool } from "../llm/types";
import {
    type QueryCapability,
    queryCapabilities,
    type ShapeCapability,
    type ShapeCapabilityParam,
    shapeCapabilities,
} from "./capabilities.generated";
import { buildTransformMatrix } from "./transformMatrix";

interface Op {
    id?: string;
    method: string;
    args?: Record<string, unknown>;
    name?: string;
    target?: unknown;
}

/** A scene node created by an op, reported back in the run_program result. */
interface CreatedNode {
    id?: string;
    nodeId: string;
    name: string;
}

type RefKind = "shape" | "curve" | "surface";

interface LocalRef {
    /** Scene node backing this ref; its live shape is re-read on every resolve. */
    nodeId?: string;
    kind: RefKind;
    /** IShape | ICurve | ISurface — geometry objects are not structurally typed here. */
    value: unknown;
    /** Entry this ref was derived from (query ops); refreshed first so edits propagate. */
    parent?: LocalRef;
    /** Member name used to derive value from the parent (e.g. "findSubShapes", "curve"). */
    name?: string;
    args?: unknown[];
    /** Index into a list-valued member (sub-shape refs like `q1#2`). */
    index?: number;
}

/**
 * Refs persist across run_program calls (per document) so later programs can reuse
 * earlier op ids, sub-shape refs and curve/surface refs. Resolution re-derives them
 * against the live scene, so edits to a source node are reflected automatically.
 */
const refsByDocument = new WeakMap<IDocument, Map<string, LocalRef>>();
const MAX_REFS = 256;

function sessionRefs(doc: IDocument): Map<string, LocalRef> {
    let refs = refsByDocument.get(doc);
    if (!refs) {
        refs = new Map();
        refsByDocument.set(doc, refs);
    }
    return refs;
}

function setRef(refs: Map<string, LocalRef>, id: string, entry: LocalRef): void {
    refs.delete(id);
    refs.set(id, entry);
    while (refs.size > MAX_REFS) {
        const oldest = refs.keys().next().value;
        if (oldest === undefined) break;
        refs.delete(oldest);
    }
}

/**
 * Ops whose result replaces their input shapes ("edit in place"): only these consume
 * (remove) the nodes they reference. Read/derive ops (combine, sewing, curveProjection,
 * prism, sweep, revolve, loft, fuse, ...) keep referenced nodes in the scene.
 */
export const EDIT_METHODS: ReadonlySet<string> = new Set([
    "booleanCommon",
    "booleanCut",
    "booleanFuse",
    "chamfer",
    "chamfer2d",
    "fillet",
    "fillet2d",
    "makeThickSolidByJoin",
    "makeThickSolidBySimple",
    "pushPull",
    "removeFeature",
    "removeFillet",
    "removeSubShape",
    "replaceSubShapes",
    "simplifyShape",
]);

/**
 * Creation-style ops handled by this engine directly rather than by IShapeFactory
 * (transformedMul lives on IShape). Listed in the run_program method enum.
 */
export const EXTRA_OP_METHODS = ["transformedMul"] as const;

function activeDocument(): IDocument {
    const doc = globalThis.app.activeView?.document;
    if (!doc) throw new Error(I18n.translate("ai.error.noDocument"));
    return doc;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

function describe(v: unknown): string {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
}

function coerceXYZ(v: unknown, label: string): XYZ {
    const p = v as { x?: unknown; y?: unknown; z?: unknown } | null;
    if (!p || typeof p !== "object" || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        throw new Error(`${label} must be { x, y, z } with finite numbers, got ${describe(v)}`);
    }
    return new XYZ({ x: p.x, y: p.y, z: p.z });
}

function coerceLine(v: unknown, label: string): Line {
    const l = v as { point?: unknown; direction?: unknown } | null;
    if (!l || typeof l !== "object" || l.point === undefined || l.direction === undefined) {
        throw new Error(`${label} must be { point: {x,y,z}, direction: {x,y,z} }, got ${describe(v)}`);
    }
    return new Line({
        point: coerceXYZ(l.point, `${label}.point`),
        direction: coerceXYZ(l.direction, `${label}.direction`),
    });
}

/**
 * Resolve a ref (an op id from any program on this document, a sub-shape ref like
 * `q1#2`, a curve/surface ref, or an existing node id) to its registry entry. Referenced
 * nodes are recorded as consumed; the caller removes them only for edit-style methods
 * (EDIT_METHODS), whose result replaces the input.
 */
function resolveRefEntry(
    v: unknown,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
): LocalRef {
    const id = String(v);
    const hit = localRefs.get(id);
    if (hit) return refreshEntry(id, hit, doc, localRefs, consumed, new Set());
    const node = doc.modelManager.findNodes((n) => n.id === id)[0];
    if (node instanceof ShapeNode && node.shape.isOk) {
        consumed.add(node.id);
        return { nodeId: node.id, kind: "shape", value: node.shape.value };
    }
    throw new Error(I18n.translate("ai.error.unknownRef", id));
}

/**
 * Re-derive a ref against the live scene: node-backed refs re-read the node's current
 * shape; derived refs (sub-shapes, curves, surfaces) re-run their query on the refreshed
 * parent. A ref whose source node was removed, or whose index no longer exists after the
 * source shape changed, fails with a clear error instead of using stale geometry.
 */
function refreshEntry(
    id: string,
    entry: LocalRef,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
    resolving: Set<LocalRef>,
): LocalRef {
    if (resolving.has(entry)) throw new Error(`circular ref "${id}"`);
    resolving.add(entry);
    refreshNodeValue(id, entry, doc, consumed);
    rederiveFromParent(id, entry, doc, localRefs, consumed, resolving);
    return entry;
}

/** Node-backed refs re-read the node's current shape; a removed source node fails clearly. */
function refreshNodeValue(id: string, entry: LocalRef, doc: IDocument, consumed: Set<string>): void {
    if (entry.nodeId === undefined) return;
    const node = doc.modelManager.findNodes((n) => n.id === entry.nodeId)[0];
    if (!(node instanceof ShapeNode) || !node.shape.isOk) {
        throw new Error(`ref "${id}" is no longer valid: its source node was removed`);
    }
    consumed.add(node.id);
    if (!entry.parent) {
        entry.value = node.shape.value;
    }
}

/** Derived refs (sub-shapes, curves, surfaces) re-run their query on the refreshed parent. */
function rederiveFromParent(
    id: string,
    entry: LocalRef,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
    resolving: Set<LocalRef>,
): void {
    if (!entry.parent) return;
    const parent = refreshEntry(id, entry.parent, doc, localRefs, consumed, resolving);
    // Refs without a member name are snapshots of a creation op's extra output (e.g.
    // removeFillet's newEdges): they can't be recomputed from the node shape — refreshing
    // the parent only validates the source node still exists.
    if (entry.name === undefined) return;
    const target = parent.value as Record<string, unknown>;
    const member = target[entry.name ?? ""];
    const raw = typeof member === "function" ? member.apply(target, entry.args ?? []) : member;
    // Void mutation steps (curve.reverse, ...): the mutated parent object stays the value.
    if (raw === undefined && entry.index === undefined) {
        entry.value = target;
        return;
    }
    let value = entry.index !== undefined ? (raw as unknown[] | undefined)?.[entry.index] : raw;
    if (value instanceof Result) {
        if (!value.isOk) throw new Error(`ref "${id}" is no longer valid: ${String(value.error)}`);
        value = value.value;
    }
    if (value === undefined || value === null) {
        throw new Error(`ref "${id}" is no longer valid: its source shape changed`);
    }
    entry.value = value;
}

function resolveShape(
    v: unknown,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
): IShape {
    const entry = resolveRefEntry(v, doc, localRefs, consumed);
    if (entry.kind !== "shape") {
        throw new Error(`ref "${String(v)}" is a ${entry.kind}, but a shape is required`);
    }
    return entry.value as IShape;
}

/** Defaults for geometric params that are safe to omit. */
function defaultValue(p: ShapeCapabilityParam): unknown | undefined {
    if (p.kind === "plane") return Plane.XY;
    if (p.kind === "xyz") {
        if (p.name === "center" || p.name === "origin") return XYZ.zero;
        if (p.name === "normal") return XYZ.unitZ;
        if (p.name === "xDir" || p.name === "xvec") return XYZ.unitX;
    }
    return undefined;
}

function coerce(
    p: ShapeCapabilityParam,
    v: unknown,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
): unknown {
    if (v === undefined) return coerceMissing(p);
    switch (p.kind) {
        case "number":
        case "boolean":
        case "string":
        case "enum":
        case "numberArray":
        case "shapeType":
            return coercePrimitive(p, v);
        case "xyz":
        case "xyzArray":
        case "plane":
        case "line":
            return coerceGeometry(p, v);
        case "ref":
        case "refArray":
        case "curveRef":
        case "surfaceRef":
        case "refOrLine":
        case "refOrPlane":
            return coerceRefParam(p, v, doc, localRefs, consumed);
    }
}

function coerceMissing(p: ShapeCapabilityParam): unknown {
    const d = defaultValue(p);
    if (d !== undefined) return d;
    // Optional params fall through as undefined so the factory's own default applies.
    if (p.required === false) return undefined;
    throw new Error(I18n.translate("ai.error.missingParam", p.name));
}

function coercePrimitive(p: ShapeCapabilityParam, v: unknown): unknown {
    switch (p.kind) {
        case "number":
            if (!isFiniteNumber(v)) throw new Error(`${p.name} must be a finite number, got ${describe(v)}`);
            return v;
        case "boolean":
            if (typeof v !== "boolean") throw new Error(`${p.name} must be a boolean, got ${describe(v)}`);
            return v;
        case "string":
            if (typeof v !== "string") throw new Error(`${p.name} must be a string, got ${describe(v)}`);
            return v;
        case "enum":
            if (typeof v !== "string" || !p.enum?.includes(v)) {
                throw new Error(`${p.name} must be one of ${(p.enum ?? []).join("|")}, got ${describe(v)}`);
            }
            return v;
        case "numberArray":
            if (!Array.isArray(v) || !v.every(isFiniteNumber)) {
                throw new Error(`${p.name} must be an array of finite numbers, got ${describe(v)}`);
            }
            return v;
        case "shapeType": {
            const t = ShapeTypes[v as keyof typeof ShapeTypes];
            if (t === undefined) {
                throw new Error(`${p.name} must be one of ${Object.keys(ShapeTypes).join("|")}`);
            }
            return t;
        }
    }
}

function coerceGeometry(p: ShapeCapabilityParam, v: unknown): unknown {
    switch (p.kind) {
        case "xyz":
            return coerceXYZ(v, p.name);
        case "xyzArray":
            if (!Array.isArray(v)) throw new Error(`${p.name} must be an array of { x, y, z }`);
            return v.map((item, i) => coerceXYZ(item, `${p.name}[${i}]`));
        case "plane":
            return coercePlane(p.name, v);
        case "line":
            return coerceLine(v, p.name);
    }
}

/** Inline plane literal: { origin: {x,y,z} } — an XY-oriented plane through that point. */
function coercePlane(label: string, v: unknown): Plane {
    const origin = (v as { origin?: unknown } | null)?.origin;
    return origin !== undefined ? Plane.XY.translateTo(coerceXYZ(origin, `${label}.origin`)) : Plane.XY;
}

function coerceRefParam(
    p: ShapeCapabilityParam,
    v: unknown,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
): unknown {
    switch (p.kind) {
        case "ref":
            return resolveShape(v, doc, localRefs, consumed);
        case "refArray":
            return (v as unknown[]).map((r) => resolveShape(r, doc, localRefs, consumed));
        case "curveRef":
        case "surfaceRef": {
            const entry = resolveRefEntry(v, doc, localRefs, consumed);
            const expected = p.kind === "curveRef" ? "curve" : "surface";
            if (entry.kind !== expected) throw new Error(`${p.name} requires a ${expected} ref`);
            return entry.value;
        }
        case "refOrLine": {
            if (typeof v === "string") return resolveRefEntry(v, doc, localRefs, consumed).value;
            return coerceLine(v, p.name);
        }
        case "refOrPlane": {
            if (typeof v === "string") return resolveShape(v, doc, localRefs, consumed);
            return coercePlane(p.name, v);
        }
    }
}

/** Normalize query results to plain JSON (math classes expose own data props; drop methods). */
function toPlain(v: unknown): unknown {
    if (v instanceof Matrix4) return { array: v.toArray() };
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(toPlain);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v)) {
        if (typeof value !== "function") out[key] = toPlain(value);
    }
    return out;
}

function checkQueryOwner(cap: QueryCapability, entry: LocalRef): void {
    if (cap.family !== "shape") {
        if (entry.kind !== cap.family) {
            throw new Error(`${cap.method} requires a ${cap.family} target, got a ${entry.kind} ref`);
        }
        if (cap.runtimeType !== undefined) {
            const actual = (entry.value as { curveType?: string }).curveType;
            if (actual !== undefined && actual !== cap.runtimeType) {
                throw new Error(`${cap.method} requires a ${cap.runtimeType} curve, got ${actual}`);
            }
        }
        return;
    }
    if (entry.kind !== "shape") {
        throw new Error(`${cap.method} requires a shape target, got a ${entry.kind} ref`);
    }
    if (cap.owner !== "shape") {
        const required = ShapeTypes[cap.owner as keyof typeof ShapeTypes];
        const actual = (entry.value as IShape).shapeType;
        if (actual !== required) {
            const name = Object.keys(ShapeTypes).find(
                (k) => ShapeTypes[k as keyof typeof ShapeTypes] === actual,
            );
            throw new Error(`${cap.method} requires a ${cap.owner} target, got ${name ?? actual}`);
        }
    }
}

function runQuery(
    cap: QueryCapability,
    op: Op,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
) {
    if (!op.id) throw new Error(`query op "${op.method}" requires an id to report its result`);
    if (op.target === undefined) throw new Error(`query op "${op.method}" requires a target`);

    const entry = resolveRefEntry(op.target, doc, localRefs, new Set());
    checkQueryOwner(cap, entry);

    const target = entry.value as Record<string, unknown>;
    const member = target[cap.name];
    const args = cap.params.map((p) => coerce(p, op.args?.[p.name], doc, localRefs, new Set()));
    let raw =
        typeof member === "function" ? (member as (...a: unknown[]) => unknown).apply(target, args) : member;
    if (raw instanceof Result) {
        if (!raw.isOk) throw new Error(String(raw.error));
        raw = raw.value;
    }

    if (cap.returnKind === "mutate") {
        recordMutation(cap, op, entry, args, localRefs, results);
        return;
    }
    recordQueryResult(cap, op.id, entry, args, raw, localRefs, results);
}

/**
 * Mutation queries (curve.reverse, trimmedCurve.setTrim, ...) modify the target in place.
 * The mutation is recorded as an extra derivation step on the target's ref — a snapshot of
 * the pre-mutation entry becomes the parent — so re-resolving the ref re-applies it.
 */
function recordMutation(
    cap: QueryCapability,
    op: Op,
    entry: LocalRef,
    args: unknown[],
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    setRef(localRefs, String(op.target), {
        nodeId: entry.nodeId,
        kind: entry.kind,
        value: entry.value,
        parent: { ...entry },
        name: cap.name,
        args,
    });
    results[op.id ?? ""] = null;
}

function recordQueryResult(
    cap: QueryCapability,
    opId: string,
    entry: LocalRef,
    args: unknown[],
    raw: unknown,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    switch (cap.returnKind) {
        case "data":
            results[opId] = toPlain(raw);
            break;
        case "curveRef":
        case "surfaceRef":
        case "shapeRef":
            recordGeometryRef(cap, opId, entry, args, raw, localRefs, results);
            break;
        case "refList":
            recordSubShapeRefs(cap, opId, entry, args, raw, localRefs, results);
            break;
    }
}

const REF_KINDS: Record<string, RefKind> = { curveRef: "curve", surfaceRef: "surface", shapeRef: "shape" };

/** Geometry-producing queries hand back a registered ref (or null) instead of raw geometry. */
function recordGeometryRef(
    cap: QueryCapability,
    opId: string,
    entry: LocalRef,
    args: unknown[],
    raw: unknown,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    if (raw === undefined || raw === null) {
        results[opId] = null;
        return;
    }
    const kind = REF_KINDS[cap.returnKind];
    setRef(localRefs, opId, {
        nodeId: entry.nodeId,
        kind,
        value: raw,
        parent: entry,
        name: cap.name,
        args,
    });
    results[opId] = { ref: opId, kind };
}

/** Sub-shape lists register one ref per element (`q1#0`, `q1#1`, ...) for later ops. */
function recordSubShapeRefs(
    cap: QueryCapability,
    opId: string,
    entry: LocalRef,
    args: unknown[],
    raw: unknown,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    const refs = (raw as IShape[]).map((shape, i) => {
        const ref = `${opId}#${i}`;
        setRef(localRefs, ref, {
            nodeId: entry.nodeId,
            kind: "shape",
            value: shape,
            parent: entry,
            name: cap.name,
            args,
            index: i,
        });
        return ref;
    });
    results[opId] = { count: refs.length, refs, kind: "shape" };
}

async function runProgram(ops: Op[]): Promise<string> {
    const doc = activeDocument();
    const factory = globalThis.app.shapeProvider.factory;
    const localRefs = sessionRefs(doc);
    const created: CreatedNode[] = [];
    const results: Record<string, unknown> = {};

    Transaction.execute(doc, "AI program", () => {
        for (const op of ops) {
            try {
                runOp(op, doc, factory, localRefs, created, results);
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                const where =
                    op.target !== undefined ? `target "${String(op.target)}"` : `id "${op.id ?? ""}"`;
                throw new Error(`op "${op.method}" (${where}) failed: ${message}`);
            }
        }
        doc.visual.update();
    });

    return JSON.stringify({ created, results });
}

/**
 * Derive op (not a factory method): multiply a referenced shape's placement by a
 * transform and create a new node with the result. The source node is unchanged.
 */
function runTransformedMul(
    op: Op,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
): void {
    if (op.args?.["shape"] === undefined) {
        throw new Error("transformedMul requires args.shape (an op id or node id)");
    }
    const shape = resolveShape(op.args["shape"], doc, localRefs, new Set());
    const matrix = buildTransformMatrix(op.args);
    if (typeof matrix === "string") throw new Error(matrix);
    const transformed = shape.transformedMul(matrix);

    addCreatedNode(op, doc, localRefs, created, op.name ?? op.method, Result.ok(transformed));
}

/** Create the scene node for an op result, register its ref and report it as created. */
function addCreatedNode(
    op: Op,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    name: string,
    shape: Result<IShape>,
): void {
    const node = new EditableShapeNode({ document: doc, name, shape });
    doc.modelManager.addNode(node);
    if (op.id) setRef(localRefs, op.id, { nodeId: node.id, kind: "shape", value: shape.value });
    created.push({ id: op.id, nodeId: node.id, name });
}

function runOp(
    op: Op,
    doc: IDocument,
    factory: unknown,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    results: Record<string, unknown>,
): void {
    if (op.method === "transformedMul") {
        runTransformedMul(op, doc, localRefs, created);
        return;
    }
    const cap = shapeCapabilities.find((c) => c.method === op.method);
    if (!cap) {
        runQueryOp(op, doc, localRefs, results);
        return;
    }
    runShapeOp(cap, op, doc, factory, localRefs, created, results);
}

function runQueryOp(
    op: Op,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    const query = queryCapabilities.find((c) => c.method === op.method);
    if (!query) throw new Error(`unknown method "${op.method}"`);
    runQuery(query, op, doc, localRefs, results);
}

function runShapeOp(
    cap: ShapeCapability,
    op: Op,
    doc: IDocument,
    factory: unknown,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    results: Record<string, unknown>,
): void {
    const consumed = new Set<string>();
    const params = cap.params.map((p) => coerce(p, op.args?.[p.name], doc, localRefs, consumed));
    const raw = (factory as unknown as Record<string, (...a: unknown[]) => unknown>)[op.method](...params);
    const result = raw instanceof Result ? raw : Result.ok(raw);
    if (!result.isOk) throw new Error(result.error);

    consumeEditInputs(op.method, doc, localRefs, consumed);
    if (cap.returnKind === "shapeWithData") {
        // { shape, ...extras } — node from .shape; array extras (e.g. newEdges) become refs.
        const { shape, ...extras } = result.value as { shape: IShape } & Record<string, unknown>;
        addCreatedNode(op, doc, localRefs, created, op.name ?? cap.method, Result.ok(shape));
        recordExtras(op, localRefs, extras, results);
        return;
    }
    addCreatedNode(op, doc, localRefs, created, op.name ?? cap.method, result);
}

/**
 * Array extras of a shapeWithData result (removeFillet's newEdges) are registered as
 * `<opId>#<key>#<i>` refs and reported in results. They are snapshots (no member name in
 * their derivation): refreshing re-validates the source node but keeps the captured geometry.
 */
function recordExtras(
    op: Op,
    localRefs: Map<string, LocalRef>,
    extras: Record<string, unknown>,
    results: Record<string, unknown>,
): void {
    if (!op.id) return;
    const parent = localRefs.get(op.id);
    if (!parent) return;
    for (const [key, value] of Object.entries(extras)) {
        if (!Array.isArray(value)) continue;
        const refs = value.map((item, i) => {
            const ref = `${op.id}#${key}#${i}`;
            setRef(localRefs, ref, { nodeId: parent.nodeId, kind: "shape", value: item, parent });
            return ref;
        });
        results[`${op.id}.${key}`] = { count: refs.length, refs, kind: "shape" };
    }
}

/**
 * Edit-style ops replace their inputs: remove the pre-edit / intermediate
 * nodes. Read/derive ops leave referenced nodes in the scene.
 */
function consumeEditInputs(
    method: string,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
): void {
    if (!EDIT_METHODS.has(method)) return;
    for (const id of consumed) {
        const node = doc.modelManager.findNodes((n) => n.id === id)[0];
        node?.parent?.remove(node);
        for (const [key, entry] of [...localRefs]) {
            if (entry.nodeId === id) localRefs.delete(key);
        }
    }
}

function buildModelingTool(): Tool {
    return {
        name: "run_program",
        description:
            'Run a sequence of modeling and query operations in one call. The single argument is an object { "ops": [...] } where ops run in order. Creation ops have "method" (a modeling capability), "args", optional "id" (referenced by later ops) and optional "name"; they return created nodes. Query ops have "method" (a query like "face.area" or "shape.volume"), "target" (a ref) and "id"; their values come back in "results". Use load_skill("shape-query") for the full query reference. A ref arg takes an op id, a sub-shape/curve/surface ref, or an existing node id; refs stay valid across run_program calls on the same document and re-resolve against the live scene, so an edited node is seen through its current shape (a ref whose source node was deleted fails with a clear error — re-run the query that produced it).',
        parameters: runProgramParameters(),
        handler: handleRunProgram,
    };
}

function runProgramParameters(): JsonSchema {
    return {
        type: "object",
        properties: {
            ops: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: {
                            type: "string",
                            description: "Optional name for this op's result; later ops reference it",
                        },
                        method: {
                            type: "string",
                            enum: [
                                ...shapeCapabilities.map((c) => c.method),
                                ...queryCapabilities.map((c) => c.method),
                                ...EXTRA_OP_METHODS,
                            ],
                        },
                        args: {
                            type: "object",
                            description: "Method parameters, per the system prompt's JSON encoding",
                        },
                        target: {
                            type: "string",
                            description:
                                "Query ops only: the ref (op id, node id, sub-shape or curve/surface ref) to inspect",
                        },
                        name: {
                            type: "string",
                            description: "Optional display name for the resulting node",
                        },
                    },
                    required: ["method"],
                },
            },
        },
        required: ["ops"],
    };
}

function handleRunProgram(args: Record<string, unknown>): Promise<string> {
    const ops = Array.isArray(args) ? args : (args as { ops?: unknown }).ops;
    if (!Array.isArray(ops)) {
        return Promise.resolve(
            JSON.stringify({
                error: 'run_program requires an "ops" array, e.g. {"ops":[{"method":"box","args":{...}}]}',
            }),
        );
    }
    return runProgram(ops as Op[]);
}

export function buildCapabilityTools(): Tool[] {
    return [buildModelingTool()];
}
