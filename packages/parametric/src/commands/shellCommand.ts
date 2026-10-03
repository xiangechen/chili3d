// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    type I18nKeys,
    Id,
    type IFace,
    type INodeVisual,
    type IShape,
    type IStep,
    type JoinType,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { ShellFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { captureProfileRef } from "../features/profileRef";
import { matchSourceFaceIndexes } from "../features/sourceFaceMatcher";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SelectBodyFacesStep } from "./selectBodyFacesStep";

const JOIN_ARC = "option.command.joinType.arc";
const JOIN_INTERSECTION = "option.command.joinType.intersection";

/** The faces to open, picked on ONE parametric body — the shared body-face step, nothing extra. */
export class SelectShellFacesStep extends SelectBodyFacesStep {
    constructor(onReady: () => void = () => {}) {
        super(onReady, "prompt.select.openFaces");
    }
}

/**
 * Shell (Onshape's Shell): open faces of a parametric body and hollow it to a wall thickness.
 *
 * No new body and no boolean scope — a shell rewrites the body it is applied to, exactly as a
 * fillet does, so this follows `edgeCornerCommand.ts`: one pick step, the value edited in the
 * floating options tab, a live preview built by the same kernel call the feature will make.
 *
 * The preview deliberately shows the WHOLE result rather than the removed material: the wall is
 * carved out of the inside of the body and would be invisible against an opaque original, so the
 * original is ghosted while the preview is up (the same treatment the thicken gives its source).
 */
@command({ key: "feature.shell", icon: "icon-shell" })
export class ShellFeatureCommand extends MultistepCommand {
    @property("option.command.thickness", { unit: LENGTH_UNITS })
    get thickness(): ParameterValue {
        return this.getPrivateValue("thickness", 2);
    }
    set thickness(value: ParameterValue) {
        this.setProperty("thickness", value, () => this.updatePreview());
    }

    /** Onshape's "Shell outward": the wall is added outside the boundary instead of carved out. */
    @property("option.command.outward")
    get outward(): boolean {
        return this.getPrivateValue("outward", false);
    }
    set outward(value: boolean) {
        this.setProperty("outward", value, () => this.updatePreview());
    }

    /**
     * How the inner corners are built. Exposed because it is a real geometric choice — a rounded
     * join trims each side away from the corner, a sharp one lets them meet — and because it is
     * the one option the existing Modify▸Shell command's users reach for most.
     */
    @property("option.command.joinType", {
        combobox: Combobox.from([JOIN_ARC, JOIN_INTERSECTION]),
    })
    get joinType(): I18nKeys {
        return this.getPrivateValue("joinType", JOIN_ARC);
    }
    set joinType(value: I18nKeys) {
        this.setProperty("joinType", value, () => this.updatePreview());
    }

    private previewId: number | undefined;
    private previewOwner: INodeVisual | undefined;

    /** The wall thickness as the preview and the kernel need it, or undefined when unresolved. */
    private get thicknessNumber(): number | undefined {
        const resolved = this.resolveParameter(this.thickness, LENGTH_UNITS);
        return resolved.isOk && resolved.value > 0 ? resolved.value : undefined;
    }

    /** Negative carves the wall out of the input, positive adds it outside (the kernel's sign). */
    private get signedThickness(): number | undefined {
        const value = this.thicknessNumber;
        return value === undefined ? undefined : this.outward ? value : -value;
    }

    private get join(): JoinType {
        return this.joinType === JOIN_INTERSECTION ? "intersection" : "arc";
    }

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
     * Shows the hollowed body built on the body's current shape, by the same kernel call the
     * feature will make — so the preview equals the committed result. A preview that cannot be
     * built (an oversized wall, a face set that leaves nothing) simply shows nothing.
     */
    protected readonly updatePreview = () => {
        this.removePreview();
        const measured = this.build();
        if (measured === undefined) return;

        this.previewOwner = measured.owner;
        this.document.visual.highlighter.addState(
            this.previewOwner,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        const { faces, edges } = measured.shape.mesh;
        measured.shape.dispose();
        if (faces === undefined) return;
        this.previewId = this.document.visual.context.displayMesh(
            [faces, edges].filter((x) => x !== undefined),
            {
                meshOpacity: 1,
            },
        );
        this.document.visual.update();
    };

    /** The hollowed result in the picked faces' world placement, plus the body it came from. */
    private build(): { shape: IShape; owner: INodeVisual } | undefined {
        const thickness = this.signedThickness;
        const picked = this.pickedFaces();
        if (thickness === undefined || picked.length === 0) return undefined;
        const node = picked[0].owner.node;
        if (!(node instanceof ParametricBodyNode) || !node.shape.isOk) return undefined;

        const indexes = this.matchOpenFaces(node, picked);
        if (indexes === undefined || indexes.length === 0) return undefined;
        const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
        const result = shapeFactory.makeThickSolidByJoin(
            node.shape.value,
            indexes.map((index) => faces[index]),
            thickness,
            this.join,
        );
        if (!result.isOk) return undefined;

        // The kernel runs in the body's local space; the preview is drawn in world coordinates.
        const world = result.value.transformedMul(picked[0].transform);
        result.value.dispose();
        return { shape: world, owner: picked[0].owner };
    }

    /**
     * The picked faces as indexes into the body's own face enumeration. They are matched the way
     * the feature matches them — tracked id first, geometric fingerprint second — so the preview
     * and the committed feature agree on what is open.
     */
    private matchOpenFaces(
        node: ParametricBodyNode,
        picked: readonly VisualShapeData[],
    ): number[] | undefined {
        const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
        const faceIds = faces.map((_, index) => node.faceIdAt(index));
        const matched = matchSourceFaceIndexes(
            faces,
            faceIds,
            picked.map((x) => captureProfileRef(x.shape as unknown as IFace, node.faceIdAt(x.indexes[0]))),
        );
        return matched.isOk ? matched.value.indexes : undefined;
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

    /** The faces the feature will be built from — the live selection while the pick is up. */
    private pickedFaces(): VisualShapeData[] {
        const shapes = this.stepDatas[0]?.shapes ?? this.document.selection.getSelectedShapes();
        const node = shapes.at(0)?.owner.node;
        return shapes.filter((x) => x.owner.node === node && x.shape.shapeType === ShapeTypes.face);
    }

    protected override getSteps(): IStep[] {
        return [new SelectShellFacesStep(() => this.updatePreview())];
    }

    protected override executeMainTask(): void {
        // The same refusal the other features make: the feature keeps the expression the user
        // typed, and one that no longer resolves fails the next rebuild rather than silently
        // hollowing by zero.
        const resolved = this.resolveParameter(this.thickness, LENGTH_UNITS);
        if (!resolved.isOk || !(resolved.value > 0)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid thickness");
            return;
        }
        const body = this.stepDatas[0].nodes?.[0];
        const picked = this.stepDatas[0].shapes.filter((x) => x.shape.shapeType === ShapeTypes.face);
        if (!(body instanceof ParametricBodyNode) || picked.length === 0) {
            // A shell with nothing open is not one: the kernel answers an empty closing set with
            // the shrunken solid rather than a hollow body, so it is refused up front.
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to open");
            return;
        }

        const faces = picked.map((data) => {
            const faceId = body.faceIdAt(data.indexes[0]);
            if (faceId === undefined) {
                reportSilentIdLoss(body, "face", "an opened face has no tracked id");
            }
            return captureProfileRef(data.shape as unknown as IFace, faceId, body.faceIdIsShared(faceId));
        });
        Transaction.execute(this.document, "excute feature.shell", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(faces)]);
            this.document.visual.update();
        });
    }

    private feature(faces: ShellFeatureData["faces"]): ShellFeatureData {
        return {
            id: Id.generate(),
            type: "shell",
            faces,
            thickness: this.thickness,
            ...(this.outward ? { outward: true } : {}),
            ...(this.join === "arc" ? {} : { joinType: this.join }),
        };
    }
}
