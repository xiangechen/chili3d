// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode, ShapeMeshData } from "@chili3d/core";

/**
 * The translucent preview a picking command shows while it collects its input: the one mesh
 * the viewport holds on the command's behalf, replaced on every update and taken down when
 * the command ends. Keeping the id here is what stops a re-preview from stacking a second
 * copy on the first — the command's own state is the shape it is building, not this.
 *
 * A preview that shows the result of combining with an existing body also stands in for
 * that body, which goes invisible for as long as the preview shows it (the extrude drag's
 * contract): the body is what the operation would have rewritten.
 */
export class PreviewVisual {
    private id: number | undefined;
    private standingInFor: INode[] = [];

    /**
     * Replaces what is on screen with `meshes`, standing in for `standsInFor` — nodes put
     * away while it shows. An empty `meshes` takes the preview down and puts every node
     * back, which is what input that cannot be built yet (or no longer) looks like.
     */
    show(document: IDocument, meshes: ShapeMeshData[], standsInFor: INode[] = []): void {
        this.hide(document);
        if (meshes.length === 0) return;

        this.id = document.visual.context.displayMesh(meshes, { meshOpacity: 0.5 });
        for (const node of standsInFor) {
            document.visual.context.setVisible(node, false);
            this.standingInFor.push(node);
        }
        document.visual.update();
    }

    /** Takes the preview down; refreshing the view is the caller's to do. */
    hide(document: IDocument): void {
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
