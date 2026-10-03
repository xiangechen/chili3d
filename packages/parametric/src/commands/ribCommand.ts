// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AUTO_TARGETS,
    BoundingBox,
    Combobox,
    command,
    Id,
    type INode,
    type IShape,
    type IStep,
    LENGTH_UNITS,
    Matrix4,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    type Result,
    SelectShapeStep,
    ShapeTypes,
    type TargetCandidate,
    type TargetSelection,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { RibFeatureData } from "../features/feature";
import { type RibParams, ribTool } from "../features/rib";
import { ParametricBodyNode } from "../parametricBodyNode";
import { shapeEntityIds } from "../sketch/sketchModel";
import { SketchNode } from "../sketch/sketchNode";
import { buildTargetPreview } from "./booleanPreview";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    syncAutoTargets,
    targetCandidate,
} from "./booleanTargets";
import { FORM_FEATURE_OPERATIONS } from "./extrudeCommand";

const OPERATION_JOIN = "option.command.operation.join";
const NO_EXTEND_TARGET = "Select the body to extend the profile to";
const INVALID_PARAMS = "Invalid rib parameters";

/**
 * What `plan()` works out: the rib, where it goes, and the parameters behind both — or the reason
 * there is no rib to show. A failure carries its reason rather than being an absence, because the
 * preview and the commit report it in different places.
 */
type Planned =
    | {
          readonly ok: true;
          readonly tool: IShape;
          readonly targets: ParametricBodyNode[];
          readonly params: RibParams;
      }
    | { readonly ok: false; readonly reason: string };

/**
 * Rib (SolidWorks' and Onshape's): a thin fin standing on an open sketch polyline, filling the
 * corner that polyline is drawn across and merging into the body it lands on.
 *
 * One pick, like `sweepCommand.ts`'s path — the chain is a run of sketch edges, and the feature
 * names them by the sketch's own entity ids rather than by fingerprint, so the pick is the whole
 * reference. The target body is NOT picked: a rib's whole point is the body it stiffens, and the
 * one it is drawn across is unambiguous, so the command detects it from the CHAIN's bounds (the
 * body has to be chosen before any geometry exists — see `plan`). There is deliberately no "New
 * Body" operation — a rib with no body to join is not a rib, and the commit refuses rather than
 * standing one up.
 */
@command({ key: "feature.rib", icon: "icon-rib" })
export class RibFeatureCommand extends MultistepCommand {
    @property("option.command.operation", {
        combobox: Combobox.from([
            OPERATION_JOIN,
            "option.command.operation.cut",
            "option.command.operation.intersect",
        ]),
    })
    get operation(): string {
        return this.getPrivateValue("operation", OPERATION_JOIN);
    }
    set operation(value: string) {
        this.setProperty("operation", value);
        this.updatePreview();
    }

    @property("option.command.thickness", { unit: LENGTH_UNITS })
    get thickness(): ParameterValue {
        return this.getPrivateValue("thickness", 2);
    }
    set thickness(value: ParameterValue) {
        this.setProperty("thickness", value);
        this.updatePreview();
    }

    /**
     * Onshape's Parts field, and the one place it differs from a thicken's: a rib reaches for the
     * body its extensions aim at, so naming a part here is what makes an extension possible for a
     * chain drawn clear of every body — the case the whole option exists for, and one no
     * bounding-box detection can find.
     */
    @property("option.command.targets", { type: "targets" })
    get targets(): TargetSelection {
        return this.getPrivateValue("targets", AUTO_TARGETS);
    }
    set targets(value: TargetSelection) {
        this.setProperty("targets", value);
        this.updatePreview();
    }

    /**
     * The detection's write path. It goes around the setter because the write is a consequence of
     * the preview it happens inside, not a request for another one — but the property event still
     * goes out, and that is what redraws the checkbox list.
     */
    private applyAutoTargets(selection: TargetSelection): void {
        const previous = this.targets;
        this.setPrivateValue("targets", selection);
        this.emitPropertyChanged("targets", previous);
    }

    targetCandidates(): readonly TargetCandidate[] {
        return candidateBodies(this.document).map(targetCandidate);
    }

    setTargets(selection: TargetSelection): void {
        this.targets = selection;
    }

    @property("option.command.extend")
    get extend(): boolean {
        return this.getPrivateValue("extend", false);
    }
    set extend(value: boolean) {
        this.setProperty("extend", value);
        this.updatePreview();
    }

    // ------------------------------------------------------------------ Preview

    private previewId: number | undefined;
    private previewHidden: INode[] = [];
    private ownedPreviewShapes: IShape[] = [];

    protected override async executeAsync(): Promise<void> {
        this.document.selection.onShapeChanged.sub(this.updatePreview);
        try {
            await super.executeAsync();
        } finally {
            this.document.selection.onShapeChanged.remove(this.updatePreview);
            this.removePreview();
        }
    }

    /**
     * The rib as the commit would build it, combined with the bodies it crosses — built by
     * `ribTool`, the very function the feature's rebuild calls, so the preview cannot promise
     * geometry the rebuild will not make.
     */
    protected readonly updatePreview = () => {
        this.removePreview();
        const planned = this.plan();
        if (!planned.ok) return;
        const { tool } = planned;

        const preview = buildTargetPreview(FORM_FEATURE_OPERATIONS[this.operation], tool, planned.targets);
        this.hide(preview.hidden);
        tool.dispose();
        if (preview.meshes.length === 0) return;
        this.previewId = this.document.visual.context.displayMesh(preview.meshes, { meshOpacity: 1 });
        this.document.visual.update();
    };

    /**
     * Takes the bodies the commit will rewrite off screen, so the preview reads as the result
     * rather than as a second copy stacked on the original — the same treatment the drag preview
     * gives its targets.
     */
    private hide(targets: readonly INode[]): void {
        this.previewHidden = [...targets];
        for (const target of this.previewHidden) {
            this.document.visual.context.setVisible(target, false);
        }
    }

    /**
     * The rib the commit will make, the bodies it goes onto, and the parameters behind both — the
     * ONE path the preview and the commit share, so neither can promise geometry the other will
     * not build. A failure comes back as the reason it failed, since the two report it in
     * different places and neither may invent a rib to draw instead.
     *
     * The order is forced. A rib's extent is read off the body (`sweepRange`), so the body has to
     * be chosen before any geometry exists — detecting it from the tool's box would be circular.
     * The chain's own box is what the detection measures against instead.
     */
    private plan(): Planned {
        const chain = this.pickedChain();
        const params = this.params();
        if (chain === undefined || params === undefined) return { ok: false, reason: INVALID_PARAMS };
        this.disposeOwned();

        const box = this.chainBox();
        if (box !== undefined) {
            // The detection's write path, on every preview: the Parts row is drawn once, when the
            // command starts, and knows nothing about the bodies this pick turns out to cross —
            // it reads the set back off this property (see `newTargets` in the UI).
            syncAutoTargets(this.document, box, this.targets, (next) => this.applyAutoTargets(next));
        }
        const targets = resolveTargetBodies(this.document, box, this.targets);
        if (targets.length === 0) {
            return { ok: false, reason: this.extend ? NO_EXTEND_TARGET : "The rib does not reach a body" };
        }
        const body = this.targetInWorld(targets[0]);
        if (body === undefined) return { ok: false, reason: INVALID_PARAMS };

        const built = ribTool(chain.sketch, chain.entityIds, params, body);
        if (!built.isOk) return { ok: false, reason: built.error };
        return { ok: true, tool: built.value.shape, targets, params };
    }

    /** The picked chain's box — what the target detection measures against (see `plan`). */
    private chainBox(): BoundingBox | undefined {
        const boxes = this.pickedEdges().map((data) => data.shape.boundingBox());
        return boxes.length === 0 ? undefined : boxes.reduce((a, b) => BoundingBox.combine(a, b)!);
    }

    /** A target body in world coordinates — the space the chain, and so its section, lives in. */
    private targetInWorld(node: INode): IShape | undefined {
        if (!(node instanceof ParametricBodyNode) || !node.shape.isOk) return undefined;
        const transform = node.worldTransform();
        if (transform.equals(Matrix4.identity())) return node.shape.value;
        const mapped = node.shape.value.transformedMul(transform);
        this.ownedPreviewShapes.push(mapped);
        return mapped;
    }

    private disposeOwned(): void {
        this.ownedPreviewShapes.forEach((shape) => {
            shape.dispose();
        });
        this.ownedPreviewShapes = [];
    }

    private removePreview() {
        // Back to what each node's own flags say, not to visible: a hidden body can still be the
        // preview's target.
        for (const node of this.previewHidden) {
            this.document.visual.context.setVisible(node, node.visible && node.parentVisible);
        }
        this.previewHidden = [];
        if (this.previewId !== undefined) {
            this.document.visual.context.removeMesh(this.previewId);
            this.previewId = undefined;
        }
        this.disposeOwned();
    }

    // ------------------------------------------------------------------ Commit

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.ribChain", {
                multiple: true,
                keepSelection: false,
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
                showConfirmControl: true,
                // The chain is sketch geometry by definition: a body edge is not something the
                // sketch's own entity ids could ever name.
                nodeFilter: { allow: (node: INode) => node instanceof SketchNode },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const chain = this.pickedChain();
        const planned = this.plan();
        if (chain === undefined || !planned.ok) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                planned.ok ? INVALID_PARAMS : planned.reason,
            );
            return;
        }

        const operation = FORM_FEATURE_OPERATIONS[this.operation];
        try {
            const feature = this.feature(chain, planned.params);
            Transaction.execute(this.document, "excute feature.rib", () => {
                commitBooleanTargets(this.document, feature, operation, planned.targets);
                this.document.visual.update();
            });
        } finally {
            planned.tool.dispose();
        }
    }

    private feature(chain: { sketch: SketchNode; entityIds: number[] }, params: RibParams): RibFeatureData {
        return {
            id: Id.generate(),
            type: "rib",
            sketchId: chain.sketch.id,
            entityIds: chain.entityIds,
            thickness: this.thickness,
            ...(params.extend ? { extend: true } : {}),
        };
    }

    /** The chain the pick names: one sketch, and the entity id behind each picked edge. */
    private pickedChain(): { sketch: SketchNode; entityIds: number[] } | undefined {
        const shapes = this.pickedEdges();
        const sketch = shapes.at(0)?.owner.node;
        if (!(sketch instanceof SketchNode)) return undefined;
        const ids = shapeEntityIds(sketch.data);
        const entityIds = shapes
            .map((shape) => ids[shape.indexes[0]])
            .filter((id): id is number => id !== undefined);
        return entityIds.length === 0 ? undefined : { sketch, entityIds };
    }

    /** The picked chain edges — the live selection while the pick is up, the result once it ends. */
    private pickedEdges(): VisualShapeData[] {
        const shapes = this.stepDatas[0]?.shapes ?? this.document.selection.getSelectedShapes();
        const node = shapes.at(0)?.owner.node;
        return shapes.filter((x) => x.owner.node === node && x.shape.shapeType === ShapeTypes.edge);
    }

    /**
     * The parameters as the kernel needs them, or undefined while they do not resolve. The
     * feature keeps the expression the user typed; an expression that no longer resolves refuses
     * the commit rather than raising a zero-width wall — the same refusal the thicken makes.
     */
    private params(): RibParams | undefined {
        const thickness = this.positiveLength(this.thickness);
        if (thickness === undefined) return undefined;
        return { thickness, extend: this.extend };
    }

    private positiveLength(value: ParameterValue): number | undefined {
        const resolved: Result<number> = this.resolveParameter(value, LENGTH_UNITS);
        return resolved.isOk && resolved.value > 0 ? resolved.value : undefined;
    }
}
