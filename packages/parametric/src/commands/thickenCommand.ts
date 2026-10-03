// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AUTO_TARGETS,
    type BoundingBox,
    Combobox,
    command,
    type IDocument,
    Id,
    type IFace,
    type INode,
    type INodeVisual,
    type IShape,
    type IStep,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    Result,
    type ShapeMeshData,
    ShapeTypes,
    ShapeTypeUtils,
    type TargetCandidate,
    type TargetSelection,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { ThickenFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { captureProfileRef } from "../features/profileRef";
import { connectedFaceGroups } from "../features/thickenTracked";
import { ParametricBodyNode } from "../parametricBodyNode";
import { buildTargetPreview, worldShape } from "./booleanPreview";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    standaloneBody,
    syncAutoTargets,
    targetCandidate,
} from "./booleanTargets";
import { FORM_FEATURE_OPERATIONS } from "./extrudeCommand";
import { SelectBodyFacesStep } from "./selectBodyFacesStep";

const OPERATION_NEW = "option.command.operation.new";

/**
 * Picks the faces to thicken. A SURFACE body (a parametric body whose shape is not a solid — a
 * loft with `isSolid` off, say) that is selected seeds the pick with its whole face set, as if
 * every face had been picked; everything else is the shared body-face step's behavior.
 *
 * A solid body is deliberately NOT expandable to "all its faces": thickening a closed solid's
 * whole boundary is a shell, not a thicken, and quietly reading the pick that way would give the
 * user a different feature than the one they asked for.
 */
export class SelectThickenFacesStep extends SelectBodyFacesStep {
    protected override seedFaces(document: IDocument): VisualShapeData[] {
        const surface = document.selection
            .getSelectedNodes()
            .find((x): x is ParametricBodyNode => this.isSurface(x));
        return surface === undefined ? [] : SelectBodyFacesStep.facesOf(document, surface);
    }

    /** True for a body showing a surface rather than a solid — what a whole-body pick may expand. */
    private isSurface(node: INode): node is ParametricBodyNode {
        return (
            node instanceof ParametricBodyNode &&
            node.shape.isOk &&
            !ShapeTypeUtils.hasSolid(node.shape.value.shapeType)
        );
    }
}

/**
 * Thicken (Onshape's Thicken): pick faces of a body, give them a thickness, and either stand the
 * resulting solid up as a new body or combine it with the bodies the operation scope names.
 *
 * No drag step — Onshape's Thicken has none either; the thickness is a field and the side is the
 * Opposite Direction checkbox. The preview follows both, rebuilt by the same kernel call the
 * feature makes.
 */
@command({ key: "feature.thicken", icon: "icon-thickSolid" })
export class ThickenFeatureCommand extends MultistepCommand {
    @property("option.command.operation", {
        combobox: Combobox.from([
            OPERATION_NEW,
            "option.command.operation.join",
            "option.command.operation.cut",
            "option.command.operation.intersect",
        ]),
    })
    get operation(): string {
        return this.getPrivateValue("operation", OPERATION_NEW);
    }
    set operation(value: string) {
        this.setProperty("operation", value);
        this.showTargets = value !== OPERATION_NEW;
        this.updatePreview();
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
        this.updatePreview();
    }

    /**
     * The detection's write path. It goes around the setter because the write is a consequence of
     * the preview it happens inside, not a request for another one — but the property event still
     * goes out, and that is what redraws the checkbox list (the twin of the extrude command's).
     */
    private applyAutoTargets(selection: TargetSelection): void {
        const previous = this.targets;
        this.setPrivateValue("targets", selection);
        this.emitPropertyChanged("targets", previous);
    }

    /** Onshape's Midplane: the thickness straddles the faces instead of standing off them. */
    @property("option.command.symmetric")
    get midplane(): boolean {
        return this.getPrivateValue("midplane", false);
    }
    set midplane(value: boolean) {
        this.setProperty("midplane", value);
        this.updatePreview();
    }

    /** Onshape's Opposite Direction: which side of the faces the material goes. */
    @property("option.command.oppositeDirection")
    get oppositeDirection(): boolean {
        return this.getPrivateValue("oppositeDirection", false);
    }
    set oppositeDirection(value: boolean) {
        this.setProperty("oppositeDirection", value);
        this.updatePreview();
    }

    @property("option.command.thickness", { unit: LENGTH_UNITS })
    get thickness(): ParameterValue {
        return this.getPrivateValue("thickness", 1);
    }
    set thickness(value: ParameterValue) {
        this.setProperty("thickness", value);
        this.updatePreview();
    }

    /**
     * How far the solid also reaches to the far side; ignored while midplane is on, which is
     * also when its row is hidden.
     *
     * The dependency names `midplane` rather than a derived "should be visible" getter: the
     * panel re-evaluates a dependent row on a change to the NAMED property, and only a
     * `setProperty` write emits one. A getter would leave the row in place when the midplane
     * toggles — the field would sit there driving nothing.
     */
    @property("option.command.thickness2", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "midplane", value: false }],
    })
    get thickness2(): ParameterValue {
        return this.getPrivateValue("thickness2", 0);
    }
    set thickness2(value: ParameterValue) {
        this.setProperty("thickness2", value);
        this.updatePreview();
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        // The panel is up by now (the base publishes it) and its list is subscribed, so this both
        // starts the run on auto-detection and repaints the boxes. The option cache keys on the
        // property name alone, so a set left over from an earlier run must not decide this one.
        this.targets = AUTO_TARGETS;
    }

    // ------------------------------------------------------------------ Preview

    private previewId: number | undefined;
    private previewOwner: INodeVisual | undefined;

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
     * Shows the thickened solid on the body's current shape — built by the same kernel call the
     * feature will make, so the preview equals the committed result. The source body is ghosted
     * while it is up: the new material is what the user is deciding on, and an opaque original
     * would hide a `cut` entirely. A preview that cannot be built simply shows nothing.
     */
    protected readonly updatePreview = () => {
        this.removePreview();
        const measured = this.build();
        if (measured === undefined) return;

        const preview = this.withOperation(measured);
        if (measured.owner !== undefined) {
            this.previewOwner = measured.owner;
            this.document.visual.highlighter.addState(
                this.previewOwner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
        }
        this.previewId = this.document.visual.context.displayMesh(preview.meshes, { meshOpacity: 1 });
        this.document.visual.update();
    };

    /** Stands the preview in for the bodies the feature will rewrite, when an operation is set. */
    private withOperation(measured: Measured): { meshes: ShapeMeshData[] } {
        const operation = FORM_FEATURE_OPERATIONS[this.operation];
        const targets = operation === undefined ? [] : this.resolveTargets(measured.tool.value.boundingBox());
        if (operation === undefined || targets.length === 0) {
            return { meshes: meshed(measured.tool) };
        }
        const preview = buildTargetPreview(operation, measured.tool.value, targets);
        measured.tool.value.dispose();
        return { meshes: preview.meshes };
    }

    /** The thickened tool plus the body its faces came from — what a preview or a target scope needs. */
    private build(): Measured | undefined {
        const picked = this.pickedFaces();
        const plan = this.planOf();
        if (picked.length === 0 || plan === undefined || plan.every((x) => x === 0)) return undefined;

        const owned: IFace[] = [];
        try {
            const world = picked.map((x) => worldShape(x.shape as unknown as IFace, x.transform, owned));
            const tool = this.thicken(world, plan);
            if (tool === undefined) return undefined;
            return { tool, owner: picked[0].owner };
        } finally {
            owned.forEach((x) => {
                x.dispose();
            });
        }
    }

    /**
     * The thickened solid of `world` faces. Each connected face set goes to the kernel as ONE
     * shape (a shell, or the face itself when it is alone) — two disconnected faces handed over
     * as one shell fail outright, and a connected set must go in together so the edges its faces
     * share raise no wall between them. The sets are combined into one shape, exactly as a
     * multi-profile sweep is.
     */
    private thicken(world: readonly IFace[], plan: readonly number[]): Result<IShape> | undefined {
        const shapes: IShape[] = [];
        const discard = () => {
            shapes.forEach((x) => {
                x.dispose();
            });
        };
        for (const group of connectedFaceGroups(world)) {
            // A lone face goes in as itself and belongs to `world`; anything larger is sewn
            // into a shell here, and that shell is ours to free once the kernel has read it.
            const source =
                group.length === 1
                    ? Result.ok<IShape>(world[group[0]])
                    : shapeFactory.shell(group.map((k) => world[k]));
            if (!source.isOk) {
                discard();
                return undefined;
            }
            for (const thickness of plan) {
                const one = shapeFactory.makeThickSolidBySimple(source.value, thickness);
                if (!one.isOk) {
                    this.freeSource(source.value, group);
                    discard();
                    return undefined;
                }
                shapes.push(one.value);
            }
            this.freeSource(source.value, group);
        }
        const combined = shapeFactory.combine(shapes);
        discard();
        return combined.isOk ? combined : undefined;
    }

    /** Frees a component's kernel input, unless it is one of the caller's own faces. */
    private freeSource(source: IShape, group: readonly number[]): void {
        if (group.length > 1) source.dispose();
    }

    private removePreview() {
        if (this.previewOwner !== undefined) {
            this.document.visual.highlighter.removeState(
                this.previewOwner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
            this.previewOwner = undefined;
        }
        if (this.previewId !== undefined) {
            this.document.visual.context.removeMesh(this.previewId);
            this.previewId = undefined;
        }
    }

    /**
     * The signed thicknesses the kernel is asked for, one per direction. `reverse` negates the
     * VALUES, never their order — the feature names the two directions by position, so swapping
     * them would move every id of one half onto the other half's geometry.
     */
    private planOf(): number[] | undefined {
        const thickness = this.resolveLength(this.thickness);
        const thickness2 = this.resolveLength(this.thickness2);
        if (thickness === undefined || thickness2 === undefined) return undefined;
        const sign = this.oppositeDirection ? -1 : 1;
        if (this.midplane) return [(thickness / 2) * sign, (-thickness / 2) * sign];
        return thickness2 === 0 ? [thickness * sign] : [thickness * sign, -thickness2 * sign];
    }

    /** A length field's numeric value, or undefined when its expression does not resolve. */
    private resolveLength(value: ParameterValue): number | undefined {
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The bodies this run combines with, refreshing the auto set from the tool's box first. */
    private resolveTargets(box: BoundingBox | undefined): ParametricBodyNode[] {
        if (box !== undefined) {
            syncAutoTargets(this.document, box, this.targets, (next) => this.applyAutoTargets(next));
        }
        return resolveTargetBodies(this.document, box, this.targets);
    }

    /**
     * The faces the feature will be built from — the LIVE selection while the pick is up, and the
     * step's recorded result once it is done. Reading the selection is what lets `updatePreview`
     * follow the picks: `stepDatas` stays empty until the pick completes.
     */
    private pickedFaces(): VisualShapeData[] {
        const shapes = this.stepDatas[0]?.shapes ?? this.document.selection.getSelectedShapes();
        return shapes.filter(
            (x) =>
                x.owner.node instanceof ParametricBodyNode &&
                ShapeTypeUtils.contains(ShapeTypes.face, x.shape.shapeType),
        );
    }

    // ------------------------------------------------------------------ Commit

    protected override getSteps(): IStep[] {
        return [new SelectThickenFacesStep(() => this.updatePreview())];
    }

    protected override executeMainTask(): void {
        // The feature keeps the expression the user typed; one that no longer resolves refuses the
        // commit rather than building a zero-width solid — the same refusal the extrude makes.
        const plan = this.planOf();
        const node = this.stepDatas[0].nodes?.[0];
        const picked = this.pickedFaces();
        if (plan === undefined || picked.length === 0 || !(node instanceof ParametricBodyNode)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid thickness");
            return;
        }

        const owned: IFace[] = [];
        try {
            const feature = this.buildFeature(node, picked, owned);
            Transaction.execute(this.document, "excute feature.thicken", () => {
                const operation = FORM_FEATURE_OPERATIONS[this.operation];
                if (operation === undefined) {
                    standaloneBody(this.document, feature);
                } else {
                    commitBooleanTargets(
                        this.document,
                        feature,
                        operation,
                        this.resolveTargets(this.toolBox(picked, plan)),
                    );
                }
                this.document.visual.update();
            });
        } finally {
            owned.forEach((x) => {
                x.dispose();
            });
        }
    }

    /** The feature payload: face fingerprints in world coordinates, plus what to do with the solid. */
    private buildFeature(
        node: ParametricBodyNode,
        picked: VisualShapeData[],
        owned: IFace[],
    ): ThickenFeatureData {
        const world = picked.map((x) => worldShape(x.shape as unknown as IFace, x.transform, owned));
        return {
            id: Id.generate(),
            type: "thicken",
            thickness: this.thickness,
            ...(this.thickness2 !== 0 ? { thickness2: this.thickness2 } : {}),
            ...(this.midplane ? { midplane: true } : {}),
            ...(this.oppositeDirection ? { reverse: true } : {}),
            // A thicken accepts curved faces too, so no outward-normal gate is captured with the
            // fingerprints (see the re-anchoring in `thicken.ts`).
            source: {
                nodeId: node.id,
                profiles: world.map((face, index) => {
                    const faceId = node.faceIdAt(picked[index].indexes[0]);
                    if (faceId === undefined) {
                        reportSilentIdLoss(node, "face", "a thicken face has no tracked id");
                    }
                    return captureProfileRef(face, faceId, node.faceIdIsShared(faceId));
                }),
            },
        };
    }

    /**
     * The thickened solid's box, built only to be measured: the target detection needs the tool's
     * bounds, and a tool that cannot be built at all leaves the feature standing on its own.
     */
    private toolBox(picked: readonly VisualShapeData[], plan: readonly number[]): BoundingBox | undefined {
        const owned: IFace[] = [];
        try {
            const world = picked.map((x) => worldShape(x.shape as unknown as IFace, x.transform, owned));
            const tool = this.thicken(world, plan);
            if (tool === undefined) return undefined;
            const box = tool.value.boundingBox();
            tool.value.dispose();
            return box;
        } finally {
            owned.forEach((x) => {
                x.dispose();
            });
        }
    }
}

/** A built thicken waiting to be previewed: the tool shape and the body its faces came from. */
interface Measured {
    readonly tool: Result<IShape>;
    readonly owner: INodeVisual | undefined;
}

/** The tool's own mesh — what the preview shows when there is no boolean to show. */
function meshed(tool: Result<IShape>): ShapeMeshData[] {
    const { faces, edges } = tool.value.mesh;
    tool.value.dispose();
    if (faces === undefined) return [];
    return edges === undefined ? [faces] : [faces, edges];
}
