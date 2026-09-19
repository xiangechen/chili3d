// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    debounce,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type INode,
    type INodeVisual,
    type IShape,
    Matrix4,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { IBodyTrackingNode } from "../features/bodyTracking";
import { matchEdgeIndexes } from "../features/edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import {
    type ChamferFeatureData,
    type ExtrudeFeatureData,
    evaluateFeature,
    type FeatureData,
    type FilletFeatureData,
} from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { allProfiles, profileEntitiesOf, sketchProfiles } from "../features/profileBuilder";
import { matchProfileIndexes } from "../features/profileMatcher";
import { captureProfileRef, type ProfileRef } from "../features/profileRef";
import type { SketchNode } from "../sketch/sketchNode";

/**
 * The re-pick sessions behind `ParametricBodyNode.reselectShapes`: a feature row's
 * "reselect" menu starts `ReselectFeatureCommand`, which drives one of these.
 *
 * Why they live outside the body node: they are interaction, not model. They own the
 * picker, the selection, the highlighter and a temporary preview mesh — the body node
 * is a document-model class and must not reach into any of those. Keeping the sessions
 * here also mirrors the package's other interactive picks (`EdgeCornerPickHandler`).
 */

/**
 * The body surface these sessions drive. `ParametricBodyNode` satisfies it
 * structurally; naming the dependency here keeps it explicit and one-directional —
 * this module never imports the node class, so there is no import cycle.
 */
export interface ReselectHost extends INode, IBodyTrackingNode {
    readonly document: IDocument;
    readonly features: FeatureData[];
    readonly shape: Result<IShape>;
    worldTransform(): Matrix4;
    setFeaturesEmitShapeChanged(features: FeatureData[]): void;
    setRollbackIndex(index: number | undefined): boolean;
    edgeIdIsShared(id: string | undefined): boolean;
}

/**
 * What a re-pick session has to supply; the scaffold around it — selection and history
 * handling, the pick call, the preview subscription and the teardown — is shared (see
 * `runReselectSession`).
 */
interface ReselectPickSpec<TRef> {
    prompt: I18nKeys;
    shapeType: ShapeType;
    /** The pick is restricted to this node. */
    targetNode: INode;
    /** Session state to open before the pick, ahead of the preview subscription. */
    setup?(): void;
    /** Runs on every selection change while the session is open. */
    preview(selected: VisualShapeData[]): void;
    /** Runs after the preview subscription: a preselect in here previews immediately. */
    preselect?(): void;
    /** Maps what was picked to the refs the caller stores; runs before `teardown`. */
    capture(picked: VisualShapeData[]): TRef[];
    /** Undoes `setup` and drops anything the session displayed. */
    teardown?(): void;
    /**
     * Whether an empty pick cancels. Edges: yes, there is no "no edges" answer. Profiles:
     * no — an empty confirmation means "every profile", which the caller stores as none.
     */
    emptyIsCancel: boolean;
    /**
     * Runs when the user confirms without picking anything and `emptyIsCancel` turns that
     * into a cancel — the place to say why nothing happened. Confirming is reachable with
     * nothing selected (the selection control only counts, it does not gate the button),
     * so this is a real path, not a defensive one.
     */
    onEmptyPick?(): void;
}

/**
 * Drives one re-pick session end to end. The node selection goes first because a selected
 * node tints every edge and would drown the pick highlight; history is disabled for the
 * session so a re-pick does not land in the undo stack on its own.
 *
 * `capture` deliberately runs before `teardown`: the edge session has to read its refs
 * while the rolled-back cache still describes the shape the user picked from.
 */
async function runReselectSession<TRef>(
    host: ReselectHost,
    controller: AsyncController,
    spec: ReselectPickSpec<TRef>,
): Promise<TRef[] | undefined> {
    const selection = host.document.selection;
    selection.clearSelection();
    const history = host.document.history;
    const historyWasDisabled = history.disabled;
    history.disabled = true;
    let cancelled = false;
    const preview = (selected: VisualShapeData[]) => spec.preview(selected);
    try {
        spec.setup?.();
        selection.onShapeChanged.sub(preview);
        spec.preselect?.();
        controller.onCancelled(() => (cancelled = true));
        const picked = await host.document.picker.pickShape(spec.prompt, controller, {
            shapeType: spec.shapeType,
            multi: true,
            nodeFilter: { allow: (node) => node === spec.targetNode },
        });
        if (cancelled) return undefined;
        if (spec.emptyIsCancel && picked.length === 0) {
            spec.onEmptyPick?.();
            return undefined;
        }
        return spec.capture(picked);
    } finally {
        selection.onShapeChanged.remove(preview);
        spec.teardown?.();
        history.disabled = historyWasDisabled;
        selection.setSelectedNodes([host], false);
    }
}

/**
 * Re-picks the edges of a fillet/chamfer and returns the replacement refs, or undefined when
 * the user cancels or picks nothing.
 *
 * - **Why the body is rolled back** to just before the feature, for the whole pick: the stored
 *   refs were captured from that pre-feature geometry, and the filleted/chamfered edges do not
 *   exist in the final shape.
 * - **The rollback is runtime-only** (the body's `setRollbackIndex`), so the feature list and
 *   the undo history stay untouched.
 * - **Preview.** A live selection change previews the full chain with the newly picked edges as
 *   a temporary mesh, and the body's own faces are made transparent for the session so they do
 *   not fight that mesh — the same treatment the shell command gives its target body.
 */
export class EdgeReselectSession {
    /** Temporary mesh of the live rebuild preview, shown over the rolled-back shape. */
    private _preview: number | undefined;

    constructor(private readonly host: ReselectHost) {}

    async pick(
        feature: FilletFeatureData | ChamferFeatureData,
        featureIndex: number,
        controller: AsyncController,
    ): Promise<EdgeRef[] | undefined> {
        const original = this.host.features;
        let active = true;
        const preview = debounce((selected: VisualShapeData[]) => {
            if (active) this.previewSelection(original, featureIndex, selected);
        }, 20);
        const owner = this.host.document.visual.context.getVisual(this.host);
        const shape = this.host.shape;
        const shapeType = shape.isOk ? shape.value.shapeType : undefined;

        return runReselectSession(this.host, controller, {
            prompt: "prompt.select.edges",
            shapeType: ShapeTypes.edge,
            targetNode: this.host,
            // Nothing picked is nothing to re-pick.
            emptyIsCancel: true,
            onEmptyPick: () => PubSub.default.pub("showToast", "toast.select.noSelected"),
            preview,
            setup: () => {
                // Deliberately ignores the boolean: a failed rollback replay keeps the
                // full chain displayed (discarding keeps shape and cache consistent),
                // so the pick simply proceeds against the unrolled shape.
                this.host.setRollbackIndex(featureIndex);
                if (owner !== undefined && shapeType !== undefined) {
                    this.host.document.visual.highlighter.addState(
                        owner,
                        VisualStates.faceTransparent,
                        shapeType,
                    );
                }
            },
            // Runs after the preview subscription, so the session opens with the preview
            // of the current edges already shown.
            preselect: () => this.preselect(feature),
            // Capture refs (including the stable edge id) while the rolled-back cache
            // still describes the shape the user picked from — after the teardown
            // restores the full chain, edgeIdAt would index the filleted shape, whose
            // edge order differs from the pre-feature one.
            capture: (picked) => picked.map((x) => this.captureRef(x)),
            teardown: () => {
                active = false;
                this.clearPreview();
                if (owner !== undefined && shapeType !== undefined) {
                    this.host.document.visual.highlighter.removeState(
                        owner,
                        VisualStates.faceTransparent,
                        shapeType,
                    );
                }
                this.host.setRollbackIndex(undefined);
            },
        });
    }

    /** The ref of one picked edge, warning when its tracked id went missing. */
    private captureRef(picked: VisualShapeData): EdgeRef {
        const edgeId = this.host.edgeIdAt(picked.indexes[0]);
        if (edgeId === undefined) {
            reportSilentIdLoss(this.host, "edge", "a re-picked fillet/chamfer edge has no tracked id");
        }
        return captureEdgeRef(picked.shape as unknown as IEdge, edgeId, this.host.edgeIdIsShared(edgeId));
    }

    private clearPreview(): void {
        if (this._preview === undefined) return;
        this.host.document.visual.context.removeMesh(this._preview);
        this._preview = undefined;
    }

    /**
     * Live preview while re-picking: applies the selected edges to the feature and
     * displays the fully evaluated chain as a temporary opaque mesh (temp meshes are not
     * pickable, so the session is unaffected). The rolled-back cache is still current,
     * so the captured refs match what the confirm path will store.
     */
    private previewSelection(
        original: FeatureData[],
        featureIndex: number,
        selected: VisualShapeData[],
    ): void {
        this.clearPreview();
        const edges = this.selectedEdgeRefs(selected);
        if (edges.length > 0) {
            const preview = original.map((x, i) => (i === featureIndex ? { ...x, edges } : x));
            const shape = evaluateChainSnapshot(this.host, preview);
            if (shape.isOk) this._preview = this.displayPreviewMesh(shape.value);
        }
        this.host.document.visual.update();
    }

    /** The refs of the selected shapes that are this host's edges. */
    private selectedEdgeRefs(selected: VisualShapeData[]): EdgeRef[] {
        // Upcast for the identity test: `owner.node` is a `VisualNode`, the host a
        // narrower interface — both are `INode`, which is what identity means here.
        return selected
            .filter((x) => (x.owner.node as INode) === this.host && x.shape.shapeType === ShapeTypes.edge)
            .map((x) => this.captureRef(x));
    }

    /**
     * Displays `shape` as a temporary mesh and returns its id, or undefined when it carries no
     * mesh data. The temp mesh renders in world space; the chain evaluates locally.
     */
    private displayPreviewMesh(shape: IShape): number | undefined {
        let previewShape = shape;
        const transform = this.host.worldTransform();
        if (!transform.equals(Matrix4.identity())) {
            previewShape = shape.transformedMul(transform);
        }
        try {
            const { faces, edges } = previewShape.mesh;
            const datas = [faces, edges].filter((x) => x !== undefined);
            return datas.length > 0 ? this.host.document.visual.context.displayMesh(datas) : undefined;
        } finally {
            previewShape.dispose();
            if (previewShape !== shape) shape.dispose();
        }
    }

    /** Selects the edges the feature currently references so the pick starts from them. */
    private preselect(feature: FilletFeatureData | ChamferFeatureData): void {
        const shape = this.host.shape;
        if (!shape.isOk) return;
        // A failed match is a common reason to re-pick; then there is nothing to preselect.
        const indexes = matchEdgeIndexes(shape.value, feature.edges);
        if (!indexes.isOk) return;
        // Mesh ranges enumerate edges in the same order as findSubShapes (both use
        // TopExp::MapShapes), so a matched position indexes into the ranges directly.
        // The range shapes also carry the sub-edge ids detection produces, which the
        // selection's toggle matching relies on.
        const ranges = shape.value.mesh.edges?.range;
        if (ranges === undefined) return;
        const owner = this.host.document.visual.context.getVisual(this.host) as INodeVisual | undefined;
        if (owner === undefined) return;
        const picked: VisualShapeData[] = indexes.value.map((index) => ({
            owner,
            shape: ranges[index].shape,
            transform: owner.worldTransform(),
            indexes: [index],
        }));
        this.host.document.selection.setSelectedShapes(picked, VisualStates.edgeSelected, false);
    }
}

/**
 * Re-picks the profiles of an extrude feature and returns the replacement refs, or
 * undefined when the user cancels. An empty confirmation means "extrude every profile",
 * which the caller stores as no `profiles` at all.
 *
 * No rollback is needed here — unlike edge features, the picked faces live on the
 * sketch, whose shape does not depend on this feature. Every selection change rebuilds
 * the body with the currently selected faces (history disabled), so the result previews
 * live; the original list is restored in `finally`.
 */
export class ProfileReselectSession {
    constructor(private readonly host: ReselectHost) {}

    async pick(
        feature: ExtrudeFeatureData,
        sketch: SketchNode,
        controller: AsyncController,
    ): Promise<ProfileRef[] | undefined> {
        const original = this.host.features;
        return runReselectSession(this.host, controller, {
            prompt: "prompt.select.faces",
            shapeType: ShapeTypes.face,
            targetNode: sketch,
            // An empty confirmation means "extrude every profile", which the caller
            // stores as no `profiles` at all.
            emptyIsCancel: false,
            preview: (selected) => this.preview(feature, sketch, selected),
            // Ahead of the preview subscription: preselecting here must not fire a
            // preview of the profiles it just selected.
            setup: () => {
                this.host.document.visual.update();
                this.preselect(feature, sketch);
            },
            capture: (picked) => picked.map((x) => captureProfileRef(x.shape as unknown as IFace)),
            teardown: () => this.host.setFeaturesEmitShapeChanged(original),
        });
    }

    /**
     * Live preview while re-picking: rebuilds with the selected faces as the feature's
     * profiles. An empty selection previews the whole sketch, matching what an empty
     * confirmation commits.
     */
    private preview(feature: ExtrudeFeatureData, sketch: SketchNode, selected: VisualShapeData[]): void {
        const faces = selected.filter((x) => x.owner.node === sketch);
        const profiles =
            faces.length > 0 ? faces.map((x) => captureProfileRef(x.shape as unknown as IFace)) : undefined;
        this.host.setFeaturesEmitShapeChanged(
            this.host.features.map((x) => (x.id === feature.id ? { ...x, profiles } : x)),
        );
        this.host.document.visual.update();
    }

    /** Selects the profiles the feature currently references so the pick starts from them. */
    private preselect(feature: ExtrudeFeatureData, sketch: SketchNode): void {
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
        const owner = this.host.document.visual.context.getVisual(sketch) as INodeVisual | undefined;
        if (owner === undefined) return;
        const picked: VisualShapeData[] = indexes.value.map((index) => ({
            owner,
            shape: ranges[index].shape,
            transform: owner.worldTransform(),
            indexes: [index],
        }));
        this.host.document.selection.setSelectedShapes(picked, VisualStates.faceSelected, false);
    }
}

/**
 * Evaluates a feature list without touching the host's state (cache, errors, shape) and
 * without id tracking — edge refs fall back to fingerprint matching. Shapes superseded
 * by a later feature are disposed; the caller owns the returned shape.
 */
function evaluateChainSnapshot(host: ReselectHost, features: FeatureData[]): Result<IShape> {
    let input: IShape | undefined;
    const scope = host.document.variables.evaluate().scope;
    for (const feature of features) {
        if (feature.suppressed) continue;
        const result = evaluateFeature(feature, { document: host.document, host, input, scope });
        if (!result.isOk) {
            input?.dispose();
            return Result.err(result.error);
        }
        if (result.value !== input) input?.dispose();
        input = result.value;
    }
    return input === undefined ? shapeFactory.combine([]) : Result.ok(input);
}
