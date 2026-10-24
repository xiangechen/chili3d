// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
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
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import type { OffsetFaceFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { roundFaces } from "../features/offsetFace";
import { captureProfileRef } from "../features/profileRef";
import { matchSourceFaceIndexes } from "../features/sourceFaceMatcher";
import { ParametricBodyNode } from "../parametricBodyNode";
import type { PickSettledCommand } from "./pickSettled";
import { SelectBodyFacesStep } from "./selectBodyFacesStep";

/** The faces to move, picked on ONE parametric body — the shared body-face step, nothing extra. */
export class SelectOffsetFacesStep extends SelectBodyFacesStep {
    constructor(
        onReady: () => void = () => {},
        /**
         * Take the faces the selection already holds as the answer, instead of seeding a pick with
         * them and waiting for a confirm. Set by the command that opens this one (Press Pull),
         * whose own confirm IS this pick's — without it the user clicks the same thing twice.
         */
        private readonly settled = false,
    ) {
        super(onReady, "prompt.select.faces");
    }

    override async execute(document: IDocument, controller: AsyncController) {
        if (this.settled) {
            const picked = this.preselectedFaces(document);
            if (picked.length > 0) {
                controller.success();
                return this.oneBody(document.application.activeView!, picked);
            }
        }
        return super.execute(document, controller);
    }
}

/**
 * Offset Face (Fusion's and Onshape's Move Face › Offset): move the picked faces of a parametric
 * body along their own outward normals, the faces that run smoothly into them following — a flat
 * face grows or sinks like a pad, a curved wall changes its radius.
 *
 * No new body and no boolean scope: it rewrites the body it is applied to, exactly as a shell or a
 * fillet does, so this follows `shellCommand.ts` — one pick step, the value edited in the floating
 * options tab, a live preview built by the same kernel call the feature will make.
 *
 * The preview draws the result OVER the original, which is ghosted while it is up (the same
 * treatment a shell gives its body): the moved faces sit on the outside of the body, so without
 * the ghost the preview and the body it replaces would fight over the same faces.
 */
@command({ key: "feature.offsetFace", icon: "icon-offsetFace" })
export class OffsetFaceFeatureCommand extends MultistepCommand implements PickSettledCommand {
    /**
     * Set by the command that opens this one (Press Pull) after its own pick and confirm, so the
     * step below takes the selection as the answer rather than asking for the same click again.
     */
    pickSettled = false;

    /** Positive moves a face OUT (the body grows there); negative moves it in. */
    @property("option.command.distance", { unit: LENGTH_UNITS })
    get distance(): ParameterValue {
        return this.getPrivateValue("distance", 2);
    }
    set distance(value: ParameterValue) {
        this.setProperty("distance", value, () => this.updatePreview());
    }

    /**
     * Fusion's behavior, and on for a new offset: a round a Fillet left next to a moved face is
     * taken off and made again at its own radius, instead of travelling with the face and coming
     * back at a different radius. Off, the rounds move with the face (OCCT's own behavior) — which
     * is what an offset saved before this option does.
     */
    @property("option.command.keepRounds")
    get keepRounds(): boolean {
        return this.getPrivateValue("keepRounds", true);
    }
    set keepRounds(value: boolean) {
        this.setProperty("keepRounds", value, () => this.updatePreview());
    }

    private previewId: number | undefined;
    private previewOwner: INodeVisual | undefined;

    /**
     * The distance as the preview and the kernel need it, or undefined when it resolves to 0 —
     * which is not a small move but no move at all, so there is nothing to preview.
     */
    private get distanceNumber(): number | undefined {
        const resolved = this.resolveParameter(this.distance, LENGTH_UNITS);
        return resolved.isOk && Math.abs(resolved.value) > 1e-9 ? resolved.value : undefined;
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
     * Shows the moved body built on the body's current shape, by the same kernel call the feature
     * will make — so the preview equals the committed result. A move the kernel refuses (too far
     * for the body, a face it cannot offset) simply shows nothing.
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

    /** The moved result in the picked faces' world placement, plus the body it came from. */
    private build(): { shape: IShape; owner: INodeVisual } | undefined {
        const distance = this.distanceNumber;
        const picked = this.pickedFaces();
        if (distance === undefined || picked.length === 0) return undefined;
        const shape = offsetPreview(picked[0].owner.node, picked, distance, this.keepRounds);
        return shape === undefined ? undefined : { shape, owner: picked[0].owner };
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
        return [new SelectOffsetFacesStep(() => this.updatePreview(), this.pickSettled)];
    }

    protected override executeMainTask(): void {
        // The same refusal the other features make: the feature keeps the expression the user
        // typed, and one that resolves to nothing moves nothing rather than failing later.
        if (this.distanceNumber === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Enter a distance other than 0");
            return;
        }
        const body = this.stepDatas[0].nodes?.[0];
        const picked = this.stepDatas[0].shapes.filter((x) => x.shape.shapeType === ShapeTypes.face);
        if (!(body instanceof ParametricBodyNode) || picked.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to move");
            return;
        }

        const faces = picked.map((data) => {
            const faceId = body.faceIdAt(data.indexes[0]);
            if (faceId === undefined) {
                reportSilentIdLoss(body, "face", "a moved face has no tracked id");
            }
            return captureProfileRef(data.shape as unknown as IFace, faceId, body.faceIdIsShared(faceId));
        });
        Transaction.execute(this.document, "excute feature.offsetFace", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(faces)]);
            this.document.visual.update();
        });
    }

    private feature(faces: OffsetFaceFeatureData["faces"]): OffsetFaceFeatureData {
        // Recorded whether it is on or off: an absent field means off to a reader that predates
        // it, so writing the explicit `false` keeps this offset's shape the same either way.
        return {
            id: Id.generate(),
            type: "offsetFace",
            faces,
            distance: this.distance,
            keepRounds: this.keepRounds,
        };
    }
}

/**
 * The picked faces as indexes into the body's own face enumeration. They are matched the way the
 * feature matches them — tracked id first, geometric fingerprint second — so a preview and the
 * committed feature agree on what moves.
 */
export function matchMovedFaces(
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

/**
 * The body the offset would leave, in the picked faces' world placement — the same kernel call the
 * feature makes, so a preview equals the committed result. Undefined when the kernel refuses the
 * move (too far for the body, a face it cannot offset) or the body will not evaluate.
 *
 * Exported because Press Pull drags a face along its normal and has to show what it is about to
 * build WITHOUT building it: this is the one place that knows how, and both commands go through it.
 */
export function offsetPreview(
    node: INode,
    picked: readonly VisualShapeData[],
    distance: number,
    keepRounds: boolean,
): IShape | undefined {
    if (picked.length === 0 || !(node instanceof ParametricBodyNode) || !node.shape.isOk) return undefined;
    const indexes = matchMovedFaces(node, picked);
    if (indexes === undefined || indexes.length === 0) return undefined;
    const shape = node.shape.value;
    const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
    const offset = shapeFactory.offsetFacesTracked;
    if (offset === undefined) return undefined;
    // The same rounds the feature will keep, by the same name rule: the preview has to show the
    // shape that is about to be committed.
    const rounds = keepRounds
        ? roundFaces(
              shape,
              faces.map((_, index) => node.faceIdAt(index)),
          )
        : [];
    const result = offset(
        shape,
        indexes.map((index) => faces[index]),
        distance,
        rounds,
        keepRounds,
    );
    if (!result.isOk) return undefined;

    // The kernel runs in the body's local space; the preview is drawn in world coordinates.
    const world = result.value.shape.transformedMul(picked[0].transform);
    result.value.shape.dispose();
    return world;
}
