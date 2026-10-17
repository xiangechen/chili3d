// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FeatureParameter,
    type IEdge,
    type IShape,
    LENGTH_UNITS,
    type ParameterValue,
    Result,
    resolveUnitSpec,
    type Scope,
    ShapeTypes,
    UNITLESS,
    type UnitSpec,
    XYZ,
} from "@chili3d/core";
import { type ResolvedDirection, resolveDirectionOverride } from "./extrudeEnd";
import {
    type FeatureContext,
    type FeatureHandler,
    type HelixFeatureData,
    registerFeature,
    type UnresolvedInputs,
} from "./feature";
import { ORIGIN_GROUP, primitiveAxisVector, primitiveFrameXvec } from "./primitive";

/**
 * Helix: a helix WIRE — a spring's centreline — standing alone as the body's whole chain,
 * consumed as the path of a later sweep (see `HelixFeatureData` for the two-of-three coil
 * rule). There is no chain input and no boolean scope: the wire IS the feature's output.
 *
 * The kernel call reports no derivation a tracked id could hang on, so the coil's edge ids
 * are seeded by CONTENT instead — the primitive feature's arrangement. The kernel segments
 * the coil into one b-spline edge per turn, deterministically for given parameters, so the
 * i-th segment is named `helix:<featureId>:coil.<i>`: the id survives any edit that keeps
 * the segment (a pitch change), and a segment a turns edit removes loses its id — which is
 * the truth about it.
 */
const helixHandler: FeatureHandler<HelixFeatureData> = {
    display: "command.feature.helix",
    icon: "icon-helix",
    reselectable: true,

    nodeIds: (feature) => (feature.direction !== undefined ? [feature.direction.nodeId] : []),

    references: (feature) =>
        feature.direction === undefined
            ? []
            : [
                  {
                      key: "direction",
                      display: "feature.primitive.direction",
                      nodeId: feature.direction.nodeId,
                  },
              ],

    parameters: (feature) => [
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
        { key: "radius", display: "circle.radius", value: feature.radius, unit: LENGTH_UNITS },
        // The coil trio shows what is STORED, never the derived value — a blank field is the
        // "derive me" state, and repainting it with a number would freeze the derivation.
        { key: "length", display: "common.length", value: feature.length ?? "", unit: LENGTH_UNITS },
        { key: "pitch", display: "helix.pitch", value: feature.pitch ?? "", unit: LENGTH_UNITS },
        { key: "turns", display: "helix.turns", value: feature.turns ?? "", unit: UNITLESS },
    ],

    setParameter: (feature, key, value) => {
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
        if (key === "length" || key === "pitch" || key === "turns") {
            // A blank field clears the value — the rebuild then derives it from the other two.
            const { [key]: _, ...rest } = feature;
            return value === "" ? rest : { ...rest, [key]: value };
        }
        return key === "radius" && typeof value !== "boolean" ? { ...feature, radius: value } : feature;
    },

    applyResolvedRefs: (feature, { resolvedEdges }) => {
        const anchor = resolvedEdges?.[0];
        return anchor === undefined || feature.direction === undefined
            ? feature
            : { ...feature, direction: { ...feature.direction, edge: anchor } };
    },

    evaluate(feature, context): Result<IShape> {
        const params = resolveHelixParams(feature, context);
        if (!params.isOk) return Result.err(params.error);
        const { origin, axis, radius, pitch, turns } = params.value;
        const built = shapeFactory.helix(origin, axis, primitiveFrameXvec(axis), radius, pitch, turns * 360);
        if (!built.isOk) return Result.err(built.error);
        // A lost direction builds from its frozen fingerprint and says so on the row — the
        // primitive feature's arrangement for the same contract.
        if (params.value.lostDirection !== undefined && context.tracking !== undefined) {
            context.tracking.unresolved = params.value.lostDirection;
        }
        if (context.tracking !== undefined) {
            context.tracking.outputEdgeIds = seedEdgeIds(feature, built.value);
        }
        return Result.ok(built.value);
    },
};

/** Everything an evaluation needs, resolved against the document scope (world coordinates). */
interface HelixParams {
    readonly origin: XYZ;
    /** Unit vector; the direction override, else the stored `axis`, else +Z. */
    readonly axis: XYZ;
    readonly radius: number;
    readonly pitch: number;
    readonly turns: number;
    /** The lost direction pick, when the frozen fingerprint stood in for it. */
    readonly lostDirection?: UnresolvedInputs;
}

function resolveHelixParams(feature: HelixFeatureData, context: FeatureContext): Result<HelixParams> {
    const origin = resolveOrigin(feature, context.scope);
    if (!origin.isOk) return Result.err(origin.error);
    const radius = resolveUnitSpec(feature.radius, context.scope, LENGTH_UNITS);
    if (!radius.isOk) return Result.err(radius.error);
    if (radius.value <= 0) return Result.err("Helix radius must be positive");
    const coil = resolveCoil(feature, context.scope);
    if (!coil.isOk) return Result.err(coil.error);
    const direction: ResolvedDirection = resolveDirectionOverride(feature.direction, context);
    return Result.ok({
        origin: origin.value,
        axis: direction.dir ?? primitiveAxisVector(feature.axis) ?? XYZ.unitZ,
        radius: radius.value,
        ...coil.value,
        lostDirection: direction.lostKey,
    });
}

function resolveOrigin(feature: HelixFeatureData, scope: Scope): Result<XYZ> {
    const components = [feature.origin?.x, feature.origin?.y, feature.origin?.z].map((value) =>
        resolveUnitSpec(value ?? 0, scope, LENGTH_UNITS),
    );
    const failed = components.find((x) => !x.isOk);
    if (failed !== undefined && !failed.isOk) return Result.err(failed.error);
    const [x, y, z] = components.map((x) => (x.isOk ? x.value : 0));
    return Result.ok(new XYZ({ x, y, z }));
}

/**
 * The two-of-three coil rule (see `HelixFeatureData`). A stored value that is not positive
 * fails even when it would be the derived one — a bad number on the feature is a bad
 * feature, not a hint to ignore it.
 */
function resolveCoil(feature: HelixFeatureData, scope: Scope): Result<{ pitch: number; turns: number }> {
    const length = resolveOptional(feature.length, scope, LENGTH_UNITS);
    if (!length.isOk) return Result.err(length.error);
    const pitch = resolveOptional(feature.pitch, scope, LENGTH_UNITS);
    if (!pitch.isOk) return Result.err(pitch.error);
    const turns = resolveOptional(feature.turns, scope, UNITLESS);
    if (!turns.isOk) return Result.err(turns.error);
    if (length.value !== undefined && length.value <= 0) return Result.err("Helix length must be positive");
    if (pitch.value !== undefined && pitch.value <= 0) return Result.err("Helix pitch must be positive");
    if (turns.value !== undefined && turns.value <= 0) return Result.err("Helix turns must be positive");

    // All three stored: length and pitch win, turns is re-derived (the app's Helix command
    // takes height and pitch, so they are what the user last meant).
    if (length.value !== undefined && pitch.value !== undefined) {
        return Result.ok({ pitch: pitch.value, turns: length.value / pitch.value });
    }
    if (pitch.value !== undefined && turns.value !== undefined) {
        return Result.ok({ pitch: pitch.value, turns: turns.value });
    }
    if (length.value !== undefined && turns.value !== undefined) {
        return Result.ok({ pitch: length.value / turns.value, turns: turns.value });
    }
    return Result.err("Helix needs two of length, pitch, turns");
}

/** An unset or blank coil field is ABSENT — to be derived — not zero. */
function resolveOptional(
    value: ParameterValue | undefined,
    scope: Scope,
    unit: UnitSpec,
): Result<number | undefined> {
    if (value === undefined || value === "") return Result.ok(undefined);
    const resolved = resolveUnitSpec(value, scope, unit);
    return resolved.isOk ? Result.ok(resolved.value) : Result.err(resolved.error);
}

/** The ids the factory call cannot supply, by content — see the module header. */
function seedEdgeIds(feature: HelixFeatureData, wire: IShape): (string | undefined)[] {
    const edges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.map((_, index) => `helix:${feature.id}:coil.${index}`);
}

registerFeature("helix", helixHandler);
