// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, Matrix4, Result, ShapeNode, ShapeTypes } from "@chili3d/core";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import type { ExtrudeFeatureData, FeatureContext } from "./feature";
import { matchProfileIndexes } from "./profileMatcher";
import { captureProfileRef, type ProfileRef, profileScore } from "./profileRef";
import { MATCH_TOLERANCE } from "./refGeometry";
import { sweepFaces } from "./sweep";
import { indexesOfOverlappingId } from "./trackedId";

/**
 * Press-pull: extruding from the planar faces of an EXISTING body, rather than from a
 * sketch's profiles.
 *
 * The interesting half is not the sweep (that is `sweep.ts`) but *which* faces get
 * swept: the feature stores only fingerprints of the faces picked at creation time, and
 * they have to be re-found on a shape that has since been rebuilt. That is the same
 * identity problem the ref layer solves, one level up — the refs here name solid faces,
 * so the matching is face-specific (see `matchSourceFaceIndexes`) and its errors are
 * worded for faces rather than sketches.
 *
 * The sweep itself is deliberately untracked; the boolean that combines the swept prism
 * with the chain input is the tracked half, and lives beside its sibling in extrude.ts
 * (`pressPullOperationTracked`).
 */

/**
 * Press-pull from planar faces of an existing body: every matched face sweeps along its own
 * live outward normal.
 *
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
export function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, owned } = resolved.value;
    try {
        const matched = matchSourceFaceIndexes(worldFaces, faceIds, feature.source.profiles);
        if (!matched.isOk) return Result.err(matched.error);
        // Re-anchor on the faces actually swept — one ref per adopted face, so a face
        // split since the pick becomes one ref per piece — before the finally disposes
        // worldFaces. Each re-anchored ref keeps the `splitPiece` of the ref that
        // adopted it; re-anchoring never stamps the flag on a ref that lacked it.
        // Same drift-from-latest-match contract as the sketch path.
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
                captureProfileRef(
                    worldFaces[faceIndex],
                    faceIds?.[faceIndex],
                    feature.source.profiles[matched.value.refIndexes[k]].splitPiece,
                    true,
                ),
            );
        }
        return sweepFaces(
            matched.value.indexes.map((index) => worldFaces[index]),
            (face) => {
                const vec = face.normal(0, 0)[1].multiply(depth);
                return feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
            },
            (face) => face.normal(0, 0)[1].multiply(startOffset),
        );
    } finally {
        owned.forEach((x) => x.dispose());
    }
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

/**
 * Face indexes to sweep, one entry per adopted face: refs with a tracked face id claim
 * the faces whose id intersects it (`idsOverlap` — pieces of a cut-split face share
 * the id, and pieces of a re-split MERGE carry its components; hits already claimed by
 * an earlier ref with an overlapping id — produced when a split face was re-anchored
 * per piece — count as satisfied). Several hits narrow by `narrowToPickedPiece`: a ref
 * stamped `splitPiece` at capture never widens to the whole span, an unflagged ref
 * keeps it (the pinned heal case). Refs without a live id re-match geometrically among
 * the unclaimed faces.
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
        // A ref whose tracked id died competes only for faces WITHOUT a live id of
        // their own: an id-carrying face already has an identity, and adopting one
        // would silently sweep a stranger (a consumed groove ceiling "moving" onto
        // the box bottom — same normal, same edge count, a finite edge score away).
        // Id-less legacy refs keep the free geometric re-match.
        (refIndex, faceIndex) =>
            remainingRefs[refIndex].id === undefined || faceIds?.[remainingIndexes[faceIndex]] === undefined,
    );
    if (!matched.isOk) return Result.err(SOURCE_FACE_ERRORS[matched.error] ?? matched.error);
    return Result.ok(matched.value.map((index) => remainingIndexes[index]));
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
function resolveSourceFaces(
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

/** Another node's current faces, read off its live shape. */
function sourceNodeFaces(nodeId: string, context: FeatureContext): Result<SourceFaceGeometry> {
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) {
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
    const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds = isBodyTrackingNode(node) ? faces.map((_, index) => node.faceIdAt(index)) : undefined;
    return Result.ok({ faces, faceIds, transform: node.worldTransform() });
}
