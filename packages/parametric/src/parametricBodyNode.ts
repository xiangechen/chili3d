// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type FeatureItem,
    type I18nKeys,
    type IDocument,
    type IEqualityComparer,
    type IFeatureListNode,
    type INode,
    type INodeLinkedList,
    type IShape,
    isPropertyChanged,
    NodeChildList,
    ParameterShapeNode,
    Result,
    ShapeNode,
    serializable,
    serialize,
    Transaction,
} from "@chili3d/core";
import { ReselectFeatureCommand } from "./commands/reselectCommand";
import { EdgeReselectSession, ProfileReselectSession } from "./commands/reselectSession";
import { evaluateFeature, type FeatureData, featureHandler, type ShapeTracking } from "./features";
import {
    BodyTimeline,
    type FeatureCacheEntry,
    type RefSnapshot,
    sameTransform,
} from "./features/bodyTimeline";
import {
    type FeatureTimelineState,
    type IBodyTimelineNode,
    isBodyTimelineNode,
} from "./features/bodyTracking";
import type { EdgeRef } from "./features/edgeRef";
import { findSketch } from "./features/extrude";
import type { BooleanFeatureData, ExtrudeFeatureData } from "./features/feature";
import type { ProfileRef } from "./features/profileRef";
import { syncNodeWatches } from "./nodeWatch";
import { danglingProfileRefs, SketchNode } from "./sketch/sketchNode";

/**
 * The parametric body: a node whose geometry is DERIVED by replaying an ordered feature list.
 *
 * `featuresJson` is the only serialized state — an array of `FeatureData`. No shape is ever
 * stored; every rebuild re-runs the list from the top, which is what makes an upstream edit (move
 * a line in a sketch) propagate: the chain re-evaluates and everything downstream follows.
 *
 * One run of `evaluateChain`:
 *
 * 1. For each feature in order, `featureHandler(feature.type).evaluate(feature, context)` gets
 *    the previous feature's shape and returns this one's. A `Result.err` stops the chain and the
 *    previous shape and cache are KEPT — a failed rebuild is never shown.
 * 2. `ShapeTracking` collects each step's stable sub-shape ids and the stored refs it actually
 *    matched; `refreshAnchoredRefs` writes those back into the feature JSON, so the next edit
 *    measures drift from the latest match rather than from the original pick.
 * 3. Per-feature results are cached (`BodyTimeline`) keyed on the feature JSON, the variable
 *    scope, and the identity of the input and referenced shapes — so editing one feature only
 *    re-evaluates from that feature on.
 *
 * Where to look:
 *
 * - **Editing the list** (add / move / suppress / rename) — "Feature list editing".
 * - **Re-picking referenced shapes** — the section of that name; the interaction itself lives in
 *   `commands/reselectSession.ts`.
 * - **How a run works** — "Chain evaluation" and its "Cache plumbing".
 * - **Stable ids across rebuilds** — "Tracking facade" is the query surface other layers call;
 *   `features/` is where the ids are actually built.
 * - **Why a rebuilt sketch is re-followed before the chain reads it** — "Following referenced
 *   sketches".
 *
 * `docs/parametric.md` has the module's wider architecture.
 */

/** Shape plus tracked sub-shape ids produced by evaluating one feature. */
interface FeatureStepOutput {
    readonly shape: IShape;
    readonly faceIds?: string[];
    readonly edgeIds?: string[];
    /** Fingerprints the feature actually matched this run — re-anchored into the feature. */
    readonly resolvedProfiles?: ProfileRef[];
    /** Edge anchors the feature actually matched this run — re-anchored into the feature. */
    readonly resolvedEdges?: EdgeRef[];
}

export interface ParametricBodyNodeOptions {
    document: IDocument;
    features?: FeatureData[];
    /** Serialized form produced by the Serializer; takes precedence over `features`. */
    featuresJson?: string;
    id?: string;
}

/** A body whose shape is replayed from its feature list — see the module header above. */
@serializable()
export class ParametricBodyNode
    extends ParameterShapeNode
    implements IFeatureListNode, INodeLinkedList, IBodyTimelineNode
{
    /**
     * Consumed boolean tools live under the body (see `syncConsumedTools`). Children
     * never render in the scene — the tree lists them grayed under the body, where
     * selecting one still opens its feature list for editing.
     */
    private readonly _children: NodeChildList = new NodeChildList(this, () => false);

    // ------------------------------------------------------------------ Node plumbing: the linked-list contract

    get firstChild() {
        return this._children.firstChild;
    }
    get lastChild() {
        return this._children.lastChild;
    }
    size(): number {
        return this._children.count;
    }
    add(...items: INode[]): void {
        this._children.add(...items);
    }
    remove(...items: INode[]): void {
        this._children.remove(...items);
    }
    transfer(...items: INode[]): void {
        this._children.transfer(...items);
    }
    insertBefore(target: INode | undefined, node: INode): void {
        this._children.insertBefore(target, node);
    }
    insertAfter(target: INode | undefined, node: INode): void {
        this._children.insertAfter(target, node);
    }
    move(child: INode, newParent: this, newPreviousSibling?: INode): void {
        this._children.move(child, newParent, newPreviousSibling);
    }

    override display(): I18nKeys {
        return "body.parametricBody";
    }

    @serialize()
    get featuresJson(): string {
        return this.getPrivateValue("featuresJson");
    }
    set featuresJson(value: string) {
        this.setPropertyEmitShapeChanged("featuresJson", value);
    }

    get features(): FeatureData[] {
        return JSON.parse(this.featuresJson);
    }

    /** Referenced nodes (sketches) currently watched for shape changes, by id. */
    private readonly _watched = new Map<string, INode>();
    private readonly _featureErrors = new Map<string, string>();
    /** Non-fatal conditions surfaced on the feature row (e.g. a sketch's dangling external refs). */
    private readonly _featureWarnings = new Map<string, string>();
    /** What the last successful run produced — cache entries and per-index chain states. */
    private readonly _timeline = new BodyTimeline();
    /** Guards against re-entrant evaluation when a watched node generates mid-evaluation. */
    private _evaluating = false;
    /** False until the first evaluation; see the `shape` getter. */
    private _evaluated = false;
    /**
     * Runtime-only session state (never serialized, never transacted): when set,
     * `evaluateChain` replays only the features before this index. The sketch editor
     * rolls the body back to the edited sketch's timeline position for the session
     * (see `computeSketchRollback`), and `pickFeatureEdges` uses the same mechanism
     * for its pre-feature pick preview — both leave the feature list and the undo
     * history untouched.
     */
    private _rollbackIndex: number | undefined;

    // ------------------------------------------------------------------ Session rollback

    /** The active session-rollback position (`IBodyTimelineNode.rollbackIndex`). */
    get rollbackIndex(): number | undefined {
        return this._rollbackIndex;
    }

    /**
     * Truncates the feature replay at `index` (undefined restores the full chain) and
     * re-evaluates. Returns false when the replay failed: the last good shape is kept
     * (the same policy as watched-node rebuilds), so the displayed geometry is NOT
     * the requested timeline position — the caller should revert the rollback rather
     * than let plane/external-reference resolution read it as one.
     */
    setRollbackIndex(index: number | undefined): boolean {
        const clamped = index === undefined ? undefined : Math.max(0, Math.min(index, this.features.length));
        if (this._rollbackIndex === clamped) return true;
        this._rollbackIndex = clamped;
        const result = this.generateShape();
        if (!result.isOk) return false;
        this.shape = result;
        this.document.visual.update();
        return true;
    }

    // ------------------------------------------------------------------ Construction, shape invalidation and consumed tools

    constructor(options: ParametricBodyNodeOptions) {
        super({ document: options.document, id: options.id });
        this.setPrivateValue("featuresJson", options.featuresJson ?? JSON.stringify(options.features ?? []));
    }

    setFeaturesEmitShapeChanged(features: FeatureData[]): void {
        this.setPropertyEmitShapeChanged("featuresJson", JSON.stringify(features));
    }

    protected override setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        const changed = super.setPropertyEmitShapeChanged(property, newValue, onPropertyChanged, equals);
        if (changed && property === "featuresJson") this.syncConsumedTools();
        return changed;
    }

    /**
     * Moves consumed boolean tools under this node and releases the rest back next to
     * it. Idempotent — rewriting `featuresJson` to an equivalent list moves nothing.
     * Skipped while history is disabled: undo/redo restores the recorded moves itself.
     */
    private syncConsumedTools(): void {
        if (this.document.history.disabled) return;
        const desired = new Set(
            this.features
                .filter((x): x is BooleanFeatureData => x.type === "boolean" && x.consumeTools !== false)
                .flatMap((x) => x.toolIds),
        );
        let child = this.firstChild;
        // Released tools land after the previously released one so the tree order
        // matches the order they had under the body.
        let anchor: INode = this;
        while (child !== undefined) {
            const next = child.nextSibling;
            if (!desired.has(child.id) && this.parent !== undefined) {
                this.transfer(child);
                this.parent.insertAfter(anchor, child);
                anchor = child;
            }
            child = next;
        }
        for (const id of desired) {
            const node = this.document.modelManager.findNode((n) => n.id === id);
            if (!(node instanceof ShapeNode) || node === this || node.parent === this) continue;
            if (this.isAncestor(node)) continue;
            node.parent?.transfer(node);
            this.add(node);
        }
    }

    /** True when `node` is on this node's ancestor chain — moving it here would cycle. */
    private isAncestor(node: INode): boolean {
        let ancestor = this.parent;
        while (ancestor !== undefined) {
            if (ancestor === node) return true;
            ancestor = ancestor.parent;
        }
        return false;
    }

    // ------------------------------------------------------------------ Feature list editing

    featureItems(): readonly FeatureItem[] {
        return this.features.map((feature) => {
            const handler = featureHandler(feature.type);
            const display = handler?.display;
            const icon = handler?.icon;
            return {
                id: feature.id,
                name: feature.name,
                display:
                    typeof display === "function"
                        ? display(feature)
                        : (display ?? ("common.name" as I18nKeys)),
                icon: typeof icon === "function" ? icon(feature) : icon,
                suppressed: feature.suppressed === true,
                error: this._featureErrors.get(feature.id),
                warning: this._featureWarnings.get(feature.id),
                reselectable: handler?.reselectable === true,
                parameters: handler?.parameters(feature) ?? [],
            };
        });
    }

    /**
     * Sketch nodes referenced by extrude/revolve features, in feature order. Boolean
     * tools never resolve as sketches, so they are excluded — the tree already lists
     * them as consumed children. One sketch may serve several features (deduped here)
     * and several bodies, so these are references, never real children.
     */
    referencedNodes(): INode[] {
        const sketches = new Map<string, SketchNode>();
        for (const feature of this.features) {
            for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
                const sketch = findSketch(this.document, id);
                if (sketch !== undefined) sketches.set(sketch.id, sketch);
            }
        }
        return [...sketches.values()];
    }

    setFeatureParameter(featureId: string, key: string, value: number | string | boolean): void {
        const features = this.features.map((feature) => {
            if (feature.id !== featureId) return feature;
            return featureHandler(feature.type)?.setParameter(feature, key, value) ?? feature;
        });
        this.setFeaturesEmitShapeChanged(features);
    }

    setFeatureSuppressed(featureId: string, suppressed: boolean): void {
        const features = this.features.map((feature) =>
            feature.id === featureId ? { ...feature, suppressed } : feature,
        );
        this.setFeaturesEmitShapeChanged(features);
    }

    moveFeature(featureId: string, offset: -1 | 1): void {
        const features = [...this.features];
        const index = features.findIndex((feature) => feature.id === featureId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= features.length) return;
        [features[index], features[target]] = [features[target], features[index]];
        this.setFeaturesEmitShapeChanged(features);
    }

    moveFeatureTo(featureId: string, index: number): void {
        const features = [...this.features];
        const from = features.findIndex((feature) => feature.id === featureId);
        if (from < 0) return;
        const [feature] = features.splice(from, 1);
        features.splice(Math.max(0, Math.min(index, features.length)), 0, feature);
        this.setFeaturesEmitShapeChanged(features);
    }

    /** Renaming does not change geometry — record and notify without a rebuild. */
    renameFeature(featureId: string, name: string): void {
        const features = this.features.map((feature) =>
            feature.id === featureId ? { ...feature, name: name === "" ? undefined : name } : feature,
        );
        this.setProperty("featuresJson", JSON.stringify(features));
    }

    removeFeature(featureId: string): void {
        this.setFeaturesEmitShapeChanged(this.features.filter((feature) => feature.id !== featureId));
    }

    // ------------------------------------------------------------------ Re-picking referenced shapes

    /**
     * Re-picks the shapes a feature references and replaces its stored refs — edges of
     * a fillet/chamfer, profiles of an extrude. The pick runs as a
     * `ReselectFeatureCommand` registered as the application's executing command, so
     * starting any other command mid-pick cancels this session through the command
     * service's normal lifecycle — its cleanup (restoring the rollback preview and
     * re-enabling the history) always completes before the new command runs.
     */
    async reselectShapes(featureId: string): Promise<void> {
        await ReselectFeatureCommand.start(this, featureId);
    }

    /**
     * The pick session of `reselectShapes`, driven by `ReselectFeatureCommand` with the
     * command's controller — cancelling the command cancels this pick. The interaction
     * itself lives in the session classes; all this does is route to the right one and
     * transact the confirmed refs, keeping undo one step. For edge features the session
     * rolls the body back to just before the feature for the duration of the pick (the
     * stored refs were captured from that pre-feature geometry). The body node is
     * re-selected afterwards so the feature panel stays open.
     */
    async reselectSession(featureId: string, controller: AsyncController): Promise<void> {
        const featureIndex = this.features.findIndex((x) => x.id === featureId);
        const feature = this.features[featureIndex];
        if (feature?.type === "extrude") return this.reselectProfiles(feature, controller);
        if (feature?.type !== "fillet" && feature?.type !== "chamfer") return;

        const edges = await new EdgeReselectSession(this).pick(feature, featureIndex, controller);
        if (edges === undefined) return;

        Transaction.execute(this.document, "reselect edges", () => {
            const features = this.features.map((x) => (x.id === featureId ? { ...x, edges } : x));
            this.setFeaturesEmitShapeChanged(features);
            this.document.visual.update();
        });
    }

    /**
     * Re-picks the profiles of an extrude feature. Body-face extrudes (`source`) re-match
     * by fingerprint, so only sketch profiles can be re-picked. Confirming with nothing
     * selected clears `profiles` — back to extruding every profile of the sketch.
     */
    private async reselectProfiles(feature: ExtrudeFeatureData, controller: AsyncController): Promise<void> {
        if (feature.sketchId === undefined) return;
        const sketch = findSketch(this.document, feature.sketchId);
        if (sketch === undefined) return;

        const profiles = await new ProfileReselectSession(this).pick(feature, sketch, controller);
        if (profiles === undefined) return;

        Transaction.execute(this.document, "reselect profiles", () => {
            const features = this.features.map((x) =>
                x.id === feature.id ? { ...x, profiles: profiles.length > 0 ? profiles : undefined } : x,
            );
            this.setFeaturesEmitShapeChanged(features);
            this.document.visual.update();
        });
    }

    // ------------------------------------------------------------------ Shape: derived state

    /**
     * The shape is derived state: `featuresJson` (the recorded property) regenerates it
     * on undo/redo. Recording the shape too would let redo re-apply a stale snapshot
     * whose wasm shape cache eviction has already disposed (kernel error "null is not
     * a valid TopoDS_Shape"). The history guard assumes `super.setShape` runs fully
     * synchronously — keep it that way.
     */
    protected override setShape(shape: Result<IShape>) {
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            super.setShape(shape);
        } finally {
            history.disabled = disabled;
        }
    }

    /**
     * A persisted failure is not re-evaluated on every read: feature edits and
     * watched-node changes already re-evaluate eagerly, so the getter retries only
     * when never evaluated yet, or when a reference that was missing at evaluation
     * time appears later (document load order) — detected by a growing watch set.
     */
    override get shape(): Result<IShape> {
        // A mid-chain read (e.g. a consumed sketch's external-ref resolution reading
        // this node as its source) gets the previous result as-is: recomputing here
        // would re-enter generateShape.
        if (this._evaluating) return this._shape;
        if (!this._shape.isOk && (!this._evaluated || this.hasNewReferences())) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }
    override set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    private hasNewReferences(): boolean {
        const before = this._watched.size;
        this.syncWatchedNodes();
        return this._watched.size > before;
    }

    protected generateShape(): Result<IShape> {
        this._evaluated = true;
        this.syncWatchedNodes();
        this._featureErrors.clear();
        this._featureWarnings.clear();
        this._evaluating = true;
        try {
            return this.evaluateChain();
        } finally {
            this._evaluating = false;
        }
    }

    // `IBodyTrackingNode` — pure forwarding; `BodyTimeline` owns the id arrays and
    // documents the contracts (what makes an id shared, what "overlaps" means).

    // ------------------------------------------------------------------ Tracking facade (IBodyTrackingNode / IBodyTimelineNode)

    faceIdAt(index: number): string | undefined {
        return this._timeline.idAt(index, "face");
    }

    faceIndexById(id: string): number | undefined {
        return this._timeline.indexOfId("face", id);
    }

    faceIndexesOfId(id: string): number[] {
        return this._timeline.indexesOfId("face", id);
    }

    edgeIdAt(index: number): string | undefined {
        return this._timeline.idAt(index, "edge");
    }

    edgeIndexById(id: string): number | undefined {
        return this._timeline.indexOfId("edge", id);
    }

    edgeIndexesOfId(id: string): number[] {
        return this._timeline.indexesOfId("edge", id);
    }

    faceIdIsShared(id: string | undefined): boolean {
        return this._timeline.idIsShared("face", id);
    }

    edgeIdIsShared(id: string | undefined): boolean {
        return this._timeline.idIsShared("edge", id);
    }

    get featureCount(): number {
        return this.features.length;
    }

    /**
     * `IBodyTimelineNode`: the chain state entering the feature at `index` — the geometry
     * a sketch's external references resolve against when their timeline anchor
     * (`SketchData.refPositions`) points here, so a downstream feature (e.g. a cut into
     * the referenced edge) does not make them dangle. See `BodyTimeline.stateAt`.
     */
    timelineStateAt(index: number): FeatureTimelineState | undefined {
        return this._timeline.stateAt(index);
    }

    // ------------------------------------------------------------------ Chain evaluation

    /**
     * Replays the feature list, reusing cached per-feature results while the feature
     * data, the variable scope, its input shape, and its referenced node shapes are
     * all unchanged — so editing one feature only re-evaluates from that feature on.
     * Parameter-kind features (variables) update the scope instead of the shape.
     * A session rollback (`_rollbackIndex`) stops the replay early; the truncation
     * is by feature-list index, so user-suppressed features still count.
     */
    private evaluateChain(): Result<IShape> {
        let input: IShape | undefined;
        let faceIds: string[] | undefined;
        let edgeIds: string[] | undefined;
        const scope = new Map<string, number>();
        const nextCache: FeatureCacheEntry[] = [];
        const resolvedProfiles = new Map<string, ProfileRef[]>();
        const resolvedEdges = new Map<string, EdgeRef[]>();
        const features = this.features;
        const stop = this._rollbackIndex ?? features.length;
        // Sketches already re-resolved this run (see followReferencedSketches): a
        // sketch referenced by N features was followed — re-parsed, re-scanned —
        // N times per run, while one resolution already writes fresh snapshots
        // back for every later feature.
        const followedSketches = new Set<string>();
        // Chain state entering each feature-list index — the timeline sketch external
        // refs anchor to (see `timelineStateAt`). Handed to the timeline as the in-flight
        // run for its duration, so mid-chain ref resolutions see THIS run's states.
        const timeline = this._timeline.beginRun();
        try {
            for (let index = 0; index < features.length && index < stop; index++) {
                timeline.push({ shape: input, faceIds, edgeIds });
                const feature = features[index];
                if (feature.suppressed) continue;
                this.followReferencedSketches(feature, followedSketches);
                const step = this.evaluateFeatureStep(feature, scope, input, faceIds, edgeIds, nextCache);
                if (!step.isOk) {
                    this._featureErrors.set(feature.id, String(step.error));
                    // A failed chain keeps the previous cache and shape: id queries must
                    // keep describing the displayed shape, not a truncated prefix of a
                    // rebuild that never made it to the screen.
                    this._timeline.discard(nextCache, this.currentShape());
                    // Warnings describe sketch state, not the chain run — repopulate them
                    // here too, or one failing feature wipes them off the other rows.
                    this.markUnresolvedExternalRefs(features);
                    return Result.err(step.error);
                }
                if (step.value === undefined) continue; // parameter feature: only the scope changed
                input = step.value.shape;
                faceIds = step.value.faceIds;
                edgeIds = step.value.edgeIds;
                if (step.value.resolvedProfiles !== undefined) {
                    resolvedProfiles.set(feature.id, step.value.resolvedProfiles);
                }
                if (step.value.resolvedEdges !== undefined) {
                    resolvedEdges.set(feature.id, step.value.resolvedEdges);
                }
            }
        } finally {
            this._timeline.endRun();
        }
        this._timeline.commit(nextCache, timeline, this.currentShape());
        this.refreshAnchoredRefs(resolvedProfiles, resolvedEdges);
        this.markUnresolvedExternalRefs(features);
        // An empty feature list (user removed every feature) is an empty compound, so
        // the view drops the stale solid instead of keeping a ghost (same as SketchNode).
        if (input === undefined) return shapeFactory.combine([]);
        return Result.ok(input);
    }

    // ------------------------------------------------------------------ Following referenced sketches

    /**
     * Re-resolves the external references of the sketches this feature reads, so the chain's
     * FIRST pass already works on post-edit geometry.
     *
     * Why it cannot wait: the catch-up would otherwise run only after a successful chain (the
     * sketch's source watch fires on the emitted shape change). A first pass reading the stale
     * sketch can fail outright — a cut whose sketch geometry no longer intersects the rebuilt
     * body becomes a no-op, a downstream fillet then reports "Edge not found after rebuild" for
     * its vanished edges, the failed chain keeps the old shape, and so the watch never fires and
     * the sketch never catches up. Resolving against the in-flight timeline
     * (`BodyTimeline.beginRun`) is what makes the fresh state available this early.
     *
     * A sketch owned by a live editor session is left alone — the session's solver reconciles
     * its refs itself.
     *
     * `followedSketches` memoizes the run (one Set per `evaluateChain`): a sketch referenced by
     * several features is re-resolved once, not once per feature, since the first follow already
     * persists fresh snapshots for every later feature. One narrow exception: a sketch
     * referencing THIS body whose timeline anchor (`SketchData.refPositions`) the in-flight
     * replay has not reached yet resolves against the final-shape fallback (`timelineStateAt` is
     * not ready at that point), so that first result must NOT be pinned for the rest of the run
     * — a later feature at or past the anchor can still follow with the anchored state, and
     * memoizing would freeze the fallback resolution for the whole run.
     */
    private followReferencedSketches(feature: FeatureData, followedSketches: Set<string>): void {
        for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
            if (id === this.id || followedSketches.has(id)) continue;
            const node = this.document.modelManager.findNode((n) => n.id === id);
            if (!(node instanceof SketchNode) || node.editingSession) {
                // Nothing to follow now or later this run (a session cannot start
                // mid-run) — memoize to skip the repeat lookup as well.
                followedSketches.add(id);
                continue;
            }
            node.followExternalRefs();
            if (!this.anchorStatePending(node)) followedSketches.add(id);
        }
    }

    /**
     * True when `sketch` anchors an external reference to this body
     * (`SketchData.refPositions`) at a timeline position the in-flight replay has
     * not produced yet, so the follow that just ran used the final-shape fallback
     * and must not be memoized (see `followReferencedSketches`). The gate mirrors
     * `sourceEdges`: an anchor at or past the feature count never consults the
     * timeline, so no fallback is involved and the memo applies.
     */
    private anchorStatePending(sketch: SketchNode): boolean {
        const anchor = sketch.data.refPositions?.[this.id];
        return (
            anchor !== undefined && anchor < this.featureCount && this.timelineStateAt(anchor) === undefined
        );
    }

    /**
     * Surfaces dangling profile-role external refs of consumed sketches as a feature-level
     * warning.
     *
     * - **Why a dangling flag means a genuine loss.** Refs sourced from a parametric body resolve
     *   against the shape at the sketch's timeline anchor (`SketchData.refPositions`, see
     *   `timelineStateAt`), and the sketch then builds profiles from the frozen snapshot — so a
     *   dangling flag means the edge is gone at the anchor too (the upstream geometry was edited
     *   away), and the geometry is silently wrong. Worth flagging.
     * - **And why the converse stays silent.** An edge consumed by a downstream feature of the
     *   source body itself (a cut into it) still exists at the anchor, resolves there, and never
     *   dangles — Onshape-style silence for the feature system working as intended.
     * - **Scope.** Runs only after a fully successful chain, with sketch lookups memoized per
     *   rebuild, and is truncated at the session rollback index so hidden features don't report
     *   warnings for geometry the user cannot see.
     * - **Revolve's `axisSource.nodeId` is deliberately not checked.** The axis edge re-matches
     *   through its own `EdgeRef` on the source's shape, and if the axis sketch itself is degraded
     *   that match can silently fall back to the world-space snapshot axis — an accepted, narrower
     *   degradation than rebuilding whole profiles from frozen geometry. Flagging it would warn on
     *   dangling refs unrelated to the axis line.
     */
    private markUnresolvedExternalRefs(features: FeatureData[]): void {
        const checked = new Map<string, boolean>();
        const stop = this._rollbackIndex ?? features.length;
        for (let index = 0; index < features.length && index < stop; index++) {
            const feature = features[index];
            if (feature.suppressed || !("sketchId" in feature) || feature.sketchId === undefined) continue;
            let dangling = checked.get(feature.sketchId);
            if (dangling === undefined) {
                const sketch = findSketch(this.document, feature.sketchId);
                dangling = sketch !== undefined && danglingProfileRefs(sketch).length > 0;
                checked.set(feature.sketchId, dangling);
            }
            if (dangling) this._featureWarnings.set(feature.id, "Sketch has unresolved external references");
        }
    }

    // ------------------------------------------------------------------ Cache plumbing

    /**
     * Evaluates one feature against the current chain state, returning its output (or
     * undefined for parameter-kind features, which only update `scope`).
     */
    private evaluateFeatureStep(
        feature: FeatureData,
        scope: Map<string, number>,
        input: IShape | undefined,
        faceIds: string[] | undefined,
        edgeIds: string[] | undefined,
        nextCache: FeatureCacheEntry[],
    ): Result<FeatureStepOutput | undefined> {
        const handler = featureHandler(feature.type);
        if (handler?.kind === "parameters") {
            const result =
                handler.evaluateParameters?.(feature, scope) ?? Result.err("Not a parameter feature");
            return result.isOk ? Result.ok(undefined) : Result.err(result.error);
        }
        const key = this.cacheKey(feature, scope);
        const cached = this.validCacheEntry(key, input, nextCache.length);
        if (cached !== undefined) {
            nextCache.push(cached);
            return Result.ok({ shape: cached.shape, faceIds: cached.faceIds, edgeIds: cached.edgeIds });
        }
        return this.evaluateAndCache(feature, key, scope, input, faceIds, edgeIds, nextCache);
    }

    /** Cache-miss path of `evaluateFeatureStep`: evaluates the feature and stores the result. */
    private evaluateAndCache(
        feature: FeatureData,
        key: string,
        scope: Map<string, number>,
        input: IShape | undefined,
        faceIds: string[] | undefined,
        edgeIds: string[] | undefined,
        nextCache: FeatureCacheEntry[],
    ): Result<FeatureStepOutput> {
        const tracking: ShapeTracking = {
            inputFaceIds: faceIds ?? [],
            outputFaceIds: [],
            inputEdgeIds: edgeIds ?? [],
            outputEdgeIds: [],
        };
        const result = evaluateFeature(feature, {
            document: this.document,
            host: this,
            input,
            scope,
            tracking,
        });
        if (!result.isOk) return Result.err(result.error);
        // A handler that cannot track (e.g. the kernel lacks history) leaves the
        // output empty — ids stay undefined from here on rather than guessing.
        const output: FeatureStepOutput = {
            shape: result.value,
            faceIds: tracking.outputFaceIds.length > 0 ? tracking.outputFaceIds : undefined,
            edgeIds: tracking.outputEdgeIds.length > 0 ? tracking.outputEdgeIds : undefined,
            resolvedProfiles: tracking.resolvedProfiles,
            resolvedEdges: tracking.resolvedEdges,
        };
        nextCache.push({
            json: key,
            input,
            refs: this.snapshotNodeRefs(feature),
            shape: output.shape,
            faceIds: output.faceIds,
            edgeIds: output.edgeIds,
        });
        return Result.ok(output);
    }

    /** Cache keys include the scope snapshot so a variable change invalidates dependents. */
    private cacheKey(feature: FeatureData, scope: ReadonlyMap<string, number>): string {
        return scope.size === 0 ? JSON.stringify(feature) : JSON.stringify([feature, [...scope]]);
    }

    /** The cached entry for `index`, when the feature data, the input and the refs all still match. */
    private validCacheEntry(
        key: string,
        input: IShape | undefined,
        index: number,
    ): FeatureCacheEntry | undefined {
        const entry = this._timeline.entryAt(index);
        if (entry === undefined || entry.input !== input || entry.json !== key) {
            return undefined;
        }
        for (const [id, snapshot] of entry.refs) {
            const current = this.snapshotNode(id);
            if (current.shape !== snapshot.shape) return undefined;
            if (!sameTransform(current.transform, snapshot.transform)) return undefined;
        }
        return entry;
    }

    private snapshotNodeRefs(feature: FeatureData): Map<string, RefSnapshot> {
        const refs = new Map<string, RefSnapshot>();
        for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
            // A feature may reference the host itself (e.g. an extrude sourced on one
            // of its own faces) — the input-identity check already covers that.
            if (id === this.id) continue;
            refs.set(id, this.snapshotNode(id));
        }
        return refs;
    }

    private snapshotNode(id: string): RefSnapshot {
        const node = this.document.modelManager.findNode((n) => n.id === id);
        if (!(node instanceof ShapeNode)) return { shape: undefined, transform: undefined };
        return { shape: node.shape, transform: node.worldTransform() };
    }

    /**
     * The shape currently on display, which `BodyTimeline` must never dispose — its
     * lifecycle belongs to `ShapeNode.disposeInternal`.
     */
    private currentShape(): IShape | undefined {
        return this._shape.isOk ? this._shape.value : undefined;
    }

    // ------------------------------------------------------------------ Ref write-back and node watching

    /**
     * Re-anchors stored shape references to what the last evaluation actually
     * matched: each feature handler writes its matched profile fingerprints and
     * edge anchors back into the feature JSON (`FeatureHandler.applyResolvedRefs`).
     * Refs captured at pick time would otherwise measure drift from the original
     * position on every edit — and an edge ref whose id died keeps paying
     * fingerprint matching with a stale anchor on every rebuild. Runs only after a
     * fully successful chain; the rewrite is derived state (like the shape), so it
     * is neither transacted nor shape-changing.
     */
    private refreshAnchoredRefs(
        profiles: ReadonlyMap<string, ProfileRef[]>,
        edges: ReadonlyMap<string, EdgeRef[]>,
    ): void {
        if (profiles.size === 0 && edges.size === 0) return;
        let changed = false;
        const features = this.features.map((feature) => {
            const next = featureHandler(feature.type)?.applyResolvedRefs?.(feature, {
                resolvedProfiles: profiles.get(feature.id),
                resolvedEdges: edges.get(feature.id),
            });
            // Untouched features skip the stringify pair — the common case.
            if (next === undefined || next === feature) return feature;
            if (JSON.stringify(next) === JSON.stringify(feature)) return feature;
            changed = true;
            return next;
        });
        if (!changed) return;
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            // setProperty (not the shape-changing variant): the geometry is already
            // built — this only persists the re-anchored refs.
            this.setProperty("featuresJson", JSON.stringify(features));
        } finally {
            history.disabled = disabled;
        }
    }

    /** Watches the current feature references and drops stale ones (see `syncNodeWatches`). */
    private syncWatchedNodes(): void {
        const wanted = new Set(
            this.features
                .flatMap((f) => featureHandler(f.type)?.nodeIds(f) ?? [])
                // Never watch ourselves — a self-referencing feature (e.g. an extrude
                // sourced on the body's own face) would re-evaluate on every rebuild.
                .filter((id) => id !== this.id),
        );
        syncNodeWatches(this.document, this._watched, wanted, this.handleWatchedNodeChanged);
    }

    // The referenced node assigns its new shape before notifying (setProperty order),
    // so reacting to "shape" always reads fresh upstream geometry. "transform" matters
    // too: a boolean tool is mapped into this body's local space, so moving it must
    // re-evaluate. A failed rebuild (e.g. the sketch is mid-edit with an open profile)
    // keeps the last good shape silently — the feature panel shows the error — instead
    // of toasting per change.
    private readonly handleWatchedNodeChanged = (property: string) => {
        // Skip while evaluating: a referenced node (e.g. the sketch) may generate its
        // shape lazily mid-evaluation and notify — the in-flight pass reads it fresh.
        if ((property !== "shape" && property !== "transform") || this._evaluating) return;
        // A rolled-back source (a sketch-session preview) must not re-evaluate
        // bystanders: the preview hides later features' geometry, the rebuilt shape
        // would be wrong, and the run would re-anchor refs onto the preview and
        // persist them. The session exit clears the flag BEFORE restoring the
        // shape, so the restore notification passes this guard and rebuilds.
        for (const node of this._watched.values()) {
            if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) return;
        }

        const result = this.generateShape();
        if (result.isOk) {
            this.shape = result;
            this.document.visual.update();
        }
        this.emitPropertyChanged("featuresJson", this.featuresJson);
    };

    override disposeInternal(): void {
        // Drop session rollback state so a stale editor-side reference never triggers
        // a replay that would leak a shape onto this disposed node.
        this._rollbackIndex = undefined;
        for (const node of this._watched.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleWatchedNodeChanged);
        }
        this._watched.clear();
        this._children.dispose();
        this._timeline.dispose(this.currentShape());
        super.disposeInternal();
    }
}
