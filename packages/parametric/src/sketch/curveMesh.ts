// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, Plane } from "@chili3d/core";
import { toWorld } from "./sketchModel";

/**
 * Sampled (u, v) points of one curve as a single segment chain — whatever the editor has as
 * samples rather than as a kernel shape: an entity of a numeric curve family (ellipse, conic,
 * bezier, nurbs, ellipseArc), and a trim/extend preview's own pieces.
 *
 * Its own module because two things need it that are not each other: the editor, drawing the
 * entity it holds, and the draw commands, previewing the one still being picked. Spelled once,
 * a preview cannot drift from the edge the commit goes on to draw.
 */
export function curveChainMesh(
    plane: Plane,
    uvs: readonly [number, number][],
    color: number,
    lineType: "solid" | "dash" = "solid",
): EdgeMeshData {
    const position = new Float32Array(Math.max(0, uvs.length - 1) * 6);
    for (let i = 1; i < uvs.length; i++) {
        const p0 = toWorld(plane, uvs[i - 1][0], uvs[i - 1][1]);
        const p1 = toWorld(plane, uvs[i][0], uvs[i][1]);
        position.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], (i - 1) * 6);
    }
    return { position, range: [], color, lineType };
}
