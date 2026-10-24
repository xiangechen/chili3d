// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type FeatureParameter,
    type IDocument,
    type IShape,
    LENGTH_UNITS,
    Result,
    type XYZ,
} from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { trackedBoolean } from "./boolean";
import { resolveExtrudeDraft } from "./extrudeDraft";
import { type ExtrudePlan, resolveExtrudePlan } from "./extrudeEnd";
import { extrudeToFaceOperation, extrudeToFaceStandalone } from "./extrudeToFace";
import {
    completeTrackedHistory,
    type ExtrudeEndCondition,
    type ExtrudeFeatureData,
    type FeatureContext,
    type FeatureHandler,
    type FeatureNodeRef,
    registerFeature,
    type ShapeTracking,
} from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation, trackOperation } from "./operation";
import { extrudeFromSourceFaces } from "./pressPull";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef } from "./profileRef";
import { combineShapes, extrudePlain } from "./sweepGeometry";
import { fuseSweptPrisms, sweepFaceTracked } from "./sweepTracked";

export function findSketch(document: IDocument, id: string): SketchNode | undefined {
    const node = document.modelManager.findNode((n) => n.id === id);
    return node instanceof SketchNode ? node : undefined;
}

const END_CONDITIONS: readonly ExtrudeEndCondition[] = ["blind", "throughAll", "upToFace", "upToVertex"];

const extrudeHandler: FeatureHandler<ExtrudeFeatureData> = {
    display: "command.feature.extrude",
    icon: "icon-prism",
    reselectable: true,

    nodeIds: (feature) => [
        ...new Set(
            [
                feature.sketchId,
                feature.source?.nodeId,
                feature.endFace?.nodeId,
                feature.endVertex?.nodeId,
                feature.direction?.nodeId,
            ].filter((x): x is string => x !== undefined),
        ),
    ],

    // `source` stays unlisted — the body being press-pulled is already in the tree, and the
    // feature row needs no second door to it. The end-condition targets and the direction
    // are doors to nodes the user picked on, exactly like the sketch.
    references: (feature) => {
        const refs: FeatureNodeRef[] = [];
        if (feature.sketchId !== undefined) {
            refs.push({ key: "sketchId", display: "body.sketch", nodeId: feature.sketchId });
        }
        if (feature.endFace !== undefined) {
            refs.push({ key: "endFace", display: "feature.extrude.endFace", nodeId: feature.endFace.nodeId });
        }
        if (feature.endVertex !== undefined) {
            refs.push({
                key: "endVertex",
                display: "feature.extrude.endVertex",
                nodeId: feature.endVertex.nodeId,
            });
        }
        if (feature.direction !== undefined) {
            refs.push({
                key: "direction",
                display: "feature.extrude.direction",
                nodeId: feature.direction.nodeId,
            });
        }
        return refs;
    },

    parameters: (feature) => {
        const params: FeatureParameter[] = [
            {
                key: "depth",
                display: "option.command.depth",
                value: feature.depth,
                unit: LENGTH_UNITS,
                // Only blind's depth is the reach. A measured condition hides the row (the
                // value stays on the feature as the fallback), as the create panel does.
                visibleWhen: [{ key: "endCondition", value: "blind" }],
            },
            {
                key: "endCondition",
                display: "feature.extrude.endCondition",
                value: feature.endCondition ?? "blind",
                choices: END_CONDITIONS.map((value) => ({
                    value,
                    display: `feature.extrude.endCondition.${value}` as const,
                })),
            },
        ];
        const condition = feature.endCondition ?? "blind";
        if (condition === "upToFace" || condition === "upToVertex") {
            params.push({
                key: "endOffset",
                display: "feature.extrude.endOffset",
                value: feature.endOffset ?? 0,
                unit: LENGTH_UNITS,
            });
        }
        if (feature.symmetric !== true) {
            params.push({
                key: "depth2",
                display: "feature.extrude.depth2",
                value: feature.depth2 ?? 0,
                unit: LENGTH_UNITS,
            });
        }
        params.push(
            {
                key: "startOffset",
                display: "option.command.startOffset",
                value: feature.startOffset ?? 0,
                unit: LENGTH_UNITS,
            },
            { key: "symmetric", display: "option.command.symmetric", value: feature.symmetric ?? false },
            { key: "reverse", display: "option.command.oppositeDirection", value: feature.reverse ?? false },
            // Zero means straight sides — the draft row doubles as the switch.
            {
                key: "draftAngle",
                display: "feature.extrude.draftAngle",
                value: feature.draftAngle ?? 0,
                unit: ANGLE_UNITS,
            },
        );
        return params;
    },

    setParameter: (feature, key, value) => {
        if (key === "symmetric" || key === "reverse") {
            const checked = value === true || value === "true";
            // A symmetric sweep has no second side — drop the stale depth2 instead of
            // tripping the "cannot be both" guard on the next rebuild.
            if (key === "symmetric" && checked) {
                const { depth2: _, ...rest } = feature;
                return { ...rest, symmetric: true };
            }
            return { ...feature, [key]: checked };
        }
        if (key === "endCondition") {
            return typeof value === "string" && END_CONDITIONS.includes(value as ExtrudeEndCondition)
                ? { ...feature, endCondition: value as ExtrudeEndCondition }
                : feature;
        }
        return { ...feature, [key]: value };
    },

    applyResolvedRefs: (feature, { resolvedProfiles, resolvedEdges, resolvedTargets }) => {
        let next = feature;
        if (resolvedProfiles !== undefined) {
            next =
                next.source === undefined
                    ? { ...next, profiles: resolvedProfiles }
                    : { ...next, source: { ...next.source, profiles: resolvedProfiles } };
        }
        const directionAnchor = resolvedEdges?.[0];
        if (directionAnchor !== undefined && next.direction !== undefined) {
            next = { ...next, direction: { ...next.direction, edge: directionAnchor } };
        }
        if (resolvedTargets?.endFace !== undefined && next.endFace !== undefined) {
            next = { ...next, endFace: { ...next.endFace, profile: resolvedTargets.endFace } };
        }
        if (resolvedTargets?.endVertex !== undefined && next.endVertex !== undefined) {
            next = { ...next, endVertex: { ...next.endVertex, vertex: resolvedTargets.endVertex } };
        }
        return next;
    },

    evaluate(feature, context): Result<IShape> {
        // The angle's own validity reports before the plan's: a bad parameter is more
        // fundamental than a lost end target.
        const draft = resolveExtrudeDraft(feature, context.scope);
        if (!draft.isOk) return Result.err(draft.error);
        const plan = resolveExtrudePlan(feature, context);
        if (!plan.isOk) return Result.err(plan.error);
        try {
            const result = evaluateWithPlan(feature, context, plan.value, draft.value);
            // A lost end target or direction reports only when nothing louder did — a lost
            // profile keeps precedence in the one-slot report.
            if (
                result.isOk &&
                plan.value.unresolved !== undefined &&
                context.tracking !== undefined &&
                context.tracking.unresolved === undefined
            ) {
                context.tracking.unresolved = plan.value.unresolved;
            }
            return result;
        } finally {
            // The stashed live end face (the conforming build's borrowed target) goes with
            // the evaluation.
            plan.value.dispose();
        }
    },
};

function evaluateWithPlan(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): Result<IShape> {
    const tracked = evaluateOperationTracked(feature, context, plan, draftAngle);
    if (tracked !== undefined) return tracked;

    const source = feature.source;
    if (source === undefined) {
        return combineWithInput(extrudeFromSketch(feature, context, plan, draftAngle), feature, context);
    }
    const built = extrudeFromSourceFaces({ ...feature, source }, context, plan, draftAngle);
    if (!built.isOk) return Result.err(built.error);
    // The sweep's ids are the body's ids — without this a standalone press-pull (the default:
    // no `operation`) named nothing (see `extrudeTracked`, the sketch path's counterpart).
    if (context.tracking !== undefined) {
        context.tracking.outputFaceIds = built.value.faceIds;
        context.tracking.outputEdgeIds = built.value.edgeIds;
    }
    return combineWithInput(Result.ok(built.value.shape), feature, context);
}

/**
 * Join/cut/intersect takes the tracked path, so downstream edge refs keep stable ids
 * through the boolean: sketch profiles via `extrudeOperationTracked`, and press-pulled
 * faces via `pressPullOperationTracked` so the body's own face ids survive past this
 * feature and later press-pulls still resolve by id. Returns undefined when no
 * operation was asked for, or when a tracking capability is missing.
 */
function evaluateOperationTracked(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): Result<IShape> | undefined {
    if (feature.operation === undefined) return undefined;
    const source = feature.source;
    return source === undefined
        ? extrudeOperationTracked(feature, context, plan, draftAngle)
        : pressPullOperationTracked({ ...feature, source }, context, plan, draftAngle);
}

/** Combines the freshly built prism with the chain input, when an operation was asked for. */
function combineWithInput(
    built: Result<IShape>,
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<IShape> {
    if (!built.isOk || feature.operation === undefined) return built;
    if (context.input === undefined) {
        built.value.dispose();
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const owned: IShape[] = [];
    try {
        // The prism is built from world-space profiles; the chain input is the host's own
        // shape — the boolean runs in the host's space (see `mapToolToHost`).
        const tool = mapToHost(built.value, undefined, context, owned);
        switch (feature.operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [tool]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [tool]);
            default:
                return shapeFactory.booleanFuse([context.input], [tool], true);
        }
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        owned.forEach((x) => x.dispose());
        built.value.dispose();
    }
}

/** Extrudes the referenced sketch profiles (the classic path). */
function extrudeFromSketch(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): Result<IShape> {
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { sketch, profiles } = resolved.value;
    // A surface-conforming up-to-face end builds without a computed depth (extrudeToFace.ts).
    const conforming = extrudeToFaceStandalone(feature, context, plan, sketch, profiles, draftAngle);
    if (conforming !== undefined) return conforming;
    const vecs = plan.vecsOf(sketch.plane.origin, sketch.plane.normal);
    if (!vecs.isOk) return Result.err(vecs.error);
    const offsetVec = plan.offsetOf(sketch.plane.normal);

    // An operation with unavailable tracking falls back to the plain path — downstream
    // edge fingerprints then re-match geometrically after a rebuild.
    const plain =
        feature.operation !== undefined ||
        context.tracking === undefined ||
        shapeFactory.prismTracked === undefined;
    return plain
        ? extrudePlain(profiles, vecs.value, offsetVec, draftAngle)
        : extrudeTracked(sketch, vecs.value, profiles, context.tracking!, offsetVec, draftAngle);
}

/**
 * Resolves the feature's sketch and the profiles to extrude, re-anchoring the stored
 * fingerprints on the geometry matched this run (see `ShapeTracking.resolvedProfiles`)
 * so the next edit measures drift from here.
 */
function resolveSketchProfiles(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<{ sketch: SketchNode; profiles: ResolvedProfile[] }> {
    const sketch =
        feature.sketchId === undefined ? undefined : findSketch(context.document, feature.sketchId);
    if (sketch === undefined) return Result.err("Sketch not found");

    const resolved = resolveProfiles(sketch, feature.profiles);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { profiles, missing, refIndexes } = resolved.value;
    if (feature.profiles !== undefined && feature.profiles.length > 0 && context.tracking !== undefined) {
        // Written back POSITIONALLY: a pick that is gone keeps its stored ref, so the
        // next edit still has it to re-match and the user still has it to re-pick.
        const anchors = [...feature.profiles];
        for (const [k, profile] of profiles.entries()) {
            anchors[refIndexes[k]] = captureProfileRef(profile.face);
        }
        context.tracking.resolvedProfiles = anchors;
        if (missing.length > 0) {
            context.tracking.unresolved = { key: "profiles", refIndexes: missing };
        }
    }
    return Result.ok({ sketch, profiles });
}

function extrudeTracked(
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    tracking: ShapeTracking,
    offsetVec: XYZ,
    draftAngle: number | undefined,
): Result<IShape> {
    const swept = sweepProfiles(sketch, vecs, profiles, offsetVec, draftAngle);
    if (!swept.isOk) return Result.err(swept.error);
    tracking.outputFaceIds = swept.value.faceIds;
    tracking.outputEdgeIds = swept.value.edgeIds;
    return Result.ok(swept.value.shape);
}

/**
 * Sweeps every profile along each direction with kernel history (sketch-scoped ids)
 * and merges touching prisms, returning the shape with its tracked ids in
 * findSubShapes order. A non-zero `draftAngle` tapers each prism's sides about its
 * start plane before the merge (`sweepFaceTracked`), so the ids it reports already
 * carry the taper's history.
 */
function sweepProfiles(
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    offsetVec: XYZ,
    draftAngle: number | undefined,
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    const shapes: IShape[] = [];
    const faceIds: (string | undefined)[][] = [];
    const edgeIds: (string | undefined)[][] = [];
    for (const profile of profiles) {
        for (const [direction, vec] of vecs.entries()) {
            const swept = sweepFaceTracked(
                profile.face,
                `sketch:${sketch.id}:${profile.seed}`,
                vec,
                offsetVec,
                direction === 0 ? "" : ":neg",
                undefined,
                draftAngle,
            );
            if (!swept.isOk) return Result.err(swept.error);
            shapes.push(swept.value.shape);
            faceIds.push(swept.value.faceIds);
            edgeIds.push(swept.value.edgeIds);
        }
    }
    const fused = fuseSweptPrisms(shapes, faceIds, edgeIds);
    if (fused !== undefined) return fused;
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}

/**
 * Press-pull with join/cut/intersect on the tracked path: the swept prism combines
 * with the chain input via the tracked boolean, so the body's own face ids survive
 * past this feature and later press-pulls still resolve by id — including on the pad
 * this feature raises, whose top is the pressed face's own image (`sweepTracked.ts`).
 * Returns undefined when a tracking capability is missing (the caller falls back to
 * the plain path).
 */
function pressPullOperationTracked(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): Result<IShape> | undefined {
    const tracking = context.tracking;
    const tracked = feature.operation === undefined ? undefined : trackedBoolean(feature.operation);
    if (tracking === undefined || tracked === undefined) return undefined;
    if (context.input === undefined) {
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const built = extrudeFromSourceFaces(feature, context, plan, draftAngle);
    if (!built.isOk) return Result.err(built.error);
    const owned: IShape[] = [];
    try {
        // Source faces arrive in world space; the boolean runs in the host's space.
        const tool = mapToolToHost(built.value, context, owned);
        const result = tracked([context.input], [tool.shape]);
        if (!result.isOk) return Result.err(result.error);
        // Empty when the source face carried no id — an untracked tool, not a misnamed one.
        const completed = completeTrackedHistory([context.input, tool.shape], result.value);
        trackOperation(
            context.input,
            tracking,
            { faceIds: tool.faceIds, edgeIds: tool.edgeIds },
            completed,
            result.value,
        );
        return Result.ok(result.value.shape);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        owned.forEach((x) => x.dispose());
        built.value.shape.dispose();
    }
}

/**
 * Join/cut/intersect on the tracked path: profiles are swept with kernel history
 * (sketch-scoped ids), then combined with the chain input via the tracked boolean —
 * downstream edge refs (fillet/chamfer) keep their stable ids across rebuilds instead
 * of re-matching geometrically, where a large sketch edit strands them between
 * look-alike candidates. Returns undefined when a tracking capability is missing
 * (the caller falls back to the plain path).
 */
function extrudeOperationTracked(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): Result<IShape> | undefined {
    const tracking = context.tracking;
    const tracked = trackedBoolean(feature.operation!);
    if (tracking === undefined || tracked === undefined || shapeFactory.prismTracked === undefined) {
        return undefined;
    }
    const input = context.input;
    if (input === undefined) {
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);

    // A surface-conforming up-to-face end sweeps AND applies the operation in one kernel
    // step (extrudeToFace.ts); everything else sweeps, then booleans.
    const conforming = extrudeToFaceOperation(
        feature,
        context,
        plan,
        resolved.value.sketch,
        resolved.value.profiles,
        draftAngle,
    );
    if (conforming !== undefined) return conforming;

    const vecs = plan.vecsOf(resolved.value.sketch.plane.origin, resolved.value.sketch.plane.normal);
    if (!vecs.isOk) return Result.err(vecs.error);
    const offsetVec = plan.offsetOf(resolved.value.sketch.plane.normal);
    const tool = sweepProfiles(
        resolved.value.sketch,
        vecs.value,
        resolved.value.profiles,
        offsetVec,
        draftAngle,
    );
    if (!tool.isOk) return Result.err(tool.error);
    const owned: IShape[] = [];
    try {
        // Sketch profiles are world coordinates; the boolean runs in the host's space.
        return applyTrackedOperation(input, tracking, tracked, mapToolToHost(tool.value, context, owned));
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        owned.forEach((x) => x.dispose());
        tool.value.shape.dispose();
    }
}

registerFeature("extrude", extrudeHandler);
