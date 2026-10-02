// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    AUTO_TARGETS,
    type BoundingBox,
    Combobox,
    command,
    type I18nKeys,
    Id,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    MultistepCommand,
    property,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeNode,
    ShapeTypes,
    type SnapResult,
    type TargetCandidate,
    type TargetSelection,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { BooleanOperation, SweepFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { sketchProfiles } from "../features/profileBuilder";
import { captureProfileRef } from "../features/profileRef";
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
import { SelectSketchProfilesStep } from "./extrudeCommand";
import { PreviewVisual } from "./previewVisual";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/** Maps the command's operation dropdown values to boolean operations; new has none. */
const SWEEP_OPERATIONS: Record<string, BooleanOperation> = {
    "option.command.operation.join": "fuse",
    "option.command.operation.cut": "cut",
    "option.command.operation.intersect": "common",
};

/**
 * Creates a sweep feature: pick sketch profiles or planar faces of a parametric body
 * (step 1), then the path edges (step 2, multiple — they must connect into one wire).
 * The committed body replays the feature through `shapeFactory.sweep`; both the
 * profiles (body faces as world-coordinate fingerprints with their tracked ids — the
 * extrude command's `source` contract) and the path (fingerprinted edge references,
 * node-local) are live references, so editing either source moves the sweep.
 *
 * Join/cut/intersect appends the feature to the auto-detected intersecting body
 * (Fusion-style, see the extrude command); "new" creates a standalone body.
 */
@command({ key: "feature.sweep", icon: "icon-sweep" })
export class SweepFeatureCommand extends MultistepCommand {
    private readonly preview = new PreviewVisual();
    /** The whole sketch's profiles for this run, owned here (see `wholeSketchProfiles`). */
    private sketchProfileFaces: IFace[] | undefined;

    /**
     * Which bodies the join/cut/intersect combines with. The set is the command's, and the
     * detection refills it after every path edge while it is still on auto — see
     * `applyAutoTargets`.
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
        this.displayVisual();
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
    }

    @property("option.command.isRoundCorner")
    get isRoundCorner(): boolean {
        return this.getPrivateValue("isRoundCorner", false);
    }
    set isRoundCorner(value: boolean) {
        this.setProperty("isRoundCorner", value);
    }

    private get sourceNode(): SketchNode | ParametricBodyNode {
        return this.stepDatas[0].nodes![0] as unknown as SketchNode | ParametricBodyNode;
    }

    protected override getSteps(): IStep[] {
        return [new SelectSketchProfilesStep(), this.pathStep()];
    }

    /**
     * The path pick: one edge per click — `multiple: false` is what makes the picks arrive
     * one at a time, so each can be swept and shown before the next is asked for (see
     * `executeSteps`). The bar's confirm ends the list, since a single pick finishes on
     * click and would otherwise show no bar.
     */
    private pathStep(): IStep {
        return new SelectShapeStep(ShapeTypes.edge, "prompt.select.path", {
            multiple: false,
            keepSelection: false,
            highlightState: VisualStates.edgeHighlight,
            selectedState: VisualStates.edgeSelected,
            showConfirmControl: true,
        });
    }

    /**
     * The pick loop: the profiles in one pick, then the path edges one click at a time, with
     * the swept tool re-shown after each. A multi path pick would resolve once at the end
     * and leave nothing to preview in between, which is why the step is asked for one edge
     * at a time; the picks accumulate into `stepDatas[1]` so the feature still sees the
     * whole path at once.
     */
    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        const profile = await this.runStep(steps[0]);
        if (profile === undefined) return false;

        const path: SnapResult = { view: profile.view, type: "shape", shapes: [] };
        this.stepDatas.push(profile, path);
        try {
            while (true) {
                const picked = await this.runStep(steps[1]);
                if (picked === undefined) {
                    // The bar's confirm reports success with nothing under the cursor; a
                    // cancel reports cancel. Either way the list is over — but a sweep
                    // with no path at all has nothing to commit.
                    return path.shapes.length > 0 && this.controller?.result?.status === "success";
                }
                path.shapes.push(...picked.shapes);
                this.displayVisual();
            }
        } finally {
            // The preview belongs to the picking, whichever way the picking ended — a
            // commit, a cancel, or a restart into a fresh run.
            this.preview.hide(this.document);
            if (!this._isRestarting) this.document?.selection.clearSelection();
        }
    }

    private async runStep(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        return step.execute(this.document, this.controller);
    }

    /** The preview so far, refreshed after every path pick. */
    private displayVisual(): void {
        const preview = this.buildPreview();
        if (!preview.isOk) {
            // A path that cannot be swept yet simply has no preview — the feature fails
            // loudly enough when the body replays it.
            this.preview.show(this.document, []);
            return;
        }
        try {
            this.preview.show(this.document, preview.value.meshes, preview.value.hidden);
        } finally {
            preview.value.shape.dispose();
        }
    }

    /**
     * What the viewport shows while picking: the swept tool, or — when an operation is set
     * and bodies are in the way — what that operation makes of each of them, standing in for
     * the bodies it rewrites (the extrude drag's contract). The committed bodies run the same
     * boolean in their own space (`sweep.ts`); a rigid transform commutes with it, so this
     * world-space copy is the same geometry.
     */
    private buildPreview(): Result<{
        shape: IShape;
        meshes: ShapeMeshData[];
        hidden: ParametricBodyNode[];
    }> {
        const tool = this.buildToolShape();
        if (!tool.isOk) return Result.err(tool.error);

        const operation = SWEEP_OPERATIONS[this.operation];
        const targets = operation === undefined ? [] : this.resolveTargets(tool.value.boundingBox());
        if (operation === undefined || targets.length === 0) {
            const faces = tool.value.mesh.faces;
            return Result.ok({ shape: tool.value, meshes: faces === undefined ? [] : [faces], hidden: [] });
        }
        return Result.ok({ shape: tool.value, ...buildTargetPreview(operation, tool.value, targets) });
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        // The panel is up by now (the base publishes it) and its list is subscribed, so this
        // both starts the run on auto-detection and repaints the boxes. The option cache keys
        // on the property name alone, so a set left over from an earlier run must not decide
        // this one.
        this.targets = AUTO_TARGETS;
    }

    protected override afterExecute(): void {
        // The whole-sketch profiles were built for this run; the next one builds its own.
        for (const face of this.sketchProfileFaces ?? []) {
            face.dispose();
        }
        this.sketchProfileFaces = undefined;
        super.afterExecute();
    }

    protected override executeMainTask(): void {
        const node = this.sourceNode;
        const feature = this.buildFeature();
        const operation = SWEEP_OPERATIONS[this.operation];
        const targets = operation === undefined ? [] : this.resolveTargets(this.toolBox());
        Transaction.execute(this.document, "execute feature.sweep", () => {
            if (operation === undefined) standaloneBody(this.document, feature);
            else commitBooleanTargets(this.document, feature, operation, targets);
            // A sketch is consumed by the feature; hide it. Same transaction, so undo
            // restores the visibility together with the body. A source body and the
            // path source stay visible — editing them re-matches and moves the sweep.
            if (node instanceof SketchNode) node.visible = false;
            this.document.visual.update();
        });
    }

    private buildFeature(): SweepFeatureData {
        const node = this.sourceNode;
        const base = {
            id: Id.generate(),
            type: "sweep" as const,
            isRoundCorner: this.isRoundCorner,
            path: this.pathRef(),
        };
        if (node instanceof SketchNode) {
            // Picked profile faces are fingerprinted (undefined sweeps the whole sketch).
            const faces = this.stepDatas[0].shapes.map((x) => x.shape as unknown as IFace);
            return {
                ...base,
                sketchId: node.id,
                ...(faces.length > 0 ? { profiles: faces.map((face) => captureProfileRef(face)) } : {}),
            };
        }
        // Body faces: fingerprinted in world coordinates and paired with the picked
        // face's tracked id, so rebuilds re-match by identity, not geometry (the
        // extrude command's press-pull contract).
        const owned: IFace[] = [];
        try {
            const profiles = this.stepDatas[0].shapes.map((data) => {
                const face = worldShape(data.shape as unknown as IFace, data.transform, owned);
                const faceId = node.faceIdAt(data.indexes[0]);
                if (faceId === undefined) {
                    reportSilentIdLoss(node, "face", "a sweep profile face has no tracked id");
                }
                return captureProfileRef(face, faceId, node.faceIdIsShared(faceId), true);
            });
            return { ...base, source: { nodeId: node.id, profiles } };
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }

    /**
     * The path as fingerprinted edge references (node-local coords), so it follows the
     * source node on rebuild. Only edges of the first picked edge's node are kept — a
     * path is one wire on one node.
     */
    private pathRef(): { nodeId: string; edges: EdgeRef[] } {
        const shapes = this.stepDatas[1].shapes;
        const node = shapes[0].owner.node as ShapeNode;
        const edges = shapes
            .filter((data) => data.owner.node === node)
            .map((data) => {
                const tracked = isBodyTrackingNode(node) ? node : undefined;
                const edgeId = tracked?.edgeIdAt(data.indexes[0]);
                const splitPiece =
                    node instanceof ParametricBodyNode ? node.edgeIdIsShared(edgeId) : undefined;
                return captureEdgeRef(data.shape as unknown as IEdge, edgeId, splitPiece);
            });
        return { nodeId: node.id, edges };
    }

    /**
     * The swept tool's box, built only to be measured: the detection needs the tool's bounds,
     * and a tool that cannot be built at all leaves the feature standing on its own.
     */
    private toolBox(): BoundingBox | undefined {
        const built = this.buildToolShape();
        if (!built.isOk) return undefined;
        try {
            return built.value.boundingBox();
        } finally {
            built.value.dispose();
        }
    }

    /**
     * The whole sketch's outer profiles — built once per run rather than once per pick.
     * `sketchProfiles` makes fresh faces on every call, and the preview asks for the tool
     * again after each path edge; they are freed with the run (see `afterExecute`).
     */
    private wholeSketchProfiles(): Result<IFace[]> {
        if (this.sketchProfileFaces !== undefined) return Result.ok(this.sketchProfileFaces);

        const node = this.sourceNode;
        if (!(node instanceof SketchNode)) return Result.err("Sweep has no profile");
        const profiles = sketchProfiles(node);
        if (!profiles.isOk) return Result.err(profiles.error);
        this.sketchProfileFaces = profiles.value.outer;
        return Result.ok(this.sketchProfileFaces);
    }

    /**
     * The swept tool in world coordinates — the picked profile faces (or the whole
     * sketch's outer profiles) along the picked path. The feature rebuilds the same
     * geometry from the stored refs; this is the live preview and the interference probe.
     */
    private buildToolShape(): Result<IShape> {
        const owned: IShape[] = [];
        const mapShape = <T extends IShape>(data: VisualShapeData): T =>
            worldShape(data.shape as unknown as T, data.transform, owned);
        try {
            let faces = this.stepDatas[0].shapes.map((data) => mapShape<IFace>(data));
            if (faces.length === 0) {
                // Only a whole-sketch pick arrives with no shapes; a body pick always
                // carries its faces.
                const profiles = this.wholeSketchProfiles();
                if (!profiles.isOk) return Result.err(profiles.error);
                faces = profiles.value;
            }
            const pathDatas = this.stepDatas[1].shapes;
            if (pathDatas.length === 0) return Result.err("Sweep has no path");
            const node = pathDatas[0].owner.node;
            const edges = pathDatas
                .filter((data) => data.owner.node === node)
                .map((data) => mapShape<IEdge>(data));
            const wire = shapeFactory.wire(edges);
            if (!wire.isOk) return Result.err(wire.error);
            owned.push(wire.value);
            return shapeFactory.sweep(faces, wire.value, this.isRoundCorner);
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }
}
