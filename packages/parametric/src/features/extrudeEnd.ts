// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IFace,
    type IShape,
    type IVertex,
    LENGTH_UNITS,
    type Matrix4,
    Result,
    resolveUnitSpec,
    type Scope,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "./edgeRef";
import type { ExtrudeEndCondition, ExtrudeFeatureData, FeatureContext, UnresolvedInputs } from "./feature";
import { captureProfileRef, type ProfileRef } from "./profileRef";
import { directionsParallel, plainVec } from "./refGeometry";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { matchVertex, type VertexRef } from "./vertexRef";

/**
 * The extrude's end conditions and direction override — everything that decides HOW FAR and
 * WHICH WAY the profiles sweep, resolved once per rebuild against the live document.
 *
 * The output is an `ExtrudePlan`: the sketch path feeds it the sketch plane, the press-pull
 * path each swept face's own plane, and it hands back the sweep vectors (forward, and the
 * backward one when `symmetric`/`depth2` asks) plus the start-offset vector. All geometry the
 * plan reads is WORLD space — sketch planes and press-pull faces both arrive in world
 * coordinates, and the plan's depths mean millimetres along the world sweep direction.
 *
 * End-condition semantics (see `ExtrudeFeatureData` for the field contracts):
 *
 * - **blind** — the stored `depth`, unchanged.
 * - **throughAll** — the depth that carries the prism past the chain input's far side: the
 *   input's bounding-box corner farthest along the direction, plus a small margin so the end
 *   face never lands exactly ON the surface it must cut through. Measured from the profile
 *   plane, so a profile drawn away from the body still reaches. Requires a preceding feature.
 * - **upToVertex** — the end plane (the profile plane translated by the sweep) contains the
 *   target point: depth = n·(V − P0) / (n·dir) − startOffset + endOffset, exact for any
 *   direction (the n·dir quotient is the oblique reach along dir that advances one unit of
 *   plane distance).
 * - **upToFace** — a planar target parallel to the profile plane is exact (the same formula
 *   with any point of the target's plane); anything else — curved, or planar but tilted —
 *   terminates at the face's FARTHEST sampled point along the direction (wire vertices plus
 *   bounding-box corners), so the prism end clears the whole face and cuts separate cleanly.
 *   An exact curved-surface termination needs kernel `BRepFeat` support — out of scope here.
 *
 * `startOffset` composes FIRST (it moves the prism's start off the profile plane); the
 * up-to/through depths are measured from the profile plane and subtract the offset's
 * component along the SWEEP direction, so the end lands on the target whatever the start
 * offset is. The offset itself keeps the unflipped sense (see `ExtrudeFeatureData.reverse`),
 * so with `reverse` set the start plane sits BEHIND the profile plane along the flipped
 * sweep — the signed offset negates and the subtraction becomes an addition.
 *
 * A target that computes to a non-positive depth lies behind the start plane and is a rebuild
 * error. A target that cannot be RESOLVED (node gone, face no longer matching, a rolled-back
 * source showing its session preview) does not fail the feature: the stored fingerprint
 * doubles as the frozen geometry (world capture makes that unambiguous — the node's frame
 * went with it), the blind `depth` stands in when even the fingerprint is unusable, and the
 * loss is reported through `ShapeTracking.unresolved` as the plan's `unresolved` — the caller
 * applies it after the profile resolution, so a lost profile keeps precedence over a lost
 * end target in the one-slot report.
 *
 * `reverse` (Onshape's Opposite Direction) flips the direction the plan hands out: the sweep
 * vectors negate (order preserved, so the `:neg` half's ids stay put), and the up-to/through-all
 * depths measure along the flipped direction — a target on the natural side then computes to a
 * negative depth and fails as behind-the-start-plane, with the error naming the flip as the fix.
 * The start offset keeps the unflipped sense (see `ExtrudeFeatureData.reverse`).
 */
export interface ExtrudePlan {
    /**
     * The sweep vectors for a profile plane (`point`/`normal`, world): the forward vector
     * first, the backward one second when `symmetric`/`depth2` asks. The forward sense is
     * the direction override's, or the plane normal's without an override — negated as a
     * whole when the feature's `reverse` is set.
     */
    vecsOf(point: XYZ, normal: XYZ): Result<XYZ[]>;
    /** The start-offset vector for that plane, along its sweep direction. */
    offsetOf(normal: XYZ): XYZ;
    /** The pick this evaluation could not resolve, if any — applied by the caller. */
    readonly unresolved?: UnresolvedInputs;
}

/**
 * How far past the farthest corner the through-all end reaches. An exact landing would make
 * the end face coincident with the surface it cuts through — the tangential boolean case —
 * so the prism always overshoots by a fixed, invisible amount.
 */
const THROUGH_ALL_MARGIN = 1e-3;

/** |n·dir| below this is a direction parallel to the profile plane — the prism would be degenerate. */
const PARALLEL_DOT = 1e-9;

/** Everything the plan's vector helpers read, resolved once (see `resolveExtrudePlan`). */
interface ExtrudePlanState {
    readonly context: FeatureContext;
    readonly direction: ResolvedDirection;
    readonly target: ResolvedEndTarget;
    readonly condition: ExtrudeEndCondition;
    readonly blindDepth: number;
    readonly endOffset: number;
    /** `startOffset` in the SWEEP's sense, not the unflipped one (see `ExtrudeFeatureData.reverse`). */
    readonly sweepStartOffset: number;
    readonly reverse: boolean;
    readonly depth2: number | undefined;
    readonly symmetric: boolean;
}

/**
 * How far one profile sweeps under this plan's end condition, measured along `dir` — the flipped
 * direction when `reverse` is set. A target the evaluation could not resolve degrades to the blind
 * depth rather than failing: the loss is reported separately, through the plan's `unresolved`.
 */
function endConditionDepth(plan: ExtrudePlanState, point: XYZ, normal: XYZ, dir: XYZ): Result<number> {
    switch (plan.condition) {
        case "throughAll":
            return throughAllDepth(
                plan.context.input!,
                plan.context.host.worldTransform(),
                point,
                dir,
                plan.sweepStartOffset,
                "Extrude",
            );
        case "upToFace":
        case "upToVertex":
            return plan.target.target.kind === "none"
                ? Result.ok(plan.blindDepth)
                : upToDepth(plan.target.target, point, normal, dir, plan.sweepStartOffset, plan.endOffset);
        default:
            return Result.ok(plan.blindDepth);
    }
}

/**
 * The vectors one profile sweeps along: the forward one, and the backward one when
 * `symmetric`/`depth2` asks.
 */
function planVectorsOf(plan: ExtrudePlanState, point: XYZ, normal: XYZ): Result<XYZ[]> {
    // A direction override parallel to the profile plane sweeps a degenerate prism
    // (without an override dir IS the normal — never parallel, and no dot to pay).
    if (plan.direction.dir !== undefined && Math.abs(normal.dot(plan.direction.dir)) < PARALLEL_DOT) {
        return Result.err("Extrude direction is parallel to the profile plane");
    }
    const base = plan.direction.dir ?? normal;
    const dir = plan.reverse ? base.multiply(-1) : base;
    const depth = endConditionDepth(plan, point, normal, dir);
    if (!depth.isOk) return Result.err(depth.error);
    const forward = dir.multiply(depth.value);
    const backward =
        plan.depth2 !== undefined
            ? dir.multiply(-plan.depth2)
            : plan.symmetric
              ? forward.multiply(-1)
              : undefined;
    return Result.ok(backward === undefined ? [forward] : [forward, backward]);
}

export function resolveExtrudePlan(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<ExtrudePlan> {
    const params = resolveEndParams(feature, context.scope);
    if (!params.isOk) return Result.err(params.error);
    const { blindDepth, startOffset, endOffset, depth2 } = params.value;
    if (feature.symmetric === true && depth2 !== undefined) {
        return Result.err("Extrude cannot be both symmetric and have a second depth");
    }

    const direction = resolveDirectionOverride(feature.direction, context);
    const target = resolveEndTarget(feature, context);
    const condition = feature.endCondition ?? "blind";
    if (condition === "throughAll" && context.input === undefined) {
        return Result.err("Extrude through-all requires a preceding feature");
    }
    const reverse = feature.reverse === true;
    const plan: ExtrudePlanState = {
        context,
        direction,
        target,
        condition,
        blindDepth,
        endOffset,
        reverse,
        depth2,
        symmetric: feature.symmetric === true,
        // The start offset rides the UNFLIPPED direction (see `ExtrudeFeatureData.reverse`), so
        // under `reverse` the start plane sits behind the profile plane along the sweep: the
        // offset's component along the sweep direction negates, and subtracting it ADDS it.
        sweepStartOffset: reverse ? -startOffset : startOffset,
    };
    return Result.ok({
        unresolved: direction.lostKey ?? target.unresolved,
        offsetOf: (normal) => (direction.dir ?? normal).multiply(startOffset),
        vecsOf: (point, normal) => planVectorsOf(plan, point, normal),
    });
}

function resolveEndParams(
    feature: ExtrudeFeatureData,
    scope: Scope,
): Result<{ blindDepth: number; startOffset: number; endOffset: number; depth2?: number }> {
    const depth = resolveUnitSpec(feature.depth, scope, LENGTH_UNITS);
    if (!depth.isOk) return Result.err(depth.error);
    const startOffset = resolveUnitSpec(feature.startOffset ?? 0, scope, LENGTH_UNITS);
    if (!startOffset.isOk) return Result.err(startOffset.error);
    const endOffset = resolveUnitSpec(feature.endOffset ?? 0, scope, LENGTH_UNITS);
    if (!endOffset.isOk) return Result.err(endOffset.error);
    const depth2 =
        feature.depth2 === undefined ? undefined : resolveUnitSpec(feature.depth2, scope, LENGTH_UNITS);
    if (depth2 !== undefined && !depth2.isOk) return Result.err(depth2.error);
    if (depth2 !== undefined && depth2.value <= 0) return Result.err("Extrude depth2 must be positive");
    return Result.ok({
        blindDepth: depth.value,
        startOffset: startOffset.value,
        endOffset: endOffset.value,
        depth2: depth2?.value,
    });
}

/**
 * The through-all depth: past the input's far side along `dir`, measured from the plane point.
 *
 * `input`'s bounding box is in its OWN space while `point`/`dir` arrive in world coordinates, so
 * the corners are mapped beside them by `hostWorld` — pass `Matrix4.identity()` when the caller
 * already works in the input's frame (the hole feature does: its plane resolves host-local).
 * Shared with `hole.ts`, whose through-all holes clear the far side by the same margin; `label`
 * only prefixes the error message.
 */
export function throughAllDepth(
    input: IShape,
    hostWorld: Matrix4,
    point: XYZ,
    dir: XYZ,
    sweepStartOffset: number,
    label: string,
): Result<number> {
    const box = input.boundingBox();
    let farthest = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                const corner = hostWorld.ofPoint(new XYZ(x, y, z));
                farthest = Math.max(farthest, dir.dot(corner.sub(point)));
            }
        }
    }
    // `sweepStartOffset` is signed along `dir`: the start plane's reach from the profile
    // plane. Negative (the extrude's unflipped-sense offset under `reverse`) EXTENDS the run.
    const depth = farthest - sweepStartOffset + THROUGH_ALL_MARGIN;
    if (depth <= 0) return Result.err(`${label} target lies behind the start plane`);
    return Result.ok(depth);
}

/** The up-to depth: the reach to the target along `dir`, offset by the start and end offsets. */
function upToDepth(
    target: Exclude<EndTarget, { readonly kind: "none" }>,
    point: XYZ,
    normal: XYZ,
    dir: XYZ,
    sweepStartOffset: number,
    endOffset: number,
): Result<number> {
    const denominator = normal.dot(dir);
    if (Math.abs(denominator) < PARALLEL_DOT) {
        return Result.err("Extrude direction is parallel to the profile plane");
    }
    const reachOf = (p: XYZ) => normal.dot(p.sub(point)) / denominator;
    // A planar target parallel to the profile plane is exact — any of its points gives the
    // plane's reach; sampling would only add the bounding box's padding to it.
    const reach =
        target.kind === "vertex" || (target.kind === "face" && target.parallel(normal))
            ? reachOf(target.point)
            : Math.max(...target.samples.map(reachOf));
    // `sweepStartOffset` is signed along `dir` (see `throughAllDepth`); `endOffset` overshoots
    // along the sweep direction either way.
    const depth = reach - sweepStartOffset + endOffset;
    // Behind the plane along the CURRENT direction — with `reverse` set that is the flipped
    // one, so the message names the flip either way: toggling it reaches the other side.
    if (depth <= 0) {
        return Result.err("Extrude target lies behind the start plane — flip reverse to reach it");
    }
    return Result.ok(depth);
}

/** What an up-to condition terminates at, resolved once per rebuild (world coordinates). */
type EndTarget =
    | { readonly kind: "none" }
    | { readonly kind: "vertex"; readonly point: XYZ }
    | {
          readonly kind: "face";
          /** The face's reference point — exact when the target plane is parallel to the profile's. */
          readonly point: XYZ;
          /** The target plane's normal (unit); drives the parallel check. */
          readonly normal: XYZ;
          /** Wire vertices and bounding-box corners of the face — the farthest one terminates. */
          readonly samples: XYZ[];
          readonly parallel: (profileNormal: XYZ) => boolean;
      };

interface ResolvedEndTarget {
    readonly target: EndTarget;
    readonly unresolved?: UnresolvedInputs;
}

/**
 * The feature's end target. `blind`/`throughAll` carry none. An up-to target that is absent
 * or lost degrades to `none` — the plan then builds with the blind depth — and reports the
 * lost pick for the missing-input row. A target resolved from the FROZEN fingerprint (the
 * node is gone, the face no longer matches) still reports: the geometry builds, but it will
 * not follow edits until the user re-picks.
 */
function resolveEndTarget(feature: ExtrudeFeatureData, context: FeatureContext): ResolvedEndTarget {
    const condition = feature.endCondition ?? "blind";
    if (condition === "upToFace") {
        const unresolved: UnresolvedInputs = { key: "endFace", refIndexes: [0] };
        if (feature.endFace === undefined) return { target: { kind: "none" }, unresolved };
        const resolved = resolveEndFace(feature.endFace, context);
        if (resolved === undefined) return { target: { kind: "none" }, unresolved };
        if (context.tracking !== undefined && resolved.anchor !== undefined) {
            context.tracking.resolvedTargets = {
                ...context.tracking.resolvedTargets,
                endFace: resolved.anchor,
            };
        }
        return {
            target: resolved.target,
            unresolved: resolved.anchor === undefined ? unresolved : undefined,
        };
    }
    if (condition === "upToVertex") {
        const unresolved: UnresolvedInputs = { key: "endVertex", refIndexes: [0] };
        if (feature.endVertex === undefined) return { target: { kind: "none" }, unresolved };
        const resolved = resolveEndVertex(feature.endVertex, context);
        if (context.tracking !== undefined && resolved.anchor !== undefined) {
            context.tracking.resolvedTargets = {
                ...context.tracking.resolvedTargets,
                endVertex: resolved.anchor,
            };
        }
        return {
            target: { kind: "vertex", point: resolved.point },
            unresolved: resolved.anchor === undefined ? unresolved : undefined,
        };
    }
    return { target: { kind: "none" } };
}

/** The live end-face match, or undefined to fall back to the frozen fingerprint. */
function resolveEndFace(
    source: NonNullable<ExtrudeFeatureData["endFace"]>,
    context: FeatureContext,
): { target: EndTarget; anchor?: ProfileRef } | undefined {
    // The press-pull contract: world faces, tracked ids, the host's input for a self-source —
    // with every failure mode (node gone, rolled back, ambiguous) funnelled to the frozen
    // fingerprint by the caller.
    const resolved = resolveSourceFaces({ nodeId: source.nodeId, profiles: [source.profile] }, context);
    if (!resolved.isOk) return frozenEndFace(source.profile);
    const { worldFaces, faceIds, owned } = resolved.value;
    try {
        const matched = matchSourceFaceIndexes(worldFaces, faceIds, [source.profile]);
        if (!matched.isOk || matched.value.indexes.length === 0) return frozenEndFace(source.profile);
        const index = matched.value.indexes[0];
        const face = worldFaces[index];
        return {
            target: faceTarget(face),
            anchor: captureProfileRef(face, faceIds?.[index], source.profile.splitPiece, true),
        };
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

/** The frozen fingerprint as the target, when the live face is gone. */
function frozenEndFace(ref: ProfileRef): { target: EndTarget } | undefined {
    if (ref.center === undefined) return undefined;
    const point = new XYZ(ref.center);
    if (ref.normal === undefined) {
        // No plane to be exact against — the fingerprint's own edge endpoints are the samples.
        const normal = XYZ.unitZ;
        return {
            target: {
                kind: "face",
                point,
                normal,
                samples: [point, ...refSamples(ref)],
                parallel: () => false,
            },
        };
    }
    const normal = new XYZ(ref.normal).normalize() ?? XYZ.unitZ;
    return {
        target: {
            kind: "face",
            point,
            normal,
            samples: [point, ...refSamples(ref)],
            parallel: (profileNormal) => directionsParallel(normal, profileNormal),
        },
    };
}

/** The endpoints a stored profile fingerprint carries, as sample points. */
function refSamples(ref: ProfileRef): XYZ[] {
    return ref.edges.flatMap((edge) => {
        if (edge.kind === "line") return [new XYZ(edge.start), new XYZ(edge.end)];
        if (edge.kind === "circle") return [new XYZ(edge.center)];
        return [new XYZ(edge.mid)];
    });
}

/** A live face as the target: its reference point, plane, and the termination samples. */
function faceTarget(face: IFace): EndTarget & { kind: "face" } {
    const [point, rawNormal] = face.normal(0, 0);
    const normal = rawNormal.normalize() ?? XYZ.unitZ;
    const planar = face.surface().isPlanar();
    const samples = faceSamples(face);
    return {
        kind: "face",
        point,
        normal,
        samples: [point, ...samples],
        parallel: (profileNormal) => planar && directionsParallel(normal, profileNormal),
    };
}

/** Wire vertices plus bounding-box corners — the farthest one along the direction terminates. */
function faceSamples(face: IFace): XYZ[] {
    const vertices = face.findSubShapes(ShapeTypes.vertex) as IVertex[];
    const points = vertices.map((vertex) => vertex.point());
    const box = face.boundingBox();
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                points.push(new XYZ(x, y, z));
            }
        }
    }
    return points;
}

/** The live end-vertex match (world point plus the re-anchored ref), or the frozen point. */
function resolveEndVertex(
    source: NonNullable<ExtrudeFeatureData["endVertex"]>,
    context: FeatureContext,
): { point: XYZ; anchor?: VertexRef } {
    const frozen = { point: new XYZ(source.vertex.point) };
    const shape = source.nodeId === context.host.id ? context.input : nodeShape(source.nodeId, context);
    if (shape === undefined) return frozen;
    const world =
        source.nodeId === context.host.id
            ? context.host.worldTransform()
            : sourceNodeTransform(source.nodeId, context);
    if (world === undefined) return frozen;
    const inverse = world.invert();
    if (inverse === undefined) return frozen;
    const vertex = matchVertex(shape, { point: plainVec(inverse.ofPoint(frozen.point)) });
    if (vertex === undefined) return frozen;
    const point = world.ofPoint(vertex.point());
    return { point, anchor: { point: plainVec(point) } };
}

/** The node's live shape, undefined when it is gone or shows a session-rollback preview. */
function nodeShape(nodeId: string, context: FeatureContext): IShape | undefined {
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return undefined;
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) return undefined;
    return node.shape.value;
}

function sourceNodeTransform(nodeId: string, context: FeatureContext): Matrix4 | undefined {
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    return node instanceof ShapeNode ? node.worldTransform() : undefined;
}

export interface ResolvedDirection {
    readonly dir?: XYZ;
    /** The lost direction reports through the plan's unresolved slot. */
    readonly lostKey?: UnresolvedInputs;
}

/**
 * The direction override as a world unit vector, resolved like the pattern's line source
 * (`pattern.ts`): self-source matches on the chain input, a foreign source on its live shape,
 * a rolled-back source is refused, and a lost ref falls back to the frozen fingerprint —
 * mapped by the node's transform while the node lives, taken as world geometry once it is
 * gone. A non-line match or a missing node never fails the feature; it reports and freezes.
 *
 * Shared with the primitive feature, whose `direction` is the same contract.
 */
export function resolveDirectionOverride(
    source: { readonly nodeId: string; readonly edge: EdgeRef } | undefined,
    context: FeatureContext,
): ResolvedDirection {
    if (source === undefined) return {};
    const lost: UnresolvedInputs = { key: "direction", refIndexes: [0] };
    const frozen = frozenDirection(source.edge, source.nodeId, context);
    const line =
        source.nodeId === context.host.id
            ? directionFromInput(source.edge, context)
            : directionFromNode(source.nodeId, source.edge, context);
    if (line === undefined) return { dir: frozen, lostKey: lost };
    if (context.tracking !== undefined) {
        context.tracking.resolvedEdges = [line.anchor];
    }
    return { dir: line.dir };
}

/** The frozen ref as a world direction (source-local capture mapped by the living node). */
function frozenDirection(edge: EdgeRef, nodeId: string, context: FeatureContext): XYZ | undefined {
    if (edge.kind !== "line") return undefined;
    const dir = new XYZ(edge.end).sub(new XYZ(edge.start)).normalize();
    if (dir === undefined) return undefined;
    const world =
        nodeId === context.host.id ? context.host.worldTransform() : sourceNodeTransform(nodeId, context);
    return world === undefined ? dir : world.ofVector(dir).normalize();
}

/** Self-source: the direction edge belongs to an earlier feature, matched on the chain input. */
function directionFromInput(
    ref: EdgeRef,
    context: FeatureContext,
): { dir: XYZ; anchor: EdgeRef } | undefined {
    const input = context.input;
    if (input === undefined) return undefined;
    const edges = input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const tracked = context.tracking?.inputEdgeIds;
    const ids = tracked !== undefined && tracked.length === edges.length ? tracked : undefined;
    const matched = matchDirectionEdge(input, edges, ids, ref);
    if (matched === undefined) return undefined;
    const world = context.host.worldTransform();
    return { dir: world.ofVector(matched.dir).normalize() ?? matched.dir, anchor: matched.anchor };
}

/** A direction edge of another node, matched on its live shape and mapped to world. */
function directionFromNode(
    nodeId: string,
    ref: EdgeRef,
    context: FeatureContext,
): { dir: XYZ; anchor: EdgeRef } | undefined {
    const shape = nodeShape(nodeId, context);
    const world = sourceNodeTransform(nodeId, context);
    if (shape === undefined || world === undefined) return undefined;
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    const ids =
        node !== undefined && isBodyTrackingNode(node) ? edges.map((_, i) => node.edgeIdAt(i)) : undefined;
    const matched = matchDirectionEdge(shape, edges, ids, ref);
    if (matched === undefined) return undefined;
    return { dir: world.ofVector(matched.dir).normalize() ?? matched.dir, anchor: matched.anchor };
}

/** Re-matches the ref (id channel first, geometric fallback); the direction is start→end. */
function matchDirectionEdge(
    shape: IShape,
    edges: readonly IEdge[],
    ids: readonly (string | undefined)[] | undefined,
    ref: EdgeRef,
): { dir: XYZ; anchor: EdgeRef } | undefined {
    let index: number;
    let anchor: EdgeRef;
    if (ids !== undefined) {
        const anchored = matchEdgesAnchored(shape, [ref], ids);
        if (!anchored.isOk) return undefined;
        // One ref in, one slot out: a hole in `anchors` means the ref did not match at all, and
        // `indexes` says the same thing.
        const matchedAnchor = anchored.value.anchors[0];
        if (matchedAnchor === undefined) return undefined;
        index = anchored.value.indexes[0];
        anchor = matchedAnchor;
    } else {
        const matched = matchEdgeIndexes(shape, [ref]);
        if (!matched.isOk) return undefined;
        index = matched.value[0];
        anchor = captureEdgeRef(edges[index]);
    }
    const edge = edges[index];
    const dir = edge.endPoint().sub(edge.startPoint()).normalize();
    return dir === undefined ? undefined : { dir, anchor };
}
