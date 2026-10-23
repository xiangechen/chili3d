// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class Constants {
    static readonly Layers = Object.freeze({
        Default: 0,
        Wireframe: 1,
        Solid: 2,
        Isolation: 30,
    });
}

/**
 * The `userData` key a split edge line object carries its source-mesh vertex offset under —
 * set in `ThreeGeometry.initEdges`, read back in `threeView.findShapeAndIndex` to shift a
 * pick index into the mesh's own vertex numbering.
 */
export const EdgeVertexOffsetKey = "edgeVertexOffset";
