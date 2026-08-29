// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type FeatureItem,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFeatureListNode,
    type INode,
    type INodeVisual,
    type IShape,
    isPropertyChanged,
    ParameterShapeNode,
    Result,
    ShapeNode,
    ShapeTypes,
    serializable,
    serialize,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { evaluateFeature, type FeatureData, featureHandler } from "./features";
import { captureEdgeRef, matchEdgeIndexes } from "./features/edgeRef";
import type { ChamferFeatureData, FilletFeatureData } from "./features/feature";

/** Output of one evaluated feature, reused while the feature and its inputs stay unchanged. */
interface FeatureCacheEntry {
    /** Serialized feature at evaluation time. */
    readonly json: string;
    /** Input shape identity at evaluation time. */
    readonly input: IShape | undefined;
    /** Referenced node shapes (e.g. the sketch) at evaluation time, by node id. */
    readonly refs: ReadonlyMap<string, Result<IShape> | undefined>;
    readonly shape: IShape;
}

export interface ParametricBodyNodeOptions {
    document: IDocument;
    features?: FeatureData[];
    /** Serialized form produced by the Serializer; takes precedence over `features`. */
    featuresJson?: string;
    id?: string;
}

/**
 * A body built by replaying an ordered feature list (extrude from sketch, then
 * fillet/chamfer …). Features store parameters and node references only — no shape
 * snapshots — so any upstream change (e.g. sketch edit) re-evaluates the whole chain.
 */
@serializable()
export class ParametricBodyNode extends ParameterShapeNode implements IFeatureListNode {
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
    private _cache: FeatureCacheEntry[] = [];
    /** Guards against re-entrant evaluation when a watched node generates mid-evaluation. */
    private _evaluating = false;

    constructor(options: ParametricBodyNodeOptions) {
        super({ document: options.document, id: options.id });
        this.setPrivateValue("featuresJson", options.featuresJson ?? JSON.stringify(options.features ?? []));
    }

    setFeaturesEmitShapeChanged(features: FeatureData[]): void {
        this.setPropertyEmitShapeChanged("featuresJson", JSON.stringify(features));
    }

    featureItems(): readonly FeatureItem[] {
        return this.features.map((feature) => {
            const handler = featureHandler(feature.type);
            const display = handler?.display;
            const icon = handler?.icon;
            return {
                id: feature.id,
                display:
                    typeof display === "function"
                        ? display(feature)
                        : (display ?? ("common.name" as I18nKeys)),
                icon: typeof icon === "function" ? icon(feature) : icon,
                suppressed: feature.suppressed === true,
                error: this._featureErrors.get(feature.id),
                reselectable: handler?.reselectable === true,
                parameters: handler?.parameters(feature) ?? [],
            };
        });
    }

    setFeatureParameter(featureId: string, key: string, value: number | string): void {
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

    removeFeature(featureId: string): void {
        this.setFeaturesEmitShapeChanged(this.features.filter((feature) => feature.id !== featureId));
    }

    /**
     * Re-picks the edges of a fillet/chamfer feature and replaces its stored refs.
     * The list is rolled back to just before this feature for the duration of the
     * pick: the stored refs were captured from that pre-feature geometry, and the
     * filleted/chamfered edges no longer exist in the final shape. The rollback is
     * restored in `finally` and never transacted, so undo stays one step. The
     * currently referenced edges start out selected (visible, toggleable);
     * confirming keeps the remaining selection, cancelling keeps the feature
     * unchanged. The body node is re-selected afterwards so the feature panel
     * stays open.
     */
    async reselectShapes(featureId: string): Promise<void> {
        const featureIndex = this.features.findIndex((x) => x.id === featureId);
        const feature = this.features[featureIndex];
        if (feature?.type !== "fillet" && feature?.type !== "chamfer") return;

        // Clear the node selection first: a selected node tints every edge, which
        // would drown the pick highlight.
        const selection = this.document.selection;
        selection.clearSelection();

        const original = this.features;
        // Property changes auto-record history; the rollback is a transient preview
        // state, so suppress recording for the whole pick session and only transact
        // the final edge replacement.
        const history = this.document.history;
        const historyWasDisabled = history.disabled;
        history.disabled = true;

        let cancelled = false;
        let picked: VisualShapeData[] = [];
        try {
            this.setFeaturesEmitShapeChanged(
                original.map((x, i) => (i >= featureIndex ? { ...x, suppressed: true } : x)),
            );
            this.document.visual.update();
            this.preselectCurrentEdges(feature);
            const controller = new AsyncController();
            controller.onCancelled(() => (cancelled = true));
            picked = await this.document.picker.pickShape("prompt.select.edges", controller, {
                shapeType: ShapeTypes.edge,
                multi: true,
                nodeFilter: { allow: (node) => node === this },
            });
        } finally {
            this.setFeaturesEmitShapeChanged(original);
            history.disabled = historyWasDisabled;
            selection.setSelectedNodes([this], false);
        }
        if (cancelled || picked.length === 0) return;

        const edges = picked.map((x) => captureEdgeRef(x.shape as unknown as IEdge));
        Transaction.execute(this.document, "reselect edges", () => {
            const features = this.features.map((x) => (x.id === featureId ? { ...x, edges } : x));
            this.setFeaturesEmitShapeChanged(features);
            this.document.visual.update();
        });
    }

    /** Selects the edges a feature currently references so the pick session starts from them. */
    private preselectCurrentEdges(feature: FilletFeatureData | ChamferFeatureData): void {
        if (!this.shape.isOk) return;
        const shape = this.shape.unchecked()!;
        // A failed match is a common reason to re-pick; then there is nothing to preselect.
        const indexes = matchEdgeIndexes(shape, feature.edges);
        if (!indexes.isOk) return;
        // Mesh ranges enumerate edges in the same order as findSubShapes (both use
        // TopExp::MapShapes), so a matched position indexes into the ranges directly.
        // The range shapes also carry the sub-edge ids detection produces, which the
        // selection's toggle matching relies on.
        const ranges = shape.mesh.edges?.range;
        if (ranges === undefined) return;
        const owner = this.document.visual.context.getVisual(this) as INodeVisual | undefined;
        if (owner === undefined) return;
        const picked: VisualShapeData[] = indexes.unchecked()!.map((index) => ({
            owner,
            shape: ranges[index].shape,
            transform: owner.worldTransform(),
            indexes: [index],
        }));
        this.document.selection.setSelectedShapes(picked, VisualStates.edgeSelected, false);
    }

    protected generateShape(): Result<IShape> {
        this.syncWatchedNodes();
        this._featureErrors.clear();
        this._evaluating = true;
        try {
            return this.evaluateChain();
        } finally {
            this._evaluating = false;
        }
    }

    /**
     * Replays the feature list, reusing cached per-feature results while the feature
     * data, the variable scope, its input shape, and its referenced node shapes are
     * all unchanged — so editing one feature only re-evaluates from that feature on.
     * Parameter-kind features (variables) update the scope instead of the shape.
     */
    private evaluateChain(): Result<IShape> {
        let input: IShape | undefined;
        const scope = new Map<string, number>();
        const nextCache: FeatureCacheEntry[] = [];
        for (const feature of this.features) {
            if (feature.suppressed) continue;
            const handler = featureHandler(feature.type);
            if (handler?.kind === "parameters") {
                const result =
                    handler.evaluateParameters?.(feature, scope) ?? Result.err("Not a parameter feature");
                if (!result.isOk) {
                    this._featureErrors.set(feature.id, String(result.error));
                    this.replaceCache(nextCache);
                    return Result.err(result.error);
                }
                continue;
            }
            const key = this.cacheKey(feature, scope);
            const cached = this.validCacheEntry(key, input, nextCache.length);
            if (cached !== undefined) {
                nextCache.push(cached);
                input = cached.shape;
                continue;
            }
            const result = evaluateFeature(feature, { document: this.document, input, scope });
            if (!result.isOk) {
                this._featureErrors.set(feature.id, String(result.error));
                this.replaceCache(nextCache);
                return result;
            }
            nextCache.push({ json: key, input, refs: this.captureRefs(feature), shape: result.value });
            input = result.value;
        }
        this.replaceCache(nextCache);
        // An empty feature list (user removed every feature) is an empty compound, so
        // the view drops the stale solid instead of keeping a ghost (same as SketchNode).
        if (input === undefined) return shapeFactory.combine([]);
        return Result.ok(input);
    }

    /** Cache keys include the scope snapshot so a variable change invalidates dependents. */
    private cacheKey(feature: FeatureData, scope: ReadonlyMap<string, number>): string {
        return scope.size === 0 ? JSON.stringify(feature) : JSON.stringify([feature, [...scope]]);
    }

    private validCacheEntry(
        key: string,
        input: IShape | undefined,
        index: number,
    ): FeatureCacheEntry | undefined {
        const entry = this._cache[index];
        if (entry === undefined || entry.input !== input || entry.json !== key) {
            return undefined;
        }
        for (const [id, shape] of entry.refs) {
            if (this.referencedShape(id) !== shape) return undefined;
        }
        return entry;
    }

    private captureRefs(feature: FeatureData): Map<string, Result<IShape> | undefined> {
        const refs = new Map<string, Result<IShape> | undefined>();
        for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
            refs.set(id, this.referencedShape(id));
        }
        return refs;
    }

    private referencedShape(id: string): Result<IShape> | undefined {
        const node = this.document.modelManager.findNode((n) => n.id === id);
        return node instanceof ShapeNode ? node.shape : undefined;
    }

    /**
     * Swaps the cache and disposes evicted intermediate shapes. The node's current
     * shape is never disposed here — `ShapeNode.disposeInternal` owns its lifecycle.
     */
    private replaceCache(next: FeatureCacheEntry[]): void {
        const reused = new Set(next.map((entry) => entry.shape));
        const current = this._shape.isOk ? this._shape.value : undefined;
        for (const entry of this._cache) {
            if (!reused.has(entry.shape) && entry.shape !== current) entry.shape.dispose();
        }
        this._cache = next;
    }

    /**
     * Watches the current feature references and drops stale ones. Ids that fail to
     * resolve (e.g. a deleted sketch) are retried on the next evaluation, so a
     * restored node is picked up again.
     */
    private syncWatchedNodes(): void {
        const wanted = new Set(this.features.flatMap((f) => featureHandler(f.type)?.nodeIds(f) ?? []));
        for (const [id, node] of this._watched) {
            if (!wanted.has(id)) {
                if (isPropertyChanged(node)) node.removePropertyChanged(this.handleWatchedNodeChanged);
                this._watched.delete(id);
            }
        }
        for (const id of wanted) {
            if (this._watched.has(id)) continue;
            const node = this.document.modelManager.findNode((n) => n.id === id);
            if (node !== undefined && isPropertyChanged(node)) {
                node.onPropertyChanged(this.handleWatchedNodeChanged);
                this._watched.set(id, node);
            }
        }
    }

    // The referenced node assigns its new shape before notifying (setProperty order),
    // so reacting to "shape" always reads fresh upstream geometry. A failed rebuild
    // (e.g. the sketch is mid-edit with an open profile) keeps the last good shape
    // silently — the feature panel shows the error — instead of toasting per change.
    private readonly handleWatchedNodeChanged = (property: string) => {
        // Skip while evaluating: a referenced node (e.g. the sketch) may generate its
        // shape lazily mid-evaluation and notify — the in-flight pass reads it fresh.
        if (property !== "shape" || this._evaluating) return;

        const result = this.generateShape();
        if (result.isOk) {
            this.shape = result;
            this.document.visual.update();
        }
        this.emitPropertyChanged("featuresJson", this.featuresJson);
    };

    override disposeInternal(): void {
        for (const node of this._watched.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleWatchedNodeChanged);
        }
        this._watched.clear();
        const current = this._shape.isOk ? this._shape.value : undefined;
        for (const entry of this._cache) {
            if (entry.shape !== current) entry.shape.dispose();
        }
        this._cache = [];
        super.disposeInternal();
    }
}
