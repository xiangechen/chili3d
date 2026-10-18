// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IFace, Matrix4, type Plane, Result, ShapeTypes } from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import type { NeutralPlaneRef } from "../features/feature";
import { indexesOfOverlappingId } from "../features/trackedId";
import {
    datumPlaneOf,
    type IdLookup,
    type IdMultiLookup,
    matchFace,
    sketchPlaneOfFace,
} from "../sketch/planeRef";
import { shapeSourceOf } from "../sketch/shapeSource";
import {
    ROLLED_BACK_SOURCE,
    resolveTimelineSource,
    SOURCE_UNAVAILABLE,
    type TimelineSource,
} from "../sketch/sourceTimeline";
import { isPlaneNode } from "./planeNodeContract";

/** Options of a plane-source resolution: the caller's label for errors, and the cycle guard. */
export interface PlaneSourceOptions {
    readonly label?: string;
    /**
     * Plane nodes already on the resolution stack. A plane node that names itself
     * (directly or through another plane node) is refused instead of recursing.
     */
    readonly visited?: ReadonlySet<string>;
}

/**
 * A `NeutralPlaneRef` as the world plane it names.
 *
 * The three sources are resolved by different means on purpose:
 *
 * - a datum is three frozen planes, so its name alone re-derives it;
 * - a face is a fingerprint re-matched against the source node's shape at the captured
 *   timeline position — `anchors` is what keeps a downstream feature from dragging the
 *   datum plane's source geometry along (the same rule `SketchNode` follows);
 * - a plane node is another user-created datum, so its own resolved plane is the answer.
 *   `visited` breaks a reference cycle.
 */
export function resolvePlaneSourceInWorld(
    document: IDocument,
    ref: NeutralPlaneRef,
    anchors?: Readonly<Record<string, number>>,
    options?: PlaneSourceOptions,
): Result<Plane> {
    const label = options?.label ?? "Plane";
    if (ref.kind === "datum") return Result.ok(datumPlaneOf(ref.name));
    if (ref.kind === "planeNode") return planeNodePlane(document, ref.nodeId, label, options?.visited);
    return facePlane(document, ref.ref, anchors, label);
}

/** The plane of another datum-plane node, with the cycle guard applied around it. */
function planeNodePlane(
    document: IDocument,
    nodeId: string,
    label: string,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    if (visited?.has(nodeId) === true) return Result.err(`${label} plane reference is cyclic`);
    const node = document.modelManager.findNode((n) => n.id === nodeId);
    if (!isPlaneNode(node)) return Result.err(`${label} plane reference not found`);
    // NOT added to `visited` here: `worldPlane` adds the node itself when it resolves its
    // own definition. Adding it before the call made every plane-node reference a
    // self-cycle and returned undefined.
    const plane = node.worldPlane(visited);
    if (plane === undefined) return Result.err(`${label} plane reference is not available`);
    return Result.ok(plane);
}

/** A planar face ref, re-matched on the source node's shape. */
function facePlane(
    document: IDocument,
    ref: Extract<NeutralPlaneRef, { kind: "face" }>["ref"],
    anchors: Readonly<Record<string, number>> | undefined,
    label: string,
): Result<Plane> {
    const source = resolveTimelineSource(document, ref.nodeId, anchors?.[ref.nodeId]);
    if (source === ROLLED_BACK_SOURCE) return Result.err(`${label} plane body is rolled back`);
    if (source === SOURCE_UNAVAILABLE) return Result.err(`${label} plane body not found`);

    const base = shapeSourceOf(document, source.node, source.shape);
    const faces = source.shape.findSubShapes(ShapeTypes.face) as IFace[];
    const lookup = faceIdLookup(source);
    const face = matchFace(faces, base.transform, ref, lookup.indexById, lookup.indexesOfId);
    if (face === undefined) return Result.err(`${label} plane not found after rebuild`);

    const identity = base.transform.equals(Matrix4.identity());
    const worldFace = identity ? face : (face.transformedMul(base.transform) as IFace);
    try {
        if (!worldFace.surface().isPlanar()) {
            return Result.err(`${label} plane face is no longer planar`);
        }
        // `sketchPlaneOfFace` re-origins the plane at the world origin's projection, not at
        // the face's arbitrary (0,0) parameter point — the latter may sit outside the
        // trimmed face and drifts when the face is rebuild-matched. A datum plane's origin
        // becomes the sketch's coordinate origin, so it must be stable.
        return Result.ok(sketchPlaneOfFace(worldFace));
    } catch (error) {
        return Result.err(`${label} plane face could not be read: ${String(error)}`);
    } finally {
        if (!identity) worldFace.dispose();
    }
}

/** The tracked-id lookups of the face list a ref is matched against. */
function faceIdLookup(source: TimelineSource): {
    readonly indexById: IdLookup;
    readonly indexesOfId: IdMultiLookup;
} {
    if (source.standIn) {
        const ids = source.faceIds;
        return {
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
    const node = source.node;
    if (!isBodyTrackingNode(node)) return { indexById: undefined, indexesOfId: undefined };
    return {
        indexById: (id) => node.faceIndexById(id),
        indexesOfId: (id) => node.faceIndexesOfId(id),
    };
}
