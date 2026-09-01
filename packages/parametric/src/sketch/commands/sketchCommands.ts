// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    type IApplication,
    type ICommand,
    type IDocument,
    type IFace,
    type Plane,
    PubSub,
    Transaction,
} from "@chili3d/core";
import { ParametricBodyNode } from "../../parametricBodyNode";
import { SketchEditor } from "../editor/sketchEditor";
import { captureFaceRef, type PlaneFaceRef, planeOfFace } from "../planeRef";
import { SketchNode } from "../sketchNode";
import { PlanePickHandler, type PlanePickResult } from "./planePickHandler";

interface PickedPlane {
    plane: Plane;
    /** Set when the plane comes from a solid's face, so the sketch follows that face. */
    planeRef?: PlaneFaceRef;
}

function resolvePlane(document: IDocument, result: PlanePickResult | undefined): PickedPlane | undefined {
    if (result === undefined) return undefined;
    if (result.kind === "datum") return { plane: result.plane };
    const face = result.data.shape.transformedMul(result.data.transform) as IFace;
    const plane = planeOfFace(face);
    const owner = document.visual.context.getNode(result.data.owner);
    let planeRef: PlaneFaceRef | undefined;
    if (owner !== undefined) {
        planeRef = captureFaceRef(owner.id, face);
        // Faces of a parametric body carry a stable id across rebuilds — store it so
        // the sketch tracks the face exactly instead of re-matching geometrically.
        if (owner instanceof ParametricBodyNode) {
            const faceId = owner.faceIdAt(result.data.indexes[0]);
            if (faceId !== undefined) planeRef.faceId = faceId;
        }
    }
    face.dispose();
    return { plane, planeRef };
}

async function pickPlane(document: IDocument): Promise<PickedPlane | undefined> {
    document.selection.clearSelection();
    const controller = new AsyncController();
    const handler = new PlanePickHandler(document, controller);
    await document.picker.pickAsync(handler, "prompt.select.plane", controller, false, "select.default");
    controller.dispose();
    handler.dispose();
    document.selection.clearSelection();
    return resolvePlane(document, handler.result);
}

@command({ key: "sketch.create", icon: "icon-edit" })
export class CreateSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (document === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        const picked = await pickPlane(document);
        if (picked === undefined) return;
        const node = new SketchNode({ document, plane: picked.plane, planeRef: picked.planeRef });
        Transaction.execute(document, "create sketch", () => {
            document.modelManager.addNode(node);
        });
        SketchEditor.enter(node);
    }
}

@command({ key: "sketch.enter", icon: "icon-edit" })
export class EnterSketch implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (document === undefined) {
            PubSub.default.pub("displayError", "No active view");
            return;
        }
        const node = await pickSketch(document);
        if (node !== undefined) SketchEditor.enter(node);
    }
}

/** The selected sketch, or an interactive pick when nothing suitable is selected. */
async function pickSketch(document: IDocument): Promise<SketchNode | undefined> {
    const selected = document.selection.getSelectedNodes().find((n) => n instanceof SketchNode);
    if (selected !== undefined) return selected as SketchNode;

    const controller = new AsyncController();
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
