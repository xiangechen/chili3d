// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    debounce,
    type FeatureItem,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IEqualityComparer,
    type IFace,
    type IFeatureListNode,
    type INode,
    type INodeLinkedList,
    type INodeVisual,
    type IShape,
    isPropertyChanged,
    Matrix4,
    NodeChildList,
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
import { ReselectFeatureCommand } from "./commands/reselectCommand";
import { evaluateFeature, type FeatureData, featureHandler, type ShapeTracking } from "./features";
import {
    type FeatureTimelineState,
    type IBodyTimelineNode,
    isBodyTimelineNode,
} from "./features/bodyTracking";
import {
    captureEdgeRef,
    type EdgeRef,
    idIsShared,
    indexesOfOverlappingId,
    matchEdgeIndexes,
} from "./features/edgeRef";
import { findSketch } from "./features/extrude";
import type {
    BooleanFeatureData,
    ChamferFeatureData,
    ExtrudeFeatureData,
    FilletFeatureData,
} from "./features/feature";
import { reportSilentIdLoss } from "./features/idDiagnostics";
import { allProfiles, profileEntitiesOf, sketchProfiles } from "./features/profileBuilder";
import { captureProfileRef, matchProfileIndexes, type ProfileRef } from "./features/profileRef";
import { syncNodeWatches } from "./nodeWatch";
import { danglingProfileRefs, SketchNode } from "./sketch/sketchNode";

/** Snapshot of one referenced node used for cache invalidation. */
interface RefSnapshot {
    readonly shape: Result<IShape> | undefined;
    /** World transform at capture time — moving a reference must bust the cache too. */
    readonly transform: Matrix4 | undefined;
}

function sameTransform(left: Matrix4 | undefined, right: Matrix4 | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return left.equals(right);
}

/** Output of one evaluated feature, reused while the feature and its inputs stay unchanged. */
interface FeatureCacheEntry {
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

/**
 * A body built by replaying an ordered feature list (extrude from sketch, then
 * fillet/chamfer …). Features store parameters and node references only — no shape
 * snapshots — so any upstream change (e.g. sketch edit) re-evaluates the whole chain.
 */
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
    private _cache: FeatureCacheEntry[] = [];
    /**
     * Chain state entering each feature-list index of the last successful evaluation,
     * swapped atomically with `_cache` (its entries reference the cache's shapes, so
     * they must never outlive it). Runtime-only view behind `timelineStateAt`.
     */
    private _timeline: FeatureTimelineState[] = [];
    /**
     * The timeline of the chain run currently in flight, seen by `timelineStateAt`
     * while evaluating: a sketch consumed mid-chain (see `followReferencedSketches`)
     * resolves its external references against the states already rebuilt in THIS
     * run — the committed `_timeline` still describes the previous run then.
     */
    private _inflightTimeline: FeatureTimelineState[] | undefined;
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
     * The pick session of `reselectShapes`, driven by `ReselectFeatureCommand` with
     * the command's controller — cancelling the command cancels this pick. For edge
     * features the list is rolled back to just before the feature for the duration
     * of the pick: the stored refs were captured from that pre-feature geometry, and
     * the filleted/chamfered edges no longer exist in the final shape. The rollback
     * is restored in `finally` and never transacted, so undo stays one step. The
     * currently referenced shapes start out selected (visible, toggleable); selection
     * changes preview the rebuilt result live, confirming keeps the remaining
     * selection, cancelling keeps the feature unchanged. The body node is re-selected
     * afterwards so the feature panel stays open.
     */
    async reselectSession(featureId: string, controller: AsyncController): Promise<void> {
        const featureIndex = this.features.findIndex((x) => x.id === featureId);
        const feature = this.features[featureIndex];
        if (feature?.type === "extrude") return this.reselectProfiles(feature, controller);
        if (feature?.type !== "fillet" && feature?.type !== "chamfer") return;

        const edges = await this.pickFeatureEdges(feature, featureIndex, controller);
        if (edges === undefined) return;

        Transaction.execute(this.document, "reselect edges", () => {
            const features = this.features.map((x) => (x.id === featureId ? { ...x, edges } : x));
            this.setFeaturesEmitShapeChanged(features);
            this.document.visual.update();
        });
    }

    /**
     * Re-picks the profiles of an extrude feature and replaces its stored refs. Unlike
     * edge features no rollback is needed: the picked faces live on the sketch, whose
     * shape does not depend on this feature. Selection changes preview the rebuilt body
     * live. Confirming with nothing selected clears `profiles` — back to extruding
     * every profile of the sketch.
     */
    private async reselectProfiles(feature: ExtrudeFeatureData, controller: AsyncController): Promise<void> {
        // Body-face extrudes (`source`) re-match by fingerprint; re-picking is only
        // supported for sketch profiles.
        if (feature.sketchId === undefined) return;
        const sketch = findSketch(this.document, feature.sketchId);
        if (sketch === undefined) return;

        const profiles = await this.pickFeatureProfiles(feature, sketch, controller);
        if (profiles === undefined) return;

        Transaction.execute(this.document, "reselect profiles", () => {
            const features = this.features.map((x) =>
                x.id === feature.id ? { ...x, profiles: profiles.length > 0 ? profiles : undefined } : x,
            );
            this.setFeaturesEmitShapeChanged(features);
            this.document.visual.update();
        });
    }

    /**
     * The pick session of `reselectProfiles`; returns undefined only when the user
     * cancels — an empty confirmation means "extrude every profile". Every selection
     * change rebuilds the body with the currently selected faces (history disabled),
     * so the result previews live; the original list is restored in `finally` and
     * only the confirmed replacement is transacted.
     */
    private async pickFeatureProfiles(
        feature: ExtrudeFeatureData,
        sketch: SketchNode,
        controller: AsyncController,
    ): Promise<ProfileRef[] | undefined> {
        const selection = this.document.selection;
        selection.clearSelection();
        const original = this.features;
        const history = this.document.history;
        const historyWasDisabled = history.disabled;
        history.disabled = true;
        let cancelled = false;
        const preview = (selected: VisualShapeData[]) => this.previewProfiles(feature, sketch, selected);
        try {
            this.document.visual.update();
            this.preselectCurrentProfiles(feature, sketch);
            selection.onShapeChanged.sub(preview);
            controller.onCancelled(() => (cancelled = true));
            const picked = await this.document.picker.pickShape("prompt.select.faces", controller, {
                shapeType: ShapeTypes.face,
                multi: true,
                nodeFilter: { allow: (node) => node === sketch },
            });
            if (cancelled) return undefined;
            return picked.map((x) => captureProfileRef(x.shape as unknown as IFace));
        } finally {
            selection.onShapeChanged.remove(preview);
            this.setFeaturesEmitShapeChanged(original);
            history.disabled = historyWasDisabled;
            selection.setSelectedNodes([this], false);
        }
    }

    /**
     * Live preview while re-picking: rebuilds with the selected faces as the feature's
     * profiles. An empty selection previews the whole sketch, matching what an empty
     * confirmation commits.
     */
    private previewProfiles(
        feature: ExtrudeFeatureData,
        sketch: SketchNode,
        selected: VisualShapeData[],
    ): void {
        const faces = selected.filter((x) => x.owner.node === sketch);
        const profiles =
            faces.length > 0 ? faces.map((x) => captureProfileRef(x.shape as unknown as IFace)) : undefined;
        this.setFeaturesEmitShapeChanged(
            this.features.map((x) => (x.id === feature.id ? { ...x, profiles } : x)),
        );
        this.document.visual.update();
    }

    /** Selects the profiles a feature currently references so the pick session starts from them. */
    private preselectCurrentProfiles(feature: ExtrudeFeatureData, sketch: SketchNode): void {
        if (feature.profiles === undefined || feature.profiles.length === 0) return;
        const profiles = sketchProfiles(sketch);
        if (!profiles.isOk) return;
        // A failed match is a common reason to re-pick; then there is nothing to preselect.
        const indexes = matchProfileIndexes(
            allProfiles(profiles.value),
            feature.profiles,
            profileEntitiesOf(profiles.value),
        );
        if (!indexes.isOk) return;
        // The profile mesh appends faces in the same outer-then-inner order, so a
        // matched position indexes into the face ranges directly.
        const ranges = sketch.mesh.faces?.range;
        if (ranges === undefined) return;
        const owner = this.document.visual.context.getVisual(sketch) as INodeVisual | undefined;
        if (owner === undefined) return;
        const picked: VisualShapeData[] = indexes.value.map((index) => ({
            owner,
            shape: ranges[index].shape,
            transform: owner.worldTransform(),
            indexes: [index],
        }));
        this.document.selection.setSelectedShapes(picked, VisualStates.faceSelected, false);
    }

    /**
     * The rolled-back pick session of `reselectSession`; returns undefined when the user
     * cancels or picks nothing. The rollback is the runtime-only `setRollbackIndex`
     * (the sketch editor's session mechanism): the feature list and the undo history
     * stay untouched, and only the final edge replacement is transacted. Selection
     * changes preview the full chain with the newly picked edges as a temporary mesh;
     * the body keeps the rolled-back shape pickable, with its faces made transparent
     * for the session so they do not fight the preview (like the shell command's
     * target body).
     */
    private async pickFeatureEdges(
        feature: FilletFeatureData | ChamferFeatureData,
        featureIndex: number,
        controller: AsyncController,
    ): Promise<EdgeRef[] | undefined> {
        // Clear the node selection first: a selected node tints every edge, which
        // would drown the pick highlight.
        const selection = this.document.selection;
        selection.clearSelection();
        const original = this.features;
        const history = this.document.history;
        const historyWasDisabled = history.disabled;
        history.disabled = true;
        let cancelled = false;
        let active = true;
        const preview = debounce((selected: VisualShapeData[]) => {
            if (active) this.previewEdgeSelection(original, featureIndex, selected);
        }, 20);
        const owner = this.document.visual.context.getVisual(this);
        const shapeType = this.shape.isOk ? this.shape.value.shapeType : undefined;
        try {
            // Deliberately ignores the boolean: a failed rollback replay keeps the
            // full chain displayed (discardCache keeps shape and cache consistent),
            // so the pick simply proceeds against the unrolled shape.
            this.setRollbackIndex(featureIndex);
            if (owner !== undefined && shapeType !== undefined) {
                this.document.visual.highlighter.addState(owner, VisualStates.faceTransparent, shapeType);
            }
            // Subscribed before the preselect, so the session opens with the preview
            // of the current edges already shown.
            selection.onShapeChanged.sub(preview);
            this.preselectCurrentEdges(feature);
            controller.onCancelled(() => (cancelled = true));
            const picked = await this.document.picker.pickShape("prompt.select.edges", controller, {
                shapeType: ShapeTypes.edge,
                multi: true,
                nodeFilter: { allow: (node) => node === this },
            });
            if (cancelled || picked.length === 0) return undefined;
            // Capture refs (including the stable edge id) NOW, while the rolled-back
            // cache still describes the shape the user picked from — after `finally`
            // restores the full chain, edgeIdAt would index the filleted shape,
            // whose edge order differs from the pre-feature one.
            return picked.map((x) => {
                const edgeId = this.edgeIdAt(x.indexes[0]);
                if (edgeId === undefined) {
                    reportSilentIdLoss(this, "edge", "a re-picked fillet/chamfer edge has no tracked id");
                }
                return captureEdgeRef(x.shape as unknown as IEdge, edgeId, this.edgeIdIsShared(edgeId));
            });
        } finally {
            active = false;
            selection.onShapeChanged.remove(preview);
            this.clearEdgePreview();
            if (owner !== undefined && shapeType !== undefined) {
                this.document.visual.highlighter.removeState(owner, VisualStates.faceTransparent, shapeType);
            }
            this.setRollbackIndex(undefined);
            history.disabled = historyWasDisabled;
            selection.setSelectedNodes([this], false);
        }
    }

    /** Temporary mesh of the edge-reselect preview, shown over the rolled-back shape. */
    private _edgePreview: number | undefined;

    private clearEdgePreview(): void {
        if (this._edgePreview === undefined) return;
        this.document.visual.context.removeMesh(this._edgePreview);
        this._edgePreview = undefined;
    }

    /**
     * Live preview while re-picking edges: applies the selected edges to the feature
     * and displays the fully evaluated chain as a temporary opaque mesh (temp meshes
     * are not pickable, so the session is unaffected; the body's own faces are made
     * transparent for the session, so they do not fight this mesh). The rolled-back
     * cache is still current, so the captured refs match what the confirm path stores.
     */
    private previewEdgeSelection(
        original: FeatureData[],
        featureIndex: number,
        selected: VisualShapeData[],
    ): void {
        this.clearEdgePreview();
        const edges = selected
            .filter((x) => x.owner.node === this && x.shape.shapeType === ShapeTypes.edge)
            .map((x) => {
                const edgeId = this.edgeIdAt(x.indexes[0]);
                if (edgeId === undefined) {
                    reportSilentIdLoss(this, "edge", "a re-picked fillet/chamfer edge has no tracked id");
                }
                return captureEdgeRef(x.shape as unknown as IEdge, edgeId, this.edgeIdIsShared(edgeId));
            });
        if (edges.length > 0) {
            const preview = original.map((x, i) => (i === featureIndex ? { ...x, edges } : x));
            const shape = this.evaluateChainSnapshot(preview);
            if (shape.isOk) {
                // The temp mesh renders in world space; the chain evaluates locally.
                let previewShape = shape.value;
                const transform = this.worldTransform();
                if (!transform.equals(Matrix4.identity())) {
                    previewShape = shape.value.transformedMul(transform);
                }
                try {
                    const { faces, edges: edgeMesh } = previewShape.mesh;
                    const datas = [faces, edgeMesh].filter((x) => x !== undefined);
                    if (datas.length > 0) {
                        this._edgePreview = this.document.visual.context.displayMesh(datas);
                    }
                } finally {
                    previewShape.dispose();
                    if (previewShape !== shape.value) shape.value.dispose();
                }
            }
        }
        this.document.visual.update();
    }

    /**
     * Evaluates a feature list without touching the node's state (cache, errors, shape)
     * and without id tracking — edge refs fall back to fingerprint matching. Shapes
     * superseded by a later feature are disposed; the caller owns the returned shape.
     */
    private evaluateChainSnapshot(features: FeatureData[]): Result<IShape> {
        let input: IShape | undefined;
        const scope = new Map<string, number>();
        for (const feature of features) {
            if (feature.suppressed) continue;
            const handler = featureHandler(feature.type);
            if (handler?.kind === "parameters") {
                const result =
                    handler.evaluateParameters?.(feature, scope) ?? Result.err("Not a parameter feature");
                if (!result.isOk) {
                    input?.dispose();
                    return Result.err(result.error);
                }
                continue;
            }
            const result = evaluateFeature(feature, { document: this.document, host: this, input, scope });
            if (!result.isOk) {
                input?.dispose();
                return Result.err(result.error);
            }
            if (result.value !== input) input?.dispose();
            input = result.value;
        }
        return input === undefined ? shapeFactory.combine([]) : Result.ok(input);
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

    /**
     * Stable id of the n-th face (findSubShapes order) of the final shape, or undefined
     * when face tracking is unavailable. See `FeatureCacheEntry.faceIds`. The cache is
     * swapped only by a fully successful chain, so this always describes the current
     * shape — a failed re-evaluation changes neither.
     */
    faceIdAt(index: number): string | undefined {
        return this._cache.at(-1)?.faceIds?.[index];
    }

    /** Face index of a tracked face id in the final shape, or undefined when unknown. */
    faceIndexById(id: string): number | undefined {
        const index = this._cache.at(-1)?.faceIds?.indexOf(id) ?? -1;
        return index < 0 ? undefined : index;
    }

    /** Face indexes whose tracked id overlaps `id` — see `IBodyTrackingNode.faceIndexesOfId`. */
    faceIndexesOfId(id: string): number[] {
        const ids = this._cache.at(-1)?.faceIds;
        return ids === undefined ? [] : indexesOfOverlappingId(ids, id);
    }

    /** Stable id of the n-th edge of the final shape, same contract as `faceIdAt`. */
    edgeIdAt(index: number): string | undefined {
        return this._cache.at(-1)?.edgeIds?.[index];
    }

    /** Edge index of a tracked edge id in the final shape, or undefined when unknown. */
    edgeIndexById(id: string): number | undefined {
        const index = this._cache.at(-1)?.edgeIds?.indexOf(id) ?? -1;
        return index < 0 ? undefined : index;
    }

    /** Edge indexes whose tracked id overlaps `id` — see `IBodyTrackingNode.edgeIndexesOfId`. */
    edgeIndexesOfId(id: string): number[] {
        const ids = this._cache.at(-1)?.edgeIds;
        return ids === undefined ? [] : indexesOfOverlappingId(ids, id);
    }

    /** True when several faces carry the same tracked id — pieces of a boolean-split face. */
    faceIdIsShared(id: string | undefined): boolean {
        const ids = this._cache.at(-1)?.faceIds;
        return ids !== undefined && idIsShared(ids, id);
    }

    /** True when several edges carry the same tracked id — pieces of a boolean-split edge. */
    edgeIdIsShared(id: string | undefined): boolean {
        const ids = this._cache.at(-1)?.edgeIds;
        return ids !== undefined && idIsShared(ids, id);
    }

    get featureCount(): number {
        return this.features.length;
    }

    /**
     * The chain state entering the feature at `index` (its input shape with that
     * step's tracked ids): the geometry a sketch's external references resolve
     * against when their timeline anchor (`SketchData.refPositions`) points here —
     * a downstream feature (e.g. a cut into the referenced edge) must not make them
     * dangle or re-anchor. While a chain run is in flight this reads that run's
     * partially built timeline (`_inflightTimeline`), so a sketch refreshed
     * mid-chain sees this run's rebuilt states; otherwise the committed one.
     * Undefined for an empty input (index 0), an out-of-range index, or a timeline
     * position a truncated (rolled-back) replay never reached.
     */
    timelineStateAt(index: number): FeatureTimelineState | undefined {
        const state = (this._inflightTimeline ?? this._timeline)[index];
        return state?.shape === undefined ? undefined : state;
    }

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
        // Chain state entering each feature-list index — the timeline sketch
        // external refs anchor to (see `timelineStateAt`). Exposed as the in-flight
        // timeline for the run's duration so mid-chain ref resolutions see it.
        const timeline: FeatureTimelineState[] = [];
        this._inflightTimeline = timeline;
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
                    this.discardCache(nextCache);
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
            this._inflightTimeline = undefined;
        }
        this.replaceCache(nextCache, timeline);
        this.refreshAnchoredRefs(resolvedProfiles, resolvedEdges);
        this.markUnresolvedExternalRefs(features);
        // An empty feature list (user removed every feature) is an empty compound, so
        // the view drops the stale solid instead of keeping a ghost (same as SketchNode).
        if (input === undefined) return shapeFactory.combine([]);
        return Result.ok(input);
    }

    /**
     * Re-resolves the external references of sketches this feature reads, so the
     * chain's first pass already works on post-edit geometry. Without it the
     * catch-up runs only after a successful chain (the sketch's source watch fires
     * on the emitted shape change): a first pass reading the stale sketch can fail
     * outright — e.g. a cut whose sketch geometry no longer intersects the rebuilt
     * body turns into a no-op, a downstream fillet then reports "Edge not found
     * after rebuild" for its vanished edges, and the failed chain keeps the old
     * shape, so the watch never fires and the sketch never catches up. Resolving
     * against the in-flight timeline (`_inflightTimeline`) is what makes the fresh
     * state available this early. A sketch owned by a live editor session is left
     * alone — the session's solver reconciles its refs itself.
     *
     * `followedSketches` memoizes the run (one Set per `evaluateChain`): a sketch
     * referenced by several features is re-resolved once, not once per feature —
     * the first follow already persists fresh snapshots for every later feature,
     * and a repeat would only re-pay the parse/scan. One narrow exception: a
     * sketch referencing THIS body whose timeline anchor (`SketchData.refPositions`)
     * the in-flight replay has not reached yet resolves against the final-shape
     * fallback (`timelineStateAt` is not ready at that point), so that first
     * result must NOT be pinned for the rest of the run — a later feature at or
     * past the anchor can still follow with the anchored state, and memoizing
     * would freeze the fallback resolution for the whole run.
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
     * Surfaces dangling profile-role external refs of consumed sketches as a
     * feature-level warning. Refs sourced from a parametric body resolve against
     * the shape at the sketch's timeline anchor (`SketchData.refPositions`, see
     * `timelineStateAt`), so a dangling flag already means the edge is gone at the
     * anchor too — a genuine loss (the upstream geometry was edited away), and the
     * sketch builds profiles from the frozen snapshot: silently wrong geometry
     * worth flagging. An edge consumed by a downstream feature of the source body
     * itself (a cut into it) still exists at the anchor, resolves there, and never
     * dangles — Onshape-style silence for the feature system working as intended.
     * Runs only after a fully successful chain; sketch lookups are memoized per
     * rebuild. Truncated at the session rollback index so hidden features don't
     * report warnings for geometry the user can't see. Revolve's
     * `axisSource.nodeId` is deliberately not checked: the axis edge re-matches
     * through its own `EdgeRef` on the source's shape, and if the axis sketch
     * itself is degraded that match can silently fall back to the world-space
     * snapshot axis — an accepted, narrower degradation than rebuilding whole
     * profiles from frozen geometry (and flagging it would warn on dangling refs
     * unrelated to the axis line).
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
            refs: this.captureRefs(feature),
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

    private validCacheEntry(
        key: string,
        input: IShape | undefined,
        index: number,
    ): FeatureCacheEntry | undefined {
        const entry = this._cache[index];
        if (entry === undefined || entry.input !== input || entry.json !== key) {
            return undefined;
        }
        for (const [id, snapshot] of entry.refs) {
            const current = this.captureRef(id);
            if (current.shape !== snapshot.shape) return undefined;
            if (!sameTransform(current.transform, snapshot.transform)) return undefined;
        }
        return entry;
    }

    private captureRefs(feature: FeatureData): Map<string, RefSnapshot> {
        const refs = new Map<string, RefSnapshot>();
        for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
            // A feature may reference the host itself (e.g. an extrude sourced on one
            // of its own faces) — the input-identity check already covers that.
            if (id === this.id) continue;
            refs.set(id, this.captureRef(id));
        }
        return refs;
    }

    private captureRef(id: string): RefSnapshot {
        const node = this.document.modelManager.findNode((n) => n.id === id);
        if (!(node instanceof ShapeNode)) return { shape: undefined, transform: undefined };
        return { shape: node.shape, transform: node.worldTransform() };
    }

    /**
     * Swaps the cache and disposes evicted intermediate shapes. The node's current
     * shape is never disposed here — `ShapeNode.disposeInternal` owns its lifecycle.
     * The timeline goes along with it: its entries reference the cache's shapes, so
     * the two must never describe different runs.
     */
    private replaceCache(next: FeatureCacheEntry[], timeline: FeatureTimelineState[]): void {
        const reused = new Set(next.map((entry) => entry.shape));
        const current = this._shape.isOk ? this._shape.value : undefined;
        for (const entry of this._cache) {
            if (!reused.has(entry.shape) && entry.shape !== current) entry.shape.dispose();
        }
        this._cache = next;
        this._timeline = timeline;
    }

    /**
     * Failure counterpart of `replaceCache`: the aborted run's entries are dropped
     * (the previous cache keeps describing the current shape), so shapes created
     * during it are disposed unless they were reused from the kept cache.
     */
    private discardCache(next: FeatureCacheEntry[]): void {
        const kept = new Set(this._cache.map((entry) => entry.shape));
        const current = this._shape.isOk ? this._shape.value : undefined;
        for (const entry of next) {
            if (!kept.has(entry.shape) && entry.shape !== current) entry.shape.dispose();
        }
    }

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
        this._timeline = [];
        const current = this._shape.isOk ? this._shape.value : undefined;
        for (const entry of this._cache) {
            if (entry.shape !== current) entry.shape.dispose();
        }
        this._cache = [];
        super.disposeInternal();
    }
}
