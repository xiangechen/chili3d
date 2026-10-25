// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IEdge, IFace, IShape } from "./shape";
import { ShapeTypes } from "./shapeType";

/**
 * Groups faces into connected sets: two faces share a set when they share an edge.
 *
 * A feature that thickens or offsets several picked faces has to hand each connected set
 * to the kernel as ONE shape — two disconnected faces offered as one shell fail outright,
 * and a connected set must go in together so the edges its faces share raise no wall
 * between them. Each group is a list of indexes into `faces`.
 */
export function connectedFaceGroups(faces: readonly IFace[]): number[][] {
    const edges = faces.map((face) => safeEdges(face));
    const parent = faces.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) root = parent[root];
        return root;
    };
    for (let a = 0; a < faces.length; a++) {
        for (let b = a + 1; b < faces.length; b++) {
            if (!edges[a].some((edge) => edges[b].some((other) => edge.isSame(other)))) continue;
            parent[find(a)] = find(b);
        }
    }
    const groups = new Map<number, number[]>();
    for (let index = 0; index < faces.length; index++) {
        const root = find(index);
        groups.set(root, [...(groups.get(root) ?? []), index]);
    }
    return [...groups.values()];
}

/** A shape's edges; a degenerate one contributes none rather than throwing. */
export function safeEdges(shape: IShape): IEdge[] {
    try {
        return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        return [];
    }
}
