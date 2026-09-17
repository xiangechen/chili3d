// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape, Matrix4, Result } from "@chili3d/core";
import type { FeatureTimelineState } from "./bodyTracking";
import { idIsShared, indexesOfOverlappingId } from "./trackedId";

/**
 * What the last successful chain run produced, kept for reuse and for id lookup:
 * one cache entry per feature plus the chain state entering each index.
 *
 * Why the two live together: a timeline entry holds a reference to the cache entry's
 * shape, so they only ever describe the same run. Splitting them across two fields
 * would let a caller update one and forget the other.
 */

/** Snapshot of one referenced node, used to decide whether a cached entry is still valid. */
export interface RefSnapshot {
    readonly shape: Result<IShape> | undefined;
    /** World transform at capture time — moving a reference must bust the cache too. */
    readonly transform: Matrix4 | undefined;
}

export function sameTransform(left: Matrix4 | undefined, right: Matrix4 | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return left.equals(right);
}

/** Output of one evaluated feature, reused while the feature and its inputs stay unchanged. */
export interface FeatureCacheEntry {
    /** Serialized feature at evaluation time. */
    readonly json: string;
    /** Input shape identity at evaluation time. */
    readonly input: IShape | undefined;
    /** Referenced node states (e.g. the sketch) at evaluation time, by node id. */
    readonly refs: ReadonlyMap<string, RefSnapshot>;
    readonly shape: IShape;
    /**
     * Stable face/edge ids of `shape` (findSubShapes order), from kernel shape history.
     * Undefined when any link in the chain could not track (e.g. unsupported kernel).
     */
    readonly faceIds?: string[];
    readonly edgeIds?: string[];
}

/** Which of the two tracked id arrays a query addresses. */
export type TrackedIdKind = "face" | "edge";

export class BodyTimeline {
    private _cache: FeatureCacheEntry[] = [];
    /** Chain state entering each feature-list index, swapped atomically with `_cache`. */
    private _committed: FeatureTimelineState[] = [];
    /**
     * Timeline of the run in flight. Exposed to readers for the duration of a run so a
     * mid-chain reference resolution sees the states already rebuilt by THIS run — the
     * committed timeline still describes the previous one.
     */
    private _inflight: FeatureTimelineState[] | undefined;

    /**
     * Opens a run and returns the array the caller fills with one state per visited
     * index. Callers must pair this with `endRun` so `_inflight` never outlives the run.
     */
    beginRun(): FeatureTimelineState[] {
        const timeline: FeatureTimelineState[] = [];
        this._inflight = timeline;
        return timeline;
    }

    endRun(): void {
        this._inflight = undefined;
    }

    /**
     * The chain state entering `index` — the in-flight run shadows the committed one.
     * Undefined for an empty input (index 0), an out-of-range index, or a position a
     * truncated (rolled-back) replay never reached.
     */
    stateAt(index: number): FeatureTimelineState | undefined {
        const state = (this._inflight ?? this._committed)[index];
        return state?.shape === undefined ? undefined : state;
    }

    entryAt(index: number): FeatureCacheEntry | undefined {
        return this._cache[index];
    }

    /**
     * Installs a completed run, disposing the shapes it evicted. `currentShape` — the
     * node's own shape — is never disposed here; its lifecycle belongs to the node.
     */
    commit(next: FeatureCacheEntry[], timeline: FeatureTimelineState[], currentShape?: IShape): void {
        const reused = new Set(next.map((entry) => entry.shape));
        for (const entry of this._cache) {
            if (!reused.has(entry.shape) && entry.shape !== currentShape) entry.shape.dispose();
        }
        this._cache = next;
        this._committed = timeline;
    }

    /**
     * Failure counterpart of `commit`: drops the aborted run's entries and disposes the
     * shapes it created, so the previous cache keeps describing the displayed shape.
     */
    discard(next: FeatureCacheEntry[], currentShape?: IShape): void {
        const kept = new Set(this._cache.map((entry) => entry.shape));
        for (const entry of next) {
            if (!kept.has(entry.shape) && entry.shape !== currentShape) entry.shape.dispose();
        }
    }

    /** Drops everything, disposing tracked shapes except `currentShape`. */
    dispose(currentShape?: IShape): void {
        for (const entry of this._cache) {
            if (entry.shape !== currentShape) entry.shape.dispose();
        }
        this._cache = [];
        this._committed = [];
        this._inflight = undefined;
    }

    /** Stable id of the n-th sub-shape of the current shape (findSubShapes order). */
    idAt(index: number, kind: TrackedIdKind): string | undefined {
        return this.idsOf(kind)?.[index];
    }

    /** Sub-shape index of a tracked id, or undefined when unknown. */
    indexOfId(kind: TrackedIdKind, id: string): number | undefined {
        const index = this.idsOf(kind)?.indexOf(id) ?? -1;
        return index < 0 ? undefined : index;
    }

    /** Indexes whose tracked id overlaps `id` — the pieces of a boolean-split sub-shape. */
    indexesOfId(kind: TrackedIdKind, id: string): number[] {
        const ids = this.idsOf(kind);
        return ids === undefined ? [] : indexesOfOverlappingId(ids, id);
    }

    /** True when several sub-shapes carry the same tracked id — pieces of a boolean split. */
    idIsShared(kind: TrackedIdKind, id: string | undefined): boolean {
        const ids = this.idsOf(kind);
        return ids !== undefined && idIsShared(ids, id);
    }

    /**
     * The final shape's id arrays. The cache is swapped only by a fully successful run,
     * so these always describe the displayed shape — a failed re-evaluation changes
     * neither.
     */
    private idsOf(kind: TrackedIdKind): string[] | undefined {
        const entry = this._cache.at(-1);
        return kind === "face" ? entry?.faceIds : entry?.edgeIds;
    }
}
