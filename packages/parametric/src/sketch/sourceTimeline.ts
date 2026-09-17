// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IShape, ShapeNode } from "@chili3d/core";
import { isBodyTimelineNode } from "../features/bodyTracking";

/**
 * "Which version of a referenced shape does this reference resolve against?"
 *
 * The question has three layers, and this module is the third:
 *
 * 1. **Producer** — a parametric body keeps every chain state it has replayed
 *    (`BodyTimeline`) plus the session rollback position (`IBodyTimelineNode.rollbackIndex`).
 * 2. **Anchor** — a sketch records where in that timeline it captured each reference
 *    (`SketchData.refPositions`), so a later feature consuming the geometry does not
 *    drag the reference along.
 * 3. **Consumer** — the decision below.
 *
 * Both consumers of layer 3 — external-reference edges (`externalRef.ts`) and the plane
 * reference (`planeRef.ts`) — route through `resolveTimelineSource`, so these rules exist
 * in exactly one place rather than once per reference kind.
 */

/** Marks a source showing a transient rollback preview; refs pointing at it stay untouched. */
export const ROLLED_BACK_SOURCE = Symbol("rolledBackSource");

/** Marks a source that cannot be read at all — gone, or not a shape node. */
export const SOURCE_UNAVAILABLE = Symbol("sourceUnavailable");

export interface TimelineSourceOptions {
    /**
     * True when the asking sketch owns the rollback session. A bystander sketch always
     * freezes on a preview; the owner only freezes when the rollback UNDERCUTS its
     * capture anchor (see `isFrozenSource`).
     */
    readonly includeRolledBackSources?: boolean;
    /**
     * Whether a timeline stand-in is acceptable. One the predicate rejects falls back to
     * the node's final shape, exactly as if no timeline state existed. Defaults to
     * accepting any stand-in; `externalRef.ts` rejects one with no edges, since a source
     * with nothing to match against is worse than the final shape.
     */
    readonly usable?: (shape: IShape) => boolean;
}

/** A source shape to resolve against, plus the tracked ids that go with it. */
export interface TimelineSource {
    readonly node: ShapeNode;
    readonly shape: IShape;
    /**
     * True when `shape` is a timeline stand-in rather than the node's final shape. The
     * node's own id lookups describe the final shape only, so a stand-in must be read
     * through `faceIds`/`edgeIds` instead.
     */
    readonly standIn: boolean;
    /** The stand-in's own tracked ids; undefined when the stand-in could not track. */
    readonly faceIds?: string[];
    readonly edgeIds?: string[];
}

export type TimelineSourceResult = TimelineSource | typeof ROLLED_BACK_SOURCE | typeof SOURCE_UNAVAILABLE;

/**
 * Resolves `nodeId`'s shape for a reference captured at `anchor`
 * (`SketchData.refPositions` — the body's feature-list index the reference was drawn on).
 *
 * The order is load-bearing:
 *
 * 1. **Frozen first, before any shape read.** A rolled-back preview must never even be
 *    evaluated for a bystander.
 * 2. **Then an anchor strictly inside the body's feature list** reads that timeline
 *    position, and is tried BEFORE the node's final shape: the stand-in re-bases
 *    everything (shape, ids), so it never needs `node.shape` — which a mid-chain read
 *    may only have as the pre-run result, an error right after deserialization.
 * 3. **Otherwise the final shape**, which is also the fallback when the anchor's state is
 *    unavailable or its stand-in is not `usable`.
 */
export function resolveTimelineSource(
    document: IDocument,
    nodeId: string,
    anchor: number | undefined,
    options?: TimelineSourceOptions,
): TimelineSourceResult {
    const node = document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode)) return SOURCE_UNAVAILABLE;
    if (isFrozenSource(node, anchor, options)) return ROLLED_BACK_SOURCE;

    // One shape read: the getter may evaluate (off-chain) or return the pre-run result
    // (mid-chain) — an error gates only the final-shape fallback below.
    const shapeResult = node.shape;
    const shape = shapeResult.isOk ? shapeResult.unchecked()! : undefined;

    if (anchor !== undefined && isBodyTimelineNode(node) && anchor < node.featureCount) {
        const state = node.timelineStateAt(anchor);
        // A stand-in that IS the final shape is no stand-in at all — the node's own id
        // lookups already describe it.
        if (state?.shape !== undefined && state.shape !== shape && (options?.usable?.(state.shape) ?? true)) {
            return {
                node,
                shape: state.shape,
                standIn: true,
                faceIds: state.faceIds,
                edgeIds: state.edgeIds,
            };
        }
    }
    if (shape === undefined) return SOURCE_UNAVAILABLE;
    return { node, shape, standIn: false };
}

/**
 * Whether the source must stay frozen for this session.
 *
 * A bystander sketch always freezes on a rollback preview. The session owner
 * (`includeRolledBackSources`) freezes only when the rollback UNDERCUTS its capture
 * anchor: the truncated replay never reaches the anchor, and the rolled-back shape is an
 * EARLIER state than the capture-time one — geometry born from the hidden features
 * `[rollback, anchor)` is gone, so resolving there dangles (or re-anchors) refs and
 * persists the corruption until the session ends. At or above the anchor the rolled-back
 * state IS the capture-time geometry, and the owner must keep resolving against it.
 */
export function isFrozenSource(
    node: ShapeNode,
    anchor: number | undefined,
    options: TimelineSourceOptions | undefined,
): boolean {
    if (!isBodyTimelineNode(node) || node.rollbackIndex === undefined) return false;
    if (options?.includeRolledBackSources !== true) return true;
    return anchor === undefined || node.rollbackIndex < anchor;
}
