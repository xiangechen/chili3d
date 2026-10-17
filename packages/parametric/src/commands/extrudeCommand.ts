// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    AsyncController,
    AUTO_TARGETS,
    BoundingBox,
    Combobox,
    command,
    type I18nKeys,
    type IDocument,
    Id,
    type IFace,
    type INode,
    type INodeVisual,
    type IShape,
    type IStep,
    type IVertex,
    type IView,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    type Plane,
    Precision,
    PubSub,
    property,
    type Result,
    type ShapeMeshData,
    ShapeTypes,
    ShapeTypeUtils,
    type SnapResult,
    type TargetCandidate,
    type TargetSelection,
    Transaction,
    type VisualShapeData,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { throughAllDepth, upToTargetDepth } from "../features/extrudeEnd";
import type { BooleanOperation, ExtrudeEndCondition, ExtrudeFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { allProfiles, sketchProfiles } from "../features/profileBuilder";
import { captureProfileRef } from "../features/profileRef";
import { sweepFaces } from "../features/sweepGeometry";
import { captureVertexRef } from "../features/vertexRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { buildTargetPreview, worldShape } from "./booleanPreview";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    standaloneBody,
    syncAutoTargets,
    targetCandidate,
} from "./booleanTargets";
import {
    type ExtrudeDragHandler,
    type ExtrudeDragState,
    ExtrudeDragStep,
    type ExtrudePreview,
    planeOfPickedFace,
} from "./extrudeDragStep";
import type { PickSettledCommand } from "./pickSettled";
import { prioritizeSketchFaces } from "./profileFaceSort";
import { SELECTED_FACE_STATE } from "./selectedFaceState";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/**
 * Maps a form feature command's operation dropdown values to boolean operations; "New Body" has
 * none. Shared by every command whose feature carries an `operation` (extrude, thicken).
 */
export const FORM_FEATURE_OPERATIONS: Record<string, BooleanOperation> = {
    "option.command.operation.join": "fuse",
    "option.command.operation.cut": "cut",
    "option.command.operation.intersect": "common",
};

/** The red a cut's tool volume is previewed in — the material the commit takes away. */
const CUT_TOOL_COLOR = 0xff4d4d;

const END_CONDITION_BLIND: I18nKeys = "feature.extrude.endCondition.blind";
const END_CONDITION_THROUGH_ALL: I18nKeys = "feature.extrude.endCondition.throughAll";
const END_CONDITION_UP_TO_FACE: I18nKeys = "feature.extrude.endCondition.upToFace";
const END_CONDITION_UP_TO_VERTEX: I18nKeys = "feature.extrude.endCondition.upToVertex";

/** Maps the end-condition dropdown values to the feature's `ExtrudeEndCondition`. */
const EXTRUDE_END_CONDITIONS: Record<string, ExtrudeEndCondition> = {
    [END_CONDITION_BLIND]: "blind",
    [END_CONDITION_THROUGH_ALL]: "throughAll",
    [END_CONDITION_UP_TO_FACE]: "upToFace",
    [END_CONDITION_UP_TO_VERTEX]: "upToVertex",
};

/**
 * Resolves the profiles to extrude in one step:
 * 1. profile faces are already selected → use them (sketch profile faces or planar
 *    faces of a parametric body; faces of other nodes than the first one's are ignored);
 * 2. a sketch node is selected → all of its outer profiles, resolved to face picks as
 *    if the user had selected them (whole sketch when the sketch has no profiles);
 * 3. otherwise the user picks a face. The filter only allows sketch nodes and
 *    parametric bodies, and only planar faces. Confirming with nothing selected
 *    (Enter/Escape) cancels the command.
 *
 * `allowNode` overrides which nodes profiles can come from (revolve: sketches only).
 */
export class SelectSketchProfilesStep implements IStep {
    constructor(
        private readonly allowNode: (node: INode) => boolean = (node) =>
            node instanceof SketchNode || node instanceof ParametricBodyNode,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const view = document.application.activeView!;
        return (
            this.fromSelectedFaces(document, view, controller) ??
            this.fromSelectedSketch(document, view, controller) ??
            (await this.pickFace(document, view, controller))
        );
    }

    /**
     * Pre-selected profile faces — sketch profile faces or planar faces of a parametric
     * body; faces of other nodes than the first one's are ignored. Undefined when none.
     */
    private fromSelectedFaces(
        document: IDocument,
        view: IView,
        controller: AsyncController,
    ): SnapResult | undefined {
        const selectedFaces = document.selection
            .getSelectedShapes()
            .filter(
                (x) =>
                    ShapeTypeUtils.hasFace(x.shape.shapeType) &&
                    this.allowNode(x.owner.node) &&
                    (!(x.owner.node instanceof ParametricBodyNode) ||
                        (x.shape as IFace).surface().isPlanar()),
            );
        if (selectedFaces.length === 0) return undefined;
        const node = selectedFaces[0].owner.node;
        controller.success();
        return {
            view,
            shapes: selectedFaces.filter((x) => x.owner.node === node),
            nodes: [node],
            type: "shape",
        };
    }

    /** A pre-selected sketch contributes all its outer profiles (empty: whole sketch). */
    private fromSelectedSketch(
        document: IDocument,
        view: IView,
        controller: AsyncController,
    ): SnapResult | undefined {
        const selectedSketch = document.selection
            .getSelectedNodes()
            .find((x): x is SketchNode => x instanceof SketchNode && this.allowNode(x));
        if (selectedSketch === undefined) return undefined;
        const faces = SelectSketchProfilesStep.sketchProfileFaces(document, selectedSketch);
        controller.success();
        // Show the profiles as selected, exactly as if the user had picked them.
        if (faces.length > 0) {
            document.selection.setSelectedShapes(faces, SELECTED_FACE_STATE, false);
        }
        return { view, shapes: faces, nodes: [selectedSketch], type: "shape" };
    }

    /** Interactive pick: planar faces of allowed nodes only, sketches before solid faces. */
    private async pickFace(
        document: IDocument,
        view: IView,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        const shapes = await document.picker.pickShape("prompt.select.faces", controller, {
            shapeType: ShapeTypes.face,
            shapeFilter: { allow: (shape) => (shape as IFace).surface().isPlanar() },
            multi: false,
            nodeFilter: { allow: this.allowNode },
            selectedState: SELECTED_FACE_STATE,
            sortDetected: prioritizeSketchFaces,
        });
        if (shapes.length === 0) return undefined;
        return { view, shapes, nodes: [shapes[0].owner.node], type: "shape" };
    }

    /**
     * Synthesizes the pick data of every outer profile of `sketch`, so a pre-selected
     * sketch enters the drag step with all profiles selected as if picked manually.
     * The displayed mesh adds the base shape first (an edge compound without faces) and
     * then the profiles in `allProfiles` order — outer first — so the leading face
     * ranges are the outer profiles and each range position is the detection index
     * (the same index a viewport pick would report).
     */
    private static sketchProfileFaces(document: IDocument, sketch: SketchNode): VisualShapeData[] {
        const profiles = sketchProfiles(sketch);
        if (!profiles.isOk || profiles.value.outer.length === 0) return [];
        const owner = document.visual.context.getVisual(sketch) as INodeVisual | undefined;
        const ranges = sketch.mesh.faces?.range ?? [];
        if (owner === undefined || ranges.length < allProfiles(profiles.value).length) return [];

        const nodeTransform = owner.worldTransform();
        const faces: VisualShapeData[] = [];
        for (let i = 0; i < profiles.value.outer.length; i++) {
            const range = ranges[i];
            if (range.shape.shapeType !== ShapeTypes.face) return [];
            faces.push({
                shape: range.shape,
                owner,
                transform:
                    range.transform === undefined ? nodeTransform : nodeTransform.multiply(range.transform),
                point: BoundingBox.center(range.shape.boundingBox()),
                indexes: [i],
            });
        }
        return faces;
    }
}

/**
 * The finishing interaction after the drag step. The up-to conditions pick their target
 * here (a face or a vertex of any node); the depth-driven ones (blind/throughAll) need
 * nothing and pass through with an empty pick — UNLESS the depth was never set: the drag
 * was skipped (an up-to condition held while it ran, leaving a zero-depth placeholder in
 * `stepDatas[1]`) or `finishEarly` ended it before any gesture. The drag then runs in
 * place, right here, and its result replaces what the drag step left
 * (`command.replaceDragData`). The decision keys on the depth itself
 * (`command.needsDepthDrag`), so a panel value the user typed commits as-is.
 *
 * The condition is re-read at the top of every round, so a dropdown flip mid-interaction
 * is absorbed: the command's setter settles an in-flight pick round (`settleForRepick`)
 * or ends an in-flight drag (`finishEarly`), and the loop starts over on the new
 * condition. A round ends the loop only when the condition it served is still the live
 * one. A flip from a target pick to a depth-driven condition re-runs the depth gesture
 * unless the user gave that depth in this run (dragged or typed — `command.depthGiven`):
 * committing on a value they never gave would take the choice away. Escape cancels the
 * whole command (the axis pick's convention), which is why the target never reaches the
 * commit uncaptured.
 */
export class ExtrudeEndTargetStep implements IStep {
    /** Settles the in-flight pick round; registered per round, undefined between rounds. */
    private _settle: (() => void) | undefined;
    /** The document of the round in flight — the preview's owner, undefined between rounds. */
    private _document: IDocument | undefined;
    private _hovered: VisualShapeData | undefined;
    private _selected: VisualShapeData | undefined;
    private _previewIds: number[] = [];
    /** The last round ended because the dropdown flipped, not because the user answered it. */
    private _repickSettled = false;

    constructor(private readonly command: ExtrudeFeatureCommand) {}

    /** The end condition changed mid-pick: end the current round so the loop re-reads it. */
    settleForRepick(): void {
        this._settle?.();
    }

    /**
     * The panel changed while the target pick is open: repaint the prism the target
     * already aimed at would make. The pointer's aim wins over the selection, so hovering
     * another face previews that one before the click replaces the selection.
     */
    refreshPreview(): void {
        this.clearPreview();
        const target = this._hovered ?? this._selected;
        const document = this._document;
        if (target === undefined || document === undefined) return;

        const preview = this.command.upToTargetPreview(target);
        if (preview === undefined) return;
        // Translucent and on top: the prism often sits inside the body being cut, and the
        // body must stay visible — it is what the pointer is still aiming at.
        for (const mesh of preview.meshes) {
            this._previewIds.push(
                document.visual.context.displayMesh([mesh], { meshOpacity: 0.5, onTop: true }),
            );
        }
        document.visual.update();
    }

    private clearPreview(): void {
        if (this._previewIds.length === 0) return;
        for (const id of this._previewIds) {
            this._document?.visual.context.removeMesh(id);
        }
        this._previewIds = [];
        this._document?.visual.update();
    }

    /** The pointer's aim changed (see `PickShapeOptions.onDetect`). */
    private readonly onDetect = (detected: VisualShapeData | undefined) => {
        if (ExtrudeEndTargetStep.sameShape(this._hovered, detected)) return;
        this._hovered = detected;
        this.refreshPreview();
    };

    /** The click's selection changed — the target the confirm would take. */
    private readonly onSelectionChanged = (shapes: VisualShapeData[]) => {
        const selected = shapes[0];
        if (ExtrudeEndTargetStep.sameShape(this._selected, selected)) return;
        this._selected = selected;
        this.refreshPreview();
    };

    private static sameShape(a: VisualShapeData | undefined, b: VisualShapeData | undefined): boolean {
        if (a === undefined || b === undefined) return a === b;
        return a.owner === b.owner && a.shape === b.shape && a.indexes.join(",") === b.indexes.join(",");
    }

    /**
     * Keeps the profiles the extrude sweeps highlighted for the whole target pick — the
     * step clears the selection, which would otherwise take the profiles' pick state with
     * it and leave the user aiming with nothing to show what is being extruded.
     */
    private setProfilesHighlighted(on: boolean): void {
        const document = this._document;
        if (document === undefined) return;
        for (const shape of this.command.pickedProfileShapes) {
            if (on) {
                document.visual.highlighter.addState(
                    shape.owner,
                    SELECTED_FACE_STATE,
                    shape.shape.shapeType,
                    ...shape.indexes,
                );
            } else {
                document.visual.highlighter.removeState(
                    shape.owner,
                    SELECTED_FACE_STATE,
                    shape.shape.shapeType,
                    ...shape.indexes,
                );
            }
        }
        document.visual.update();
    }

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        /** The loop just left a target pick because the condition flipped — not an answer. */
        let leftTargetPick = false;
        for (;;) {
            const condition = this.command.endCondition;
            if (condition === END_CONDITION_UP_TO_FACE || condition === END_CONDITION_UP_TO_VERTEX) {
                const shapes = await this.pickRound(
                    document,
                    controller,
                    condition === END_CONDITION_UP_TO_FACE,
                );
                if (shapes === undefined) return undefined; // the pick was cancelled
                if (shapes.length === 0) {
                    // Settled for a re-pick (or Enter with nothing): re-read the condition.
                    leftTargetPick = this._repickSettled;
                    continue;
                }
                controller.success();
                return {
                    view: document.application.activeView!,
                    shapes,
                    nodes: shapes.map((x) => x.owner.node),
                    type: "shape",
                };
            }
            // A depth-driven condition needs no target — but it needs its gesture. The drag
            // never set one when it was skipped or when `finishEarly` ended it before any
            // gesture, and a dropdown flip from a target pick lands here too: the user asked
            // for a depth-driven condition and must get the arrows (and the commit button)
            // rather than a silent commit at whatever depth the panel happened to hold. A
            // depth the user DID give this run (dragged or typed) keeps its commit.
            const needsGesture = this.command.needsDepthDrag || (leftTargetPick && !this.command.depthGiven);
            leftTargetPick = false;
            if (needsGesture) {
                const dragged = await this.dragRound(document, controller);
                if (dragged === undefined) return undefined; // the drag was cancelled
                this.command.replaceDragData(dragged);
                // A flip DURING the drag (to an up-to target, ended via `finishEarly`)
                // is re-read by the next round; an unchanged condition is done.
                if (this.command.endCondition !== condition) continue;
            }
            controller.success();
            return { view: document.application.activeView!, shapes: [], nodes: [], type: "shape" };
        }
    }

    /**
     * One pick round on a FRESH controller: a settled controller replays its result to
     * every listener registered later (see `AsyncController.addListener`), so reusing the
     * step's own controller for a re-pick would resolve instantly and spin the loop
     * without ever picking again. The step controller only bridges cancel/fail into the
     * round; success is the loop's own once a round picked something.
     */
    private async pickRound(
        document: IDocument,
        controller: AsyncController,
        isFace: boolean,
    ): Promise<VisualShapeData[] | undefined> {
        const round = new AsyncController();
        // No off() exists: the bridges live as long as the step's controller, which the
        // command disposes when the step ends — one stale bridge per re-pick, settled
        // controllers all, so they fire into settled rounds and do nothing.
        controller.onCancelled(() => round.cancel());
        controller.onFailed(() => round.fail());
        /** The condition flipped: this round's pick belongs to the condition it replaced. */
        let settledForRepick = false;
        this._repickSettled = false;
        this._settle = () => {
            settledForRepick = true;
            this._repickSettled = true;
            round.success();
        };
        this._document = document;
        this._hovered = undefined;
        this._selected = undefined;
        let shapes: VisualShapeData[];
        /** The face under the pointer when the round settled — what the preview last showed. */
        let hovered: VisualShapeData | undefined;
        try {
            // Each round starts from an EMPTY selection: Enter confirms whatever is
            // selected, so a leftover pick from an earlier step would be confirmed as the
            // target without ever being aimed at. The profiles the extrude sweeps are put
            // back up right after — they are what the target is measured against.
            document.selection.clearSelection();
            document.selection.onShapeChanged.sub(this.onSelectionChanged);
            this.setProfilesHighlighted(true);
            shapes = await document.picker.pickShape(
                isFace ? "prompt.select.faces" : "prompt.select.vertexes",
                round,
                {
                    shapeType: isFace ? ShapeTypes.face : ShapeTypes.vertex,
                    multi: false,
                    // The click only aims: the target is a parameter of an extrude whose
                    // depth/offset may still change, so the bar's confirm (or Enter) ends
                    // it — the same "pick, then OK" Fusion/Onshape use.
                    finishOnClick: false,
                    // Live preview of the reach the aimed target would give.
                    onDetect: this.onDetect,
                },
            );
            hovered = this._hovered;
        } finally {
            document.selection.onShapeChanged.remove(this.onSelectionChanged);
            this.setProfilesHighlighted(false);
            this._settle = undefined;
            this._hovered = undefined;
            this._selected = undefined;
            this.clearPreview();
            this._document = undefined;
        }
        // The dropdown flipped: the target under the pointer (or already picked) was aimed
        // at the OLD condition — a face is no answer to "up to vertex" — so the round must
        // not hand it back. Answering empty makes the caller re-read the condition and
        // start a fresh round for it.
        if (settledForRepick) return [];
        // The preview follows the pointer (`refreshPreview`), so a settled SUCCESS must
        // commit what the pointer last aimed at, not a selection the user clicked before
        // moving on. Without a hovered shape the click's selection stands.
        if (round.result?.status === "success" && hovered !== undefined) return [hovered];
        // An empty SUCCESS otherwise is Enter with nothing selected (`SelectionHandler
        // .keyDown` accepts unconditionally) — also "start over". Anything else empty is a
        // cancel.
        if (shapes.length === 0 && round.result?.status !== "success") return undefined;
        return shapes;
    }

    /**
     * One drag round on a FRESH controller, bridged like the pick rounds. The settle
     * hook is NOT wired: a condition flip reaches the running drag through the command
     * itself (`finishEarly` for an up-to target; blind ↔ throughAll keeps the same
     * gesture and is only re-read after the drag), and settling the round from here
     * would end the drag without a commit view — the drag step reads that as a cancel
     * of the whole command.
     */
    private async dragRound(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        const round = new AsyncController();
        controller.onCancelled(() => round.cancel());
        controller.onFailed(() => round.fail());
        return this.command.runDepthDrag(document, round);
    }
}

@command({ key: "feature.extrude", icon: "icon-prism" })
export class ExtrudeFeatureCommand extends MultistepCommand implements PickSettledCommand {
    /**
     * Set by the command that opens this one (Press Pull) when its own pick and confirm already
     * answered this command's. The profile step reads the selection by itself, but the DEPTH comes
     * from the hand-off — Press Pull's drag is the distance the prism should stand — so the depth
     * drag below is skipped for it. Without the flag that drag ran a second time for one gesture.
     */
    pickSettled = false;

    @property("option.command.operation", {
        combobox: Combobox.from([
            OPERATION_NEW,
            "option.command.operation.join",
            "option.command.operation.cut",
            "option.command.operation.intersect",
        ] satisfies I18nKeys[]),
    })
    get operation(): I18nKeys {
        return this.getPrivateValue("operation", OPERATION_NEW);
    }
    set operation(value: I18nKeys) {
        this.setProperty("operation", value);
        this.showTargets = value !== OPERATION_NEW;
        this._dragHandler?.refresh();
        this._endTargetStep?.refreshPreview();
    }

    /**
     * How the forward reach is determined (default blind — the prism stands `depth` tall).
     * The up-to conditions skip the depth drag and add a target pick as the last step;
     * the stored depth stays the fallback the feature builds with while an up-to target
     * is lost (and the box-detection stand-in — see `detectionDepth`).
     */
    @property("feature.extrude.endCondition", {
        combobox: Combobox.from([
            END_CONDITION_BLIND,
            END_CONDITION_THROUGH_ALL,
            END_CONDITION_UP_TO_FACE,
            END_CONDITION_UP_TO_VERTEX,
        ] satisfies I18nKeys[]),
    })
    get endCondition(): I18nKeys {
        return this.getPrivateValue("endCondition", END_CONDITION_BLIND);
    }
    set endCondition(value: I18nKeys) {
        this.setProperty("endCondition", value);
        this.showDepth = value === END_CONDITION_BLIND;
        this.showEndOffset = value === END_CONDITION_UP_TO_FACE || value === END_CONDITION_UP_TO_VERTEX;
        // The steps read the condition live as they run: switching TO an up-to condition
        // ends an in-flight depth drag on the spot (its depth no longer decides anything),
        // and any switch settles the target pick's current round so the step loops and
        // re-reads. Both are no-ops when no interaction is running them — `_dragHandler`
        // is only set while a drag is (step 2's, or the end-target step's in-place one),
        // and the pick keeps no settle hook off-round.
        if (value === END_CONDITION_UP_TO_FACE || value === END_CONDITION_UP_TO_VERTEX) {
            this._dragHandler?.finishEarly();
        }
        // The drag outlives a flip to/from through-all (it is the confirm affordance
        // there), and its preview depends on the condition — repaint it now rather than
        // waiting for the next pointer move.
        this._dragHandler?.refresh();
        this._endTargetStep?.settleForRepick();
    }

    /**
     * Which bodies the join/cut/intersect combines with. The set is the command's, and the
     * detection fills it while it is still on auto — see `applyAutoTargets`.
     */
    @property("option.command.targets", {
        type: "targets",
        dependencies: [{ property: "showTargets", value: true }],
    })
    get targets(): TargetSelection {
        return this.getPrivateValue("targets", AUTO_TARGETS);
    }
    set targets(value: TargetSelection) {
        this.setProperty("targets", value);
    }

    /** The list only means something once an operation gives the feature a body to combine with. */
    get showTargets(): boolean {
        return this.getPrivateValue("showTargets", this.operation !== OPERATION_NEW);
    }
    set showTargets(value: boolean) {
        this.setProperty("showTargets", value);
    }

    targetCandidates(): readonly TargetCandidate[] {
        return candidateBodies(this.document).map(targetCandidate);
    }

    setTargets(selection: TargetSelection): void {
        this.targets = selection;
        this._dragHandler?.refresh();
    }

    /**
     * The detection's write path. It goes around the setter because the write is a
     * consequence of the preview it happens inside, not a request for another one — but the
     * property event still goes out, and that is what redraws the checkbox list.
     */
    private applyAutoTargets(selection: TargetSelection): void {
        const previous = this.targets;
        this.setPrivateValue("targets", selection);
        this.emitPropertyChanged("targets", previous);
    }

    /** The bodies this run combines with, refreshing the auto set from the tool's box first. */
    private resolveTargets(box: BoundingBox | undefined): ParametricBodyNode[] {
        if (box !== undefined) {
            syncAutoTargets(this.document, box, this.targets, (next) => this.applyAutoTargets(next));
        }
        return resolveTargetBodies(this.document, box, this.targets);
    }

    private commitToTargets(
        feature: ExtrudeFeatureData,
        operation: BooleanOperation,
        box: BoundingBox | undefined,
    ): void {
        commitBooleanTargets(this.document, feature, operation, this.resolveTargets(box));
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        // The panel is up by now (the base publishes it) and its list is subscribed, so this
        // both starts the run on auto-detection and repaints the boxes. The option cache
        // restores this command's own last run too, so a set left over from it must not
        // decide this one. Its restored DEPTH is no gesture the user made in this run.
        this._depthGiven = false;
        this.targets = AUTO_TARGETS;
    }

    @property("option.command.symmetric")
    get symmetric() {
        return this.getPrivateValue("symmetric", false);
    }
    set symmetric(value: boolean) {
        this.setProperty("symmetric", value);
        this._dragHandler?.refresh();
        this._endTargetStep?.refreshPreview();
    }

    /**
     * Onshape's Opposite Direction: the sweep runs the other way. Always shown — it applies
     * to every end condition (an up-to/through-all measures along the flipped direction too).
     * Composes with the drag's own sign rather than replacing it: a backward drag with the
     * box checked sweeps forward again, and the commit stores the NET flip (see
     * `executeMainTask`). The drag's measurement axis stays the natural normal — the flip
     * lives in the sweep vectors, so toggling this mid-drag only re-runs the preview.
     */
    @property("option.command.oppositeDirection")
    get oppositeDirection(): boolean {
        return this.getPrivateValue("oppositeDirection", false);
    }
    set oppositeDirection(value: boolean) {
        this.setProperty("oppositeDirection", value);
        this._dragHandler?.refresh();
        this._endTargetStep?.refreshPreview();
    }

    @property("option.command.startOffset", { unit: LENGTH_UNITS })
    get startOffset(): ParameterValue {
        return this.getPrivateValue("startOffset", 0);
    }
    set startOffset(value: ParameterValue) {
        this.setProperty("startOffset", value);
        this._endTargetStep?.refreshPreview();
        // Without a live drag there is nothing to push the offset into, and nothing to
        // resolve against.
        if (!this._dragHandler) return;
        const resolved = this.resolveLength(value);
        if (resolved !== undefined) this._dragHandler.setStartOffset(resolved);
    }

    /**
     * Only blind asks for a depth. Through-all measures its own reach, and an up-to
     * condition takes it from the target — the stored depth stays a fallback the user
     * cannot act on there, so the row is hidden the way Fusion/Onshape hide it per end
     * condition. (`needsDepthDrag` still guards a depth-driven commit at zero; hiding the
     * row does not change what the feature builds.)
     */
    get showDepth(): boolean {
        return this.getPrivateValue("showDepth", this.endCondition === END_CONDITION_BLIND);
    }
    set showDepth(value: boolean) {
        this.setProperty("showDepth", value);
    }

    /** The end offset only means something to an up-to condition. */
    get showEndOffset(): boolean {
        return this.getPrivateValue("showEndOffset", this.upToCondition);
    }
    set showEndOffset(value: boolean) {
        this.setProperty("showEndOffset", value);
    }

    /** The up-to conditions take their depth from a picked target, replacing the depth drag. */
    private get upToCondition(): boolean {
        return (
            this.endCondition === END_CONDITION_UP_TO_FACE || this.endCondition === END_CONDITION_UP_TO_VERTEX
        );
    }

    /**
     * Offset applied to the depth an up-to condition computes (default 0): positive
     * overshoots the target along the sweep direction, negative stops short of it.
     */
    @property("feature.extrude.endOffset", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "showEndOffset", value: true }],
    })
    get endOffset(): ParameterValue {
        return this.getPrivateValue("endOffset", 0);
    }
    set endOffset(value: ParameterValue) {
        this.setProperty("endOffset", value);
        this._endTargetStep?.refreshPreview();
    }

    /**
     * Taper of the side faces in degrees about the start plane (0 = straight sides). A
     * positive angle narrows the prism toward its end — the mould-draft convention the
     * feature and the `draft` feature share. Applied to the preview as well, so the sides
     * move as the number is typed.
     */
    @property("feature.extrude.draftAngle", { unit: ANGLE_UNITS })
    get draftAngle(): ParameterValue {
        return this.getPrivateValue("draftAngle", 0);
    }
    set draftAngle(value: ParameterValue) {
        this.setProperty("draftAngle", value);
        this._dragHandler?.refresh();
        this._endTargetStep?.refreshPreview();
    }

    @property("option.command.depth", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "showDepth", value: true }],
    })
    get depth(): ParameterValue {
        return this.getPrivateValue("depth", 0);
    }
    set depth(value: ParameterValue) {
        this.setProperty("depth", value);
        // Typed in the panel (the drag's own writes are flagged) — the user's value.
        if (!this._syncingFromDrag) this._depthGiven = true;
        if (!this._dragHandler || this._syncingFromDrag) return;
        const resolved = this.resolveLength(value);
        if (resolved !== undefined) this._dragHandler.setValue(resolved);
    }

    /**
     * Whether the panel's depth came from the user THIS run — a drag gesture or a typed
     * value. A depth restored from the option cache is not: a measured condition that
     * skipped the gesture carries it invisibly, so flipping back to a depth-driven
     * condition must offer the arrows rather than commit on it.
     */
    get depthGiven(): boolean {
        return this._depthGiven;
    }

    /** A length field's numeric value, or undefined when its expression does not resolve. */
    private resolveLength(value: ParameterValue): number | undefined {
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The drag's own preview geometry: an unresolvable expression previews as zero. */
    private get depthValue(): number {
        return this.resolveLength(this.depth) ?? 0;
    }

    private get startOffsetValue(): number {
        return this.resolveLength(this.startOffset) ?? 0;
    }

    /**
     * The resolved taper in degrees; undefined (straight sides) when the expression does not
     * resolve or the angle is outside the kernel's domain. The feature rejects |angle| ≥ 90
     * with a report; the preview must not hand the same value to the kernel, whose refusal
     * would throw out of the panel's own change handler.
     */
    private get draftAngleValue(): number | undefined {
        const resolved = this.resolveParameter(this.draftAngle, ANGLE_UNITS);
        if (!resolved.isOk || Math.abs(resolved.value) >= 90) return undefined;
        return resolved.value;
    }

    private get endOffsetValue(): number {
        const resolved = this.resolveParameter(this.endOffset, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    private _dragHandler: ExtrudeDragHandler | undefined;
    private _syncingFromDrag = false;
    /** See `depthGiven`: the panel depth came from the user this run, not the option cache. */
    private _depthGiven = false;
    /**
     * The target step is one instance per command: the end-condition setter must reach the
     * in-flight pick to make it re-read the condition, and only the running step can.
     */
    private _endTargetStep: ExtrudeEndTargetStep | undefined;

    private get endTargetStep(): ExtrudeEndTargetStep {
        if (this._endTargetStep === undefined) {
            this._endTargetStep = new ExtrudeEndTargetStep(this);
        }
        return this._endTargetStep;
    }

    /**
     * Whether a depth-driven condition still lacks its depth: the panel value resolves to
     * ~0 — the drag was skipped (an up-to condition took the depth from its target,
     * leaving a zero placeholder) or `finishEarly` ended it before any gesture. The
     * end-target step re-runs the drag in place then, so a flip back to blind never
     * commits a silent zero. Through-all is not depth-driven at all: it always answers
     * false, since its reach is measured by the feature itself. A resolved non-zero depth
     * is the user's value (dragged or typed) and commits as-is; an expression that does
     * not resolve is left to the commit's own error path — the arrows never override it.
     */
    get needsDepthDrag(): boolean {
        // Through-all measures its own reach — there is no depth for the arrows to set,
        // so a zero in the panel (or a skipped drag) must not re-offer the gesture.
        if (this.endCondition === END_CONDITION_THROUGH_ALL) return false;
        const resolved = this.resolveLength(this.depth);
        return resolved !== undefined && Math.abs(resolved) < Precision.Float;
    }

    /**
     * The depth drag, run in place from the end-target step (a depth-driven condition
     * whose depth was never set — see `needsDepthDrag`). A fresh step without the skip
     * predicate — the drag always runs.
     */
    runDepthDrag(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        return new ExtrudeDragStep("prompt.dragToExtrude", this.getDragData).execute(document, controller);
    }

    /**
     * Replaces the drag step's result with the in-place drag's, so the commit reads the
     * real drag's plane, point, and faces. What it replaces is a stand-in for a depth the
     * user never set — the skip's zero-depth placeholder or a `finishEarly`'d drag's
     * result; the depth the new drag produced (possibly still zero, if `finishEarly`
     * ended this one too) is the panel's, and the next round's `needsDepthDrag` reads it.
     */
    replaceDragData(data: SnapResult): void {
        this.stepDatas[1] = data;
    }

    /** The drag step returns the final face set (it can change while dragging). */
    private get dragData() {
        return this.stepDatas[1];
    }

    private get sourceNode(): SketchNode | ParametricBodyNode {
        return this.dragData.nodes![0] as unknown as SketchNode | ParametricBodyNode;
    }

    /** Empty when the whole sketch is extruded. */
    private get pickedFaces(): IFace[] {
        return (this.dragData?.shapes ?? []).map((x) => x.shape as unknown as IFace);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectSketchProfilesStep(),
            // An up-to condition takes its depth from the picked target, so the depth drag is
            // skipped; the predicate reads the condition live, so a flip before the drag step runs
            // decides (a flip DURING it goes through `finishEarly`). A settled hand-off that
            // already brought a depth — Press Pull's drag — is skipped the same way: the drag it
            // replaced is the very distance the panel holds. A settled hand-off with NO depth (a
            // sketch picked as a whole node) still drags, since then nothing measured one.
            new ExtrudeDragStep(
                "prompt.dragToExtrude",
                this.getDragData,
                () => this.upToCondition || (this.pickSettled && !this.needsDepthDrag),
            ),
            this.endTargetStep,
        ];
    }

    private readonly getDragData = () => {
        const node = this.stepDatas[0].nodes![0] as unknown as SketchNode | ParametricBodyNode;
        const faces = this.stepDatas[0].shapes;
        // A body face extrudes along its own outward plane; a whole/partial sketch
        // along the sketch plane.
        const plane = node instanceof SketchNode ? node.plane : planeOfPickedFace(faces[0]);
        // The up-to conditions skip the drag, so the step stands this plane in as the drag
        // plane and the commit's target detection measures along it. Flip it with the sweep
        // direction, or a reversed target sits behind the placeholder and is never detected.
        // (The drag itself measures along the natural normal — see `oppositeDirection`.)
        const flipPlaceholder = this.oppositeDirection && this.upToCondition;
        return {
            node,
            faces,
            origin: plane.origin,
            normal: flipPlaceholder ? plane.normal.multiply(-1) : plane.normal,
            anchor: faces[0]?.point ?? plane.origin,
            depth: this.depthValue,
            startOffset: this.startOffsetValue,
            requiresDepth: () => this.endCondition !== END_CONDITION_THROUGH_ALL,
            buildPreview: this.buildPreview,
            onReady: (handler: ExtrudeDragHandler) => {
                this._dragHandler = handler;
            },
            onDone: () => {
                this._dragHandler = undefined;
            },
            onDist: (dist: number) => {
                this._syncingFromDrag = true;
                this.depth = dist;
                this._syncingFromDrag = false;
                // A real gesture: the user pulled the arrows off zero at least once.
                if (Math.abs(dist) > Precision.Float) this._depthGiven = true;
            },
        };
    };

    /**
     * Meshes the extruded prism as solid faces plus outline edges, previewing the final
     * body. The sweep, the draft taper and the merge are the feature's own `sweepFaces`,
     * so the preview matches the committed result. Symmetric extrusion previews both
     * directions. A join/cut/intersect operation
     * previews the boolean result against the intersecting target body, standing in for
     * that body's display for the duration of the drag.
     */
    private readonly buildPreview = (state: ExtrudeDragState): ExtrudePreview => {
        // A zero gesture draws nothing when the depth is what it edits; only through-all
        // measures its own reach (and still has a preview at zero).
        if (this.endCondition !== END_CONDITION_THROUGH_ALL && Math.abs(state.dist) < Precision.Float) {
            return { meshes: [] };
        }
        const owned: IFace[] = [];
        try {
            const faces = ExtrudeFeatureCommand.previewFaces(state, owned);
            if (faces === undefined) return { meshes: [] };
            const vecsOf = this.previewSweepVectors(state, faces);
            if (vecsOf === undefined) return { meshes: [] };
            const offsetOf = this.offsetVectorOf(state.node, state.normal);
            const merged = ExtrudeFeatureCommand.buildPrisms(faces, vecsOf, offsetOf, this.draftAngleValue);
            if (!merged.isOk) throw merged.error;
            return this.previewOperation(merged.value);
        } finally {
            owned.forEach((x) => x.dispose());
        }
    };

    /**
     * The preview's per-face sweep vectors. A sketch's profiles share its plane, so one
     * measured reach serves them all; a body's picked faces can lie on different planes,
     * and the feature measures each face's through-all reach from its OWN plane — so the
     * preview does too. Undefined when there is nothing to sweep.
     */
    private previewSweepVectors(
        state: ExtrudeDragState,
        faces: readonly IFace[],
    ): ((face: IFace) => XYZ[]) | undefined {
        if (this.endCondition !== END_CONDITION_THROUGH_ALL || state.node instanceof SketchNode) {
            const dist = this.previewDistance(state, faces);
            if (Math.abs(dist) < Precision.Float) return undefined;
            return this.sweepVectorsOf(state.node, state.normal, dist);
        }
        const vectors = new Map<IFace, XYZ[]>();
        let any = false;
        // One walk of the model tree for the whole face set, not one per face.
        const bodies = candidateBodies(this.document);
        for (const face of faces) {
            const vecs = this.throughAllFaceVectors(face, state.dist, bodies);
            if (vecs.some((vec) => vec.length() >= Precision.Float)) any = true;
            vectors.set(face, vecs);
        }
        return any ? (face) => vectors.get(face) ?? [] : undefined;
    }

    /**
     * One face's through-all sweep vector, measured from the face's own plane along its
     * own normal — the reach the feature's rebuild measures for that face. `dist` only
     * supplies the gesture's direction and the fallback magnitude.
     */
    private throughAllFaceVectors(
        face: IFace,
        dist: number,
        bodies: ParametricBodyNode[] = candidateBodies(this.document),
    ): XYZ[] {
        // The XOR, not the sign of `-dist`: at a zero gesture (`-0 < 0` is false) the
        // opposite-direction checkbox would otherwise be swallowed, and the preview
        // would point the wrong way while the rebuild sweeps the other side.
        const sweepSign = this.oppositeDirection !== dist < 0 ? -1 : 1;
        const [point, normal] = face.normal(0, 0);
        const reach = this.throughAllReach(
            point,
            normal.multiply(sweepSign),
            () => [face],
            sweepSign * this.startOffsetValue,
            bodies,
        );
        const vec = normal.multiply(sweepSign * (reach ?? Math.abs(dist)));
        return this.symmetric ? [vec, vec.multiply(-1)] : [vec];
    }

    /**
     * The distance the preview sweeps with: the drag's own, except under through-all,
     * which is measured rather than dragged — the preview reaches past the bodies in the
     * sweep's path so it matches what the commit builds. The sign still comes from the
     * gesture (and the direction checkbox acts through `sweepVectorsOf` as usual), so a
     * backward drag previews the backward reach. `sweepSign` is the direction the prism's
     * own sweep vectors end up using, so the start offset is signed the same way the
     * feature signs `sweepStartOffset`.
     */
    private previewDistance(state: ExtrudeDragState, faces: readonly IShape[]): number {
        if (this.endCondition !== END_CONDITION_THROUGH_ALL) return state.dist;
        const sweepSign = this.oppositeDirection !== state.dist < 0 ? -1 : 1;
        const startOffset = sweepSign * this.startOffsetValue;
        const reach = this.throughAllReach(
            state.origin,
            state.normal.multiply(sweepSign),
            () => faces,
            startOffset,
        );
        if (reach === undefined) return state.dist;
        return (state.dist < 0 ? -1 : 1) * reach;
    }

    /**
     * How far past the bodies the through-all sweep reaches, along `dir` from `origin`.
     * Each body in the sweep's path answers for itself (`throughAllDepth` measures its own
     * box, with the signed start offset), and the farthest one wins; undefined when no body
     * lies ahead on that side. A body that is merely farther along `dir` but outside the
     * column the profiles sweep is NOT in the path — measuring it would stretch the preview
     * (and the tool box) past what the commit builds.
     */
    private throughAllReach(
        origin: XYZ,
        dir: XYZ,
        columnFaces: () => readonly IShape[],
        sweepStartOffset: number,
        bodies: ParametricBodyNode[] = candidateBodies(this.document),
    ): number | undefined {
        if (bodies.length === 0) return undefined;
        // Built only now: resolving a sketch's profiles can be the expensive part, and a
        // document with no body has no reach to measure.
        const column = ExtrudeFeatureCommand.sweepColumnBox(columnFaces());
        let reach: number | undefined;
        for (const body of bodies) {
            const shape = body.shape;
            if (!shape.isOk) continue;
            if (column !== undefined) {
                const box = BoundingBox.transformed(shape.value.boundingBox(), body.worldTransform());
                if (!ExtrudeFeatureCommand.overlapsSweepColumn(column, box, dir)) continue;
            }
            const depth = throughAllDepth(
                shape.value,
                body.worldTransform(),
                origin,
                dir,
                sweepStartOffset,
                "Extrude",
            );
            if (!depth.isOk) continue;
            reach = Math.max(reach ?? 0, depth.value);
        }
        return reach;
    }

    /** The world-space box the profiles occupy — the lateral extent of the sweep column. */
    private static sweepColumnBox(faces: readonly IShape[]): BoundingBox | undefined {
        const points: XYZLike[] = [];
        for (const face of faces) {
            const box = face.boundingBox();
            if (!BoundingBox.isValid(box)) continue;
            for (let i = 0; i < 8; i++) {
                points.push({
                    x: i & 1 ? box.max.x : box.min.x,
                    y: i & 2 ? box.max.y : box.min.y,
                    z: i & 4 ? box.max.z : box.min.z,
                });
            }
        }
        return points.length === 0 ? undefined : BoundingBox.fromPoints(points);
    }

    /**
     * Whether `box` overlaps `column` in the plane perpendicular to `dir` — i.e. whether it
     * sits in the sweep's path rather than off to one side. Both boxes are world AABBs, so
     * the two projections are intervals taken over the eight corners.
     */
    private static overlapsSweepColumn(column: BoundingBox, box: BoundingBox, dir: XYZ): boolean {
        const helper = Math.abs(dir.z) > 0.9 ? XYZ.unitX : XYZ.unitZ;
        const u = dir.cross(helper).normalize();
        if (u === undefined) return true;
        const v = dir.cross(u).normalize();
        if (v === undefined) return true;
        return (
            ExtrudeFeatureCommand.projectionOverlaps(column, box, u) &&
            ExtrudeFeatureCommand.projectionOverlaps(column, box, v)
        );
    }

    private static projectionOverlaps(a: BoundingBox, b: BoundingBox, axis: XYZ): boolean {
        const range = (box: BoundingBox) => {
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < 8; i++) {
                const d = axis.dot({
                    x: i & 1 ? box.max.x : box.min.x,
                    y: i & 2 ? box.max.y : box.min.y,
                    z: i & 4 ? box.max.z : box.min.z,
                });
                min = Math.min(min, d);
                max = Math.max(max, d);
            }
            return [min, max] as const;
        };
        const [aMin, aMax] = range(a);
        const [bMin, bMax] = range(b);
        return aMin <= bMax && bMin <= aMax;
    }

    /** The profiles the feature will sweep, as the profile step reported them. */
    get pickedProfileShapes(): readonly VisualShapeData[] {
        return this.dragData?.shapes ?? [];
    }

    /**
     * The prism an up-to target would make, in WORLD coordinates — the live preview shown
     * while the target pick is open. The prism ALONE, deliberately: a boolean result stands
     * in for (hides) the body it rewrites, and the body is the very thing the pointer is
     * still aiming at. The reach is the feature's own (`upToTargetDepth`), including the
     * start offset and the end offset, so the preview ends where the commit will.
     */
    upToTargetPreview(target: VisualShapeData): ExtrudePreview | undefined {
        const owned: IShape[] = [];
        try {
            // The drag's final faces and node when it ran (it can switch target mid-
            // gesture); otherwise the profile step's picks, which the skip placeholder
            // carries. Deriving the plane from those faces — not from the placeholder
            // normal, which is already flipped under the direction checkbox — gives the
            // profile plane's own normal in both cases.
            const data = this.getDragData();
            const drag = this.dragData;
            const node = (drag?.nodes?.[0] as unknown as SketchNode | ParametricBodyNode) ?? data.node;
            const picked = drag?.shapes?.length ? drag.shapes : data.faces;
            const plane = node instanceof SketchNode ? node.plane : planeOfPickedFace(picked[0]);
            const natural = plane.normal;
            const world = worldShape(target.shape as unknown as IFace | IVertex, target.transform, owned);
            // The up-to commit's direction is the checkbox alone (the hidden depth's sign
            // is a leftover, see `executeMainTask`).
            const dir = this.oppositeDirection ? natural.multiply(-1) : natural;
            const startOffset = this.oppositeDirection ? -this.startOffsetValue : this.startOffsetValue;
            const depth = upToTargetDepth(
                world,
                plane.origin,
                natural,
                dir,
                startOffset,
                this.endOffsetValue,
            );
            if (!depth.isOk || depth.value <= Precision.Float) return undefined;

            const state: ExtrudeDragState = {
                node,
                faces: picked,
                origin: plane.origin,
                normal: natural,
                anchor: picked[0]?.point ?? plane.origin,
                dist: depth.value,
                startOffset: this.startOffsetValue,
            };
            const faces = ExtrudeFeatureCommand.previewFaces(state, owned);
            if (faces === undefined) return undefined;
            const vecsOf = this.sweepVectorsOf(state.node, state.normal, depth.value);
            const offsetOf = this.offsetVectorOf(state.node, state.normal);
            const built = ExtrudeFeatureCommand.buildPrisms(faces, vecsOf, offsetOf, this.draftAngleValue);
            if (!built.isOk) return undefined;
            const preview = ExtrudeFeatureCommand.prismPreview(built.value);
            // A cut's ghost is what the commit REMOVES — red, like the drag preview's.
            if (FORM_FEATURE_OPERATIONS[this.operation] === "cut") {
                for (const mesh of preview.meshes) mesh.color = CUT_TOOL_COLOR;
            }
            return preview;
        } catch {
            // A preview that cannot be built is not an error — the pick goes on.
            return undefined;
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }

    /**
     * The prism on its own, or — when an operation is set and bodies are in the way — what
     * that operation makes of each of them, standing in for the bodies it rewrites. The
     * targets are the ones the commit appends the feature to, so the preview and the
     * committed bodies agree on what is being modified. A CUT also draws its tool prism as
     * a red ghost: the removed volume is empty space in the result and would otherwise be
     * invisible, and red says "this part goes away" the way a destructive preview should.
     */
    private previewOperation(prism: IShape): ExtrudePreview {
        const operation = FORM_FEATURE_OPERATIONS[this.operation];
        if (operation === undefined) return ExtrudeFeatureCommand.prismPreview(prism);

        const targets = this.resolveTargets(prism.boundingBox());
        if (targets.length === 0) return ExtrudeFeatureCommand.prismPreview(prism);

        // Meshed BEFORE the boolean consumes/disposes the prism; the arrays outlive it.
        const removed = operation === "cut" ? ExtrudeFeatureCommand.removedToolMeshes(prism) : undefined;
        const preview = buildTargetPreview(operation, prism, targets);
        prism.dispose();
        return {
            meshes: preview.meshes,
            hide: preview.hidden,
            ...(removed === undefined ? {} : { overlays: removed }),
        };
    }

    /** The prism's own mesh painted as "material to remove" — the cut tool's red ghost. */
    private static removedToolMeshes(prism: IShape): ShapeMeshData[] {
        const { faces, edges } = prism.mesh;
        const meshes: ShapeMeshData[] = [];
        if (faces !== undefined) meshes.push(faces);
        if (edges !== undefined) meshes.push(edges);
        for (const mesh of meshes) mesh.color = CUT_TOOL_COLOR;
        return meshes;
    }

    /** The prism's own mesh — what the drag shows when there is no boolean to show. */
    private static prismPreview(prism: IShape): ExtrudePreview {
        const { faces, edges } = prism.mesh;
        prism.dispose();
        if (faces === undefined) throw new Error("Failed to mesh the extrude preview");
        return { meshes: edges === undefined ? [faces] : [faces, edges] };
    }

    /** Faces to preview: the picked faces in world coordinates, or the whole sketch's outer profiles. */
    private static previewFaces(state: ExtrudeDragState, owned: IShape[]): IFace[] | undefined {
        if (state.faces.length > 0) return state.faces.map((x) => ExtrudeFeatureCommand.worldFace(x, owned));
        if (!(state.node instanceof SketchNode)) return undefined;
        const profiles = sketchProfiles(state.node);
        return profiles.isOk ? profiles.value.outer : undefined;
    }

    /**
     * Sweep vectors per face: sketch profiles share the drag plane normal; body faces
     * sweep along their own outward normal, matching the feature's evaluation.
     * Symmetric extrusion sweeps both directions. The opposite-direction checkbox
     * negates the sweep — composing with the drag's own sign, never replacing it: a
     * backward drag with the box checked sweeps forward again, which is the net flip
     * the commit stores as `reverse` (see `executeMainTask`).
     */
    private sweepVectorsOf(node: INode, normal: XYZ, dist: number): (face: IFace) => XYZ[] {
        const signedDist = this.oppositeDirection ? -dist : dist;
        const bothWays = (vec: XYZ) => (this.symmetric ? [vec, vec.multiply(-1)] : [vec]);
        return node instanceof SketchNode
            ? () => bothWays(normal.multiply(signedDist))
            : (face) => bothWays(face.normal(0, 0)[1].multiply(signedDist));
    }

    /**
     * Start-offset vector per face: sketch profiles share the drag plane normal;
     * body faces offset along their own outward normal, matching `sweepVectorsOf`.
     */
    private offsetVectorOf(node: INode, normal: XYZ): (face: IFace) => XYZ {
        return node instanceof SketchNode
            ? () => normal.multiply(this.startOffsetValue)
            : (face) => face.normal(0, 0)[1].multiply(this.startOffsetValue);
    }

    /** A picked face in world coordinates (see the shared `worldShape`). */
    static worldFace(data: VisualShapeData, owned: IShape[]): IFace {
        return worldShape(data.shape as unknown as IFace, data.transform, owned);
    }

    /**
     * The prism dragging `picked` by `distance` would make, in WORLD coordinates — the same fused
     * prism the feature is built from, so a preview equals the solid the hand-off commits.
     *
     * The reading is the DRAG's own: one blind prism along the profiles' normal. What the Extrude
     * command was last told (a join, a symmetric sweep, a start offset) belongs to its panel and
     * applies when the drag is handed over to it — the same limit the offset preview beside this
     * one has, and a far smaller one than showing nothing at all, which is what a drag on a profile
     * used to show (an offset of a lone face is not a solid to move).
     */
    static extrudePreview(picked: readonly VisualShapeData[], distance: number): IShape | undefined {
        if (Math.abs(distance) < Precision.Float || picked.length === 0) return undefined;
        const owned: IShape[] = [];
        try {
            const faces = picked.map((x) => ExtrudeFeatureCommand.worldFace(x, owned));
            const merged = ExtrudeFeatureCommand.buildPrisms(
                faces,
                () => [faces[0].normal(0, 0)[1].multiply(distance)],
                () => XYZ.zero,
            );
            return merged.isOk ? merged.value : undefined;
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }

    /**
     * Builds the fused prism shared by the preview, the target detection and Press Pull's profile
     * preview (`extrudePreview`) — the very `sweepFaces` the feature evaluates with, so the
     * preview (draft included) is the solid the commit builds.
     */
    static buildPrisms(
        faces: IFace[],
        vecsOf: (face: IFace) => XYZ[],
        offsetOf: (face: IFace) => XYZ,
        draftAngle?: number,
    ): Result<IShape> {
        return sweepFaces(faces, vecsOf, offsetOf, draftAngle);
    }

    protected override executeMainTask(): void {
        const node = this.sourceNode;
        const plane = this.dragData.plane!;
        // The feature stores what the user typed (the relation); the geometry needs the
        // number it resolves to. An expression that no longer resolves — the variable was
        // deleted between typing and committing — refuses the commit instead of sweeping
        // a prism of zero height.
        const depthResult = this.resolveParameter(this.depth, LENGTH_UNITS);
        if (!depthResult.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", depthResult.error);
            return;
        }
        const depth = depthResult.value;
        // A blind extrude's depth IS the reach: a ~zero one sweeps a zero-height prism,
        // which the kernel does not reject — the body would stand empty. Refuse the
        // commit instead. The measured conditions keep their zero fallback: throughAll
        // infers its reach from the chain input, an up-to condition from its target.
        const condition = EXTRUDE_END_CONDITIONS[this.endCondition] ?? "blind";
        if (condition === "blind" && Math.abs(depth) < Precision.Float) {
            PubSub.default.pub("showToast", "error.default:{0}", "Blind extrude needs a non-zero depth");
            return;
        }
        // A negative depth is a direction, not a length: fold its sign into the flip. The
        // drag's sign and the opposite-direction checkbox are the two flips — both set is
        // no flip at all (a backward drag with the direction reversed sweeps forward). The
        // magnitude is what the feature stores, an expression keeping its text (negated).
        // A measured up-to condition has no depth gesture behind it (the row is hidden and
        // the value is a leftover / the lost-target fallback), so its sign must not decide
        // the direction: the checkbox alone does.
        const upTo = condition === "upToFace" || condition === "upToVertex";
        const reverse = upTo ? this.oppositeDirection : this.oppositeDirection !== depth < 0;
        const storedDepth: ParameterValue =
            depth >= 0 ? this.depth : typeof this.depth === "string" ? `-(${this.depth})` : -depth;

        // Body-face fingerprints are captured in world coordinates (see the feature's
        // `source` contract); sketch profiles keep their raw faces.
        const owned: IShape[] = [];
        try {
            const worldFaces = this.dragData.shapes.map((x) => ExtrudeFeatureCommand.worldFace(x, owned));
            const endTarget = this.captureEndTarget(owned);
            if (endTarget === undefined) {
                // The target step refuses an empty pick, so only a run driven around the
                // steps (a script, a test) can land here.
                PubSub.default.pub(
                    "showToast",
                    this.endCondition === END_CONDITION_UP_TO_FACE
                        ? "prompt.select.faces"
                        : "prompt.select.vertexes",
                );
                return;
            }
            const feature = this.buildFeature(node, storedDepth, worldFaces, endTarget, reverse);
            Transaction.execute(this.document, "excute feature.extrude", () => {
                this.commitFeature(
                    node,
                    feature,
                    this.detectionDepth(endTarget, plane, depth, condition, node, worldFaces),
                    // The node's own normal: `sweepVectorsOf` applies the flip itself, and
                    // a skipped drag's placeholder normal may already carry it (press-pull
                    // never reads this — it sweeps each face's outward normal).
                    node instanceof SketchNode ? node.plane.normal : plane.normal,
                    worldFaces,
                );
                if (node instanceof SketchNode) {
                    // The sketch is consumed by the feature; hide it. Same transaction,
                    // so undo restores the visibility together with the body.
                    node.visible = false;
                }
                this.document.visual.update();
            });
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }

    /**
     * The up-to target of the current end condition: the picked face/vertex as a world-space
     * fingerprint with its node's id — the feature's `endFace`/`endVertex` contract, where a
     * world capture doubles as the frozen fallback once the node is gone. Empty for
     * blind/throughAll, which carry no target; undefined when an up-to condition has no pick.
     */
    private captureEndTarget(owned: IShape[]): Pick<ExtrudeFeatureData, "endFace" | "endVertex"> | undefined {
        const condition = EXTRUDE_END_CONDITIONS[this.endCondition] ?? "blind";
        if (condition !== "upToFace" && condition !== "upToVertex") return {};
        const picked = this.stepDatas[2]?.shapes[0];
        const node = this.stepDatas[2]?.nodes?.[0];
        if (picked === undefined || node === undefined) return undefined;
        if (condition === "upToVertex") {
            const vertex = worldShape(picked.shape as unknown as IVertex, picked.transform, owned);
            return { endVertex: { nodeId: node.id, vertex: captureVertexRef(vertex) } };
        }
        const face = worldShape(picked.shape as unknown as IFace, picked.transform, owned);
        // The press-pull capture: a tracked body names the face by id so the end follows a
        // re-split by a later feature; any other node re-matches by fingerprint alone.
        const body = node instanceof ParametricBodyNode ? node : undefined;
        const faceId = body?.faceIdAt(picked.indexes[0]);
        return {
            endFace: {
                nodeId: node.id,
                profile: captureProfileRef(face, faceId, body?.faceIdIsShared(faceId), true),
            },
        };
    }

    /** The feature payload of the committed drag. */
    private buildFeature(
        node: SketchNode | ParametricBodyNode,
        depth: ParameterValue,
        worldFaces: IFace[],
        endTarget: Pick<ExtrudeFeatureData, "endFace" | "endVertex">,
        reverse: boolean,
    ): ExtrudeFeatureData {
        const endCondition = EXTRUDE_END_CONDITIONS[this.endCondition] ?? "blind";
        return {
            id: Id.generate(),
            type: "extrude",
            depth,
            // The net direction flip (checkbox XOR drag sign — the caller's arithmetic);
            // false is the feature's own default and stores nothing.
            ...(reverse ? { reverse: true } : {}),
            // Blind is the feature's own default — a blind commit stores none of the
            // end-condition fields.
            ...(endCondition !== "blind" ? { endCondition } : {}),
            ...endTarget,
            ...((endCondition === "upToFace" || endCondition === "upToVertex") && this.endOffset !== 0
                ? { endOffset: this.endOffset }
                : {}),
            ...(this.symmetric ? { symmetric: true } : {}),
            ...(this.startOffset !== 0 ? { startOffset: this.startOffset } : {}),
            // Straight sides are the feature's default (0); the taper stays a relation.
            ...(this.draftAngle !== 0 ? { draftAngle: this.draftAngle } : {}),
            ...(node instanceof SketchNode
                ? {
                      sketchId: node.id,
                      ...(this.pickedFaces.length > 0
                          ? { profiles: this.pickedFaces.map((face) => captureProfileRef(face)) }
                          : {}),
                  }
                : {
                      // Press-pull: pair each fingerprint with the picked face's tracked
                      // id so rebuilds re-match by identity, not geometry (a merged face
                      // re-splitting is indistinguishable by fingerprint alone). The
                      // splitPiece stamp records a pick of one piece of an already split
                      // face (id shared at capture time), so the sweep never widens back
                      // to the whole span (see `narrowToPickedPiece` in sourceFaceMatcher.ts).
                      source: {
                          nodeId: node.id,
                          profiles: worldFaces.map((face, index) => {
                              const faceId = node.faceIdAt(this.dragData.shapes[index].indexes[0]);
                              if (faceId === undefined) {
                                  reportSilentIdLoss(node, "face", "a press-pull face has no tracked id");
                              }
                              return captureProfileRef(face, faceId, node.faceIdIsShared(faceId), true);
                          }),
                      },
                  }),
        };
    }

    /**
     * The depth the commit's target detection sweeps its tool box with. Blind uses the
     * typed depth. An up-to condition skipped the drag, so the typed depth is usually
     * still 0 — and a zero-height prism's box meets nothing, which would leave a
     * cut/join standing alone as its own body instead of combining with the body the
     * target belongs to. The captured target's own reach stands in: the farthest
     * fingerprint sample along the sweep direction, measured from the drag plane (the
     * same "farthest wins" the feature's `upToDepth` measures with). Pure fingerprint
     * math — the capture already read the geometry. Through-all likewise measured its
     * reach from the bodies in its path (the typed depth stays its blind fallback), in
     * the sign `sweepVectorsOf` maps back onto the sweep direction. The typed depth
     * stays the fallback for a capture without samples or a target behind the start
     * plane (that one the rebuild reports; detection stays out of its way).
     */
    private detectionDepth(
        endTarget: Pick<ExtrudeFeatureData, "endFace" | "endVertex">,
        plane: Plane,
        fallback: number,
        condition: ExtrudeEndCondition,
        node: SketchNode | ParametricBodyNode,
        worldFaces: IFace[],
    ): number {
        if (condition === "throughAll") {
            // `sweepVectorsOf` applies the direction checkbox itself, so the reach is
            // expressed along the NATURAL normal with the sign that maps back to the
            // sweep the feature will use (checkbox XOR the drag's sign). The start offset
            // is signed along that same sweep, as the feature signs `sweepStartOffset`.
            const sweepSign = this.oppositeDirection !== fallback < 0 ? -1 : 1;
            const reach = this.throughAllReach(
                plane.origin,
                plane.normal.multiply(sweepSign),
                () => this.profileFaces(node, worldFaces) ?? [],
                sweepSign * this.startOffsetValue,
            );
            if (reach !== undefined) return (this.oppositeDirection ? -1 : 1) * sweepSign * reach;
        }
        const samples: XYZLike[] = [];
        if (endTarget.endVertex !== undefined) {
            samples.push(endTarget.endVertex.vertex.point);
        }
        if (endTarget.endFace !== undefined) {
            const profile = endTarget.endFace.profile;
            if (profile.center !== undefined) samples.push(profile.center);
            for (const edge of profile.edges) {
                // One stand-in point per edge fingerprint, picked as `refSamples` picks them.
                if (edge.kind === "line") samples.push(edge.start, edge.end);
                else if (edge.kind === "circle") samples.push(edge.center);
                else samples.push(edge.mid);
            }
        }
        if (samples.length === 0) return fallback;
        const reach = Math.max(...samples.map((p) => plane.normal.dot(new XYZ(p).sub(plane.origin))));
        return reach > Precision.Float ? reach : fallback;
    }

    /**
     * Join/cut/intersect: the feature is appended to every body the scope names and combines
     * with each one's shape (Fusion-style); without a body to combine with (or for "new")
     * the extrude becomes a standalone body.
     */
    private commitFeature(
        node: SketchNode | ParametricBodyNode,
        feature: ExtrudeFeatureData,
        depth: number,
        normal: XYZ,
        worldFaces: IFace[],
    ): void {
        const operation = FORM_FEATURE_OPERATIONS[this.operation];
        if (operation === undefined) {
            standaloneBody(this.document, feature);
            return;
        }
        this.commitToTargets(feature, operation, this.toolBox(node, depth, normal, worldFaces));
    }

    /**
     * The faces the feature sweeps, in world coordinates: the picked ones when there are
     * any, otherwise the whole sketch's outer profiles. Undefined when the sketch offers
     * none (or its shape failed), which is what `toolBox` reads as "no tool".
     */
    private profileFaces(node: SketchNode | ParametricBodyNode, worldFaces: IFace[]): IFace[] | undefined {
        if (worldFaces.length > 0 || !(node instanceof SketchNode)) return worldFaces;
        const profiles = sketchProfiles(node);
        return profiles.isOk ? profiles.value.outer : undefined;
    }

    /**
     * The prism's box, built only to be measured: the detection needs the tool's bounds, and
     * a tool that cannot be built at all leaves the feature standing on its own.
     */
    private toolBox(
        node: SketchNode | ParametricBodyNode,
        depth: number,
        normal: XYZ,
        worldFaces: IFace[],
    ): BoundingBox | undefined {
        const faces = this.profileFaces(node, worldFaces);
        if (faces === undefined || faces.length === 0) return undefined;
        // A body's faces can lie on different planes: through-all measures each from its
        // own, the way the feature rebuild will. The tree is walked once for all of them.
        const throughAllBody =
            this.endCondition === END_CONDITION_THROUGH_ALL && !(node instanceof SketchNode);
        const bodies = throughAllBody ? candidateBodies(this.document) : [];
        const vecsOf = throughAllBody
            ? (face: IFace) => this.throughAllFaceVectors(face, depth, bodies)
            : this.sweepVectorsOf(node, normal, depth);
        const built = ExtrudeFeatureCommand.buildPrisms(
            faces,
            vecsOf,
            this.offsetVectorOf(node, normal),
            this.draftAngleValue,
        );
        if (!built.isOk) return undefined;
        try {
            return built.value.boundingBox();
        } finally {
            built.value.dispose();
        }
    }
}
