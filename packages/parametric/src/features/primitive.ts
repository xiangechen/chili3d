// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FeatureParameter,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    LENGTH_UNITS,
    type ParameterValue,
    Plane,
    Result,
    resolveUnitSpec,
    type Scope,
    ShapeTypes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { trackedBoolean } from "./boolean";
import { type ResolvedDirection, resolveDirectionOverride } from "./extrudeEnd";
import {
    type FeatureContext,
    type FeatureHandler,
    type PrimitiveFeatureData,
    type PrimitiveKind,
    registerFeature,
    type UnresolvedInputs,
} from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { bornEdgeIdMap } from "./operationIds";
import { writeUncontestedIds } from "./trackedId";

/**
 * Primitive: a box, cylinder, sphere or cone stood up at an explicit origin — the chain's
 * starter geometry that needs neither a sketch nor a pick.
 *
 * The shape the kernel makes carries no history a tracked id could hang on (a factory call
 * reports no derivation), so the ids are seeded by CONTENT instead: every face is named from
 * the construction frame it was built on (`prim:<featureId>:<tag>` — the box's six faces by
 * the frame axis their normal points along, a cylinder's/cone's caps as `bottom`/`top` and
 * their wall as `lateral`, the sphere's single face as `sphere`), and every edge is named by
 * the faces it borders (`bornEdgeIdMap`), which leaves a seam — the same face on both sides —
 * unnamed on purpose. The names survive any edit to the sizes because the classification
 * reads the frame, not the measurements.
 */
const primitiveHandler: FeatureHandler<PrimitiveFeatureData> = {
    display: (feature) => KIND_DISPLAY[feature.primitive],
    icon: (feature) => KIND_ICON[feature.primitive],
    reselectable: true,

    nodeIds: (feature) => (hasDirection(feature) ? [feature.direction!.nodeId] : []),

    references: (feature) =>
        hasDirection(feature)
            ? [
                  {
                      key: "direction",
                      display: "feature.primitive.direction",
                      nodeId: feature.direction!.nodeId,
                  },
              ]
            : [],

    parameters: (feature) => {
        const params: FeatureParameter[] = [
            {
                key: "primitive",
                display: "common.type",
                value: feature.primitive,
                choices: PRIMITIVE_KINDS.map((value) => ({ value, display: KIND_DISPLAY[value] })),
            },
            {
                key: "origin.x",
                display: "common.coordX",
                value: feature.origin?.x ?? 0,
                unit: LENGTH_UNITS,
                group: ORIGIN_GROUP,
            },
            {
                key: "origin.y",
                display: "common.coordY",
                value: feature.origin?.y ?? 0,
                unit: LENGTH_UNITS,
                group: ORIGIN_GROUP,
            },
            {
                key: "origin.z",
                display: "common.coordZ",
                value: feature.origin?.z ?? 0,
                unit: LENGTH_UNITS,
                group: ORIGIN_GROUP,
            },
            { key: "dx", display: "box.dx", value: feature.dx ?? 10, unit: LENGTH_UNITS, visibleWhen: BOX },
            { key: "dy", display: "box.dy", value: feature.dy ?? 10, unit: LENGTH_UNITS, visibleWhen: BOX },
            { key: "dz", display: "box.dz", value: feature.dz ?? 10, unit: LENGTH_UNITS, visibleWhen: BOX },
            // One row per kind the field serves, all reading the same field.
            ...rowsForKinds([CYLINDER, SPHERE, CONE], {
                key: "radius",
                display: "circle.radius",
                value: feature.radius,
                fallback: 5,
            }),
            ...rowsForKinds([CONE], {
                key: "radius2",
                display: "feature.primitive.radius2",
                value: feature.radius2,
                fallback: 2,
            }),
            ...rowsForKinds([CYLINDER, CONE], {
                key: "height",
                display: "common.height",
                value: feature.height,
                fallback: 10,
            }),
        ];
        return params;
    },

    setParameter: (feature, key, value) => {
        if (key === "primitive") {
            return typeof value === "string" && PRIMITIVE_KINDS.includes(value as PrimitiveKind)
                ? { ...feature, primitive: value as PrimitiveKind }
                : feature;
        }
        if (key.startsWith("origin.")) {
            const component = key.slice(7);
            if (component !== "x" && component !== "y" && component !== "z") return feature;
            return {
                ...feature,
                origin: {
                    x: feature.origin?.x ?? 0,
                    y: feature.origin?.y ?? 0,
                    z: feature.origin?.z ?? 0,
                    [component]: value,
                },
            };
        }
        return SIZE_KEYS.includes(key) ? { ...feature, [key]: value } : feature;
    },

    applyResolvedRefs: (feature, { resolvedEdges }) => {
        const anchor = resolvedEdges?.[0];
        return anchor === undefined || feature.direction === undefined
            ? feature
            : { ...feature, direction: { ...feature.direction, edge: anchor } };
    },

    evaluate(feature, context): Result<IShape> {
        const params = resolvePrimitiveParams(feature, context);
        if (!params.isOk) return Result.err(params.error);
        const built = buildPrimitive(feature, params.value);
        if (!built.isOk) return Result.err(built.error);
        // A lost direction builds from its frozen fingerprint and says so on the row — there is
        // no other pick competing for the one-slot report.
        if (params.value.lostDirection !== undefined && context.tracking !== undefined) {
            context.tracking.unresolved = params.value.lostDirection;
        }
        return combineWithInput(built.value, feature, context);
    },
};

const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ["box", "cylinder", "sphere", "cone"];

/**
 * The origin components' panel grouping (see `FeatureParameter.group`): the three
 * coordinate fields share one "Origin" row. Shared with the helix feature, which
 * stands its coil up at the same explicit origin.
 */
export const ORIGIN_GROUP = { id: "origin", display: "common.origin" } as const;

const KIND_DISPLAY: Record<PrimitiveKind, I18nKeys> = {
    box: "command.feature.primitiveBox",
    cylinder: "command.feature.primitiveCylinder",
    sphere: "command.feature.primitiveSphere",
    cone: "command.feature.primitiveCone",
};

const KIND_ICON: Record<PrimitiveKind, string> = {
    box: "icon-box",
    cylinder: "icon-cylinder",
    sphere: "icon-sphere",
    cone: "icon-cone",
};

const SIZE_KEYS = ["dx", "dy", "dz", "radius", "radius2", "height"];

/** `visibleWhen` gates for the size rows — one per kind the row serves. */
/** One row per kind a size field serves, all reading the same field. */
type KindRow = readonly { readonly key: string; readonly value: string }[];

/**
 * The same length row once per kind it serves. `visibleWhen` keeps exactly ONE of them on screen,
 * so the shared `key` never names two rows — which is what lets four kinds share a "radius".
 */
function rowsForKinds(
    kinds: readonly KindRow[],
    row: { key: string; display: I18nKeys; value: ParameterValue | undefined; fallback: number },
): FeatureParameter[] {
    return kinds.map((visibleWhen) => ({
        key: row.key,
        display: row.display,
        value: row.value ?? row.fallback,
        unit: LENGTH_UNITS,
        visibleWhen,
    }));
}

const BOX = [{ key: "primitive", value: "box" }] as const;
const CYLINDER = [{ key: "primitive", value: "cylinder" }] as const;
const SPHERE = [{ key: "primitive", value: "sphere" }] as const;
const CONE = [{ key: "primitive", value: "cone" }] as const;

/** The size fields each kind reads — only their expression errors and bounds are enforced. */
const FIELDS_PER_KIND: Record<PrimitiveKind, readonly (keyof PrimitiveSizes)[]> = {
    box: ["dx", "dy", "dz"],
    cylinder: ["radius", "height"],
    sphere: ["radius"],
    cone: ["radius", "radius2", "height"],
};

/** The direction a sphere never reads is also never watched, re-picked or reported. */
function hasDirection(feature: PrimitiveFeatureData): boolean {
    return feature.primitive !== "sphere" && feature.direction !== undefined;
}

/** Everything an evaluation needs, resolved against the document scope (world coordinates). */
interface PrimitiveParams {
    readonly origin: XYZ;
    /** Unit vector; the direction override, else the stored `axis`, else +Z. */
    readonly axis: XYZ;
    readonly dx: number;
    readonly dy: number;
    readonly dz: number;
    readonly radius: number;
    readonly radius2: number;
    readonly height: number;
    /** The lost direction pick, when the frozen fingerprint stood in for it. */
    readonly lostDirection?: UnresolvedInputs;
}

function resolvePrimitiveParams(
    feature: PrimitiveFeatureData,
    context: FeatureContext,
): Result<PrimitiveParams> {
    const origin = resolveOrigin(feature, context.scope);
    if (!origin.isOk) return Result.err(origin.error);
    const sizes = resolveSizes(feature, context.scope);
    if (!sizes.isOk) return Result.err(sizes.error);
    // A sphere has no axis: the override is ignored rather than resolved (or reported lost).
    const direction: ResolvedDirection =
        feature.primitive === "sphere" ? {} : resolveDirectionOverride(feature.direction, context);
    return Result.ok({
        origin: origin.value,
        axis: direction.dir ?? primitiveAxisVector(feature.axis) ?? XYZ.unitZ,
        ...sizes.value,
        lostDirection: direction.lostKey,
    });
}

/**
 * The stored `axis` as a unit vector; undefined when absent or degenerate (a zero-length
 * vector is no direction at all — the +Z fallback takes it). Shared by the evaluate path
 * and `measurePrimitiveShape`, and re-exported for the placement command, which derives its
 * in-plane sizes against the same frame the rebuild will use.
 */
export function primitiveAxisVector(axis: XYZLike | undefined): XYZ | undefined {
    return axis === undefined ? undefined : new XYZ(axis).normalize();
}

function resolveOrigin(feature: PrimitiveFeatureData, scope: Scope): Result<XYZ> {
    const components = [feature.origin?.x, feature.origin?.y, feature.origin?.z].map((value) =>
        resolveUnitSpec(value ?? 0, scope, LENGTH_UNITS),
    );
    const failed = components.find((x) => !x.isOk);
    if (failed !== undefined && !failed.isOk) return Result.err(failed.error);
    const [x, y, z] = components.map((x) => (x.isOk ? x.value : 0));
    return Result.ok(new XYZ({ x, y, z }));
}

interface PrimitiveSizes {
    readonly dx: number;
    readonly dy: number;
    readonly dz: number;
    readonly radius: number;
    readonly radius2: number;
    readonly height: number;
}

const SIZE_DEFAULTS: PrimitiveSizes = { dx: 10, dy: 10, dz: 10, radius: 5, radius2: 2, height: 10 };

/** The sizes while they are being filled in, one field at a time — `SIZE_DEFAULTS` starts them off. */
type SizesInProgress = { -readonly [K in keyof PrimitiveSizes]: PrimitiveSizes[K] };

/**
 * The kind's sizes with the defaults filled in. A field the kind does not read is neither
 * resolved-checked nor validated, so a leftover value from before a type switch — even an
 * expression that no longer resolves — never breaks the new kind's rebuild.
 */
function resolveSizes(feature: PrimitiveFeatureData, scope: Scope): Result<PrimitiveSizes> {
    const fields = kindFields(feature.primitive);
    if (fields === undefined) return Result.err(`Unknown primitive kind: ${feature.primitive}`);
    const sizes: SizesInProgress = { ...SIZE_DEFAULTS };
    for (const key of fields) {
        const resolved = resolveUnitSpec(feature[key] ?? SIZE_DEFAULTS[key], scope, LENGTH_UNITS);
        if (!resolved.isOk) return Result.err(resolved.error);
        sizes[key] = resolved.value;
    }
    const invalid = validateSizes(feature.primitive, sizes);
    return invalid === undefined ? Result.ok(sizes) : Result.err(invalid);
}

/**
 * The size fields a kind reads. A `Record` lookup answers `undefined` for a kind no build of this
 * app wrote — the persisted JSON is not validated against the union — which is why the caller
 * tests for it rather than trusting the type.
 */
function kindFields(kind: PrimitiveKind): readonly (keyof PrimitiveSizes)[] | undefined {
    return FIELDS_PER_KIND[kind];
}

/** The sizes' bounds, as a message — only an explicitly stored bad value can trip these. */
function validateSizes(kind: PrimitiveKind, sizes: PrimitiveSizes): string | undefined {
    switch (kind) {
        case "box":
            return sizes.dx > 0 && sizes.dy > 0 && sizes.dz > 0
                ? undefined
                : "Box dimensions must be positive";
        case "cylinder":
            if (sizes.radius <= 0) return "Cylinder radius must be positive";
            return sizes.height > 0 ? undefined : "Cylinder height must be positive";
        case "sphere":
            return sizes.radius > 0 ? undefined : "Sphere radius must be positive";
        default:
            if (sizes.radius <= 0) return "Cone base radius must be positive";
            if (sizes.radius2 < 0) return "Cone top radius must be non-negative";
            return sizes.height > 0 ? undefined : "Cone height must be positive";
    }
}

/** The built primitive plus its content-seeded sub-shape ids (see the module header). */
export interface BuiltPrimitive {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * The primitive's shape at its parameters, built without a direction override — the command
 * measures one for its target detection, and a freshly committed feature carries no override.
 */
export function measurePrimitiveShape(feature: PrimitiveFeatureData, scope: Scope): Result<IShape> {
    const origin = resolveOrigin(feature, scope);
    if (!origin.isOk) return Result.err(origin.error);
    const sizes = resolveSizes(feature, scope);
    if (!sizes.isOk) return Result.err(sizes.error);
    const axis = primitiveAxisVector(feature.axis) ?? XYZ.unitZ;
    return buildPrimitiveShape(feature.primitive, { origin: origin.value, axis, ...sizes.value });
}

function buildPrimitive(feature: PrimitiveFeatureData, params: PrimitiveParams): Result<BuiltPrimitive> {
    const shape = buildPrimitiveShape(feature.primitive, params);
    if (!shape.isOk) return Result.err(shape.error);
    return Result.ok({ shape: shape.value, ...seedIds(feature, shape.value, params.axis) });
}

function buildPrimitiveShape(kind: PrimitiveKind, params: PrimitiveParams): Result<IShape> {
    switch (kind) {
        case "box":
            return shapeFactory.box(constructionPlane(params), params.dx, params.dy, params.dz);
        case "cylinder":
            return shapeFactory.cylinder(params.axis, params.origin, params.radius, params.height);
        case "cone":
            return shapeFactory.cone(
                params.axis,
                params.origin,
                params.radius,
                params.radius2,
                params.height,
            );
        default:
            return shapeFactory.sphere(params.origin, params.radius);
    }
}

/** The box's construction frame: the axis as its normal, any stable horizontal as its x. */
function constructionPlane(params: PrimitiveParams): Plane {
    return new Plane({ origin: params.origin, normal: params.axis, xvec: primitiveFrameXvec(params.axis) });
}

/**
 * The construction frame's x for an axis: +X for a vertical axis, else the horizontal
 * perpendicular — any stable orthogonal partner serves, since the box's side directions are
 * not referenced by anything (the faces are named by whichever frame axis they face).
 * Exported for the placement command: it measures the dragged rectangle in THIS frame, so
 * the stored dx/dy rebuild exactly the rectangle the user saw.
 */
export function primitiveFrameXvec(axis: XYZ): XYZ {
    if (Math.abs(axis.z) > 1 - 1e-9) return XYZ.unitX;
    return axis.cross(XYZ.unitZ).normalize() ?? XYZ.unitX;
}

/** The ids the factory call cannot supply, derived from the construction frame by content. */
function seedIds(
    feature: PrimitiveFeatureData,
    shape: IShape,
    axis: XYZ,
): { faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] } {
    const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds: (string | undefined)[] = new Array(faces.length).fill(undefined);
    const xvec = primitiveFrameXvec(axis);
    const yvec = axis.cross(xvec);
    const candidates = new Map<number, string>();
    faces.forEach((face, index) => {
        const tag = faceTag(feature.primitive, face, axis, xvec, yvec);
        if (tag !== undefined) candidates.set(index, `prim:${feature.id}:${tag}`);
    });
    writeUncontestedIds(faceIds, candidates);

    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edgeIds: (string | undefined)[] = new Array(edges.length).fill(undefined);
    // Every edge is born here (there is no input to inherit one from), so each is named by
    // the faces it borders; the seam — the same face on both sides — fails the two-named-
    // neighbours guard and stays unnamed on purpose (see `bornEdgeIdMap`).
    for (const [index, id] of bornEdgeIdMap(shape, edges, faces, faceIds, () => true)) {
        edgeIds[index] = id;
    }
    return { faceIds, edgeIds };
}

/**
 * Which construction-frame side a face is, as its id tag. A curved face is the wall
 * (`lateral`); a cap of a cylinder/cone is `bottom` or `top` by which way its normal points
 * along the axis; a box face names the frame axis its normal points along (`+x`…`-z`).
 */
function faceTag(kind: PrimitiveKind, face: IFace, axis: XYZ, xvec: XYZ, yvec: XYZ): string | undefined {
    if (kind === "sphere") return "sphere";
    if (!face.surface().isPlanar()) return "lateral";
    const normal = face.normal(0, 0)[1];
    if (kind !== "box") return normal.dot(axis) < 0 ? "bottom" : "top";
    // A box face is axis-aligned by construction; the 0.9 gate only refuses a surprise.
    let tag: string | undefined;
    let best = 0.9;
    const dots: readonly [string, number][] = [
        ["x", normal.dot(xvec)],
        ["y", normal.dot(yvec)],
        ["z", normal.dot(axis)],
    ];
    for (const [name, dot] of dots) {
        if (Math.abs(dot) > best) {
            best = Math.abs(dot);
            tag = `${dot < 0 ? "-" : "+"}${name}`;
        }
    }
    return tag;
}

/**
 * Combines the primitive with the chain input, when an operation was asked for — the thicken's
 * arrangement: join / cut / intersect take the tracked boolean so downstream refs keep their
 * ids through it, the plain path is the same geometry with no ids, and without an operation
 * the primitive IS the feature's output — the standalone body.
 */
function combineWithInput(
    built: BuiltPrimitive,
    feature: PrimitiveFeatureData,
    context: FeatureContext,
): Result<IShape> {
    const operation = feature.operation;
    if (operation === undefined) {
        if (context.tracking !== undefined) {
            context.tracking.outputFaceIds = built.faceIds;
            context.tracking.outputEdgeIds = built.edgeIds;
        }
        return Result.ok(built.shape);
    }
    const input = context.input;
    if (input === undefined) {
        built.shape.dispose();
        return Result.err("Primitive join/cut/intersect requires a preceding feature");
    }
    const tracked = trackedBoolean(operation);
    const tracking = context.tracking;
    if (tracked === undefined || tracking === undefined) return combinePlain(built, operation, context);

    const owned: IShape[] = [];
    try {
        // The primitive is built in world coordinates; the boolean runs in the host's space.
        const tool = mapToolToHost(built, context, owned);
        return applyTrackedOperation(input, tracking, tracked, tool);
    } finally {
        owned.forEach((x) => x.dispose());
        built.shape.dispose();
    }
}

/** The untracked join/cut/intersect — used when the kernel or the body offers no tracking. */
function combinePlain(
    built: BuiltPrimitive,
    operation: NonNullable<PrimitiveFeatureData["operation"]>,
    context: FeatureContext,
): Result<IShape> {
    const input = context.input;
    if (input === undefined) {
        built.shape.dispose();
        return Result.err("Primitive join/cut/intersect requires a preceding feature");
    }
    const owned: IShape[] = [];
    try {
        const tool = mapToHost(built.shape, undefined, context, owned);
        switch (operation) {
            case "cut":
                return shapeFactory.booleanCut([input], [tool]);
            case "common":
                return shapeFactory.booleanCommon([input], [tool]);
            default:
                return shapeFactory.booleanFuse([input], [tool], true);
        }
    } finally {
        owned.forEach((x) => x.dispose());
        built.shape.dispose();
    }
}

registerFeature("primitive", primitiveHandler);
