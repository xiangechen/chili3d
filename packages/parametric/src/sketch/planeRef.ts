// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IFace, type Matrix4, Plane, ShapeNode, ShapeTypes, XYZ } from "@chili3d/core";
import { isBodyTimelineNode, isBodyTrackingNode } from "../features/bodyTracking";
import { indexesOfOverlappingId, type Vec3 } from "../features/edgeRef";
import { type ShapeSource, shapeSourceOf } from "./shapeSource";

/**
 * Identifies the planar face a sketch plane was captured from, in a rebuild-tolerant
 * way. `faceId` (kernel shape history, set for nodes that track faces) is the precise
 * path; `normal` + `offset` (the geometric fingerprint) is the fallback for nodes
 * without tracking — see `resolveFacePlane`.
 */
export interface PlaneFaceRef {
    nodeId: string;
    normal: Vec3;
    offset: number;
    faceId?: string;
}

/**
 * Outward-facing plane of a planar face, origin at the face's (0, 0) parameter
 * point. The face is expected to be transformed into world coordinates already.
 */
export function planeOfFace(face: IFace): Plane {
    const [point, normal] = face.normal(0, 0);
    return new Plane({ origin: point, normal, xvec: worldAxisXVec(normal) });
}

/**
 * Sketch-plane variant of `planeOfFace`: the origin is the world origin projected
 * onto the face, so a sketch's origin and axes coincide with the world axes instead
 * of the face's arbitrary (0, 0) parameter point. The axes still follow the face as
 * it moves, re-projecting the world origin onto the re-matched face.
 */
export function sketchPlaneOfFace(face: IFace): Plane {
    const [point, normal] = face.normal(0, 0);
    const n = normal.normalize()!;
    return new Plane({ origin: n.multiply(n.dot(point)), normal: n, xvec: worldAxisXVec(n) });
}

/**
 * X axis of a sketch-plane frame whose Y axis points "up": world +Z projected onto
 * the face (falling back to +Y for a horizontal face, where Z is the normal), with
 * X completing the right-handed frame as Y × normal. This keeps a sketch upright in
 * the viewport regardless of the face's tilt.
 */
function worldAxisXVec(normal: XYZ): XYZ {
    const n = normal.normalize()!;
    const yvec = Math.abs(n.z) > 1 - 1e-6 ? XYZ.unitY : XYZ.unitZ.sub(n.multiply(n.z)).normalize()!;
    return yvec.cross(n);
}

/** The face must already be in world coordinates. */
export function captureFaceRef(nodeId: string, face: IFace): PlaneFaceRef {
    const [point, normal] = face.normal(0, 0);
    return { nodeId, normal: { x: normal.x, y: normal.y, z: normal.z }, offset: normal.dot(point) };
}

/**
 * Re-resolves the sketch plane on the referenced node's current shape. A stored
 * `faceId` (kernel shape history, set for nodes that track faces) is the precise
 * path; `normal` + `offset` (the geometric fingerprint) is the fallback for nodes
 * without tracking — see `matchFace`.
 *
 * A parametric-body source is read at the sketch's timeline anchor (`anchors` —
 * `SketchData.refPositions`), mirroring the external-reference sources
 * (`sourceEdges` in externalRef.ts): the plane belongs to the body's shape at the
 * sketch's timeline position, so a downstream feature moving or consuming the
 * captured face does not drag the sketch's plane along. A missing timeline state
 * (body not evaluated that far yet) falls back to the final shape. Returns
 * undefined when the node or a matching face no longer exists; callers keep the
 * last plane then.
 */
export function resolveFacePlane(
    document: IDocument,
    ref: PlaneFaceRef,
    anchors?: Record<string, number>,
): Plane | undefined {
    const source = planeFaceSource(document, ref.nodeId, anchors);
    if (source === undefined) return undefined;
    const faces = source.shape.findSubShapes(ShapeTypes.face) as IFace[];
    const face = matchFace(faces, source.transform, ref, source.indexById, source.indexesOfId);
    if (face === undefined) return undefined;
    const worldFace = face.transformedMul(source.transform) as IFace;
    const plane = sketchPlaneOfFace(worldFace);
    worldFace.dispose();
    return plane;
}

type IdLookup = ((id: string) => number | undefined) | undefined;
type IdMultiLookup = ((id: string) => number[]) | undefined;

interface PlaneSource extends ShapeSource {
    indexById: IdLookup;
    indexesOfId: IdMultiLookup;
}

/**
 * The plane-ref counterpart of `sourceEdges` (externalRef.ts), re-based on faces.
 * The timeline stand-in carries its own face-id lookups (the node's tracked ids
 * describe its final shape only); it is tried FIRST, before the node's own shape,
 * which a mid-chain read may only have as the pre-run result — an error right
 * after deserialization ("Shape not initialized") gates just the final-shape
 * fallback.
 */
function planeFaceSource(
    document: IDocument,
    nodeId: string,
    anchors: Record<string, number> | undefined,
): PlaneSource | undefined {
    const node = document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode)) return undefined;
    const shape = node.shape.isOk ? node.shape.unchecked()! : undefined;
    const anchor = anchors?.[nodeId];
    if (anchor !== undefined && isBodyTimelineNode(node) && anchor < node.featureCount) {
        const state = node.timelineStateAt(anchor);
        if (state?.shape !== undefined && state.shape !== shape) {
            const ids = state.faceIds;
            return {
                ...shapeSourceOf(document, node, state.shape),
                indexById:
                    ids === undefined
                        ? undefined
                        : (id) => {
                              const index = ids.indexOf(id);
                              return index < 0 ? undefined : index;
                          },
                indexesOfId: ids === undefined ? undefined : (id) => indexesOfOverlappingId(ids, id),
            };
        }
    }
    if (shape === undefined) return undefined;
    const tracked = isBodyTrackingNode(node);
    return {
        ...shapeSourceOf(document, node, shape),
        indexById: tracked ? (id) => node.faceIndexById(id) : undefined,
        indexesOfId: tracked ? (id) => node.faceIndexesOfId(id) : undefined,
    };
}

function matchFace(
    faces: IFace[],
    transform: Matrix4,
    ref: PlaneFaceRef,
    indexById: IdLookup,
    indexesOfId: IdMultiLookup,
): IFace | undefined {
    const refNormal = new XYZ(ref.normal);
    let byId: IFace | undefined;
    let descendants: IFace[] = [];
    if (ref.faceId !== undefined && indexById !== undefined && indexesOfId !== undefined) {
        const index = indexById(ref.faceId);
        byId = index === undefined ? undefined : faces[index];
        // An exact hit trusts the id only while the face's normal still matches — a
        // rigid move along the normal (an extrude length edit) keeps both.
        if (byId !== undefined && normalMatches(byId, transform, refNormal)) return byId;
        descendants = indexesOfId(ref.faceId).map((i) => faces[i]);
    }
    // The exact id missed or its normal no longer matches. When the id still overlaps
    // pieces of the current shape (a merged face re-split by an upstream edit), match
    // the fingerprint against those descendants only — among them the piece still
    // lying on the captured plane wins, and an unrelated face closer to the captured
    // offset never enters the contest. Otherwise either the id realigned (a rebuild
    // reordered the faces — then the face carrying the captured normal is the right
    // one), or the face itself rotated in place (then no face matches the captured
    // normal and the id is the only signal left). Prefer the geometric hit when one
    // exists, else trust the id.
    return (
        closestFace(descendants, transform, refNormal, ref.offset) ??
        closestFace(faces, transform, refNormal, ref.offset) ??
        byId
    );
}

function normalMatches(face: IFace, transform: Matrix4, refNormal: XYZ): boolean {
    if (!face.surface().isPlanar()) return false;
    const [, normal] = face.normal(0, 0);
    return transform.ofVector(normal).dot(refNormal) >= 1 - 1e-6;
}

function closestFace(
    faces: IFace[],
    transform: Matrix4,
    refNormal: XYZ,
    refOffset: number,
): IFace | undefined {
    let best: IFace | undefined;
    let bestScore = Infinity;
    for (const face of faces) {
        if (!normalMatches(face, transform, refNormal)) continue;
        const [point] = face.normal(0, 0);
        const score = Math.abs(transform.ofPoint(point).dot(refNormal) - refOffset);
        if (score < bestScore) {
            best = face;
            bestScore = score;
        }
    }
    return best;
}
