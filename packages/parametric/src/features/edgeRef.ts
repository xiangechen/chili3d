// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, XYZ, type XYZLike } from "@chili3d/core";
import {
    axisDistance,
    directionsParallel,
    distance,
    MATCH_TOLERANCE,
    plainVec,
    sameVec,
} from "./refGeometry";

/**
 * A geometric fingerprint of an edge, plus an optional stable `edgeId` from kernel shape
 * history (see `ParametricBodyNode.edgeIdAt`).
 *
 * - **Why a fingerprint at all.** Shape indices drift when the upstream shape is rebuilt, so
 *   fillet/chamfer features store these instead and re-match on the rebuilt input.
 * - **Matching order.** `edgeId` hits exactly while the id survives; the fingerprint is the
 *   fallback (see `matchEdgeIndexes`). Fingerprints match exactly when the upstream is unchanged
 *   (OCCT rebuilds deterministically); edits that move geometry (a parameter change) are matched
 *   to the closest unambiguous edge instead.
 * - **`splitPiece`** records that the id was already shared by several edges at capture time —
 *   a boolean had split the original edge and the pick is just one piece. `matchEdgesAnchored`
 *   uses it to never widen such a ref to the whole span.
 */
export type EdgeRef =
    | { kind: "line"; start: XYZLike; end: XYZLike; edgeId?: string; splitPiece?: boolean }
    | {
          kind: "circle";
          center: XYZLike;
          radius: number;
          axis: XYZLike;
          edgeId?: string;
          splitPiece?: boolean;
      }
    | { kind: "other"; mid: XYZLike; length: number; edgeId?: string; splitPiece?: boolean };

export function captureEdgeRef(edge: IEdge, edgeId?: string, splitPiece?: boolean): EdgeRef {
    const basis = edge.curve.basisCurve;
    let ref: EdgeRef;
    if (CurveUtils.isCircle(basis)) {
        ref = {
            kind: "circle",
            center: plainVec(basis.center),
            radius: basis.radius,
            axis: plainVec(basis.axis),
            edgeId,
        };
    } else if (CurveUtils.isLine(basis)) {
        ref = { kind: "line", start: plainVec(edge.startPoint()), end: plainVec(edge.endPoint()), edgeId };
    } else {
        const midParam = (edge.firstParameter() + edge.lastParameter()) / 2;
        ref = { kind: "other", mid: plainVec(edge.pointAt(midParam)), length: edge.length(), edgeId };
    }
    // Set only when true: absent keeps the serialized shape of older refs.
    if (splitPiece === true) ref.splitPiece = true;
    return ref;
}

/**
 * Fingerprint equality, field by field — JSON.stringify equality is key-order
 * sensitive. The kernel `edgeId` is NOT compared (it identifies the edge, not the
 * geometry); callers needing it compare it themselves.
 */
export function sameEdgeFingerprint(a: EdgeRef, b: EdgeRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "line" && b.kind === "line") {
        return sameVec(a.start, b.start) && sameVec(a.end, b.end);
    }
    if (a.kind === "circle" && b.kind === "circle") {
        return sameVec(a.center, b.center) && a.radius === b.radius && sameVec(a.axis, b.axis);
    }
    if (a.kind === "other" && b.kind === "other") {
        return sameVec(a.mid, b.mid) && a.length === b.length;
    }
    return false;
}

/**
 * Rigid-move invariant of an id-resolved edge: the curve kind matches the fingerprint's, and
 * the properties a rigid move preserves still agree.
 *
 * - **What is compared:** a line's direction, a circle's axis, another curve's length.
 *   **Position deliberately is not** — a parameter edit moves geometry rigidly, and moving IS
 *   the edit (the same contract as the external-ref resolver).
 * - **On mismatch** the id realigned onto a different edge (a positional id drifting, or a
 *   kernel behavior change), so the caller demotes the ref to fingerprint matching instead of
 *   trusting the id blindly.
 * - **Why each kind is checked on that property.** A line's length and a circle's radius are
 *   the very parameters feature edits drive (extrude depth, hole diameter), so comparing them
 *   would demote the id on every legitimate edit; direction and axis survive those edits. A
 *   free-form curve has no axis concept, and its only other fingerprint datum is the mid point
 *   — position, deliberately unchecked — so length is the only invariant available.
 * - **The asymmetry is deliberate, and so is its price.** Editing a spline's shape changes its
 *   length, demotes the id, and the fingerprint (mid + length, both changed) may then fail with
 *   "Edge not found after rebuild". That loud failure beats blindly trusting an id that may have
 *   drifted onto a different edge.
 */
export function edgeMatchesRefInvariant(edge: IEdge, ref: EdgeRef): boolean {
    const basis = edge.curve.basisCurve;
    if (ref.kind === "line") {
        if (!CurveUtils.isLine(basis)) return false;
        const refDirection = new XYZ(ref.end).sub(new XYZ(ref.start)).normalize();
        const edgeDirection = edge.endPoint().sub(edge.startPoint()).normalize();
        return directionsParallel(refDirection, edgeDirection);
    }
    if (ref.kind === "circle") {
        if (!CurveUtils.isCircle(basis)) return false;
        return directionsParallel(new XYZ(ref.axis).normalize(), basis.axis.normalize());
    }
    return Math.abs(edge.length() - ref.length) <= MATCH_TOLERANCE;
}

/** `refScore` for two captured fingerprints — pure geometry, no kernel queries. */
export function refScoreRefs(a: EdgeRef, b: EdgeRef): number {
    if (a.kind === "circle") {
        if (b.kind !== "circle") return Infinity;
        return distance(a.center, b.center) + Math.abs(a.radius - b.radius) + axisDistance(a.axis, b.axis);
    }
    if (a.kind === "line") {
        if (b.kind !== "line") return Infinity;
        const direct = distance(a.start, b.start) + distance(a.end, b.end);
        const flipped = distance(a.start, b.end) + distance(a.end, b.start);
        return Math.min(direct, flipped);
    }
    if (b.kind !== "other") return Infinity;
    return distance(a.mid, b.mid) + Math.abs(a.length - b.length);
}

/**
 * A moved edge counts as matched only when the runner-up is at least 50% farther away.
 * A sole candidate wins by default — unless its score is infinite, which means its
 * curve type does not match the ref at all.
 */
export function isClearWinner(bestScore: number, secondScore: number | undefined): boolean {
    if (!Number.isFinite(bestScore)) return false;
    return secondScore === undefined || secondScore > 1.5 * bestScore + MATCH_TOLERANCE;
}

/**
 * Best (lowest) score of `ref` against `edges` — Infinity when no edge's curve type
 * matches at all (a degenerate edge scores Infinity too, see `refScore`). Unlike
 * `matchEdgeIndexes` this never accepts a "sole candidate": callers comparing
 * several candidate shapes need comparable scores, not a winner.
 */
export function bestEdgeScore(edges: IEdge[], ref: EdgeRef): number {
    let best = Infinity;
    for (const edge of edges) {
        best = Math.min(best, refScore(ref, edge));
    }
    return best;
}

/**
 * Scores a live edge by capturing its fingerprint first — the single scoring
 * formula lives in `refScoreRefs`. A degenerate edge (the capture throws) scores
 * Infinity: it never wins a scoring contest.
 */
export function refScore(ref: EdgeRef, edge: IEdge): number {
    try {
        return refScoreRefs(ref, captureEdgeRef(edge));
    } catch {
        return Infinity;
    }
}
