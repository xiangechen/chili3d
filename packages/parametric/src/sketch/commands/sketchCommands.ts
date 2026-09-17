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
    type Plane,
    PubSub,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { reportSilentIdLoss } from "../../features/idDiagnostics";
import { ParametricBodyNode } from "../../parametricBodyNode";
import { SketchEditor } from "../editor/sketchEditor";
import { captureExternalRef } from "../externalRef";
import { captureFaceRef, type PlaneFaceRef, sketchPlaneOfFace } from "../planeRef";
import {
    type ExternalRefData,
    emptySketchData,
    FIRST_EXTERNAL_ENTITY_ID,
    type SketchData,
} from "../sketchModel";
import { SketchNode } from "../sketchNode";
import { PlanePickHandler, type PlanePickResult } from "./planePickHandler";

interface PickedPlane {
    plane: Plane;
    /** Set when the plane comes from a solid's face, so the sketch follows that face. */
    planeRef?: PlaneFaceRef;
    /** Boundary edges of the picked face, captured as reference-role external refs. */
    externalRefs?: ExternalRefData[];
    /** Timeline anchor of the picked body (its feature count now), for session rollback. */
    refPositions?: Record<string, number>;
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
    const refs: ExternalRefData[] = [];
    const ownerEdges =
        owner instanceof ParametricBodyNode && owner.shape.isOk
            ? (owner.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
            : [];
    let nextId = FIRST_EXTERNAL_ENTITY_ID;
    for (const localEdge of localEdges) {
        const worldEdge = localEdge.transformedMul(result.data.transform) as IEdge;
        try {
            let edgeId: string | undefined;
            if (owner instanceof ParametricBodyNode) {
                // isSame, not isEqual: wire exploration may decorate the edge with a
                // reversed orientation, which IsEqual rejects — boolean-born faces
                // (a groove's floor) would otherwise lose their tracked ids here.
                const index = ownerEdges.findIndex((edge) => edge.isSame(localEdge));
                edgeId = index < 0 ? undefined : owner.edgeIdAt(index);
                if (edgeId === undefined) {
                    reportSilentIdLoss(
                        owner,
                        "edge",
                        index < 0
                            ? "a boundary edge of the picked face was not found on the source body"
                            : "a boundary edge of the picked face has no tracked id",
                    );
                }
            }
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
    if (result.kind === "datum") return { plane: result.plane };

    const face = result.data.shape.transformedMul(result.data.transform) as IFace;
    const plane = sketchPlaneOfFace(face);
    const owner = document.visual.context.getNode(result.data.owner);
    const picked = owner === undefined ? undefined : capturePlaneOwner(owner, result, face, plane);
    face.dispose();
    return { plane, ...picked };
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
    await document.picker.pickAsync(handler, "prompt.select.plane", controller, false, "select.default");
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

@command({ key: "sketch.create", icon: "icon-sketchNew" })
export class CreateSketch extends CancelableCommand {
    async executeAsync(): Promise<void> {
        SketchEditor.exit();

        const document = this.application.activeView?.document;
        if (document === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        this.controller = new AsyncController();
        const picked = await pickPlane(document, this.controller);
        if (picked === undefined) return;
        const node = new SketchNode({
            document,
            plane: picked.plane,
            planeRef: picked.planeRef,
            data: sketchDataFromPick(picked),
        });
        Transaction.execute(document, "create sketch", () => {
            document.modelManager.addNode(node);
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
