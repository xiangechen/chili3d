// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    type IWire,
    Result,
    ShapeNode,
    ShapeTypes,
    type SweepProfileMode,
    SweepProfileModes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { isBodyTrackingNode } from "./bodyTracking";
import { trackedBoolean } from "./boolean";
import { matchEdgesAnchored } from "./edgeMatcher";
import { type EdgeRef, withoutHoles } from "./edgeRef";
import { findSketch } from "./extrude";
import {
    type BooleanOperation,
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type FeatureNodeRef,
    registerFeature,
    type ShapeTracking,
    type SweepFeatureData,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mapToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef } from "./profileRef";
import { profileEdgeSeeds } from "./profileSeeds";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { boundaryId, derivedId } from "./trackedId";

const sweepHandler: FeatureHandler<SweepFeatureData> = {
    display: "command.feature.sweep",
    icon: "icon-sweep",
    reselectable: true,

    nodeIds: (feature) => [
        ...new Set(
            [feature.sketchId, feature.source?.nodeId, feature.path.nodeId].filter(
                (x): x is string => x !== undefined,
            ),
        ),
    ],

    // Only the sketch and the path: `source` is the body being swept, which the tree
    // already shows and the feature row does not need a second door to (the extrude
    // handler's `source` contract).
    references: (feature) => {
        const refs: FeatureNodeRef[] = [
            { key: "path", display: "feature.sweep.path", nodeId: feature.path.nodeId },
        ];
        if (feature.sketchId !== undefined) {
            refs.unshift({ key: "sketchId", display: "body.sketch", nodeId: feature.sketchId });
        }
        return refs;
    },

    parameters: (feature) => [
        {
            key: "isRoundCorner",
            display: "option.command.isRoundCorner",
            value: feature.isRoundCorner ?? false,
        },
        {
            key: "profileControl",
            display: "feature.sweep.profileControl",
            value: feature.profileControl ?? "frenet",
            choices: SweepProfileModes.map((value) => ({ value, display: PROFILE_CONTROL_DISPLAY[value] })),
        },
    ],

    setParameter: (feature, key, value) => {
        if (key === "isRoundCorner") {
            return { ...feature, [key]: value === true || value === "true" };
        }
        if (key === "profileControl") {
            // The dropdown constrains the panel; a hand-edited file is refused here too.
            return SweepProfileModes.includes(value as SweepProfileMode)
                ? { ...feature, profileControl: value as SweepProfileMode }
                : feature;
        }
        return { ...feature, [key]: value };
    },

    applyResolvedRefs: (feature, { resolvedProfiles, resolvedEdges }) => {
        let next = feature;
        if (resolvedProfiles !== undefined) {
            next =
                feature.source === undefined
                    ? { ...next, profiles: resolvedProfiles }
                    : { ...next, source: { ...feature.source, profiles: resolvedProfiles } };
        }
        if (resolvedEdges !== undefined) {
            // The path's edges are a set; a slot the shared channel left empty (see `withoutHoles`)
            // simply does not belong in it.
            next = { ...next, path: { ...next.path, edges: withoutHoles(resolvedEdges) } };
        }
        return next;
    },

    evaluate(feature, context): Result<IShape> {
        const owned: IShape[] = [];
        try {
            const profiles = resolveSweepProfiles(feature, context, owned);
            if (!profiles.isOk) return Result.err(profiles.error);
            const path = resolvePathWire(feature, context, owned);
            if (!path.isOk) return Result.err(path.error);
            // Re-anchored refs for the body's write-back (see ShapeTracking);
            // resolvedProfiles is reported by the profile resolution above.
            if (context.tracking !== undefined) context.tracking.resolvedEdges = path.value.anchors;
            const isRoundCorner = feature.isRoundCorner ?? false;
            const mode = resolveProfileMode(feature, profiles.value);
            if (!mode.isOk) return Result.err(mode.error);
            if (feature.operation !== undefined) {
                return sweepWithOperation(
                    feature.operation,
                    context,
                    profiles.value,
                    path.value.wire,
                    isRoundCorner,
                    mode.value,
                );
            }
            if (context.tracking === undefined || !trackedSweepSupports(mode.value)) {
                return sweepPlain(profiles.value, path.value.wire, isRoundCorner, mode.value);
            }
            return sweepTracked(path.value.wire, isRoundCorner, mode.value, profiles.value, context.tracking);
        } finally {
            owned.forEach((x) => x.dispose());
        }
    },
};

/** How one evaluation orients the profile: the mode, plus the binormal a `fixed` mode holds. */
interface SweepOrientation {
    readonly mode: SweepProfileMode;
    /** The first profile's plane normal — required by `fixed`, absent otherwise. */
    readonly fixedDirection?: XYZLike;
}

/**
 * Reads the feature's profile control, defaulting to `frenet` — what every sweep ran before
 * the field existed, so an old document rebuilds bit-for-bit. For `fixed`, the binormal is
 * the first profile's in-plane upright direction (see `fixedBinormal`; profiles of one
 * sketch are coplanar, so one direction serves them all). The token is validated for
 * hand-edited files, the normal for a degenerate profile face.
 */
function resolveProfileMode(
    feature: SweepFeatureData,
    profiles: readonly SweepProfile[],
): Result<SweepOrientation> {
    const mode = feature.profileControl ?? "frenet";
    if (!SweepProfileModes.includes(mode)) return Result.err(`Invalid sweep profile control: ${mode}`);
    if (mode !== "fixed") return Result.ok({ mode });
    const face = profiles[0]?.face;
    if (face === undefined) return Result.err("Sweep requires at least one profile");
    try {
        const binormal = fixedBinormal(face.normal(0, 0)[1]);
        if (binormal === undefined) return Result.err("The sweep profile has no defined plane normal");
        return Result.ok({ mode, fixedDirection: binormal });
    } catch {
        return Result.err("The sweep profile has no defined plane normal");
    }
}

/**
 * The binormal a `fixed` sweep holds: the profile's in-plane "upright" — world +Z projected
 * into the profile plane (+Y when the plane is horizontal, its normal vertical). Always
 * perpendicular to the profile normal, so never parallel to the start tangent of a
 * perpendicular profile — which is exactly what the profile's own NORMAL would be, the one
 * degenerate frame the kernel refuses (measured: a graceful "Failed to sweep profile").
 * Mid-path degeneracy (a tangent aligning with this direction further along) fails the same
 * way, as a feature error.
 */
function fixedBinormal(normal: XYZ): XYZ | undefined {
    const reference = Math.abs(normal.z) > 0.99 ? XYZ.unitY : XYZ.unitZ;
    return reference.sub(normal.multiply(normal.dot(reference))).normalize();
}

/**
 * The untracked sweep: the legacy multi-profile call for `frenet` (bit-for-bit the old
 * behavior), `sweepWithMode` otherwise.
 */
function sweepPlain(
    profiles: readonly SweepProfile[],
    path: IWire,
    isRoundCorner: boolean,
    orientation: SweepOrientation,
): Result<IShape> {
    if (orientation.mode === "frenet" || shapeFactory.sweepWithMode === undefined) {
        if (orientation.mode !== "frenet") {
            return Result.err(`The kernel does not support ${orientation.mode} sweep profile control`);
        }
        return shapeFactory.sweep(
            profiles.map(({ face }) => face),
            path,
            isRoundCorner,
        );
    }
    return shapeFactory.sweepWithMode(
        profiles.map(({ face }) => face),
        path,
        orientation.mode,
        isRoundCorner,
        orientation.fixedDirection,
    );
}

/** True when the kernel can run this mode with history (legacy tracked call or the mode-aware one). */
function trackedSweepSupports(orientation: SweepOrientation): boolean {
    return (
        (orientation.mode === "frenet" && shapeFactory.sweepTracked !== undefined) ||
        shapeFactory.sweepWithModeTracked !== undefined
    );
}

/**
 * One profile to sweep: the face (in the host body's space), plus the naming that
 * gives its swept sub-shapes stable ids — a sketch profile is named by its
 * sketch-entity seed, a `source` body face by the face's own tracked id conjoined
 * with the sweep's marker. Undefined seeds leave the swept sub-shapes unnamed, and
 * the matching layer resolves them geometrically (see `trackedIds`).
 */
interface SweepProfile {
    readonly face: IFace;
    /** Seed of the start face — what the profile IS to this sweep. */
    readonly faceSeed: string | undefined;
    /** Seeds of the face's edges, in the face's own findSubShapes(edge) order. */
    readonly edgeSeeds: (edges: readonly IEdge[]) => (string | undefined)[];
    /** Seed of the end cap (the sweep's LastShape); undefined leaves the cap unnamed. */
    readonly capSeed: string | undefined;
}

/**
 * The component that marks a sub-shape name as a path-sweep's own, conjoined with the
 * source face's tracked id — the path-sweep counterpart of press-pull's `push` (see
 * sweepTracked.ts): the source body already answers to the bare face id, and
 * `boundaryId` dedupes, so the sweep's names need a component of their own.
 */
const SWEEP_MARKER = "sweep";

const PROFILE_CONTROL_DISPLAY: Record<SweepProfileMode, I18nKeys> = {
    frenet: "option.command.profileControl.frenet",
    correctedFrenet: "option.command.profileControl.correctedFrenet",
    fixed: "option.command.profileControl.fixed",
};

/** Resolves the profiles to sweep — the sketch's, or the `source` body faces. */
function resolveSweepProfiles(
    feature: SweepFeatureData,
    context: FeatureContext,
    owned: IShape[],
): Result<SweepProfile[]> {
    if (feature.source !== undefined) return resolveSourceProfiles(feature.source, context, owned);
    const sketch =
        feature.sketchId === undefined ? undefined : findSketch(context.document, feature.sketchId);
    if (sketch === undefined) return Result.err("Sketch not found");
    const resolved = resolveProfiles(sketch, feature.profiles);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { profiles, missing, refIndexes } = resolved.value;
    if (context.tracking !== undefined && feature.profiles !== undefined && feature.profiles.length > 0) {
        const anchors = [...feature.profiles];
        for (const [k, profile] of profiles.entries()) {
            anchors[refIndexes[k]] = captureProfileRef(profile.face);
        }
        context.tracking.resolvedProfiles = anchors;
        if (missing.length > 0) context.tracking.unresolved = { key: "profiles", refIndexes: missing };
    }
    return Result.ok(profiles.map((profile) => sketchSweepProfile(sketch, profile, context, owned)));
}

/**
 * A sketch profile, named by its sketch-entity seed (see `profileSeeds.ts`). The face is
 * mapped into the host's space like the path wire and the `source` faces are — the sketch's
 * own coordinates are world coordinates, and the chain input the sweep combines with lives
 * in the host's. The seeds keep reading the SKETCH's face: the entity ids are attributes of
 * it, and the mapped face is a copy that carries none.
 */
function sketchSweepProfile(
    sketch: SketchNode,
    profile: ResolvedProfile,
    context: FeatureContext,
    owned: IShape[],
): SweepProfile {
    const faceSeed = `sketch:${sketch.id}:${profile.seed}`;
    return {
        face: mapToHost(profile.face, sketch, context, owned) as IFace,
        faceSeed,
        edgeSeeds: (edges) => profileEdgeSeeds(profile.face, faceSeed, edges),
        capSeed: `${faceSeed}:cap`,
    };
}

/**
 * The `source` body faces matched this run (see `matchSourceFaceIndexes`), mapped into
 * the host's space for the sweep. The stored refs re-anchor on the faces actually
 * swept — one ref per adopted face, in world coordinates (the `source` contract),
 * before `mapToHost` copies them — the same drift-from-latest-match contract as the
 * sketch path.
 */
function resolveSourceProfiles(
    source: NonNullable<SweepFeatureData["source"]>,
    context: FeatureContext,
    owned: IShape[],
): Result<SweepProfile[]> {
    const resolved = resolveSourceFaces(source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, edgeIdsOf } = resolved.value;
    owned.push(...resolved.value.owned);
    const matched = matchSourceFaceIndexes(worldFaces, faceIds, source.profiles);
    if (!matched.isOk) return Result.err(matched.error);
    if (context.tracking !== undefined) {
        context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
            captureProfileRef(
                worldFaces[faceIndex],
                faceIds?.[faceIndex],
                source.profiles[matched.value.refIndexes[k]].splitPiece,
                true,
            ),
        );
        // A source face the body no longer has costs the user that pick, not the whole
        // sweep — the same tolerance the sketch path above keeps.
        if (matched.value.missing.length > 0) {
            context.tracking.unresolved = { key: "profiles", refIndexes: matched.value.missing };
        }
    }
    return Result.ok(
        matched.value.indexes.map((index) =>
            sourceSweepProfile(
                mapToHost(worldFaces[index], undefined, context, owned) as IFace,
                faceIds?.[index],
                edgeIdsOf(index),
            ),
        ),
    );
}

/**
 * A body face to sweep, named by the face's own tracked id conjoined with the sweep
 * marker — the body already answers to the bare id (the press-pull convention, see
 * `sweepFaceTracked`). A face with no tracked id sweeps unnamed: nothing can name
 * what a nameless face swept, and the geometric re-match takes over instead.
 */
function sourceSweepProfile(
    face: IFace,
    faceId: string | undefined,
    edgeIds: readonly (string | undefined)[] | undefined,
): SweepProfile {
    const faceSeed = faceId === undefined ? undefined : boundaryId([faceId, SWEEP_MARKER]);
    return {
        face,
        faceSeed,
        edgeSeeds: (edges) =>
            edges.map((_, index) => {
                const id = edgeIds?.[index];
                return id === undefined || faceSeed === undefined ? undefined : boundaryId([faceSeed, id]);
            }),
        capSeed: faceSeed === undefined ? undefined : derivedId(faceSeed, ":cap"),
    };
}

/**
 * Join/cut/intersect against the chain input (Fusion-style): the swept profiles are the
 * tool, the preceding feature's shape the target. Tracked when the kernel supports it
 * (downstream refs keep their stable ids across the boolean); the plain path leaves
 * them to re-match geometrically after a rebuild.
 */
function sweepWithOperation(
    operation: BooleanOperation,
    context: FeatureContext,
    profiles: SweepProfile[],
    path: IWire,
    isRoundCorner: boolean,
    orientation: SweepOrientation,
): Result<IShape> {
    if (context.input === undefined) {
        return Result.err("Sweep join/cut/intersect requires a preceding feature");
    }
    const tracking = context.tracking;
    const tracked = trackedBoolean(operation);
    if (tracking !== undefined && tracked !== undefined && trackedSweepSupports(orientation)) {
        const tool = sweepProfilesTracked(path, isRoundCorner, orientation, profiles);
        if (!tool.isOk) return Result.err(tool.error);
        try {
            return applyTrackedOperation(context.input, tracking, tracked, tool.value);
        } finally {
            // The tool is an intermediate input — the kernel reads it eagerly.
            tool.value.shape.dispose();
        }
    }
    const built = sweepPlain(profiles, path, isRoundCorner, orientation);
    if (!built.isOk) return built;
    try {
        switch (operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [built.value]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [built.value]);
            default:
                return shapeFactory.booleanFuse([context.input], [built.value], true);
        }
    } finally {
        built.value.dispose();
    }
}

/** Sweeps each profile with its own tracked kernel call (same geometry — every profile travels the whole spine), then combines. */
function sweepTracked(
    path: IWire,
    isRoundCorner: boolean,
    orientation: SweepOrientation,
    profiles: SweepProfile[],
    tracking: ShapeTracking,
): Result<IShape> {
    const swept = sweepProfilesTracked(path, isRoundCorner, orientation, profiles);
    if (!swept.isOk) return Result.err(swept.error);
    tracking.outputFaceIds = swept.value.faceIds;
    tracking.outputEdgeIds = swept.value.edgeIds;
    return Result.ok(swept.value.shape);
}

/** The swept profiles as one shape with their tracked ids, in findSubShapes order. */
function sweepProfilesTracked(
    path: IWire,
    isRoundCorner: boolean,
    orientation: SweepOrientation,
    profiles: SweepProfile[],
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    const shapes: IShape[] = [];
    const outputFaceIds: (string | undefined)[] = [];
    const outputEdgeIds: (string | undefined)[] = [];
    for (const profile of profiles) {
        const swept = sweepProfileTracked(path, isRoundCorner, orientation, profile);
        if (!swept.isOk) return Result.err(swept.error);
        shapes.push(swept.value.shape);
        outputFaceIds.push(...swept.value.faceIds);
        outputEdgeIds.push(...swept.value.edgeIds);
    }
    if (shapes.length === 1) {
        return Result.ok({ shape: shapes[0], faceIds: outputFaceIds, edgeIds: outputEdgeIds });
    }
    const combined = shapeFactory.combine(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: outputFaceIds, edgeIds: outputEdgeIds });
}

/**
 * Sweeps one profile with kernel history and maps the tracked ids into findSubShapes
 * order (the path-sweep counterpart of `revolveProfileTracked`).
 *
 * A side face the profile edge sweeps takes the edge's seed (`faceEdgeMap`); a face or
 * edge the profile reproduces keeps its input id through the derivation; the end cap is
 * named from the `capFaces` channel. The path-following edges a profile CORNER sweeps
 * have no history to take and stay id-less — the geometric fingerprint re-matches them
 * (see the `trackedIds` contract: a sub-shape nothing can name gets NO id).
 */
function sweepProfileTracked(
    path: IWire,
    isRoundCorner: boolean,
    orientation: SweepOrientation,
    profile: SweepProfile,
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    // The legacy call for `frenet` (bit-for-bit the old behavior), the mode-aware one
    // otherwise — both map to the same kernel entry with mode 0/1/2. Guaranteed live by the
    // caller's `trackedSweepSupports` guard; the type just cannot see it.
    const legacy = shapeFactory.sweepTracked;
    const byMode = shapeFactory.sweepWithModeTracked;
    const call =
        orientation.mode === "frenet" && legacy !== undefined
            ? () => legacy(profile.face, path, isRoundCorner)
            : byMode === undefined
              ? undefined
              : () => byMode(profile.face, path, orientation.mode, isRoundCorner, orientation.fixedDirection);
    if (call === undefined) return Result.err("Sweep tracking is unavailable");
    const result = call();
    if (!result.isOk) return Result.err(result.error);
    const faceEdges = profile.face.findSubShapes(ShapeTypes.edge) as IEdge[];
    // Content-derived edge seeds survive wire re-enumeration (see profileEdgeSeeds).
    const edgeSeeds = profile.edgeSeeds(faceEdges);
    const { edgeMap, faceMap } = completeTrackedHistory([profile.face], result.value, {
        inputEdges: faceEdges,
        inputFaces: [profile.face],
    });
    const faceIds = trackedFaceIds([profile.faceSeed], edgeSeeds, faceMap, result.value.faceEdgeMap);
    // The end cap (the sweep's LastShape) arrives through the dedicated channel — the
    // same contract the prism/revol caps use; empty for a closed path.
    if (profile.capSeed !== undefined) {
        for (const index of result.value.capFaces ?? []) {
            if (index >= 0 && index < faceIds.length) faceIds[index] = profile.capSeed;
        }
    }
    const edgeIds = trackedIds(edgeSeeds, edgeMap);
    return Result.ok({ shape: result.value.shape, faceIds, edgeIds });
}

/**
 * The path as a live reference: the fingerprinted edges are re-matched against the
 * source node's current shape (id channel first, geometric fallback — the same
 * contract as a loft edge section), so editing the picked path moves the sweep.
 * There is no snapshot: a deleted or unmatchable path fails the feature, like a
 * missing loft section.
 */
function resolvePathWire(
    feature: SweepFeatureData,
    context: FeatureContext,
    owned: IShape[],
): Result<{ wire: IWire; anchors: EdgeRef[] }> {
    const node = context.document.modelManager.findNode((n) => n.id === feature.path.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return Result.err("Sweep path body not found");
    const shape = node.shape.value;
    const shapeEdges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edgeIds = isBodyTrackingNode(node) ? shapeEdges.map((_, i) => node.edgeIdAt(i)) : [];
    const matched = matchEdgesAnchored(shape, feature.path.edges, edgeIds);
    if (!matched.isOk) return Result.err(matched.error);

    const wire = shapeFactory.wire(matched.value.indexes.map((index) => shapeEdges[index]));
    if (!wire.isOk) return Result.err(wire.error);
    return Result.ok({
        wire: mapToHost(wire.value, node, context, owned) as IWire,
        anchors: matched.value.anchors,
    });
}

registerFeature("sweep", sweepHandler);
