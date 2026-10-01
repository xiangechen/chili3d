// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, type IVertex, ShapeTypes, type XYZLike } from "@chili3d/core";
import { distance, MATCH_TOLERANCE, plainVec } from "./refGeometry";

/**
 * A geometric fingerprint of a vertex: just its position. Vertices carry no tracked
 * ids (the body timeline tracks faces and edges only), so a vertex ref always
 * re-matches geometrically — the referenced node's rebuilt shape is scanned for the
 * nearest vertex within MATCH_TOLERANCE.
 */
export interface VertexRef {
    readonly point: XYZLike;
}

export function captureVertexRef(vertex: IVertex): VertexRef {
    return { point: plainVec(vertex.point()) };
}

/**
 * The nearest vertex of `shape` to the ref's point within tolerance; undefined when
 * none qualifies. A tie keeps the first hit — coincident vertices are the same point
 * for the caller's purposes (a loft end section).
 */
export function matchVertex(shape: IShape, ref: VertexRef): IVertex | undefined {
    const vertices = shape.findSubShapes(ShapeTypes.vertex) as IVertex[];
    let best: IVertex | undefined;
    let bestDistance = MATCH_TOLERANCE;
    for (const vertex of vertices) {
        const d = distance(vertex.point(), ref.point);
        if (d <= bestDistance) {
            best = vertex;
            bestDistance = d;
        }
    }
    return best;
}
