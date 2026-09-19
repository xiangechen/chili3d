// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    I18n,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type IWire,
    Line,
    Matrix4,
    Plane,
    Result,
    ShapeNode,
    type ShapeType,
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

/** A scene node consumed (removed) by an edit-style op, reported back so the model knows it is gone. */
interface RemovedNode {
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

/** Ids whose defining query returned null: known to the session but holding no geometry. */
const nullRefsByDocument = new WeakMap<IDocument, Set<string>>();

function sessionNullRefs(doc: IDocument): Set<string> {
    let ids = nullRefsByDocument.get(doc);
    if (!ids) {
        ids = new Set();
        nullRefsByDocument.set(doc, ids);
    }
    return ids;
}

/** Register a real ref; the id is no longer considered null-valued. */
function registerRef(doc: IDocument, refs: Map<string, LocalRef>, id: string, entry: LocalRef): void {
    sessionNullRefs(doc).delete(id);
    setRef(refs, id, entry);
}

const MAX_REF_TOKENS = 40;

/**
 * Compress ref ids into a short list for error messages: numeric runs sharing a prefix
 * collapse to `e#0..e#29`; the token list is capped so huge sessions stay readable.
 */
export function summarizeRefIds(refs: Map<string, LocalRef>): string {
    if (refs.size === 0) return I18n.translate("ai.error.noRefs");
    const { groups, tokens } = bucketRefIdsByPrefix(refs);
    for (const [prefix, nums] of groups) {
        for (const token of collapseNumericRun(prefix, nums)) {
            tokens.push(token);
        }
    }
    if (tokens.length > MAX_REF_TOKENS) {
        return `${tokens.slice(0, MAX_REF_TOKENS).join(", ")} … (+${tokens.length - MAX_REF_TOKENS} more)`;
    }
    return tokens.join(", ");
}

/** Buckets `e12`-style ids by their non-numeric prefix; ids without one stay verbatim. */
function bucketRefIdsByPrefix(refs: Map<string, LocalRef>): {
    groups: Map<string, number[]>;
    tokens: string[];
} {
    const groups = new Map<string, number[]>();
    const tokens: string[] = [];
    for (const id of refs.keys()) {
        const m = /^(.*?)(\d+)$/.exec(id);
        if (!m) {
            tokens.push(id);
            continue;
        }
        const nums = groups.get(m[1]) ?? [];
        nums.push(Number(m[2]));
        groups.set(m[1], nums);
    }
    return { groups, tokens };
}

/** Renders sorted numbers as `p0..p9` runs of 3+, listing anything shorter out in full. */
function collapseNumericRun(prefix: string, nums: number[]): string[] {
    nums.sort((a, b) => a - b);
    const tokens: string[] = [];
    let start = 0;
    for (let i = 1; i <= nums.length; i++) {
        if (i < nums.length && nums[i] === nums[i - 1] + 1) continue;
        if (i - start >= 3) {
            tokens.push(`${prefix}${nums[start]}..${prefix}${nums[i - 1]}`);
        } else {
            for (let j = start; j < i; j++) tokens.push(`${prefix}${nums[j]}`);
        }
        start = i;
    }
    return tokens;
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
    if (sessionNullRefs(doc).has(id)) {
        throw new Error(I18n.translate("ai.error.nullRef", id));
    }
    const node = doc.modelManager.findNodes((n) => n.id === id)[0];
    if (node instanceof ShapeNode && node.shape.isOk) {
        consumed.add(node.id);
        return { nodeId: node.id, kind: "shape", value: node.shape.value };
    }
    throw new Error(I18n.translate("ai.error.unknownRef", id, summarizeRefIds(localRefs)));
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

/** The value a derived ref points at: the parent's member, called with the recorded arguments. */
function evaluateMember(target: Record<string, unknown>, entry: LocalRef): unknown {
    const member = target[entry.name ?? ""];
    return typeof member === "function" ? member.apply(target, entry.args ?? []) : member;
}

/** Unwrap the member's Result and pick the recorded index, or fail as a stale ref. */
function selectDerived(id: string, raw: unknown, index: number | undefined): unknown {
    let value = index !== undefined ? (raw as unknown[] | undefined)?.[index] : raw;
    if (value instanceof Result) {
        if (!value.isOk) throw new Error(`ref "${id}" is no longer valid: ${String(value.error)}`);
        value = value.value;
    }
    if (value === undefined || value === null) {
        throw new Error(`ref "${id}" is no longer valid: its source shape changed`);
    }
    return value;
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
    const raw = evaluateMember(target, entry);
    // Void mutation steps (curve.reverse, ...): the mutated parent object stays the value.
    if (raw === undefined && entry.index === undefined) {
        entry.value = target;
        return;
    }
    entry.value = selectDerived(id, raw, entry.index);
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

/** Plurals whose trimmed form is not just the key without its trailing "s". */
const SHAPE_TYPE_ALIASES: Record<string, keyof typeof ShapeTypes> = {
    vertices: "vertex",
    vertexes: "vertex",
};

/**
 * A shapeType argument, as given. The doc names the lower-case singletons (`edge`, `face`, …) but
 * a model just as often writes the plural the UI uses ("edges", "faces"), so both forms resolve —
 * anything else stays a hard error listing the accepted names.
 */
function parseShapeType(v: unknown): ShapeType | undefined {
    if (typeof v !== "string") return undefined;
    const raw = v.trim();
    const exact = ShapeTypes[raw as keyof typeof ShapeTypes];
    if (exact !== undefined) return exact;

    const key = raw.toLowerCase();
    const name =
        SHAPE_TYPE_ALIASES[key] ??
        Object.keys(ShapeTypes).find((k) => {
            const lower = k.toLowerCase();
            return lower === key || lower === key.replace(/s$/, "");
        });
    return name === undefined ? undefined : ShapeTypes[name as keyof typeof ShapeTypes];
}

/** Defaults for geometric params that are safe to omit. */
function defaultValue(p: ShapeCapabilityParam): unknown | undefined {
    // findSubShapes is nearly always "give me the edges" (the indices fillet/chamfer take), and a
    // model that leaves the kind out otherwise loses the whole round trip to a required-parameter
    // error — so the one method whose kind has an obvious answer gets that answer. Every other
    // shapeType parameter must still be given.
    if (p.kind === "shapeType" && p.name === "subshapeType") return ShapeTypes.edge;
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
            const t = parseShapeType(v);
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

/**
 * Inline plane literal: { origin?, normal?, xvec? }. Without a normal it is an XY-oriented
 * plane through origin (default: the world XY plane); with a normal, xvec defaults to unitX
 * (unitY when the normal is parallel to unitX).
 */
function coercePlane(label: string, v: unknown): Plane {
    const p = v as { origin?: unknown; normal?: unknown; xvec?: unknown } | null;
    const origin = p?.origin !== undefined ? coerceXYZ(p.origin, `${label}.origin`) : XYZ.zero;
    if (p?.normal === undefined) {
        return Plane.XY.translateTo(origin);
    }
    const normal = coerceXYZ(p.normal, `${label}.normal`);
    // The Plane constructor rejects an xvec parallel to the normal — fall back to unitY then.
    const fallbackX = normal.isParallelTo(XYZ.unitX) ? XYZ.unitY : XYZ.unitX;
    return new Plane({
        origin,
        normal,
        xvec: p.xvec !== undefined ? coerceXYZ(p.xvec, `${label}.xvec`) : fallbackX,
    });
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

function shapeTypeName(value: unknown): string {
    return nameOfShapeType((value as IShape).shapeType);
}

/**
 * `ShapeType` is a bit flag at runtime (`ShapeTypes.solid === 4`), but the query doc hands the
 * model the name union — decoding here is what makes `results.t === "solid"` work.
 */
function nameOfShapeType(type: ShapeType): string {
    return Object.keys(ShapeTypes).find((k) => ShapeTypes[k as keyof typeof ShapeTypes] === type) ?? "?";
}

function checkQueryOwner(cap: QueryCapability, entry: LocalRef): void {
    if (cap.family !== "shape") {
        if (entry.kind !== cap.family) {
            const type = entry.kind === "shape" ? `${shapeTypeName(entry.value)} shape` : entry.kind;
            const article = /^[aeiou]/i.test(type) ? "an" : "a";
            throw new Error(`${cap.method} requires a ${cap.family} target, got ${article} ${type} ref`);
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

/** Read a member (property or zero-arg method) of a query target, unwrapping Result. */
function readMember(target: unknown, name: string): unknown {
    const member = (target as Record<string, unknown>)[name];
    let raw = typeof member === "function" ? (member as () => unknown).apply(target) : member;
    if (raw instanceof Result) {
        if (!raw.isOk) throw new Error(String(raw.error));
        raw = raw.value;
    }
    return raw;
}

/**
 * Convenience derivation for query targets: curve-family queries accept an edge shape ref
 * (its edge.curve becomes the target) and surface-family queries accept a face shape ref
 * (face.surface). Every curve owner except the family root additionally unwraps a trimmedCurve
 * to its basisCurve — `edge.curve` always yields a trimmedCurve, so without this no type-specific
 * member (`circle.radius`, `conic.eccentricity`) would ever be readable from an edge ref. The
 * two owners that must see the target itself are `curve` (its members report the target's own
 * type, which is what makes `curve.curveType` the documented exception) and `trimmedCurve`
 * (whose members describe the trimming itself). Mutation queries stay strict — they re-register
 * the target ref, which only makes sense for an explicit geometry ref.
 */
function deriveTargetEntry(cap: QueryCapability, entry: LocalRef): LocalRef {
    if (cap.returnKind === "mutate") return entry;
    const unwrapped = unwrapFamilyMember(cap, entry);
    if (cap.family !== "curve" || cap.owner === "curve" || cap.owner === "trimmedCurve") {
        return unwrapped;
    }
    return unwrapTrimmedCurves(unwrapped);
}

/** Replaces an edge/face shape ref with the curve/surface the query family wants to read. */
function unwrapFamilyMember(cap: QueryCapability, entry: LocalRef): LocalRef {
    if (entry.kind !== "shape") return entry;

    const shapeType = (entry.value as IShape).shapeType;
    const member =
        cap.family === "curve" && shapeType === ShapeTypes.edge
            ? "curve"
            : cap.family === "surface" && shapeType === ShapeTypes.face
              ? "surface"
              : undefined;
    if (member === undefined) return entry;

    const value = readMember(entry.value, member);
    if (value === undefined || value === null) return entry;
    return {
        nodeId: entry.nodeId,
        kind: cap.family as RefKind,
        value,
        parent: entry,
        name: member,
    };
}

/** Repeats `trimmedCurve -> basisCurve` until the ref holds an untrimmed curve. */
function unwrapTrimmedCurves(entry: LocalRef): LocalRef {
    let derived = entry;
    while (
        (derived.value as { curveType?: string }).curveType === "trimmedCurve" &&
        (derived.value as Record<string, unknown>)["basisCurve"] != null
    ) {
        derived = {
            nodeId: derived.nodeId,
            kind: "curve",
            value: readMember(derived.value, "basisCurve"),
            parent: derived,
            name: "basisCurve",
        };
    }
    return derived;
}

/** The ref a query runs against, after the kind and owner checks that make a mismatch loud. */
function resolveQueryTarget(
    cap: QueryCapability,
    target: unknown,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
): LocalRef {
    const entry = deriveTargetEntry(cap, resolveRefEntry(target, doc, localRefs, new Set()));
    checkQueryOwner(cap, entry);

    // A type-specific member is simply absent on a target of another kind. The owner checks above
    // are curve-only (a surface carries no kind discriminator), so this is what makes every other
    // mismatch loud — an undefined here would be dropped from the results and read as "no answer".
    if (!(cap.name in (entry.value as Record<string, unknown>))) {
        throw new Error(`${cap.method} does not apply to this target: it has no "${cap.name}"`);
    }
    return entry;
}

/** Call the target's member with the op's arguments, unwrapping the Result it may return. */
function invokeMember(cap: QueryCapability, target: Record<string, unknown>, args: unknown[]): unknown {
    const member = target[cap.name];
    const raw =
        typeof member === "function" ? (member as (...a: unknown[]) => unknown).apply(target, args) : member;
    if (!(raw instanceof Result)) return raw;
    if (!raw.isOk) throw new Error(String(raw.error));
    return raw.value;
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

    const entry = resolveQueryTarget(cap, op.target, doc, localRefs);
    const target = entry.value as Record<string, unknown>;
    const args = cap.params.map((p) => coerce(p, op.args?.[p.name], doc, localRefs, new Set()));
    const raw = invokeMember(cap, target, args);

    if (cap.returnKind === "mutate") {
        recordMutation(cap, op, entry, args, doc, localRefs, results);
        return;
    }
    recordQueryResult(cap, op.id, entry, args, raw, doc, localRefs, results);
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
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    registerRef(doc, localRefs, String(op.target), {
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
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    switch (cap.returnKind) {
        case "data":
            results[opId] = toPlain(raw);
            break;
        case "shapeType":
            results[opId] = nameOfShapeType(raw as ShapeType);
            break;
        case "curveRef":
        case "surfaceRef":
        case "shapeRef":
            recordGeometryRef(cap, opId, entry, args, raw, doc, localRefs, results);
            break;
        case "refList":
            recordSubShapeRefs(cap, opId, entry, args, raw, doc, localRefs, results);
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
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    if (raw === undefined || raw === null) {
        // A null result redefines the id as null: drop any previous real ref with it.
        localRefs.delete(opId);
        sessionNullRefs(doc).add(opId);
        results[opId] = null;
        return;
    }
    const kind = REF_KINDS[cap.returnKind];
    registerRef(doc, localRefs, opId, {
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
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    const refs = (raw as IShape[]).map((shape, i) => {
        const ref = `${opId}#${i}`;
        registerRef(doc, localRefs, ref, {
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
    const removed: RemovedNode[] = [];
    const results: Record<string, unknown> = {};

    // The transaction rolls the scene back on failure; refs registered by this program
    // would dangle (pointing at rolled-back nodes), and refs deleted mid-program belong to
    // nodes the rollback restored — so reset the registries to their pre-program state.
    const nullRefs = sessionNullRefs(doc);
    const refSnapshot = new Map(localRefs);
    const nullSnapshot = new Set(nullRefs);
    try {
        Transaction.execute(doc, "AI program", () => {
            runOps(ops, doc, factory, localRefs, created, removed, results);
            doc.selection.clearSelection();
            doc.visual.update();
        });
    } catch (e) {
        restoreRefRegistries(localRefs, nullRefs, refSnapshot, nullSnapshot);
        throw e;
    }

    return JSON.stringify({ created, removed, results });
}

/** Runs every op in order, restating any failure as an error naming the offending op. */
function runOps(
    ops: Op[],
    doc: IDocument,
    factory: unknown,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    removed: RemovedNode[],
    results: Record<string, unknown>,
): void {
    for (const op of ops) {
        try {
            runOp(op, doc, factory, localRefs, created, removed, results);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const where = op.target !== undefined ? `target "${String(op.target)}"` : `id "${op.id ?? ""}"`;
            throw new Error(`op "${op.method}" (${where}) failed: ${message}`);
        }
    }
}

function restoreRefRegistries(
    localRefs: Map<string, LocalRef>,
    nullRefs: Set<string>,
    refSnapshot: Map<string, LocalRef>,
    nullSnapshot: Set<string>,
): void {
    for (const key of [...localRefs.keys()]) {
        if (!refSnapshot.has(key)) localRefs.delete(key);
    }
    for (const [key, entry] of refSnapshot) {
        if (!localRefs.has(key)) localRefs.set(key, entry);
    }
    for (const key of [...nullRefs]) {
        if (!nullSnapshot.has(key)) nullRefs.delete(key);
    }
    for (const key of nullSnapshot) {
        if (!localRefs.has(key)) nullRefs.add(key);
    }
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
    if (op.id) registerRef(doc, localRefs, op.id, { nodeId: node.id, kind: "shape", value: shape.value });
    created.push({ id: op.id, nodeId: node.id, name });
}

function runOp(
    op: Op,
    doc: IDocument,
    factory: unknown,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    removed: RemovedNode[],
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
    runShapeOp(cap, op, doc, factory, localRefs, created, removed, results);
}

function runQueryOp(
    op: Op,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    results: Record<string, unknown>,
): void {
    const query = queryCapabilities.find((c) => c.method === op.method);
    if (!query) {
        throw new Error(
            `unknown method "${op.method}" — load_skill("modeling-api") lists the modeling methods and load_skill("shape-query") the query methods`,
        );
    }
    runQuery(query, op, doc, localRefs, results);
}

/** The parameter each profile-sweeping op sweeps; everything else takes its args as given. */
const PROFILE_PARAMS: Record<string, string> = { prism: "shape", revolve: "profile" };

/**
 * The model hands a `polygon` (a wire) or a `circle` (an edge) to prism/revolve about as often as
 * it hands over a face, and the factory sweeps it as-is — into an open SHELL, silently, instead of
 * a solid. The app's own extrude/revolve bodies close the profile into a face at their call sites
 * for exactly this reason (`closedProfileToFace` in app's bodys/extrude.ts); this is that step for
 * the ops. An open profile cannot become a face, so it is passed through unchanged.
 */
function closeProfileParam(cap: ShapeCapability, op: Op, params: unknown[], factory: unknown): void {
    const name = PROFILE_PARAMS[op.method];
    if (name === undefined) return;
    const index = cap.params.findIndex((p) => p.name === name);
    if (index < 0) return;

    const profile = params[index] as IShape;
    if (profile.shapeType !== ShapeTypes.wire && profile.shapeType !== ShapeTypes.edge) return;
    if (!profile.isClosed()) return;

    const f = factory as {
        wire(edges: IEdge[]): Result<IWire>;
        face(wires: IWire[]): Result<IFace>;
    };
    let wire = profile as IWire;
    if (profile.shapeType === ShapeTypes.edge) {
        const built = f.wire([profile as IEdge]);
        if (!built.isOk) return;
        wire = built.value;
    }
    const face = f.face([wire]);
    if (face.isOk) params[index] = face.value;
}

function runShapeOp(
    cap: ShapeCapability,
    op: Op,
    doc: IDocument,
    factory: unknown,
    localRefs: Map<string, LocalRef>,
    created: CreatedNode[],
    removed: RemovedNode[],
    results: Record<string, unknown>,
): void {
    const consumed = new Set<string>();
    const params = cap.params.map((p) => coerce(p, op.args?.[p.name], doc, localRefs, consumed));
    closeProfileParam(cap, op, params, factory);
    const raw = (factory as unknown as Record<string, (...a: unknown[]) => unknown>)[op.method](...params);
    const result = raw instanceof Result ? raw : Result.ok(raw);
    if (!result.isOk) throw new Error(result.error);

    consumeEditInputs(op.method, doc, localRefs, consumed, removed);
    if (cap.returnKind === "shapeWithData") {
        // { shape, ...extras } — node from .shape; array extras (e.g. newEdges) become refs.
        const { shape, ...extras } = result.value as { shape: IShape } & Record<string, unknown>;
        addCreatedNode(op, doc, localRefs, created, op.name ?? cap.method, Result.ok(shape));
        recordExtras(op, doc, localRefs, extras, results);
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
    doc: IDocument,
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
            registerRef(doc, localRefs, ref, { nodeId: parent.nodeId, kind: "shape", value: item, parent });
            return ref;
        });
        results[`${op.id}.${key}`] = { count: refs.length, refs, kind: "shape" };
    }
}

/**
 * Edit-style ops replace their inputs: remove the pre-edit / intermediate
 * nodes. Read/derive ops leave referenced nodes in the scene. Removed nodes
 * are reported so the model knows they no longer exist (no hide/delete needed).
 */
function consumeEditInputs(
    method: string,
    doc: IDocument,
    localRefs: Map<string, LocalRef>,
    consumed: Set<string>,
    removed: RemovedNode[],
): void {
    if (!EDIT_METHODS.has(method)) return;
    for (const id of consumed) {
        const node = doc.modelManager.findNodes((n) => n.id === id)[0];
        if (node && !removed.some((r) => r.nodeId === id)) {
            removed.push({ nodeId: id, name: node.name });
        }
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
            'Run a sequence of modeling and query operations in one call — load_skill("modeling-api") first for the creation-method signatures and the argument encoding. The single argument is an object { "ops": [...] } where ops run in order. Creation ops have "method" (a modeling capability), "args", optional "id" (referenced by later ops) and optional "name"; they return created nodes. Query ops have "method" (a query like "face.area" or "shape.volume"), "target" (a ref) and "id"; their values come back in "results". The response is { created, removed, results }: "created" lists new nodes, "removed" lists input nodes consumed by edit-style ops (booleanCut/booleanFuse/fillet/...) — removed nodes no longer exist, do not hide, delete or reference them. Use load_skill("shape-query") for the full query reference. A ref arg takes an op id, a sub-shape/curve/surface ref, or an existing node id; refs stay valid across run_program calls on the same document and re-resolve against the live scene, so an edited node is seen through its current shape (a ref whose source node was deleted fails with a clear error — re-run the query that produced it).',
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
                items: runProgramOpSchema(),
            },
        },
        required: ["ops"],
    };
}

function runProgramOpSchema(): JsonSchema {
    return {
        type: "object",
        properties: {
            id: {
                type: "string",
                description:
                    "Name for this op's result; later ops reference it. Optional for creation ops, required for query ops (they report their value under this id)",
            },
            method: {
                type: "string",
                enum: allOpMethods(),
            },
            args: {
                type: "object",
                description: 'Method parameters — load_skill("modeling-api") documents the encoding',
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
    };
}

/** Every method the model may name in an op: creation capabilities, queries and the extra ops. */
function allOpMethods(): string[] {
    return [
        ...shapeCapabilities.map((c) => c.method),
        ...queryCapabilities.map((c) => c.method),
        ...EXTRA_OP_METHODS,
    ];
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
