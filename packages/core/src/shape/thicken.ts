// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "../foundation";
import { connectedFaceGroups } from "./faceGroups";
import type { IFace, IShape } from "./shape";

/**
 * Thickens picked faces by each signed thickness in `plan`, returning their combination.
 *
 * Each connected face set goes to the kernel as ONE shape: two disconnected faces offered as
 * one shell fail outright, and a connected set must go in together so the edges its faces
 * share raise no wall between them. A lone face goes in as itself — the caller's own shape,
 * never disposed here. The returned shape is the caller's to dispose.
 *
 * The faces must be in the space the result is wanted in. Grouping is topological
 * (`edge.isSame`), so passing world-space COPIES breaks the adjacency between neighbouring
 * faces and silently degrades every group to a single face; callers that work on a node's
 * shape should group in that node's local space and transform the result for display.
 */
export function thickenFaces(faces: readonly IFace[], plan: readonly number[]): Result<IShape> {
    if (faces.length === 0) return Result.err("No faces to thicken");
    if (plan.length === 0) return Result.err("No thickness to apply");

    const shapes: IShape[] = [];
    const discard = () => shapes.forEach((x) => x.dispose());
    for (const group of connectedFaceGroups(faces)) {
        const source =
            group.length === 1
                ? Result.ok<IShape>(faces[group[0]])
                : shapeFactory.shell(group.map((index) => faces[index]));
        if (!source.isOk) {
            discard();
            return Result.err(source.error);
        }
        try {
            for (const thickness of plan) {
                const one = shapeFactory.makeThickSolidBySimple(source.value, thickness);
                if (!one.isOk) {
                    discard();
                    return Result.err(one.error);
                }
                shapes.push(one.value);
            }
        } finally {
            // A lone face belongs to the caller; a shell is this function's own.
            if (group.length > 1) source.value.dispose();
        }
    }

    const combined = shapeFactory.combine(shapes);
    discard();
    return combined.isOk ? Result.ok(combined.value) : Result.err(combined.error);
}
