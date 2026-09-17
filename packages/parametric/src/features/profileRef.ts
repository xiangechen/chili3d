// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IEdge, type IFace, ShapeTypes, type XYZ } from "@chili3d/core";
import { bestEdgeScore, captureEdgeRef, type EdgeRef } from "./edgeRef";
import { profileEntityIds } from "./profileEntities";
import { distance, type Vec3, vec3 } from "./refGeometry";

/**
 * A geometric fingerprint of a sketch profile (one closed loop): the fingerprints of its
 * outer-boundary edges, plus region-level identity (`center`/`area`).
 *
 * - **Why edge fingerprints are the primary identity.** Sketch faces have no kernel-stable ids
 *   (they are derived by `sketchProfiles`, not stored). Like `EdgeRef`, the edge fingerprints
 *   match exactly while the sketch is unchanged and re-match by proximity after edits.
 * - **Only the outer wire is fingerprinted.** A loop drawn inside the profile later becomes a
 *   hole of its face (even-odd semantics), which must not change the profile's identity.
 * - **On crossing sketches, `entities` takes over as the primary identity:** the sorted ids of
 *   the sketch entities bounding the region. Endpoint drags never change entity ids, whereas
 *   neighbouring regions share complementary segments of the same entities, which makes their
 *   geometric fingerprints near-identical.
 * - **Tiebreak and fallback.** Regions bounded by the same entity set (the lens regions of two
 *   crossing circles) are told apart by the `center`/`area` region fingerprint — which is also
 *   the fallback when no candidate carries the ref's entity set (the crossing pattern changed).
 * - **Legacy refs** serialized before these fields existed keep the strict edge-count behavior.
 *   See `matchProfileIndexes`.
 */
export interface ProfileRef {
    readonly edges: EdgeRef[];
    readonly center?: Vec3;
    readonly area?: number;
    /** Sorted ids of the sketch entities bounding the region (crossing sketches only). */
    readonly entities?: number[];
    /**
     * Identity assigned by the owning parametric feature chain — set for press-pull refs captured
     * from a parametric body's face, absent for sketch-side refs and pre-id documents. Face ids
     * survive rebuilds: a face split by a later cut shares one id across its pieces, and a face
     * MERGED from several faces combines their ids into a compound (`combineIds`), so an id hit
     * (`idsOverlap`) adopts every piece of a later re-split as well as a re-merge of the pieces —
     * mirroring EdgeRef's whole-span adoption. A ref captured from ONE piece of an already split
     * face narrows to that piece instead (`matchSourceFaceIndexes` in sourceFaceMatcher.ts).
     */
    readonly id?: string;
    /**
     * `splitPiece` records that the id was already shared by several faces at capture
     * time — a boolean had split the original face and the pick is just one piece.
     * `matchSourceFaceIndexes` uses it to never widen such a ref to the whole span:
     * a stale fingerprint resolves to the clear nearest piece or fails "Face match is
     * ambiguous after rebuild". Absent on older documents, where refs keep the
     * whole-span adoption.
     */
    readonly splitPiece?: boolean;
    /**
     * Outward normal of the picked solid face — captured ONLY for source-face refs
     * (press-pull): a planar face's outward normal survives the rigid moves parameter
     * edits cause, so `profileScore` rejects a candidate facing more than 60° away
     * (a groove's down-facing ceiling vs its up-facing floor and its walls, which tie
     * geometrically once the ceiling is consumed). Sketch-side refs deliberately lack
     * it: a solver-mirrored wire rebuilds the region face with the flipped
     * orientation, and the gate would reject the legitimate match.
     */
    readonly normal?: Vec3;
}

export function captureProfileRef(
    face: IFace,
    id?: string,
    splitPiece?: boolean,
    captureNormal = false,
): ProfileRef {
    const edges = boundaryEdges(face).map((edge) => captureEdgeRef(edge));
    const entities = profileEntityIds(face);
    let normal: Vec3 | undefined;
    if (captureNormal) {
        const xyz = face.normal(0, 0)[1].normalize();
        if (xyz !== undefined) normal = vec3(xyz);
    }
    return {
        edges,
        entities,
        splitPiece,
        id,
        normal,
        ...captureRegionFingerprint(face),
    };
}

/** Edges of the face's outer wire — the profile's identity; hole wires are incidental. */
function boundaryEdges(face: IFace): IEdge[] {
    return face.outerWire().findSubShapes(ShapeTypes.edge) as IEdge[];
}

/**
 * Sum of the ref's per-edge `bestEdgeScore`s; falls back to `regionScore` when the
 * boundary re-split into a different edge count (crossing sketches) or the curve
 * kinds changed. Also the scorer of the press-pull id-hit narrowing (see
 * `matchSourceFaceIndexes` in sourceFaceMatcher.ts). A ref carrying an outward `normal`
 * (source-face picks) rejects candidates facing away before any geometry is scored.
 */
export function profileScore(face: IFace, ref: ProfileRef): number {
    if (ref.normal !== undefined && !normalsAgree(face.normal(0, 0)[1].normalize(), ref.normal)) {
        return Infinity;
    }
    const edges = boundaryEdges(face);
    if (edges.length === ref.edges.length) {
        let score = 0;
        for (const edgeRef of ref.edges) {
            score += bestEdgeScore(edges, edgeRef);
        }
        if (Number.isFinite(score)) return score;
    }
    return regionScore(face, ref);
}

/**
 * Orientation slack for the `normal` gate: the outward normal of a planar face
 * survives rigid moves exactly, so 60° (dot 0.5) never rejects a moved face, while
 * the perpendicular walls and the opposite floor of a consumed groove are rejected.
 * Draft-style edits tilt well below 60°.
 */
const NORMAL_MATCH_DOT = 0.5;

function normalsAgree(candidate: XYZ | undefined, normal: Vec3): boolean {
    if (candidate === undefined) return false;
    return candidate.x * normal.x + candidate.y * normal.y + candidate.z * normal.z >= NORMAL_MATCH_DOT;
}

/**
 * The region fingerprint shared by profile matching, profile-seed ordering and
 * face history completion: bbox center + area. Captured once per face — both
 * queries are kernel calls.
 */
export function captureRegionFingerprint(face: IFace): { center: Vec3; area: number } {
    return { center: vec3(BoundingBox.center(face.boundingBox())), area: face.area() };
}

/**
 * Region similarity: center drift + area drift normalized by the profile's
 * characteristic length. Beyond twice that length the candidate is a different
 * region, not a moved one — Infinity, so a sole leftover face cannot silently claim
 * the ref. A ref without a region fingerprint (legacy documents) scores Infinity.
 */
export function regionScore(face: IFace, ref: ProfileRef): number {
    if (ref.center === undefined || ref.area === undefined || ref.area <= 0) return Infinity;
    const length = Math.sqrt(ref.area);
    const region = captureRegionFingerprint(face);
    const score = distance(region.center, ref.center) + Math.abs(region.area - ref.area) / length;
    return score <= 2 * length ? score : Infinity;
}
