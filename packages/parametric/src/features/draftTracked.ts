// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IFace,
    type IShape,
    type Plane,
    Result,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { type CompletedTrackedHistory, completeTrackedHistory, trackedIds } from "./feature";
import { bornEdgeIdMap } from "./operationIds";
import { prefixedId, writeUncontestedIds } from "./trackedId";

/**
 * The tracked counterpart of `draft`: the chain input's named faces are tapered about a neutral
 * plane, and every sub-shape the kernel builds is named from the input it came from.
 *
 * **What the kernel reports, and why this is the short version of `shellTracked`.** A draft
 * MODIFIES the shape it is given — nothing is hollowed, nothing is deleted, no new channel is
 * needed:
 *
 * 1. A tapered face is reported as derived from the face it was (`Generated`, which
 *    `mapInputShape` reads beside `Modified` — the algorithm answers `Modified` only for faces
 *    whose geometry it did NOT recompute). So the tilted face keeps the id of the face the user
 *    picked, which is the whole point: an edge ref or a later feature naming that face keeps
 *    resolving onto it as the taper changes.
 * 2. Its edges move with it and are reported the same way (`edgeHistory`), so they keep their ids
 *    too.
 * 3. **No face is ever generated from an edge** — `BRepOffsetAPI_DraftAngle::Generated` answers
 *    for faces only. That is why `faceEdgeMap` is never consulted here (the sweep-oriented
 *    `trackedFaceIds` would be dead weight), and why the C++ side leaves the channel empty.
 * 4. There is no parallel-copy channel either: unlike a thicken, a draft creates no offset image
 *    of its input. Both offset channels are empty, by construction rather than by omission.
 *
 * **What stays unnamed**: where a tapered face pulls away from a neighbour that does not taper
 * with it, the kernel inserts a face to bridge the gap. Nothing derives it, and it derives from
 * nothing — so it gets no id and the matching layer resolves it geometrically, the same
 * documented degradation as a shell's outward corner patches (`trackedIds` in feature.ts).
 * Its boundary edges are named by the two faces they join (`bornEdgeIdMap`), which is what keeps
 * a reference on one of THEM alive across a taper edit.
 */

/** The kernel input: the chain's shape, the faces to taper (its own sub-shapes), plus their ids. */
export interface DraftInput {
    /** The body's chain input — what gets tapered. */
    readonly shape: IShape;
    /**
     * The faces to taper, as ACTUAL sub-shapes of `shape` (same TShape): the kernel matches them
     * by identity, and its edge index would miss a transformed copy from another frame.
     */
    readonly faces: readonly IFace[];
    /** Tracked ids of `shape`'s faces, in its `findSubShapes` order. */
    readonly faceIds: readonly (string | undefined)[];
    /** Tracked ids of `shape`'s edges, in its `findSubShapes` order. */
    readonly edgeIds: readonly (string | undefined)[];
}

/** A draft result with the stable ids of every sub-shape it built, in findSubShapes order. */
export interface DraftIds {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Tapers `input.faces` about `neutralPlane` by `angle` DEGREES, naming every sub-shape the kernel
 * builds. `pullDirection` is in the same frame as `input.shape` (the host's local frame) and is
 * the side a positive angle removes material from.
 *
 * Returns `undefined` when the kernel offers no tracked draft — the caller then takes the plain
 * path, which builds the same geometry with no ids at all. `featureId` scopes the names minted
 * for sub-shapes no input produced, so two drafts in one chain cannot compute the same one.
 */
export function draftTracked(
    input: DraftInput,
    pullDirection: XYZ,
    angle: number,
    neutralPlane: Plane,
    featureId: string,
): Result<DraftIds> | undefined {
    if (shapeFactory.draftTracked === undefined) return undefined;
    const result = shapeFactory.draftTracked(
        input.shape,
        [...input.faces],
        pullDirection,
        angle,
        neutralPlane,
    );
    if (!result.isOk) return Result.err(result.error);

    const tracked: TrackedShape = result.value;
    const completed = completeTrackedHistory([input.shape], tracked, {
        inputFaces: input.shape.findSubShapes(ShapeTypes.face) as IFace[],
        inputEdges: input.shape.findSubShapes(ShapeTypes.edge) as IEdge[],
    });
    const faceIds = trackedIds(input.faceIds, completed.faceMap);
    return Result.ok({
        shape: tracked.shape,
        faceIds,
        edgeIds: nameEdges(tracked.shape, input.edgeIds, completed, faceIds, featureId),
    });
}

/**
 * Names every output edge, in the order the two kinds become nameable:
 * - **inherited** — the derivation pairs give it an input edge's id (`trackedIds`), which is what
 *   keeps the boundary of a tapered face stable.
 * - **born** — whatever is left takes the two faces it joins (`bornEdgeIdMap`). Edges the
 *   geometry did not carry over are exactly the ones that MOVED, so this is not a rare fallback
 *   here the way it is for a boolean: measured on a 40×40×20 plate with its four sides tapered,
 *   the kernel reports no edge derivation at all and the four edges lying on the neutral plane are
 *   recovered geometrically — the other eight are named by this pass. A bridging face has no id,
 *   so the edges bordering it stay unnamed; that is `bornEdgeIdMap`'s documented "a conjunction
 *   needs both sides" rule, not a gap here.
 *
 * `shape` is the OUTPUT — `bornEdgeIdMap` resolves each output edge's neighbouring faces within
 * it, so handing it the input would find nothing.
 */
function nameEdges(
    shape: IShape,
    inputEdgeIds: readonly (string | undefined)[],
    completed: CompletedTrackedHistory,
    faceIds: readonly (string | undefined)[],
    featureId: string,
): (string | undefined)[] {
    const edgeIds = trackedIds(inputEdgeIds, completed.edgeMap);
    const born = bornEdgeIdMap(
        shape,
        completed.outputEdges,
        completed.outputFaces,
        faceIds,
        // Still unnamed: the derivation has already named the edges it inherited.
        (index) => completed.edgeMap[index] < 0 && edgeIds[index] === undefined,
    );
    writeUncontestedIds(edgeIds, new Map([...born].map(([index, id]) => [index, prefixedId(featureId, id)])));
    return edgeIds;
}
