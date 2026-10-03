// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    command,
    type IApplication,
    type ICommand,
    type IDocument,
    type IEdge,
    type IFace,
    type INode,
    type IStep,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    type Plane,
    PubSub,
    property,
    Result,
    ShapeTypes,
    type SnapResult,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { reportSilentIdLoss } from "../../features/idDiagnostics";
import { ParametricBodyNode } from "../../parametricBodyNode";
import { SketchEditor } from "../editor/sketchEditor";
import { captureExternalRef } from "../externalRef";
import {
    captureFaceRef,
    type DatumPlaneName,
    datumDisplayPlane,
    type PlaneFaceRef,
    sketchPlaneOfFace,
} from "../planeRef";
import {
    type ExternalRefData,
    emptySketchData,
    FIRST_EXTERNAL_ENTITY_ID,
    type SketchData,
} from "../sketchModel";
import { SketchNode } from "../sketchNode";
import { PlanePickHandler, type PlanePickResult } from "./planePickHandler";
import {
    type OffsetDragData,
    type SketchPlaneOffsetHandler,
    SketchPlaneOffsetStep,
} from "./sketchPlaneOffsetStep";

interface PickedPlane {
    plane: Plane;
    /** Set when the plane comes from a solid's face, so the sketch follows that face. */
    planeRef?: PlaneFaceRef;
    /** Set when the plane is one of the three global datums, so its offset stays editable. */
    datumPlane?: DatumPlaneName;
    /**
     * Where the face was clicked, on the base plane. Only the offset preview reads it:
     * it centres the quad — and so the drag arrow — on the point the user was aiming at.
     */
    pickPoint?: XYZ;
    /** Boundary edges of the picked face, captured as reference-role external refs. */
    externalRefs?: ExternalRefData[];
    /** Timeline anchor of the picked body (its feature count now), for session rollback. */
    refPositions?: Record<string, number>;
}

/** The source body's edges, matched against a picked face's boundary to recover tracked ids. */
function sourceBodyEdges(owner: INode): IEdge[] {
    return owner instanceof ParametricBodyNode && owner.shape.isOk
        ? (owner.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        : [];
}

/**
 * The source body's tracked id for one boundary edge of a picked face, reporting the
 * loss when the body carries ids but has none for this edge.
 */
function trackedIdOfFaceEdge(owner: INode, ownerEdges: IEdge[], localEdge: IEdge): string | undefined {
    if (!(owner instanceof ParametricBodyNode)) return undefined;
    // isSame, not isEqual: wire exploration may decorate the edge with a
    // reversed orientation, which IsEqual rejects — boolean-born faces
    // (a groove's floor) would otherwise lose their tracked ids here.
    const index = ownerEdges.findIndex((edge) => edge.isSame(localEdge));
    const edgeId = index < 0 ? undefined : owner.edgeIdAt(index);
    if (edgeId === undefined) {
        reportSilentIdLoss(
            owner,
            "edge",
            index < 0
                ? "a boundary edge of the picked face was not found on the source body"
                : "a boundary edge of the picked face has no tracked id",
        );
    }
    return edgeId;
}

/**
 * The picked face's boundary edges as reference-role external refs (profile would
 * surprise-extrude the whole face boundary). Edges whose curve is not a line or a
 * circle are skipped silently. `localFace` is in the owner's coordinates; the world
 * transform projects them onto the new sketch plane.
 */
export function captureBoundaryExternalRefs(
    owner: INode,
    result: PlanePickResult & { kind: "face" },
    plane: Plane,
): ExternalRefData[] | undefined {
    const localFace = result.data.shape as IFace;
    const localEdges = localFace.findSubShapes(ShapeTypes.edge) as IEdge[];
    const ownerEdges = sourceBodyEdges(owner);
    const refs: ExternalRefData[] = [];
    let nextId = FIRST_EXTERNAL_ENTITY_ID;
    for (const localEdge of localEdges) {
        const worldEdge = localEdge.transformedMul(result.data.transform) as IEdge;
        try {
            const edgeId = trackedIdOfFaceEdge(owner, ownerEdges, localEdge);
            const ref = captureExternalRef(nextId, owner.id, plane, worldEdge, edgeId, "reference");
            if (ref === undefined) continue;
            refs.push(ref);
            nextId--;
        } finally {
            worldEdge.dispose();
        }
    }
    return refs.length === 0 ? undefined : refs;
}

function resolvePlane(document: IDocument, result: PlanePickResult | undefined): PickedPlane | undefined {
    if (result === undefined) return undefined;
    if (result.kind === "datum") return { plane: result.plane, datumPlane: result.name };

    const face = result.data.shape.transformedMul(result.data.transform) as IFace;
    const plane = sketchPlaneOfFace(face);
    const owner = document.visual.context.getNode(result.data.owner);
    const picked = owner === undefined ? undefined : capturePlaneOwner(owner, result, face, plane);
    face.dispose();
    return { plane, pickPoint: result.point, ...picked };
}

/** The plane ref, boundary refs and timeline anchor captured for a face picked on `owner`. */
function capturePlaneOwner(
    owner: INode,
    result: Extract<PlanePickResult, { kind: "face" }>,
    face: IFace,
    plane: Plane,
): Omit<PickedPlane, "plane"> {
    const planeRef = captureFaceRef(owner.id, face);
    let refPositions: Record<string, number> | undefined;
    // Faces of a parametric body carry a stable id across rebuilds — store it so
    // the sketch tracks the face exactly instead of re-matching geometrically.
    if (owner instanceof ParametricBodyNode) {
        const faceId = owner.faceIdAt(result.data.indexes[0]);
        if (faceId !== undefined) {
            planeRef.faceId = faceId;
        } else {
            reportSilentIdLoss(owner, "face", "the sketch-plane face has no tracked id");
        }
        // anchor the sketch's timeline position: the features that exist now are
        // the state the sketch was created against (see computeSketchRollback).
        // On a rollback preview (a fillet/chamfer reselect pick) that state IS the
        // preview — `features.length` would read as "no rollback" to
        // seedRollbackIndices and resolve the boundary refs against later geometry
        // the user never saw (same correction as sketch.projectEdges).
        refPositions = { [owner.id]: owner.rollbackIndex ?? owner.features.length };
    }
    return {
        planeRef,
        externalRefs: captureBoundaryExternalRefs(owner, result, plane),
        refPositions,
    };
}

async function pickPlane(document: IDocument, controller: AsyncController): Promise<PickedPlane | undefined> {
    document.selection.clearSelection();
    const handler = new PlanePickHandler(document, controller);
    await document.picker.pickAsync(handler, "prompt.select.plane", controller, "none", "select.default");
    controller.dispose();
    handler.dispose();
    document.selection.clearSelection();
    return resolvePlane(document, handler.result);
}

function sketchDataFromPick(picked: PickedPlane): SketchData | undefined {
    if (picked.externalRefs === undefined && picked.refPositions === undefined) return undefined;
    return {
        ...emptySketchData(),
        externalRefs: picked.externalRefs,
        refPositions: picked.refPositions,
        // captureBoundaryExternalRefs numbered the refs from
        // FIRST_EXTERNAL_ENTITY_ID down before the solver existed —
        // persist the counter so the no-reuse invariant is explicit
        // instead of relying on the load-time Math.min recovery
        // (undefined drops out of the serialized JSON). The next counter
        // derives from the actual refs; it is never read on an empty list
        // (captureBoundaryExternalRefs returns undefined for one), so the
        // Math.min spread cannot see an empty array.
        externalIdSeq:
            picked.externalRefs === undefined
                ? undefined
                : Math.min(...picked.externalRefs.map((ref) => ref.entityId)) - 1,
    };
}

/**
 * Wraps the plane picker as a step. The pick is what the offset step then measures
 * from, so the command keeps it rather than the step carrying it forward.
 */
class PickSketchPlaneStep implements IStep {
    constructor(private readonly onPicked: (picked: PickedPlane) => void) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const picked = await pickPlane(document, controller);
        if (picked === undefined) return undefined;
        this.onPicked(picked);
        return { view: document.application.activeView!, shapes: [], type: "input", plane: picked.plane };
    }
}

@command({ key: "sketch.create", icon: "icon-sketchNew" })
export class CreateSketch extends MultistepCommand {
    private _picked: PickedPlane | undefined;
    private _offsetHandler: SketchPlaneOffsetHandler | undefined;
    private _syncingFromOffset = false;

    /**
     * Whether an offset is specified at all. Off by default: a sketch almost always sits on
     * the plane it was picked on, so making every one of them confirm an offset is a step
     * that decides nothing. Off is also what keeps the offset at zero — nothing moves the
     * plane (see `appliedOffset`) — and hides its row, so an unspecified offset has nothing
     * to show and nothing to edit. Ticking it while the plane pick is still up takes effect
     * on that same run.
     */
    @property("option.command.specifyPlaneOffset")
    get specifyPlaneOffset(): boolean {
        return this.getPrivateValue("specifyPlaneOffset", false);
    }
    set specifyPlaneOffset(value: boolean) {
        if (!this.setProperty("specifyPlaneOffset", value)) return;
        // Unticking with the drag already up ends it there, on the picked plane: the option
        // decides whether placing the offset is part of the run, and it just left. Ticking it
        // mid-pick needs nothing here — the step reads the answer when it starts.
        if (!value) this._offsetHandler?.settle();
    }

    /**
     * How far along its normal the sketch plane sits off the picked plane. Only read while
     * `specifyPlaneOffset` is on — the row is hidden otherwise, which is what the dependency
     * below says. The value is kept across a toggle, so un-ticking and re-ticking a run gives
     * the same placement back.
     */
    @property("option.command.planeOffset", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "specifyPlaneOffset", value: true }],
    })
    get planeOffset(): ParameterValue {
        return this.getPrivateValue("planeOffset", 0);
    }
    set planeOffset(value: ParameterValue) {
        this.setProperty("planeOffset", value);
        // Without a live drag there is nothing to preview, and nothing to resolve against.
        if (this._syncingFromOffset || this._offsetHandler === undefined) return;
        const resolved = this.resolveLength(value);
        if (resolved !== undefined) this._offsetHandler.setValue(resolved);
    }

    /**
     * The offset the plane is actually moved by. Nothing is specified means nothing is
     * applied: the answer is constantly zero whatever the hidden field holds, so the sketch
     * lands on the plane the user picked. Zeroing here rather than at the field also keeps a
     * stale expression that no longer resolves from stranding the run on a row the panel is
     * not showing.
     */
    private appliedOffset(): Result<number> {
        if (!this.specifyPlaneOffset) return Result.ok(0);
        return this.resolveParameter(this.planeOffset, LENGTH_UNITS);
    }

    /** A length field's numeric value, or undefined when its expression does not resolve. */
    private resolveLength(value: ParameterValue): number | undefined {
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The drag's own preview geometry, and what the step reads when no drag opens. */
    private get offsetValue(): number {
        const applied = this.appliedOffset();
        return applied.isOk ? applied.value : 0;
    }

    protected override async canExcute(): Promise<boolean> {
        // Closing any live session up front: the new sketch takes the view.
        SketchEditor.exit();
        if (this.application.activeView?.document === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return false;
        }
        return true;
    }

    protected override getSteps(): IStep[] {
        return [
            new PickSketchPlaneStep((picked) => (this._picked = picked)),
            // Always present, but it only opens a drag when the option asks for one — the
            // answer is read as the step runs, so the box can be ticked during the pick.
            new SketchPlaneOffsetStep(
                "prompt.dragToOffset",
                this.getOffsetData,
                () => this.specifyPlaneOffset,
            ),
        ];
    }

    private readonly getOffsetData = (): OffsetDragData => {
        const picked = this._picked;
        if (picked === undefined) throw new Error("the plane pick must run before the offset step");
        return {
            basePlane: picked.plane,
            // A datum's quad shows in its display frame, and the preview has to carry on from
            // there — see `datumDisplayPlane`. A face pick has no such frame: the face's own
            // plane is the one the user saw.
            quadPlane: picked.datumPlane === undefined ? undefined : datumDisplayPlane(picked.datumPlane),
            // A datum's quad is a stand-in drawn at a fixed place, so the preview is centred on
            // it; a face is the geometry the user actually pointed at, so the preview closes
            // around the click and the handle lands under the cursor.
            pickPoint: picked.pickPoint,
            // Where the sketch lands with no drag at all — zero while the offset is unspecified.
            offset: this.offsetValue,
            onReady: (handler: SketchPlaneOffsetHandler) => {
                this._offsetHandler = handler;
            },
            onDone: () => {
                this._offsetHandler = undefined;
            },
            onOffset: (offset: number) => {
                this._syncingFromOffset = true;
                this.planeOffset = offset;
                this._syncingFromOffset = false;
            },
        };
    };

    protected override executeMainTask(): void {
        const picked = this._picked;
        if (picked === undefined) return;
        const resolved = this.appliedOffset();
        if (!resolved.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", resolved.error);
            return;
        }
        const node = new SketchNode({
            document: this.document,
            plane: picked.plane.offsetAlongNormal(resolved.value),
            planeRef: picked.planeRef,
            datumPlane: picked.datumPlane,
            planeOffset: resolved.value,
            data: sketchDataFromPick(picked),
        });
        Transaction.execute(this.document, "create sketch", () => {
            this.document.modelManager.addNode(node);
        });
        SketchEditor.enter(node);
    }
}

@command({ key: "sketch.enter", icon: "icon-sketchEdit" })
export class EnterSketch extends CancelableCommand {
    async executeAsync(): Promise<void> {
        SketchEditor.exit();

        const document = this.application.activeView?.document;
        if (document === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        this.controller = new AsyncController();
        const node = await pickSketch(document, this.controller);
        if (node !== undefined) SketchEditor.enter(node);
    }
}

/** The selected sketch, or an interactive pick when nothing suitable is selected. */
async function pickSketch(document: IDocument, controller: AsyncController): Promise<SketchNode | undefined> {
    const selected = document.selection.getSelectedNodes().find((n) => n instanceof SketchNode);
    if (selected !== undefined) return selected as SketchNode;

    const picked = await document.picker.pickNode("prompt.select.sketch", controller, {
        nodeFilter: { allow: (node) => node instanceof SketchNode },
    });
    controller.dispose();
    document.selection.clearSelection();
    return picked[0] as SketchNode | undefined;
}

@command({ key: "sketch.exit", icon: "icon-back" })
export class ExitSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        SketchEditor.exit();
    }
}

@command({ key: "sketch.constraints", icon: "icon-layer-group" })
export class ToggleSketchConstraintsPanel implements ICommand {
    async execute(): Promise<void> {
        SketchEditor.getActive()?.toggleConstraintsPanel();
    }
}
