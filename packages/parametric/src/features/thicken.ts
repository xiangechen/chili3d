// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, LENGTH_UNITS, Result, resolveUnitSpec } from "@chili3d/core";
import { trackedBoolean } from "./boolean";
import {
    type FeatureContext,
    type FeatureHandler,
    registerFeature,
    type ThickenFeatureData,
} from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { type ThickenIds, type ThickenInput, thickenInputsOf, thickenTracked } from "./thickenTracked";

/**
 * Thicken: the faces a `source` names are offset by a thickness into a solid, which then combines
 * with the chain input if an operation was asked for.
 *
 * Structured like `pressPull.ts` — the same `source` contract, the same world-space faces mapped
 * back into the host's space for the boolean — because a thicken IS a press-pull whose kernel call
 * offsets instead of sweeping. The difference is what the thickness means: a press-pull's `depth`
 * is a distance swept, a thicken's is a width created, and it can reach to both sides of the face
 * (`planOf`).
 */

const thickenHandler: FeatureHandler<ThickenFeatureData> = {
    display: "command.feature.thicken",
    icon: "icon-thickSolid",
    // Deliberately NOT `reselectable`: the panel's Reselect action routes through
    // `ParametricBodyNode.reselectSession`, which has no face picker for a body source — the
    // flag would put a dead action on the row. Re-picking means deleting and re-adding the
    // feature until that session exists.

    nodeIds: (feature) => [feature.source.nodeId],

    parameters: (feature) => [
        {
            key: "thickness",
            display: "option.command.thickness",
            value: feature.thickness,
            unit: LENGTH_UNITS,
        },
        {
            key: "midplane",
            display: "option.command.symmetric",
            value: feature.midplane ?? false,
        },
        { key: "reverse", display: "option.command.oppositeDirection", value: feature.reverse ?? false },
        // Only meaningful off the midplane, where `thickness` is the total width (see the feature
        // data), so that is where its row belongs. The VALUE stays on the feature either way —
        // the user's typed number must survive a midplane toggle, it just stops driving the
        // geometry (see `resolveThickenPlan`).
        {
            key: "thickness2",
            display: "option.command.thickness2",
            value: feature.thickness2 ?? 0,
            unit: LENGTH_UNITS,
            visibleWhen: [{ key: "midplane", value: false }],
        },
    ],

    setParameter: (feature, key, value) =>
        key === "midplane" || key === "reverse"
            ? { ...feature, [key]: value === true || value === "true" }
            : { ...feature, [key]: value },

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined
            ? feature
            : { ...feature, source: { ...feature.source, profiles: resolvedProfiles } },

    evaluate(feature, context): Result<IShape> {
        const plan = resolveThickenPlan(feature, context);
        if (!plan.isOk) return Result.err(plan.error);
        const resolved = resolveThickenFaces(feature, context);
        if (!resolved.isOk) return Result.err(resolved.error);
        const { inputs, owned } = resolved.value;
        try {
            const built = buildThickened(inputs, plan.value);
            if (!built.isOk) return Result.err(built.error);
            return combineWithInput(built.value, feature, context);
        } finally {
            owned.forEach((x) => x.dispose());
        }
    },
};

/**
 * The signed thicknesses one thicken offsets by, one per direction — the plan `thickenTracked`
 * runs. Onshape's dialog in three rules:
 *
 * - **Midplane** (`midplane`): `thickness` is the TOTAL width, straddling the face — half each way.
 * - **Otherwise**: `thickness` reaches to one side and `thickness2` (when given) to the other.
 * - **Opposite Direction** (`reverse`) negates the values, NOT their order: the two directions are
 *   named by their position in this list (`:neg` from the second on), so swapping them would move
 *   every id of one half onto the other half's geometry on the next rebuild.
 */
function resolveThickenPlan(feature: ThickenFeatureData, context: FeatureContext): Result<number[]> {
    const thickness = resolveUnitSpec(feature.thickness, context.scope, LENGTH_UNITS);
    if (!thickness.isOk) return Result.err(thickness.error);
    const thickness2 = resolveUnitSpec(feature.thickness2 ?? 0, context.scope, LENGTH_UNITS);
    if (!thickness2.isOk) return Result.err(thickness2.error);
    const sign = feature.reverse === true ? -1 : 1;

    if (feature.midplane === true) {
        return Result.ok([(thickness.value / 2) * sign, (-thickness.value / 2) * sign]);
    }
    const second = thickness2.value === 0 ? [] : [-thickness2.value * sign];
    return Result.ok([thickness.value * sign, ...second]);
}

/** The faces to thicken, re-matched on the source body's current geometry, wrapped as kernel inputs. */
function resolveThickenFaces(
    feature: ThickenFeatureData,
    context: FeatureContext,
): Result<{ inputs: ThickenInput[]; owned: IFace[] }> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, edgeIdsOf, owned } = resolved.value;
    const matched = matchSourceFaceIndexes(worldFaces, faceIds, feature.source.profiles);
    if (!matched.isOk) {
        owned.forEach((x) => x.dispose());
        return Result.err(matched.error);
    }
    // Re-anchor on the faces actually matched — one ref per adopted face, so a face split since
    // the pick becomes one ref per piece. Same drift-from-latest-match contract as press-pull.
    // `captureNormal` stays off: a thicken accepts curved faces too, and the planar normal gate
    // would reject a legitimate re-match of one.
    if (context.tracking !== undefined) {
        context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
            captureProfileRef(
                worldFaces[faceIndex],
                faceIds?.[faceIndex],
                feature.source.profiles[matched.value.refIndexes[k]].splitPiece,
            ),
        );
    }
    const faces = matched.value.indexes.map((index) => worldFaces[index]);
    const ids = matched.value.indexes.map((index) => faceIds?.[index]);
    const inputs = thickenInputsOf(faces, ids, (k) => edgeIdsOf(matched.value.indexes[k]));
    if (!inputs.isOk) {
        owned.forEach((x) => x.dispose());
        return Result.err(inputs.error);
    }
    return Result.ok({ inputs: inputs.value, owned });
}

/**
 * Runs every input through the thicken, with ids. Falls back to the plain kernel calls when the
 * kernel offers no tracked thicken — the same geometry with no ids at all, which the body then
 * degrades to geometric matching (see `trackedIds` in feature.ts).
 */
function buildThickened(inputs: readonly ThickenInput[], plan: readonly number[]): Result<ThickenIds> {
    if (shapeFactory.makeThickSolidBySimpleTracked === undefined) return buildPlain(inputs, plan);
    const built: ThickenIds[] = [];
    for (const input of inputs) {
        const one = thickenTracked(input, plan);
        if (one === undefined) return buildPlain(inputs, plan);
        if (!one.isOk) return Result.err(one.error);
        built.push(one.value);
    }
    if (built.length === 1) return Result.ok(built[0]);
    // Disconnected face sets: they land as one compound, exactly as a multi-profile sweep does —
    // and they are fused instead when they happen to touch (`thickenTracked` owns the merge for
    // the directions of a single set, this one for the sets themselves).
    return combineIds(built);
}

/** The untracked path: the same faces offset by the same widths, with every id left undefined. */
function buildPlain(inputs: readonly ThickenInput[], plan: readonly number[]): Result<ThickenIds> {
    const shapes: IShape[] = [];
    for (const input of inputs) {
        for (const thickness of plan) {
            const one = shapeFactory.makeThickSolidBySimple(input.shape, thickness);
            if (!one.isOk) {
                shapes.forEach((x) => x.dispose());
                return Result.err(one.error);
            }
            shapes.push(one.value);
        }
    }
    const combined = shapeFactory.combine(shapes);
    if (!combined.isOk) {
        shapes.forEach((x) => x.dispose());
        return Result.err(combined.error);
    }
    shapes.forEach((x) => x.dispose());
    return Result.ok({ shape: combined.value, faceIds: [], edgeIds: [] });
}

/** One compound out of the sets' thickened solids, with their id arrays concatenated. */
function combineIds(built: readonly ThickenIds[]): Result<ThickenIds> {
    const combined = shapeFactory.combine(built.map((x) => x.shape));
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({
        shape: combined.value,
        faceIds: built.flatMap((x) => x.faceIds),
        edgeIds: built.flatMap((x) => x.edgeIds),
    });
}

/**
 * Combines the thickened solid with the chain input, when an operation was asked for. Join / cut /
 * intersect take the tracked boolean so downstream refs keep their ids through it; the plain path
 * is the same geometry with no ids. Without an operation the solid IS the feature's output — the
 * standalone body, exactly as a press-pull with no operation.
 */
function combineWithInput(
    built: ThickenIds,
    feature: ThickenFeatureData,
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
        return Result.err("Thicken join/cut/intersect requires a preceding feature");
    }
    const tracked = trackedBoolean(operation);
    const tracking = context.tracking;
    if (tracked === undefined || tracking === undefined) return combinePlain(built, operation, context);

    const owned: IShape[] = [];
    try {
        // The thickened solid arrives in world coordinates; the boolean runs in the host's space.
        const tool = mapToolToHost(built, context, owned);
        return applyTrackedOperation(input, tracking, tracked, tool);
    } finally {
        owned.forEach((x) => x.dispose());
        built.shape.dispose();
    }
}

/** The untracked join/cut/intersect — used when the kernel or the body offers no tracking. */
function combinePlain(
    built: ThickenIds,
    operation: NonNullable<ThickenFeatureData["operation"]>,
    context: FeatureContext,
): Result<IShape> {
    const input = context.input;
    if (input === undefined) {
        built.shape.dispose();
        return Result.err("Thicken join/cut/intersect requires a preceding feature");
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

registerFeature("thicken", thickenHandler);
