// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    type I18nKeys,
    type IDocument,
    type INode,
    type INodeVisual,
    type IStep,
    ShapeTypes,
    ShapeTypeUtils,
    type SnapResult,
    type VisualShapeData,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SELECTED_FACE_STATE } from "./selectedFaceState";

/**
 * The multi-face pick a face-consuming feature opens with: as ONE step that stays open until the
 * user confirms, so the command's parameters (how thick, on which side, what join) can be decided
 * against the live preview rather than in a dialog after the fact.
 *
 * 1. faces are already selected → they seed the pick;
 * 2. a subclass may add more seeds of its own (`seedFaces` — the thicken seeds a surface body's
 *    whole face set, say);
 * 3. the user then picks, adds to and removes from that set; the filter only allows parametric
 *    bodies, and the result is confined to ONE of them, because a feature's input is one body.
 *
 * `onReady` fires once the seeded set is in place, so the preview is up before the first click.
 */
export class SelectBodyFacesStep implements IStep {
    constructor(
        protected readonly onReady: () => void = () => {},
        private readonly prompt: I18nKeys = "prompt.select.faces",
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const view = document.application.activeView!;
        const seeded = [...this.preselectedFaces(document), ...this.seedFaces(document)];
        document.selection.setSelectedShapes(seeded, SELECTED_FACE_STATE, false);
        this.onReady();

        const shapes = await document.picker.pickShape(this.prompt, controller, {
            shapeType: ShapeTypes.face,
            multi: true,
            nodeFilter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            selectedState: SELECTED_FACE_STATE,
        });
        if (shapes.length === 0) return undefined;
        return this.oneBody(view, shapes);
    }

    /** Extra faces to seed the pick with, beyond what the selection already holds. */
    protected seedFaces(_document: IDocument): VisualShapeData[] {
        return [];
    }

    /** The selected faces of a parametric body, as they stand when the command starts. */
    protected preselectedFaces(document: IDocument): VisualShapeData[] {
        return document.selection
            .getSelectedShapes()
            .filter(
                (x) =>
                    x.owner.node instanceof ParametricBodyNode &&
                    ShapeTypeUtils.contains(ShapeTypes.face, x.shape.shapeType),
            );
    }

    /** The picked faces of the FIRST body among them — a feature's input is one body. */
    protected oneBody(view: SnapResult["view"], shapes: VisualShapeData[]): SnapResult {
        const node = shapes[0].owner.node;
        return {
            view,
            shapes: shapes.filter((x) => x.owner.node === node),
            nodes: [node],
            type: "shape",
        };
    }

    /**
     * Every face of `body`, synthesized from its mesh ranges exactly as a viewport pick reports
     * them — the same trick `SelectSketchProfilesStep.sketchProfileFaces` uses.
     */
    protected static facesOf(document: IDocument, body: ParametricBodyNode): VisualShapeData[] {
        const owner = document.visual.context.getVisual(body) as INodeVisual | undefined;
        const ranges = body.mesh.faces?.range ?? [];
        if (owner === undefined) return [];
        const nodeTransform = owner.worldTransform();
        const faces: VisualShapeData[] = [];
        for (const [index, range] of ranges.entries()) {
            if (range.shape.shapeType !== ShapeTypes.face) continue;
            faces.push({
                shape: range.shape,
                owner,
                transform:
                    range.transform === undefined ? nodeTransform : nodeTransform.multiply(range.transform),
                point: BoundingBox.center(range.shape.boundingBox()),
                indexes: [index],
            });
        }
        return faces;
    }
}
