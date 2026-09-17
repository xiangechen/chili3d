// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, Matrix4, Result, ShapeNode, ShapeTypes } from "@chili3d/core";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import type { ExtrudeFeatureData, FeatureContext } from "./feature";
import { matchProfileIndexes } from "./profileMatcher";
import { type ProfileRef, profileScore } from "./profileRef";
import { MATCH_TOLERANCE } from "./refGeometry";
import { indexesOfOverlappingId } from "./trackedId";

/**
 * Re-finding the faces a press-pull was built from, on a source body that has since been
 * rebuilt.
 *
 * The face counterpart of `profileMatcher.ts` (and of `edgeMatcher.ts` one level down):
 * a press-pull feature stores only what was picked at creation time, and the geometry it
 * named may have moved, split or merged since. The refs here name solid faces rather
 * than sketch regions, so the matching is face-specific and its errors are worded for
 * faces rather than sketches.
 */

/**
 * Which faces match, in order:
 * - **A tracked face id** claims every face whose id intersects it. A face split by a later cut
 *   shares one id across its pieces; a face MERGED from several carries a compound id, so a
 *   later re-split's pieces all intersect it and every piece is swept (mirroring `EdgeRef`'s
 *   whole-span adoption).
 * - **Except** a ref captured from ONE piece of an already split face: stamped `splitPiece` at
 *   the pick, it never widens — see `narrowToPickedPiece`.
 * - **No usable id** (a legacy document, or the face was consumed) falls back to geometric
 *   fingerprinting among the faces left over, with the pick's stored outward `normal` rejecting
 *   candidates that face away — what tells a consumed groove's ceiling from its floor and walls.
 *
 * Matching runs on the source node's current shape, or on the feature's own input when the
 * source is the host body itself (whose full shape already contains this feature's output).
 */
export function matchSourceFaceIndexes(
    faces: IFace[],
    faceIds: readonly (string | undefined)[] | undefined,
    refs: ProfileRef[],
): Result<MatchedSourceFaces> {
    const claims = claimFacesById(faces, faceIds, refs);
    if (!claims.isOk) return Result.err(claims.error);

    const { adopted, adoptedBy, taken, fingerprintRefs } = claims.value;
    if (fingerprintRefs.length > 0) {
        const matched = matchFingerprintRefs(faces, faceIds, refs, fingerprintRefs, taken);
        if (!matched.isOk) return Result.err(matched.error);
        for (const [k, faceIndex] of matched.value.entries()) {
            adopted.push(faceIndex);
            adoptedBy.push(fingerprintRefs[k]);
        }
    }
    return Result.ok({ indexes: adopted, refIndexes: adoptedBy });
}

/**
 * The faces a press-pull sweeps, plus the ref that adopted each — `indexes` and
 * `refIndexes` are parallel (a position in the feature's `source.profiles`). The id
 * path's `taken` guard and `matchProfileIndexes`' one-claim-per-ref keep `indexes`
 * duplicate-free, so callers re-anchor exactly one ref per entry.
 */
export interface MatchedSourceFaces {
    readonly indexes: number[];
    readonly refIndexes: number[];
}

interface FaceClaims {
    /** Face indexes adopted by an id hit, with the ref each was adopted for. */
    adopted: number[];
    adoptedBy: number[];
    taken: Set<number>;
    /** Refs whose tracked id is gone; they fall through to the geometric pass. */
    fingerprintRefs: number[];
}

function claimFacesById(
    faces: IFace[],
    faceIds: readonly (string | undefined)[] | undefined,
    refs: ProfileRef[],
): Result<FaceClaims> {
    const adopted: number[] = [];
    const adoptedBy: number[] = [];
    const taken = new Set<number>();
    const fingerprintRefs: number[] = [];
    for (const [refIndex, ref] of refs.entries()) {
        const refId = ref.id;
        const hits =
            refId === undefined || faceIds === undefined ? [] : indexesOfOverlappingId(faceIds, refId);
        if (hits.length === 0) {
            fingerprintRefs.push(refIndex);
            continue;
        }
        const narrowed = narrowToPickedPiece(faces, ref, hits);
        if (!narrowed.isOk) return Result.err(narrowed.error);
        for (const hit of narrowed.value) {
            if (!taken.has(hit)) {
                taken.add(hit);
                adopted.push(hit);
                adoptedBy.push(refIndex);
            }
        }
    }
    return Result.ok({ adopted, adoptedBy, taken, fingerprintRefs });
}

/** Returns the face index each fingerprint-only ref settled on, in `fingerprintRefs` order. */
function matchFingerprintRefs(
    faces: IFace[],
    faceIds: readonly (string | undefined)[] | undefined,
    refs: ProfileRef[],
    fingerprintRefs: number[],
    taken: Set<number>,
): Result<number[]> {
    const remainingIndexes = faces.map((_, index) => index).filter((index) => !taken.has(index));
    const remainingRefs = fingerprintRefs.map((index) => refs[index]);
    const matched = matchProfileIndexes(
        remainingIndexes.map((index) => faces[index]),
        remainingRefs,
        undefined,
        // A ref whose tracked id died competes only for faces it can still claim:
        //   - no live id of their own (an id-carrying face already has an identity, and
        //     adopting one would silently sweep a stranger — a consumed groove ceiling
        //     "moving" onto the box bottom, same normal, same edge count, a finite edge
        //     score away),
        //   - or an id whose ENTITY segment still names the same sketch entity. Editing
        //     the outline's composition (splitting an edge in two) rewrites the seed that
        //     prefixes every id this feature produced, so the literal id no longer matches
        //     even though the face is the same one; the last segment survives that rewrite.
        // Id-less legacy refs keep the free geometric re-match.
        (refIndex, faceIndex) => {
            const refId = remainingRefs[refIndex].id;
            const faceId = faceIds?.[remainingIndexes[faceIndex]];
            if (refId === undefined || faceId === undefined) return true;
            return entitySegment(refId) === entitySegment(faceId);
        },
    );
    if (!matched.isOk) return Result.err(SOURCE_FACE_ERRORS[matched.error] ?? matched.error);
    return Result.ok(matched.value.map((index) => remainingIndexes[index]));
}

/**
 * The sketch-entity segment of a tracked id — `ent2` in `sketch:<sketch>:<seed>:ent2`.
 *
 * The part of an id that outlives a rewritten seed. Ids are joined from several pieces, so
 * the last segment is taken across both separators. A tool-born face (`…:tool:fN`) or a
 * synthetic cap (`…:top`) has a different segment and so cannot claim such a ref.
 */
function entitySegment(id: string): string {
    const parts = id.split(/[:|]/);
    return parts[parts.length - 1];
}

/**
 * Face-worded rewrites of the fingerprint fallback's sketch-flavored messages — a
 * press-pull ref names a solid face, so "Sketch profile …" misleads (the fallback
 * shared with sketch profiles is an implementation detail).
 */
const SOURCE_FACE_ERRORS: Record<string, string> = {
    "Sketch profile match is ambiguous after rebuild": "Face match is ambiguous after rebuild",
    "Sketch profile not found after rebuild": "Face not found after rebuild",
};

/**
 * Several id hits are the pieces of a face split since the pick (or of a re-split merge) — the
 * face counterpart of `singleExactHit` in edgeMatcher.ts. Which one the ref takes depends on
 * what it was picked from:
 *
 * - **Exactly one piece** still matching the fingerprint within tolerance claims the ref — the
 *   pick was that piece.
 * - **Otherwise an unflagged ref keeps the whole-span adoption.** It covered the whole face
 *   (captured on a merged face that later re-split — the pinned heal case), or its fingerprint
 *   went stale.
 * - **A ref stamped `splitPiece` never widens.** A stale pick adopts the clear nearest piece
 *   (the runner-up at least MATCH_TOLERANCE farther — the `completeHistory` margin convention),
 *   and a tie or several exact pieces fails "Face match is ambiguous after rebuild" rather than
 *   silently sweeping siblings.
 */
function narrowToPickedPiece(faces: IFace[], ref: ProfileRef, hits: number[]): Result<number[]> {
    if (hits.length === 1) return Result.ok(hits);
    const exact = hits.filter(
        (index) => profileScore(faces[index], ref) <= MATCH_TOLERANCE * ref.edges.length,
    );
    if (exact.length === 1) return Result.ok(exact);
    if (ref.splitPiece !== true) return Result.ok(hits);
    if (exact.length > 1) return Result.err("Face match is ambiguous after rebuild");
    const scored = hits
        .map((index) => ({ index, score: profileScore(faces[index], ref) }))
        .sort((a, b) => a.score - b.score);
    const best = scored[0];
    const second = scored[1];
    if (
        best !== undefined &&
        Number.isFinite(best.score) &&
        (second === undefined || second.score - best.score >= MATCH_TOLERANCE)
    ) {
        return Result.ok([best.index]);
    }
    return Result.err("Face match is ambiguous after rebuild");
}

/**
 * The current faces of the source node in world coordinates — or of the feature's
 * input when the source is the host body itself, whose full shape already contains
 * this feature's output. `faceIds` runs parallel to `worldFaces` with the source's
 * tracked face ids when available (undefined entries where tracking lapsed; wholly
 * undefined for non-parametric sources). `owned` holds the transformed copies for
 * the caller to dispose (empty when the source sits at the identity transform). A
 * source showing a session-rollback preview is refused outright: the transient
 * shape lacks later features' faces, and matching would persist anchors onto it.
 */
export function resolveSourceFaces(
    source: NonNullable<ExtrudeFeatureData["source"]>,
    context: FeatureContext,
): Result<{ worldFaces: IFace[]; faceIds: readonly (string | undefined)[] | undefined; owned: IFace[] }> {
    const resolved =
        source.nodeId === context.host.id ? hostInputFaces(context) : sourceNodeFaces(source.nodeId, context);
    if (!resolved.isOk) return Result.err(resolved.error);

    const { faces, faceIds, transform } = resolved.value;
    const identity = transform.equals(Matrix4.identity());
    const worldFaces = identity ? faces : faces.map((x) => x.transformedMul(transform) as IFace);
    return Result.ok({ worldFaces, faceIds, owned: identity ? [] : worldFaces });
}

interface SourceFaceGeometry {
    faces: IFace[];
    faceIds: readonly (string | undefined)[] | undefined;
    transform: Matrix4;
}

/** The feature's own input faces, used when the source is the host body itself. */
function hostInputFaces(context: FeatureContext): Result<SourceFaceGeometry> {
    if (context.input === undefined) {
        return Result.err("Extrude source face requires a preceding feature");
    }
    const faces = context.input.findSubShapes(ShapeTypes.face) as IFace[];
    const tracked = context.tracking?.inputFaceIds;
    const faceIds = tracked !== undefined && tracked.length === faces.length ? tracked : undefined;
    return Result.ok({ faces, faceIds, transform: context.host.worldTransform() });
}

/** Another node's faces — off its live shape, or the pre-boolean state when it consumed this host. */
function sourceNodeFaces(nodeId: string, context: FeatureContext): Result<SourceFaceGeometry> {
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode)) {
        return Result.err("Extrude source body not found");
    }
    // A rolled-back source shows a transient session-preview shape lacking every
    // face born from a hidden feature: matching against it would re-anchor (and
    // untransacted persist) the profile refs onto the preview. Fail instead — the
    // feature keeps its old shape and self-heals on the watch-triggered rebuild
    // once the source restores (the sketch-side refs guard the same way, see
    // SketchNode.handlePlaneRefNodeChanged).
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
        return Result.err("Extrude source body is rolled back for a sketch session");
    }
    // When the source body later CONSUMED this host (a fuse whose tool is the host), the
    // source's final shape already contains the geometry this press-pull builds out of it:
    // the picked face is an interior face of the fused solid, and re-matching against the
    // final shape would look for the host inside the host. Resolve against the chain state
    // entering that boolean instead — the shape the source still had while the two bodies
    // were separate, which is exactly what was picked. Same timeline-anchor idea as sketch
    // external refs (`SketchData.refPositions`).
    //
    // Deliberately BEFORE the live-shape guard below: this path needs the source's chain
    // state, not its final shape, and that state is available mid-rebuild. Requiring the
    // final shape first deadlocks a document that is being loaded — the consumer has no
    // shape until this feature resolves, and this feature would refuse to resolve until the
    // consumer had one.
    const consumed = consumedFaces(node, context);
    if (consumed !== undefined) return Result.ok(consumed);
    if (!node.shape.isOk) {
        return Result.err("Extrude source body not found");
    }
    const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds = isBodyTrackingNode(node) ? faces.map((_, index) => node.faceIdAt(index)) : undefined;
    return Result.ok({ faces, faceIds, transform: node.worldTransform() });
}

/**
 * The source body's faces as they were before its boolean swallowed this host, or undefined
 * when no boolean of `node` takes the host as a tool (the ordinary cross-body press-pull, whose
 * source face may legitimately have moved or vanished since — that case keeps failing loudly).
 * A state the timeline cannot produce (the source never committed a run carrying that boolean)
 * falls back to the live shape, so the match fails exactly the way it did before this anchor
 * rather than for a new reason.
 */
function consumedFaces(node: ShapeNode, context: FeatureContext): SourceFaceGeometry | undefined {
    if (!isBodyTimelineNode(node)) return undefined;
    const index = node.consumingFeatureIndex(context.host.id);
    if (index === undefined) return undefined;
    const state = node.timelineStateAt(index);
    if (state?.shape === undefined) return undefined;
    return {
        faces: state.shape.findSubShapes(ShapeTypes.face) as IFace[],
        faceIds: state.faceIds,
        transform: node.worldTransform(),
    };
}
