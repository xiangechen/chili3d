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
import { plainVec } from "./refGeometry";
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
 * - **upToFace** — the prism terminates at the face's NEAREST sampled point along the sweep
 *   direction — stops AT the face's near side, for a cylinder the tangent line facing the
 *   profile, instead of passing through to the far side. The samples all lie ON the surface
 *   (wire vertices plus each boundary edge sampled along its parameter range), so a planar
 *   target's linear reach is read exactly at the region's extreme vertices, and a curved
 *   wall's extremum — which sits on its boundary rims — is caught within a fraction of a
 *   degree. When the parameters admit it (`conformingEnd`) and the kernel offers
 *   `prismToFaceTracked`, the prism is instead built TO the surface itself, capped by a
 *   patch of it (`extrudeToFace.ts`).
 *
 * `startOffset` composes FIRST (it moves the prism's start off the profile plane); the
 * up-to/through depths are measured from the profile plane and subtract the offset's
 * component along the SWEEP direction, so the end lands on the target whatever the start
 * offset is. The offset itself keeps the unflipped sense (see `ExtrudeFeatureData.reverse`),
 * so with `reverse` set the start plane sits BEHIND the profile plane along the flipped
 * sweep — the signed offset negates and the subtraction becomes an addition.
 *
 * An up-to target strictly BEHIND the sweep direction does not fail: the sweep auto-reverses
 * toward it (`upToAim`) — the picked target IS the intent, and reaching it beats honouring
 * the direction that missed it. What still fails: a target lying ON or ACROSS the start
 * plane (no direction reaches only a near side) and one the offsets pull the end back
 * behind the start plane from. A target that cannot be RESOLVED (node gone, face no longer
 * matching, a rolled-back source showing its session preview) does not fail the feature:
 * the stored fingerprint doubles as the frozen geometry (world capture makes that
 * unambiguous — the node's frame went with it), the blind `depth` stands in when even the
 * fingerprint is unusable, and the loss is reported through `ShapeTracking.unresolved` as
 * the plan's `unresolved` — the caller applies it after the profile resolution, so a lost
 * profile keeps precedence over a lost end target in the one-slot report.
 *
 * `reverse` (Onshape's Opposite Direction) flips the direction the plan hands out: the sweep
 * vectors negate (order preserved, so the `:neg` half's ids stay put), and the up-to/through-all
 * depths measure along the flipped direction. An up-to target OUTRANKS the flip — one lying
 * behind the flipped direction auto-reverses back toward itself — so with a resolved up-to
 * target the flag changes nothing; it still decides the blind/through-all sweeps and the
 * lost-target fallback. The start offset keeps the unflipped sense (see
 * `ExtrudeFeatureData.reverse`).
 */
export interface ExtrudePlan {
    /**
     * The sweep vectors for a profile plane (`point`/`normal`, world): the forward vector
     * first, the backward one second when `symmetric`/`depth2` asks. The forward sense is
     * the direction override's, or the plane normal's without an override — negated as a
     * whole when the feature's `reverse` is set, and negated AGAIN toward an up-to target
     * lying behind all of that (the target outranks every direction knob — see `upToAim`).
     */
    vecsOf(point: XYZ, normal: XYZ): Result<XYZ[]>;
    /** The start-offset vector for that plane, along its sweep direction. */
    offsetOf(normal: XYZ): XYZ;
    /** The pick this evaluation could not resolve, if any — applied by the caller. */
    readonly unresolved?: UnresolvedInputs;
    /**
     * The end condition admits a surface-conforming build (`extrudeToFace.ts`): `upToFace`
     * with no start/end offset, no second depth and no symmetric half — the parameters the
     * kernel's prism-to-face cannot express. The live face itself is resolved once HERE
     * (`liveEndFace`); this flag says only that the parameters do not rule the build out.
     */
    readonly conformingEnd: boolean;
    /**
     * The live end-face resolution this evaluation already ran for the depth samples,
     * kept alive for the conforming build (`extrudeToFace.ts`) so it does not enumerate
     * and score the target body's faces a second time. Borrowed — owned by the plan,
     * released by `dispose`.
     */
    readonly liveEndFace?: { face: IFace; id: string | undefined; owned: IShape[] };
    /** Releases the stashed live end face. Called by the feature handler after the build. */
    dispose(): void;
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
 * How far one profile sweeps under this plan's end condition, and along WHICH direction —
 * the up-to conditions may auto-reverse `dir` toward a target lying behind it (see
 * `upToAim`); the other conditions keep it. A target the evaluation could not resolve
 * degrades to the blind depth rather than failing: the loss is reported separately,
 * through the plan's `unresolved`.
 */
function endConditionSweep(
    plan: ExtrudePlanState,
    point: XYZ,
    normal: XYZ,
    dir: XYZ,
): Result<{ dir: XYZ; depth: number }> {
    switch (plan.condition) {
        case "throughAll": {
            const depth = throughAllDepth(
                plan.context.input!,
                plan.context.host.worldTransform(),
                point,
                dir,
                plan.sweepStartOffset,
                "Extrude",
            );
            return depth.isOk ? Result.ok({ dir, depth: depth.value }) : Result.err(depth.error);
        }
        case "upToFace":
        case "upToVertex":
            return plan.target.target.kind === "none"
                ? Result.ok({ dir, depth: plan.blindDepth })
                : upToAim(plan.target.target, point, normal, dir, plan.sweepStartOffset, plan.endOffset);
        default:
            return Result.ok({ dir, depth: plan.blindDepth });
    }
}

/**
 * The vectors one profile sweeps along: the forward one (auto-reversed toward an up-to
 * target behind it), and the backward one when `symmetric`/`depth2` asks.
 */
function planVectorsOf(plan: ExtrudePlanState, point: XYZ, normal: XYZ): Result<XYZ[]> {
    // A direction override parallel to the profile plane sweeps a degenerate prism
    // (without an override dir IS the normal — never parallel, and no dot to pay).
    if (plan.direction.dir !== undefined && Math.abs(normal.dot(plan.direction.dir)) < PARALLEL_DOT) {
        return Result.err("Extrude direction is parallel to the profile plane");
    }
    const base = plan.direction.dir ?? normal;
    const dir = plan.reverse ? base.multiply(-1) : base;
    const sweep = endConditionSweep(plan, point, normal, dir);
    if (!sweep.isOk) return Result.err(sweep.error);
    const forward = sweep.value.dir.multiply(sweep.value.depth);
    const backward =
        plan.depth2 !== undefined
            ? sweep.value.dir.multiply(-plan.depth2)
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
        conformingEnd:
            condition === "upToFace" &&
            endOffset === 0 &&
            startOffset === 0 &&
            depth2 === undefined &&
            feature.symmetric !== true,
        liveEndFace: target.live,
        dispose: () => target.live?.owned.forEach((x) => x.dispose()),
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

/**
 * The up-to depth AND the direction that earns it. A target strictly behind `dir`
 * auto-reverses the sweep toward itself — the picked target IS the intent, and reaching
 * it beats honouring the direction that missed it (`reverse`, a direction override). The
 * flip re-measures the near side (the FARTHEST sample along `dir` is the nearest along
 * −dir) and negates the start offset's sweep component, whose vector keeps the unflipped
 * sense (see `ExtrudeFeatureData.reverse`). A target lying ON or CROSSING the start plane
 * is reachable in neither direction and is a rebuild error, as is one the offsets pull
 * the end back behind the start plane from.
 */
function upToAim(
    target: Exclude<EndTarget, { readonly kind: "none" }>,
    point: XYZ,
    normal: XYZ,
    dir: XYZ,
    sweepStartOffset: number,
    endOffset: number,
): Result<{ dir: XYZ; depth: number }> {
    const denominator = normal.dot(dir);
    if (Math.abs(denominator) < PARALLEL_DOT) {
        return Result.err("Extrude direction is parallel to the profile plane");
    }
    const reachOf = (p: XYZ) => normal.dot(p.sub(point)) / denominator;
    // Every sample lies ON the target surface (see `faceSamples`): the reach over a planar
    // face is linear, so its extremum is read exactly at the boundary vertices; a curved
    // wall's extremum sits on its boundary rims, which the edge samples cover. Off-surface
    // stand-ins (bounding-box corners) would break the auto-reversal below — a corner can
    // lie behind the start plane while the whole face lies ahead of it, and vice versa.
    const reaches = target.kind === "vertex" ? [reachOf(target.point)] : target.samples.map(reachOf);
    let reach = Math.min(...reaches);
    let sweepDir = dir;
    let startOffset = sweepStartOffset;
    if (reach < 0) {
        // Behind the start plane along `dir`: reverse toward the target — possible only
        // when the WHOLE target is on that side (a face the plane crosses stays
        // unreachable and reports below).
        const reversed = -Math.max(...reaches);
        if (reversed > 0) {
            reach = reversed;
            sweepDir = dir.multiply(-1);
            startOffset = -sweepStartOffset;
        }
    }
    // `startOffset` is signed along the sweep direction (see `throughAllDepth`);
    // `endOffset` overshoots along it either way.
    const depth = reach - startOffset + endOffset;
    if (depth <= 0) {
        return Result.err(
            reach <= 0
                ? "Extrude target lies on or crosses the start plane"
                : "Extrude offsets place the end behind the start plane",
        );
    }
    return Result.ok({ dir: sweepDir, depth });
}

/**
 * The aim at a picked up-to target, measured exactly as the rebuild will measure it —
 * the extrude command's live target preview reads it, so what the preview draws and what
 * the commit builds agree. The auto-reversal is part of the answer: `dir` comes back
 * flipped toward a target lying behind the given one. `target` is in WORLD coordinates,
 * beside `point`/`normal`. `dir` is the sweep direction (flipped by the direction
 * checkbox) and `sweepStartOffset` is signed along it (see `upToAim`).
 */
export function upToTargetAim(
    target: IShape,
    point: XYZ,
    normal: XYZ,
    dir: XYZ,
    sweepStartOffset: number,
    endOffset: number,
): Result<{ dir: XYZ; depth: number }> {
    const endTarget: Exclude<EndTarget, { readonly kind: "none" }> =
        target.shapeType === ShapeTypes.vertex
            ? { kind: "vertex", point: (target as IVertex).point() }
            : faceTarget(target as IFace);
    return upToAim(endTarget, point, normal, dir, sweepStartOffset, endOffset);
}

/** What an up-to condition terminates at, resolved once per rebuild (world coordinates). */
type EndTarget =
    | { readonly kind: "none" }
    | { readonly kind: "vertex"; readonly point: XYZ }
    | {
          readonly kind: "face";
          /** On-surface samples — the nearest one along the sweep terminates (see `faceSamples`). */
          readonly samples: XYZ[];
      };

interface ResolvedEndTarget {
    readonly target: EndTarget;
    readonly unresolved?: UnresolvedInputs;
    /** The live end face, stashed on the plan for the conforming build (see `ExtrudePlan.liveEndFace`). */
    readonly live?: { face: IFace; id: string | undefined; owned: IShape[] };
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
            live: resolved.live,
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

/**
 * The live end-face match, or undefined to fall back to the frozen fingerprint. The live
 * face is NOT disposed here: it rides the plan (`ExtrudePlan.liveEndFace`) so the
 * conforming build reuses this very resolution instead of running it again, and the plan's
 * `dispose` releases it after the build.
 */
function resolveEndFace(
    source: NonNullable<ExtrudeFeatureData["endFace"]>,
    context: FeatureContext,
):
    | {
          target: EndTarget;
          anchor?: ProfileRef;
          live?: { face: IFace; id: string | undefined; owned: IShape[] };
      }
    | undefined {
    const live = resolveLiveEndFace(source, context);
    if (live === undefined) return frozenEndFace(source.profile);
    return {
        target: faceTarget(live.face),
        anchor: captureProfileRef(live.face, live.id, source.profile.splitPiece, true),
        live,
    };
}

/**
 * The live end face of an `upToFace` target, in WORLD coordinates, with the source's own
 * tracked id for it — stashed on the plan (`ExtrudePlan.liveEndFace`) as the conforming
 * builder's (`extrudeToFace.ts`) raw material. Undefined when the target cannot resolve live
 * this run; the caller then takes the planar path, which the frozen fingerprint still feeds.
 * `owned` holds the disposables — the matched face itself included when it is a transformed
 * copy — to dispose once the evaluation has read the face.
 */
function resolveLiveEndFace(
    source: NonNullable<ExtrudeFeatureData["endFace"]>,
    context: FeatureContext,
): { face: IFace; id: string | undefined; owned: IShape[] } | undefined {
    // The press-pull contract: world faces, tracked ids, the host's input for a self-source —
    // with every failure mode (node gone, rolled back, ambiguous) funnelled to the caller's
    // fallback (the frozen fingerprint for the plan, the planar path for the conforming build).
    const resolved = resolveSourceFaces({ nodeId: source.nodeId, profiles: [source.profile] }, context);
    if (!resolved.isOk) return undefined;
    const { worldFaces, faceIds, owned } = resolved.value;
    const matched = matchSourceFaceIndexes(worldFaces, faceIds, [source.profile]);
    if (!matched.isOk || matched.value.indexes.length === 0) {
        owned.forEach((x) => x.dispose());
        return undefined;
    }
    const index = matched.value.indexes[0];
    // `owned` passes to the caller unfiltered — it already contains the matched face exactly
    // when that face is a transformed copy (resolveSourceFaces' contract).
    return { face: worldFaces[index], id: faceIds?.[index], owned };
}

/** The frozen fingerprint as the target, when the live face is gone. */
function frozenEndFace(ref: ProfileRef): { target: EndTarget } | undefined {
    if (ref.center === undefined) return undefined;
    // The fingerprint carries no surface to sample: its region center and edge reference
    // points are the reach samples. That is exact while the face keeps its captured plane
    // and degrades to the stored neighborhood when it does not — the frozen path only
    // stands in until the user re-picks (the loss is reported separately).
    return { target: { kind: "face", samples: [new XYZ(ref.center), ...refSamples(ref)] } };
}

/** The endpoints a stored profile fingerprint carries, as sample points. */
function refSamples(ref: ProfileRef): XYZ[] {
    return ref.edges.flatMap((edge) => {
        if (edge.kind === "line") return [new XYZ(edge.start), new XYZ(edge.end)];
        if (edge.kind === "circle") return [new XYZ(edge.center)];
        return [new XYZ(edge.mid)];
    });
}

/** A live face as the target: on-surface samples the sweep's nearest reach is read from. */
function faceTarget(face: IFace): EndTarget & { kind: "face" } {
    const [point] = face.normal(0, 0);
    return { kind: "face", samples: [point, ...faceSamples(face)] };
}

/**
 * On-surface samples of the target face: every wire vertex, and each boundary edge sampled
 * uniformly along its parameter range. The reach the caller minimizes is linear along the
 * sweep, so over a planar face its extremum sits at a boundary vertex exactly; over a
 * cylindrical or conical wall it sits on a boundary rim, which the edge samples cover to
 * within half a percent of the radius. Bounding-box corners are NOT samples — they float
 * off the surface, and an off-surface point can lie on the wrong side of the start plane
 * while the whole face lies on the other, flipping the auto-reversal's near/far reading.
 */
function faceSamples(face: IFace): XYZ[] {
    const points: XYZ[] = [];
    const edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    for (const edge of edges) {
        try {
            const first = edge.firstParameter();
            const last = edge.lastParameter();
            for (let i = 0; i <= EDGE_SAMPLE_COUNT; i++) {
                points.push(edge.pointAt(first + ((last - first) * i) / EDGE_SAMPLE_COUNT));
            }
        } catch {
            // A degenerate edge (a sphere's pole) has no curve to sample — its vertex is
            // already among the wire vertices below.
        }
    }
    const vertices = face.findSubShapes(ShapeTypes.vertex) as IVertex[];
    return points.concat(vertices.map((vertex) => vertex.point()));
}

/** Per-edge sample count: a full rim sampled at this pitch misses its extremum by ≤ (1 − cos(π/N))·r. */
const EDGE_SAMPLE_COUNT = 32;

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
