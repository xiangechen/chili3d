// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type IFace,
    type INodeVisual,
    Matrix4,
    Plane,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { Vec3 } from "../features/edgeRef";
import { ParametricBodyNode } from "../parametricBodyNode";

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
    const xvec = normal.isParallelTo(XYZ.unitZ) ? XYZ.unitX : XYZ.unitZ.cross(normal).normalize()!;
    return new Plane({ origin: point, normal, xvec });
}

/** The face must already be in world coordinates. */
export function captureFaceRef(nodeId: string, face: IFace): PlaneFaceRef {
    const [point, normal] = face.normal(0, 0);
    return { nodeId, normal: { x: normal.x, y: normal.y, z: normal.z }, offset: normal.dot(point) };
}

/**
 * Re-resolves the sketch plane on the referenced node's current shape. A stored
 * `faceId` hits exactly (the id survives rebuilds via kernel shape history) — but
 * only when the resolved face's normal still matches the captured one, since
 * index-scoped ids realign when a rebuild reorders faces; otherwise the geometric
 * fingerprint applies: among planar faces with the captured normal direction, the
 * one whose offset is closest to the captured offset wins — a parameter edit moves
 * the face rigidly along its normal, so the direction identifies the face and the
 * nearest offset disambiguates co-directional faces. Returns undefined when the
 * node or a matching face no longer exists; callers keep the last plane then.
 */
export function resolveFacePlane(document: IDocument, ref: PlaneFaceRef): Plane | undefined {
    const node = document.modelManager.findNode((n) => n.id === ref.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return undefined;
    const visual = document.visual.context.getVisual(node) as INodeVisual | undefined;
    const transform = visual?.worldTransform() ?? Matrix4.identity();
    const faces = node.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const face = matchFace(node, faces, transform, ref);
    if (face === undefined) return undefined;
    const worldFace = face.transformedMul(transform) as IFace;
    const plane = planeOfFace(worldFace);
    worldFace.dispose();
    return plane;
}

function matchFace(
    node: ShapeNode,
    faces: IFace[],
    transform: Matrix4,
    ref: PlaneFaceRef,
): IFace | undefined {
    const refNormal = new XYZ(ref.normal);
    if (ref.faceId !== undefined && node instanceof ParametricBodyNode) {
        const index = node.faceIndexById(ref.faceId);
        const face = index === undefined ? undefined : faces[index];
        // Index-scoped ids (the prism's side/top faces) realign when a rebuild changes
        // the face enumeration order — e.g. a mirrored profile flips the side-face
        // order — so a hit is trusted only when the normal still matches; otherwise
        // the geometric fingerprint below is the better guess.
        if (face !== undefined && normalMatches(face, transform, refNormal)) return face;
    }
    return closestFace(faces, transform, refNormal, ref.offset);
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
