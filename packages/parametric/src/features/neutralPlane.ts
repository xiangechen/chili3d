// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, Matrix4, type Plane, Result, ShapeNode, ShapeTypes } from "@chili3d/core";
import { datumPlaneOf, type IdLookup, type IdMultiLookup, matchFace, planeOfFace } from "../sketch/planeRef";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import type { FeatureContext, IShapeHost, NeutralPlaneRef } from "./feature";
import { indexesOfOverlappingId } from "./trackedId";

/**
 * Resolving the plane a feature names — a draft's neutral plane, a mirror's mirror plane; both
 * are a `NeutralPlaneRef` — into the host body's local frame, which is the frame the kernel runs
 * in.
 *
 * The plane is the one reference of those features that may live OUTSIDE the body, so it is
 * resolved in two halves: `worldPlaneOf` finds it in world coordinates (where the pick captured
 * it), and `neutralPlaneInHost` maps it back with the host's transform. `label` is the feature's
 * display name; it only prefixes the error messages.
 */
export function resolveNeutralPlane(
    ref: NeutralPlaneRef,
    context: FeatureContext,
    label: string,
): Result<Plane> {
    const world = worldPlaneOf(ref, context, label);
    if (!world.isOk) return Result.err(world.error);
    return neutralPlaneInHost(world.value, context.host, label);
}

/**
 * A world-space plane expressed in the host body's own frame — the frame its feature chain and
 * the kernel live in. Exported because the commands' live previews need the same mapping: they
 * build their shape with the same kernel call the feature will make, so a plane mapped any other
 * way would preview a result the feature does not build.
 *
 * The mapping is rigid in practice — a body's transform is a placement — and the only transform
 * that could make `Plane.transformed` throw is a singular one, which `invert()` already reports
 * as undefined.
 */
export function neutralPlaneInHost(world: Plane, host: IShapeHost, label: string): Result<Plane> {
    const inverse = host.worldTransform().invert();
    if (inverse === undefined) return Result.err(`${label} cannot place the plane in the body`);
    return Result.ok(world.transformed(inverse));
}

/** The plane as captured: a datum by name, or a face ref re-matched on its node. */
function worldPlaneOf(ref: NeutralPlaneRef, context: FeatureContext, label: string): Result<Plane> {
    if (ref.kind === "datum") return Result.ok(datumPlaneOf(ref.name));
    const source = planeFaceSource(ref.ref.nodeId, context, label);
    if (!source.isOk) return Result.err(source.error);
    const face = matchFace(
        source.value.faces,
        source.value.transform,
        ref.ref,
        idLookup(source.value.faceIds),
        idMultiLookup(source.value.faceIds),
    );
    if (face === undefined) return Result.err(`${label} plane not found after rebuild`);
    // `planeOfFace` rather than the sketch path's `sketchPlaneOfFace`: a feature wants the face's
    // own outward plane (a draft's default pull direction is its normal), not a sketch's
    // re-origined frame. Both lie on the same plane, so only the orientation of the frame differs.
    const worldFace = source.value.transform.equals(Matrix4.identity())
        ? face
        : (face.transformedMul(source.value.transform) as IFace);
    try {
        return Result.ok(planeOfFace(worldFace));
    } finally {
        if (worldFace !== face) worldFace.dispose();
    }
}

/** A face set a plane ref is matched against, with the frame it lives in and its tracked ids. */
interface PlaneFaceSource {
    readonly faces: IFace[];
    readonly faceIds: readonly (string | undefined)[] | undefined;
    readonly transform: Matrix4;
}

/**
 * The faces `nodeId`'s plane ref was captured on.
 *
 * The host's OWN id is the interesting case and is deliberately not routed through
 * `resolveFacePlane(document, ref)` (the sketch path): that reads the referenced node's final
 * shape, and this feature is being replayed INTO that node — its final shape is the previous
 * rebuild's, and on the very first one there is none at all. `context.input` is by definition the
 * chain state at this feature's position, so that is what the ref is matched on. A FOREIGN node
 * has no such circularity and is read off its live shape, the way `sourceNodeFaces` does it for a
 * press-pull.
 */
function planeFaceSource(nodeId: string, context: FeatureContext, label: string): Result<PlaneFaceSource> {
    if (nodeId === context.host.id) {
        const input = context.input;
        if (input === undefined) return Result.err(`${label} requires a preceding feature`);
        const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
        const ids = context.tracking?.inputFaceIds;
        return Result.ok({
            faces,
            faceIds: ids !== undefined && ids.length === faces.length ? ids : undefined,
            transform: context.host.worldTransform(),
        });
    }
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    // Three different troubles, three messages: "not found" sent a user hunting for a body that was
    // sitting right there but had failed to build, which is a different fix (repair that feature).
    if (node === undefined) return Result.err(`${label} plane body not found`);
    if (!(node instanceof ShapeNode)) return Result.err(`${label} plane source is not a body`);
    if (!node.shape.isOk) return Result.err(`${label} plane body failed to build`);
    // A rolled-back node's shape is the session's preview, not its real state — refuse it.
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
        return Result.err(`${label} plane body is rolled back`);
    }
    const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const tracked = isBodyTrackingNode(node) ? node : undefined;
    return Result.ok({
        faces,
        faceIds: tracked === undefined ? undefined : faces.map((_, index) => tracked.faceIdAt(index)),
        transform: node.worldTransform(),
    });
}

/** The tracked-id lookup a face set gives `matchFace`, or undefined where it carries no tracking. */
function idLookup(ids: readonly (string | undefined)[] | undefined): IdLookup {
    return ids === undefined
        ? undefined
        : (id) => {
              const index = ids.indexOf(id);
              return index < 0 ? undefined : index;
          };
}

/** The multi-hit counterpart of `idLookup`: a face split since the capture matches by every piece. */
function idMultiLookup(ids: readonly (string | undefined)[] | undefined): IdMultiLookup {
    return ids === undefined ? undefined : (id) => indexesOfOverlappingId(ids, id);
}
