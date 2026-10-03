// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type AsyncController,
    command,
    type IDocument,
    Id,
    type IFace,
    type IShape,
    type IStep,
    MultistepCommand,
    type ParameterValue,
    type Plane,
    PubSub,
    property,
    ShapeTypes,
    type SnapResult,
    Transaction,
    type VisualShapeData,
} from "@chili3d/core";
import { neutralPlaneInHost } from "../features/draft";
import type { DraftFeatureData, NeutralPlaneRef } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { captureProfileRef } from "../features/profileRef";
import { matchSourceFaceIndexes } from "../features/sourceFaceMatcher";
import { ParametricBodyNode } from "../parametricBodyNode";
import { PlanePickHandler, type PlanePickResult } from "../sketch/commands/planePickHandler";
import { captureFaceRef, datumPlaneOf, planeOfFace } from "../sketch/planeRef";
import type { DragPreview } from "./axisDragHandler";
import { type DraftDragData, type DraftDragHandler, type DraftDragState, DraftDragStep } from "./draftDrag";

/** What the neutral-plane pick captured: the stored reference, plus the plane it resolved to. */
export interface PickedNeutralPlane {
    readonly ref: NeutralPlaneRef;
    /** The plane in WORLD coordinates — what has to be mapped into the body before the kernel sees it. */
    readonly plane: Plane;
}

/**
 * The neutral plane, picked as a datum or a planar face — the sketch module's own plane picker
 * (`PlanePickHandler`), which already filters to planar faces, draws the three datum quads and
 * tears them down again. The pick's result is read off the handler afterwards, exactly as
 * `pickPlane` in `sketchCommands.ts` does; the only difference is what is done with it.
 */
export class SelectNeutralPlaneStep implements IStep {
    constructor(private readonly onPicked: (picked: PickedNeutralPlane) => void) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        document.selection.clearSelection();
        const handler = new PlanePickHandler(document, controller);
        await document.picker.pickAsync(handler, "prompt.select.plane", controller, "none", "select.default");
        controller.dispose();
        const result = handler.result;
        handler.dispose();
        document.selection.clearSelection();
        if (result === undefined) return undefined;

        const picked = captureNeutralPlane(document, result);
        if (picked === undefined) return undefined;
        this.onPicked(picked);
        return { view: document.application.activeView!, shapes: [], type: "input", plane: picked.plane };
    }
}

/**
 * The picked plane as the feature stores and the handle reads it. A datum needs nothing more than
 * its name — the three never move — while a face is captured in world coordinates as
 * `PlaneFaceRef`, with the owner's tracked face id when it has one so a rebuild re-matches it
 * exactly instead of geometrically.
 */
function captureNeutralPlane(document: IDocument, result: PlanePickResult): PickedNeutralPlane | undefined {
    if (result.kind === "datum") {
        return { ref: { kind: "datum", name: result.name }, plane: datumPlaneOf(result.name) };
    }
    const owner = document.visual.context.getNode(result.data.owner);
    if (owner === undefined) return undefined;
    const worldFace = result.data.shape.transformedMul(result.data.transform) as IFace;
    try {
        const ref = captureFaceRef(owner.id, worldFace);
        if (owner instanceof ParametricBodyNode) {
            const faceId = owner.faceIdAt(result.data.indexes[0]);
            if (faceId === undefined) {
                // Not fatal: the ref keeps its geometric fingerprint and re-matches on that. The
                // report is what turns a silently weaker reference into a visible one.
                reportSilentIdLoss(owner, "face", "the draft neutral-plane face has no tracked id");
            } else {
                ref.faceId = faceId;
            }
        }
        return { ref: { kind: "face", ref }, plane: planeOfFace(worldFace) };
    } finally {
        worldFace.dispose();
    }
}

/**
 * Draft (Onshape's / Fusion's Draft): taper picked faces of a parametric body about a neutral
 * plane, by an angle whose direction defaults to that plane's normal.
 *
 * No new body and no boolean scope — a draft rewrites the body it is applied to, exactly as a
 * fillet or a shell does. Two steps, in the order the interaction needs:
 *
 * 1. the neutral plane, which decides whether a face can be tapered at all (a face parallel to it
 *    has no rotation line) and is what the angle handle is measured against;
 * 2. the faces AND the angle, in one gesture — `DraftDragStep` picks faces and drags the arrow at
 *    the same time, the way `ExtrudeDragStep` does for a press-pull.
 *
 * Everything on screen for step 2 (the arrow, the ghost, the tapered preview) belongs to the drag
 * handler; the command only supplies the kernel call the preview is built from.
 */
@command({ key: "feature.draft", icon: "icon-draft" })
export class DraftFeatureCommand extends MultistepCommand {
    /** Five degrees: a customary start, small enough that the flip is still recognisable in the preview. */
    @property("common.angle", { unit: ANGLE_UNITS })
    get angle(): ParameterValue {
        return this.getPrivateValue("angle", 5);
    }
    set angle(value: ParameterValue) {
        this.setProperty("angle", value, () => {
            // Push into a live handle so the arrow follows the tab. Pushing the drag's OWN value
            // back is harmless: `setValue` ignores a value it already holds, which is what stops
            // the two from looping rather than a flag would.
            const resolved = this.resolvedAngle;
            if (resolved !== undefined) this._dragHandler?.setValue(resolved);
        });
    }

    /** Flips the pull direction without touching the angle — Fusion's Flip Pull Direction. */
    @property("option.command.oppositeDirection")
    get reverse(): boolean {
        return this.getPrivateValue("reverse", false);
    }
    set reverse(value: boolean) {
        this.setProperty("reverse", value, () => this._dragHandler?.refresh());
    }

    private neutral: PickedNeutralPlane | undefined;
    private _dragHandler: DraftDragHandler | undefined;

    /** The angle as the user's expression resolves it, or undefined when it does not resolve. */
    private get resolvedAngle(): number | undefined {
        const resolved = this.resolveParameter(this.angle, ANGLE_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The angle the kernel (and a preview) can use — see the zero note. */
    private get angleNumber(): number | undefined {
        const value = this.resolvedAngle;
        // Zero never reaches the kernel: measured, it hands the input straight back, so a preview
        // (and a feature) at zero would show a taper that is not there.
        return value !== undefined && value !== 0 ? value : undefined;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectNeutralPlaneStep((picked) => {
                this.neutral = picked;
            }),
            new DraftDragStep("prompt.dragToDraft", this.dragData),
        ];
    }

    /**
     * What the drag step opens with. The faces come from the current selection, so a pick made
     * before the command starts is kept — the drag owns the set from there (see `DraftDragStep`).
     */
    private readonly dragData = (): DraftDragData | undefined => {
        const neutral = this.neutral;
        if (neutral === undefined) return undefined;
        return {
            neutral: neutral.plane,
            faces: this.selectedBodyFaces(),
            angle: this.resolvedAngle ?? 0,
            buildPreview: this.buildPreview,
            onAngle: (angle: number) => {
                this.angle = angle;
            },
            onReady: (handler: DraftDragHandler) => {
                this._dragHandler = handler;
            },
            onDone: () => {
                this._dragHandler = undefined;
            },
        };
    };

    /** The selected faces of one parametric body — a draft tapers a body's chain. */
    private selectedBodyFaces(): VisualShapeData[] {
        const shapes = this.document.selection
            .getSelectedShapes()
            .filter(
                (x) => x.shape.shapeType === ShapeTypes.face && x.owner.node instanceof ParametricBodyNode,
            );
        const node = shapes.at(0)?.owner.node;
        return shapes.filter((x) => x.owner.node === node);
    }

    /**
     * The tapered body for the live state, by the same kernel call the feature will make — so the
     * preview equals the committed result. Empty when there is nothing to show: no angle, no face
     * picked, or a configuration the kernel refuses (which is not a half-truth but an honest
     * blank — the drag step's own row reports the refusal on commit).
     */
    private readonly buildPreview = (state: DraftDragState): DragPreview => {
        const world = this.taperedResult(state);
        if (world === undefined) return { meshes: [] };
        const { faces, edges } = world.mesh;
        world.dispose();
        return { meshes: [faces, edges].filter((x) => x !== undefined) };
    };

    /** The tapered result in the picked faces' world placement, or undefined when it cannot build. */
    private taperedResult(state: DraftDragState): IShape | undefined {
        const angle = this.angleNumber;
        const neutral = this.neutral;
        const node = state.node;
        if (angle === undefined || neutral === undefined || node === undefined) return undefined;
        if (state.faces.length === 0 || !node.shape.isOk) return undefined;

        const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
        const indexes = this.matchTaperFaces(node, faces, state.faces);
        if (indexes === undefined || indexes.length === 0) return undefined;
        const plane = neutralPlaneInHost(neutral.plane, node);
        if (!plane.isOk) return undefined;
        const result = shapeFactory.draft(
            node.shape.value,
            indexes.map((index) => faces[index]),
            this.pullDirection(plane.value),
            angle,
            plane.value,
        );
        if (!result.isOk) return undefined;

        // The kernel runs in the body's local space; the preview is drawn in world coordinates.
        const world = result.value.transformedMul(state.faces[0].transform);
        result.value.dispose();
        return world;
    }

    /** The plane's own normal, or its opposite — the same flip `evaluate` makes. */
    private pullDirection(plane: Plane): Plane["normal"] {
        return this.reverse ? plane.normal.multiply(-1) : plane.normal;
    }

    /**
     * The picked faces as indexes into the body's own face enumeration. They are matched the way
     * the feature matches them — tracked id first, geometric fingerprint second — so the preview
     * and the committed feature taper the same faces.
     */
    private matchTaperFaces(
        node: ParametricBodyNode,
        faces: IFace[],
        picked: readonly VisualShapeData[],
    ): number[] | undefined {
        const faceIds = faces.map((_, index) => node.faceIdAt(index));
        const matched = matchSourceFaceIndexes(
            faces,
            faceIds,
            picked.map((x) => captureProfileRef(x.shape as unknown as IFace, node.faceIdAt(x.indexes[0]))),
        );
        return matched.isOk ? matched.value.indexes : undefined;
    }

    protected override executeMainTask(): void {
        // The same refusal the other features make: the feature keeps the expression the user
        // typed, and one that no longer resolves fails the next rebuild rather than silently
        // tapering by nothing.
        if (this.angleNumber === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid draft angle");
            return;
        }
        const body = this.stepDatas[1].nodes?.[0];
        const picked = this.stepDatas[1].shapes.filter((x) => x.shape.shapeType === ShapeTypes.face);
        if (!(body instanceof ParametricBodyNode) || picked.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to draft");
            return;
        }
        const neutral = this.neutral;
        if (neutral === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a neutral plane");
            return;
        }

        const faces = picked.map((data) => {
            const faceId = body.faceIdAt(data.indexes[0]);
            if (faceId === undefined) {
                reportSilentIdLoss(body, "face", "a drafted face has no tracked id");
            }
            return captureProfileRef(data.shape as unknown as IFace, faceId, body.faceIdIsShared(faceId));
        });
        Transaction.execute(this.document, "excute feature.draft", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(faces, neutral.ref)]);
            this.document.visual.update();
        });
    }

    private feature(faces: DraftFeatureData["faces"], neutralPlane: NeutralPlaneRef): DraftFeatureData {
        return {
            id: Id.generate(),
            type: "draft",
            faces,
            neutralPlane,
            angle: this.angle,
            ...(this.reverse ? { reverse: true } : {}),
        };
    }
}
