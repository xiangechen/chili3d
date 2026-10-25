// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { INode } from "../model";
import { type ShapeMeshData, ShapeTypes } from "../shape";
import type { INodeVisual } from "./visualObject";
import { VisualStates } from "./visualShape";

export interface PreviewVisualOptions {
    /** Nodes whose display the preview replaces — hidden for as long as it shows. */
    standsInFor?: INode[];
    /**
     * Node visuals whose faces are ghosted (faceTransparent) while the preview shows. Use this
     * instead of `standsInFor` when the original must stay visible and pickable — a fillet's
     * preview is recessed into the solid, so hiding the body would leave nothing to pick on.
     */
    ghost?: INodeVisual[];
    /** How opaque the preview is drawn. Defaults to the translucent picking preview. */
    opacity?: number;
    onTop?: boolean;
}

/**
 * The preview a picking command shows while it collects its input: the one mesh the viewport
 * holds on the command's behalf, replaced on every update and taken down when the command ends.
 * Keeping the id here is what stops a re-preview from stacking a second copy on the first — the
 * command's own state is the shape it is building, not this.
 *
 * A preview that shows the result of combining with an existing body also stands in for that
 * body, which goes invisible (or ghosted) for as long as the preview shows it.
 */
export class PreviewVisual {
    private id: number | undefined;
    private standingInFor: INode[] = [];
    private ghosted: INodeVisual[] = [];

    /**
     * Replaces what is on screen with `meshes`. An empty `meshes` takes the preview down and
     * puts every node back, which is what input that cannot be built yet (or no longer) looks
     * like.
     */
    show(document: IDocument, meshes: ShapeMeshData[], options: PreviewVisualOptions = {}): void {
        this.hide(document);
        if (meshes.length === 0) return;

        this.id = document.visual.context.displayMesh(meshes, {
            meshOpacity: options.opacity ?? 0.5,
            onTop: options.onTop,
        });
        for (const node of options.standsInFor ?? []) {
            document.visual.context.setVisible(node, false);
            this.standingInFor.push(node);
        }
        for (const owner of options.ghost ?? []) {
            document.visual.highlighter.addState(owner, VisualStates.faceTransparent, ShapeTypes.shape);
            this.ghosted.push(owner);
        }
        document.visual.update();
    }

    /** Takes the preview down; refreshing the view is the caller's to do. */
    hide(document: IDocument): void {
        for (const owner of this.ghosted) {
            document.visual.highlighter.removeState(owner, VisualStates.faceTransparent, ShapeTypes.shape);
        }
        this.ghosted = [];
        for (const node of this.standingInFor) {
            // Back to what the node model says it should be, not blindly visible: a body
            // the user had already hidden stays hidden.
            document.visual.context.setVisible(node, node.visible && node.parentVisible);
        }
        this.standingInFor = [];
        if (this.id === undefined) return;

        document.visual.context.removeMesh(this.id);
        this.id = undefined;
    }
}
