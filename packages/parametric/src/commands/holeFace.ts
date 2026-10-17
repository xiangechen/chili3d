// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IFace, type Matrix4, type Plane, ShapeTypes, type XYZ } from "@chili3d/core";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { directionsParallel, MATCH_TOLERANCE } from "../features/refGeometry";
import { ParametricBodyNode } from "../parametricBodyNode";
import { captureFaceRef, type PlaneFaceRef, sketchPlaneOfFace } from "../sketch/planeRef";
import { toWorld } from "../sketch/sketchModel";
import type { SketchNode } from "../sketch/sketchNode";

/** What picking the hole face captured — everything the point loop and the feature need. */
export interface PickedHoleFace {
    readonly body: ParametricBodyNode;
    readonly ref: PlaneFaceRef;
    /**
     * The UV frame the centers are stored in, in the body's local frame — built by
     * `sketchPlaneOfFace` on the LOCAL face, exactly as `resolveHolePlane` rebuilds it, so a
     * stored (u, v) names the same point in the command and in every evaluation.
     */
    readonly frame: Plane;
    /** `frame` in world coordinates — what the point snap projects onto. */
    readonly worldFrame: Plane;
    /** The picked face in world coordinates, kept alive to validate the picked points against. */
    readonly worldFace: IFace;
}

/**
 * Everything a hole feature needs from its face, captured once: the rebuild-tolerant ref
 * (`captureFaceRef` plus the tracked id when the face has one), the local UV frame the centers
 * are stored in, that frame in world coordinates, and the world face itself. The world face is
 * a fresh shape — the CALLER keeps it alive and disposes it when the pick session ends.
 *
 * Shared by the direct face click (`HoleCenterPickHandler`, face from the pick pipeline) and
 * the deduction from selected sketch points (`deduceHoleFace`, face found by enumeration), so
 * both capture identically.
 */
export function capturePickedHoleFace(
    body: ParametricBodyNode,
    localFace: IFace,
    worldTransform: Matrix4,
    faceIndex: number | undefined,
): PickedHoleFace {
    const worldFace = localFace.transformedMul(worldTransform) as IFace;
    const ref = captureFaceRef(body.id, worldFace);
    const faceId = faceIndex === undefined ? undefined : body.faceIdAt(faceIndex);
    if (faceId === undefined) {
        // Not fatal: the ref keeps its geometric fingerprint and re-matches on that.
        reportSilentIdLoss(body, "face", "a picked hole face has no tracked id");
    } else {
        ref.faceId = faceId;
    }
    const frame = sketchPlaneOfFace(localFace);
    return { body, ref, frame, worldFrame: frame.transformed(worldTransform), worldFace };
}

/**
 * The face a set of selected sketch points implies, so picking points alone can place holes
 * without a separate face click: among the visible parametric bodies, the planar face COPLANAR
 * with the sketch's plane that the most selected points land on. Coplanar means parallel
 * normals (`directionsParallel` — anti-parallel counts: a face on the sketch's far side is the
 * same plane) and an offset within `MATCH_TOLERANCE`. A face containing none of the points is
 * not a candidate — a merely coplanar but unrelated face never wins. Ties go to the first
 * encountered, which keeps the result stable across identical runs.
 *
 * Undefined when no body offers such a face — the caller then asks for the face by hand.
 */
export function deduceHoleFace(
    document: IDocument,
    sketch: SketchNode,
    entityIds: readonly number[],
): PickedHoleFace | undefined {
    const transform = sketch.worldTransform();
    const worldPoints = sketch.data.entities
        .filter((entity) => entity.type === "point" && entityIds.includes(entity.id))
        .map((entity) => transform.ofPoint(toWorld(sketch.plane, entity.params[0], entity.params[1])));
    if (worldPoints.length === 0) return undefined;
    const sketchPlane = sketch.plane.transformed(transform);

    let best: { body: ParametricBodyNode; face: IFace; index: number; contained: number } | undefined;
    const bodies = document.modelManager.findNodes(
        (n) => n instanceof ParametricBodyNode,
    ) as ParametricBodyNode[];
    for (const body of bodies) {
        if (!body.visible || !body.parentVisible || !body.shape.isOk) continue;
        const candidate = coplanarFaceContaining(body, sketchPlane, worldPoints);
        if (candidate !== undefined && (best === undefined || candidate.contained > best.contained)) {
            best = { body, ...candidate };
        }
    }
    if (best === undefined) return undefined;
    return capturePickedHoleFace(best.body, best.face, best.body.worldTransform(), best.index);
}

/**
 * One body's best face: coplanar with `sketchWorldPlane` and containing the most of
 * `worldPoints`. All matching is done in the body's LOCAL frame — the sketch plane and the
 * points are mapped once with the inverse world transform (an uninvertible one, a degenerate
 * scale, skips the body).
 */
function coplanarFaceContaining(
    body: ParametricBodyNode,
    sketchWorldPlane: Plane,
    worldPoints: readonly XYZ[],
): { face: IFace; index: number; contained: number } | undefined {
    const inverse = body.worldTransform().invert();
    if (inverse === undefined) return undefined;
    const localPlane = sketchWorldPlane.transformed(inverse);
    const localPoints = worldPoints.map((point) => inverse.ofPoint(point));

    let best: { face: IFace; index: number; contained: number } | undefined;
    const faces = body.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    faces.forEach((face, index) => {
        if (!face.surface().isPlanar()) return;
        const [point, normal] = face.normal(0, 0);
        if (!directionsParallel(normal, localPlane.normal)) return;
        if (Math.abs(normal.dot(point) - normal.dot(localPlane.origin)) > MATCH_TOLERANCE) return;
        const contained = localPoints.filter((p) => faceContains(face, point, normal, p)).length;
        if (contained > 0 && (best === undefined || contained > best.contained)) {
            best = { face, index, contained };
        }
    });
    return best;
}

/**
 * Whether `point` lands on the face, probed with a ray along the face normal from the point's
 * projection onto the face's own plane — the on-plane probe the `intersectLine` tolerance
 * convention (1e-6, the hole command's `pointOnFace`) expects. The projection only moves the
 * point along the normal, so it never changes the containment answer; it is there because the
 * probe point comes from the SKETCH plane, which is itself only MATCH_TOLERANCE-close to the
 * face plane.
 */
function faceContains(face: IFace, facePoint: XYZ, normal: XYZ, point: XYZ): boolean {
    const onPlane = point.sub(normal.multiply(normal.dot(point.sub(facePoint))));
    return face.intersectLine(onPlane, normal, 1e-6) !== undefined;
}
