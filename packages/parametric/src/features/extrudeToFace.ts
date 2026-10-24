// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IFace,
    type IShape,
    Result,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import type { ExtrudePlan } from "./extrudeEnd";
import {
    completeTrackedHistory,
    type ExtrudeFeatureData,
    type FeatureContext,
    type ShapeTracking,
    trackedAncestors,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mapToHost } from "./hostSpace";
import { bornEdgeIdMap, mapOperationIds } from "./operationIds";
import type { ResolvedProfile } from "./profileBuilder";
import {
    profileEdgeEntityIds,
    profileEdgeSeedSuffixes,
    registerProfileEdgeEntities,
    registerProfileEdgeSuffixes,
} from "./profileEntities";
import { profileEdgeSeeds, seedTopFace } from "./profileSeeds";
import { directionsParallel } from "./refGeometry";

/**
 * The surface-conforming `upToFace` end: instead of sweeping to a computed depth and capping
 * with the profile's own plane, the prism is built TO the target face — the end cap is a patch
 * of the target surface itself (kernel `prismToFaceTracked`, BRepFeat's Perform(Until)). This
 * is what "extrude up to a cylinder" must mean: the cap follows the surface, stopping at its
 * near side along the sweep, rather than the tangent plane the sampled-depth path builds.
 *
 * Both sketch paths come here (the press-pull sweep does not): the standalone build (no
 * `operation`) caps the prism in world space; the join/cut build lets the kernel fuse or
 * subtract against the chain input in ONE step — there is no separate boolean, and the base's
 * faces keep their ids through the kernel's own history.
 *
 * Everything else stays on the caller's planar path: the plan's `conformingEnd` flag rules out
 * what the kernel cannot express (offsets, a second depth, a symmetric half), a draft rules
 * itself out, several profiles sweep the old way, and a target that resolves only from its
 * frozen fingerprint — or a plane parallel to the profile, which the planar builder caps
 * exactly — never reaches the kernel. A kernel REFUSAL (the sweep never meets the face, the
 * cap would run past the face's boundary, an unsupported surface) falls back to the planar
 * path too, rather than failing a feature the old path would have built.
 */

/**
 * The shared gates plus the live target face (world); undefined routes to the planar path.
 * The face is the one the PLAN resolved and stashed this very evaluation
 * (`ExtrudePlan.liveEndFace`) — reusing it instead of enumerating and scoring the target
 * body's faces a second time. A missing stash means the live resolution already failed (the
 * frozen fingerprint feeds the planar path), so there is nothing to retry here. Borrowed:
 * the plan's `dispose` releases it.
 */
function conformingEndTarget(
    feature: ExtrudeFeatureData,
    plan: ExtrudePlan,
    draftAngle: number | undefined,
): { face: IFace; id: string | undefined } | undefined {
    if (!plan.conformingEnd || feature.endFace === undefined) return undefined;
    if (draftAngle !== undefined && draftAngle !== 0) return undefined;
    if (shapeFactory.prismToFaceTracked === undefined) return undefined;
    return plan.liveEndFace;
}

/**
 * The forward sweep direction from the plan — auto-reversed toward the target when that
 * lies behind the natural one (`upToAim` in extrudeEnd.ts), which is exactly when this
 * build has work to do. Its ERROR propagates (the planar path would raise the same one);
 * anything else unusual — a second vector — routes to the planar path.
 */
function sweepDirection(plan: ExtrudePlan, sketch: SketchNode): Result<XYZ | undefined> {
    const vecs = plan.vecsOf(sketch.plane.origin, sketch.plane.normal);
    if (!vecs.isOk) return Result.err(vecs.error);
    return Result.ok(vecs.value.length === 1 ? vecs.value[0].normalize() : undefined);
}

/** A plane parallel to the profile's is exact for the planar builder — it keeps those. */
function isParallelPlanarTarget(face: IFace, profileNormal: XYZ): boolean {
    if (!face.surface().isPlanar()) return false;
    const [, normal] = face.normal(0, 0);
    const unit = normal.normalize();
    return unit !== undefined && directionsParallel(unit, profileNormal);
}

/**
 * The conforming standalone prism (no `operation`), in world coordinates like the sweep
 * path's own output. See the module doc for the eligibility rules.
 */
export function extrudeToFaceStandalone(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    sketch: SketchNode,
    profiles: readonly ResolvedProfile[],
    draftAngle: number | undefined,
): Result<IShape> | undefined {
    if (feature.operation !== undefined || profiles.length !== 1) return undefined;
    const target = conformingEndTarget(feature, plan, draftAngle);
    if (target === undefined) return undefined;
    if (isParallelPlanarTarget(target.face, sketch.plane.normal)) return undefined;
    const direction = sweepDirection(plan, sketch);
    if (!direction.isOk) return Result.err(direction.error);
    if (direction.value === undefined) return undefined;
    const built = shapeFactory.prismToFaceTracked!(
        target.face,
        profiles[0].face,
        target.face,
        direction.value,
        "new",
    );
    if (!built.isOk) return undefined;
    nameStandalone(
        context.tracking,
        profiles[0],
        `sketch:${sketch.id}:${profiles[0].seed}`,
        target,
        built.value,
    );
    return Result.ok(built.value.shape);
}

/**
 * The conforming join/cut: one kernel call sweeps the profile to the target face AND applies
 * the operation against the chain input, in the host's space like the tracked boolean's own
 * output. See the module doc for the eligibility rules.
 */
export function extrudeToFaceOperation(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    plan: ExtrudePlan,
    sketch: SketchNode,
    profiles: readonly ResolvedProfile[],
    draftAngle: number | undefined,
): Result<IShape> | undefined {
    const mode = feature.operation === "fuse" ? "join" : feature.operation === "cut" ? "cut" : undefined;
    if (mode === undefined || profiles.length !== 1) return undefined;
    const input = context.input;
    const tracking = context.tracking;
    if (input === undefined || tracking === undefined) return undefined;
    const target = conformingEndTarget(feature, plan, draftAngle);
    if (target === undefined) return undefined;
    // Only THIS call's own copies (the host-space maps below) — the target face itself is
    // the plan's stash, released by the plan's dispose.
    const owned: IShape[] = [];
    try {
        if (isParallelPlanarTarget(target.face, sketch.plane.normal)) return undefined;
        const direction = sweepDirection(plan, sketch);
        if (!direction.isOk) return Result.err(direction.error);
        const hostInverse = context.host.worldTransform().invert();
        const hostDirection =
            direction.value === undefined || hostInverse === undefined
                ? undefined
                : hostInverse.ofVector(direction.value).normalize();
        if (hostDirection === undefined) return undefined;
        const profile = profiles[0];
        const hostProfile = mapProfileToHost(profile.face, context, owned);
        const hostUntil = mapToHost(target.face, undefined, context, owned) as IFace;
        const built = shapeFactory.prismToFaceTracked!(input, hostProfile, hostUntil, hostDirection, mode);
        if (!built.isOk) return undefined;
        nameOperation(
            input,
            tracking,
            hostProfile,
            `sketch:${sketch.id}:${profile.seed}`,
            hostUntil,
            target.id,
            built.value,
        );
        return Result.ok(built.value.shape);
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

/** The profile face in the host's space, its edge attribution re-registered on the copy. */
function mapProfileToHost(face: IFace, context: FeatureContext, owned: IShape[]): IFace {
    const mapped = mapToHost(face, undefined, context, owned) as IFace;
    if (mapped !== face) {
        // A mapped copy is a fresh object: without re-registering, every entity-derived
        // seed comes back undefined (see translateProfileFace in sweepTracked.ts).
        const entities = profileEdgeEntityIds(face);
        if (entities !== undefined) registerProfileEdgeEntities(mapped, entities);
        const suffixes = profileEdgeSeedSuffixes(face);
        if (suffixes !== undefined) registerProfileEdgeSuffixes(mapped, suffixes);
    }
    return mapped;
}

/**
 * The standalone prism's ids — the plain sweep's rules (see `nameSweptPrism` in
 * sweepTracked.ts): the bottom derives from the profile face, the sides from its edges, and
 * the cap is a synthetic end seeded `:top`, since the kernel derives it from nothing. The
 * kernel's history input is [profile, until]; the until slot has one face and no edges of
 * its own (the kernel sweeps up to a wire-free copy), so the edge seeds only ever cover the
 * profile's own edges.
 */
function nameStandalone(
    tracking: ShapeTracking | undefined,
    profile: ResolvedProfile,
    seed: string,
    target: { face: IFace; id: string | undefined },
    tracked: TrackedShape,
): void {
    if (tracking === undefined) return;
    const profileEdges = profile.face.findSubShapes(ShapeTypes.edge) as IEdge[];
    const untilEdges = target.face.findSubShapes(ShapeTypes.edge) as IEdge[];
    const history = completeTrackedHistory([profile.face, target.face], tracked, {
        inputEdges: [...profileEdges, ...untilEdges],
        inputFaces: [profile.face, target.face],
    });
    const edgeSeeds = [
        ...profileEdgeSeeds(profile.face, seed, profileEdges),
        ...untilEdges.map(() => undefined),
    ];
    const faceIds = trackedFaceIds([seed, target.id], edgeSeeds, history.faceMap, tracked.faceEdgeMap);
    seedTopFace(faceIds, seed, history.faceMap, tracked.faceEdgeMap, []);
    const edgeIds = trackedIds(edgeSeeds, history.edgeMap);
    bornEdges(tracked, history.edgeMap, history.outputEdges, history.outputFaces, faceIds).forEach(
        (id, index) => {
            if (edgeIds[index] === undefined) edgeIds[index] = id;
        },
    );
    tracking.outputFaceIds = faceIds;
    tracking.outputEdgeIds = edgeIds;
}

/**
 * The join/cut result's ids. The base's faces keep their ids through the kernel history
 * (`mapOperationIds`, the main/tool contract with the tool slots [profile, until]); the
 * prism's SIDE faces derive from the profile's edges — a channel `mapOperationIds` does not
 * read — and take those edges' seeds; the cap on the target surface is seeded `:top` like a
 * plain prism's.
 */
function nameOperation(
    input: IShape,
    tracking: ShapeTracking,
    profile: IFace,
    seed: string,
    until: IFace,
    untilId: string | undefined,
    tracked: TrackedShape,
): void {
    const history = completeTrackedHistory([input, profile, until], tracked);
    const ancestors = trackedAncestors(history, tracked);
    const profileEdges = profile.findSubShapes(ShapeTypes.edge) as IEdge[];
    const untilEdges = until.findSubShapes(ShapeTypes.edge) as IEdge[];
    const profileSeeds = profileEdgeSeeds(profile, seed, profileEdges);
    const toolEdgeIds = [...profileSeeds, ...untilEdges.map(() => undefined)];
    const faceIds = mapOperationIds(
        input,
        tracking.inputFaceIds,
        [seed, untilId],
        history.faceMap,
        ShapeTypes.face,
        ancestors.faceAncestors,
    );
    // The sides are edge-generated from the profile — a channel mapOperationIds does not
    // read. `faceEdgeMap` indexes the PROFILE's own edge list (the kernel builds it from
    // pbase alone), not the whole input enumeration the edgeMap channel uses.
    tracked.faceEdgeMap?.forEach((edgeIndex, outputIndex) => {
        if (faceIds[outputIndex] === undefined && edgeIndex >= 0 && edgeIndex < profileSeeds.length) {
            faceIds[outputIndex] = profileSeeds[edgeIndex];
        }
    });
    seedTopFace(faceIds, seed, history.faceMap, tracked.faceEdgeMap, []);
    const born = bornEdges(tracked, history.edgeMap, history.outputEdges, history.outputFaces, faceIds);
    tracking.outputFaceIds = faceIds;
    tracking.outputEdgeIds = mapOperationIds(
        input,
        tracking.inputEdgeIds,
        toolEdgeIds,
        history.edgeMap,
        ShapeTypes.edge,
        ancestors.edgeAncestors,
        (index) => born.get(index),
    );
}

/** The rim the cap carves, named by the faces it joins — the boolean carved-curve convention. */
function bornEdges(
    tracked: TrackedShape,
    edgeMap: readonly number[],
    outputEdges: readonly IEdge[],
    outputFaces: readonly IFace[],
    faceIds: readonly (string | undefined)[],
): Map<number, string> {
    return bornEdgeIdMap(tracked.shape, outputEdges, outputFaces, faceIds, (index) => edgeMap[index] < 0);
}
